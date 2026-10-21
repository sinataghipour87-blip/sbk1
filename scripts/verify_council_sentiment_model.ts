import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AnalysisResult } from '../src/types/trading';
import type { CouncilMacroContext } from '../src/services/eightMemberCouncil';
import { runEightMemberCouncilRuntime } from '../src/services/eightMemberCouncilRuntime';
import { openSourceAdvisoryService } from '../src/services/openSourceAdvisoryService';
import type { DirectNewsHeadline } from '../src/services/directNewsFeeds';

const modelRevision = 'ae0eab9ad336d7d548e0efe394b07c04bcaf6e91';
const modelCache = process.env.SBK1_MODEL_CACHE_DIR?.trim() ||
  path.resolve('.cache/sbk1/open-source-models');
const modelSnapshot = path.join(
  modelCache,
  'models--mrm8488--distilroberta-finetuned-financial-news-sentiment-analysis',
  'snapshots',
  modelRevision,
);
for (const file of ['model.safetensors', 'config.json', 'tokenizer.json', 'tokenizer_config.json']) {
  const filePath = path.join(modelSnapshot, file);
  if (!existsSync(filePath)) {
    throw new Error(
      `MODEL_FILES_MISSING: ${filePath}; no model download was attempted.`,
    );
  }
}

process.env.HF_HUB_OFFLINE = '1';
process.env.TRANSFORMERS_OFFLINE = '1';
process.env.SBK1_MODEL_CACHE_DIR = modelCache;

const nowMs = Date.now();
const candles = Array.from({ length: 30 }, (_, index) => ({
  timestampMs: nowMs - (30 - index) * 5 * 60_000,
  open: 60_000 + index * 10,
  high: 60_100 + index * 10,
  low: 59_900 + index * 10,
  close: 60_050 + index * 10,
  volume: 1 + index,
}));
const sourceTimestampMs = candles.at(-1)!.timestampMs;
const headlines: DirectNewsHeadline[] = [{
  id: 'local-inference-fixture',
  headline: 'Bitcoin market outlook improves as institutional demand strengthens',
  publisher: 'SBK1 deterministic inference fixture',
  url: 'https://example.invalid/sbk1-sentiment-fixture',
  publishedAt: new Date(nowMs - 1_000).toISOString(),
}];
const analysisReport = await openSourceAdvisoryService.analyze(candles, headlines);
const sentiment = analysisReport.modules.newsSentiment;
if (sentiment.status !== 'AVAILABLE') {
  await openSourceAdvisoryService.stop();
  throw new Error(
    `SENTIMENT_INFERENCE_UNAVAILABLE: ${sentiment.reason ?? analysisReport.status}; local model must run offline.`,
  );
}
const aggregateSentiment = sentiment.aggregateSentiment;
if (typeof aggregateSentiment !== 'number' || !Number.isFinite(aggregateSentiment)) {
  await openSourceAdvisoryService.stop();
  throw new Error('SENTIMENT_INFERENCE_INVALID: model returned no finite aggregate sentiment score.');
}
assert.equal(analysisReport.sourceTimestampMs, sourceTimestampMs);
assert.equal(sentiment.sourceTimestampMs, sourceTimestampMs);
assert.equal(sentiment.model, 'mrm8488/distilroberta-finetuned-financial-news-sentiment-analysis');
assert.equal(sentiment.headlineCount, 1);
assert.equal(Array.isArray(sentiment.headlines), true);

const repositoryDir = await mkdtemp(path.join(os.tmpdir(), 'sbk1-sentiment-model-council-'));
try {
  const council = await runEightMemberCouncilRuntime({
    analysis: {
      candles: candles.map(({ open, high, low, close, volume }) =>
        [open, high, low, close, volume]),
      openSourceAdvisories: analysisReport,
    } as unknown as AnalysisResult,
    macroContext: {
      overallDataStatus: 'UNAVAILABLE',
      lastUpdatedTime: null,
      sp500Status: 'UNAVAILABLE',
      sp500DailyChangePct: null,
      dxyStatus: 'UNAVAILABLE',
      dxyDailyChangePct: null,
      etfFlowStatus: 'UNAVAILABLE',
      spotEtfNetInflowMillionUsd: null,
      newsSentimentStatus: 'UNAVAILABLE',
      newsSentimentScore: null,
      newsHeadlinesStatus: 'UNAVAILABLE',
      recentHeadlines: [],
      whaleFlowStatus: 'UNKNOWN',
      whaleNetflowBtc: null,
      whalePressureIndex: null,
      whaleSentiment: 'UNKNOWN',
      fundamentalBias: 'UNAVAILABLE',
    } satisfies CouncilMacroContext,
    decisionSnapshotTimestampMs: sourceTimestampMs,
    repositoryDir,
    nowMs,
  });

  const expectedVote = aggregateSentiment >= 0.1
    ? 'LONG'
    : aggregateSentiment <= -0.1
      ? 'SHORT'
      : 'NEUTRAL';
  assert.equal(council.members.length, 8);
  assert.equal(council.members[7].vote, expectedVote);
  assert.match(council.members[7].rationaleFa, /امتیاز سنتیمنت خبر معتبر/);

  const memberRecord = JSON.parse(
    await readFile(path.join(repositoryDir, 'member-08.jsonl'), 'utf8').then((value) => value.trim()),
  ) as {
    snapshotId: string;
    memberId: number;
    vote: string;
    rationaleFa: string;
    sourceData: { newsSentimentScore: number; recentHeadlines: Array<{ headline: string }> };
    moduleOutputs: Array<{ moduleId: string; status: string; sourceTimestampMs: number | null }>;
  };
  const voteRecord = JSON.parse(
    await readFile(path.join(repositoryDir, 'council-votes.jsonl'), 'utf8').then((value) => value.trim()),
  ) as { snapshotId: string; report: { members: Array<{ id: number; vote: string }> } };
  const storedSentiment = memberRecord.moduleOutputs.find(
    ({ moduleId }) => moduleId === 'openSource.newsSentiment',
  );

  assert.equal(memberRecord.memberId, 8);
  assert.equal(memberRecord.snapshotId, `SNP_${sourceTimestampMs}_${nowMs}`);
  assert.equal(voteRecord.snapshotId, memberRecord.snapshotId);
  assert.equal(storedSentiment?.status, 'AVAILABLE');
  assert.equal(storedSentiment?.sourceTimestampMs, sourceTimestampMs);
  assert.equal(memberRecord.sourceData.newsSentimentScore, aggregateSentiment * 100);
  assert.equal(
    memberRecord.sourceData.recentHeadlines[0].headline,
    headlines[0].headline,
  );
  assert.equal(memberRecord.vote, expectedVote);
  assert.equal(
    voteRecord.report.members.find(({ id }) => id === 8)?.vote,
    expectedVote,
  );
  assert.equal(memberRecord.rationaleFa, council.members[7].rationaleFa);
  assert.equal(council.quorumRequired, 5);

  console.log(JSON.stringify({
    result: 'PASS',
    model: sentiment.model,
    revision: sentiment.revision,
    inference: 'executed locally with network downloads disabled',
    sourceTimestampMs,
    aggregateSentiment,
    expectedMemberEightVote: expectedVote,
    persistedSnapshotId: memberRecord.snapshotId,
    persistedMemberId: memberRecord.memberId,
    evidenceStatus: storedSentiment?.status,
  }, null, 2));
} finally {
  await rm(repositoryDir, { recursive: true, force: true });
  await openSourceAdvisoryService.stop();
}
