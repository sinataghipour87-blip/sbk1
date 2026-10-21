import dotenv from 'dotenv';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fetchDirectNewsHeadlines } from '../src/services/directNewsFeeds';
import { fetchDeribitOptionsData } from '../src/services/deribitOptionsData';
import { fetchFreeMacroData } from '../src/services/freeMacroData';
import { fetchOnChainWhaleData } from '../src/services/publicBitcoinWhaleData';
import type { AnalysisResult } from '../src/types/trading';
import type { CouncilMacroContext, CouncilMemberVote } from '../src/services/eightMemberCouncil';
import { runEightMemberCouncilRuntime } from '../src/services/eightMemberCouncilRuntime';

dotenv.config();
const checkedAtMs = Date.now();

const [macro, options, onChainData, news] = await Promise.all([
  fetchFreeMacroData(),
  fetchDeribitOptionsData(),
  fetchOnChainWhaleData(),
  fetchDirectNewsHeadlines(),
]);
const repositoryDir = await mkdtemp(path.join(os.tmpdir(), 'sbk1-live-council-source-'));
let whaleMemberVote: CouncilMemberVote;
let memberVotes: Array<{
  id: number;
  name: string;
  vote: CouncilMemberVote['vote'];
  sourceAgeMs: number | null;
  dataQualityPct: number | null;
  reason: string;
  evidence: Array<{ moduleId: string; status: string; sourceTimestampMs: number | null }>;
}> = [];
try {
  const runtimeReport = await runEightMemberCouncilRuntime({
    analysis: { price: 1, candles: [] } as unknown as AnalysisResult,
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
    freeMacroData: macro,
    optionsData: options,
    whaleFlowData: onChainData,
    repositoryDir,
    nowMs: checkedAtMs,
  });
  whaleMemberVote = runtimeReport.members[5];
  memberVotes = runtimeReport.members.map((member) => ({
    id: member.id,
    name: member.nameFa,
    vote: member.vote,
    sourceAgeMs: member.sourceAgeMs,
    dataQualityPct: member.dataQualityPct,
    reason: member.rationaleFa,
    evidence: member.supportingEvidence.map(({ moduleId, status, sourceTimestampMs }) => ({
      moduleId,
      status,
      sourceTimestampMs,
    })),
  }));
} finally {
  await rm(repositoryDir, { recursive: true, force: true });
}
const onChainFresh = onChainData.timestampMs !== null &&
  checkedAtMs >= onChainData.timestampMs &&
  checkedAtMs - onChainData.timestampMs <= 20 * 60_000;
const onChainRecordsValid = onChainData.status === 'LIVE' &&
  onChainData.coverageStatus === 'SAMPLED' &&
  Array.isArray(onChainData.largeTransfers) &&
  onChainData.largeTransfers.every((transfer) =>
    transfer.transactionHash.length > 0 &&
    transfer.blockchain.length > 0 &&
    transfer.amount > 0 &&
    Number.isFinite(transfer.timestampMs) &&
    ['CONFIRMED', 'UNCONFIRMED', 'UNKNOWN'].includes(transfer.confirmationStatus)
  ) &&
  new Set(onChainData.largeTransfers.map((transfer) =>
    `${transfer.blockchain}:${transfer.transactionHash}:${transfer.transferId ?? ''}`
  )).size === onChainData.largeTransfers.length;
const onChainMemberVerified = onChainRecordsValid &&
  onChainFresh &&
  ['NEUTRAL', 'ABSTAIN'].includes(whaleMemberVote.vote);

const report = {
  checkedAt: new Date().toISOString(),
  credentials: {
    fredApiKeyRequired: false,
    massiveApiKeyConfigured: Boolean(process.env.MASSIVE_API_KEY?.trim()),
    whaleAlertApiKeyConfigured: Boolean(process.env.WHALE_ALERT_API_KEY?.trim()),
  },
  macro: Object.fromEntries(
    Object.entries(macro).map(([name, result]) => [name, {
      status: result.status,
      provider: result.provider,
      endpoint: result.endpoint,
      observedAt: result.observedAt,
      error: result.status === 'UNAVAILABLE' ? result.error : undefined,
    }]),
  ),
  options: {
    status: options.status,
    provider: options.provider,
    observedAtMs: options.timestampMs,
    ageMs: options.ageMs,
    contractsCount: options.contractsCount,
    qualityPct: options.qualityPct,
  },
  onChainEvidence: {
    status: onChainData.status,
    provider: onChainData.provider,
    coverageStatus: onChainData.coverageStatus ?? 'UNKNOWN',
    observedAtMs: onChainData.timestampMs,
    ageMs: onChainData.ageMs,
    observedOutputCount: onChainData.transactionCount,
    unavailableReason: onChainData.unavailableReason,
    fresh: onChainFresh,
    fieldsValidAndDeduplicated: onChainRecordsValid,
    memberVote: whaleMemberVote.vote,
    memberRationale: whaleMemberVote.rationaleFa,
    memberVerified: onChainMemberVerified,
  },
  councilMemberProbe: {
    note: 'Only the sources listed in this report were fetched live; this probe does not provide a live Freqtrade market snapshot or execute orders.',
    members: memberVotes,
  },
  news: {
    status: news.status,
    headlineCount: news.headlines.length,
    sources: news.sources.map(({ publisher, status, headlineCount, error }) => ({
      publisher,
      status,
      headlineCount,
      ...(error ? { error } : {}),
    })),
  },
};

const ready =
  Object.values(macro).every((result) => result.status === 'LIVE') &&
  options.status === 'LIVE' &&
  onChainMemberVerified &&
  news.status === 'LIVE' &&
  news.headlines.length > 0;

console.log(JSON.stringify({ ready, ...report }, null, 2));
if (!ready) process.exitCode = 1;
