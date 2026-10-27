import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleHelp, ShieldAlert, Users } from 'lucide-react';
import type { AnalysisResult, TradeHistory, TradePosition } from '../types/trading';
import { getLatestMultiBrainConsensusReport, type MultiBrainConsensusReport } from '../services/multiBrainEnsemble';
import { sbFiveModelsEngine, type SbPentagonOutput } from '../services/sbFiveModelsEngine';
import { evaluateSignalToExecution, type IndicatorScoreBreakdown } from '../services/signalToExecution';
import { newsShockFirewallService } from '../services/newsShockFirewall';
import type { WalkForwardCandleResearchReport } from '../services/walkForwardCandleResearch';
import type { HoldingHorizonDecision } from '../services/postCouncilTradeController';
import { CollapsibleCard } from './CollapsibleCard';
import {
  COUNCIL_COORDINATOR_MODULES,
  type CouncilModuleEvidence,
  type CouncilVote,
  type EightMemberCouncilReport,
} from '../services/eightMemberCouncil';

interface Props {
  analysis?: AnalysisResult | null;
  aiPrediction?: unknown;
  currentPrice?: number;
  activePositions?: TradePosition[];
  tradeHistory?: TradeHistory[];
  councilReport?: EightMemberCouncilReport | null;
}

interface OpenSourceModuleResult {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  sourceTimestampMs: number | null;
  [key: string]: unknown;
}

interface OpenSourceAdvisoryReport {
  contractVersion: 'sbk1.open-source-advisories.v1';
  generatedAtMs: number;
  sourceTimestampMs: number;
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  decisionInfluence: 'ADVISORY_ONLY';
  modules: Record<string, OpenSourceModuleResult>;
}

interface OpenSourceAdvisoryResponse {
  status: 'NOT_RUN' | OpenSourceAdvisoryReport['status'];
  decisionInfluence: 'ADVISORY_ONLY';
  report: OpenSourceAdvisoryReport | null;
}

interface ExecutionAuditView {
  at: string;
  decision: 'NO TRADE' | 'LONG' | 'SHORT';
  reason: string;
  signalId?: string;
  holdingHorizon?: HoldingHorizonDecision;
}

const OPEN_SOURCE_MODULES = [
  ['candlestickPatterns', 'الگوهای کندلی · TA-Lib'],
  ['marketRegime', 'رژیم بازار · statsmodels'],
  ['marketAnomaly', 'ناهنجاری · Isolation Forest'],
  ['lightgbmForecast', 'پیش‌بینی بازده · LightGBM'],
  ['xgboostForecast', 'پیش‌بینی بازده · XGBoost'],
  ['newsSentiment', 'احساس تیتر خبر · مدل مالی'],
] as const;

const BRAIN_MODULES = [
  ['brains.brain01MacroTrend', 'مغز ۱ · روند و ساختار'],
  ['brains.brain02LiquidityFlow', 'مغز ۲ · نقدینگی'],
  ['brains.brain03GarchVolatility', 'مغز ۳ · GARCH'],
  ['brains.brain04PatternDivergence', 'مغز ۴ · الگو'],
  ['brains.brain05FloatingRiskHedging', 'مغز ۵ · ریسک شناور'],
  ['brains.brain06OnChainWhaleFlow', 'مغز ۶ · جریان آن‌چین'],
  ['brains.brain07OrderBookCvd', 'مغز ۷ · CVD'],
  ['brains.brain08FundamentalMacro', 'مغز ۸ · فاندامنتال'],
  ['brains.brain09BayesianProbabilistic', 'مغز ۹ · بیزی'],
  ['brains.brain10AutoPilotHarmonizer', 'مغز ۱۰ · هماهنگ‌ساز خروج'],
  ['brains.brain11OnChainWhaleSentiment', 'مغز ۱۱ · تراکنش نهنگ'],
  ['brains.brain12ExecutionSniper', 'مغز ۱۲ · سنجه اجرا'],
  ['brains.brain13AsymmetricProfitRunner', 'مغز ۱۳ · مدیریت سود'],
  ['brains.brain14LossToBreakeven', 'مغز ۱۴ · سربه‌سر'],
  ['brains.brain15FrequencyPreserver', 'مغز ۱۵ · فرکانس معامله'],
  ['brains.brain16DrawdownLockout', 'مغز ۱۶ · قفل افت سرمایه'],
  ['brains.brain17RapidTurnaround', 'مغز ۱۷ · بازگشت سریع'],
  ['brains.brain18StagnantLiquidator', 'مغز ۱۸ · فرسایش زمانی'],
  ['brains.brain19LoadReallocator', 'مغز ۱۹ · تخصیص بار'],
  ['brains.brain20LatencyArbitrage', 'مغز ۲۰ · تأخیر و اسپرد'],
  ['brains.brain21StrategicRecovery', 'مغز ۲۱ · بازیابی'],
] as const;

const SPECIALIZED_MODULES = [
  ['technical.mtfStructuralReport', 'موتور ساختار چندتایم‌فریمی'],
  ['derivatives.cvdOiMatrix', 'ماتریس واگرایی CVD/OI'],
  ['derivatives.liquidationCascade', 'پیش‌بینی آبشار لیکوییدیشن'],
  ['news.shockFirewall', 'دیوار آتش شوک خبری'],
] as const;

const PILLAR_MODULE_NAMES: Record<string, string> = {
  AI_NEURAL: 'رکن AI و شبکه عصبی',
  ORDER_BOOK_DERIVATIVES: 'رکن دفتر سفارش و مشتقات',
  HTF_TREND: 'رکن روند تایم‌فریم بالا',
  SMC_PRICE_ACTION: 'رکن SMC و پرایس‌اکشن',
  TREND_RIBBON: 'رکن نوار روند',
  VOLATILITY_REGIME: 'رکن رژیم نوسان',
  MOMENTUM_INDICATORS: 'رکن مومنتوم',
  FUNDAMENTAL_MACRO_NEWS: 'رکن اقتصاد کلان و خبر',
};

const GATE_MODULE_NAMES: Record<string, string> = {
  RISK_ANTI_TILT: 'گیت وتوی ضدکج‌رفتاری',
};

const VOTE_LABEL: Record<CouncilVote, string> = {
  LONG: 'رأی خرید',
  SHORT: 'رأی فروش',
  NEUTRAL: 'خنثی',
  ABSTAIN: 'ممتنع (داده ناکافی)',
};

const VOTE_STYLE: Record<CouncilVote, string> = {
  LONG: 'border-emerald-500/50 bg-emerald-950/50 text-emerald-200',
  SHORT: 'border-rose-500/50 bg-rose-950/50 text-rose-200',
  NEUTRAL: 'border-slate-600 bg-slate-900 text-slate-200',
  ABSTAIN: 'border-amber-500/40 bg-amber-950/40 text-amber-200',
};

function formatTimestamp(timestampMs: number | null): string {
  return timestampMs === null ? 'زمان داده ناموجود' : new Date(timestampMs).toLocaleString('fa-IR');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCandleResearchReport(value: unknown): value is WalkForwardCandleResearchReport {
  if (!isRecord(value) || !isRecord(value.horizons) || !isRecord(value.costs)) return false;
  return ['AVAILABLE', 'INSUFFICIENT_HISTORY', 'INSUFFICIENT_EVIDENCE', 'INVALID_INPUT'].includes(String(value.status)) &&
    value.source === 'verified-live-exchange-candles' &&
    (typeof value.exchange === 'string' || value.exchange === null) &&
    (typeof value.pair === 'string' || value.pair === null) &&
    (value.market === 'spot' || value.market === 'futures' || value.market === null) &&
    Number.isSafeInteger(value.candleCount) &&
    value.tradeEligible === false &&
    typeof value.note === 'string';
}

function isHoldingHorizonDecision(value: unknown): value is HoldingHorizonDecision {
  if (
    !isRecord(value) ||
    (value.status !== 'SELECTED' && value.status !== 'UNAVAILABLE') ||
    !(value.selectedHorizonMinutes === null || Number.isFinite(value.selectedHorizonMinutes)) ||
    !Array.isArray(value.evaluations) ||
    typeof value.reason !== 'string'
  ) return false;
  return value.evaluations.every((evaluation: unknown) =>
    isRecord(evaluation) &&
    Number.isFinite(evaluation.horizonMinutes) &&
    Number.isFinite(evaluation.actualHorizonMinutes) &&
    typeof evaluation.eligible === 'boolean' &&
    Number.isSafeInteger(evaluation.sampleCount) &&
    (evaluation.netWinRateLowerBoundPct === null ||
      (typeof evaluation.netWinRateLowerBoundPct === 'number' &&
        Number.isFinite(evaluation.netWinRateLowerBoundPct))) &&
    typeof evaluation.reason === 'string'
  );
}

function CandleResearchDetails({ report }: { report: WalkForwardCandleResearchReport }) {
  return (
    <div className="mt-2 space-y-1 border-t border-cyan-950 pt-2 text-[10px] leading-5 text-slate-300">
      <p>
        بازار شواهد {report.exchange ?? 'ناموجود'} · {report.market ?? 'بازار ناموجود'} ·
        {' '}{report.pair ?? 'نماد ناموجود'} ·
        وضعیت {report.status} · تایم‌فریم {report.timeframe ?? 'ناموجود'} · {report.candleCount} کندل ·
        {' '}آموزش/آزمون {report.trainingCandleCount}/{report.testCandleCount} ·
        {' '}برش آموزش {formatTimestamp(report.trainingCutoffTimestampMs)} ·
        {' '}شباهت {report.similarityThresholdPct}% (وزن زمینه {report.contextSimilarityWeightPct}%) ·
        {' '}حداقل {report.requiredReferenceMatches} مرجع و {report.minimumOutOfSampleForecasts} پیش‌بینی خارج‌ازنمونه.
      </p>
      <div className="grid gap-1 md:grid-cols-2">
        {Object.values(report.horizons).map((horizon) => (
          <p key={horizon.horizonMinutes} className="rounded bg-black/20 p-2">
            افق {horizon.horizonMinutes} دقیقه (واقعی {horizon.actualHorizonMinutes} دقیقه):{' '}
            {horizon.available
              ? `${horizon.outOfSampleForecastCount} پیش‌بینی؛ مرجع کافی ${horizon.forecastsWithEnoughMatches}؛ شباهت ${horizon.meanSimilarityPct?.toFixed(1) ?? 'ناموجود'}٪؛ دقت جهت ${horizon.grossDirectionAccuracyPct?.toFixed(1) ?? 'ناموجود'}٪؛ برد ناخالص/خالص ${horizon.grossWinRatePct?.toFixed(1) ?? 'ناموجود'}/${horizon.netWinRatePct?.toFixed(1) ?? 'ناموجود'}٪؛ بازده ناخالص/خالص ${horizon.meanGrossPredictedReturnPct?.toFixed(4) ?? 'ناموجود'}/${horizon.meanNetPredictedReturnPct?.toFixed(4) ?? 'ناموجود'}٪؛ MFE/MAE ${horizon.meanMaximumFavorableMovePct?.toFixed(4) ?? 'ناموجود'}/${horizon.meanMaximumAdverseMovePct?.toFixed(4) ?? 'ناموجود'}٪؛ نسبت پاداش/ریسک پس از هزینه ${horizon.meanCostAdjustedRewardRiskRatio?.toFixed(2) ?? 'ناموجود'}`
              : `${horizon.outOfSampleForecastCount}/${horizon.minimumForecastsForMetrics} پیش‌بینی؛ داده برای گزارش معیار عملکرد کافی نیست.`}
          </p>
        ))}
      </div>
      <p>
        هزینه رفت‌وبرگشت: {'roundTripPercent' in report.costs
          ? `${report.costs.roundTripPercent.toFixed(4)}٪ (کارمزد هر سمت ${report.costs.takerFeeBpsPerSide}bp، لغزش هر سمت ${report.costs.slippageBpsPerSide}bp)`
          : `تنظیم نشده؛ ${report.costs.note}`}
        {' '}· مجاز به معامله: خیر. {report.note}
      </p>
      <p className="text-cyan-200">
        این گزارش پژوهش خارج‌ازنمونه و شاهد کمکی عضو ۱ است؛ به‌تنهایی رأی جهت‌دار یا مجوز معامله تولید نمی‌کند.
      </p>
    </div>
  );
}

function parseAdvisoryResponse(value: unknown): OpenSourceAdvisoryResponse | null {
  if (!isRecord(value) || value.decisionInfluence !== 'ADVISORY_ONLY') return null;
  if (value.report === null) {
    return value.status === 'NOT_RUN' ? { status: 'NOT_RUN', decisionInfluence: 'ADVISORY_ONLY', report: null } : null;
  }
  if (!isRecord(value.report) || !isRecord(value.report.modules)) return null;
  const report = value.report;
  if (
    report.contractVersion !== 'sbk1.open-source-advisories.v1' ||
    !Number.isSafeInteger(report.generatedAtMs) ||
    !Number.isSafeInteger(report.sourceTimestampMs) ||
    !['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'].includes(String(report.status))
  ) return null;
  const modules: Record<string, OpenSourceModuleResult> = {};
  for (const [key] of OPEN_SOURCE_MODULES) {
    const module = report.modules[key];
    if (
      !isRecord(module) ||
      !['AVAILABLE', 'UNAVAILABLE'].includes(String(module.status)) ||
      (module.sourceTimestampMs !== null && !Number.isSafeInteger(module.sourceTimestampMs))
    ) return null;
    modules[key] = module as OpenSourceModuleResult;
  }
  return {
    status: report.status as OpenSourceAdvisoryReport['status'],
    decisionInfluence: 'ADVISORY_ONLY',
    report: {
      contractVersion: 'sbk1.open-source-advisories.v1',
      generatedAtMs: report.generatedAtMs as number,
      sourceTimestampMs: report.sourceTimestampMs as number,
      status: report.status as OpenSourceAdvisoryReport['status'],
      decisionInfluence: 'ADVISORY_ONLY',
      modules,
    },
  };
}

function toEvidence(
  moduleId: string,
  nameFa: string,
  summaryFa: string,
  status: CouncilModuleEvidence['status'],
  sourceTimestampMs: number | null,
  output?: unknown
): CouncilModuleEvidence {
  return { moduleId, nameFa, summaryFa, status, sourceTimestampMs, ...(output === undefined ? {} : { output }) };
}

function advisorySummary(moduleId: string, result: OpenSourceModuleResult): string {
  if (result.status === 'UNAVAILABLE') return String(result.reason ?? 'ماژول متن‌باز دادهٔ معتبر تولید نکرد.');
  if (moduleId.endsWith('candlestickPatterns')) {
    const patterns = Array.isArray(result.patterns) ? result.patterns.filter(isRecord).slice(0, 4) : [];
    return patterns.length
      ? patterns.map((item) => `${String(item.name ?? 'الگو')} (${String(item.direction ?? 'نامشخص')})`).join('، ')
      : 'الگوی کندلی شناخته‌شده‌ای در خروجی ثبت نشده است.';
  }
  if (moduleId.endsWith('marketRegime')) {
    return `رژیم غالب ${String(result.dominantRegime ?? 'نامشخص')}؛ این فقط طبقه‌بندی رژیم است و جهت شورا نیست.`;
  }
  if (moduleId.endsWith('marketAnomaly')) {
    return `طبقه‌بندی ${String(result.classification ?? 'نامشخص')}؛ امتیاز ${String(result.anomalyScore ?? 'ناموجود')}.`;
  }
  if (moduleId.endsWith('Forecast')) {
    return `بازده پیش‌بینی‌شده ${String(result.prediction ?? 'ناموجود')}؛ جهت ${String(result.interpretedDirection ?? 'نامشخص')}؛ کالیبراسیون ${String(result.calibrationStatus ?? 'نامشخص')}.`;
  }
  return `احساس تیتر ${String(result.aggregateSentiment ?? 'ناموجود')}؛ تعداد خبر ${String(result.headlineCount ?? 'ناموجود')}.`;
}

function getBrainValue(report: MultiBrainConsensusReport | null, moduleId: string): Record<string, unknown> | null {
  if (!report) return null;
  const brainById: Record<string, unknown> = {
    'brains.brain01MacroTrend': report.brain1Macro,
    'brains.brain02LiquidityFlow': report.brain2Liquidity,
    'brains.brain03GarchVolatility': report.brain3Volatility,
    'brains.brain04PatternDivergence': report.brain4Pattern,
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
  const value = brainById[moduleId];
  return isRecord(value) ? value : null;
}

function brainSummary(brain: Record<string, unknown>): string {
  const rationale = typeof brain.rationaleFa === 'string' ? brain.rationaleFa : '';
  const measurements = Object.entries(brain)
    .filter(([key, value]) => key !== 'rationaleFa' && key !== 'nameFa' && key !== 'brainType' && key !== 'role')
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
  return [measurements, rationale].filter(Boolean).join(' — ') || 'گزارش این مغز اندازه‌گیری قابل‌نمایشی ندارد.';
}

function hasMeasuredBrainData(brain: Record<string, unknown>, moduleId: string): boolean {
  if (moduleId.endsWith('brain01MacroTrend')) return typeof brain.rawEvidenceScore === 'number';
  if (moduleId.endsWith('brain02LiquidityFlow')) return typeof brain.obiValue === 'number';
  if (moduleId.endsWith('brain03GarchVolatility')) return typeof brain.volatilityForecastPct === 'number';
  if (moduleId.endsWith('brain04PatternDivergence')) return typeof brain.patternMatchPct === 'number';
  if (moduleId.endsWith('brain05FloatingRiskHedging')) return typeof brain.floatingSystemHarmonized === 'boolean';
  if (moduleId.endsWith('brain06OnChainWhaleFlow')) return typeof brain.onChainScorePct === 'number';
  if (moduleId.endsWith('brain07OrderBookCvd')) return brain.isEmpiricalMetric === true && typeof brain.cvdDeltaScore === 'number';
  if (moduleId.endsWith('brain08FundamentalMacro')) return typeof brain.newsOscillatorScore === 'number';
  if (moduleId.endsWith('brain09BayesianProbabilistic')) return typeof brain.calibratedProbabilityPct === 'number';
  if (moduleId.endsWith('brain10AutoPilotHarmonizer')) return typeof brain.feeBufferCovered === 'boolean';
  if (moduleId.endsWith('brain11OnChainWhaleSentiment')) return typeof brain.largeTransactionsCount24h === 'number';
  if (moduleId.endsWith('brain12ExecutionSniper')) return brain.isLiveMeasured === true;
  if (moduleId.endsWith('brain14LossToBreakeven')) return typeof brain.rawEvidenceScore === 'number';
  if (moduleId.endsWith('brain15FrequencyPreserver')) return typeof brain.detectedMicroOpportunities === 'number';
  if (moduleId.endsWith('brain16DrawdownLockout')) return typeof brain.activeLockState === 'boolean';
  if (moduleId.endsWith('brain19LoadReallocator')) return typeof brain.reallocatedCapacityPct === 'number';
  if (moduleId.endsWith('brain20LatencyArbitrage')) return typeof brain.subSecondExecutionMs === 'number';
  if (moduleId.endsWith('brain21StrategicRecovery')) return typeof brain.globalFreezeActive === 'boolean';
  return false;
}

function buildSupportingEvidence(input: {
  analysis: AnalysisResult | null | undefined;
  advisory: OpenSourceAdvisoryReport | null;
  brainReport: MultiBrainConsensusReport | null;
  pillars: IndicatorScoreBreakdown[];
  pentagon: SbPentagonOutput;
  activePositions: TradePosition[];
}): Record<string, CouncilModuleEvidence> {
  const evidence: Record<string, CouncilModuleEvidence> = {};
  const sourceTime = input.advisory?.sourceTimestampMs ?? null;

  for (const [key, nameFa] of OPEN_SOURCE_MODULES) {
    const id = `openSource.${key}`;
    const result = input.advisory?.modules[key];
    const nowMs = Date.now();
    const generatedAgeMs = input.advisory ? nowMs - input.advisory.generatedAtMs : null;
    const sourceAgeMs = input.advisory ? nowMs - input.advisory.sourceTimestampMs : null;
    const moduleAgeMs = result?.sourceTimestampMs === null || result?.sourceTimestampMs === undefined
      ? null
      : nowMs - result.sourceTimestampMs;
    const fresh = generatedAgeMs !== null && generatedAgeMs >= 0 && generatedAgeMs <= 10 * 60_000 &&
      sourceAgeMs !== null && sourceAgeMs >= 0 && sourceAgeMs <= 10 * 60_000 &&
      moduleAgeMs !== null && moduleAgeMs >= 0 && moduleAgeMs <= 10 * 60_000;
    evidence[id] = result
      ? toEvidence(
        id,
        nameFa,
        advisorySummary(id, result),
        !fresh ? 'STALE' : result.status === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
        result.sourceTimestampMs,
      )
      : toEvidence(id, nameFa, 'گزارش توصیه‌گر هنوز به شورا نرسیده است.', 'UNAVAILABLE', sourceTime);
  }

  const modelById = new Map(input.pentagon.models.map((model) => [model.id, model]));
  for (const id of ['SB1', 'SB2', 'SB3', 'SB4'] as const) {
    const moduleId = `sb.${id}`;
    const model = modelById.get(id);
    const relevantFeed = id === 'SB1'
      ? input.analysis?.dataQualityReport?.feeds.candles
      : id === 'SB2'
        ? input.analysis?.dataQualityReport?.feeds.orderBook
        : null;
    const hasSupportingSource = id === 'SB3' || id === 'SB4'
      ? input.activePositions.length > 0
      : !!relevantFeed &&
        (relevantFeed.status === 'LIVE' || relevantFeed.status === 'VERIFIED_REALTIME') &&
        Date.now() - relevantFeed.timestamp >= 0 &&
        Date.now() - relevantFeed.timestamp <= (relevantFeed.maxAgeMs ?? 15_000);
    evidence[moduleId] = model
      ? toEvidence(
        moduleId,
        model.nameFa,
        `${model.roleFa}؛ ${model.metricLabelFa}: ${model.metricValue}؛ وضعیت مدل ${model.status}؛ خروجی کمکی SB و نه رأی مستقل.${hasSupportingSource ? '' : ' منبع معتبر/پوزیشن متناظر حاضر نیست.'}`,
        hasSupportingSource ? 'AVAILABLE' : 'UNAVAILABLE',
        hasSupportingSource
          ? relevantFeed?.timestamp ?? input.analysis?.canonicalSnapshot?.timestampUtc ?? input.analysis?.realObiData?.timestamp ?? null
          : null,
      )
      : toEvidence(moduleId, id, 'خروجی این مدل SB موجود نیست.', 'UNAVAILABLE', null);
  }

  for (const [moduleId, nameFa] of BRAIN_MODULES) {
    const brain = getBrainValue(input.brainReport, moduleId);
    const measured = !!brain && hasMeasuredBrainData(brain, moduleId);
    evidence[moduleId] = brain
      ? toEvidence(
        moduleId,
        nameFa,
        `${brainSummary(brain)}${measured ? ' · خروجی کمکی است و اعتبار مستقل/کالیبراسیون از این گزارش اثبات نمی‌شود.' : ' · سنجهٔ تجربی/زنده برای این خروجی موجود نیست.'}`,
        measured ? 'AVAILABLE' : 'UNAVAILABLE',
        measured ? input.brainReport?.sourceTimestampMs ?? null : null,
      )
      : toEvidence(moduleId, nameFa, 'گزارش تازهٔ معماری مغزها برای این بازار در دسترس نیست.', 'UNAVAILABLE', null);
  }

  const sb5 = modelById.get('SB5');
  evidence['sb.SB5'] = sb5
    ? toEvidence('sb.SB5', sb5.nameFa, `هماهنگ‌ساز مرکزی: ${input.pentagon.masterDecision}؛ هماهنگی ${input.pentagon.harmonizationIndexPct}٪. فقط هماهنگی شورا است و رأی عضو نیست.`, 'AVAILABLE', input.analysis?.canonicalSnapshot?.timestampUtc ?? null)
    : toEvidence('sb.SB5', 'هماهنگ‌سساز SB5', 'هماهنگ‌ساز هنوز خروجی ندارد.', 'UNAVAILABLE', null);

  for (const [key, nameFa] of Object.entries(PILLAR_MODULE_NAMES)) {
    const id = `pillars.${key}`;
    const pillar = input.pillars.find((item) => item.category === key);
    evidence[id] = pillar
      ? toEvidence(id, nameFa, `${pillar.nameFa}: ${pillar.details}؛ امتیاز ${pillar.score}، وزن ${pillar.weight}، ${pillar.passed ? 'گذرانده' : 'نگذرانده'}.`, pillar.available === false ? 'UNAVAILABLE' : 'AVAILABLE', input.analysis?.canonicalSnapshot?.timestampUtc ?? null)
      : toEvidence(id, nameFa, 'رکن در تحلیل فعلی دادهٔ کافی برای خروجی ندارد.', 'UNAVAILABLE', null);
  }

  for (const [key, nameFa] of Object.entries(GATE_MODULE_NAMES)) {
    const id = `gates.${key}`;
    const category = key;
    const gate = input.pillars.find((item) => item.category === category);
    evidence[id] = gate
      ? toEvidence(id, nameFa, `${gate.nameFa}: ${gate.details}؛ وضعیت ${gate.passed ? 'گذرانده' : 'مسدود'}. گیت وتو رأی مستقل نیست.`, gate.available === false ? 'UNAVAILABLE' : 'AVAILABLE', input.analysis?.canonicalSnapshot?.timestampUtc ?? null)
      : toEvidence(id, nameFa, 'وضعیت این رکن/گیت در تحلیل حاضر موجود نیست.', 'UNAVAILABLE', null);
  }

  const mtf = input.analysis?.mtfStructuralReport;
  evidence['technical.mtfStructuralReport'] = mtf
    ? toEvidence(
      'technical.mtfStructuralReport',
      'موتور ساختار چندتایم‌فریمی',
      `${mtf.scenarioFa}؛ وضعیت ${mtf.actionPermission}؛ امتیاز ${mtf.finalUnifiedScore}/100؛ ${mtf.verdictFa}`,
      'AVAILABLE',
      mtf.calculatedAt,
    )
    : toEvidence('technical.mtfStructuralReport', 'موتور ساختار چندتایم‌فریمی', 'گزارش ساختار چندتایم‌فریمی در تحلیل حاضر موجود نیست.', 'UNAVAILABLE', null);

  const derivatives = input.analysis?.cvdOiMatrix;
  evidence['derivatives.cvdOiMatrix'] = derivatives
    ? toEvidence(
      'derivatives.cvdOiMatrix',
      'ماتریس واگرایی CVD/OI',
      `${derivatives.matrixRegimeFa}؛ OI ${derivatives.openInterestChangePct ?? 'ناموجود'}٪، Funding ${derivatives.fundingRatePct ?? 'ناموجود'}٪، CVD ${derivatives.cvdDirection}؛ سنجه‌ها تا وقتی فید مشتقات زنده نباشد شاهد رأی نیستند.`,
      'UNAVAILABLE',
      null,
    )
    : toEvidence('derivatives.cvdOiMatrix', 'ماتریس واگرایی CVD/OI', 'ماتریس مشتقات در تحلیل حاضر موجود نیست.', 'UNAVAILABLE', null);

  const cascade = input.analysis?.liquidationCascadePrediction;
  evidence['derivatives.liquidationCascade'] = cascade
    ? toEvidence(
      'derivatives.liquidationCascade',
      'پیش‌بینی آبشار لیکوییدیشن',
      `ریسک ${cascade.cascadeRiskScore ?? 'ناموجود'}؛ احتمال ${cascade.cascadeProbabilityPct ?? 'ناموجود'}؛ وضعیت ${cascade.cascadeAlertLevel}. برآورد مشتق‌شده، رأی مستقل نیست.`,
      'UNAVAILABLE',
      null,
    )
    : toEvidence('derivatives.liquidationCascade', 'پیش‌بینی آبشار لیکوییدیشن', 'گزارش آبشار لیکوییدیشن در تحلیل حاضر موجود نیست.', 'UNAVAILABLE', null);

  const firewall = newsShockFirewallService.evaluateNewsShockFirewall(input.analysis ?? null);
  evidence['news.shockFirewall'] = toEvidence(
    'news.shockFirewall',
    'دیوار آتش شوک خبری',
    `${firewall.phaseLabelFa}؛ وضعیت ${firewall.actionVerdictLabelFa}؛ ${firewall.directiveFa}. تقویم این ماژول منبع رسمی زنده ندارد؛ بنابراین فقط نمایش تشخیصی است و خبر/رأی معتبر محسوب نمی‌شود.`,
    'UNAVAILABLE',
    null,
  );

  return evidence;
}

export const EightMemberCouncilPanel: React.FC<Props> = ({
  analysis,
  aiPrediction = null,
  currentPrice = 0,
  activePositions = [],
  tradeHistory = [],
  councilReport = null,
}) => {
  const [advisory, setAdvisory] = useState<OpenSourceAdvisoryReport | null>(null);
  const [advisoryError, setAdvisoryError] = useState<string | null>(null);
  const [brainReport, setBrainReport] = useState<MultiBrainConsensusReport | null>(null);
  const [latestExecutionAudit, setLatestExecutionAudit] = useState<ExecutionAuditView | null>(null);
  const [executionAuditError, setExecutionAuditError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      const adminToken = localStorage.getItem('admin_token')?.trim();
      if (!adminToken) {
        setLatestExecutionAudit(null);
        setExecutionAuditError('برای مشاهدهٔ تصمیم‌های ثبت‌شده، ابتدا دسترسی مدیر را وارد کنید.');
        return;
      }
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/freqtrade/execution-audit?limit=30', {
          cache: 'no-store',
          headers: { 'x-admin-token': adminToken },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`خواندن سابقهٔ کنترل مرکزی ناموفق بود (HTTP ${response.status}).`);
        const payload: unknown = await response.json();
        if (!isRecord(payload) || !Array.isArray(payload.records)) {
          throw new Error('ساختار پاسخ سابقهٔ کنترل مرکزی معتبر نیست.');
        }
        const record = payload.records.find((item: unknown): item is ExecutionAuditView =>
          isRecord(item) &&
          typeof item.at === 'string' &&
          (item.decision === 'NO TRADE' || item.decision === 'LONG' || item.decision === 'SHORT') &&
          typeof item.reason === 'string' &&
          isHoldingHorizonDecision(item.holdingHorizon)
        ) ?? null;
        if (!disposed) {
          setLatestExecutionAudit(record);
          setExecutionAuditError(null);
        }
      } catch (error) {
        if (disposed || (error instanceof Error && error.name === 'AbortError')) return;
        console.error('[EightMemberCouncil] Could not load central execution audit:', error);
        if (!disposed) {
          setLatestExecutionAudit(null);
          setExecutionAuditError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/open-source-advisories', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`دریافت خروجی مدل‌های متن‌باز از شورا ناموفق بود (HTTP ${response.status}).`);
        const parsed = parseAdvisoryResponse(await response.json());
        if (!parsed) throw new Error('قرارداد پاسخ مدل‌های متن‌باز برای اتصال به شورا معتبر نیست.');
        if (!disposed) {
          setAdvisory(parsed.report);
          setAdvisoryError(null);
        }
      } catch (error) {
        if (disposed || (error instanceof Error && error.name === 'AbortError')) return;
        console.error('[EightMemberCouncil] Could not load open-source advisory outputs:', error);
        if (!disposed) {
          setAdvisory(null);
          setAdvisoryError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      const sourceTimestamp = analysis?.canonicalSnapshot?.timestampUtc ?? analysis?.realObiData?.timestamp ?? null;
      if (currentPrice <= 0 || sourceTimestamp === null) {
        setBrainReport(null);
        return;
      }
      setBrainReport(getLatestMultiBrainConsensusReport(currentPrice, sourceTimestamp, 60_000));
    };
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(timer);
  }, [analysis?.canonicalSnapshot?.timestampUtc, analysis?.realObiData?.timestamp, currentPrice]);

  const pentagon = useMemo(
    () => sbFiveModelsEngine.evaluatePentagon(analysis ?? null, aiPrediction, currentPrice, activePositions, tradeHistory),
    [analysis, aiPrediction, currentPrice, activePositions, tradeHistory]
  );
  const pillarBreakdown = useMemo(() => {
    if (!analysis) return [];
    return evaluateSignalToExecution(analysis, analysis.direction, aiPrediction, tradeHistory).breakdown;
  }, [analysis, aiPrediction, tradeHistory]);
  const supportingModules = useMemo(() => buildSupportingEvidence({
    analysis,
    advisory,
    brainReport,
    pillars: pillarBreakdown,
    pentagon,
    activePositions,
  }), [analysis, currentPrice, aiPrediction, activePositions, tradeHistory, advisory, brainReport, pillarBreakdown, pentagon]);

  const report = councilReport;
  if (!report) {
    return (
      <CollapsibleCard
        title="شورای ۸ عضو تحلیل بازار"
        badge="در انتظار گزارش سرور"
        badgeColor="text-slate-300 bg-slate-900 border-slate-700"
        defaultOpen={true}
        icon={<Users className="w-5 h-5 text-cyan-300" />}
      >
        <p className="rounded-xl border border-slate-800 bg-[#041124] p-3 text-xs leading-6 text-slate-300">
          رأی شورا فقط پس از ارزیابی سرور و از جریان رویداد تصمیم نمایش داده می‌شود؛ محاسبهٔ مستقل در رابط انجام نمی‌شود.
        </p>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard
      title="شورای ۸ عضو تحلیل بازار"
      badge={`حدنصاب ${report.quorumRequired} از ۸`}
      badgeColor={report.quorumMet
        ? 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40'
        : 'text-amber-300 bg-amber-950/80 border-amber-500/40'}
      defaultOpen={true}
      icon={<Users className="w-5 h-5 text-cyan-300" />}
    >
      <div className="space-y-3 font-sans text-xs">
        <div className="rounded-xl border border-cyan-900/60 bg-[#041124] p-3">
          <p className="font-bold text-cyan-100">رأی مستقل و کنترل کیفیت پیش از رأی</p>
          <p className="mt-1 leading-6 text-slate-300">
            هر ورودی فقط به عضو مالک خودش می‌رود. داده کهنه، شبیه‌سازی‌شده یا ناموجود رأی جهت‌دار نمی‌سازد؛
            NEUTRAL با ABSTAIN متفاوت است. رأی شورا فقط انتخاب جهت است و مجوز اجرای سفارش نیست.
            اطمینان‌های نمایش‌داده‌شده heuristic هستند، نه احتمال کالیبره‌شده.
          </p>
        </div>

        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${
          report.quorumMet ? 'border-emerald-500/40 bg-emerald-950/30' : 'border-amber-500/40 bg-amber-950/20'
        }`}>
          <div className="flex items-center gap-2">
            {report.quorumMet
              ? <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              : <ShieldAlert className="h-5 w-5 text-amber-300" />}
            <span className="font-bold text-white">{report.summaryFa}</span>
          </div>
          <div className="flex gap-2 font-mono text-[10px]">
            <span className="rounded border border-emerald-700/60 px-2 py-1 text-emerald-200">LONG {report.longVotes} ({report.weightedLongVotes?.toFixed(1) ?? report.longVotes})</span>
            <span className="rounded border border-rose-700/60 px-2 py-1 text-rose-200">SHORT {report.shortVotes} ({report.weightedShortVotes?.toFixed(1) ?? report.shortVotes})</span>
            <span className="rounded border border-slate-700 px-2 py-1 text-slate-200">خنثی {report.neutralVotes}</span>
            <span className="rounded border border-amber-700/60 px-2 py-1 text-amber-200">ممتنع {report.abstentions}</span>
          </div>
        </div>
        {advisoryError && (
          <p role="alert" className="rounded-lg border border-rose-800/60 bg-rose-950/30 p-2 text-[10px] text-rose-200">
            اتصال تحلیل‌گرهای متن‌باز به شورا ناموفق است: {advisoryError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {report.members.map((member) => (
            <article key={member.id} className="space-y-2 rounded-xl border border-slate-800 bg-[#030b18] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-white">
                    <span className="mr-1 text-cyan-300">عضو {member.id}:</span>{member.nameFa}
                  </h3>
                  <p className="mt-0.5 text-[10px] text-slate-400">{member.nameEn}</p>
                </div>
                <span className={`rounded-lg border px-2 py-1 font-bold ${VOTE_STYLE[member.vote]}`}>
                  {VOTE_LABEL[member.vote]}
                </span>
              </div>

              <p className="text-[11px] leading-5 text-slate-300">{member.questionFa}</p>
              <p className="text-[11px] leading-5 text-slate-200">{member.rationaleFa}</p>

              <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400">
                <span>زمان داده/خبر: {formatTimestamp(member.sourceTimestampMs)}</span>
                <span>تأخیر: {member.sourceAgeMs === null ? 'ناموجود' : `${Math.round(member.sourceAgeMs)}ms`}</span>
                <span>کیفیت منبع: {member.dataQualityPct === null ? 'گزارش نشده' : `${member.dataQualityPct}/100`}</span>
                <span>اتکای رأی: {member.confidencePct === null ? 'ندارد' : `${member.confidencePct}% · غیرکالیبره`}</span>
              </div>

              <details className="rounded-lg border border-slate-800 bg-black/20 p-2">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-bold text-cyan-200">
                  <CircleHelp className="h-3.5 w-3.5" />
                  کنترل‌های کیفیت و ماژول‌های تحت مالکیت
                </summary>
                <ul className="mt-2 space-y-1 text-[10px] text-slate-300">
                  {member.qualityChecks.map((check) => (
                    <li key={check.labelFa}>
                      <span className={check.passed ? 'text-emerald-300' : 'text-amber-300'}>
                        {check.passed ? '✓ ' : '✗ '}
                      </span>
                      {check.labelFa}: {check.detailFa}
                    </li>
                  ))}
                </ul>
                <ul className="mt-2 space-y-1.5 border-t border-slate-800 pt-2 text-[10px] text-slate-300">
                  {member.supportingEvidence.map((evidence) => (
                    <li key={evidence.moduleId} className="rounded-md bg-slate-950/70 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-bold text-slate-200">{evidence.nameFa}</span>
                        <span className={
                          evidence.status === 'AVAILABLE'
                            ? 'text-emerald-300'
                            : evidence.status === 'STALE'
                              ? 'text-amber-300'
                              : 'text-slate-500'
                        }>
                          {evidence.status}
                        </span>
                      </div>
                      <p className="mt-1 leading-5 text-slate-400">{evidence.summaryFa}</p>
                      <p className="mt-1 text-[9px] text-slate-500">
                        {evidence.moduleId} · {formatTimestamp(evidence.sourceTimestampMs)}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-slate-800 pt-2 text-[10px] leading-5 text-slate-400">
                  ورودی‌های تحت مالکیت یکتا: {member.inputIds.join('، ')}
                </p>
              </details>
            </article>
          ))}
        </div>

        <section className="space-y-2 rounded-xl border border-cyan-800/50 bg-cyan-950/20 p-3">
          <h3 className="font-bold text-cyan-200">کنترل مرکزی · پژوهش و انتخاب افق نگهداری</h3>
          {isCandleResearchReport(brainReport?.historicalCandleResearch) ? (
            <>
              <p className="text-[11px] leading-5 text-cyan-100">
                این پژوهش ورودی انتخاب افق در کنترل مرکزی است؛ عضو اول آن را برای رأی دریافت نمی‌کند.
                انتخاب واقعی فقط پس از حدنصاب شورا و گیت‌های اجرایی انجام می‌شود؛ افق‌های واجد/ردشده و علت هرکدام در authorization و audit همان معامله ثبت می‌شوند.
              </p>
              <CandleResearchDetails report={brainReport.historicalCandleResearch} />
            </>
          ) : (
            <p className="text-[11px] text-amber-200">
              گزارش معتبر پژوهش کندل برای انتخاب افق در دسترس نیست؛ کنترل مرکزی در این حالت مجوز ورود صادر نمی‌کند.
            </p>
          )}
          <div className="mt-2 rounded-lg border border-slate-800 bg-black/20 p-2 text-[10px] leading-5">
            <p className="font-bold text-slate-200">آخرین تصمیم واقعی کنترل مرکزی</p>
            {latestExecutionAudit ? (
              <>
                <p className="text-slate-300">
                  {formatTimestamp(Date.parse(latestExecutionAudit.at))} · {latestExecutionAudit.decision} ·
                  {' '}{latestExecutionAudit.holdingHorizon?.status === 'SELECTED'
                    ? `افق انتخابی ${latestExecutionAudit.holdingHorizon.selectedHorizonMinutes} دقیقه`
                    : 'افقی انتخاب نشد'}
                </p>
                <p className="text-slate-400">
                  بازار اجرا: {latestExecutionAudit.holdingHorizon?.executionMarket
                    ? `${latestExecutionAudit.holdingHorizon.executionMarket.exchange} · ${latestExecutionAudit.holdingHorizon.executionMarket.market} · ${latestExecutionAudit.holdingHorizon.executionMarket.pair}`
                    : 'ناموجود'}؛ منبع پژوهش: {latestExecutionAudit.holdingHorizon?.researchMarket
                      ? `${latestExecutionAudit.holdingHorizon.researchMarket.exchange} · ${latestExecutionAudit.holdingHorizon.researchMarket.market} · ${latestExecutionAudit.holdingHorizon.researchMarket.pair}`
                      : 'ناموجود'}
                </p>
                <p className="text-slate-400">{latestExecutionAudit.holdingHorizon?.reason}</p>
                <ul className="mt-1 space-y-1 text-slate-400">
                  {latestExecutionAudit.holdingHorizon?.evaluations.map((evaluation) => (
                    <li key={evaluation.horizonMinutes}>
                      {evaluation.actualHorizonMinutes} دقیقه · {evaluation.eligible ? 'مجاز' : 'رد'} ·
                      {' '}{evaluation.sampleCount} نمونه · کران پایین نرخ برد {
                        evaluation.netWinRateLowerBoundPct?.toFixed(1) ?? 'ناموجود'
                      }٪ · {evaluation.reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-slate-500">{latestExecutionAudit.reason}</p>
              </>
            ) : (
              <p className="text-amber-300">
                {executionAuditError ?? 'هنوز تصمیم دارای گزارش افق در سابقه ثبت نشده است.'}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-purple-800/50 bg-purple-950/20 p-3">
          <h3 className="font-bold text-purple-200">هماهنگ‌کنندهٔ شورا · خارج از شمارش ۸ رأی</h3>
          {COUNCIL_COORDINATOR_MODULES.map((moduleId) => {
            const module = supportingModules[moduleId];
            return (
              <p key={moduleId} className="mt-1 text-[11px] leading-5 text-slate-300">
                {module?.nameFa ?? moduleId}: {module?.summaryFa ?? 'خروجی در دسترس نیست.'}
              </p>
            );
          })}
        </section>

        <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[10px] leading-5 text-slate-400">
          خروجی مغزها، SB1 تا SB4، مدل‌های متن‌باز و ارکان پایین کارت عضو مالک خودشان نمایش داده می‌شوند و
          فقط شاهد کمکی همان یک رأی هستند؛ SB5 در نقش هماهنگ‌کنندهٔ مرکزی و بیرون از شمارش رأی قرار دارد.
          پژوهش الگوهای تاریخی و انتخاب مدت نگهداری در کنترل مرکزی انجام می‌شوند؛ این فرایند رأی جداگانه نمی‌سازد.
          اعضای ریسک/مشتقات و مدل‌های دیگر رأی جداگانهٔ اضافه نمی‌سازند. دادهٔ اختیار معامله
          تا زمان اتصال فید معتبر ممتنع می‌ماند؛ اخبار نیز فقط با خبر تازه و امتیاز سنتیمنت زنده حق رأی دارد.
          زمان ارزیابی: {formatTimestamp(report.evaluatedAtMs)}
        </p>
      </div>
    </CollapsibleCard>
  );
};
