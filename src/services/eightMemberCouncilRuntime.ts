import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnalysisResult } from '../types/trading';
import type { MultiBrainConsensusReport } from './multiBrainEnsemble';
import type { FreeMacroDataResult, DirectMetricResult } from './freeMacroData';
import {
  EIGHT_MEMBER_COUNCIL,
  evaluateEightMemberCouncil,
  type CouncilMacroContext,
  type CouncilMemberVote,
  type CouncilModuleEvidence,
  type CouncilOptionsData,
  type CouncilWhaleFlowData,
  type EightMemberCouncilReport,
} from './eightMemberCouncil';
import type { OpenSourceAdvisoryReport } from './openSourceAdvisoryService';
import type { PublicMarketFallbackData } from './publicMarketDataFallback';
import type { SbPentagonOutput } from './sbFiveModelsEngine';
import type { SignalToExecutionResult } from './signalToExecution';
export interface CouncilMemberRepositoryEntry {
  snapshotId: string;
  evaluatedAtMs: number;
  memberId: number;
  memberName: string;
  sourceData: Record<string, unknown>;
  moduleOutputs: CouncilModuleEvidence[];
  vote: CouncilMemberVote['vote'];
  rationaleFa: string;
  qualityChecks: CouncilMemberVote['qualityChecks'];
}

interface RuntimeInput {
  analysis: AnalysisResult;
  councilReport?: EightMemberCouncilReport;
  multiBrainReport?: MultiBrainConsensusReport;
  sbReport?: SbPentagonOutput;
  pillars?: SignalToExecutionResult;
  macroContext: CouncilMacroContext;
  freeMacroData?: FreeMacroDataResult;
  optionsData?: CouncilOptionsData;
  whaleFlowData?: CouncilWhaleFlowData;
  publicMarketFallback?: PublicMarketFallbackData;
  repositoryDir?: string;
  decisionSnapshotTimestampMs?: number;
  nowMs?: number;
}

type ModuleValue = {
  output: unknown;
  sourceTimestampMs: number | null;
  available: boolean;
  summaryFa: string;
  resolvedStatus?: CouncilModuleEvidence['status'];
};

const COUNCIL_RETENTION_MS = 5 * 60 * 60_000;
const COUNCIL_RETENTION_SWEEP_INTERVAL_MS = 60_000;
const councilRetentionTimers = new Map<string, NodeJS.Timeout>();
const councilRetentionLocks = new Map<string, Promise<void>>();

function timestampForCouncilRecord(record: unknown): number | null {
  if (!isObject(record)) return null;
  const timestamp = isFiniteNumber(record.evaluatedAtMs)
    ? record.evaluatedAtMs
    : isObject(record.report) && isFiniteNumber(record.report.evaluatedAtMs)
      ? record.report.evaluatedAtMs
      : null;
  return timestamp !== null && Number.isSafeInteger(timestamp) ? timestamp : null;
}

async function pruneCouncilFile(filePath: string, nowMs: number): Promise<number> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
  const lines = content.split('\n').filter((line) => line.length > 0);
  const retained = lines.filter((line) => {
    try {
      const timestamp = timestampForCouncilRecord(JSON.parse(line));
      return timestamp !== null && timestamp <= nowMs && nowMs - timestamp < COUNCIL_RETENTION_MS;
    } catch {
      return false;
    }
  });
  const removedCount = lines.length - retained.length;
  if (removedCount === 0) return 0;
  if (retained.length === 0) {
    try {
      await unlink(filePath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return removedCount;
  }
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${retained.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath);
  return removedCount;
}

export async function pruneExpiredCouncilRecords(
  repositoryDir: string,
  nowMs = Date.now(),
): Promise<number> {
  const resolvedDir = path.resolve(repositoryDir);
  const previous = councilRetentionLocks.get(resolvedDir) ?? Promise.resolve();
  const current = previous.then(async () => {
    let removedCount = 0;
    for (const fileName of [
      ...EIGHT_MEMBER_COUNCIL.map(({ id }) => `member-${String(id).padStart(2, '0')}.jsonl`),
      'council-votes.jsonl',
    ]) {
      removedCount += await pruneCouncilFile(path.join(resolvedDir, fileName), nowMs);
    }
    return removedCount;
  });
  const lock = current.then(() => undefined, () => undefined);
  councilRetentionLocks.set(resolvedDir, lock);
  try {
    return await current;
  } finally {
    if (councilRetentionLocks.get(resolvedDir) === lock) {
      councilRetentionLocks.delete(resolvedDir);
    }
  }
}

function scheduleCouncilRetentionSweep(repositoryDir: string): void {
  const resolvedDir = path.resolve(repositoryDir);
  if (councilRetentionTimers.has(resolvedDir)) return;
  const timer = setInterval(() => {
    void pruneExpiredCouncilRecords(resolvedDir).catch((error: unknown) => {
      console.error('[EightMemberCouncil] Could not prune expired council records:', error);
    });
  }, COUNCIL_RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();
  councilRetentionTimers.set(resolvedDir, timer);
}

const MODULE_OUTPUTS_STORED_IN_MEMBER_SOURCE_DATA = new Set([
  'technical.mtfStructuralReport',
  'derivatives.cvdOiMatrix',
  'derivatives.liquidationCascade',
  'openSource.newsSentiment',
  'onchain.bitcoinActiveAddresses',
  'options.deribitPublicOptions',
  'onchain.bitcoinPublicTransfers',
  'macro.sp500',
  'macro.dxy',
  'macro.broadDollarProxy',
  'macro.fedRates',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function brainEvidenceAvailability(
  moduleId: string,
  output: unknown,
): { available: boolean; summaryFa: string } {
  if (!isObject(output)) {
    return {
      available: false,
      summaryFa: 'ماژول در این اسنپ‌شات خروجی ساخت‌یافته تولید نکرد.',
    };
  }

  switch (moduleId) {
    case 'brains.brain01MacroTrend':
      return {
        available: isFiniteNumber(output.rawEvidenceScore) &&
          isFiniteNumber(output.hurstExponent) &&
          isFiniteNumber(output.mtfAlignmentScore),
        summaryFa: 'تحلیل مشتق‌شده از همان snapshot کندل؛ مدل/منبع مستقل یا رأی جداگانه نیست.',
      };
    case 'brains.brain02LiquidityFlow':
      return {
        available: isFiniteNumber(output.obiValue) &&
          isFiniteNumber(output.liquidityPoolUsd),
        summaryFa: 'خروجی نقدینگی مشتق‌شده از دفتر سفارش همان snapshot؛ رأی مستقل اضافه نمی‌کند.',
      };
    case 'brains.brain03GarchVolatility':
      return {
        available: output.garchRegime !== 'UNKNOWN' &&
          isFiniteNumber(output.volatilityForecastPct),
        summaryFa: 'پیش‌بینی GARCH فقط وقتی موجود است که مدل بر سری کندل معتبر fit شده باشد.',
      };
    case 'brains.brain05FloatingRiskHedging':
      return {
        available: output.floatingSystemHarmonized !== null &&
          output.floatingSystemHarmonized !== undefined,
        summaryFa: 'هماهنگی هج فقط با وضعیت پوزیشن و lifecycle واقعی قابل ارزیابی است.',
      };
    case 'brains.brain06OnChainWhaleFlow':
    case 'brains.brain11OnChainWhaleSentiment':
      return {
        available: false,
        summaryFa: 'این Brainها به‌تنهایی فید خام/تأییدشدهٔ آن‌چین ندارند؛ منبع مستقیم عضو ششم جداگانه ثبت می‌شود.',
      };
    case 'brains.brain07OrderBookCvd':
      return {
        available: output.isEmpiricalMetric === true &&
          output.isLiveMeasured === true &&
          isFiniteNumber(output.realCvdDeltaBtc),
        summaryFa: output.isEmpiricalMetric === true && output.isLiveMeasured === true
          ? 'CVD تجربی از جریان معاملات زنده؛ از رأی عضو دوم دوباره‌شماری نمی‌شود.'
          : 'CVD زندهٔ تجربی موجود نیست؛ OBI تخمینی جایگزین دادهٔ معاملات نیست.',
      };
    case 'brains.brain08FundamentalMacro':
      return {
        available: false,
        summaryFa: 'این خروجی از macro context مشتق شده و منبع/زمان مستقلِ کافی ندارد؛ منابع مستقیم عضو هفتم مرجع‌اند.',
      };
    case 'brains.brain09BayesianProbabilistic':
      return {
        available: isFiniteNumber(output.calibratedProbabilityPct) &&
          isFiniteNumber(output.confidenceIntervalWidthPct),
        summaryFa: 'خروجی احتمالاتی تنها با احتمال کالیبره و بازه اطمینان موجود قابل استفاده است.',
      };
    case 'brains.brain10AutoPilotHarmonizer':
      return {
        available: output.feeBufferCovered === true &&
          isFiniteNumber(output.riskProtectionEscapeSpeedMs),
        summaryFa: 'هماهنگ‌سازی فقط با اندازه‌گیری واقعی پوشش هزینه و lifecycle قابل ارزیابی است.',
      };
    default:
      return {
        available: false,
        summaryFa: 'برای این ماژول، producer عملیاتی و معیار اعتبارسنجی‌شده ثبت نشده است.',
      };
  }
}

function getNewsSentiment(report: OpenSourceAdvisoryReport | undefined): {
  score: number;
  timestampMs: number;
  headlines: CouncilMacroContext['recentHeadlines'];
} | null {
  const result = report?.modules.newsSentiment;
  if (
    !report ||
    report.status === 'UNAVAILABLE' ||
    result.status !== 'AVAILABLE' ||
    result.sourceTimestampMs !== report.sourceTimestampMs ||
    !isFiniteNumber(result.aggregateSentiment) ||
    result.aggregateSentiment < -1 ||
    result.aggregateSentiment > 1 ||
    !Array.isArray(result.headlines)
  ) return null;

  const headlines = result.headlines.flatMap((item) => {
    if (
      !isObject(item) ||
      typeof item.headline !== 'string' ||
      typeof item.publisher !== 'string' ||
      typeof item.publishedAt !== 'string'
    ) return [];
    const publishedAtMs = Date.parse(item.publishedAt);
    if (!Number.isFinite(publishedAtMs)) return [];
    return [{
      id: `${item.publisher}:${publishedAtMs}:${item.headline}`,
      headline: item.headline,
      source: item.publisher,
      url: '',
      publishedAt: item.publishedAt,
    }];
  });
  if (headlines.length === 0) return null;
  return {
    score: result.aggregateSentiment * 100,
    timestampMs: result.sourceTimestampMs,
    headlines,
  };
}

function makeMacroContext(
  base: CouncilMacroContext,
  report: OpenSourceAdvisoryReport | undefined,
): CouncilMacroContext {
  const sentiment = getNewsSentiment(report);
  const directHeadlines = report?.sourceHeadlines?.flatMap((headline) => {
    const publishedAtMs = Date.parse(headline.publishedAt);
    if (
      !headline.headline.trim() ||
      !headline.publisher.trim() ||
      !Number.isFinite(publishedAtMs)
    ) return [];
    return [{
      id: headline.id,
      headline: headline.headline,
      source: headline.publisher,
      url: headline.url,
      publishedAt: headline.publishedAt,
    }];
  }) ?? [];
  const newsHeadlines = directHeadlines.length > 0
    ? directHeadlines
    : sentiment?.headlines ?? base.recentHeadlines;
  const advisorySentimentUnavailable = directHeadlines.length > 0 && !sentiment;
  const headlineTimestampMs = report?.newsHeadlinesRetrievedAtMs ?? null;
  return {
    ...base,
    lastUpdatedTime: Math.max(
      base.lastUpdatedTime ?? 0,
      sentiment?.timestampMs ?? 0,
      headlineTimestampMs ?? 0,
    ) || null,
    newsSentimentStatus: sentiment
      ? 'LIVE'
      : advisorySentimentUnavailable
        ? 'UNAVAILABLE'
        : base.newsSentimentStatus,
    newsSentimentScore: sentiment?.score ??
      (advisorySentimentUnavailable ? null : base.newsSentimentScore),
    newsHeadlinesStatus: directHeadlines.length > 0 || sentiment
      ? 'LIVE'
      : base.newsHeadlinesStatus,
    recentHeadlines: newsHeadlines,
  };
}

function brainModules(report: MultiBrainConsensusReport): Record<string, unknown> {
  return {
    'brains.brain01MacroTrend': report.brain1Macro,
    'brains.brain02LiquidityFlow': report.brain2Liquidity,
    'brains.brain03GarchVolatility': report.brain3Volatility,
    'brains.brain05FloatingRiskHedging': report.brain5RiskHedging,
    'brains.brain06OnChainWhaleFlow': report.brain6OnChainWhale,
    'brains.brain07OrderBookCvd': report.brain7OrderBookCvd,
    'brains.brain08FundamentalMacro': report.brain8FundamentalMacro,
    'brains.brain09BayesianProbabilistic': report.brain9BayesianProbabilistic,
    'brains.brain10AutoPilotHarmonizer': report.brain10AutoPilotHarmonizer,
    'brains.brain11OnChainWhaleSentiment': report.brain11OnChainWhaleSentiment,
    'brains.brain12ExecutionSniper': report.brain12ExecutionSniper,
    'brains.brain13AsymmetricProfitRunner': report.brain13MaxProfit,
    'brains.brain14LossToBreakeven': report.brain14LossToBreakeven,
    'brains.brain15FrequencyPreserver': report.brain15FrequencyPreserver,
    'brains.brain16DrawdownLockout': report.brain16DrawdownLockout,
    'brains.brain17RapidTurnaround': report.brain17RapidTurnaround,
    'brains.brain18StagnantLiquidator': report.brain18StagnantLiquidator,
    'brains.brain19LoadReallocator': report.brain19LoadReallocator,
    'brains.brain20LatencyArbitrage': report.brain20LatencyArbitrage,
    'brains.brain21StrategicRecovery': report.brain21StrategicRecovery,
  };
}

function sourceDataForMember(
  memberId: number,
  analysis: AnalysisResult,
  macro: CouncilMacroContext,
  freeMacroData?: FreeMacroDataResult,
  optionsData?: CouncilOptionsData,
  whaleFlowData?: CouncilWhaleFlowData,
  publicMarketFallback?: PublicMarketFallbackData,
): Record<string, unknown> {
  const fallbackFeedSummary = (feed: {
    status: 'LIVE' | 'UNAVAILABLE';
    sourceTimestampMs: number | null;
    value: unknown;
    error?: string;
  }) => ({
    status: feed.status,
    sourceTimestampMs: feed.sourceTimestampMs,
    observationCount: Array.isArray(feed.value)
      ? feed.value.length
      : isObject(feed.value) && Array.isArray(feed.value.trades)
        ? feed.value.trades.length
        : feed.value === null
          ? 0
          : 1,
    error: feed.error,
  });
  const fallback = publicMarketFallback
    ? {
      provider: publicMarketFallback.provider,
      venue: publicMarketFallback.venue,
      market: publicMarketFallback.market,
      pair: publicMarketFallback.pair,
      timeframe: publicMarketFallback.timeframe,
      retrievedAtMs: publicMarketFallback.retrievedAtMs,
    }
    : null;
  const crossExchangeQuotes = publicMarketFallback
    ? {
      status: publicMarketFallback.exchangeQuotes.status,
      sourceTimestampMs: publicMarketFallback.exchangeQuotes.sourceTimestampMs,
      quotes: publicMarketFallback.exchangeQuotes.value,
      error: publicMarketFallback.exchangeQuotes.error,
    }
    : null;
  switch (memberId) {
    case 1:
      return {
        candles: analysis.candles.slice(-30),
        scoreLong: analysis.scoreLong,
        scoreShort: analysis.scoreShort,
        indicators: {
          rsi: analysis.rsi,
          adx: analysis.adx,
          ema20: analysis.ema20?.at(-1),
          ema50: analysis.ema50?.at(-1),
          ema200: analysis.ema200?.at(-1),
          macdH: analysis.macdH?.at(-1),
          marketRegime: analysis.marketRegime,
          structuralReport: analysis.mtfStructuralReport,
        },
        candleFeed: analysis.dataQualityReport?.feeds.candles,
        marketFallback: fallback && {
          ...fallback,
          crossExchangeQuotes,
          feed: fallbackFeedSummary(publicMarketFallback!.candles),
        },
      };
    case 2:
      return {
        orderFlow: analysis.orderFlowFeatures,
        orderFlowFeed: analysis.dataQualityReport?.feeds.orderFlow,
        marketFallback: fallback && {
          ...fallback,
          crossExchangeQuotes,
          feed: fallbackFeedSummary(publicMarketFallback!.tradeFlow),
        },
      };
    case 3:
      return {
        orderBook: analysis.realObiData,
        orderBookFeed: analysis.dataQualityReport?.feeds.orderBook,
        marketFallback: fallback && {
          ...fallback,
          crossExchangeQuotes,
          feed: fallbackFeedSummary(publicMarketFallback!.orderBook),
        },
      };
    case 4:
      return {
        fundingRate: analysis.fundingRate ?? analysis.funding,
        openInterest: analysis.oi,
        derivatives: analysis.cvdOiMatrix,
        liquidationCascade: analysis.liquidationCascadePrediction,
        derivativesFeed: analysis.dataQualityReport?.feeds.derivatives,
        marketFallback: fallback && {
          ...fallback,
          crossExchangeQuotes,
          fundingRate: fallbackFeedSummary(publicMarketFallback!.fundingRate),
          openInterest: fallbackFeedSummary(publicMarketFallback!.openInterest),
        },
      };
    case 5:
      return {
        optionsData: optionsData ?? null,
        sourceStatus: optionsData?.status ?? 'UNAVAILABLE: no verified options feed is configured',
      };
    case 6:
      return {
        whaleFlowStatus: macro.whaleFlowStatus,
        whaleSentiment: macro.whaleSentiment,
        whaleNetflowBtc: macro.whaleNetflowBtc,
        provenance: 'macroContext',
        bitcoinActiveAddresses: freeMacroData?.bitcoinActiveAddresses ?? null,
        publicOnChainData: whaleFlowData ?? null,
      };
    case 7:
      return {
        overallDataStatus: macro.overallDataStatus,
        fundamentalBias: macro.fundamentalBias,
        sp500: { status: macro.sp500Status, dailyChangePct: macro.sp500DailyChangePct },
        dxy: { status: macro.dxyStatus, index: macro.dxyIndex, dailyChangePct: macro.dxyDailyChangePct },
        spotEtf: { status: macro.etfFlowStatus, netInflowMillionUsd: macro.spotEtfNetInflowMillionUsd },
        lastUpdatedTime: macro.lastUpdatedTime,
        directSources: freeMacroData ?? null,
      };
    case 8:
      return {
        recentHeadlines: macro.recentHeadlines,
        newsSentimentStatus: macro.newsSentimentStatus,
        newsSentimentScore: macro.newsSentimentScore,
        newsHeadlinesStatus: macro.newsHeadlinesStatus,
      };
    default:
      throw new Error(`Unknown eight-member council member id: ${memberId}`);
  }
}

function collectModuleValues(input: RuntimeInput, nowMs: number): Record<string, ModuleValue> {
  const sourceTimestampMs = input.multiBrainReport?.sourceTimestampMs ?? null;
  const brains = input.multiBrainReport ? brainModules(input.multiBrainReport) : {};
  const values: Record<string, ModuleValue> = {};
  const marketFallback = input.publicMarketFallback;
  if (marketFallback) {
    const timeframeMatch = /^(\d+)([mhdw])$/.exec(marketFallback.timeframe);
    const timeframeUnitMs: Record<string, number> = {
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };
    const candleMaxAgeMs = timeframeMatch
      ? Number(timeframeMatch[1]) * timeframeUnitMs[timeframeMatch[2]] + 60_000
      : 15_000;
    const fallbackEvidence = (
      feed: PublicMarketFallbackData['candles'] | PublicMarketFallbackData['orderBook'] |
        PublicMarketFallbackData['tradeFlow'] | PublicMarketFallbackData['fundingRate'] |
        PublicMarketFallbackData['openInterest'],
      maxAgeMs: number,
      label: string,
    ): ModuleValue => {
      const timestampMs = feed.sourceTimestampMs;
      const ageMs = timestampMs === null ? null : nowMs - timestampMs;
      const isFresh = feed.status === 'LIVE' &&
        timestampMs !== null &&
        ageMs !== null &&
        ageMs >= 0 &&
        ageMs <= maxAgeMs;
      return {
        output: {
          provider: marketFallback.provider,
          venue: marketFallback.venue,
          market: marketFallback.market,
          pair: marketFallback.pair,
          status: feed.status,
          sourceTimestampMs: timestampMs,
          ageMs,
          error: feed.error,
        },
        sourceTimestampMs: timestampMs,
        available: isFresh,
        resolvedStatus: isFresh ? 'AVAILABLE' : feed.status === 'LIVE' ? 'STALE' : 'UNAVAILABLE',
        summaryFa: isFresh
          ? `${label} از ${marketFallback.provider} (${marketFallback.pair})؛ سن ${Math.round(ageMs!)}ms.`
          : feed.error ?? `${label} از منبع جایگزین موجود نیست یا کهنه است.`,
      };
    };
    values['marketFallback.binanceCandles'] = fallbackEvidence(
      marketFallback.candles, candleMaxAgeMs, 'کندل‌های عمومی تکمیل‌شده',
    );
    values['marketFallback.binanceTrades'] = fallbackEvidence(
      marketFallback.tradeFlow, 5_000, 'معاملات عمومی اجراشده برای CVD',
    );
    values['marketFallback.binanceOrderBook'] = fallbackEvidence(
      marketFallback.orderBook, 5_000, 'دفتر سفارش عمومی',
    );
    const fundingEvidence = fallbackEvidence(
      marketFallback.fundingRate, 60_000, 'Funding عمومی',
    );
    const openInterestEvidence = fallbackEvidence(
      marketFallback.openInterest, 10 * 60_000, 'OI عمومی',
    );
    const derivativesAvailable = fundingEvidence.available && openInterestEvidence.available;
    values['marketFallback.binanceDerivatives'] = {
      output: {
        provider: marketFallback.provider,
        venue: marketFallback.venue,
        market: marketFallback.market,
        pair: marketFallback.pair,
        fundingRate: fundingEvidence.output,
        openInterest: openInterestEvidence.output,
      },
      sourceTimestampMs: derivativesAvailable
        ? Math.max(fundingEvidence.sourceTimestampMs!, openInterestEvidence.sourceTimestampMs!)
        : null,
      available: derivativesAvailable,
      resolvedStatus: derivativesAvailable
        ? 'AVAILABLE'
        : fundingEvidence.resolvedStatus === 'STALE' || openInterestEvidence.resolvedStatus === 'STALE'
          ? 'STALE'
          : 'UNAVAILABLE',
      summaryFa: derivativesAvailable
        ? `Funding و OI عمومی تازه از ${marketFallback.provider} (${marketFallback.pair}).`
        : `شواهد مشتقات جایگزین کامل نیستند: ${fundingEvidence.summaryFa} ${openInterestEvidence.summaryFa}`,
    };
    const quotes = marketFallback.exchangeQuotes;
    const quoteTimestampMs = quotes.sourceTimestampMs;
    const quoteAgeMs = quoteTimestampMs === null ? null : nowMs - quoteTimestampMs;
    const quoteNames = quotes.value?.map(({ exchange }) => exchange) ?? [];
    const quotesFresh = quotes.status === 'LIVE' &&
      quoteTimestampMs !== null &&
      quoteAgeMs !== null &&
      quoteAgeMs >= -5_000 &&
      quoteAgeMs <= 5_000 &&
      quoteNames.length === 3 &&
      new Set(quoteNames).size === 3 &&
      ['binance', 'bybit', 'okx'].every((exchange) => quoteNames.some((name) => name === exchange));
    const crossExchangeEvidence: ModuleValue = {
      output: quotes.value ?? null,
      sourceTimestampMs: quoteTimestampMs,
      available: quotesFresh,
      resolvedStatus: quotesFresh ? 'AVAILABLE' : quotes.status === 'LIVE' ? 'STALE' : 'UNAVAILABLE',
      summaryFa: quotesFresh
        ? `قیمت زنده و مستقل جفت ${marketFallback.pair} از هر سه صرافی Binance، Bybit و OKX؛ بیشترین سن feedها ${Math.round(quoteAgeMs!)}ms.`
        : quotes.error ?? 'قیمت تازه از هر سه صرافی Binance، Bybit و OKX هم‌زمان موجود نیست.',
    };
    for (const memberId of [1, 2, 3, 4]) {
      values[`marketFallback.crossExchangePrices.member${memberId}`] = crossExchangeEvidence;
    }
  }
  for (const [moduleId, output] of Object.entries(brains)) {
    const availability = brainEvidenceAvailability(moduleId, output);
    values[moduleId] = {
      output,
      sourceTimestampMs,
      available: availability.available && sourceTimestampMs !== null,
      summaryFa: availability.summaryFa,
    };
  }
  for (const model of input.sbReport?.models ?? []) {
    const available = model.status === 'ACTIVE' || model.status === 'EXECUTION_READY';
    values[`sb.${model.id}`] = {
      output: model,
      sourceTimestampMs: sourceTimestampMs,
      available,
      summaryFa: `${model.status}: ${model.liveDirectiveFa}${available ? '' : '؛ خروجی فعال و قابل‌استفاده نیست.'}`,
    };
  }

  values['technical.mtfStructuralReport'] = {
    output: input.analysis.mtfStructuralReport ?? null,
    sourceTimestampMs,
    available: input.analysis.mtfStructuralReport !== undefined && input.analysis.mtfStructuralReport !== null,
    summaryFa: input.analysis.mtfStructuralReport ? 'گزارش ساختاری چندتایم‌فریمی تحلیل همین اسنپ‌شات.' : 'گزارش ساختاری در این اسنپ‌شات تولید نشد.',
  };
  values['derivatives.cvdOiMatrix'] = {
    output: input.analysis.cvdOiMatrix ?? null,
    sourceTimestampMs,
    available: input.analysis.cvdOiMatrix !== undefined && input.analysis.cvdOiMatrix !== null,
    summaryFa: input.analysis.cvdOiMatrix ? 'ماتریس CVD/OI تحلیل همین اسنپ‌شات.' : 'ماتریس CVD/OI در دسترس نیست.',
  };
  values['derivatives.liquidationCascade'] = {
    output: input.analysis.liquidationCascadePrediction ?? null,
    sourceTimestampMs,
    available: input.analysis.liquidationCascadePrediction !== undefined && input.analysis.liquidationCascadePrediction !== null,
    summaryFa: input.analysis.liquidationCascadePrediction ? 'برآورد آبشار لیکوییدیشن تحلیل همین اسنپ‌شات.' : 'برآورد آبشار لیکوییدیشن در دسترس نیست.',
  };

  const advisory = input.analysis.openSourceAdvisories;
  const advisoryKeys = [
    'candlestickPatterns',
    'marketRegime',
    'marketAnomaly',
    'lightgbmForecast',
    'xgboostForecast',
    'newsSentiment',
  ] as const;
  for (const key of advisoryKeys) {
    const result = advisory?.modules[key];
    const hasValidReportTimestamp = Number.isSafeInteger(advisory?.sourceTimestampMs) &&
      advisory.sourceTimestampMs <= nowMs;
    const available = result?.status === 'AVAILABLE' &&
      hasValidReportTimestamp &&
      result.sourceTimestampMs === advisory?.sourceTimestampMs &&
      Number.isSafeInteger(result.sourceTimestampMs);
    values[`openSource.${key}`] = {
      output: result ?? null,
      sourceTimestampMs: result?.sourceTimestampMs ?? null,
      available,
      summaryFa: available
        ? `تحلیل متن‌باز ${key} برای کندل این اسنپ‌شات آماده است.`
        : result?.reason ?? 'خروجی معتبر با timestamp منطبق بر همین snapshot در دسترس نیست.',
    };
  }

  const pillarIds: Record<string, string> = {
    ai_neural: 'pillars.AI_NEURAL',
    htf_trend: 'pillars.HTF_TREND',
    smc_price_action: 'pillars.SMC_PRICE_ACTION',
    trend_ribbon: 'pillars.TREND_RIBBON',
    momentum_indicators: 'pillars.MOMENTUM_INDICATORS',
    order_book_derivatives: 'pillars.ORDER_BOOK_DERIVATIVES',
    volatility_regime: 'pillars.VOLATILITY_REGIME',
    fundamental_macro_news: 'pillars.FUNDAMENTAL_MACRO_NEWS',
    risk_anti_tilt: 'gates.RISK_ANTI_TILT',
  };
  for (const pillar of input.pillars?.breakdown ?? []) {
    const moduleId = pillarIds[pillar.id];
    if (!moduleId) continue;
    values[moduleId] = {
      output: pillar,
      sourceTimestampMs,
      available: pillar.available === true,
      summaryFa: pillar.details,
    };
  }

  const directMetricEvidence = (
    metric: DirectMetricResult | undefined,
    maxAgeMs: number,
    summaryFa: string,
  ): ModuleValue => {
    if (!metric || metric.status !== 'LIVE' || !isFiniteNumber(metric.observedAtMs)) {
      return {
        output: metric ?? null,
        sourceTimestampMs: metric?.observedAtMs ?? null,
        available: false,
        resolvedStatus: 'UNAVAILABLE',
        summaryFa: metric?.error ?? `${summaryFa} منبع زنده ندارد.`,
      };
    }
    const ageMs = (input.nowMs ?? Date.now()) - metric.observedAtMs;
    const fresh = ageMs >= 0 && ageMs <= maxAgeMs;
    return {
      output: metric,
      sourceTimestampMs: metric.observedAtMs,
      available: fresh,
      resolvedStatus: fresh ? 'AVAILABLE' : 'STALE',
      summaryFa: fresh
        ? `${summaryFa} از ${metric.provider}؛ سن داده ${Math.round(ageMs / 60_000)} دقیقه.`
        : `${summaryFa} از منبع ${metric.provider} کهنه است.`,
    };
  };
  const macroData = input.freeMacroData;
  values['onchain.bitcoinActiveAddresses'] = directMetricEvidence(
    macroData?.bitcoinActiveAddresses,
    3 * 24 * 60 * 60_000,
    'شاخص تعداد آدرس‌های فعال شبکه بیت‌کوین؛ این داده جریان صرافی/نهنگ نیست و رأی جهت‌دار نمی‌سازد.',
  );
  const optionsData = input.optionsData;
  const optionsAgeMs = optionsData?.timestampMs === null || optionsData?.timestampMs === undefined
    ? null
    : (input.nowMs ?? Date.now()) - optionsData.timestampMs;
  const optionsAvailable = optionsData?.status === 'LIVE' &&
    optionsAgeMs !== null &&
    optionsAgeMs >= 0 &&
    optionsAgeMs <= 5 * 60_000 &&
    (optionsData.qualityPct ?? 0) >= 80 &&
    (optionsData.contractsCount ?? 0) >= 20;
  values['options.deribitPublicOptions'] = {
    output: optionsData ?? null,
    sourceTimestampMs: optionsData?.timestampMs ?? null,
    available: optionsAvailable,
    resolvedStatus: optionsAvailable ? 'AVAILABLE' : optionsData?.status === 'STALE' ? 'STALE' : 'UNAVAILABLE',
    summaryFa: optionsAvailable
      ? `دادهٔ عمومی اختیار BTC از ${optionsData.provider ?? 'منبع نامشخص'}؛ ${optionsData.contractsCount} قرارداد معتبر، کیفیت ${optionsData.qualityPct}٪.`
      : 'دادهٔ زنده و کافی اختیار معامله برای این اسنپ‌شات موجود نیست.',
  };
  const whaleFlow = input.whaleFlowData;
  const whaleFlowAgeMs = whaleFlow?.timestampMs === null || whaleFlow?.timestampMs === undefined
    ? null
    : (input.nowMs ?? Date.now()) - whaleFlow.timestampMs;
  const whaleFlowAvailable = whaleFlow?.status === 'LIVE' &&
    whaleFlowAgeMs !== null &&
    whaleFlowAgeMs >= 0 &&
    whaleFlowAgeMs <= (whaleFlow?.largeTransfers ? 20 : 10) * 60_000 &&
    whaleFlow.qualityPct >= 80 &&
    (Array.isArray(whaleFlow.largeTransfers) || isFiniteNumber(whaleFlow.netExchangeFlowBtc));
  values['onchain.bitcoinPublicTransfers'] = {
    output: whaleFlow ?? null,
    sourceTimestampMs: whaleFlow?.timestampMs ?? null,
    available: whaleFlowAvailable,
    resolvedStatus: whaleFlowAvailable ? 'AVAILABLE' : whaleFlow?.status === 'STALE' ? 'STALE' : 'UNAVAILABLE',
    summaryFa: whaleFlowAvailable
      ? `دادهٔ خام آن‌چین از ${whaleFlow.provider}؛ ${whaleFlow.transactionCount} خروجی بزرگ مشاهده‌شده. پوشش نمونه‌ای است و انتساب صرافی ندارد.`
      : whaleFlow?.unavailableReason ?? 'دادهٔ خام زنجیره‌ای با کیفیت و تازگی لازم موجود نیست.',
  };
  values['macro.sp500'] = directMetricEvidence(
    macroData?.sp500,
    5 * 24 * 60 * 60_000,
    'شاخص S&P 500 و تغییر روزانه.',
  );
  values['macro.dxy'] = directMetricEvidence(
    macroData?.dxy,
    2 * 60_000,
    'شاخص واقعی دلار DXY.',
  );
  values['macro.broadDollarProxy'] = directMetricEvidence(
    macroData?.broadDollar,
    5 * 24 * 60 * 60_000,
    'شاخص گسترده دلارِ فدرال رزرو به‌عنوان proxy؛ این داده DXY نیست.',
  );
  const fedEffectiveRate = directMetricEvidence(
    macroData?.fedEffectiveRate,
    5 * 24 * 60 * 60_000,
    'نرخ مؤثر فدرال رزرو.',
  );
  const fedTargetUpperBound = directMetricEvidence(
    macroData?.fedTargetUpperBound,
    5 * 24 * 60 * 60_000,
    'سقف نرخ هدف فدرال رزرو.',
  );
  const fedRatesAvailable = fedEffectiveRate.available || fedTargetUpperBound.available;
  values['macro.fedRates'] = {
    output: {
      effectiveRate: fedEffectiveRate.output,
      targetUpperBound: fedTargetUpperBound.output,
    },
    sourceTimestampMs: [fedEffectiveRate.sourceTimestampMs, fedTargetUpperBound.sourceTimestampMs]
      .filter(isFiniteNumber)
      .sort((left, right) => right - left)[0] ?? null,
    available: fedRatesAvailable,
    resolvedStatus: fedRatesAvailable
      ? 'AVAILABLE'
      : fedEffectiveRate.resolvedStatus === 'STALE' || fedTargetUpperBound.resolvedStatus === 'STALE'
        ? 'STALE'
        : 'UNAVAILABLE',
    summaryFa: `${fedEffectiveRate.summaryFa} ${fedTargetUpperBound.summaryFa}`,
  };
  return values;
}

async function persistMemberRecords(
  entries: CouncilMemberRepositoryEntry[],
  report: EightMemberCouncilReport,
  snapshotId: string,
  coordinatorOutput: SbPentagonOutput['models'][number] | null,
  repositoryDir: string,
): Promise<void> {
  await mkdir(repositoryDir, { recursive: true });
  await pruneExpiredCouncilRecords(repositoryDir);
  for (const entry of entries) {
    const memberFile = path.join(repositoryDir, `member-${String(entry.memberId).padStart(2, '0')}.jsonl`);
    await appendFile(memberFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  await appendFile(
    path.join(repositoryDir, 'council-votes.jsonl'),
    `${JSON.stringify({
      snapshotId,
      report,
      coordinator: coordinatorOutput
        ? { moduleId: 'sb.SB5', output: coordinatorOutput, excludedFromMemberVotes: true }
        : { moduleId: 'sb.SB5', status: 'UNAVAILABLE', excludedFromMemberVotes: true },
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

export function evaluateEightMemberCouncilForSnapshot(input: {
  analysis: AnalysisResult;
  macroContext: CouncilMacroContext;
  nowMs?: number;
}): EightMemberCouncilReport {
  return evaluateEightMemberCouncil({
    analysis: input.analysis,
    macroContext: makeMacroContext(input.macroContext, input.analysis.openSourceAdvisories),
    nowMs: input.nowMs,
  });
}

export async function runEightMemberCouncilRuntime(
  input: RuntimeInput,
): Promise<EightMemberCouncilReport> {
  const nowMs = input.nowMs ?? Date.now();
  const sourceTimestampMs = input.decisionSnapshotTimestampMs ??
    input.analysis.openSourceAdvisories?.sourceTimestampMs ??
    input.multiBrainReport?.sourceTimestampMs ??
    input.analysis.candles.at(-1)?.[0] ??
    null;
  const snapshotId = `SNP_${sourceTimestampMs ?? 'unknown'}_${nowMs}`;
  const moduleValues = collectModuleValues(input, nowMs);
  const supportingModules: Record<string, CouncilModuleEvidence> = {};

  for (const member of EIGHT_MEMBER_COUNCIL) {
    for (const moduleId of member.moduleIds) {
      const module = moduleValues[moduleId];
      const hasValidTimestamp = module?.sourceTimestampMs !== null &&
        module?.sourceTimestampMs !== undefined &&
        isFiniteNumber(module.sourceTimestampMs) &&
        module.sourceTimestampMs >= 0 &&
        module.sourceTimestampMs <= nowMs;
      supportingModules[moduleId] = {
        moduleId,
        nameFa: moduleId,
        status: !module?.available
          ? module?.resolvedStatus ?? 'UNAVAILABLE'
          : hasValidTimestamp
            ? 'AVAILABLE'
            : 'STALE',
        sourceTimestampMs: module?.sourceTimestampMs ?? null,
        summaryFa: module?.summaryFa ?? 'این منبع برای عضو مالک در runtime متصل نشده است.',
        ...(module && !MODULE_OUTPUTS_STORED_IN_MEMBER_SOURCE_DATA.has(moduleId)
          ? { output: module.output }
          : {}),
      };
    }
  }

  const macroContext = makeMacroContext(input.macroContext, input.analysis.openSourceAdvisories);
  const baseReport = input.councilReport ?? evaluateEightMemberCouncil({
    analysis: input.analysis,
    macroContext,
    directMacroData: input.freeMacroData,
    optionsData: input.optionsData,
    whaleFlowData: input.whaleFlowData,
    nowMs,
  });
  const report: EightMemberCouncilReport = {
    ...baseReport,
    members: baseReport.members.map((member) => ({
      ...member,
      supportingEvidence: member.moduleIds.map((moduleId) => supportingModules[moduleId] ?? {
        moduleId,
        nameFa: moduleId,
        status: 'UNAVAILABLE',
        sourceTimestampMs: null,
        summaryFa: 'خروجی این ماژول هنوز به شورا نرسیده است؛ در رأی عضو دخالت ندارد.',
      }),
    })),
  };
  const entries: CouncilMemberRepositoryEntry[] = report.members.map((member) => ({
    snapshotId,
    evaluatedAtMs: nowMs,
    memberId: member.id,
    memberName: member.nameFa,
    sourceData: {
      ...sourceDataForMember(
        member.id,
        input.analysis,
        macroContext,
        input.freeMacroData,
        input.optionsData,
        input.whaleFlowData,
        input.publicMarketFallback,
      ),
      peerCouncilSummary: report.members.map((peer) => ({
        memberId: peer.id,
        memberName: peer.nameFa,
        vote: peer.vote,
        rationaleFa: peer.rationaleFa,
        sourceTimestampMs: peer.sourceTimestampMs,
        sourceAgeMs: peer.sourceAgeMs,
        dataQualityPct: peer.dataQualityPct,
      })),
    },
    moduleOutputs: member.supportingEvidence,
    vote: member.vote,
    rationaleFa: member.rationaleFa,
    qualityChecks: member.qualityChecks,
  }));
  const repositoryDir = input.repositoryDir ??
    process.env.SBK1_COUNCIL_REPOSITORY_DIR ??
    path.resolve(process.cwd(), 'data', 'council-members');
  const coordinatorOutput = input.sbReport?.models.find(({ id }) => id === 'SB5') ?? null;
  await persistMemberRecords(entries, report, snapshotId, coordinatorOutput, repositoryDir);
  const operationalRepositoryDir = process.env.SBK1_COUNCIL_REPOSITORY_DIR ??
    path.resolve(process.cwd(), 'data', 'council-members');
  if (path.resolve(repositoryDir) === path.resolve(operationalRepositoryDir)) {
    scheduleCouncilRetentionSweep(repositoryDir);
  }
  return report;
}
