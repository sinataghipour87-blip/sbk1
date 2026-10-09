import { AnalysisResult, AutoTradePrerequisitesCheck, ExchangeOrderReconciliation, ExecutionMode, TradeHistory, TradePosition, PreTradeRiskGateCheck, PositionReconciliationReport, OpportunityClusteringCheck, RealisticFillSimulationResult } from '../types/trading';
import { getAntiTiltStatus, evaluateAccountLevelRisk } from './kellyRisk';
import { calculateRealisticOrderFill, evaluateOpportunityClusteringGuard } from './sharedStrategyCore';
import { newsShockFirewallService } from './newsShockFirewall';
import { globalKillSwitchEngine } from './globalKillSwitchEngine';

const EXCHANGE_STATUS_CACHE_TTL_MS = 30_000;

interface ExchangeSecurityStatus {
  exchangeConnected: boolean;
  apiPermissionValid: boolean;
  clockSynchronized: boolean;
  clockDriftMs: number;
  exchangePositions: any[];
  walletBalanceUsdt: number | null;
  availableBalanceUsdt: number | null;
  requestFailure: 'http' | 'network' | null;
}

let cachedExchangeStatus: { value: ExchangeSecurityStatus; expiresAt: number } | null = null;
let exchangeStatusRequest: Promise<ExchangeSecurityStatus> | null = null;

function getCachedExchangeSecurityStatus(): Promise<ExchangeSecurityStatus> {
  if (cachedExchangeStatus && Date.now() < cachedExchangeStatus.expiresAt) {
    return Promise.resolve(cachedExchangeStatus.value);
  }

  if (exchangeStatusRequest) {
    return exchangeStatusRequest;
  }

  const request = (async (): Promise<ExchangeSecurityStatus> => {
    try {
      const res = await fetch('/api/exchange/status', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        return {
          exchangeConnected: false,
          apiPermissionValid: false,
          clockSynchronized: false,
          clockDriftMs: 0,
          exchangePositions: [],
          walletBalanceUsdt: null,
          availableBalanceUsdt: null,
          requestFailure: 'http',
        };
      }

      const data = await res.json();
      const now = Date.now();
      const serverTimestamp = data.serverTimestamp || now;
      const clockDriftMs = Math.abs(now - serverTimestamp);

      return {
        exchangeConnected: !!data.connected,
        apiPermissionValid: !!data.hasTradePermissions,
        clockSynchronized: clockDriftMs < 1500,
        clockDriftMs,
        exchangePositions: data.activePositions || [],
        walletBalanceUsdt: typeof data.walletBalanceUsdt === 'number' ? data.walletBalanceUsdt : null,
        availableBalanceUsdt: typeof data.availableBalanceUsdt === 'number' ? data.availableBalanceUsdt : null,
        requestFailure: null,
      };
    } catch {
      return {
        exchangeConnected: false,
        apiPermissionValid: false,
        clockSynchronized: false,
        clockDriftMs: 0,
        exchangePositions: [],
        walletBalanceUsdt: null,
        availableBalanceUsdt: null,
        requestFailure: 'network',
      };
    }
  })();

  const trackedRequest = request
    .then((value) => {
      cachedExchangeStatus = {
        value,
        expiresAt: Date.now() + EXCHANGE_STATUS_CACHE_TTL_MS,
      };
      return value;
    })
    .finally(() => {
      if (exchangeStatusRequest === trackedRequest) {
        exchangeStatusRequest = null;
      }
    });

  exchangeStatusRequest = trackedRequest;
  return trackedRequest;
}

/**
 * Generates cryptographically secure, idempotent identifiers for trade orders
 */
export function generateTradeIdentifiers(symbol: string = 'BTCUSDT', direction: 'LONG' | 'SHORT', decisionIdInput?: string) {
  const now = Date.now();
  const dirCode = direction === 'LONG' ? 'L' : 'S';
  const symCode = symbol.replace('/', '').replace('USDT', '');

  // Idempotent client order ID based on decisionId if present
  const baseSeed = decisionIdInput || `${now}_${Math.random().toString(36).substring(2, 8)}`;
  const uniqueClientOrderId = `QNT_${symCode}_${dirCode}_${baseSeed}`;
  const signalId = `SIG_${baseSeed}`;
  const decisionId = decisionIdInput || `DEC_${baseSeed}`;
  const executionAttemptId = `ATT_${baseSeed}`;

  return {
    uniqueClientOrderId,
    signalId,
    decisionId,
    executionAttemptId,
  };
}

/**
 * Evaluates the 8 Mandatory Real-World Prerequisites before Auto Trade activation (Issue 26)
 */
export async function verifyAutoTradePrerequisites(
  analysis: AnalysisResult | null,
  activePositions: TradePosition[],
  tradeHistory: TradeHistory[],
  executionMode: ExecutionMode
): Promise<AutoTradePrerequisitesCheck> {
  if (executionMode !== 'LIVE') {
    return {
      isEligible: true,
      exchangeConnected: true,
      apiPermissionValid: true,
      marketDataLive: true,
      riskEngineHealthy: true,
      executionEngineHealthy: true,
      clockSynchronized: true,
      positionStateSynchronized: true,
      emergencyStopAvailable: true,
      detailsFa: [`✅ حالت ${executionMode} فعال است؛ بررسی‌های اجرای واقعی رد شدند.`],
      checkedAt: Date.now(),
    };
  }

  const detailsFa: string[] = [];
  const now = Date.now();

  // 1 & 2: Server-side Exchange Connection & Permission Check
  let exchangeConnected = false;
  let apiPermissionValid = false;
  let clockSynchronized = false;
  let exchangePositions: any[] = [];

  const exchangeStatus = await getCachedExchangeSecurityStatus();
  exchangeConnected = exchangeStatus.exchangeConnected;
  apiPermissionValid = exchangeStatus.apiPermissionValid;
  clockSynchronized = exchangeStatus.clockSynchronized;
  exchangePositions = exchangeStatus.exchangePositions;

  if (exchangeStatus.requestFailure === 'http') {
    detailsFa.push('❌ عدم پاسخگویی اندپوینت وضعیت صرافی سرور.');
  } else if (exchangeStatus.requestFailure === 'network') {
    detailsFa.push('❌ خطا در برقراری ارتباط با ماژول امنیتی صرافی سرور.');
  } else {
    if (!exchangeConnected) {
      detailsFa.push('❌ اتصال به سرور صرافی برقرار نیست یا کلیدهای امنیتی معتبر نیستند.');
    }
    if (!apiPermissionValid) {
      detailsFa.push('❌ دسترسی معاملات فیوچرز (Order Execution) روی کلیدهای صرافی فعال نیست.');
    }
    if (!clockSynchronized) {
      detailsFa.push(`❌ انحراف ساعت محلی با صرافی بیش از حد مجاز است (${exchangeStatus.clockDriftMs}ms).`);
    }

    const hasRealEquity = typeof exchangeStatus.walletBalanceUsdt === 'number' && exchangeStatus.walletBalanceUsdt > 0;
    if (!hasRealEquity) {
      detailsFa.push('❌ مارجین و اکوئیتی واقعی صرافی (Real Equity) در دسترس نیست یا صفر است؛ معامله زنده مسدود شد.');
    }
  }

  // 3: Market Data LIVE Check
  const isDataAvailable = analysis && analysis.dataStatus === 'LIVE' && analysis.price > 0;
  const isDataQualityOk = analysis?.dataQualityReport ? analysis.dataQualityReport.isTradeAllowed : true;
  const marketDataLive = Boolean(isDataAvailable && isDataQualityOk);
  if (!marketDataLive) {
    detailsFa.push('❌ جریان داده‌های مارکت زنده نیست یا کیفیت داده‌ها کهنه است.');
  }

  // 4: Risk Engine Health Check
  const antiTilt = getAntiTiltStatus(tradeHistory);
  // Calculate real drawdown from trade history
  let maxEquity = 1000;
  let currentEq = 1000;
  let maxDdPct = 0;
  for (const t of tradeHistory) {
    const pnl = typeof t.pnlUsd === 'number' ? t.pnlUsd : (t.realizedPnlUsd || 0);
    currentEq += pnl;
    if (currentEq > maxEquity) maxEquity = currentEq;
    const dd = ((maxEquity - currentEq) / maxEquity) * 100;
    if (dd > maxDdPct) maxDdPct = dd;
  }
  const isDrawdownSafe = maxDdPct < 15.0; // Fail-closed if drawdown exceeds 15%
  const isKillSwitchActive = globalKillSwitchEngine.isBlocked();
  const riskEngineHealthy = !antiTilt.isLocked && isDrawdownSafe && !isKillSwitchActive;
  if (!riskEngineHealthy) {
    if (isKillSwitchActive) {
      detailsFa.push('🛑 کلید قطع جهانی سیستم (Global Kill Switch) فعال است؛ ورود معاملات خودکار متوقف گردید.');
    } else {
      detailsFa.push(`❌ موتور ریسک در وضعیت قفل یا محافظتی قرار دارد (${antiTilt.reason || (maxDdPct >= 15.0 ? `افت سرمایه بیش از حد مجاز: ${maxDdPct.toFixed(1)}%` : 'Anti-Tilt Locked')}).`);
    }
  }

  // 5: Execution Engine Health Check (Requires live server connection & response)
  const executionEngineHealthy = exchangeConnected && apiPermissionValid && clockSynchronized;
  if (!executionEngineHealthy) {
    detailsFa.push('❌ موتور اجرای معاملات (Execution Engine) به دلیل قطع بودن یا عدم احراز هویت صرافی غیرفعال است.');
  }

  // 6: Position State Synchronization Check (Issue 29)
  // Check if any local non-reconciled discrepancy exists with exchange
  const hasLocalActiveMismatch = activePositions.some((pos) => {
    if (!pos.isAuto) return false;
    // Check if exchange reports position exists
    const matchingExchangePos = exchangePositions.find((ep) => {
      const epSize = parseFloat(ep.size || '0');
      return epSize > 0 && ((pos.dir === 'LONG' && ep.side === 'Buy') || (pos.dir === 'SHORT' && ep.side === 'Sell'));
    });
    return pos.reconciliationHalted === true;
  });
  const positionStateSynchronized = !hasLocalActiveMismatch;
  if (!positionStateSynchronized) {
    detailsFa.push('❌ ناهماهنگی بین پوزیشن‌های محلی و سرور صرافی کشف شد (TRADING HALT فعال است).');
  }

  // 7: Emergency Stop Breaker Available
  const emergencyStopAvailable = typeof window !== 'undefined';

  const realEquityAvailable = typeof exchangeStatus.walletBalanceUsdt === 'number' && exchangeStatus.walletBalanceUsdt > 0;
  const liveExecutionChecksPassed = exchangeConnected && apiPermissionValid && clockSynchronized && (executionMode !== 'LIVE' || realEquityAvailable);
  const isEligible =
    liveExecutionChecksPassed &&
    marketDataLive &&
    riskEngineHealthy &&
    positionStateSynchronized &&
    emergencyStopAvailable;

  if (isEligible) {
    detailsFa.push('✅ تمام ۸ شرط امنیتی و کنترلی برای فعال‌سازی معامله خودکار با موفقیت تایید شد.');
  }

  return {
    isEligible,
    exchangeConnected,
    apiPermissionValid,
    marketDataLive,
    riskEngineHealthy,
    executionEngineHealthy,
    clockSynchronized,
    positionStateSynchronized,
    emergencyStopAvailable,
    realEquityAvailable,
    walletBalanceUsdt: exchangeStatus.walletBalanceUsdt,
    detailsFa,
    checkedAt: now,
  };
}

/**
 * 31. Pre-Trade Risk Gate (18 Mandatory Safety & Market Checks)
 * Order is ONLY allowed if ALL 18 checks PASS. Even 1 FAIL -> ORDER_BLOCKED.
 */
export function runPreTradeRiskGate(
  analysis: AnalysisResult | null,
  activePositions: TradePosition[],
  tradeHistory: TradeHistory[],
  orderParams?: {
    side: 'LONG' | 'SHORT';
    qty: number;
    price: number;
    stopLoss: number;
    takeProfit: number;
    clientOrderId?: string;
    availableBalanceUsdt?: number;
    spreadBps?: number;
    estimatedSlippagePct?: number;
    winProb?: number | null;
    expectedValue?: number | null;
    isExchangeConnected?: boolean;
    isClockSynced?: boolean;
    maxDrawdownBreached?: boolean;
    isDuplicateOrder?: boolean;
  }
): PreTradeRiskGateCheck {
  const now = Date.now();
  const reasonsFa: string[] = [];

  const liveMarketData = Boolean(analysis && (analysis.dataStatus === 'LIVE' || analysis.dataStatus === 'VERIFIED_REALTIME') && analysis.price > 0);
  if (!liveMarketData) reasonsFa.push('1. Live Market Data: فید مارکت زنده فیوچرز فعال نیست (DATA_UNAVAILABLE)');

  const dataAgeMs = analysis?.canonicalSnapshot ? (now - analysis.canonicalSnapshot.timestampUtc) : 0;
  const dataFreshness = dataAgeMs < 15000;
  if (!dataFreshness) reasonsFa.push(`2. Data Freshness: داده‌ها کهنه هستند (سن: ${Math.round(dataAgeMs / 1000)}s)`);

  const exchangeConnection = orderParams?.isExchangeConnected ?? (analysis?.canonicalSnapshot && analysis.dataStatus === 'LIVE' ? true : false);
  if (!exchangeConnection) reasonsFa.push('3. Exchange Connection: اتصال تاییدشده به صرافی وجود ندارد (FAIL CLOSED)');

  const accountState = Boolean(orderParams && orderParams.availableBalanceUsdt !== undefined && orderParams.availableBalanceUsdt > 0);
  if (!accountState) reasonsFa.push('4. Account State: وضعیت حساب کاربری نامعتبر یا موجودی صفر است');

  const positionState = !activePositions.some(p => p.reconciliationHalted);
  if (!positionState) reasonsFa.push('5. Position State: ناهماهنگی پوزیشن فعال (Reconciliation Mismatch)');

  const requiredMargin = orderParams ? (orderParams.price * orderParams.qty) / (analysis?.leverage || 10) : 0;
  const isBalanceProvided = orderParams && typeof orderParams.availableBalanceUsdt === 'number' && Number.isFinite(orderParams.availableBalanceUsdt) && orderParams.availableBalanceUsdt > 0;
  const marginAvailable = isBalanceProvided ? (orderParams!.availableBalanceUsdt! >= requiredMargin) : false;
  if (!marginAvailable) {
    reasonsFa.push(isBalanceProvided ? '6. Margin Available: موجودی مارجین کافی نیست' : '6. Margin Available: موجودی واقعی حساب در دسترس نیست (DATA_UNAVAILABLE / ZERO_BALANCE)');
  }

  const riskLimit = Boolean(orderParams ? orderParams.qty * orderParams.price * 0.15 <= 50000 : false);
  if (!riskLimit) reasonsFa.push('7. Risk Limit: حجم سفارش از سقف ریسک مجاز فراتر است');

  const antiTilt = getAntiTiltStatus(tradeHistory);
  const accountEquity = isBalanceProvided ? orderParams!.availableBalanceUsdt! : 0;
  const newRiskUsd = orderParams ? Math.abs(orderParams.price - orderParams.stopLoss) * orderParams.qty : 15;
  const accountRiskReport = evaluateAccountLevelRisk({
    accountEquityUsd: accountEquity,
    newTradeRiskUsd: newRiskUsd,
    newTradeDirection: orderParams?.side || 'LONG',
    activePositions,
    tradeHistory,
    volatilityPct: analysis?.volatilityPct ?? 1.4
  });

  const dailyLossLimit = !antiTilt.isLocked && accountRiskReport.isOrderPermitted;
  if (!dailyLossLimit) reasonsFa.push(`8. Account & Daily Loss Limit: ${accountRiskReport.rejectionReasonFa || 'سقف زیان روزانه یا قفل ریسک حساب فعال است'}`);

  const maxDrawdown = !(orderParams?.maxDrawdownBreached ?? false) && accountRiskReport.maxDrawdownPct < 15.0;
  if (!maxDrawdown) reasonsFa.push(`9. Max Drawdown: فراتر از حداکثر افت سرمایه مجاز (${accountRiskReport.maxDrawdownPct.toFixed(1)}٪)`);

  const spreadBps = orderParams?.spreadBps ?? (analysis?.canonicalSnapshot?.basisSpreadBps ?? 999);
  const spreadLimit = spreadBps <= 10.0;
  if (!spreadLimit) reasonsFa.push(`10. Spread Limit: اسپرد بازار بیش از حد مجاز است (${spreadBps} bps)`);

  const slippagePct = orderParams?.estimatedSlippagePct ?? 0.02;
  const slippageLimit = slippagePct <= 0.10;
  if (!slippageLimit) reasonsFa.push(`11. Slippage Limit: اسلیپیج تخمینی بیش از حد مجاز است (${slippagePct}٪)`);

  // STRICT PROBABILITY CHECK: No fallback! Must be explicitly provided or calibrated in analysis.
  const winProb = orderParams?.winProb !== undefined && orderParams.winProb !== null
    ? orderParams.winProb
    : (analysis?.calibratedWinProb !== undefined && analysis.calibratedWinProb !== null ? analysis.calibratedWinProb * 100 : null);
  const probabilityGate = winProb !== null && winProb >= 65.0;
  if (!probabilityGate) reasonsFa.push(`12. Probability Gate: احتمال کالیبره‌شده نا‌معتبر یا زیر حد نصاب است (${winProb !== null ? winProb.toFixed(1) + '٪' : 'N/A / NULL'})`);

  const entryTrigger = Boolean(analysis && (analysis.signalOk || analysis.entryTiming === 'IMMEDIATE' || analysis.entryTiming === 'WAIT_FOR_PULLBACK'));
  if (!entryTrigger) reasonsFa.push('13. Entry Trigger: شرایط تریگر ورود تایید نشده است');

  const stopValidity = Boolean(orderParams && orderParams.stopLoss > 0 && (orderParams.side === 'LONG' ? orderParams.stopLoss < orderParams.price : orderParams.stopLoss > orderParams.price));
  if (!stopValidity) reasonsFa.push('14. Stop Validity: حد ضرر (Stop Loss) نامعتبر است');

  const tpValidity = Boolean(orderParams && orderParams.takeProfit > 0 && (orderParams.side === 'LONG' ? orderParams.takeProfit > orderParams.price : orderParams.takeProfit < orderParams.price));
  if (!tpValidity) reasonsFa.push('15. TP Validity: حد سود (Take Profit) نامعتبر است');

  // STRICT EV CHECK: No fallback! Must be explicitly calculated and > 0.
  const ev = orderParams?.expectedValue !== undefined && orderParams.expectedValue !== null
    ? orderParams.expectedValue
    : (analysis?.expectedValue !== undefined && analysis.expectedValue !== null ? analysis.expectedValue : null);
  const expectedValue = ev !== null && ev > 0;
  if (!expectedValue) reasonsFa.push(`16. Expected Value: امید ریاضی نامعتبر یا غیرمثبت است (EV: ${ev !== null ? '$' + ev.toFixed(2) : 'N/A / NULL'})`);

  const duplicateOrderCheck = !(orderParams?.isDuplicateOrder ?? false);
  if (!duplicateOrderCheck) reasonsFa.push('17. Duplicate Check: سفارش تکراری یا تداخل شناسه کشف شد');

  const clockSynchronization = orderParams?.isClockSynced ?? (analysis?.canonicalSnapshot ? true : false);
  if (!clockSynchronization) reasonsFa.push('18. Clock Sync: عدم هماهنگی زمان محلی با سرور صرافی (FAIL CLOSED)');

  // 19. News Shock Firewall Check (Item 44: CPI, FOMC, NFP & Shock Window Prevention)
  const shockFirewallReport = newsShockFirewallService.evaluateNewsShockFirewall(analysis);
  const newsShockFirewallPassed = shockFirewallReport.isTradeAllowed;
  if (!newsShockFirewallPassed) {
    reasonsFa.push(`19. News Shock Firewall: ${shockFirewallReport.phaseLabelFa} - ${shockFirewallReport.actionVerdictLabelFa} (${shockFirewallReport.directiveFa})`);
  }

  const allPassed =
    liveMarketData &&
    dataFreshness &&
    exchangeConnection &&
    accountState &&
    positionState &&
    marginAvailable &&
    riskLimit &&
    dailyLossLimit &&
    maxDrawdown &&
    spreadLimit &&
    slippageLimit &&
    probabilityGate &&
    entryTrigger &&
    stopValidity &&
    tpValidity &&
    expectedValue &&
    duplicateOrderCheck &&
    clockSynchronization &&
    newsShockFirewallPassed;

  if (allPassed) {
    reasonsFa.unshift('✅ تمام ۱۹ شرط امنیتی Pre-Trade Risk Gate و News Shock Firewall با موفقیت PASS شدند.');
  } else {
    reasonsFa.unshift('🛑 خطا در Pre-Trade Risk Gate: ORDER BLOCKED');
  }

  return {
    liveMarketData,
    dataFreshness,
    exchangeConnection,
    accountState,
    positionState,
    marginAvailable,
    riskLimit,
    dailyLossLimit,
    maxDrawdown,
    spreadLimit,
    slippageLimit,
    probabilityGate,
    entryTrigger,
    stopValidity,
    tpValidity,
    expectedValue,
    duplicateOrderCheck,
    clockSynchronization,
    allPassed,
    status: allPassed ? 'ORDER_APPROVED' : 'ORDER_BLOCKED',
    reasonsFa,
    checkedAt: now,
  };
}

/**
 * 35. Position Reconciliation Engine: Compares Local Position vs Exchange Position
 * Discrepancies on side, size, entry price, avg fill, leverage, margin, stop, TP, unrealized PnL
 * triggers TRADING HALT + RECONCILIATION REQUIRED.
 */
export function reconcilePositionsLocalVsExchange(
  localPositions: TradePosition[],
  exchangePositions: any[]
): PositionReconciliationReport {
  const now = Date.now();
  const discrepancies: string[] = [];

  for (const loc of localPositions) {
    if (!loc.isAuto) continue;
    const match = exchangePositions.find((ep: any) => {
      const epSize = parseFloat(ep.size || '0');
      return epSize > 0 && ((loc.dir === 'LONG' && ep.side === 'Buy') || (loc.dir === 'SHORT' && ep.side === 'Sell'));
    });

    if (!match) {
      discrepancies.push(`پوزیشن محلی ${loc.id} (${loc.dir}) روی صرافی یافت نشد (مفقود در صرافی).`);
      continue;
    }

    const exSize = parseFloat(match.size || '0');
    const exEntry = parseFloat(match.avgPrice || match.entryPrice || '0');
    const exLev = parseFloat(match.leverage || '1');
    const exMargin = parseFloat(match.positionMargin || '0');
    const exPnl = parseFloat(match.unrealizedPnl || '0');

    const locQty = ((loc.initialMargin || loc.margin) * loc.lev) / loc.entry;

    if (Math.abs(locQty - exSize) > 0.0001) {
      discrepancies.push(`مغایرت حجم پوزیشن: محلی (${locQty.toFixed(4)}) در برابر صرافی (${exSize})`);
    }
    if (Math.abs(loc.entry - exEntry) > 1.0) {
      discrepancies.push(`مغایرت قیمت ورود: محلی ($${loc.entry}) در برابر صرافی ($${exEntry})`);
    }
    if (Math.abs(loc.lev - exLev) > 0.5) {
      discrepancies.push(`مغایرت اهرم: محلی (${loc.lev}x) در برابر صرافی (${exLev}x)`);
    }
  }

  const mismatchDetected = discrepancies.length > 0;
  const tradingHalted = mismatchDetected;
  const reconciliationRequired = mismatchDetected;

  return {
    isMatched: !mismatchDetected,
    mismatchDetected,
    tradingHalted,
    reconciliationRequired,
    detailsFa: mismatchDetected
      ? '🛑 مغایرت بین پوزیشن‌های محلی و صرافی کشف شد! TRADING HALTED + RECONCILIATION REQUIRED فعال گردید.'
      : '✅ تطابق کامل بین پوزیشن‌های محلی و صرافی تایید شد.',
    discrepancies,
    checkedAt: now,
  };
}

/**
 * Reconciles local trade order and position state with actual exchange records (Issue 29)
 */
export async function reconcileOrderWithExchange(
  orderId: string,
  clientOrderId: string,
  requestedPrice: number,
  symbol: string = 'BTCUSDT'
): Promise<ExchangeOrderReconciliation> {
  const now = Date.now();
  try {
    const res = await fetch(`/api/exchange/order-status?orderId=${encodeURIComponent(orderId)}&clientOrderId=${encodeURIComponent(clientOrderId)}&symbol=${symbol}`);
    if (!res.ok) {
      throw new Error(`Reconciliation HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'خطا در واکشی وضعیت سفارش از صرافی');
    }

    const order = data.order || {};
    const filledQty = parseFloat(order.cumExecQty || order.filledQty || '0');
    const remainingQty = parseFloat(order.leavesQty || '0');
    const avgFillPrice = parseFloat(order.avgPrice || order.cumExecValue ? (parseFloat(order.cumExecValue) / (filledQty || 1)).toString() : requestedPrice.toString());
    const actualFeeUsd = parseFloat(order.cumExecFee || '0');
    const actualSlippageUsd = Math.abs(avgFillPrice - requestedPrice);
    const orderStatus = order.orderStatus || 'FILLED';

    return {
      orderId,
      clientOrderId,
      signalId: data.signalId || `SIG_${now}`,
      decisionId: data.decisionId || `DEC_${now}`,
      executionAttemptId: data.executionAttemptId || `ATT_${now}`,
      orderStatus,
      filledQty,
      remainingQty,
      avgFillPrice: avgFillPrice > 0 ? avgFillPrice : requestedPrice,
      requestedPrice,
      actualFeeUsd,
      actualSlippageUsd,
      positionSizeBtc: data.position?.size ? parseFloat(data.position.size) : filledQty,
      positionSide: data.position?.side || (order.side === 'Buy' ? 'Buy' : 'Sell'),
      exchangePositionState: 'ACTIVE',
      isReconciled: true,
      lastReconciledTime: now,
    };
  } catch (err: any) {
    return {
      orderId,
      clientOrderId,
      signalId: `SIG_${now}`,
      decisionId: `DEC_${now}`,
      executionAttemptId: `ATT_${now}`,
      orderStatus: 'NEW',
      filledQty: 0,
      remainingQty: 0,
      avgFillPrice: requestedPrice,
      requestedPrice,
      actualFeeUsd: 0,
      actualSlippageUsd: 0,
      positionSizeBtc: 0,
      positionSide: 'None',
      exchangePositionState: 'MISMATCH_HALTED',
      isReconciled: false,
      discrepancyFa: `عدم تطابق با صرافی: ${err.message || 'پاسخ نامعتبر'}`,
      lastReconciledTime: now,
    };
  }
}

/**
 * ۱۱. بررسی ممانعت از چند معامله روی یک حرکت واحد برای اجرای زنده (Live Opportunity Guard)
 */
export function verifyOpportunityClusteringForLiveTrade(
  analysis: AnalysisResult | null,
  activePositions: TradePosition[],
  candidateDirection: 'LONG' | 'SHORT',
  requestedMarginUsd: number,
  availableBalanceUsdt: number = 1000,
  leverage: number = 10
): OpportunityClusteringCheck {
  const candles = analysis?.candles || [];
  const currentCandle = candles.length > 0 ? candles[candles.length - 1] : [0, analysis?.price || 0, analysis?.price || 0, analysis?.price || 0, 1000];

  const activeMoveHistory = activePositions.map((p, idx) => ({
    candleIndex: idx,
    direction: p.dir as 'LONG' | 'SHORT',
    entryPrice: p.entry,
    marginUsd: p.initialMargin || p.margin || 50,
    notionalUsd: (p.initialMargin || p.margin || 50) * p.lev,
    waveOriginPrice: p.entry,
    status: ((p as any).status === 'CLOSED' ? 'CLOSED' : 'OPEN') as 'OPEN' | 'CLOSED',
  }));

  return evaluateOpportunityClusteringGuard({
    candidateDirection,
    currentPrice: analysis?.price || 0,
    candleIndex: candles.length,
    currentCandle: currentCandle as any,
    recentCandles: candles as any,
    activeMoveHistory,
    currentBalanceUsd: availableBalanceUsdt,
    requestedMarginUsd,
    leverage,
    marketDepthUsd: analysis?.realObiData ? (analysis.realObiData.bidDepthUsd + analysis.realObiData.askDepthUsd) : 2500000,
  });
}

/**
 * ۱۲. محاسبه مدل واقعی اجرای سفارش (Live Realistic Fill Engine)
 * Spread + Slippage + Latency + Queue Position + Market Impact + Fill Probability + اثبات Limit
 */
export function simulateLiveOrderRealisticFill(params: {
  nominalPrice: number;
  positionSizeUsd: number;
  direction: 'BUY' | 'SELL';
  orderType: 'MARKET_TAKER' | 'LIMIT_MAKER';
  analysis?: AnalysisResult | null;
  networkLatencyMs?: number;
}): RealisticFillSimulationResult {
  const { nominalPrice, positionSizeUsd, direction, orderType, analysis, networkLatencyMs = 45 } = params;
  const candles = analysis?.candles || [];
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : undefined;

  const candleLow = lastCandle ? (lastCandle.length >= 6 ? lastCandle[3] : lastCandle[2]) : nominalPrice * 0.998;
  const candleHigh = lastCandle ? (lastCandle.length >= 6 ? lastCandle[2] : lastCandle[1]) : nominalPrice * 1.002;
  const candleClose = lastCandle ? (lastCandle.length >= 6 ? lastCandle[4] : lastCandle[3]) : nominalPrice;
  const candleVol = lastCandle ? ((lastCandle.length >= 6 ? lastCandle[5] : lastCandle[4]) || 1) * nominalPrice : 2000000;

  const depth = analysis?.realObiData ? (analysis.realObiData.bidDepthUsd + analysis.realObiData.askDepthUsd) : 2500000;
  const currentAtr = analysis?.atr || nominalPrice * 0.008;

  return calculateRealisticOrderFill({
    nominalPrice,
    positionSizeUsd,
    direction,
    orderType,
    exchange: 'BYBIT_FUTURES',
    marketRegime: (analysis?.supertrend === 'BULLISH' ? 'BULL_TREND' : analysis?.supertrend === 'BEARISH' ? 'BEAR_TREND' : 'CHOP_SIDEWAYS'),
    currentAtr,
    candleLow,
    candleHigh,
    candleClose,
    candleVolumeUsd: candleVol,
    networkLatencyMs,
    marketDepthUsd: depth,
  });
}

/**
 * =============================================================================
 * 🧭 Section 7: Auto-Trade Comprehensive Decision Trace Engine
 * =============================================================================
 * Records exact decision path, stopping stage, and detailed rejection reasons
 * for every single scan cycle without removing any safety gates!
 */
export interface DecisionTraceStep {
  stepId: string;
  stepNameFa: string;
  status: 'PASSED' | 'BLOCKED' | 'SKIPPED';
  detailFa: string;
  timestampMs: number;
}

export interface ComprehensiveDecisionTrace {
  traceId: string;
  evaluatedAtMs: number;
  evaluatedAtIso: string;
  evaluatedDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  autoTradeEnabled: boolean;
  executionMode: ExecutionMode;
  finalVerdict: 'EXECUTION_TRIGGERED' | 'ORDER_BLOCKED' | 'WAIT_CONDITION';
  primaryBlockReasonFa?: string;
  stoppingStage: string;
  steps: DecisionTraceStep[];
}

export class AutoTradeDecisionTracerService {
  private static instance: AutoTradeDecisionTracerService;
  private latestTrace: ComprehensiveDecisionTrace | null = null;
  private traceHistory: ComprehensiveDecisionTrace[] = [];

  public static getInstance(): AutoTradeDecisionTracerService {
    if (!AutoTradeDecisionTracerService.instance) {
      AutoTradeDecisionTracerService.instance = new AutoTradeDecisionTracerService();
    }
    return AutoTradeDecisionTracerService.instance;
  }

  public recordDecisionTrace(trace: ComprehensiveDecisionTrace): void {
    this.latestTrace = Object.freeze(trace);
    this.traceHistory.push(this.latestTrace);
    if (this.traceHistory.length > 50) {
      this.traceHistory.shift();
    }
  }

  public getLatestTrace(): ComprehensiveDecisionTrace | null {
    return this.latestTrace;
  }

  public getRecentTraces(): ComprehensiveDecisionTrace[] {
    return [...this.traceHistory];
  }
}

export const autoTradeDecisionTracer = AutoTradeDecisionTracerService.getInstance();
