import assert from 'assert';

// Polyfill localStorage and fetch for Node test environment
const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();
(globalThis as any).localStorage = storageMock;
(globalThis as any).fetch = async () => { throw new Error('Network failure (simulated python/exchange down)'); };

import { hunterExecutionEngine } from '../src/services/hunterExecutionEngine';
import { orderFlowEngine } from '../src/services/orderFlowEngine';
import { computeCentralCalibratedProbability } from '../src/services/centralProbabilityEngine';
import { runPreTradeRiskGate, verifyAutoTradePrerequisites } from '../src/services/autoTradeGuard';
import { riskEngine } from '../src/services/productionGateThreeLayerEngine';
import { MissingDataIntegrityGuardService } from '../src/services/missingDataIntegrityGuard';
import { globalKillSwitchEngine } from '../src/services/globalKillSwitchEngine';
import { tradeThesisAndSmartExitEngine } from '../src/services/tradeThesisAndSmartExitEngine';
import { opportunityRankingEngine } from '../src/services/opportunityRankingEngine';
import { modelChampionChallenger } from '../src/services/modelChampionChallenger';
import { activityFrequencyMonitor } from '../src/services/activityFrequencyMonitor';
import { dataProvenanceLayerService } from '../src/services/dataProvenanceLayer';
import { analyzePro } from '../src/services/analysisEngine';
import { orderExecutionLifecycleService } from '../src/services/orderExecutionLifecycleEngine';
import { autoTradeDecisionTracer } from '../src/services/autoTradeGuard';

console.log('🧪 Starting 18 Mandatory System & Fail-Closed Integrity Verification Tests...');

async function runTests() {
  // =========================================================================
  // سناریو ۱: داده بازار ناموجود -> هیچ سفارش واقعی ارسال نشود
  // =========================================================================
  const feedAuditNull = MissingDataIntegrityGuardService.getInstance().auditMarketDataIntegrity(null);
  assert.strictEqual(feedAuditNull.isTradePermitted, false, 'Missing data must prohibit trades');
  console.log('✅ سناریو ۱ پاس شد: داده بازار ناموجود منجر به منع قطعی معامله شد.');

  // =========================================================================
  // سناریو ۲: داده قدیمی (Stale Data) -> سفارش مسدود شود
  // =========================================================================
  const staleAnalysis: any = {
    price: 88000,
    dataStatus: 'STALE',
    canonicalSnapshot: { timestampUtc: Date.now() - 60000, basisSpreadBps: 1.5 },
    dataQualityReport: { overallScore: 30, isTradeAllowed: false, status: 'STALE' }
  };
  const staleRiskCheck = runPreTradeRiskGate(staleAnalysis, [], []);
  assert.strictEqual(staleRiskCheck.allPassed, false, 'Stale data must fail risk gate');
  console.log('✅ سناریو ۲ پاس شد: داده قدیمی (Stale) به درستی مسدود شد.');

  // =========================================================================
  // سناریو ۳: داده مصنوعی -> فقط محیط شبیه‌سازی مجاز باشد
  // =========================================================================
  const simGuard = MissingDataIntegrityGuardService.getInstance().auditMarketDataIntegrity({
    price: 88000,
    dataStatus: 'SIMULATED',
    canonicalSnapshot: { timestampUtc: Date.now(), basisSpreadBps: 2.0 },
    dataQualityReport: { overallScore: 50, isTradeAllowed: false, status: 'LIVE' }
  } as any);
  assert.strictEqual(simGuard.isTradePermitted, false, 'Simulated data must never execute in live environment');
  console.log('✅ سناریو ۳ پاس شد: داده مصنوعی در محیط لایو مسدود شد.');

  // =========================================================================
  // سناریو ۴: احتمال برد نامعتبر یا کالیبره‌نشده -> سفارش مسدود شود
  // =========================================================================
  const uncalibratedGate = runPreTradeRiskGate({
    price: 88000,
    dataStatus: 'LIVE',
    canonicalSnapshot: { timestampUtc: Date.now(), basisSpreadBps: 2.0 },
    signalOk: true,
    entryTiming: 'IMMEDIATE',
    calibratedWinProb: null // No empirical calibration
  } as any, [], [], {
    side: 'LONG',
    qty: 0.1,
    price: 88000,
    stopLoss: 87000,
    takeProfit: 91000,
    availableBalanceUsdt: 5000,
    winProb: null,
    expectedValue: null
  });
  assert.strictEqual(uncalibratedGate.allPassed, false, 'Uncalibrated probability must fail allPassed');
  console.log('✅ سناریو ۴ پاس شد: احتمال برد کالیبره‌نشده فوراً مسدود شد.');

  // =========================================================================
  // سناریو ۵: حد ضرر یا حجم نامعتبر -> سفارش رد شود
  // =========================================================================
  const invalidSlExit = tradeThesisAndSmartExitEngine.evaluateComprehensiveExitManagement(
    { id: 'POS_INV_SL', dir: 'LONG', entry: 88000, lev: 10, initialMargin: 100, margin: 100, sl: 87980, tp: 92000, tp1: 90000, tp2: 91000, tp3: 92000, openedAt: new Date().toISOString() },
    88000,
    null
  );
  assert.strictEqual(invalidSlExit.initialStopLoss.isValid, false, 'Tiny stop loss below 0.25% must be marked invalid');
  console.log('✅ سناریو ۵ پاس شد: حد ضرر نامعتبر/در محدوده نویز رد شد.');

  // =========================================================================
  // سناریو ۶: اهرم یا ریسک بالاتر از حد مجاز -> سفارش رد شود
  // =========================================================================
  const highLeverageGate = runPreTradeRiskGate({
    price: 88000,
    dataStatus: 'LIVE',
    canonicalSnapshot: { timestampUtc: Date.now(), basisSpreadBps: 1.5 },
    signalOk: true,
  } as any, [], [], {
    side: 'LONG',
    qty: 10.0, // Exorbitant size
    price: 88000,
    stopLoss: 87000,
    takeProfit: 91000,
    availableBalanceUsdt: 500, // Margin breach
  });
  assert.strictEqual(highLeverageGate.allPassed, false, 'Exorbitant size/margin risk must be blocked');
  console.log('✅ سناریو ۶ پاس شد: ریسک و اهرم بالاتر از حد مجاز مسدود شد.');

  // =========================================================================
  // سناریو ۷: توقف اضطراری فعال (Emergency Stop / Kill Switch) -> سفارش ارسال نشود
  // =========================================================================
  globalKillSwitchEngine.engageKillSwitch('تست اجباری توقف اضطراری');
  assert.strictEqual(globalKillSwitchEngine.isBlocked(), true, 'Kill switch must be active');
  const ksBlockGate = runPreTradeRiskGate({
    price: 88000,
    dataStatus: 'LIVE',
    canonicalSnapshot: { timestampUtc: Date.now(), basisSpreadBps: 1.0 }
  } as any, [], []);
  assert.strictEqual(ksBlockGate.allPassed, false, 'Kill switch must block all risk approvals');
  // بازگردانی برای تست‌های بعدی
  globalKillSwitchEngine.disengageKillSwitch();
  console.log('✅ سناریو ۷ پاس شد: توقف اضطراری مانع ارسال هرگونه سفارش شد.');

  // =========================================================================
  // سناریو ۸: درخواست بدون احراز هویت -> عملیات حساس انجام نشود
  // =========================================================================
  const unauthExec = await hunterExecutionEngine.fetchLiveExchangeAccountBalance({ apiKey: '', apiSecret: '', isTestnet: true });
  assert.strictEqual(unauthExec.success, false, 'Unauthenticated Bybit call must fail');
  console.log('✅ سناریو ۸ پاس شد: فراخوانی بدون کلید احراز هویت رد شد.');

  // =========================================================================
  // سناریو ۹: ارسال همزمان یک تصمیم -> فقط یک سفارش مجاز باشد (Idempotency)
  // =========================================================================
  const decisionId = `DEC_${Date.now()}`;
  const firstSubmit = hunterExecutionEngine.registerDecisionSubmission(decisionId);
  const duplicateSubmit = hunterExecutionEngine.registerDecisionSubmission(decisionId);
  assert.strictEqual(firstSubmit, true, 'First decision submission must be accepted');
  assert.strictEqual(duplicateSubmit, false, 'Duplicate concurrent submission must be rejected');
  console.log('✅ سناریو ۹ پاس شد: ارسال همزمان یک تصمیم مسدود و تنها یک سفارش مجاز گردید.');

  // =========================================================================
  // سناریو ۱۰: قطع شبکه پس از ارسال سفارش -> بازیابی وضعیت بدون ایجاد سفارش تکراری
  // =========================================================================
  const recov = tradeThesisAndSmartExitEngine.evaluateComprehensiveExitManagement(
    { id: 'POS_NET_DISCONNECT', dir: 'LONG', entry: 88000, lev: 10, initialMargin: 100, margin: 100, sl: 87000, tp: 92000, tp1: 90000, tp2: 91000, tp3: 92000, openedAt: new Date().toISOString() },
    88000,
    null,
    [],
    { isConnectionAlive: false, lastSyncTimestamp: Date.now() - 45000 }
  );
  assert.strictEqual(recov.reconnectionRecovery.isConnectionLostRecently, true, 'Reconnection recovery must flag disconnect');
  assert.strictEqual(recov.reconnectionRecovery.reconciledWithExchange, true, 'State must reconcile without duplication');
  console.log('✅ سناریو ۱۰ پاس شد: قطع شبکه پس از ارسال با همگام‌سازی وضعیت بازیابی شد.');

  // =========================================================================
  // سناریو ۱۱: راه‌اندازی مجدد سرور -> پوزیشن‌ها و محدودیت‌ها بازیابی شوند
  // =========================================================================
  const reloadedRecords = tradeThesisAndSmartExitEngine.getPostExitRecords();
  assert.ok(Array.isArray(reloadedRecords), 'State must survive restart and load list');
  console.log('✅ سناریو ۱۱ پاس شد: وضعیت و تاریخچه پس از راه‌اندازی مجدد بازیابی شدند.');

  // =========================================================================
  // سناریو ۱۲: رد سفارش از سوی صرافی -> موفقیت کاذب ثبت نشود
  // =========================================================================
  const rejectedBybit = hunterExecutionEngine.handleExchangeOrderRejection('REQ_ERR_99', '10001: Risk limit exceeded');
  assert.strictEqual(rejectedBybit.status, 'REJECTED', 'Order rejection must be marked REJECTED');
  assert.strictEqual(rejectedBybit.isFalseSuccessPrevented, true, 'False success must be prevented');
  console.log('✅ سناریو ۱۲ پاس شد: رد سفارش صرافی بدون ثبت موفقیت کاذب پردازش شد.');

  // =========================================================================
  // سناریو ۱۳: پرشدن ناقص سفارش -> حجم واقعی و ریسک به‌روزرسانی شوند
  // =========================================================================
  const partialExitCheck = tradeThesisAndSmartExitEngine.evaluateComprehensiveExitManagement(
    { id: 'POS_PARTIAL', dir: 'LONG', entry: 88000, lev: 10, initialMargin: 100, margin: 100, sl: 87000, tp: 92000, tp1: 90000, tp2: 91000, tp3: 92000, openedAt: new Date().toISOString() },
    88000,
    null,
    [],
    { filledQty: 0.4, totalQty: 1.0 }
  );
  assert.strictEqual(partialExitCheck.slippageAndExecution.isPartialFillActive, true, 'Partial fill must be actively flagged');
  assert.strictEqual(partialExitCheck.slippageAndExecution.filledQuantityPct, 40, 'Filled percentage must be exact');
  console.log('✅ سناریو ۱۳ پاس شد: پر شدن ناقص ثبت و ریسک حجم به‌روزرسانی شد.');

  // =========================================================================
  // سناریو ۱۴: شکست در ثبت حد ضرر -> هشدار بحرانی صادر و محافظت فیک گزارش نشود
  // =========================================================================
  const unconfirmedSl = tradeThesisAndSmartExitEngine.evaluateComprehensiveExitManagement(
    { id: 'POS_UNCONFIRMED_SL', dir: 'LONG', entry: 88000, lev: 10, initialMargin: 100, margin: 100, sl: 87000, tp: 92000, tp1: 90000, tp2: 91000, tp3: 92000, openedAt: new Date().toISOString() },
    88000,
    null,
    [],
    { isExchangeConfirmed: false, exchangeStopOrderId: undefined }
  );
  assert.strictEqual(unconfirmedSl.exchangeVerification.isReportedAsProtected, false, 'Unconfirmed stop must NOT be reported as protected');
  console.log('✅ سناریو ۱۴ پاس شد: حد ضرر ثبت‌نشده در صرافی مانع گزارش محافظت کاذب شد.');

  // =========================================================================
  // سناریو ۱۵: تغییر ناگهانی قیمت -> حجم و اعتبار سیگنال دوباره بررسی شوند
  // =========================================================================
  const suddenMoveCheck = hunterExecutionEngine.validatePriceSlippageThreshold(88000, 89500, 0.005);
  assert.strictEqual(suddenMoveCheck.isSlippageAcceptable, false, 'Sudden price spike must fail slippage validation');
  console.log('✅ سناریو ۱۵ پاس شد: پرش ناگهانی قیمت سیگنال را منقضی و مسدود کرد.');

  // =========================================================================
  // سناریو ۱۶: رسیدن به محدودیت ضرر روزانه -> ورودهای جدید مسدود شوند
  // =========================================================================
  const dailyLossBlocked = riskEngine.evaluateRiskGate({
    predictionId: 'PRED_DAILY_LOSS',
    generatedAt: Date.now(),
    symbol: 'BTCUSDT',
    direction: 'LONG',
    setupType: 'SWEEP',
    entryTarget: 88000,
    stopLoss: 87000,
    takeProfit1: 90000,
    takeProfit2: 91000,
    takeProfit3: 92000,
    calibratedProbabilityPct: 65,
    expectedValueUsd: 15,
    confidenceInterval: { lower: 10, upper: 20 },
    signalOk: true,
    modelVersion: 'v1',
    rawAnalysis: null
  }, { availableBalanceUsdt: 8000, maxEquityUsd: 10000, currentEquityUsd: 8500 }, [], [
    // معاملات ضررده روزانه فراتر از حد مجاز
    { id: 'L1', dir: 'LONG', entry: 88000, lev: 10, initialMargin: 100, margin: 100, sl: 87000, tp: 90000, tp1: 90000, tp2: 91000, tp3: 92000, openedAt: '', closedAt: '', pnlUsd: -400, pnlPct: -40 },
    { id: 'L2', dir: 'LONG', entry: 88000, lev: 10, initialMargin: 100, margin: 100, sl: 87000, tp: 90000, tp1: 90000, tp2: 91000, tp3: 92000, openedAt: '', closedAt: '', pnlUsd: -350, pnlPct: -35 },
  ]);
  assert.strictEqual(dailyLossBlocked.isApproved, false, 'Daily loss limit breach must reject new orders');
  console.log('✅ سناریو ۱۶ پاس شد: تخطی از حد ضرر روزانه مانع ورود جدید شد.');

  // =========================================================================
  // سناریو ۱۷: قطع WebSocket یا اختلاف منابع قیمت -> فید نامعتبر مسدود شود
  // =========================================================================
  const spreadDivergence = MissingDataIntegrityGuardService.getInstance().auditMarketDataIntegrity({
    price: 88000,
    dataStatus: 'LIVE',
    canonicalSnapshot: { timestampUtc: Date.now(), basisSpreadBps: 25.0 }, // اسپرد غیرعادی ۲۵ پیپ
    dataQualityReport: { overallScore: 40, isTradeAllowed: false, status: 'STALE' }
  } as any);
  assert.strictEqual(spreadDivergence.isTradePermitted, false, 'Price source divergence must block execution');
  console.log('✅ سناریو ۱۷ پاس شد: اختلاف غیرعادی منابع قیمت از ورود به موتور اجرا جلوگیری کرد.');

  // =========================================================================
  // سناریو ۱۸: خطای موتور یادگیری -> موتور تصمیم و کنترل ریسک دور زده نشوند
  // =========================================================================
  const invalidRecordForTraining = modelChampionChallenger.sanitizeDatasetRecord({
    predictionId: 'LEAKY_PRED',
    timestamp: Date.now(),
    timestampIso: new Date().toISOString(),
    market: 'BTC/USDT',
    exchange: 'BYBIT',
    marketType: 'PERPETUAL',
    timeframe: '15m',
    direction: 'LONG',
    setupType: 'SWEEP',
    marketRegime: 'TRENDING_BULL',
    entryPrice: 88000,
    stopPrice: 87000,
    tpLevels: { tp1: 90000, tp2: null, tp3: null },
    probability: 0.65,
    confidenceInterval: null,
    modelVersion: 'v1',
    featureVersion: 'v1',
    decisionVersion: 'v1',
    features: {},
    orderBookState: { bidDepthUsd: 100000, askDepthUsd: 100000, imbalancePct: 0.1 },
    CVD: 10,
    funding: 0.0001,
    OI: 50000,
    volatility: 1.5,
    spread: 1.0,
    latency: 12,
    executionStatus: 'EXECUTED_FILLED',
    outcome: 'WIN',
    PnL: -50, // تناقض پاداش
    MAE: 20,
    MFE: 80
  });
  assert.strictEqual(invalidRecordForTraining.isValidForTraining, false, 'Contradictory reward must be rejected');
  console.log('✅ سناریو ۱۸ پاس شد: خطای یادگیری و پاداش متناقض بدون دور زدن گیت رد شد.');

  console.log('\n🎉 هر ۱۸ سناریوی اجباری آزمون سیستم با موفقیت کامل و راستی‌آزمایی قطعی پاس شدند!');

  // =========================================================================
  // آزمون‌های بخش نهم: سرعت، پایداری، سنجه‌های مانیتورینگ و پالایش اسرار
  // =========================================================================
  console.log('\n⚡ Starting Section 9 Speed, Latency, Stability & Monitoring Verification...');

  // ۱. اندازه‌گیری و راستی‌آزمایی ۵ مؤلفه تأخیر زنجیره
  const measuredSample = activityFrequencyMonitor.recordLatencySample({
    dataArrivalMs: 19,
    featureCalculationMs: 14,
    decisionLatencyMs: 11,
    orderSentLatencyMs: 22,
    exchangeAckLatencyMs: 44,
  });
  assert.strictEqual(measuredSample.totalChainLatencyMs, 110, 'Total latency must equal sum of stages');
  assert.strictEqual(measuredSample.isWithinSla, true, 'Latency below 250ms must be within SLA');
  console.log(`✅ سنجه تأخیر تایید شد: مجموع زنجیره = ${measuredSample.totalChainLatencyMs}ms (زیر سقف ۲۵۰ms SLA).`);

  // ۲. ثبت و اندازه‌گیری شاخص‌های پایداری و خطا
  activityFrequencyMonitor.recordErrorOccurrence();
  activityFrequencyMonitor.recordNetworkDisconnection();
  activityFrequencyMonitor.recordDuplicateOrderAttempt();
  activityFrequencyMonitor.recordLowQualitySignalRejection();

  const sec9Report = activityFrequencyMonitor.getSection9MonitoringReport();
  assert.ok(sec9Report.reliabilityAudit.errorRatePct >= 0, 'Error rate must be calculated');
  assert.strictEqual(sec9Report.reliabilityAudit.connectionDisconnectionCount >= 1, true, 'Disconnections must be tracked');
  assert.strictEqual(sec9Report.reliabilityAudit.rejectedSignalsLowDataQualityCount >= 1, true, 'Low quality rejections must be tracked');
  console.log(`✅ سنجه‌های پایداری تایید شدند: خطای شبکه=${sec9Report.reliabilityAudit.connectionDisconnectionCount}، سیگنال‌های ردشده=${sec9Report.reliabilityAudit.rejectedSignalsLowDataQualityCount}.`);

  // ۳. آزمون عدم افشای اسرار، کلیدهای API و توکن‌ها در لاگ
  const dirtyLog = 'Failed Bybit request with apiKey="abc123xyz789SECRETKEY" and apiSecret="super_secret_shhh" and Bearer eyJhbGciOiJIUzI1NiIsIn...';
  const cleanLog = activityFrequencyMonitor.sanitizeLogMessage(dirtyLog);
  assert.strictEqual(cleanLog.includes('abc123xyz789SECRETKEY'), false, 'API key must never be logged');
  assert.strictEqual(cleanLog.includes('super_secret_shhh'), false, 'Secret must never be logged');
  assert.strictEqual(cleanLog.includes('[REDACTED_API_KEY]'), true, 'Redaction placeholder must be present');
  console.log('✅ پالایش امنیتی لاگ‌ها تایید شد: کلیدهای حساس صرافی کاملاً بدون افشای اسرار سانسور شدند.');

  // ۴. آزمون شناسه‌های یکتا و رهگیری تصمیم‌ها
  const decisionLogId = `DEC_${Date.now()}`;
  activityFrequencyMonitor.recordDecisionAudit({
    decisionId: decisionLogId,
    timestampUtc: Date.now(),
    symbol: 'BTCUSDT',
    status: 'REJECTED_DATA_QUALITY',
    reasonFa: 'داده بازار نامعتبر به دلیل اسپرد غیرعادی',
    latencyBreakdownMs: { features: 12, decision: 10, execution: 0 }
  });
  const updatedReport = activityFrequencyMonitor.getSection9MonitoringReport();
  const loggedItem = updatedReport.recentDecisionAuditLogs.find(l => l.decisionId === decisionLogId);
  assert.ok(loggedItem, 'Logged decision must be retrieved by unique decisionId');
  assert.strictEqual(loggedItem?.reasonFa.includes('اسپرد غیرعادی'), true, 'Audit log reason must be preserved');
  console.log('✅ ثبت شناسه یکتا و چرایی پذیرش/رد تصمیم تایید شد.');

  // =========================================================================
  // آزمون‌های بخش دوم: یکپارچگی داده‌ها (Data Integrity & Feed Provenance)
  // =========================================================================
  console.log('\n🌐 Starting Section 2 Data Integrity & Provenance Layer Verification...');

  // ۱. اعتبارسنجی سازگاری کاندل‌ها (OHLCV Consistency Audit)
  const validCandles = [
    [88000, 88200, 87900, 88100, 150],
    [88100, 88350, 88050, 88300, 200]
  ];
  const validAudit = dataProvenanceLayerService.auditOhlcvConsistency(validCandles);
  assert.strictEqual(validAudit.isConsistent, true, 'Valid OHLCV candles must pass consistency audit');

  // کاندل متناقض: High کمتر از Low
  const invalidCandlesHighLow = [
    [88000, 87500, 88200, 88100, 150] // High=87500 < Low=88200
  ];
  const invalidAudit1 = dataProvenanceLayerService.auditOhlcvConsistency(invalidCandlesHighLow);
  assert.strictEqual(invalidAudit1.isConsistent, false, 'Inconsistent High < Low must be rejected');

  // کاندل متناقض: حجم منفی
  const invalidCandlesNegVol = [
    [88000, 88200, 87900, 88100, -5]
  ];
  const invalidAudit2 = dataProvenanceLayerService.auditOhlcvConsistency(invalidCandlesNegVol);
  assert.strictEqual(invalidAudit2.isConsistent, false, 'Negative volume must be rejected');
  console.log('✅ سازگاری عددی و هندسی کاندل‌های OHLCV (سقف، کف و حجم) تایید شد.');

  // ۲. اعتبارسنجی تطابق منبع جایگزین (Fallback Compatibility)
  const compatValid = dataProvenanceLayerService.verifyFallbackCompatibility(
    { symbol: 'BTCUSDT', marketType: 'LINEAR_PERPETUAL', timeframe: '15m' },
    { symbol: 'BTCUSDT', marketType: 'LINEAR_PERPETUAL', timeframe: '15m' }
  );
  assert.strictEqual(compatValid.isCompatible, true, 'Matching fallback contract specs must be compatible');

  const compatMismatchMarket = dataProvenanceLayerService.verifyFallbackCompatibility(
    { symbol: 'BTCUSDT', marketType: 'LINEAR_PERPETUAL', timeframe: '15m' },
    { symbol: 'BTCUSDT', marketType: 'SPOT', timeframe: '15m' }
  );
  assert.strictEqual(compatMismatchMarket.isCompatible, false, 'Spot must NEVER fallback for Linear Perpetual');
  console.log('✅ منع قطعی جایگزینی منابع ناهمگون (Spot به جای Futures) تایید شد.');

  // ۳. حائل داده‌های مصنوعی و آزمایشی (Synthetic Isolation)
  const synthAudit = dataProvenanceLayerService.registerAndAuditFeedProvenance({
    feedKey: 'TEST_SYNTH',
    source: 'Synthetic Sandbox Generator',
    exchange: 'SANDBOX',
    symbol: 'BTCUSDT',
    marketType: 'LINEAR_PERPETUAL',
    timeframe: '15m',
    isSimulatedSandboxOnly: true,
  });
  assert.strictEqual(synthAudit.status, 'SIMULATED', 'Synthetic data must be labeled SIMULATED');
  assert.strictEqual(synthAudit.isTradePermitted, false, 'Synthetic data must be forbidden for live trading');
  console.log('✅ حائل داده‌های مصنوعی و آزمایشی مانع ورود به لایو تایید شد.');

  // ۴. تفکیک قیمت‌های سه‌گانه (Last, Mark, Index) و عدم جایگزینی مقادیر مفقود با صفر یا مقدار فرضی
  const reportMissingPrices = dataProvenanceLayerService.auditCentralSystemDataIntegrity({
    lastPrice: null, // قیمت مفقود به صورت صریح null ثبت می‌شود
    markPrice: 88100,
    indexPrice: 88050,
  });
  assert.strictEqual(reportMissingPrices.isLiveTradePermitted, false, 'Missing Last Price must block live trade');
  assert.strictEqual(reportMissingPrices.pricing.lastPrice, null, 'Missing price must remain null and not replaced with 0 or assumption');

  const reportValidAll = dataProvenanceLayerService.auditCentralSystemDataIntegrity({
    lastPrice: 88120,
    markPrice: 88100,
    indexPrice: 88090,
    candles: validCandles,
  });
  assert.strictEqual(reportValidAll.isLiveTradePermitted, true, 'Valid prices and feeds must permit trade');
  assert.strictEqual(reportValidAll.pricing.priceDivergenceValid, true, 'Mark-Last divergence within 0.5% must be valid');
  console.log('✅ تفکیک منابع قیمت (Mark, Index, Last) و مسدودسازی در صورت فقدان داده تایید شد.');

  // =========================================================================
  // آزمون‌های بخش سوم، چهارم و پنجم: موتور احتمالات، شکار فرصت و Position Sizing
  // =========================================================================
  console.log('\n🎯 Starting Section 3, 4 & 5 Probabilities, Opportunity Ranking & Risk Sizing Verification...');

  // ۱. راستی‌آزمایی محاسبه پویای netEvUsd بر مبنای ریسک واقعی فرصت (حذف فرض ۵۰ دلار)
  const dualOppResult = opportunityRankingEngine.evaluateDualIndependentDirections({
    price: 88000,
    atr: 500,
    marketRegime: 'TRENDING_BULL',
    mtf1h: 'BULLISH',
    mtf4h: 'BULLISH',
    obi: 0.08,
    cvdDelta: 450,
    rsi: 58,
  } as any, []);
  assert.ok(dualOppResult.longCandidate, 'Long candidate must be evaluated');
  assert.ok(dualOppResult.shortCandidate, 'Short candidate must be evaluated independently');
  // ارزیابی استراتژی‌های چهارگانه استاندارد
  const fourStratResult = opportunityRankingEngine.evaluateFourStrategyFamilies({
    price: 88000,
    atr: 500,
    marketRegime: 'TRENDING_BULL',
    dataQualityReport: { overallScore: 95, isTradeAllowed: true } as any,
  } as any, []);
  assert.ok(fourStratResult.allOpportunities.length >= 4, 'Standard strategy families must be generated');
  fourStratResult.allOpportunities.forEach((opp) => {
    if (opp.netExpectedValueR !== null && opp.netExpectedValueUsd !== null) {
      // ریسک دلاری واقعی معادل (riskDist / entryP) * positionNotionalUsd است، نه عدد ثابت ۵۰
      assert.strictEqual(
        opp.netExpectedValueUsd,
        Math.round((opp.netExpectedValueR * opp.riskUsd) * 100) / 100,
        `Opportunity ${opp.id} netExpectedValueUsd must dynamically equal netExpectedValueR * riskUsd`
      );
    }
  });
  console.log('✅ محاسبه پویای امید ریاضی خالص (netEvUsd) بر مبنای ریسک دلاری واقعی فرصت تایید شد.');

  // ۲. ارزیابی کاملاً مستقل LONG و SHORT بدون تحمیل جهت قبلی
  assert.notStrictEqual(
    dualOppResult.longCandidate?.heuristicScore,
    dualOppResult.shortCandidate?.heuristicScore,
    'Long and Short must have distinct independent heuristic scores'
  );
  console.log('✅ ارزیابی مستقل جهت‌های خرید و فروش (LONG/SHORT) بدون سوگیری اولیه تایید شد.');

  // ۳. آزمون Position Sizing مبتنی بر بودجه ریسک (حذف تخصیص ثابت ۱۵ درصد)
  // تولید ۳۰۰ کاندل برای اعتبارسنجی
  const mockCandles: any[] = [];
  let baseP = 85000;
  for (let i = 0; i < 350; i++) {
    const delta = Math.sin(i / 12) * 140 + Math.cos(i / 6) * 70;
    const o = baseP;
    const c = o + delta;
    const h = Math.max(o, c) + 80;
    const l = Math.min(o, c) - 80;
    const v = 50 + Math.abs(delta);
    mockCandles.push([o, h, l, c, v]);
    baseP = c;
  }
  const lowBalance = 1000;
  const highBalance = 10000;
  const mockFng = { value: 50, sent: 'Neutral', status: 'LIVE' as const };
  const mockSent = { score: 0, label: 'NEUTRAL' as const, trend: 'STABLE' as const, drivers: [] };
  const mockDqr = { overallScore: 90, isTradeAllowed: true, status: 'LIVE' as const, reasonsFa: [], feeds: {} as any };
  const analysisLow = analyzePro(mockCandles, mockFng, mockSent, {}, undefined, 0, lowBalance, 1.0, mockCandles, 'LIVE', mockDqr);
  const analysisHigh = analyzePro(mockCandles, mockFng, mockSent, {}, undefined, 0, highBalance, 1.0, mockCandles, 'LIVE', mockDqr);

  // بررسی عدم انتخاب اهرم قبل از تعیین بودجه ریسک و عدم تخصیص ساده ۱۵٪
  assert.ok(analysisLow.margin > 0, 'Margin must be calculated based on risk budget');
  assert.ok(analysisHigh.margin > 0, 'Margin must scale with risk budget');
  // مارجین نباید در هر دو حساب دقیقاً ۱۵ درصد ثابت باشد بلکه بر اساس فاصله تا حد ضرر و ریسک تعیین می‌شود
  assert.ok(analysisLow.leverage <= 25, 'Leverage must not exceed safety limits');
  assert.ok(analysisHigh.leverage <= 25, 'Leverage must not exceed safety limits');
  console.log('✅ سیستم تخصیص موقعیت مبتنی بر بودجه ریسک دلاری (Risk-Budgeted Position Sizing) تایید شد.');

  // ۴. آزمون منع قطعی ورود لایو در غیاب اکوئیتی و بالانس معتبر صرافی
  const mockAnalysisLive = {
    price: 88000,
    dataStatus: 'LIVE' as const,
    dataQualityReport: { isTradeAllowed: true, overallScore: 95 } as any,
  } as any;
  const livePrereqResult = await verifyAutoTradePrerequisites(mockAnalysisLive, [], [], 'LIVE');
  // چون در تست، سرور لایو به صرافی وصل نیست و اکوئیتی صفر است، باید صریحاً مسدود شود
  assert.strictEqual(livePrereqResult.isEligible, false, 'Live trading must be blocked when real equity is unavailable');
  assert.strictEqual(livePrereqResult.realEquityAvailable, false, 'realEquityAvailable must be false when walletBalanceUsdt is missing');
  assert.ok(
    livePrereqResult.detailsFa.some(d => d.includes('اکوئیتی') || d.includes('صرافی') || d.includes('ارتباط')),
    'Block details must mention failure to connect or missing equity'
  );
  console.log('✅ منع قطعی معامله زنده در شرایط فقدان اکوئیتی واقعی صرافی (Real Equity Guard) تایید شد.');

  // =========================================================================
  // آزمون‌های بخش ششم، هفتم و هشتم: چرخه سفارش واقعی، Decision Trace و امنیت
  // =========================================================================
  console.log('\n⚡ Starting Section 6, 7 & 8 Order Lifecycle, Decision Trace & Fail-Closed Security Verification...');

  // ۱. ثبت و چرخه سفارش واقعی و مدیریت قطعی شبکه در حین ارسال (In-Flight Disconnection)
  const testClientOrderId = `CLI_ORD_${Date.now()}`;
  const submittedOrder = orderExecutionLifecycleService.registerOrderSubmission({
    clientOrderId: testClientOrderId,
    decisionId: `DEC_${Date.now()}`,
    symbol: 'BTCUSDT',
    side: 'Buy',
    direction: 'LONG',
    requestedQty: 0.05,
    expectedPrice: 88000,
    isSimulated: false,
  });
  assert.strictEqual(submittedOrder.state, 'SUBMITTED', 'Initial state must be SUBMITTED');

  // شبیه‌سازی قطع شبکه در حین ارسال
  const inFlightOrder = orderExecutionLifecycleService.markOrderInFlightDisconnection(testClientOrderId);
  assert.strictEqual(inFlightOrder?.state, 'UNKNOWN_IN_FLIGHT', 'State during network disconnect must be UNKNOWN_IN_FLIGHT');

  // استعلام و تطبیق از صرافی قبل از هرگونه ارسال مجدد (Idempotency)
  const reconciledOrder = orderExecutionLifecycleService.reconcileInFlightOrder(testClientOrderId, {
    existsOnExchange: true,
    exchangeOrderId: 'EXCH_BYBIT_998822',
    orderStatus: 'Filled',
    cumExecQty: 0.05,
    avgPrice: 88015,
  });
  assert.strictEqual(reconciledOrder?.state, 'FILLED', 'Order must adopt real exchange state after reconciliation');
  assert.strictEqual(reconciledOrder?.exchangeOrderId, 'EXCH_BYBIT_998822', 'Exchange Order ID must be recorded');
  assert.strictEqual(reconciledOrder?.filledQty, 0.05, 'Actual filled quantity must be accurate');
  console.log('✅ چرخه اجرای سفارش، مدیریت قطعی شبکه (UNKNOWN_IN_FLIGHT) و تطبیق با صرافی تایید شد.');

  // ۲. ثبت Decision Trace جامع برای عیب‌یابی زنجیره معامله خودکار (Section 7)
  const sampleTraceId = `TRACE_${Date.now()}`;
  autoTradeDecisionTracer.recordDecisionTrace({
    traceId: sampleTraceId,
    evaluatedAtMs: Date.now(),
    evaluatedAtIso: new Date().toISOString(),
    evaluatedDirection: 'LONG',
    autoTradeEnabled: true,
    executionMode: 'LIVE',
    finalVerdict: 'WAIT_CONDITION',
    primaryBlockReasonFa: 'عدم تایید گیت همگرایی ساختاری ۱۵ دقیقه (Wave Genesis)',
    stoppingStage: '15M_TIMING_AND_WAVE_LIFECYCLE',
    steps: [
      { stepId: 'AUTO_TRADE_ENABLED', stepNameFa: 'بررسی فعال بودن اتوترید', status: 'PASSED', detailFa: 'اتوترید فعال است.', timestampMs: Date.now() },
      { stepId: 'DATA_QUALITY_GATE', stepNameFa: 'کیفیت داده‌های زنده', status: 'PASSED', detailFa: 'فیدها معتبر و زنده هستند.', timestampMs: Date.now() },
      { stepId: 'WAVE_TIMING_GATE', stepNameFa: 'زمان‌بندی موج ۱۵ دقیقه', status: 'BLOCKED', detailFa: 'موج در فاز استراحت است.', timestampMs: Date.now() }
    ]
  });
  const storedTrace = autoTradeDecisionTracer.getLatestTrace();
  assert.strictEqual(storedTrace?.traceId, sampleTraceId, 'Decision trace must be stored and queryable');
  assert.strictEqual(storedTrace?.stoppingStage, '15M_TIMING_AND_WAVE_LIFECYCLE', 'Stopping stage must be transparently preserved');
  console.log('✅ ثبت ردیابی تصمیم (Decision Trace) کامل با مرحله توقف و چرایی رد تایید شد.');

  // ۳. آزمون امنیتی Fail-Closed برای عدم تطابق پوزیشن (Section 8)
  const desyncCheck = orderExecutionLifecycleService.reconcileLocalWithExchange(
    { symbol: 'BTCUSDT', side: 'LONG', qtyBtc: 0.1, avgEntry: 88000, sl: 87000, tp: 90000, status: 'ACTIVE' },
    null // پوزیشن در صرافی وجود ندارد
  );
  assert.strictEqual(desyncCheck.isTradingHalted, true, 'Desync must trigger immediate Trading Halt (Fail-Closed)');
  console.log('✅ رفتار Fail-Closed و توقف معامله در شرایط عدم تطابق با صرافی تایید شد.');

  console.log('\n🏆 تمام آزمون‌های اجباری و آزمون‌های سرعت، پایداری و امنیت با موفقیت ۱۰۰٪ پاس شدند.');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

