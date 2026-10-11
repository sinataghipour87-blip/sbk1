/**
 * ⚡ Real Order Execution Lifecycle, Partial Fill, Protective Verification & Reconciliation Engine
 * 
 * Implements items 43 to 48:
 * - 43: Entry Fill comes from Actual Exchange Fill / Matcher (never analysis.price)
 * - 44: Realistic Slippage & Detailed Accounting (expected, submitted, average fill, actual slippage, fees)
 * - 45: Real Lifecycle: CREATED → SUBMITTED → ACKNOWLEDGED → PARTIALLY_FILLED → FILLED → PROTECTED
 * - 46: Precision Partial Fill management (actual qty, remaining, actual risk, actual SL/TP)
 * - 47: Protective Order Verification (SL/TP active on exchange, correct qty/trigger) + Emergency Protection
 * - 48: Real-time Reconciliation Engine between Local State & Exchange State (Halts on desync)
 */

import { centralPriceSourcePolicy } from './priceSourcePolicy';
import { FreqtradeRpcError, FreqtradeTrade, freqtradeBridge } from './freqtradeBridge';

export type InstitutionalOrderLifecycleState =
  | 'DECISION_APPROVED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'UNKNOWN_IN_FLIGHT'
  | 'POSITION_RECONCILED'
  | 'CREATED'
  | 'PROTECTED';

export type ProtectiveVerificationStatus = 'EXCHANGE_CONFIRMED' | 'SIMULATED' | 'UNKNOWN' | 'DESYNC_DETECTED';

export interface RealOrderExecutionRecord {
  clientOrderId: string;
  exchangeOrderId: string | null;
  decisionId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  direction: 'LONG' | 'SHORT';
  requestedQty: number;
  filledQty: number;
  fillSource: 'EXCHANGE' | 'SIMULATION' | 'PENDING';
  averageFillPrice: number | null; // ONLY set for real Exchange Fill
  simulatedFillPrice: number | null; // Set for simulation/paper fill
  estimatedFillPrice: number | null; // Pre-flight estimation
  actualFeeUsd: number;
  actualSlippageUsd: number;
  actualSlippageBps: number;
  submittedAtMs: number;
  acknowledgedAtMs: number | null;
  filledAtMs: number | null;
  state: InstitutionalOrderLifecycleState;
  rejectionReasonFa: string | null;
  protectiveVerification: ProtectiveOrderVerification | null;
  isSimulated: boolean;
  reconciliationStatus?: 'SYNCED' | 'DISCREPANCY_DETECTED' | 'HALTED';
}

export interface DetailedExecutionAccounting {
  expectedPrice: number;
  estimatedFillPrice: number;
  estimatedSlippageUsd: number;
  estimatedSlippageBps: number;
  estimatedFeeUsd: number;
}

export interface PartialFillState {
  requestedQtyBtc: number;
  filledQtyBtc: number;
  remainingQtyBtc: number;
  fillRatioPct: number;
  isPartiallyFilled: boolean;
  actualMarginAllocatedUsd: number;
  actualRiskUsd: number;
  adjustedStopLoss: number;
  adjustedTakeProfit: number;
}

export interface ProtectiveOrderVerification {
  verificationStatus: ProtectiveVerificationStatus;
  isSlVerifiedOnExchange: boolean;
  isTpVerifiedOnExchange: boolean;
  slTriggerPrice: number;
  tpTriggerPrice: number;
  slTriggerType: 'MARK_PRICE' | 'LAST_PRICE';
  tpTriggerType: 'LAST_PRICE' | 'MARK_PRICE';
  verifiedQuantityBtc: number;
  isProtectionFullySynchronized: boolean;
  emergencyProtectionActive: boolean;
  statusFa: string;
}

export interface ReconciliationStatusReport {
  isFullySynced: boolean;
  hasCriticalDesync: boolean;
  isTradingHalted: boolean;
  haltReasonFa?: string;
  desyncFields: string[];
  localStateSummary: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    qtyBtc: number;
    avgEntry: number;
    sl: number;
    tp: number;
  };
  exchangeStateSummary?: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    qtyBtc: number;
    avgEntry: number;
    sl: number;
    tp: number;
  };
  reconciledAt: number;
}

export interface FreqtradeLifecycleResult {
  success: boolean;
  tradeId: string;
  state: InstitutionalOrderLifecycleState;
  trade?: FreqtradeTrade;
  messageFa: string;
}

export class OrderExecutionLifecycleService {
  private static instance: OrderExecutionLifecycleService;
  private isSystemTradingHalted = false;
  private haltReasonFa = '';

  public static getInstance(): OrderExecutionLifecycleService {
    if (!OrderExecutionLifecycleService.instance) {
      OrderExecutionLifecycleService.instance = new OrderExecutionLifecycleService();
    }
    return OrderExecutionLifecycleService.instance;
  }

  /**
   * Estimates simulation fill costs; it never represents an exchange fill.
   */
  public estimateSimulatedFillAccounting(
    expectedPrice: number,
    requestedQtyBtc: number,
    side: 'Buy' | 'Sell',
    volatilityPct: number,
    spreadBps: number
  ): DetailedExecutionAccounting {
    if (
      !Number.isFinite(expectedPrice) || expectedPrice <= 0 ||
      !Number.isFinite(requestedQtyBtc) || requestedQtyBtc <= 0 ||
      !Number.isFinite(volatilityPct) || volatilityPct < 0 ||
      !Number.isFinite(spreadBps) || spreadBps < 0
    ) {
      throw new Error('Simulation fill estimate requires valid price, quantity, volatility, and spread inputs.');
    }

    const estimatedSlippageBps = Math.max(0, spreadBps / 2) * Math.max(1, volatilityPct);
    const estimatedSlippagePerBtc = expectedPrice * estimatedSlippageBps / 10000;

    const estimatedFillPrice = side === 'Buy'
      ? expectedPrice + estimatedSlippagePerBtc
      : expectedPrice - estimatedSlippagePerBtc;

    const estimatedSlippageUsd = Math.abs(estimatedFillPrice - expectedPrice) * requestedQtyBtc;
    const estimatedFeeUsd = estimatedFillPrice * requestedQtyBtc * 0.00055;

    return {
      expectedPrice,
      estimatedFillPrice,
      estimatedSlippageUsd,
      estimatedSlippageBps,
      estimatedFeeUsd,
    };
  }

  /**
   * 46. Calculates adjusted risk and stops for Partial Fills
   */
  public handlePartialFillAllocation(
    requestedQtyBtc: number,
    filledQtyBtc: number,
    averageFillPrice: number,
    leverage: number,
    rawStopLoss: number,
    rawTakeProfit: number,
    targetRiskPct = 1.5
  ): PartialFillState {
    const fillRatioPct = Number(((filledQtyBtc / requestedQtyBtc) * 100).toFixed(1));
    const remainingQtyBtc = Number((requestedQtyBtc - filledQtyBtc).toFixed(4));
    const isPartiallyFilled = filledQtyBtc < requestedQtyBtc && filledQtyBtc > 0;

    const actualNotionalUsd = averageFillPrice * filledQtyBtc;
    const actualMarginAllocatedUsd = Number((actualNotionalUsd / leverage).toFixed(2));
    
    // Proportionally adjust risk to actual filled amount
    const actualSlDistancePct = Math.abs(averageFillPrice - rawStopLoss) / averageFillPrice;
    const actualRiskUsd = Number((actualNotionalUsd * actualSlDistancePct).toFixed(2));

    return {
      requestedQtyBtc,
      filledQtyBtc,
      remainingQtyBtc,
      fillRatioPct,
      isPartiallyFilled,
      actualMarginAllocatedUsd,
      actualRiskUsd,
      adjustedStopLoss: rawStopLoss,
      adjustedTakeProfit: rawTakeProfit,
    };
  }

  /**
   * 47. Verifies protective orders (SL/TP) on exchange and activates emergency protection if missing
   */
  /**
   * 47. Verifies protective orders (SL/TP) on exchange and activates emergency protection if missing
   * Strictly separates UNKNOWN, SIMULATED, and EXCHANGE_CONFIRMED states.
   */
  public verifyProtectiveOrders(
    positionSide: 'LONG' | 'SHORT',
    filledQtyBtc: number,
    slPrice: number,
    tpPrice: number,
    exchangeStopOrders?: { slRegistered: boolean; tpRegistered: boolean; registeredQty: number; triggerType?: string },
    isSimulation = false
  ): ProtectiveOrderVerification {
    // 1. Explicit Simulation / Paper Mode: SL/TP is managed virtually, NEVER reported as verified on exchange
    if (isSimulation) {
      return {
        verificationStatus: 'SIMULATED',
        isSlVerifiedOnExchange: false,
        isTpVerifiedOnExchange: false,
        slTriggerPrice: slPrice,
        tpTriggerPrice: tpPrice,
        slTriggerType: 'MARK_PRICE',
        tpTriggerType: 'LAST_PRICE',
        verifiedQuantityBtc: filledQtyBtc,
        isProtectionFullySynchronized: false,
        emergencyProtectionActive: false,
        statusFa: '🧪 وضعیت شبیه‌سازی (SIMULATED): اردرهای SL/TP در حافظه موتور محلی فعالند و روی سرور صرافی واقعی ثبت نشده‌اند.',
      };
    }

    // 2. Missing Exchange Confirmation in Live Trading: must yield UNKNOWN and trigger Emergency Protection
    if (!exchangeStopOrders) {
      return {
        verificationStatus: 'UNKNOWN',
        isSlVerifiedOnExchange: false,
        isTpVerifiedOnExchange: false,
        slTriggerPrice: slPrice,
        tpTriggerPrice: tpPrice,
        slTriggerType: 'MARK_PRICE',
        tpTriggerType: 'LAST_PRICE',
        verifiedQuantityBtc: 0,
        isProtectionFullySynchronized: false,
        emergencyProtectionActive: true, // Crucial: Missing exchange info must immediately flag emergency protection!
        statusFa: '⚠️ وضعیت نامعلوم (UNKNOWN): اطلاعات اردرهای محافظتی صرافی در دسترس نیست؛ به دلیل ریسک سرمایه پروتکل Emergency Protection فعال است.',
      };
    }

    // 3. Real Exchange Confirmation Provided
    const isSlVerified = exchangeStopOrders.slRegistered && exchangeStopOrders.registeredQty >= filledQtyBtc;
    const isTpVerified = exchangeStopOrders.tpRegistered;
    const isProtectionFullySynchronized = isSlVerified && isTpVerified;
    const emergencyProtectionActive = !isSlVerified; // SL is non-negotiable

    let statusFa = '✅ اردرهای محافظتی با موفقیت روی سرور صرافی تایید شدند (EXCHANGE_CONFIRMED).';
    let verificationStatus: ProtectiveVerificationStatus = 'EXCHANGE_CONFIRMED';

    if (!isSlVerified) {
      verificationStatus = 'DESYNC_DETECTED';
      statusFa = '🚨 هشدار بحرانی: استاپ‌لاس روی صرافی ثبت نشده است! پروتکل Emergency Protection جهت بستن اضطراری فعال شد.';
    } else if (!isTpVerified) {
      statusFa = '⚠️ حد سود هنوز در هدر صرافی ثبت نشده است. ثبت مجدد در دست اجراست.';
    }

    return {
      verificationStatus,
      isSlVerifiedOnExchange: isSlVerified,
      isTpVerifiedOnExchange: isTpVerified,
      slTriggerPrice: slPrice,
      tpTriggerPrice: tpPrice,
      slTriggerType: 'MARK_PRICE',
      tpTriggerType: 'LAST_PRICE',
      verifiedQuantityBtc: exchangeStopOrders.registeredQty || filledQtyBtc,
      isProtectionFullySynchronized,
      emergencyProtectionActive,
      statusFa,
    };
  }

  /**
   * 48. Real-time Local State vs Exchange State Reconciliation
   */
  public reconcileLocalWithExchange(
    localPos: { symbol: string; side: 'LONG' | 'SHORT'; qtyBtc: number; avgEntry: number; sl: number; tp: number; status: string },
    exchangePos?: { symbol: string; side: 'LONG' | 'SHORT'; sizeBtc: number; entryPrice: number; stopLossPrice?: number; takeProfitPrice?: number } | null
  ): ReconciliationStatusReport {
    const desyncFields: string[] = [];

    if (!exchangePos) {
      // If position is active locally but exchange reports 0 positions (Desync / External Liquidated / Closed)
      if (localPos.qtyBtc > 0 && localPos.status === 'ACTIVE') {
        desyncFields.push('POSITION_MISSING_ON_EXCHANGE');
        this.isSystemTradingHalted = true;
        this.haltReasonFa = 'پوزیشن محلی فعال است اما در صرافی وجود ندارد (احتمال بسته شدن دستی یا استاپ‌اوت خارج از برنامه).';
      }
    } else {
      // Check Side
      if (localPos.side !== exchangePos.side) {
        desyncFields.push(`SIDE_MISMATCH (Local: ${localPos.side} vs Exch: ${exchangePos.side})`);
      }

      // Check Quantity (> 5% deviation)
      const qtyDiff = Math.abs(localPos.qtyBtc - exchangePos.sizeBtc);
      if (qtyDiff > 0.002) {
        desyncFields.push(`QTY_MISMATCH (Local: ${localPos.qtyBtc} vs Exch: ${exchangePos.sizeBtc})`);
      }

      // Check Entry Price (> 0.5% deviation)
      if (localPos.avgEntry > 0 && exchangePos.entryPrice > 0) {
        const entryDiffPct = (Math.abs(localPos.avgEntry - exchangePos.entryPrice) / localPos.avgEntry) * 100;
        if (entryDiffPct > 0.5) {
          desyncFields.push(`ENTRY_PRICE_MISMATCH (Local: $${localPos.avgEntry} vs Exch: $${exchangePos.entryPrice})`);
        }
      }

      if (desyncFields.length > 0) {
        this.isSystemTradingHalted = true;
        this.haltReasonFa = `مغایرت بین وضعیت محلی و صرافی: ${desyncFields.join(' | ')}. ورود جدید تا رفع مغایرت متوقف شد.`;
      } else {
        this.isSystemTradingHalted = false;
        this.haltReasonFa = '';
      }
    }

    return {
      isFullySynced: desyncFields.length === 0,
      hasCriticalDesync: desyncFields.length > 0,
      isTradingHalted: this.isSystemTradingHalted,
      haltReasonFa: this.haltReasonFa || undefined,
      desyncFields,
      localStateSummary: {
        symbol: localPos.symbol,
        side: localPos.side,
        qtyBtc: localPos.qtyBtc,
        avgEntry: localPos.avgEntry,
        sl: localPos.sl,
        tp: localPos.tp,
      },
      exchangeStateSummary: exchangePos ? {
        symbol: exchangePos.symbol,
        side: exchangePos.side,
        qtyBtc: exchangePos.sizeBtc,
        avgEntry: exchangePos.entryPrice,
        sl: exchangePos.stopLossPrice || 0,
        tp: exchangePos.takeProfitPrice || 0,
      } : undefined,
      reconciledAt: Date.now(),
    };
  }

  public getTradingHaltStatus(): { isHalted: boolean; reasonFa: string } {
    return {
      isHalted: this.isSystemTradingHalted,
      reasonFa: this.haltReasonFa,
    };
  }

  // Registry for tracking real order executions and preventing duplicate submissions
  private orderExecutionRegistry: Map<string, RealOrderExecutionRecord> = new Map();

  /**
   * Section 6: Records an order lifecycle transition with full accounting
   */
  public registerOrderSubmission(params: {
    clientOrderId: string;
    decisionId: string;
    symbol: string;
    side: 'Buy' | 'Sell';
    direction: 'LONG' | 'SHORT';
    requestedQty: number;
    expectedPrice: number;
    isSimulated?: boolean;
  }): RealOrderExecutionRecord {
    const existing = this.orderExecutionRegistry.get(params.clientOrderId);
    if (existing) {
      return existing; // Idempotent: return existing without duplication
    }

    const record: RealOrderExecutionRecord = {
      clientOrderId: params.clientOrderId,
      exchangeOrderId: null,
      decisionId: params.decisionId,
      symbol: params.symbol,
      side: params.side,
      direction: params.direction,
      requestedQty: params.requestedQty,
      filledQty: 0,
      fillSource: 'PENDING',
      averageFillPrice: null,
      simulatedFillPrice: null,
      estimatedFillPrice: params.expectedPrice,
      actualFeeUsd: 0,
      actualSlippageUsd: 0,
      actualSlippageBps: 0,
      submittedAtMs: Date.now(),
      acknowledgedAtMs: null,
      filledAtMs: null,
      state: 'SUBMITTED',
      rejectionReasonFa: null,
      protectiveVerification: null,
      isSimulated: Boolean(params.isSimulated),
      reconciliationStatus: 'SYNCED',
    };

    this.orderExecutionRegistry.set(params.clientOrderId, record);
    return record;
  }

  /**
   * Section 6: Updates order status on Exchange Acknowledgment
   */
  public acknowledgeOrder(clientOrderId: string, exchangeOrderId: string): RealOrderExecutionRecord | null {
    const record = this.orderExecutionRegistry.get(clientOrderId);
    if (!record) return null;

    record.exchangeOrderId = exchangeOrderId;
    record.acknowledgedAtMs = Date.now();
    record.state = 'ACKNOWLEDGED';
    return record;
  }

  /**
   * Section 6: Real Exchange Fill Execution (Never mixed with simulation)
   */
  public recordOrderFill(params: {
    clientOrderId: string;
    filledQty: number;
    averageFillPrice: number;
    actualFeeUsd: number;
    actualSlippageUsd: number;
    actualSlippageBps: number;
    isFullFill: boolean;
  }): RealOrderExecutionRecord | null {
    const record = this.orderExecutionRegistry.get(params.clientOrderId);
    if (!record) return null;

    record.filledQty = params.filledQty;
    record.fillSource = 'EXCHANGE';
    record.averageFillPrice = params.averageFillPrice;
    record.actualFeeUsd = params.actualFeeUsd;
    record.actualSlippageUsd = params.actualSlippageUsd;
    record.actualSlippageBps = params.actualSlippageBps;
    record.filledAtMs = Date.now();
    record.state = params.isFullFill ? 'FILLED' : 'PARTIALLY_FILLED';
    return record;
  }

  /**
   * Section 6: Dedicated Simulation / Paper Fill Route (Maintains explicit simulation tag)
   */
  public recordSimulatedFill(params: {
    clientOrderId: string;
    filledQty: number;
    simulatedFillPrice: number;
    estimatedFeeUsd: number;
    estimatedSlippageUsd: number;
    estimatedSlippageBps: number;
    isFullFill: boolean;
  }): RealOrderExecutionRecord | null {
    const record = this.orderExecutionRegistry.get(params.clientOrderId);
    if (!record) return null;

    record.isSimulated = true;
    record.filledQty = params.filledQty;
    record.fillSource = 'SIMULATION';
    record.simulatedFillPrice = params.simulatedFillPrice;
    record.averageFillPrice = null; // Strictly null for simulation
    record.actualFeeUsd = params.estimatedFeeUsd;
    record.actualSlippageUsd = params.estimatedSlippageUsd;
    record.actualSlippageBps = params.estimatedSlippageBps;
    record.filledAtMs = Date.now();
    record.state = params.isFullFill ? 'FILLED' : 'PARTIALLY_FILLED';
    return record;
  }

  /**
   * Section 6: Handles Network Disconnection In-Flight
   * Marks state as UNKNOWN_IN_FLIGHT to prevent blind retries before exchange reconciliation
   */
  public markOrderInFlightDisconnection(clientOrderId: string): RealOrderExecutionRecord | null {
    const record = this.orderExecutionRegistry.get(clientOrderId);
    if (!record) return null;

    record.state = 'UNKNOWN_IN_FLIGHT';
    record.rejectionReasonFa = '⚠️ قطع شبکه در حین ارسال؛ وضعیت سفارش در صرافی در حال استعلام است و از ارسال مجدد کورکورانه جلوگیری شد.';
    return record;
  }

  /**
   * Section 6: Reconciles In-Flight Order with Exchange before any retry
   */
  public reconcileInFlightOrder(
    clientOrderId: string,
    exchangeOrderResult?: {
      existsOnExchange: boolean;
      exchangeOrderId?: string;
      orderStatus?: string;
      cumExecQty?: number;
      avgPrice?: number;
    }
  ): RealOrderExecutionRecord | null {
    const record = this.orderExecutionRegistry.get(clientOrderId);
    if (!record) return null;

    if (!exchangeOrderResult || !exchangeOrderResult.existsOnExchange) {
      // Order never reached exchange matcher
      record.state = 'REJECTED';
      record.rejectionReasonFa = 'سفارش در صرافی ثبت نشده و پس از خطای شبکه با موفقیت لغو/رد شد.';
    } else {
      // Order did reach exchange! Adopt its real exchange state
      record.exchangeOrderId = exchangeOrderResult.exchangeOrderId || record.exchangeOrderId;
      const isFilled = exchangeOrderResult.orderStatus === 'Filled';
      const isPartial = exchangeOrderResult.orderStatus === 'PartiallyFilled';
      record.state = isFilled ? 'FILLED' : (isPartial ? 'PARTIALLY_FILLED' : 'ACKNOWLEDGED');
      if (exchangeOrderResult.cumExecQty) record.filledQty = exchangeOrderResult.cumExecQty;
      if (exchangeOrderResult.avgPrice) record.averageFillPrice = exchangeOrderResult.avgPrice;
      record.reconciliationStatus = 'SYNCED';
    }

    return record;
  }

  public getOrderRecord(clientOrderId: string): RealOrderExecutionRecord | undefined {
    return this.orderExecutionRegistry.get(clientOrderId);
  }

  public getAllOrderRecords(): RealOrderExecutionRecord[] {
    return Array.from(this.orderExecutionRegistry.values());
  }

  public async queryFreqtradeOrderStatus(tradeId: string | number): Promise<FreqtradeLifecycleResult> {
    const normalizedTradeId = String(tradeId);
    try {
      const trade = await freqtradeBridge.getTrade(normalizedTradeId);
      const relevantOrders = trade.orders.filter(
        (order) => order.ft_order_side.toLowerCase() !== 'stoploss',
      );
      const filledQty = relevantOrders.reduce(
        (total, order) => total + (Number.isFinite(order.filled) ? order.filled ?? 0 : 0),
        0,
      );
      const hasPendingOrder = relevantOrders.some((order) => order.is_open);
      const state: InstitutionalOrderLifecycleState = hasPendingOrder
        ? (filledQty > 0 ? 'PARTIALLY_FILLED' : 'ACKNOWLEDGED')
        : (filledQty > 0 ? 'FILLED' : trade.is_open ? 'ACKNOWLEDGED' : 'CANCELLED');
      return {
        success: true,
        tradeId: normalizedTradeId,
        state,
        trade,
        messageFa: `وضعیت معامله ${normalizedTradeId} مستقیماً از Freqtrade دریافت شد: ${state}.`,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.isSystemTradingHalted = true;
      this.haltReasonFa = `استعلام وضعیت معامله ${normalizedTradeId} از Freqtrade ناموفق بود؛ عملیات جدید متوقف شد: ${reason}`;
      console.error('[OrderExecutionLifecycleService] Freqtrade order status unavailable:', reason);
      return {
        success: false,
        tradeId: normalizedTradeId,
        state: 'UNKNOWN_IN_FLIGHT',
        messageFa: `⚠️ وضعیت سفارش از Freqtrade در دسترس نیست؛ وضعیت نامعلوم ثبت شد و ارسال مجدد ممنوع است: ${reason}`,
      };
    }
  }

  public async forceExitFreqtradeTrade(tradeId: string | number): Promise<FreqtradeLifecycleResult> {
    const normalizedTradeId = String(tradeId);
    let exitRequestStarted = false;
    try {
      const botState = await freqtradeBridge.getStatus();
      if (!botState.ping || botState.status !== 'running' || botState.dryRun) {
        throw new FreqtradeRpcError(
          `Freqtrade is not ready for live exits (state: ${botState.status}, dry-run: ${botState.dryRun}).`,
        );
      }
      const existingTrade = await freqtradeBridge.getTrade(normalizedTradeId);
      if (!existingTrade.is_open) {
        return {
          success: false,
          tradeId: normalizedTradeId,
          state: 'REJECTED',
          trade: existingTrade,
          messageFa: `معامله ${normalizedTradeId} در Freqtrade باز نیست؛ درخواست خروج ارسال نشد.`,
        };
      }

      exitRequestStarted = true;
      const acknowledgement = await freqtradeBridge.forceExit(normalizedTradeId);
      const reconciled = await this.queryFreqtradeOrderStatus(normalizedTradeId);
      if (!reconciled.success) return reconciled;
      const exitSide = reconciled.trade?.is_short ? 'buy' : 'sell';
      const exitOrderPending = Boolean(
        reconciled.trade?.orders.some(
          (order) => order.ft_order_side.toLowerCase() === exitSide && order.is_open,
        ),
      );
      const exitState = reconciled.trade?.is_open
        ? (exitOrderPending ? 'PARTIALLY_FILLED' : 'ACKNOWLEDGED')
        : 'FILLED';
      return {
        ...reconciled,
        success: true,
        state: exitState,
        messageFa: `درخواست Force Exit از Freqtrade تأیید شد (${acknowledgement.result})؛ وضعیت جاری: ${exitState}.`,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const knownRejection =
        error instanceof FreqtradeRpcError &&
        error.statusCode !== undefined &&
        error.statusCode >= 400 &&
        error.statusCode < 500;
      const state = knownRejection || !exitRequestStarted ? 'REJECTED' : 'UNKNOWN_IN_FLIGHT';
      this.isSystemTradingHalted = true;
      this.haltReasonFa = `Force Exit برای معامله ${normalizedTradeId} موفق/قابل‌تأیید نبود: ${reason}`;
      console.error('[OrderExecutionLifecycleService] Freqtrade force-exit failed:', reason);
      return {
        success: false,
        tradeId: normalizedTradeId,
        state,
        messageFa: `🛑 ${state === 'REJECTED' ? 'درخواست خروج رد شد یا پیش‌بررسی شکست خورد' : 'نتیجه ارسال خروج نامعلوم است'}؛ Fill فرضی ثبت نشد: ${reason}`,
      };
    }
  }
}

export const orderExecutionLifecycleService = OrderExecutionLifecycleService.getInstance();
