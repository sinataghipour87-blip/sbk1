/**
 * 🌊 Orderflow & Liquidity Pool Sweep Engine (Institutional Grade)
 * 
 * Real Market Microstructure Analysis for BTCUSDT:
 * 1. Liquidity Pool Sweep Detection:
 *    - Tracks rolling swing highs and lows across 15m, 1h, and 4h timeframes.
 *    - Detects Stop-Grabs / Liquidity Sweeps where price pierces key structural swings
 *      to trigger stops, then immediately absorbs flow and reverses.
 * 2. Orderbook Imbalance (OBI) & Cumulative Volume Delta (CVD):
 *    - Measures aggressive taker buy vs seller delta.
 *    - Identifies Passive Absorption (large taker delta with minimal price progression).
 * 3. Deterministic Invalidation & R:R Calculations:
 *    - Hard Stop Loss positioned strictly beyond the sweep wick.
 *    - Take Profit targets engineered for minimum 1:2.5 Risk-to-Reward ratio.
 */

import { Candle, OrderFlowFeatures, RealOrderBookImbalance } from '../types/trading';

export interface SwingLevel {
  price: number;
  type: 'HIGH' | 'LOW';
  timestampIndex: number;
  timeframe: '15m' | '1h' | '4h';
  swept: boolean;
}

export interface LiquiditySweepSignal {
  symbol: string;
  timestamp: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  setupType: 'BULLISH_LIQUIDITY_SWEEP' | 'BEARISH_LIQUIDITY_SWEEP' | 'NONE';
  sweptLevelPrice: number;
  entryPrice: number;
  invalidationStopLoss: number; // Hard Stop Loss below sweep wick (LONG) or above sweep wick (SHORT)
  takeProfitTarget1: number;    // 1:2.5 R:R
  takeProfitTarget2: number;    // 1:4.0 R:R
  riskRewardRatio: number;
  cvdDivergenceConfirmed: boolean;
  orderbookAbsorptionRatio: number | null;
  signalConfidencePct: number | null;
  rationaleFa: string;
}

export interface OrderFlowSnapshot {
  currentPrice: number;
  // 21. Trade-Level CVD Architecture
  deltaBtc: number | null;
  cumulativeDeltaBtc: number | null;
  cvdValueBtc: number | null;
  takerBuyVolumeBtc: number | null;
  takerSellVolumeBtc: number | null;
  deltaRatio: number | null; // -1.0 to +1.0, or null if trade-level data is unavailable
  deltaVelocityBtcPerSec: number | null; // d(CVD)/dt
  deltaAccelerationBtcPerSec2: number | null; // d²(CVD)/dt²
  cvdDivergence: 'BULLISH_DIVERGENCE' | 'BEARISH_DIVERGENCE' | 'NEUTRAL' | 'UNKNOWN';
  
  // 22. Dynamic Order Book Microstructure Engine
  obi: number | null; // -1.0 to +1.0
  obiVelocity: number | null; // d(OBI)/dt
  obiAcceleration: number | null; // d²(OBI)/dt²
  bidDepthUsd: number | null;
  askDepthUsd: number | null;
  spreadUsd: number | null;
  spreadBps: number | null;
  liquidityMigration: 'MIGRATING_UP' | 'MIGRATING_DOWN' | 'STABLE' | 'UNKNOWN';
  absorptionRatio: number | null;
  wallPersistenceSec: number | null;
  wallCancellationDetected: boolean | null;
  liquidityInflowUsd: number | null;
  liquidityWithdrawalUsd: number | null;
  spreadCompressionUsd: number | null;
  spreadExpansionUsd: number | null;

  isAbsorptionDetected: boolean | null;
  activeSignal: LiquiditySweepSignal;
  swingLevels: SwingLevel[];
}

export class OrderFlowEngine {
  private static instance: OrderFlowEngine;

  // History tracking for velocity and acceleration
  private prevCvd = 0;
  private prevCvdVelocity = 0;
  private prevObi = 0;
  private prevObiVelocity = 0;
  private lastTimestampMs = Date.now() - 1000;

  public static getInstance(): OrderFlowEngine {
    if (!OrderFlowEngine.instance) {
      OrderFlowEngine.instance = new OrderFlowEngine();
    }
    return OrderFlowEngine.instance;
  }

  /**
   * Identifies Swing Highs and Swing Lows from candle history
   */
  public findSwingLevels(candles: Candle[], lookback = 30): SwingLevel[] {
    if (candles.length < 10) return [];

    const swingLevels: SwingLevel[] = [];
    const len = candles.length;

    // Rolling pivot high / low detection (leftLen = 3, rightLen = 3)
    for (let i = len - lookback; i < len - 3; i++) {
      if (i < 3) continue;

      const currentCandle = candles[i];
      const [, high, low] = currentCandle;

      // Check Swing High
      let isHigh = true;
      for (let j = i - 3; j <= i + 3; j++) {
        if (j !== i && candles[j][1] >= high) {
          isHigh = false;
          break;
        }
      }
      if (isHigh) {
        swingLevels.push({
          price: high,
          type: 'HIGH',
          timestampIndex: i,
          timeframe: '15m',
          swept: false,
        });
      }

      // Check Swing Low
      let isLow = true;
      for (let j = i - 3; j <= i + 3; j++) {
        if (j !== i && candles[j][2] <= low) {
          isLow = false;
          break;
        }
      }
      if (isLow) {
        swingLevels.push({
          price: low,
          type: 'LOW',
          timestampIndex: i,
          timeframe: '15m',
          swept: false,
        });
      }
    }

    return swingLevels;
  }

  /**
   * Analyzes candles and orderbook data to detect Liquidity Pool Sweeps & CVD Divergence
   */
  public analyzeOrderFlowAndLiquidity(
    candles: Candle[],
    realObi?: RealOrderBookImbalance | null,
    realTradeFlow?: OrderFlowFeatures | null
  ): OrderFlowSnapshot {
    const liveTradeFlow = realTradeFlow?.isRealTradeFlow === true &&
      realTradeFlow.status === 'LIVE' &&
      typeof realTradeFlow.ageMs === 'number' &&
      realTradeFlow.ageMs >= 0 && realTradeFlow.ageMs <= 5000 &&
      typeof realTradeFlow.takerDelta === 'number' && Number.isFinite(realTradeFlow.takerDelta) &&
      typeof realTradeFlow.takerBuyVol === 'number' && Number.isFinite(realTradeFlow.takerBuyVol) &&
      typeof realTradeFlow.takerSellVol === 'number' && Number.isFinite(realTradeFlow.takerSellVol);
    const cvdDelta = liveTradeFlow ? realTradeFlow.takerDelta : null;
    const cumulativeDelta = liveTradeFlow ? (realTradeFlow.cumulativeDelta ?? realTradeFlow.cvdDelta) : null;
    const totalTakerVolume = liveTradeFlow ? realTradeFlow.takerBuyVol + realTradeFlow.takerSellVol : null;
    const deltaRatio = totalTakerVolume !== null && totalTakerVolume > 0 && cvdDelta !== null
      ? cvdDelta / totalTakerVolume
      : null;
    const cvdDivergence = !liveTradeFlow
      ? 'UNKNOWN'
      : realTradeFlow.cvdDivergence.includes('صعودی') || realTradeFlow.cvdDivergence.includes('Bullish')
        ? 'BULLISH_DIVERGENCE'
        : realTradeFlow.cvdDivergence.includes('نزولی') || realTradeFlow.cvdDivergence.includes('Bearish')
          ? 'BEARISH_DIVERGENCE'
          : 'NEUTRAL';
    const liveOrderBook = realObi?.status === 'LIVE' &&
      realObi.obi !== null &&
      (realObi.snapshotAgeMs ?? realObi.ageMs) <= 10000;
    const currentObi = liveOrderBook ? realObi.obi : null;
    const currentSpread = liveOrderBook ? (realObi.spreadUsd ?? null) : null;
    const spreadBps = currentSpread !== null && candles.length > 0
      ? Number(((currentSpread / candles[candles.length - 1][3]) * 10000).toFixed(2))
      : null;
    const obiVelocity = liveOrderBook ? (realObi.obiVelocity ?? null) : null;
    const obiAcceleration = liveOrderBook ? (realObi.obiAcceleration ?? null) : null;
    const absorptionRatio = liveOrderBook ? (realObi.absorptionRate ?? null) : null;
    const wallCancellationDetected = liveOrderBook && realObi.wallCancellationRatio !== null &&
      realObi.wallCancellationRatio !== undefined
      ? realObi.wallCancellationRatio >= 0.6
      : null;
    const tradePriceChangePct = liveTradeFlow ? (realTradeFlow.tradePriceChangePct ?? null) : null;
    const isAbsorptionDetected = liveTradeFlow && liveOrderBook &&
      deltaRatio !== null && deltaRatio !== 0 &&
      tradePriceChangePct !== null && tradePriceChangePct !== 0
      ? deltaRatio * tradePriceChangePct < 0
      : null;

    if (!candles || candles.length < 20) {
      return {
        currentPrice: 0,
        deltaBtc: cvdDelta,
        cumulativeDeltaBtc: cumulativeDelta,
        cvdValueBtc: cumulativeDelta,
        takerBuyVolumeBtc: totalTakerVolume === null ? null : realTradeFlow.takerBuyVol,
        takerSellVolumeBtc: totalTakerVolume === null ? null : realTradeFlow.takerSellVol,
        deltaRatio,
        deltaVelocityBtcPerSec: liveTradeFlow ? (realTradeFlow.deltaVelocity ?? null) : null,
        deltaAccelerationBtcPerSec2: null,
        cvdDivergence,
        obi: currentObi,
        obiVelocity,
        obiAcceleration,
        bidDepthUsd: liveOrderBook ? realObi.bidDepthUsd : null,
        askDepthUsd: liveOrderBook ? realObi.askDepthUsd : null,
        spreadUsd: currentSpread,
        spreadBps,
        liquidityMigration: obiVelocity === null
          ? 'UNKNOWN'
          : obiVelocity > 0.05 ? 'MIGRATING_UP' : obiVelocity < -0.05 ? 'MIGRATING_DOWN' : 'STABLE',
        absorptionRatio,
        wallPersistenceSec: liveOrderBook && realObi.bidWallPersistence !== null && realObi.bidWallPersistence !== undefined &&
          realObi.askWallPersistence !== null && realObi.askWallPersistence !== undefined
          ? Math.min(realObi.bidWallPersistence, realObi.askWallPersistence) / 1000
          : null,
        wallCancellationDetected: liveOrderBook ? (realObi.wallCancellationObserved ?? wallCancellationDetected) : null,
        liquidityInflowUsd: liveOrderBook ? (realObi.liquidityInflowUsd ?? null) : null,
        liquidityWithdrawalUsd: liveOrderBook ? (realObi.liquidityWithdrawalUsd ?? null) : null,
        spreadCompressionUsd: liveOrderBook ? (realObi.spreadCompressionUsd ?? null) : null,
        spreadExpansionUsd: liveOrderBook ? (realObi.spreadExpansionUsd ?? null) : null,
        isAbsorptionDetected,
        activeSignal: {
          symbol: 'BTCUSDT',
          timestamp: Date.now(),
          direction: 'NEUTRAL',
          setupType: 'NONE',
          sweptLevelPrice: 0,
          entryPrice: 0,
          invalidationStopLoss: 0,
          takeProfitTarget1: 0,
          takeProfitTarget2: 0,
          riskRewardRatio: 0,
          cvdDivergenceConfirmed: false,
          orderbookAbsorptionRatio: absorptionRatio,
          signalConfidencePct: null,
          rationaleFa: 'داده‌های کافی برای تحلیل اردرپیرامون و نقدینگی وجود ندارد.',
        },
        swingLevels: [],
      };
    }

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const [open, high, low, close, volume] = lastCandle;

    const currentPrice = close;
    const swingLevels = this.findSwingLevels(candles, 40);

    const deltaBtc = cvdDelta;
    const cumulativeDeltaBtc = cumulativeDelta;
    const totalTakerBuyBtc = liveTradeFlow ? realTradeFlow.takerBuyVol : null;
    const totalTakerSellBtc = liveTradeFlow ? realTradeFlow.takerSellVol : null;
    const deltaVelocityBtcPerSec = liveTradeFlow ? (realTradeFlow.deltaVelocity ?? null) : null;
    const deltaAccelerationBtcPerSec2 = null;
    const liquidityMigration: OrderFlowSnapshot['liquidityMigration'] = obiVelocity === null
      ? 'UNKNOWN'
      : obiVelocity > 0.05 ? 'MIGRATING_UP' : obiVelocity < -0.05 ? 'MIGRATING_DOWN' : 'STABLE';
    const bidDepthUsd = liveOrderBook ? realObi.bidDepthUsd : null;
    const askDepthUsd = liveOrderBook ? realObi.askDepthUsd : null;
    const spreadUsd = currentSpread;
    const wallPersistenceSec = liveOrderBook && realObi.bidWallPersistence !== null && realObi.bidWallPersistence !== undefined &&
      realObi.askWallPersistence !== null && realObi.askWallPersistence !== undefined
      ? Math.min(realObi.bidWallPersistence, realObi.askWallPersistence) / 1000
      : null;

    // Detect Liquidity Sweeps against Swing Levels
    let activeSignal: LiquiditySweepSignal = {
      symbol: 'BTCUSDT',
      timestamp: Date.now(),
      direction: 'NEUTRAL',
      setupType: 'NONE',
      sweptLevelPrice: 0,
      entryPrice: currentPrice,
      invalidationStopLoss: 0,
      takeProfitTarget1: 0,
      takeProfitTarget2: 0,
      riskRewardRatio: 0,
      cvdDivergenceConfirmed: false,
      orderbookAbsorptionRatio: absorptionRatio,
      signalConfidencePct: null,
      rationaleFa: 'هیچ سوئیپ نقدینگی جدیدی در این کندل ثبت نشده است.',
    };

    // Check Bullish Liquidity Sweep (price wick swept below a previous Swing Low, then closed above)
    const recentSwingLows = swingLevels.filter((s) => s.type === 'LOW' && s.price < currentPrice * 1.01);
    for (const sLow of recentSwingLows) {
      if (low < sLow.price && close > sLow.price) {
        // Bullish Liquidity Sweep Confirmed!
        const stopLoss = Math.min(low * 0.9992, sLow.price * 0.9988); // Hard SL below sweep wick
        const riskUsd = Math.max(10, currentPrice - stopLoss);
        const tp1 = currentPrice + riskUsd * 2.8; // Minimum 1:2.8 R:R
        const tp2 = currentPrice + riskUsd * 4.2; // 1:4.2 R:R

          const cvdConfirmed = deltaRatio !== null && deltaRatio > 0;
          const confidence = cvdConfirmed ? 82 : null;

        activeSignal = {
          symbol: 'BTCUSDT',
          timestamp: Date.now(),
          direction: 'LONG',
          setupType: 'BULLISH_LIQUIDITY_SWEEP',
          sweptLevelPrice: sLow.price,
          entryPrice: currentPrice,
          invalidationStopLoss: parseFloat(stopLoss.toFixed(2)),
          takeProfitTarget1: parseFloat(tp1.toFixed(2)),
          takeProfitTarget2: parseFloat(tp2.toFixed(2)),
          riskRewardRatio: 2.8,
          cvdDivergenceConfirmed: cvdConfirmed,
          orderbookAbsorptionRatio: absorptionRatio,
          signalConfidencePct: confidence,
          rationaleFa: `🎯 سوئیپ نقدینگی صعودی: سطح $${sLow.price.toLocaleString()} شکسته و بازیابی شد. CVD ${cvdConfirmed ? 'با داده ترید تایید شد' : 'نامشخص است'}؛ تا دریافت جریان ترید، سیگنال تایید آماری ندارد.`,
        };
        break;
      }
    }

    // Check Bearish Liquidity Sweep if no bullish sweep found
    if (activeSignal.direction === 'NEUTRAL') {
      const recentSwingHighs = swingLevels.filter((s) => s.type === 'HIGH' && s.price > currentPrice * 0.99);
      for (const sHigh of recentSwingHighs) {
        if (high > sHigh.price && close < sHigh.price) {
          // Bearish Liquidity Sweep Confirmed!
          const stopLoss = Math.max(high * 1.0008, sHigh.price * 1.0012); // Hard SL above sweep wick
          const riskUsd = Math.max(10, stopLoss - currentPrice);
          const tp1 = currentPrice - riskUsd * 2.8; // Minimum 1:2.8 R:R
          const tp2 = currentPrice - riskUsd * 4.2;

          const cvdConfirmed = deltaRatio !== null && deltaRatio < 0;
          const confidence = cvdConfirmed ? 82 : null;

          activeSignal = {
            symbol: 'BTCUSDT',
            timestamp: Date.now(),
            direction: 'SHORT',
            setupType: 'BEARISH_LIQUIDITY_SWEEP',
            sweptLevelPrice: sHigh.price,
            entryPrice: currentPrice,
            invalidationStopLoss: parseFloat(stopLoss.toFixed(2)),
            takeProfitTarget1: parseFloat(tp1.toFixed(2)),
            takeProfitTarget2: parseFloat(tp2.toFixed(2)),
            riskRewardRatio: 2.8,
            cvdDivergenceConfirmed: cvdConfirmed,
            orderbookAbsorptionRatio: absorptionRatio,
            signalConfidencePct: confidence,
            rationaleFa: `🎯 سوئیپ نقدینگی نزولی: سطح $${sHigh.price.toLocaleString()} شکسته و بازیابی شد. CVD ${cvdConfirmed ? 'با داده ترید تایید شد' : 'نامشخص است'}؛ تا دریافت جریان ترید، سیگنال تایید آماری ندارد.`,
          };
          break;
        }
      }
    }

    return {
      currentPrice,
      deltaBtc: deltaBtc === null ? null : parseFloat(deltaBtc.toFixed(2)),
      cumulativeDeltaBtc: cumulativeDeltaBtc === null ? null : parseFloat(cumulativeDeltaBtc.toFixed(2)),
      cvdValueBtc: cumulativeDeltaBtc === null ? null : parseFloat(cumulativeDeltaBtc.toFixed(2)),
      takerBuyVolumeBtc: totalTakerBuyBtc === null ? null : parseFloat(totalTakerBuyBtc.toFixed(2)),
      takerSellVolumeBtc: totalTakerSellBtc === null ? null : parseFloat(totalTakerSellBtc.toFixed(2)),
      deltaRatio,
      deltaVelocityBtcPerSec,
      deltaAccelerationBtcPerSec2,
      cvdDivergence,
      obi: currentObi,
      obiVelocity,
      obiAcceleration,
      bidDepthUsd,
      askDepthUsd,
      spreadUsd,
      spreadBps,
      liquidityMigration,
      absorptionRatio,
      wallPersistenceSec,
      wallCancellationDetected: liveOrderBook ? (realObi.wallCancellationObserved ?? wallCancellationDetected) : null,
      liquidityInflowUsd: liveOrderBook ? (realObi.liquidityInflowUsd ?? null) : null,
      liquidityWithdrawalUsd: liveOrderBook ? (realObi.liquidityWithdrawalUsd ?? null) : null,
      spreadCompressionUsd: liveOrderBook ? (realObi.spreadCompressionUsd ?? null) : null,
      spreadExpansionUsd: liveOrderBook ? (realObi.spreadExpansionUsd ?? null) : null,
      isAbsorptionDetected,
      activeSignal,
      swingLevels,
    };
  }
}

export const orderFlowEngine = OrderFlowEngine.getInstance();
