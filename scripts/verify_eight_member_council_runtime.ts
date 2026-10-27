import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AnalysisResult, DataQualityReport, MarketFeedQuality } from '../src/types/trading';
import type { MultiBrainConsensusReport } from '../src/services/multiBrainEnsemble';
import {
  EIGHT_MEMBER_COUNCIL,
  type CouncilMacroContext,
} from '../src/services/eightMemberCouncil';
import {
  evaluateEightMemberCouncilForSnapshot,
  pruneExpiredCouncilRecords,
  runEightMemberCouncilRuntime,
} from '../src/services/eightMemberCouncilRuntime';
import type { SbPentagonOutput } from '../src/services/sbFiveModelsEngine';
import type { SignalToExecutionResult } from '../src/services/signalToExecution';
import type { FreeMacroDataResult, DirectMetricResult } from '../src/services/freeMacroData';
import type { PublicMarketFallbackData } from '../src/services/publicMarketDataFallback';
import type { FreqtradeMarketTrade } from '../src/services/freqtradeMarketDataBridge';
import { getCouncilMemberSources } from '../src/services/councilSourceRegistry';

const nowMs = Date.now();
const sourceTimestampMs = nowMs - 1_000;

async function readLatestJsonLine<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf8');
  const line = content.split('\n').filter(Boolean).at(-1);
  assert.ok(line, `expected JSONL record in ${filePath}`);
  const value: unknown = JSON.parse(line);
  assert.equal(typeof value, 'object');
  assert.ok(value !== null && !Array.isArray(value));
  return value as T;
}

function feed(feedName: string): MarketFeedQuality {
  return {
    feedName,
    source: 'council-runtime-verification',
    status: 'LIVE',
    timestamp: sourceTimestampMs,
    ageMs: 1_000,
    maxAgeMs: 60_000,
    latencyMs: 50,
    score: 95,
    detailsFa: 'verification fixture',
  };
}

function getRecordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

const dataQualityReport: DataQualityReport = {
  overallScore: 95,
  isTradeAllowed: true,
  status: 'LIVE',
  reasonsFa: [],
  feeds: {
    candles: feed('candles'),
    orderBook: feed('orderBook'),
    derivatives: feed('derivatives'),
    futuresPrices: feed('futuresPrices'),
    sentiment: feed('sentiment'),
    orderFlow: feed('orderFlow'),
  },
};

const advisoryModule = {
  status: 'AVAILABLE' as const,
  sourceTimestampMs,
};
const analysis = {
  price: 100,
  direction: 'LONG',
  scoreLong: 80,
  scoreShort: 20,
  candles: Array.from({ length: 30 }, (_, index) => [
    sourceTimestampMs - (29 - index) * 60_000,
    100 + index * 0.1,
    100.2 + index * 0.1,
    99.8 + index * 0.1,
    100 + index * 0.1,
    10,
  ] as [number, number, number, number, number, number]),
  rsi: 60,
  mtf1h: 'BULLISH',
  mtf4h: 'BULLISH',
  ema20: [],
  ema50: [],
  ema200: [],
  macdH: [],
  dataQualityReport,
  orderFlowFeatures: {
    cvdDelta: 500,
    cvdDeltaUsd: 500,
    cvdDivergence: 'NONE',
    takerBuyVol: 800,
    takerSellVol: 300,
    takerRatio: 0.72,
    takerDelta: 500,
    isRealTradeFlow: true,
    status: 'LIVE' as const,
    timestampUtc: sourceTimestampMs,
    ageMs: 1_000,
    source: 'verification-fixture',
  },
  realObiData: {
    obi: 0.2,
    bidDepthUsd: 10_000,
    askDepthUsd: 5_000,
    levelsCount: 20,
    status: 'LIVE' as const,
    timestamp: sourceTimestampMs,
    ageMs: 1_000,
    latencyMs: 50,
    source: 'verification-fixture',
  },
  fundingRate: -0.0003,
  oi: 10_000,
  signalDataTimestamps: {
    fundingRateMs: sourceTimestampMs,
    openInterestMs: sourceTimestampMs,
    mtf1hMs: sourceTimestampMs,
    mtf4hMs: sourceTimestampMs,
  },
  openSourceAdvisories: {
    requestId: 'runtime-test',
    contractVersion: 'sbk1.open-source-advisories.v1' as const,
    generatedAtMs: nowMs,
    sourceTimestampMs,
    status: 'AVAILABLE' as const,
    decisionInfluence: 'ADVISORY_ONLY' as const,
    sourceHeadlines: [
      {
        id: 'verified-headline',
        headline: 'Verified fresh market report',
        publisher: 'Verification source',
        url: 'https://example.invalid/verified-headline',
        publishedAt: new Date(sourceTimestampMs).toISOString(),
      },
      {
        id: 'verified-headline-2',
        headline: 'Verified market update',
        publisher: 'Second verification source',
        url: 'https://example.invalid/verified-headline-2',
        publishedAt: new Date(sourceTimestampMs).toISOString(),
      },
      {
        id: 'verified-headline-3',
        headline: 'Verified policy report',
        publisher: 'Verification source',
        url: 'https://example.invalid/verified-headline-3',
        publishedAt: new Date(sourceTimestampMs).toISOString(),
      },
    ],
    newsHeadlinesRetrievedAtMs: nowMs,
    modules: {
      candlestickPatterns: { ...advisoryModule, matchedPatternCount: 1 },
      marketRegime: { ...advisoryModule, regime: 'TEST' },
      marketAnomaly: { ...advisoryModule, classification: 'WITHIN_TRAINING_DISTRIBUTION' },
      lightgbmForecast: { ...advisoryModule, direction: 'BULLISH' },
      xgboostForecast: { ...advisoryModule, direction: 'BULLISH' },
      newsSentiment: {
        ...advisoryModule,
        aggregateSentiment: 0.25,
        headlines: [
          {
            headline: 'Verified fresh market report',
            publisher: 'Verification source',
            publishedAt: new Date(sourceTimestampMs).toISOString(),
          },
          {
            headline: 'Verified market update',
            publisher: 'Second verification source',
            publishedAt: new Date(sourceTimestampMs).toISOString(),
          },
          {
            headline: 'Verified policy report',
            publisher: 'Verification source',
            publishedAt: new Date(sourceTimestampMs).toISOString(),
          },
        ],
      },
    },
  },
} as unknown as AnalysisResult;

const brainFields = [
  'brain1Macro', 'brain2Liquidity', 'brain3Volatility', 'brain4Pattern',
  'brain5RiskHedging', 'brain6OnChainWhale', 'brain7OrderBookCvd',
  'brain8FundamentalMacro', 'brain9BayesianProbabilistic',
  'brain10AutoPilotHarmonizer', 'brain11OnChainWhaleSentiment',
  'brain12ExecutionSniper', 'brain13MaxProfit', 'brain14LossToBreakeven',
  'brain15FrequencyPreserver', 'brain16DrawdownLockout',
  'brain17RapidTurnaround', 'brain18StagnantLiquidator',
  'brain19LoadReallocator', 'brain20LatencyArbitrage', 'brain21StrategicRecovery',
] as const;
const multiBrainReport = {
  sourceTimestampMs,
  ...Object.fromEntries(brainFields.map((field) => [field, { source: 'runtime-test', value: 1 }])),
  brain1Macro: { rawEvidenceScore: 60, hurstExponent: 0.6, mtfAlignmentScore: 75 },
  brain2Liquidity: { obiValue: 0.2, liquidityPoolUsd: 1_000 },
  brain3Volatility: { garchRegime: 'NORMAL', volatilityForecastPct: 1.2 },
  brain4Pattern: { patternMatchPct: 65, matchedPatternName: 'verification pattern' },
  historicalCandleResearch: {
    status: 'AVAILABLE',
    source: 'verified-live-exchange-candles',
    exchange: 'bybit',
    market: 'futures',
    pair: 'BTC/USDT:USDT',
    timeframe: '1m',
    candleCount: 500,
    trainingCandleCount: 350,
    testCandleCount: 150,
    trainingCutoffTimestampMs: sourceTimestampMs - 150 * 60_000,
    similarityThresholdPct: 85,
    contextSimilarityWeightPct: 30,
    requiredReferenceMatches: 3,
    minimumOutOfSampleForecasts: 20,
    costs: {
      configured: true,
      takerFeeBpsPerSide: 5,
      slippageBpsPerSide: 2,
      roundTripPercent: 0.14,
    },
    horizons: Object.fromEntries([7, 15, 30, 60].map((horizonMinutes) => [horizonMinutes, {
      horizonMinutes,
      actualHorizonMinutes: horizonMinutes,
      available: true,
      outOfSampleForecastCount: 25,
      forecastsWithEnoughMatches: 24,
      minimumForecastsForMetrics: 20,
      averageReferenceMatches: 4,
      meanSimilarityPct: 90,
      grossDirectionAccuracyPct: 60,
      meanGrossPredictedReturnPct: 0.1,
      grossWinRatePct: 60,
      meanNetPredictedReturnPct: 0.04,
      netWinRatePct: 56,
      netWinCount: 14,
      meanMaximumFavorableMovePct: 0.2,
      meanMaximumAdverseMovePct: 0.1,
      meanCostAdjustedRewardRiskRatio: 1.2,
    }])),
    tradeEligible: false,
    note: 'verification research only',
  },
  brain5RiskHedging: { floatingSystemHarmonized: null },
  brain6OnChainWhale: { netflowBtc24h: -12, whaleSentiment: 'ACCUMULATION' },
  brain7OrderBookCvd: {
    isEmpiricalMetric: true,
    isLiveMeasured: true,
    realCvdDeltaBtc: 500,
  },
  brain8FundamentalMacro: { newsOscillatorScore: 50 },
  brain9BayesianProbabilistic: { calibratedProbabilityPct: null, confidenceIntervalWidthPct: 10 },
  brain10AutoPilotHarmonizer: { feeBufferCovered: null, riskProtectionEscapeSpeedMs: null },
} as unknown as MultiBrainConsensusReport;

const sbReport = {
  models: ['SB1', 'SB2', 'SB3', 'SB4', 'SB5'].map((id) => ({
    id,
    status: 'ACTIVE',
    liveDirectiveFa: 'Verification output',
  })),
} as unknown as SbPentagonOutput;
const pillars = { breakdown: [] } as unknown as SignalToExecutionResult;
const macroContext: CouncilMacroContext = {
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
};
function macroMetric(metric: string, value: number): DirectMetricResult {
  return {
    status: 'LIVE',
    provider: 'verification-provider',
    endpoint: 'https://example.invalid/metric',
    metric,
    value,
    previousValue: value - 1,
    changePct: 0.1,
    observedAt: new Date(sourceTimestampMs).toISOString(),
    observedAtMs: sourceTimestampMs,
    retrievedAtMs: nowMs,
    latencyMs: 10,
    ageMs: 1_000,
  };
}
const freeMacroData: FreeMacroDataResult = {
  sp500: macroMetric('sp500', 5000),
  dxy: {
    ...macroMetric('dxy', 105),
    status: 'UNAVAILABLE',
    value: null,
    previousValue: null,
    changePct: null,
    observedAt: null,
    observedAtMs: null,
    retrievedAtMs: null,
    latencyMs: null,
    ageMs: null,
    error: 'No verification API key configured.',
  },
  dxyProxy: {
    ...macroMetric('tradingview-dxy-proxy', 105),
    provider: 'TradingView public Scanner (TVC:DXY CFD; upstream observation timestamp unavailable)',
    metric: 'TradingView TVC:DXY CFD proxy (not official ICE DXY; retrieval time only)',
    changePct: -0.2,
  },
  broadDollar: {
    ...macroMetric('broad-dollar-proxy', 120),
    observedAt: new Date(nowMs - 2 * 24 * 60 * 60_000).toISOString(),
    observedAtMs: nowMs - 2 * 24 * 60 * 60_000,
    ageMs: 2 * 24 * 60 * 60_000,
    changePct: -0.2,
  },
  fedEffectiveRate: { ...macroMetric('fed-effective-rate', 5), previousValue: 5 },
  fedTargetUpperBound: { ...macroMetric('fed-target-upper-bound', 5.5), previousValue: 5.5 },
  bitcoinActiveAddresses: macroMetric('bitcoin-active-addresses', 500_000),
};

const repositoryDir = await mkdtemp(path.join(os.tmpdir(), 'sbk1-council-runtime-'));
const memberTwoRepositoryDir = await mkdtemp(path.join(os.tmpdir(), 'sbk1-council-member-02-'));
try {
  const report = await runEightMemberCouncilRuntime({
    analysis,
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData,
    repositoryDir,
    nowMs,
  });

  assert.equal(report.members.length, 8);
  assert.equal(report.members[7].vote, 'LONG');
  assert.deepEqual(
    (await readdir(repositoryDir)).filter((name) => name.startsWith('member-')).sort(),
    EIGHT_MEMBER_COUNCIL.map(({ id }) => `member-${String(id).padStart(2, '0')}.jsonl`).sort(),
  );

  const technicalMember = JSON.parse(await readFile(path.join(repositoryDir, 'member-01.jsonl'), 'utf8').then((value) => value.trim()));
  assert.equal(technicalMember.memberId, 1);
  assert.equal(technicalMember.moduleOutputs.some(
    (item: { moduleId: string }) => item.moduleId === 'control.holdingHorizonSelector',
  ), false, 'central holding-horizon selection must not be assigned to a voting member');
  assert.equal(technicalMember.moduleOutputs.some(
    (item: { moduleId: string }) => item.moduleId === 'technical.historicalCandleResearch',
  ), false, 'central candle research must not be delivered as member 1 voting evidence');
  assert.equal(
    technicalMember.sourceData.peerCouncilSummary.length,
    EIGHT_MEMBER_COUNCIL.length,
    'each member record should include a timestamped summary of all peer votes without changing independent evaluation',
  );
  assert.deepEqual(
    technicalMember.sourceData.peerCouncilSummary.map((peer: { memberId: number }) => peer.memberId),
    EIGHT_MEMBER_COUNCIL.map(({ id }) => id),
  );
  assert.match(technicalMember.evidenceFingerprint, /^[a-f0-9]{64}$/);

  const memberTwoTrade: FreqtradeMarketTrade = {
    timestampMs: sourceTimestampMs,
    side: 'buy',
    price: 100,
    amount: 1,
    venue: 'binance',
    symbol: 'BTCUSDT',
    tradeId: 9001,
  };
  const marketFallbackWithTrades = (trades: FreqtradeMarketTrade[]): PublicMarketFallbackData => {
    const unavailable = <T,>() => ({
      status: 'UNAVAILABLE' as const,
      sourceTimestampMs: null,
      value: null as T | null,
      error: 'Not used in this member-2 fixture.',
    });
    return {
      provider: 'Binance public REST API',
      venue: 'binance',
      market: 'futures',
      pair: 'BTC/USDT:USDT',
      timeframe: '1m',
      retrievedAtMs: nowMs,
      exchangeQuotes: unavailable(),
      exchangeQuoteSources: [],
      candles: unavailable(),
      fastCandles: unavailable(),
      higherTimeframeCandles: {
        '1h': unavailable(),
        '4h': unavailable(),
      },
      orderBook: unavailable(),
      tradeFlow: {
        status: 'LIVE',
        sourceTimestampMs,
        value: { retrievedAtMs: nowMs, trades },
      },
      fundingRate: unavailable(),
      openInterest: unavailable(),
      liveOpenInterest: unavailable(),
    };
  };
  const memberTwoBaseReport = await runEightMemberCouncilRuntime({
    analysis,
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData,
    publicMarketFallback: marketFallbackWithTrades([memberTwoTrade]),
    repositoryDir: memberTwoRepositoryDir,
    nowMs,
  });
  const memberTwoBaseRecord = await readLatestJsonLine<{ evidenceFingerprint: string }>(
    path.join(memberTwoRepositoryDir, 'member-02.jsonl'),
  );
  const memberTwoDuplicateReport = await runEightMemberCouncilRuntime({
    analysis,
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData,
    publicMarketFallback: marketFallbackWithTrades([memberTwoTrade, memberTwoTrade]),
    repositoryDir: memberTwoRepositoryDir,
    nowMs: nowMs + 1_000,
  });
  assert.equal(memberTwoDuplicateReport.members[1].vote, memberTwoBaseReport.members[1].vote);
  assert.equal(
    (await readLatestJsonLine<{ evidenceFingerprint: string }>(
      path.join(memberTwoRepositoryDir, 'member-02.jsonl'),
    )).evidenceFingerprint,
    memberTwoBaseRecord.evidenceFingerprint,
    'member 2 fingerprint must use unique trade ids rather than repeated trade rows',
  );
  const memberTwoRecord = await readLatestJsonLine<{
    sourceData: { marketFallback: { feed: { observationCount: number } } };
  }>(path.join(memberTwoRepositoryDir, 'member-02.jsonl'));
  assert.equal(memberTwoRecord.sourceData.marketFallback.feed.observationCount, 1);
  const technicalRecordCount = (await readFile(path.join(repositoryDir, 'member-01.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).length;
  const repeatedSnapshot = await runEightMemberCouncilRuntime({
    analysis,
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData,
    repositoryDir,
    nowMs: nowMs + 1_000,
  });
  assert.equal(repeatedSnapshot.members[0].vote, report.members[0].vote);
  assert.equal(
    repeatedSnapshot.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'فیلتر داده تکراری')?.passed,
    true,
    'an identical fresh per-member evidence snapshot must reuse its previous vote without reevaluation',
  );
  assert.match(repeatedSnapshot.members[0].rationaleFa, /رأی قبلی بدون تحلیل مجدد استفاده شد/);
  assert.equal(
    (await readFile(path.join(repositoryDir, 'member-01.jsonl'), 'utf8')).split('\n').filter(Boolean).length,
    technicalRecordCount,
    'identical member evidence must not create duplicate member-analysis records',
  );
  const newsRecordCount = (await readFile(path.join(repositoryDir, 'member-08.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).length;
  const baselineFingerprints = new Map<number, string>();
  for (const memberId of [1, 3, 4, 7, 8]) {
    const record = await readLatestJsonLine<{ evidenceFingerprint: string }>(
      path.join(repositoryDir, `member-${String(memberId).padStart(2, '0')}.jsonl`),
    );
    baselineFingerprints.set(memberId, record.evidenceFingerprint);
  }
  const duplicateEvidenceSnapshot = await runEightMemberCouncilRuntime({
    analysis: {
      ...analysis,
      candles: [...analysis.candles, analysis.candles.at(-1)!],
      openSourceAdvisories: {
        ...analysis.openSourceAdvisories!,
        sourceHeadlines: [
          ...analysis.openSourceAdvisories!.sourceHeadlines!,
          {
            ...analysis.openSourceAdvisories!.sourceHeadlines![0],
            id: 'duplicate-syndicated-headline',
            url: 'https://different.example.invalid/same-story',
          },
        ],
      },
    },
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData,
    repositoryDir,
    nowMs: nowMs + 2_000,
  });
  for (const memberId of [1, 8]) {
    assert.equal(
      duplicateEvidenceSnapshot.members[memberId - 1].qualityChecks.find(
        ({ labelFa }) => labelFa === 'فیلتر داده تکراری',
      )?.passed,
      true,
      `member ${memberId} must fingerprint the unique evidence rather than repeated input rows`,
    );
  }
  for (const memberId of [1, 8]) {
    const record = await readLatestJsonLine<{ evidenceFingerprint: string }>(
      path.join(repositoryDir, `member-${String(memberId).padStart(2, '0')}.jsonl`),
    );
    assert.equal(record.evidenceFingerprint, baselineFingerprints.get(memberId));
  }
  assert.equal(
    (await readFile(path.join(repositoryDir, 'member-08.jsonl'), 'utf8')).split('\n').filter(Boolean).length,
    newsRecordCount,
    'a syndicated copy of an existing headline must not trigger duplicate member-8 analysis or persistence',
  );
  const duplicateTelemetrySnapshot = await runEightMemberCouncilRuntime({
    analysis: {
      ...analysis,
      realObiData: { ...analysis.realObiData, duplicateSnapshotCount: 1 },
      dataQualityReport: {
        ...analysis.dataQualityReport,
        feeds: {
          ...analysis.dataQualityReport.feeds,
          derivatives: {
            ...analysis.dataQualityReport.feeds.derivatives,
            duplicateCount: 1,
          } as MarketFeedQuality & { duplicateCount: number },
        },
      },
    },
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData: {
      ...freeMacroData,
      sp500: {
        ...freeMacroData.sp500,
        duplicateCount: 1,
      } as DirectMetricResult & { duplicateCount: number },
    },
    repositoryDir,
    nowMs: nowMs + 3_000,
  });
  for (const memberId of [3, 4, 7]) {
    const record = await readLatestJsonLine<{ evidenceFingerprint: string }>(
      path.join(repositoryDir, `member-${String(memberId).padStart(2, '0')}.jsonl`),
    );
    assert.equal(
      record.evidenceFingerprint,
      baselineFingerprints.get(memberId),
      `member ${memberId} fingerprint must ignore duplicate-count telemetry while retaining normalized evidence`,
    );
    assert.equal(duplicateTelemetrySnapshot.members[memberId - 1].vote, report.members[memberId - 1].vote);
  }
  const expiredDuplicate = await runEightMemberCouncilRuntime({
    analysis,
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData,
    repositoryDir,
    nowMs: nowMs + 66_000,
  });
  assert.equal(expiredDuplicate.members[0].vote, 'ABSTAIN');
  assert.equal(
    expiredDuplicate.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'فیلتر داده تکراری'),
    undefined,
    'an expired duplicate must be reevaluated and abstain under the existing candle freshness limit',
  );
  const technicalAdvisoryIds = [
    'openSource.candlestickPatterns',
    'openSource.marketRegime',
    'openSource.marketAnomaly',
    'openSource.lightgbmForecast',
    'openSource.xgboostForecast',
  ];
  for (const moduleId of technicalAdvisoryIds) {
    const evidence = technicalMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === moduleId);
    assert.equal(evidence.status, 'AVAILABLE', `${moduleId} should be attached to member 1`);
    assert.equal(typeof evidence.output, 'object', `${moduleId} result should be persisted as supporting evidence`);
  }
  const staleTechnicalAnalysis: AnalysisResult = {
    ...analysis,
    openSourceAdvisories: {
      ...analysis.openSourceAdvisories!,
      modules: {
        ...analysis.openSourceAdvisories!.modules,
        lightgbmForecast: {
          ...analysis.openSourceAdvisories!.modules.lightgbmForecast,
          sourceTimestampMs: sourceTimestampMs - 60_000,
        },
      },
    },
  };
  const staleTechnicalCouncil = await runEightMemberCouncilRuntime({
    analysis: staleTechnicalAnalysis,
    multiBrainReport,
    sbReport,
    macroContext,
    repositoryDir: path.join(repositoryDir, 'stale-advisory'),
    nowMs,
  });
  assert.notEqual(staleTechnicalCouncil.members[0].supportingEvidence.find(
    (item) => item.moduleId === 'openSource.lightgbmForecast',
  )?.status, 'AVAILABLE', 'advisory output for a different candle must not appear as current evidence');
  assert.equal(technicalMember.moduleOutputs.some((item: { moduleId: string }) => item.moduleId === 'openSource.newsSentiment'), false);
  assert.equal(technicalMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'brains.brain01MacroTrend').status, 'AVAILABLE');
  assert.equal(technicalMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'brains.brain09BayesianProbabilistic').status, 'UNAVAILABLE');

  const bearishSentimentAnalysis: AnalysisResult = {
    ...analysis,
    openSourceAdvisories: {
      ...analysis.openSourceAdvisories!,
      modules: {
        ...analysis.openSourceAdvisories!.modules,
        newsSentiment: {
          ...analysis.openSourceAdvisories!.modules.newsSentiment,
          aggregateSentiment: -0.25,
        },
      },
    },
  };
  const bearishSentimentCouncil = evaluateEightMemberCouncilForSnapshot({
    analysis: bearishSentimentAnalysis,
    macroContext,
    nowMs,
  });
  assert.equal(bearishSentimentCouncil.members[7].vote, 'SHORT');
  assert.equal(
    bearishSentimentCouncil.members[0].vote,
    report.members[0].vote,
    'unvalidated technical advisory outputs remain evidence and do not silently alter member 1 vote',
  );
  const unavailableSentimentAnalysis: AnalysisResult = {
    ...analysis,
    openSourceAdvisories: {
      ...analysis.openSourceAdvisories!,
      status: 'PARTIAL',
      modules: {
        ...analysis.openSourceAdvisories!.modules,
        newsSentiment: {
          ...analysis.openSourceAdvisories!.modules.newsSentiment,
          status: 'UNAVAILABLE',
          aggregateSentiment: undefined,
          headlines: undefined,
        },
      },
    },
  };
  const staleBaseSentimentCouncil = evaluateEightMemberCouncilForSnapshot({
    analysis: unavailableSentimentAnalysis,
    macroContext: {
      ...macroContext,
      lastUpdatedTime: sourceTimestampMs,
      newsSentimentStatus: 'LIVE',
      newsSentimentScore: 50,
      newsHeadlinesStatus: 'LIVE',
      recentHeadlines: [
        {
          id: 'unrelated-base-headline',
          headline: 'Unrelated cached headline',
          source: 'Cached source',
          url: 'https://example.invalid/cached-headline',
          publishedAt: new Date(sourceTimestampMs).toISOString(),
        },
        {
          id: 'unrelated-base-headline-2',
          headline: 'Another unrelated cached headline',
          source: 'Another cached source',
          url: 'https://example.invalid/cached-headline-2',
          publishedAt: new Date(sourceTimestampMs).toISOString(),
        },
        {
          id: 'unrelated-base-headline-3',
          headline: 'Third unrelated cached headline',
          source: 'Cached source',
          url: 'https://example.invalid/cached-headline-3',
          publishedAt: new Date(sourceTimestampMs).toISOString(),
        },
      ],
    },
    nowMs,
  });
  assert.equal(
    staleBaseSentimentCouncil.members[7].vote,
    'ABSTAIN',
    'fresh advisory headlines without a successful matching sentiment score must not reuse a cached score',
  );

  const newsMember = await readLatestJsonLine<{
    moduleOutputs: Array<{ moduleId: string; status: string }>;
    sourceData: { newsSentimentScore: number; recentHeadlines: Array<{ url: string }> };
  }>(path.join(repositoryDir, 'member-08.jsonl'));
  assert.equal(typeof report.members[7].dataQualityPct, 'number',
    'member 8 quality must be calculated rather than serialized as null');
  assert.ok(report.members[7].dataQualityPct! >= 0 && report.members[7].dataQualityPct! <= 100);
  assert.equal(newsMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'openSource.newsSentiment').status, 'AVAILABLE');
  assert.equal('output' in newsMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'openSource.newsSentiment'), false);
  assert.equal(newsMember.sourceData.newsSentimentScore, 25);
  assert.equal(newsMember.sourceData.recentHeadlines[0].url, 'https://example.invalid/verified-headline');

  const onchainMember = await readLatestJsonLine<{
    moduleOutputs: Array<{ moduleId: string; status: string }>;
    vote: string;
  }>(path.join(repositoryDir, 'member-06.jsonl'));
  assert.equal(onchainMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'onchain.bitcoinActiveAddresses').status, 'AVAILABLE');
  assert.equal('output' in onchainMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'onchain.bitcoinActiveAddresses'), false);
  assert.equal(onchainMember.vote, 'ABSTAIN');

  const macroMember = await readLatestJsonLine<{
    vote: string;
    rationaleFa: string;
    moduleOutputs: Array<{
      moduleId: string;
      status: string;
      summaryFa: string;
      sourceTimestampMs: number | null;
    }>;
  }>(path.join(repositoryDir, 'member-07.jsonl'));
  assert.equal(macroMember.vote, 'LONG', 'member 7 must use the fresh direct macro sources provided to the server runtime');
  assert.equal(report.members[6].dataQualityPct, 100,
    'member 7 quality must reflect its three available macro source groups');
  assert.match(macroMember.rationaleFa, /TradingView TVC:DXY/);
  assert.match(macroMember.rationaleFa, /CFD proxy/);
  assert.equal(macroMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'macro.broadDollarProxy').status, 'AVAILABLE');
  assert.equal(macroMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'macro.dxy').status, 'UNAVAILABLE');
  assert.equal(macroMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'macro.tradingViewDxyProxy').status, 'AVAILABLE');
  assert.match(macroMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'macro.tradingViewDxyProxy').summaryFa, /CFD proxy/);
  assert.equal('output' in macroMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'macro.broadDollarProxy'), false);
  assert.match(macroMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'macro.broadDollarProxy').summaryFa, /proxy/);
  assert.equal(
    macroMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'macro.broadDollarProxy').sourceTimestampMs,
    nowMs - 2 * 24 * 60 * 60_000,
    'fresh daily macro observations remain available when their observation time differs from the candle snapshot',
  );

  const councilRecord = await readLatestJsonLine<{
    coordinator: { moduleId: string; excludedFromMemberVotes: boolean };
  }>(path.join(repositoryDir, 'council-votes.jsonl'));
  assert.equal(councilRecord.coordinator.moduleId, 'sb.SB5');
  assert.equal(councilRecord.coordinator.excludedFromMemberVotes, true);

  const connectedSourcesDir = path.join(repositoryDir, 'connected-sources');
  const connectedDuplicateDir = path.join(repositoryDir, 'connected-duplicates');
  const connectedOptionsData = {
    status: 'LIVE' as const,
    provider: 'Deribit public options API',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 100,
    contractsCount: 24,
    impliedVolatilityPct: 50,
    putCallRatio: 1,
    expiryTimestampMs: nowMs + 15 * 24 * 60 * 60_000,
    strikePrice: 100_000,
    skewPct: 2,
  };
  const connectedTransfers = [{
    transactionHash: 'test-tx',
    blockchain: 'bitcoin',
    blockHeight: 900_000,
    timestampMs: nowMs - 1_000,
    sourceProvider: 'mempool.space',
    asset: 'BTC',
    amount: 12,
    estimatedUsd: null,
    confirmationStatus: 'CONFIRMED' as const,
    transferId: 'vout:0',
  }];
  const connectedWhaleFlowData = {
    status: 'LIVE' as const,
    provider: 'mempool.space public REST API (sampled confirmed BTC outputs)',
    sourceId: 'onchain.mempool-blocks',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 85,
    coverageStatus: 'SAMPLED' as const,
    largeTransfers: connectedTransfers,
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 1,
    windowStartHeight: 899_989,
    windowEndHeight: 900_000,
  };
  const connectedSourcesReport = await runEightMemberCouncilRuntime({
    analysis,
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData,
    optionsData: connectedOptionsData,
    whaleFlowData: connectedWhaleFlowData,
    decisionSnapshotTimestampMs: sourceTimestampMs,
    repositoryDir: connectedSourcesDir,
    nowMs,
  });
  assert.equal(connectedSourcesReport.members.length, 8);
  const connectedFiveBaseline = await readLatestJsonLine<{ evidenceFingerprint: string }>(
    path.join(connectedSourcesDir, 'member-05.jsonl'),
  );
  const connectedSixBaseline = await readLatestJsonLine<{ evidenceFingerprint: string }>(
    path.join(connectedSourcesDir, 'member-06.jsonl'),
  );
  const duplicatedConnectedReport = await runEightMemberCouncilRuntime({
    analysis,
    multiBrainReport,
    sbReport,
    pillars,
    macroContext,
    freeMacroData,
    optionsData: Object.assign({}, connectedOptionsData, { duplicateCount: 1 }),
    whaleFlowData: {
      ...connectedWhaleFlowData,
      largeTransfers: [...connectedTransfers, { ...connectedTransfers[0], sourceProvider: 'mirror' }],
    },
    decisionSnapshotTimestampMs: sourceTimestampMs,
    repositoryDir: connectedDuplicateDir,
    nowMs: nowMs + 1_000,
  });
  assert.equal(duplicatedConnectedReport.members[4].vote, connectedSourcesReport.members[4].vote);
  assert.equal(duplicatedConnectedReport.members[5].vote, connectedSourcesReport.members[5].vote);
  assert.equal(
    (await readLatestJsonLine<{ evidenceFingerprint: string }>(
      path.join(connectedDuplicateDir, 'member-05.jsonl'),
    )).evidenceFingerprint,
    connectedFiveBaseline.evidenceFingerprint,
    'member 5 fingerprint must remain stable when duplicate-option telemetry is added after option normalization',
  );
  assert.equal(
    (await readLatestJsonLine<{ evidenceFingerprint: string }>(
      path.join(connectedDuplicateDir, 'member-06.jsonl'),
    )).evidenceFingerprint,
    connectedSixBaseline.evidenceFingerprint,
    'member 6 fingerprint must use unique transaction outputs across providers',
  );
  const expectedConnectedVotes = [
    'LONG',
    'LONG',
    'LONG',
    'LONG',
    'NEUTRAL',
    'NEUTRAL',
    'LONG',
    'LONG',
  ];
  assert.deepEqual(
    connectedSourcesReport.members.map(({ vote }) => vote),
    expectedConnectedVotes,
    'all eight votes must follow their specialized fixture evidence',
  );
  const connectedVoteRecord = await readLatestJsonLine<{
    coordinator: { moduleId: string; excludedFromMemberVotes: boolean };
    report: { members: Array<{ id: number; vote: string }>; quorumRequired: number };
    snapshotId: string;
  }>(path.join(connectedSourcesDir, 'council-votes.jsonl'));
  const connectedMemberRecords = new Map<number, {
    snapshotId: string;
    memberId: number;
    vote: string;
    rationaleFa: string;
    sourceData: Record<string, unknown>;
    moduleOutputs: Array<{ moduleId: string; status: string; sourceTimestampMs: number | null }>;
  }>();
  for (const member of connectedSourcesReport.members) {
    const memberRecord = await readLatestJsonLine<{
      snapshotId: string;
      memberId: number;
      vote: string;
      rationaleFa: string;
      sourceData: Record<string, unknown>;
      moduleOutputs: Array<{ moduleId: string; status: string; sourceTimestampMs: number | null }>;
    }>(path.join(connectedSourcesDir, `member-${String(member.id).padStart(2, '0')}.jsonl`));
    assert.equal(memberRecord.memberId, member.id);
    assert.equal(memberRecord.snapshotId, connectedVoteRecord.snapshotId);
    assert.equal(memberRecord.vote, member.vote);
    assert.equal(
      connectedVoteRecord.report.members.find(({ id }: { id: number }) => id === member.id)?.vote,
      member.vote,
    );
    connectedMemberRecords.set(member.id, memberRecord);
  }
  assert.equal(connectedVoteRecord.report.quorumRequired, 5);
  assert.match(connectedMemberRecords.get(1)!.rationaleFa, /تحلیل محلی کندل/);
  assert.match(connectedMemberRecords.get(1)!.rationaleFa, /امتیاز عمومی LONG\/SHORT در رأی استفاده نشد/);
  assert.match(connectedMemberRecords.get(2)!.rationaleFa, /دلتا\/CVD واقعی/);
  assert.equal(getRecordField(connectedMemberRecords.get(2)!.sourceData, 'orderFlow').cvdDeltaUsd, 500);
  assert.match(connectedMemberRecords.get(3)!.rationaleFa, /OBI زنده/);
  assert.equal(getRecordField(connectedMemberRecords.get(3)!.sourceData, 'orderBook').obi, 0.2);
  assert.match(connectedMemberRecords.get(4)!.rationaleFa, /Funding/);
  assert.equal(connectedMemberRecords.get(4)!.sourceData.fundingRate, -0.0003);
  assert.equal(connectedMemberRecords.get(4)!.sourceData.openInterest, 10_000);
  assert.match(connectedMemberRecords.get(5)!.rationaleFa, /نسبت OI اختیار/);
  assert.equal(getRecordField(connectedMemberRecords.get(5)!.sourceData, 'optionsData').provider, 'Deribit public options API');
  assert.match(connectedMemberRecords.get(6)!.rationaleFa, /تراکنش بزرگ bitcoin/);
  const onChainEvidence = getRecordField(connectedMemberRecords.get(6)!.sourceData, 'publicOnChainData');
  assert.ok(Array.isArray(onChainEvidence.largeTransfers));
  assert.equal(onChainEvidence.largeTransfers.length, 1);
  assert.match(connectedMemberRecords.get(7)!.rationaleFa, /شاخص مستقیم و تازه/);
  assert.deepEqual(getRecordField(connectedMemberRecords.get(7)!.sourceData, 'directSources').sp500, freeMacroData.sp500);
  assert.match(connectedMemberRecords.get(8)!.rationaleFa, /امتیاز سنتیمنت خبر معتبر/);
  assert.equal(connectedMemberRecords.get(8)!.sourceData.newsSentimentScore, 25);
  for (const [memberId, moduleId] of [
    [1, 'openSource.candlestickPatterns'],
    [2, 'brains.brain07OrderBookCvd'],
    [3, 'brains.brain02LiquidityFlow'],
    [4, 'brains.brain03GarchVolatility'],
    [5, 'options.deribitPublicOptions'],
    [6, 'onchain.bitcoinPublicTransfers'],
    [7, 'macro.sp500'],
    [8, 'openSource.newsSentiment'],
  ] as const) {
    const evidence = connectedMemberRecords.get(memberId)!.moduleOutputs.find(
      (item) => item.moduleId === moduleId,
    );
    assert.equal(evidence?.status, 'AVAILABLE', `member ${memberId} must store ${moduleId} evidence`);
    assert.equal(evidence?.sourceTimestampMs, sourceTimestampMs);
    assert.ok(evidence!.sourceTimestampMs! <= nowMs, `member ${memberId} evidence must not come from the future`);
    assert.ok(nowMs - evidence!.sourceTimestampMs! <= 5 * 60_000, `member ${memberId} evidence must be fresh`);
  }
  const optionsMember = JSON.parse(
    await readFile(path.join(connectedSourcesDir, 'member-05.jsonl'), 'utf8').then((value) => value.trim()),
  );
  assert.equal(optionsMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'options.deribitPublicOptions').status, 'AVAILABLE');
  assert.equal('output' in optionsMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'options.deribitPublicOptions'), false);
  assert.equal(optionsMember.sourceData.optionsData.provider, 'Deribit public options API');
  const whaleMember = JSON.parse(
    await readFile(path.join(connectedSourcesDir, 'member-06.jsonl'), 'utf8').then((value) => value.trim()),
  );
  assert.equal(whaleMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'onchain.bitcoinPublicTransfers').status, 'AVAILABLE');
  assert.equal('output' in whaleMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'onchain.bitcoinPublicTransfers'), false);
  assert.equal(whaleMember.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'onchain.assetPublicTransfers').status, 'AVAILABLE');
  assert.equal(whaleMember.sourceData.publicOnChainData.provider, 'mempool.space public REST API (sampled confirmed BTC outputs)');
  assert.equal(whaleMember.sourceData.publicOnChainData.sourceId, 'onchain.mempool-blocks');
  assert.equal(whaleMember.vote, 'NEUTRAL');

  const pairRoomsRoot = path.join(repositoryDir, 'pair-rooms');
  const btcPair = 'BTC/USDT:USDT';
  const ethPair = 'ETH/USDT:USDT';
  await runEightMemberCouncilRuntime({
    pair: btcPair,
    analysis: { ...analysis, openSourceAdvisories: undefined },
    multiBrainReport,
    sbReport,
    macroContext,
    optionsData: { ...connectedOptionsData, pair: btcPair, asset: 'BTC' },
    whaleFlowData: { ...connectedWhaleFlowData, pair: btcPair, asset: 'BTC' },
    decisionSnapshotTimestampMs: sourceTimestampMs,
    repositoryDir: pairRoomsRoot,
    nowMs,
  });
  const ethRoomReport = await runEightMemberCouncilRuntime({
    pair: ethPair,
    analysis,
    multiBrainReport,
    sbReport,
    macroContext,
    optionsData: { ...connectedOptionsData, pair: btcPair, asset: 'BTC' },
    whaleFlowData: { ...connectedWhaleFlowData, pair: btcPair, asset: 'BTC' },
    decisionSnapshotTimestampMs: sourceTimestampMs,
    repositoryDir: pairRoomsRoot,
    nowMs,
  });
  assert.equal(ethRoomReport.members[4].vote, 'ABSTAIN');
  assert.equal(ethRoomReport.members[5].vote, 'ABSTAIN');
  const memberFiveSources = getCouncilMemberSources(5);
  const runMemberFiveHealthScenario = async (healthyCount: number, scenarioName: string) =>
    runEightMemberCouncilRuntime({
      pair: ethPair,
      analysis,
      multiBrainReport,
      sbReport,
      macroContext,
      optionsData: { ...connectedOptionsData, pair: ethPair, asset: 'ETH' },
      whaleFlowData: { ...connectedWhaleFlowData, pair: ethPair, asset: 'ETH' },
      memberSourceChecks: {
        5: memberFiveSources.map((source, index) => ({
          sourceId: source.id,
          status: index < healthyCount ? 'HEALTHY' : 'BROKEN',
          detail: index < healthyCount ? 'Simulated live endpoint response.' : 'Simulated endpoint failure.',
          dataValid: index < healthyCount,
          observedAtMs: index < healthyCount ? sourceTimestampMs : null,
          normalizedData: index < healthyCount ? { putCallOpenInterestRatio: 1 } : {},
        })),
      },
      decisionSnapshotTimestampMs: sourceTimestampMs,
      repositoryDir: path.join(pairRoomsRoot, `health-${scenarioName}`),
      nowMs,
    });
  const fourHealthySourcesReport = await runMemberFiveHealthScenario(4, 'four');
  const twoHealthySourcesReport = await runMemberFiveHealthScenario(2, 'two');
  const oneHealthySourceReport = await runMemberFiveHealthScenario(1, 'one');
  assert.notEqual(fourHealthySourcesReport.members[4].vote, 'ABSTAIN',
    'the full runtime keeps a valid vote with four healthy member sources');
  assert.equal(fourHealthySourcesReport.members[4].healthySourceCount, 4);
  assert.notEqual(twoHealthySourcesReport.members[4].vote, 'ABSTAIN',
    'the full runtime keeps a valid vote with exactly two healthy member sources');
  assert.equal(twoHealthySourcesReport.members[4].healthySourceCount, 2);
  assert.equal(oneHealthySourceReport.members[4].vote, 'ABSTAIN',
    'the full runtime abstains with only one healthy member source');
  assert.equal(oneHealthySourceReport.members[4].healthySourceCount, 1);
  assert.equal(oneHealthySourceReport.members[4].sourceId, memberFiveSources[0].id,
    'the vote must retain the source that produced its evidence even when quorum forces abstention');
  const fallbackSourceReport = await runEightMemberCouncilRuntime({
    pair: ethPair,
    analysis,
    multiBrainReport,
    sbReport,
    macroContext,
    optionsData: {
      ...connectedOptionsData,
      provider: 'OKX public options API',
      pair: ethPair,
      asset: 'ETH',
    },
    whaleFlowData: { ...connectedWhaleFlowData, pair: ethPair, asset: 'ETH' },
    memberSourceChecks: {
      5: memberFiveSources.map((source, index) => ({
        sourceId: source.id,
        status: index === 1 || index === 2 ? 'HEALTHY' : 'BROKEN',
        detail: index === 1 || index === 2 ? 'Simulated live endpoint response.' : 'Simulated endpoint failure.',
        dataValid: index === 1 || index === 2,
        observedAtMs: index === 1 || index === 2 ? sourceTimestampMs : null,
        normalizedData: index === 1 || index === 2 ? { putCallOpenInterestRatio: 1 } : {},
      })),
    },
    decisionSnapshotTimestampMs: sourceTimestampMs,
    repositoryDir: path.join(pairRoomsRoot, 'health-fallback'),
    nowMs,
  });
  assert.equal(fallbackSourceReport.members[4].healthySourceCount, 2);
  assert.equal(fallbackSourceReport.members[4].sourceId, memberFiveSources[1].id);
  assert.equal(fallbackSourceReport.members[4].fallbackSourceId, memberFiveSources[1].id,
    'a healthy lower-priority provider is recorded as the used fallback when the primary is broken');
  const btcRoomMember = await readLatestJsonLine<{ sourceData: Record<string, unknown> }>(
    path.join(pairRoomsRoot, 'BTC_USDT_USDT', 'member-05.jsonl'),
  );
  const ethRoomMember = await readLatestJsonLine<{ sourceData: Record<string, unknown> }>(
    path.join(pairRoomsRoot, 'ETH_USDT_USDT', 'member-05.jsonl'),
  );
  const ethRoomNewsMember = await readLatestJsonLine<{
    moduleOutputs: Array<{ moduleId: string; status: string }>;
  }>(path.join(pairRoomsRoot, 'ETH_USDT_USDT', 'member-08.jsonl'));
  assert.equal((btcRoomMember.sourceData.optionsData as { pair: string }).pair, btcPair);
  assert.equal(ethRoomMember.sourceData.optionsData, null);
  assert.equal(
    ethRoomNewsMember.moduleOutputs.find(({ moduleId }) => moduleId === 'openSource.newsSentiment')?.status,
    'UNAVAILABLE',
    'a report without the target pair identity cannot enter that room',
  );
  assert.notEqual(
    path.join(pairRoomsRoot, 'BTC_USDT_USDT', 'member-05.jsonl'),
    path.join(pairRoomsRoot, 'ETH_USDT_USDT', 'member-05.jsonl'),
    'each pair persists member evidence in its own room directory',
  );

  const noSupportingModulesDir = path.join(repositoryDir, 'no-supporting-modules');
  await runEightMemberCouncilRuntime({
    analysis: { ...analysis, openSourceAdvisories: undefined },
    councilReport: report,
    macroContext,
    repositoryDir: noSupportingModulesDir,
    nowMs,
  });
  const noSupportTechnical = JSON.parse(
    await readFile(path.join(noSupportingModulesDir, 'member-01.jsonl'), 'utf8').then((value) => value.trim()),
  );
  assert.equal(
    noSupportTechnical.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'brains.brain01MacroTrend').status,
    'UNAVAILABLE',
  );
  assert.equal(
    noSupportTechnical.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'sb.SB1').status,
    'UNAVAILABLE',
  );
  const noSupportNews = JSON.parse(
    await readFile(path.join(noSupportingModulesDir, 'member-08.jsonl'), 'utf8').then((value) => value.trim()),
  );
  assert.equal(noSupportNews.vote, report.members[7].vote, 'runtime persistence must reuse the original council vote');

  const noQuorumDir = path.join(repositoryDir, 'no-quorum');
  const noQuorumReport = await runEightMemberCouncilRuntime({
    analysis: { ...analysis, fundingRate: 0 },
    multiBrainReport,
    sbReport,
    macroContext,
    freeMacroData: {
      ...freeMacroData,
      sp500: { ...freeMacroData.sp500, status: 'UNAVAILABLE' },
      broadDollar: { ...freeMacroData.broadDollar, status: 'UNAVAILABLE' },
      fedEffectiveRate: { ...freeMacroData.fedEffectiveRate, status: 'UNAVAILABLE' },
      fedTargetUpperBound: { ...freeMacroData.fedTargetUpperBound, status: 'UNAVAILABLE' },
    },
    repositoryDir: noQuorumDir,
    nowMs,
  });
  assert.equal(noQuorumReport.quorumMet, false);
  const noQuorumTechnical = JSON.parse(
    await readFile(path.join(noQuorumDir, 'member-01.jsonl'), 'utf8').then((value) => value.trim()),
  );
  assert.equal(
    noQuorumTechnical.moduleOutputs.find((item: { moduleId: string }) => item.moduleId === 'brains.brain01MacroTrend').status,
    'AVAILABLE',
    'supporting modules must be evaluated and recorded even when the council has no quorum',
  );
  const noQuorumMacro = JSON.parse(
    await readFile(path.join(noQuorumDir, 'member-07.jsonl'), 'utf8').then((value) => value.trim()),
  );
  assert.equal(noQuorumMacro.vote, 'ABSTAIN', 'member 7 must abstain when fewer than two direct macro sources are fresh');
  const noQuorumVote = JSON.parse(
    await readFile(path.join(noQuorumDir, 'council-votes.jsonl'), 'utf8').then((value) => value.trim()),
  );
  assert.equal(noQuorumVote.report.quorumMet, false);
} finally {
  await rm(repositoryDir, { recursive: true, force: true });
  await rm(memberTwoRepositoryDir, { recursive: true, force: true });
}

const retentionDir = await mkdtemp(path.join(os.tmpdir(), 'sbk1-council-retention-'));
try {
  const currentTimestampMs = Date.now();
  await writeFile(
    path.join(retentionDir, 'member-01.jsonl'),
    [
      JSON.stringify({ evaluatedAtMs: currentTimestampMs - 5 * 60 * 60_000 - 1, vote: 'ABSTAIN' }),
      JSON.stringify({ evaluatedAtMs: currentTimestampMs - 60_000, vote: 'NEUTRAL' }),
      'invalid-json-record',
    ].join('\n') + '\n',
  );
  await writeFile(
    path.join(retentionDir, 'council-votes.jsonl'),
    `${JSON.stringify({ report: { evaluatedAtMs: currentTimestampMs - 6 * 60 * 60_000 } })}\n`,
  );
  const removed = await pruneExpiredCouncilRecords(retentionDir, currentTimestampMs);
  assert.equal(removed, 3, 'expired and malformed council records must be removed');
  assert.deepEqual(
    (await readFile(path.join(retentionDir, 'member-01.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).vote),
    ['NEUTRAL'],
    'records younger than five hours must be retained',
  );
} finally {
  await rm(retentionDir, { recursive: true, force: true });
}

console.log('Eight-member council runtime verification passed.');
