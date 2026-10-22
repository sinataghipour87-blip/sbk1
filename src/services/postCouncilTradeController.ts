import type { AnalysisResult } from '../types/trading';
import type { EightMemberCouncilReport } from './eightMemberCouncil';
import { calculateCentralRiskAllocation } from './centralRiskAllocation';

export interface PostCouncilTradeControlInput {
  analysis: AnalysisResult;
  council: EightMemberCouncilReport;
  balance: number;
  maxStakeQuote: number;
  maxLeverage: number;
  riskBudgetPct: number;
  referencePrice: number;
  maxDeviationBps: number;
  maxOpenTrades: number;
  openRiskUsd: number;
  dailyLossUsd: number;
  dailyLossLimitPct: number;
  nowMs?: number;
}

export interface CentralExecutionGate {
  id: string;
  passed: boolean;
  reason: string;
}

export interface CentralExecutionPlan {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  setupType: string;
}

export interface PostCouncilTradeControlResult {
  approved: boolean;
  reason: string;
  direction: 'LONG' | 'SHORT' | null;
  executionPlan?: CentralExecutionPlan;
  executionRisk?: {
    maxStakeQuote: number;
    maxLeverage: number;
    allocatedRiskUsd: number;
  };
  gates: CentralExecutionGate[];
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validateCouncilReport(report: EightMemberCouncilReport): string | null {
  const reportValue: unknown = report;
  if (
    typeof reportValue !== 'object' ||
    reportValue === null ||
    !Array.isArray((reportValue as { members?: unknown }).members)
  ) return 'گزارش شورا ساختار معتبری ندارد.';
  const members = (reportValue as { members: unknown[] }).members;
  const validVotes = new Set(['LONG', 'SHORT', 'NEUTRAL', 'ABSTAIN']);
  if (!members.every((member) =>
    typeof member === 'object' &&
    member !== null &&
    Number.isSafeInteger((member as { id?: unknown }).id) &&
    validVotes.has(String((member as { vote?: unknown }).vote))
  )) return 'گزارش شورا شامل شناسه یا رأی نامعتبر عضو است.';
  const votes = members.map((member) => (member as { vote: string }).vote);
  const longVotes = votes.filter((vote) => vote === 'LONG').length;
  const shortVotes = votes.filter((vote) => vote === 'SHORT').length;
  const neutralVotes = votes.filter((vote) => vote === 'NEUTRAL').length;
  const abstentions = votes.filter((vote) => vote === 'ABSTAIN').length;
  const memberIds = new Set(members.map((member) => (member as { id: number }).id));
  const expectedDirection = longVotes >= 5 ? 'LONG' : shortVotes >= 5 ? 'SHORT' : null;

  if (
    report.quorumRequired !== 5 ||
    report.members.length !== 8 ||
    memberIds.size !== 8 ||
    ![1, 2, 3, 4, 5, 6, 7, 8].every((id) => memberIds.has(id)) ||
    report.longVotes !== longVotes ||
    report.shortVotes !== shortVotes ||
    report.neutralVotes !== neutralVotes ||
    report.abstentions !== abstentions ||
    report.quorumMet !== (expectedDirection !== null) ||
    report.selectedDirection !== expectedDirection
  ) return 'گزارش شورا ناقص یا ناسازگار است؛ شمار رأی‌ها و جهت اعلام‌شده تطبیق ندارد.';

  if (!expectedDirection) return 'حدنصاب ۵ رأی هم‌جهت از ۸ عضو حاصل نشده است.';
  return null;
}

export function runPostCouncilTradeControl(
  input: PostCouncilTradeControlInput,
): PostCouncilTradeControlResult {
  const nowMs = input.nowMs ?? Date.now();
  const gates: CentralExecutionGate[] = [];
  const addGate = (id: string, passed: boolean, reason: string) => {
    gates.push({ id, passed, reason });
  };
  const reject = (reason: string): PostCouncilTradeControlResult => ({
    approved: false,
    reason,
    direction: input.council?.selectedDirection ?? null,
    gates,
  });

  const councilError = validateCouncilReport(input.council);
  addGate('COUNCIL_REPORT', councilError === null, councilError ?? 'گزارش و حدنصاب شورا معتبر است.');
  if (councilError) return reject(councilError);
  const direction = input.council.selectedDirection!;

  const quality = input.analysis.dataQualityReport;
  const candleFeed = quality?.feeds.candles;
  const candleAgeMs = candleFeed
    ? nowMs - candleFeed.timestamp
    : Number.POSITIVE_INFINITY;
  const maxCandleAgeMs = candleFeed?.maxAgeMs ?? 15_000;
  const dataIsFresh = ['LIVE', 'VERIFIED_REALTIME'].includes(input.analysis.dataStatus) &&
    quality?.status === 'LIVE' &&
    quality.isTradeAllowed &&
    Number.isFinite(quality.overallScore) &&
    quality.overallScore >= 50 &&
    candleFeed !== undefined &&
    ['LIVE', 'VERIFIED_REALTIME'].includes(candleFeed.status) &&
    Number.isFinite(candleAgeMs) &&
    candleAgeMs >= 0 &&
    candleAgeMs <= maxCandleAgeMs &&
    Array.isArray(input.analysis.candles) &&
    input.analysis.candles.length >= 30;
  const ticker = input.analysis.futuresPrices;
  const tickerFeed = quality?.feeds.futuresPrices;
  const tickerAgeMs = ticker ? nowMs - ticker.receivedTimestampMs : Number.POSITIVE_INFINITY;
  const tickerExchangeTimeValid = ticker?.exchangeTimestampUtc === null ||
    (Number.isSafeInteger(ticker?.exchangeTimestampUtc) &&
      ticker.exchangeTimestampUtc <= nowMs + 1_000 &&
      nowMs - ticker.exchangeTimestampUtc <= 5_000);
  const tickerIsFresh = ticker?.status === 'LIVE' &&
    tickerFeed?.status === 'LIVE' &&
    Number.isSafeInteger(ticker.receivedTimestampMs) &&
    Number.isFinite(tickerAgeMs) &&
    tickerAgeMs >= 0 &&
    tickerAgeMs <= Math.min(tickerFeed.maxAgeMs ?? 5_000, 5_000) &&
    tickerExchangeTimeValid &&
    isFinitePositive(ticker.lastPrice) &&
    isFinitePositive(ticker.markPrice) &&
    isFinitePositive(ticker.indexPrice);
  const orderBook = input.analysis.realObiData;
  const orderBookFeed = quality?.feeds.orderBook;
  const orderBookAgeMs = orderBook ? nowMs - orderBook.timestamp : Number.POSITIVE_INFINITY;
  const orderBookIsFresh = orderBook?.status === 'LIVE' &&
    orderBookFeed?.status === 'LIVE' &&
    Number.isSafeInteger(orderBook.timestamp) &&
    typeof orderBook.source === 'string' &&
    orderBook.source.trim().length > 0 &&
    Number.isFinite(orderBookAgeMs) &&
    orderBookAgeMs >= 0 &&
    orderBookAgeMs <= Math.min(orderBookFeed.maxAgeMs ?? 5_000, 5_000) &&
    isFinitePositive(orderBook.bestBid) &&
    isFinitePositive(orderBook.bestAsk) &&
    orderBook.bestAsk >= orderBook.bestBid;
  const orderFlow = input.analysis.orderFlowFeatures;
  const orderFlowFeed = quality?.feeds.orderFlow;
  const orderFlowAgeMs = orderFlow ? nowMs - (orderFlow.timestampUtc ?? Number.NaN) : Number.POSITIVE_INFINITY;
  const orderFlowIsFresh = orderFlow?.status === 'LIVE' &&
    orderFlow.isRealTradeFlow === true &&
    orderFlowFeed?.status === 'LIVE' &&
    Number.isSafeInteger(orderFlow.timestampUtc) &&
    Number.isFinite(orderFlow.cvdDelta) &&
    Number.isFinite(orderFlow.takerBuyVol) &&
    Number.isFinite(orderFlow.takerSellVol) &&
    Number.isFinite(orderFlowAgeMs) &&
    orderFlowAgeMs >= 0 &&
    orderFlowAgeMs <= Math.min(orderFlowFeed.maxAgeMs ?? 30_000, 30_000);
  const executionDataIsFresh = tickerIsFresh && orderBookIsFresh && orderFlowIsFresh;
  const allRequiredLiveDataIsFresh = dataIsFresh && executionDataIsFresh;
  addGate(
    'LIVE_DATA',
    allRequiredLiveDataIsFresh,
    allRequiredLiveDataIsFresh
      ? `کندل، ticker، دفتر سفارش و جریان معاملات زنده‌اند؛ سن کندل ${Math.round(candleAgeMs)}ms.`
      : 'یکی از فیدهای کندل، ticker، دفتر سفارش یا جریان معاملات ناموجود، نامعتبر یا کهنه است.',
  );
  if (!allRequiredLiveDataIsFresh) return reject('کنترل مرکزی به‌دلیل دادهٔ نامعتبر یا کهنه ورود را رد کرد.');

  const price = input.analysis.price;
  const referencePriceValid = isFinitePositive(price) &&
    isFinitePositive(input.referencePrice) &&
    Math.abs(price - input.referencePrice) / input.referencePrice * 10_000 <= input.maxDeviationBps;
  addGate(
    'REFERENCE_PRICE',
    referencePriceValid,
    referencePriceValid
      ? 'قیمت تحلیل با قیمت مرجع در محدودهٔ انحراف مجاز است.'
      : 'قیمت نامعتبر است یا از حد انحراف مجاز نسبت به قیمت مرجع عبور کرده است.',
  );
  if (!referencePriceValid) return reject('کنترل مرکزی قیمت مرجع یا انحراف ورود را نپذیرفت.');

  const bid = orderBook?.bestBid;
  const ask = orderBook?.bestAsk;
  const midpoint = typeof bid === 'number' && typeof ask === 'number' ? (bid + ask) / 2 : Number.NaN;
  const spreadBps = typeof bid === 'number' && typeof ask === 'number' && midpoint > 0
    ? (ask - bid) / midpoint * 10_000
    : Number.NaN;
  const spreadValid = Number.isFinite(spreadBps) && spreadBps >= 0 && spreadBps <= 8;
  addGate(
    'EXECUTION_SPREAD',
    spreadValid,
    spreadValid
      ? `اسپرد واقعی bid/ask برابر ${spreadBps.toFixed(2)}bps و در محدودهٔ مجاز است.`
      : 'اسپرد واقعی bid/ask ناموجود، نامعتبر یا بیشتر از سقف ۸bps است.',
  );
  if (!spreadValid) return reject('کنترل مرکزی اسپرد اجرایی را نپذیرفت.');

  const setup = input.analysis.setupContext;
  const entryPrice = setup?.actualExecutableEntry ??
    input.analysis.pullbackLimitPrice ??
    price;
  const stopLoss = input.analysis.sl;
  const takeProfit = input.analysis.tp1;
  const levelsValid = isFinitePositive(entryPrice) &&
    isFinitePositive(stopLoss) &&
    isFinitePositive(takeProfit) &&
    (direction === 'LONG'
      ? stopLoss < entryPrice && takeProfit > entryPrice
      : stopLoss > entryPrice && takeProfit < entryPrice);
  if (!levelsValid) {
    addGate('TRADE_LEVELS', false, 'سطح ورود، حدضرر یا هدف معتبر و سازگار با جهت شورا موجود نیست.');
    return reject('کنترل مرکزی سطوح ورود/حدضرر/هدف را برای جهت شورا معتبر ندانست.');
  }

  const stopFraction = Math.abs(entryPrice - stopLoss) / entryPrice;
  const riskRewardRatio = Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss);
  const stopDistancePct = stopFraction * 100;
  const stopAndTargetValid = stopDistancePct >= 0.25 &&
    stopDistancePct <= 4.8 &&
    Number.isFinite(riskRewardRatio) &&
    riskRewardRatio >= 1;
  addGate(
    'STOP_AND_TARGET',
    stopAndTargetValid,
    stopAndTargetValid
      ? `حدضرر ${stopDistancePct.toFixed(2)}٪ و نسبت سود/ریسک ${riskRewardRatio.toFixed(2)} معتبر است.`
      : 'فاصلهٔ حدضرر باید بین ۰٫۲۵٪ تا ۴٫۸٪ و نسبت سود/ریسک حداقل ۱ باشد.',
  );
  if (!stopAndTargetValid) return reject('کنترل مرکزی حدود ریسک و هدف معامله را نپذیرفت.');

  const riskContextIsValid =
    Number.isSafeInteger(input.maxOpenTrades) &&
    input.maxOpenTrades > 0 &&
    Number.isFinite(input.openRiskUsd) &&
    input.openRiskUsd >= 0 &&
    Number.isFinite(input.dailyLossUsd) &&
    input.dailyLossUsd >= 0 &&
    Number.isFinite(input.dailyLossLimitPct) &&
    input.dailyLossLimitPct > 0 &&
    input.dailyLossLimitPct <= 5;
  const maxPortfolioRiskUsd = input.balance * input.riskBudgetPct / 100 * input.maxOpenTrades;
  const maxDailyLossUsd = input.balance * input.dailyLossLimitPct / 100;
  const portfolioRiskAvailable = riskContextIsValid &&
    Number.isFinite(maxPortfolioRiskUsd) &&
    input.openRiskUsd < maxPortfolioRiskUsd;
  const dailyLossAvailable = riskContextIsValid &&
    Number.isFinite(maxDailyLossUsd) &&
    input.dailyLossUsd + input.openRiskUsd < maxDailyLossUsd;
  addGate(
    'PORTFOLIO_RISK',
    portfolioRiskAvailable,
    portfolioRiskAvailable
      ? `ریسک باز ${input.openRiskUsd.toFixed(2)} از سقف پرتفوی ${maxPortfolioRiskUsd.toFixed(2)} دلار کمتر است.`
      : 'ریسک باز پرتفوی نامعتبر است یا به سقف مجاز رسیده است.',
  );
  addGate(
    'DAILY_LOSS',
    dailyLossAvailable,
    dailyLossAvailable
      ? `زیان تحقق‌یافتهٔ روز و ریسک باز ${input.dailyLossUsd.toFixed(2)} + ${input.openRiskUsd.toFixed(2)} دلار زیر سقف ${maxDailyLossUsd.toFixed(2)} دلار است.`
      : 'زیان روزانه یا ریسک باز نامعتبر است یا سقف زیان روزانه پر شده است.',
  );
  if (!portfolioRiskAvailable || !dailyLossAvailable) {
    return reject('کنترل مرکزی به‌دلیل محدودیت ریسک پرتفوی یا زیان روزانه ورود را رد کرد.');
  }

  const allocation = calculateCentralRiskAllocation({
    balance: input.balance,
    maxStakeQuote: input.maxStakeQuote,
    maxLeverage: input.maxLeverage,
    riskBudgetPct: input.riskBudgetPct,
    stopFraction,
    availableRiskBudgetUsd: Math.min(
      input.balance * input.riskBudgetPct / 100,
      maxPortfolioRiskUsd - input.openRiskUsd,
      maxDailyLossUsd - input.dailyLossUsd - input.openRiskUsd,
    ),
  });
  const allocationValid = allocation !== null &&
    allocation.marginUsd >= 5 &&
    allocation.marginUsd <= input.maxStakeQuote &&
    allocation.marginUsd <= input.balance;
  addGate(
    'RISK_ALLOCATION',
    allocationValid,
    allocationValid
      ? `تخصیص ریسک معتبر است؛ مارجین ${allocation.marginUsd.toFixed(2)} و اهرم ${allocation.leverage}x.`
      : 'موجودی، سقف سرمایه، اهرم یا بودجهٔ ریسک برای تخصیص ایمن کافی/معتبر نیست.',
  );
  if (!allocationValid || !allocation) return reject('کنترل مرکزی نتوانست تخصیص ریسک ایمن بسازد.');

  const executionPlan: CentralExecutionPlan = {
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    riskRewardRatio,
    setupType: setup?.setupType ?? 'COUNCIL_DIRECTION',
  };
  return {
    approved: true,
    reason: `گزارش شورا معتبر است؛ گیت‌های داده، قیمت، اسپرد، سطوح و ریسک پاس شدند. طرح اجرایی با جهت ${direction} آمادهٔ ارسال به Freqtrade است.`,
    direction,
    executionPlan,
    executionRisk: {
      maxStakeQuote: allocation.marginUsd,
      maxLeverage: allocation.leverage,
      allocatedRiskUsd: allocation.allocatedRiskUsd,
    },
    gates,
  };
}
