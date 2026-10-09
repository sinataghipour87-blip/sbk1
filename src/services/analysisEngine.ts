import { 
  AnalysisResult, 
  Candle, 
  DerivativesData, 
  FearAndGreed, 
  FuturesPrices,
  SentimentData, 
  SetupContext, 
  SignalLifecycleState, 
  SmcZone,
  DataQualityReport,
  RealOrderBookImbalance,
  OrderFlowFeatures,
  CanonicalMarketSnapshot,
  EntryCandidateType
} from '../types/trading';
import { runUnifiedDecisionPipeline } from './decisionPipeline';
import { getLatestMultiBrainConsensusReport } from './multiBrainEnsemble';
import { calculateOrderFlowFeatures } from './marketData';
import {
  atr,
  bollingerBands,
  calcAdx,
  calcCci,
  calcMacd,
  calcMfi,
  calcMomentum,
  calcObv,
  calcSupertrend,
  calcVwap,
  calcWilliamsR,
  ema,
  rsi,
  stochRsi,
} from './indicators';
import { evaluateSharedStrategy, DEFAULT_STRATEGY_PARAMS } from './sharedStrategyCore';
import { computeCentralCalibratedProbability } from './centralProbabilityEngine';
import { generateLiquidityMap, detectLiquiditySweepReversal } from './liquidityMapEngine';
import { computeCvdOiDivergenceMatrix, predictLiquidationCascade } from './derivativesMatrixEngine';
import { classifyMarketRegime, evaluateRegimeSetupEdge } from './regimeClassifierEngine';
import { processMtfStructuralAnalysis } from './mtfStructuralEngine';
import { runScenarioCompetition } from './scenarioCompetitionEngine';
import { evaluateNoTradeProbability } from './noTradePredictorEngine';
import { getMaeMfeFingerprint, separateStopFromProbability } from './maeMfeFingerprint';

export function analyzeHtfTrend(candlesHtf?: Candle[]): string {
  if (!candlesHtf || candlesHtf.length < 30) {
    return 'UNKNOWN';
  }
  const closes = candlesHtf.map(c => c[3]);
  const e50List = ema(closes, 50);
  const e200Period = Math.min(200, closes.length);
  const e200List = ema(closes, e200Period);
  const { trend: stTrend } = calcSupertrend(candlesHtf);

  const lastClose = closes[closes.length - 1];
  const e50 = e50List[e50List.length - 1];
  const e200 = e200List[e200List.length - 1];

  let bullVotes = 0;
  if (lastClose > e50) bullVotes++;
  if (lastClose > e200) bullVotes++;
  if (stTrend === 'BULLISH') bullVotes++;

  return bullVotes >= 2 ? 'BULLISH' : 'BEARISH';
}

/**
 * 🔍 تشخیص واگرایی/همگرایی بین شاخص RSI (تایم‌فریم ۱ ساعته) و قیمت بیت‌کوین
 * شناسایی تله‌های نقدینگی سقف (Bearish Divergence Trap) و صدور مجوز لانگ فقط با تایید همگرایی مثبت
 */
export function detect1hRsiDivergence(candles1h?: Candle[], candlesDefault: Candle[] = []): {
  rsi1h: number;
  divergence: 'BULLISH_CONVERGENCE' | 'BEARISH_DIVERGENCE' | 'NEUTRAL';
  detailsFa: string;
} {
  const targetCandles = (candles1h && candles1h.length >= 10) ? candles1h : candlesDefault;
  if (!targetCandles || targetCandles.length < 10) {
    return {
      rsi1h: 50,
      divergence: 'NEUTRAL',
      detailsFa: 'داده‌های ۱ ساعته در حال دریافت و محاسبه همگرایی است',
    };
  }

  const closes = targetCandles.map((c) => c[3]);
  const rsiList = rsi(closes, Math.min(14, Math.max(5, Math.floor(closes.length / 2))));
  const curRsi = rsiList[rsiList.length - 1] || 50;
  const prevRsi = rsiList[rsiList.length - 2] || curRsi;
  const rsi5Ago = rsiList[Math.max(0, rsiList.length - 6)] || curRsi;

  const curPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];
  const price5Ago = closes[Math.max(0, closes.length - 6)];

  // ۱. تشخیص واگرایی نزولی (Bearish Divergence Trap): قیمت سقف جدید ثبت می‌کند اما RSI سقف پایین‌تر می‌زند
  const isPriceHigherHigh = curPrice > price5Ago * 1.002;
  const isRsiLowerHigh = curRsi < rsi5Ago - 2.0;

  // ۲. تشخیص همگرایی مثبت (Bullish Convergence): رشد همزمان مومنتوم RSI و قیمت یا واگرایی مخفی صعودی
  const isBullishConvergence = (curPrice >= prevPrice && curRsi >= prevRsi && curRsi >= 45) ||
                               (curPrice <= price5Ago && curRsi > rsi5Ago + 1.5);

  if (isPriceHigherHigh && isRsiLowerHigh && curRsi > 56) {
    return {
      rsi1h: Math.round(curRsi * 10) / 10,
      divergence: 'BEARISH_DIVERGENCE',
      detailsFa: `⚠️ واگرایی نزولی ۱ ساعته (RSI 1H: ${curRsi.toFixed(1)} < ${rsi5Ago.toFixed(1)}): خطر تله نقدینگی سقف (Bearish Trap) - ورود لانگ مسدود گردید.`,
    };
  }

  if (isBullishConvergence) {
    return {
      rsi1h: Math.round(curRsi * 10) / 10,
      divergence: 'BULLISH_CONVERGENCE',
      detailsFa: `✅ همگرایی مثبت ۱ ساعته (RSI 1H: ${curRsi.toFixed(1)}): هم‌راستایی کامل مومنتوم کلان و نقدینگی خریداران بدون واگرایی منفی.`,
    };
  }

  return {
    rsi1h: Math.round(curRsi * 10) / 10,
    divergence: 'NEUTRAL',
    detailsFa: `همگرایی نرمال ۱ ساعته (RSI 1H: ${curRsi.toFixed(1)}): بازار در محدوده تعادل بدون واگرایی منفی.`,
  };
}

// Smart Money Concepts (SMC): Detect Institutional Order Blocks and Fair Value Gaps (FVG)
function detectSMC(candles: Candle[]): { smcOrderBlock?: SmcZone; fvg?: SmcZone } {
  if (candles.length < 15) return {};

  const len = candles.length;
  let smcOrderBlock: SmcZone | undefined;
  let fvg: SmcZone | undefined;

  // 1. Order Block Detection: Last opposite candle before a strong institutional displacement
  for (let i = len - 3; i >= len - 12; i--) {
    const cPrev = candles[i];
    const cCurr = candles[i + 1];
    const cNext = candles[i + 2];

    const isBearishDisplacement = cCurr[3] < cCurr[0] && cNext[3] < cNext[0] && Math.abs(cNext[3] - cCurr[0]) > (cCurr[1] - cCurr[2]) * 1.5;
    const isBullishDisplacement = cCurr[3] > cCurr[0] && cNext[3] > cNext[0] && Math.abs(cNext[3] - cCurr[0]) > (cCurr[1] - cCurr[2]) * 1.5;

    if (isBullishDisplacement && cPrev[3] < cPrev[0]) {
      smcOrderBlock = {
        top: Math.max(cPrev[0], cPrev[3]),
        bottom: Math.min(cPrev[0], cPrev[3]),
        type: 'BULLISH',
        label: 'اوردر بلاک صعودی سازمانی (Demand OB)'
      };
      break;
    } else if (isBearishDisplacement && cPrev[3] > cPrev[0]) {
      smcOrderBlock = {
        top: Math.max(cPrev[0], cPrev[3]),
        bottom: Math.min(cPrev[0], cPrev[3]),
        type: 'BEARISH',
        label: 'اوردر بلاک نزولی عرضه (Supply OB)'
      };
      break;
    }
  }

  // 2. Fair Value Gap (FVG): Imbalance gap between candle[i-2].high and candle[i].low (or vice versa)
  for (let i = len - 1; i >= len - 8; i--) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    
    // Bullish FVG: Low of candle 3 is higher than High of candle 1
    if (c3[2] > c1[1]) {
      fvg = {
        top: c3[2],
        bottom: c1[1],
        type: 'BULLISH',
        label: 'گپ ارزش منصفانه صعودی (FVG Bullish)'
      };
      break;
    }
    // Bearish FVG: High of candle 3 is lower than Low of candle 1
    if (c3[1] < c1[2]) {
      fvg = {
        top: c1[2],
        bottom: c3[1],
        type: 'BEARISH',
        label: 'گپ عدم تعادل عرضه (FVG Bearish)'
      };
      break;
    }
  }

  return { smcOrderBlock, fvg };
}

export function analyzePro(
  candles: Candle[],
  fngData: FearAndGreed,
  sentiment: SentimentData,
  htfCandles: Record<string, Candle[]> = {},
  deriv: DerivativesData = { funding: null, oi: null, status: 'UNAVAILABLE' },
  obi = 0.0,
  balance = 1000.0,
  riskPct = 1.5,
  rawCandles?: Candle[],
  dataStatus: 'LIVE' | 'STALE' | 'DATA_UNAVAILABLE' | 'SIMULATED' = 'LIVE',
  dataQualityReport?: DataQualityReport,
  realObiData?: RealOrderBookImbalance,
  canonicalSnapshot?: CanonicalMarketSnapshot,
  futuresPrices?: FuturesPrices,
  orderFlowFeatures?: OrderFlowFeatures
): AnalysisResult {
  // Strict Safety Guard (Item 35): If real candles are unavailable, stale, or data quality report disallows trade -> Strictly disable trading!
  if (!candles || candles.length < 300 || dataStatus === 'DATA_UNAVAILABLE' || dataStatus === 'STALE' || (dataQualityReport && !dataQualityReport.isTradeAllowed)) {
    const dummyPrice = futuresPrices?.lastPrice || (candles && candles.length > 0 ? candles[candles.length - 1][3] : 0);
    const reasonsMsg = dataQualityReport?.reasonsFa?.join(' | ') || 'فیدهای زنده بازار در دسترس نیستند یا کهنه شده‌اند';
    return {
      price: dummyPrice,
      lastPrice: futuresPrices?.lastPrice || dummyPrice,
      markPrice: futuresPrices?.markPrice || dummyPrice,
      indexPrice: futuresPrices?.indexPrice || dummyPrice,
      futuresPrices,
      entryPriceType: 'LAST_PRICE',
      stopLossPriceType: 'MARK_PRICE',
      liquidationPriceType: 'MARK_PRICE',
      sentiment,
      action: `🛑 توقف کامل معامله (NO TRADE): ${candles && candles.length < 300 ? 'حداقل ۳۰۰ کندل واقعی برای اعتبارسنجی OOS مدل رژیم لازم است.' : reasonsMsg}`,
      actionCol: '#E74C3C',
      direction: 'LONG',
      signalOk: false,
      confScore: 0,
      scoreLong: 0,
      scoreShort: 0,
      mtf1m: 'UNKNOWN',
      mtf5m: 'UNKNOWN',
      mtf15m: 'UNKNOWN',
      mtf1h: 'UNKNOWN',
      mtf4h: 'UNKNOWN',
      mtfAlignment: 0,
      mtfNote: 'داده زنده بازار قطع یا کهنه است',
      marketRegime: 'STALE / DATA_UNAVAILABLE (فید داده کهنه یا قطع)',
      sl: 0,
      tp: 0,
      tp1: 0,
      tp2: 0,
      tp3: 0,
      slDistPct: 0,
      leverage: 1,
      margin: 0,
      posUsd: 0,
      qtyBtc: 0,
      riskUsd: 0,
      rsi: 50,
      stoch: 50,
      cci: 0,
      wr: -50,
      mom: 0,
      atr: 0,
      adx: 0,
      pdi: 0,
      mdi: 0,
      obv: 0,
      obvSlope: 0,
      obvDiv: 'نامشخص',
      mfi: 50,
      vwap: dummyPrice,
      ema20Val: dummyPrice,
      ema50Val: dummyPrice,
      ema200Val: dummyPrice,
      supertrend: 'NEUTRAL',
      fngVal: fngData?.status === 'LIVE' ? (fngData.value ?? null) : null,
      fngSent: fngData?.sent || 'UNAVAILABLE',
      funding: deriv?.status === 'LIVE' ? (deriv.funding ?? null) : null,
      oi: deriv?.status === 'LIVE' ? (deriv.oi ?? null) : null,
      frNote: deriv?.status === 'LIVE' ? 'فید مشتقه فعال' : 'فید مشتقه ناموجود (DATA_UNAVAILABLE)',
      obi: realObiData?.obi ?? obi,
      forecastUp: dummyPrice,
      forecastDown: dummyPrice,
      candles: candles || [],
      rawCandles: rawCandles || candles || [],
      dataStatus: dataStatus === 'LIVE' ? (dataQualityReport?.status || 'LIVE') : dataStatus,
      entryTiming: 'NO_TRADE',
      tradeThesis: `🛑 توقف کامل معامله (NO TRADE): ${reasonsMsg}`,
      dataQualityReport,
      realObiData,
      canonicalSnapshot,
      ema20: [],
      ema50: [],
      ema200: [],
      stLine: [],
      bbUp: [],
      bbMid: [],
      bbLow: [],
      macdLine: [],
      macdSignal: [],
      macdH: [],
    };
  }

  const effectiveObi = realObiData && realObiData.obi !== null ? realObiData.obi : obi;
  const closes = candles.map(c => c[3]);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200Period = closes.length >= 200 ? 200 : closes.length;
  const ema200 = ema(closes, ema200Period);

  const rVals = rsi(closes, 14);
  const aVals = atr(candles, 14);
  const { upper: bbUp, mid: bbMid, lower: bbLow } = bollingerBands(closes, 20, 2.0);
  const { macdLine, sigLine, hist: macdH } = calcMacd(closes);
  const { trend: stTrend, stValues: stLine } = calcSupertrend(candles, 10, 3.0);

  const { adx: adxVal, pdi, mdi } = calcAdx(candles, 14);
  const obv = calcObv(candles);
  const mfiVal = calcMfi(candles, 14);
  const vwapVal = calcVwap(candles, 50);

  const price = closes[closes.length - 1];
  const currAtr = aVals[aVals.length - 1] || 150.0;
  const currRsi = rVals[rVals.length - 1] || 50.0;
  const rsiPrev = rVals.length > 1 ? rVals[rVals.length - 2] : currRsi;
  const currMacdH = macdH[macdH.length - 1] || 0.0;

  // Multi-Timeframe Checks
  const htf1m = analyzeHtfTrend(htfCandles['Bybit 1m']);
  const htf5m = analyzeHtfTrend(htfCandles['Bybit 5m']);
  const htf1h = analyzeHtfTrend(htfCandles['Bybit 1H']);
  const htf4h = analyzeHtfTrend(htfCandles['Bybit 4H']);

  // 1H RSI Divergence & Convergence Engine
  const rsi1hResult = detect1hRsiDivergence(htfCandles['Bybit 1H'], candles);

  const mtfBull = htf1h === 'BULLISH' && (htf4h === 'BULLISH' || htf4h === 'UNKNOWN');
  const mtfBear = htf1h === 'BEARISH' && (htf4h === 'BEARISH' || htf4h === 'UNKNOWN');

  // SMC Signals
  const { smcOrderBlock, fvg } = detectSMC(candles);

  // Volatility percentage
  const volatilityPct = price > 0 ? (currAtr / price) * 100 : 0.5;

  // Market Regime & Range Detection
  // Range is detected when ADX < 14 and Volatility < 0.18% (true dry chop)
  const isRangeBound = adxVal < 14 && volatilityPct < 0.18;
  const rangeBreakoutConfirmed = !isRangeBound && adxVal >= 14 && volatilityPct >= 0.18;

  let marketRegime = 'TRENDING (رونددار صعودی/نزولی)';
  if (isRangeBound) {
    marketRegime = 'RANGING (فاز رِنج بدون روند - پرخطر)';
  } else if (adxVal >= 28) {
    marketRegime = 'STRONG BREAKOUT (انفجار پرقدرت روند)';
  } else if (adxVal < 25) {
    marketRegime = 'MODERATE TREND (روند متوسط)';
  }

  // Real-time Price Velocity & Fast Momentum Indicators
  const ema9List = ema(closes, 9);
  const ema21List = ema(closes, 21);
  const ema9 = ema9List[ema9List.length - 1] || price;
  const ema21 = ema21List[ema21List.length - 1] || price;
  
  // Real-time Orderflow & Immediate Candle Action
  const lastCandle = candles[candles.length - 1] || [0, 0, 0, price, 0];
  const prevCandle = candles.length > 1 ? candles[candles.length - 2] : lastCandle;
  const isLastCandleBearish = lastCandle[3] < lastCandle[0];
  const isImmediateDump = isLastCandleBearish && (lastCandle[3] < prevCandle[3]) && (price < ema9);
  const isImmediatePump = !isLastCandleBearish && (lastCandle[3] > prevCandle[3]) && (price > ema9);

  // 5-Point Confluence Scoring System + Real-Time Momentum
  let scoreLong = 0;
  let scoreShort = 0;

  // 1. Fast Trend & Structural Alignment (EMA 9 vs 21 & VWAP Rejection)
  if (price > vwapVal && ema9 > ema21) {
    scoreLong += 1.2;
  } else if (price < vwapVal && ema9 < ema21) {
    scoreShort += 1.2;
  } else if (price > vwapVal) {
    scoreLong += 0.6;
    scoreShort += 0.4;
  } else {
    scoreShort += 0.6;
    scoreLong += 0.4;
  }

  // 2. Real-Time RSI Dynamic Velocity & Slope (Zero Lag)
  if (currRsi > rsiPrev && currRsi >= 50) {
    scoreLong += 1.0;
  } else if (currRsi < rsiPrev && currRsi <= 50) {
    scoreShort += 1.0;
  } else if (currRsi < rsiPrev && currRsi > 50) {
    // RSI is above 50 but actively dropping -> Momentum is turning down
    scoreShort += 0.8;
  } else if (currRsi > rsiPrev && currRsi < 50) {
    // RSI is below 50 but actively rising -> Momentum is turning up
    scoreLong += 0.8;
  } else {
    scoreLong += 0.5;
    scoreShort += 0.5;
  }

  // 3. MACD Histogram & Derivative Acceleration
  const prevMacdH = macdH.length > 1 ? macdH[macdH.length - 2] : currMacdH;
  const isMacdAcceleratingBullish = currMacdH > 0 && currMacdH >= prevMacdH;
  const isMacdAcceleratingBearish = currMacdH < 0 && currMacdH <= prevMacdH;
  if (isMacdAcceleratingBullish) {
    scoreLong += 1.0;
  } else if (isMacdAcceleratingBearish) {
    scoreShort += 1.0;
  } else if (currMacdH < prevMacdH) {
    // Histogram fading down -> favors Short
    scoreShort += 0.7;
  } else {
    scoreLong += 0.7;
  }

  // 4. Supertrend & Trend Ribbon
  if (stTrend === 'BULLISH' && price >= ema50[ema50.length - 1]) {
    scoreLong += 1.0;
  } else if (stTrend === 'BEARISH' && price <= ema50[ema50.length - 1]) {
    scoreShort += 1.0;
  } else if (stTrend === 'BULLISH') {
    scoreLong += 0.6;
  } else {
    scoreShort += 0.6;
  }

  // 5. Order Book Imbalance (OBI) & Directional Strength (ADX / DMI)
  const realObi = obi ?? 0;
  if (realObi > 0.10) {
    scoreLong += 1.0;
  } else if (realObi < -0.10) {
    scoreShort += 1.0;
  } else if (adxVal >= 20) {
    if (pdi > mdi) scoreLong += 0.8;
    else scoreShort += 0.8;
  } else {
    if (pdi > mdi) scoreLong += 0.4;
    else scoreShort += 0.4;
  }

  // SMC & Order Block Bonus
  if (smcOrderBlock?.type === 'BULLISH' && !isImmediateDump) scoreLong += 0.5;
  if (smcOrderBlock?.type === 'BEARISH' && !isImmediatePump) scoreShort += 0.5;

  // Immediate Dump / Pump Overrides to Prevent Fake Entries Against Rapid Moves
  if (isImmediateDump && scoreLong > scoreShort) {
    scoreLong -= 1.0;
    scoreShort += 1.0;
  } else if (isImmediatePump && scoreShort > scoreLong) {
    scoreShort -= 1.0;
    scoreLong += 1.0;
  }

  // Multi-Timeframe Bearish / Bullish Pressure
  let mtfNote = '';
  if (mtfBull && scoreShort > scoreLong + 1.0) {
    mtfNote = 'شورت محلی با هشدار روند کلان صعودی';
  } else if (mtfBear && scoreLong > scoreShort + 1.0) {
    mtfNote = 'لانگ محلی با هشدار روند کلان نزولی';
  } else if (mtfBear && scoreShort >= scoreLong) {
    scoreShort += 0.5;
    mtfNote = 'تایید روند نزولی همگام با تایم‌فریم‌های بالا (1H/4H)';
  } else if (mtfBull && scoreLong >= scoreShort) {
    scoreLong += 0.5;
    mtfNote = 'تایید روند صعودی همگام با تایم‌فریم‌های بالا (1H/4H)';
  }

  // Determine Direction and Final Confluence Score
  let confDirection: 'LONG' | 'SHORT';
  if (scoreShort > scoreLong) {
    confDirection = 'SHORT';
  } else if (scoreLong > scoreShort) {
    confDirection = 'LONG';
  } else {
    // If exact tie, use immediate candle velocity and VWAP
    confDirection = (isLastCandleBearish || price < vwapVal) ? 'SHORT' : 'LONG';
  }

  const rawMaxScore = Math.max(scoreLong, scoreShort);
  const confScore = Math.min(5, Math.max(1, Math.round(rawMaxScore)));

  const mtf15m = price >= ema20[ema20.length - 1] ? 'BULLISH' : 'BEARISH';
  const trendsList = [htf1m, htf5m, mtf15m, htf1h, htf4h];
  const expected = confDirection === 'LONG' ? 'BULLISH' : 'BEARISH';
  const mtfAlignment = trendsList.filter(t => t === expected).length;

  let action = '';
  let actionCol = '#2ECC71';
  let signalOk = false;

  if (confScore < 4) {
    action = `امتیاز همگرایی ${confScore}/5 - کم؛ صبر کنید (حداقل ۴ از ۵)`;
    actionCol = '#F1C40F';
    signalOk = false;
  } else {
    if (confDirection === 'LONG') {
      action = adxVal < 20 ? 'سیگنال بریک‌اوت لانگ تایید شد (Breakout BUY)' : 'سیگنال لانگ تایید شد (BUY / LONG)';
      actionCol = '#2ECC71';
    } else {
      action = adxVal < 20 ? 'سیگنال شکست نزولی تایید شد (Breakdown SHORT)' : 'سیگنال شورت تایید شد (SELL / SHORT)';
      actionCol = '#E74C3C';
    }
    signalOk = true;
  }

  // 1. Dynamic Swing Structure & Liquidity Sweep Detection
  const priorCandles = candles.slice(-21, -1);
  const swingLow = priorCandles.length > 0
    ? Math.min(...priorCandles.map(c => c[2]))
    : price;
  const swingHigh = priorCandles.length > 0
    ? Math.max(...priorCandles.map(c => c[1]))
    : price;
  const currentCandleVolume = lastCandle[4];
  const priorVolumes = priorCandles
    .map(c => c[4])
    .filter(volume => Number.isFinite(volume) && volume > 0);
  const averagePriorVolume = priorVolumes.length > 0
    ? priorVolumes.reduce((total, volume) => total + volume, 0) / priorVolumes.length
    : null;
  const volumeStrength = Number.isFinite(currentCandleVolume) &&
    currentCandleVolume > 0 && averagePriorVolume !== null
    ? Math.max(0, Math.min(100, (currentCandleVolume / averagePriorVolume) * 50))
    : null;
  const isLiquiditySweep = priorCandles.length >= 10 && (confDirection === 'LONG'
    ? lastCandle[2] < swingLow && lastCandle[3] > swingLow
    : lastCandle[1] > swingHigh && lastCandle[3] < swingHigh);
  const directionalBodyStrength = currAtr > 0 &&
    (confDirection === 'LONG'
      ? lastCandle[3] > lastCandle[0]
      : lastCandle[3] < lastCandle[0])
    ? Math.max(0, Math.min(100, (Math.abs(lastCandle[3] - lastCandle[0]) / currAtr) * 100))
    : 0;
  const sweepPenetration = confDirection === 'LONG'
    ? Math.max(0, swingLow - lastCandle[2])
    : Math.max(0, lastCandle[1] - swingHigh);
  const eventStrength = isLiquiditySweep && currAtr > 0
    ? Math.max(0, Math.min(100, (sweepPenetration / currAtr) * 100))
    : directionalBodyStrength;
  const reclaimDistance = confDirection === 'LONG'
    ? Math.max(0, lastCandle[3] - swingLow)
    : Math.max(0, swingHigh - lastCandle[3]);
  const reclaimStrength = isLiquiditySweep && currAtr > 0
    ? Math.max(0, Math.min(100, (reclaimDistance / currAtr) * 100))
    : 0;

  // 2. Discover Optimal Entry Zone & Structural Invalidation Level (Issue 6 & 8)
  let setupType: SetupContext['setupType'] = 'VWAP_MSS_CONTINUATION';
  let optimalEntryZone = { low: price, high: price, optimal: price };
  let invalidationLevel = price;
  const ema20Latest = ema20[ema20.length - 1] || price;

  if (smcOrderBlock && smcOrderBlock.type === (confDirection === 'LONG' ? 'BULLISH' : 'BEARISH')) {
    setupType = 'SMC_ORDER_BLOCK_RETEST';
    const obLow = Math.min(smcOrderBlock.bottom, smcOrderBlock.top);
    const obHigh = Math.max(smcOrderBlock.bottom, smcOrderBlock.top);
    optimalEntryZone = {
      low: obLow,
      high: obHigh,
      optimal: Math.round(((obLow + obHigh) / 2) * 100) / 100 // 50% OB Mean Threshold
    };
    invalidationLevel = confDirection === 'LONG' ? obLow : obHigh;
  } else if (fvg && fvg.type === (confDirection === 'LONG' ? 'BULLISH' : 'BEARISH')) {
    setupType = 'FVG_EQUILIBRIUM_PULLBACK';
    const fvgLow = Math.min(fvg.bottom, fvg.top);
    const fvgHigh = Math.max(fvg.bottom, fvg.top);
    optimalEntryZone = {
      low: fvgLow,
      high: fvgHigh,
      optimal: Math.round(((fvgLow + fvgHigh) / 2) * 100) / 100 // 50% FVG Equilibrium
    };
    invalidationLevel = confDirection === 'LONG' ? fvgLow : fvgHigh;
  } else if (isLiquiditySweep) {
    setupType = 'LIQUIDITY_SWEEP_REVERSAL';
    optimalEntryZone = {
      low: confDirection === 'LONG' ? swingLow : swingHigh - (currAtr * 0.35),
      high: confDirection === 'LONG' ? swingLow + (currAtr * 0.35) : swingHigh,
      optimal: confDirection === 'LONG' ? swingLow + (currAtr * 0.1) : swingHigh - (currAtr * 0.1)
    };
    invalidationLevel = confDirection === 'LONG' ? swingLow : swingHigh;
  } else {
    setupType = 'VWAP_MSS_CONTINUATION';
    const zoneMin = Math.min(vwapVal, ema20Latest);
    const zoneMax = Math.max(vwapVal, ema20Latest);
    optimalEntryZone = {
      low: Math.round(zoneMin * 100) / 100,
      high: Math.round(zoneMax * 100) / 100,
      optimal: Math.round(vwapVal * 100) / 100
    };
    invalidationLevel = confDirection === 'LONG' ? swingLow : swingHigh;
  }

  // 3. Market-Aware Structural Invalidation Stop Loss (Issue 8 & 37 & 38)
  // Stop is anchored to structural invalidation with historical MAE Fingerprint cross-validation
  const provOrderFlow = orderFlowFeatures ?? calculateOrderFlowFeatures(candles);
  const provRegime = classifyMarketRegime(candles, price, adxVal, currAtr, bbUp, bbLow, bbMid, vwapVal, provOrderFlow);
  const currentFingerprint = getMaeMfeFingerprint(setupType, provRegime.activeRegime, '15m');
  const slReport = separateStopFromProbability(confDirection, price, invalidationLevel, currentFingerprint, currAtr);
  const sl = slReport.finalStopPrice;

  // 4. Structural Take Profits based on Liquidity Targets & Swing Extensions (Issue 9)
  const impulseDistance = Math.abs(price - invalidationLevel);
  const tp1 = confDirection === 'LONG'
    ? Math.round(Math.max(price + (currAtr * 1.25), swingHigh) * 100) / 100
    : Math.round(Math.min(price - (currAtr * 1.25), swingLow) * 100) / 100;

  const tp2 = confDirection === 'LONG'
    ? Math.round((price + Math.max(currAtr * 2.2, impulseDistance * 1.618)) * 100) / 100
    : Math.round((price - Math.max(currAtr * 2.2, impulseDistance * 1.618)) * 100) / 100;

  const tp3 = confDirection === 'LONG'
    ? Math.round((price + Math.max(currAtr * 3.6, impulseDistance * 2.618)) * 100) / 100
    : Math.round((price - Math.max(currAtr * 3.6, impulseDistance * 2.618)) * 100) / 100;

  const riskDist = Math.abs(price - sl);
  const rewardDist = Math.abs(tp1 - price);
  const riskRewardRatio = Math.round((rewardDist / Math.max(1, riskDist)) * 100) / 100;

  // 5. Entry State Machine: SETUP_IDENTIFIED -> ARMED -> TRIGGERED (Issues 11, 12, 13, 14, 15)
  let lifecycleState: SignalLifecycleState = 'SETUP_IDENTIFIED';
  const triggerCandlePrice = confDirection === 'LONG'
    ? Math.round((Math.max(lastCandle[1], prevCandle[1]) + (currAtr * 0.05)) * 100) / 100
    : Math.round((Math.min(lastCandle[2], prevCandle[2]) - (currAtr * 0.05)) * 100) / 100;

  const distFromOptimalPct = (Math.abs(price - optimalEntryZone.optimal) / price) * 100;
  const isChasing = distFromOptimalPct > 0.45 && !((price >= optimalEntryZone.low && price <= optimalEntryZone.high));

  const isPriceNearOptimalZone = (price >= optimalEntryZone.low && price <= optimalEntryZone.high) || (distFromOptimalPct <= 0.35);
  const isObiAvailable = realObiData?.status === 'LIVE' &&
    realObiData.obi !== null && Number.isFinite(realObiData.obi);
  const isCvdAvailable = provOrderFlow.isRealTradeFlow === true &&
    provOrderFlow.status === 'LIVE' &&
    Number.isFinite(provOrderFlow.ageMs) &&
    provOrderFlow.ageMs! >= 0 &&
    provOrderFlow.ageMs! <= 5000 &&
    Number.isFinite(provOrderFlow.cvdDelta) &&
    Number.isFinite(provOrderFlow.takerDelta);
  const isObiAligned = isObiAvailable &&
    (confDirection === 'LONG' ? realObiData.obi! > 0.05 : realObiData.obi! < -0.05);
  const isCvdAligned = isCvdAvailable &&
    (confDirection === 'LONG'
      ? provOrderFlow.cvdDelta > 0 && provOrderFlow.takerDelta > 0
      : provOrderFlow.cvdDelta < 0 && provOrderFlow.takerDelta < 0);
  const orderFlowConfirmation = isObiAvailable && isCvdAvailable
    ? (isObiAligned && isCvdAligned ? 100 : (isObiAligned || isCvdAligned ? 50 : 0))
    : null;
  const isOrderFlowConfirmed = isObiAligned && isCvdAligned;
  const failureToContinueStrength = volumeStrength === null
    ? null
    : isLiquiditySweep
    ? Math.round(reclaimStrength * 0.7 + volumeStrength * 0.3)
    : 0;
  const triggerQualityComponents = [
    eventStrength,
    volumeStrength,
    reclaimStrength,
    orderFlowConfirmation,
    failureToContinueStrength,
  ];
  const triggerQuality = {
    qualityScore: triggerQualityComponents.every(
      (value): value is number => value !== null && Number.isFinite(value)
    )
      ? Math.round(triggerQualityComponents.reduce((total, value) => total + value, 0) / 5)
      : null,
    eventStrength: Math.round(eventStrength),
    volumeStrength: volumeStrength === null ? null : Math.round(volumeStrength),
    reclaimStrength: Math.round(reclaimStrength),
    orderFlowConfirmation,
    failureToContinueStrength,
    isOrderFlowConfirmed,
  };
  let isTriggerConfirmed = false;
  if (isPriceNearOptimalZone) {
    lifecycleState = 'ARMED';
    const isCandleTriggerConfirmed = confDirection === 'LONG'
      ? price >= triggerCandlePrice || (lastCandle[3] > lastCandle[0] && lastCandle[2] <= optimalEntryZone.high)
      : price <= triggerCandlePrice || (lastCandle[3] < lastCandle[0] && lastCandle[1] >= optimalEntryZone.low);
    if (isCandleTriggerConfirmed && isOrderFlowConfirmed && !isChasing) {
      isTriggerConfirmed = true;
      lifecycleState = 'TRIGGERED';
    }
  }

  // 6. Central Probability Engine Out-of-Sample Calibration, Risk-Adjusted Edge & TQS
  const hurstVal = closes.length >= 20 ? 0.52 : 0.50;
  const calibratedMetadata = computeCentralCalibratedProbability({
    trendBias: confDirection === 'LONG' ? 'BULLISH' : (confDirection === 'SHORT' ? 'BEARISH' : 'NEUTRAL'),
    scoreLong,
    scoreShort,
    obi: realObiData?.obi ?? 0,
    hurst: hurstVal,
    volatilityPct,
    adx: adxVal,
    rsi: currRsi,
    ema20: ema20[ema20.length - 1],
    ema50: ema50[ema50.length - 1],
    ema200: ema200[ema200.length - 1],
    setupType,
    marketRegime,
    candles,
    selectiveThreshold: 0.60,
    price,
    sl,
    tp: tp1,
    riskRewardRatio,
    spreadBps: canonicalSnapshot?.basisSpreadBps ?? 1.5,
    bidDepthUsd: realObiData?.bidDepthUsd,
    askDepthUsd: realObiData?.askDepthUsd,
    estimatedFeePct: 0.0011,
    estimatedSlippagePct: 0.0004
  });

  // Decoupled Metrics (Rule: Scores are NOT Probabilities!)
  const technicalScore = Math.round(confScore * 20); // 0 - 100 Technical Confluence
  const consensusScore = Math.round(Math.min(100, Math.max(0, 50 + (scoreLong - scoreShort) * 15))); // 0 - 100 Consensus
  const confidenceScore = Math.round(Math.min(100, Math.max(0, confScore * 18 + (isTriggerConfirmed ? 10 : 0)))); // Heuristic Conviction

  // Probability is STRICTLY null unless empirically calibrated on independent OOS dataset
  const calibratedWinProb = calibratedMetadata.calibratedWinProbability;
  const setupExpectancyR = calibratedWinProb !== null
    ? Math.round(((calibratedWinProb * Math.max(1.2, riskRewardRatio)) - ((1 - calibratedWinProb) * 1.0) - 0.06) * 100) / 100
    : 0;

  // =========================================================================
  // Section 5: Institutional Risk-Based Position Sizing, Margin & Leverage
  // Replaces fixed 15% allocation with rigorous risk budgeting (No heuristics)
  // =========================================================================
  const realEquity = (typeof balance === 'number' && Number.isFinite(balance) && balance > 0) ? balance : 0;
  const executableEntryPrice = optimalEntryZone.optimal > 0 ? optimalEntryZone.optimal : price;
  const structuralSlDistUsd = Math.max(10, Math.abs(executableEntryPrice - sl));
  let slDistPct = (structuralSlDistUsd / executableEntryPrice) * 100.0;
  if (slDistPct < 0.4) slDistPct = 0.4;

  // 1. Dollar Risk Budget dynamically adjusted by Data Quality, Volatility & Model Calibration
  const requestedRiskPct = Math.max(0.5, Math.min(2.5, riskPct));
  const dataQualityFactor = dataQualityReport ? Math.max(0.5, Math.min(1.0, (dataQualityReport.overallScore ?? 80) / 100)) : 0.85;
  const targetVolPct = 1.4;
  const volRiskFactor = Math.max(0.6, Math.min(1.25, targetVolPct / Math.max(0.5, volatilityPct)));
  const baseDollarRiskBudget = realEquity * (requestedRiskPct / 100.0);
  const dollarRiskBudget = Math.round(baseDollarRiskBudget * dataQualityFactor * volRiskFactor * 100) / 100;

  // 2. Expected Execution Costs: Fees (0.11%), Slippage (0.04%), Spread (0.03%), Funding (0.01%) = 0.19%
  const roundTripFrictionPct = 0.0019;
  const totalUnitRiskFraction = (structuralSlDistUsd / executableEntryPrice) + roundTripFrictionPct;

  // 3. Position Notional proportional strictly to Risk Budget (NOT arbitrary leverage)
  let posUsd = Math.round((dollarRiskBudget / Math.max(0.005, totalUnitRiskFraction)) * 100) / 100;
  let qtyBtc = Math.round((posUsd / executableEntryPrice) * 1000) / 1000;
  let isRiskBudgetBreachedByMinLot = false;
  if (qtyBtc < 0.001 && realEquity > 10) {
    qtyBtc = 0.001; // Exchange minimum contract size
    const recalculatedRiskUsd = qtyBtc * executableEntryPrice * totalUnitRiskFraction;
    // Strict audit: If min exchange lot breaches allowable risk budget by > 10%, trade MUST be rejected
    if (recalculatedRiskUsd > dollarRiskBudget * 1.10) {
      isRiskBudgetBreachedByMinLot = true;
    }
  }
  posUsd = Math.round(qtyBtc * executableEntryPrice * 100) / 100;

  // 4. Permissible Leverage: Strictly constrained by Liquidation Distance buffer including MMR, Fees & Mark Price
  // Bybit/Binance BTC Linear Maintenance Margin Rate: 0.5% + Liquidation Clearance Fee Buffer 0.08%
  const mmrPct = 0.50;
  const feeBufferPct = 0.08;
  const totalLiqBufferPct = mmrPct + feeBufferPct;
  const markPriceDivergencePct = (Math.abs(markPrice - executableEntryPrice) / executableEntryPrice) * 100.0;
  
  // Safe distance to liquidation must strictly exceed SL distance by 35% margin + MMR + mark basis
  const requiredLiqDistancePct = (slDistPct * 1.35) + totalLiqBufferPct + markPriceDivergencePct;
  const maxSafeLeverageByLiq = Math.floor(100.0 / Math.max(1.0, requiredLiqDistancePct));
  
  // Leverage can safely be 1x (never blindly forced to 2x without verified liquidation buffer!)
  let leverage = Math.max(1, Math.min(25, maxSafeLeverageByLiq));
  const estimatedLiqDistancePct = (100.0 / leverage) - totalLiqBufferPct;
  let isLiquidationUnsafe = estimatedLiqDistancePct < (slDistPct * 1.20);
  if (isLiquidationUnsafe && leverage > 1) {
    leverage = 1;
    const unleveragedLiqDist = 100.0 - totalLiqBufferPct;
    isLiquidationUnsafe = unleveragedLiqDist < slDistPct;
  }

  // 5. Margin Required and Free Margin Verification
  let marginNeeded = Math.round((posUsd / leverage) * 100) / 100;
  if (marginNeeded > realEquity * 0.85 && realEquity > 0) {
    // Scale position down if margin exceeds 85% of available free equity
    posUsd = Math.round(realEquity * 0.85 * leverage * 100) / 100;
    qtyBtc = Math.round((posUsd / executableEntryPrice) * 1000) / 1000;
    marginNeeded = Math.round((posUsd / leverage) * 100) / 100;
  }
  const riskUsd = Math.round((posUsd * totalUnitRiskFraction) * 100) / 100;

  const vol = currAtr * 0.35;
  const mom = closes.length > 1 ? (closes[closes.length - 1] - closes[closes.length - 2]) * 0.25 : 0;
  const forecastUp = price + vol + mom;
  const forecastDown = price - vol + mom;

  const isFundingLive = deriv?.status === 'LIVE' && typeof deriv?.funding === 'number' && Number.isFinite(deriv.funding);
  let frNote = isFundingLive ? 'فاندینگ نرمال' : 'داده فاندینگ در دسترس نیست (UNAVAILABLE)';
  if (isFundingLive && deriv.funding! > 0.05) {
    frNote = 'فاندینگ بالا = اشباع لانگ (ریسک ریزش)';
  } else if (isFundingLive && deriv.funding! < -0.05) {
    frNote = 'فاندینگ منفی = اشباع شورت (احتمال شورت اسکوییز)';
  }

  // 5. Order Flow & CVD Calculation (Strictly Distinct from L2 Depth OBI)
  const orderFlow = provOrderFlow;
  const hasFreshTradeFlow = orderFlow.isRealTradeFlow === true &&
    orderFlow.status === 'LIVE' &&
    typeof orderFlow.ageMs === 'number' && orderFlow.ageMs <= 5000;
  const cvdDelta = hasFreshTradeFlow ? orderFlow.cvdDelta : null;
  const cvdDivergence = hasFreshTradeFlow ? orderFlow.cvdDivergence : 'CVD UNKNOWN: live trade-level flow unavailable';
  const takerBuyVol = hasFreshTradeFlow ? orderFlow.takerBuyVol : null;
  const takerSellVol = hasFreshTradeFlow ? orderFlow.takerSellVol : null;
  const takerRatio = hasFreshTradeFlow ? orderFlow.takerRatio : null;

  const obvSlope = obv.length > 10 ? obv[obv.length - 1] - obv[obv.length - 10] : 0.0;
  const priceSlope = closes.length > 10 ? price - closes[closes.length - 10] : 0.0;
  const obvDiv =
    (priceSlope >= 0 && obvSlope >= 0) || (priceSlope < 0 && obvSlope < 0)
      ? 'همگرا با قیمت'
      : 'واگرایی حجمی هشدار!';

  // Funding Squeeze Detection
  let fundingSqueezeSignal = isFundingLive ? 'فاندینگ متعادل و بدون انحراف تله‌ای' : 'داده مشتقات ناموجود؛ اسکوئیز قابل سنجش نیست';
  if (isFundingLive && deriv.funding! < -0.025) {
    fundingSqueezeSignal = '🔥 پتانسیل پرتاب صعودی شورت اسکوئیز (Short Squeeze)';
  } else if (isFundingLive && deriv.funding! > 0.04) {
    fundingSqueezeSignal = '⚠️ ریسک لانگ اسکوئیز و لیکوییدیشن خریداران (Long Squeeze)';
  }

  // Expected Value calculation with Dynamic Friction & Fees (Issue 25)
  const roundtripFeeUsd = posUsd * 0.0011;
  const dynamicSlippageUsd = posUsd * 0.0004; // اسلیپیج پویا
  const potentialWinUsd = posUsd * (Math.abs(tp2 - price) / price);
  const potentialLossUsd = posUsd * (Math.abs(price - sl) / price);
  const netExpectedValue = calibratedWinProb !== null
    ? Math.round(((calibratedWinProb * potentialWinUsd) - ((1 - calibratedWinProb) * potentialLossUsd) - roundtripFeeUsd - dynamicSlippageUsd) * 100) / 100
    : 0;

  // ارزیابی توسط Shared Strategy Core برای اطمینان از اعمال اصول ۲۱ الی ۲۵
  const sharedDecision = evaluateSharedStrategy(candles, {}, {
    orderBookImbalance: realObiData?.obi ?? undefined,
    fundingRate: deriv.funding,
    sentimentScore: sentiment.score,
  });

  // Entry Timing and Strict R:R & Expectancy Gating (Issues 21, 22, 23, 25)
  let entryTiming: 'IMMEDIATE' | 'WAIT_FOR_PULLBACK' | 'WAIT_FOR_BREAKOUT' | 'NO_TRADE' = 'IMMEDIATE';
  let tradeThesis = `${confDirection === 'LONG' ? 'خرید' : 'فروش'} (${setupType})؛ همگرایی ${confScore}/5؛ تارگت لیکوییدیتی $${tp1.toLocaleString()}؛ ابطال ساختاری $${invalidationLevel.toLocaleString()}`;

  const isDataQualityBroken = Boolean(dataQualityReport && !dataQualityReport.isTradeAllowed);

  // 0) Central Probability Engine, Risk-Adjusted Edge & Trade Quality Gating (Rules 5 & 6)
  if (
    calibratedMetadata.selectiveMode.recommendation === 'WAIT_NO_TRADE' ||
    calibratedMetadata.calibratedWinProbability === null ||
    calibratedMetadata.isExpectancyNegative ||
    (calibratedMetadata.tradeQualityScore && !calibratedMetadata.tradeQualityScore.isTradeWorthy)
  ) {
    entryTiming = 'NO_TRADE';
    signalOk = false;
    lifecycleState = 'CANCELLED';
    tradeThesis = `🛑 WAIT / NO TRADE: ${calibratedMetadata.selectiveMode.rejectionReasonFa || calibratedMetadata.tradeQualityScore?.verdictFa || 'داده‌های کالیبراسیون کافی نیست یا برتری آماری احراز نشد.'}`;
  }
  // ۱) بررسی Hard Veto برای تضادهای بنیادین (Issue 23)
  else if (sharedDecision.hardVeto.isVetoed) {
    entryTiming = 'NO_TRADE';
    signalOk = false;
    lifecycleState = 'CANCELLED';
    tradeThesis = `⛔ توقف با Hard Veto: ${sharedDecision.hardVeto.vetoReasonFa}`;
  } 
  // ۲) بررسی فیلتر خستگی و ورود دیرهنگام (Issue 22: Exhaustion & Late Entry)
  else if (sharedDecision.exhaustion.isExhausted) {
    entryTiming = 'WAIT_FOR_PULLBACK';
    signalOk = false;
    tradeThesis = `⚠️ فیلتر خستگی حرکت (Late Entry / Exhaustion): قیمت ${sharedDecision.exhaustion.distanceFromOriginAtr} ATR از مبدأ فاصله گرفته. ورود مارکت ممنوع؛ فقط پولبک مجاز است.`;
  }
  // ۳) تفکیک ترند از ست‌آپ (Issue 21: Trend ≠ Setup)
  else if (sharedDecision.pipeline.setupType === 'NO_SETUP') {
    entryTiming = 'NO_TRADE';
    signalOk = false;
    tradeThesis = 'صبر کنید (WAIT): روند بازار مشخص است اما ست‌آپ ساختاری معتبر شکل نگرفته است (Trend ≠ Setup).';
  }
  // ۳.۵) پایش سخت‌گیرانه سقف بودجه ریسک بر اثر حداقل حجم و حاشیه امن لیکوییدیشن
  else if (isRiskBudgetBreachedByMinLot) {
    entryTiming = 'NO_TRADE';
    signalOk = false;
    lifecycleState = 'CANCELLED';
    tradeThesis = `🛑 لغو معامله: حداقل لات سایز مجاز صرافی (0.001 BTC) ریسک این معامله را از سقف بودجه ریسک (${dollarRiskBudget} USD) فراتر می‌برد. حساب برای این فاصله استاپ نیاز به بالانس بیشتری دارد.`;
  }
  else if (isLiquidationUnsafe) {
    entryTiming = 'NO_TRADE';
    signalOk = false;
    lifecycleState = 'CANCELLED';
    tradeThesis = `🛑 لغو معامله: فاصله قیمت تا قیمت لیکوییدیشن حتی با اهرم ۱x برای تامین حاشیه امن استاپ‌لاس، مارجین نگهداری (0.5%) و کارمزدها ناکافی است.`;
  }
  // ۴) بررسی کیفیت داده و امید ریاضی مثبت خالص (Issue 25: Expected Value)
  else if (isDataQualityBroken || isRangeBound || netExpectedValue <= 0 || riskRewardRatio < 1.30 || setupExpectancyR < 0.15) {
    entryTiming = 'NO_TRADE';
    signalOk = false;
    lifecycleState = 'CANCELLED';
    if (isDataQualityBroken) {
      tradeThesis = `🛑 توقف کامل معامله: فیدهای زنده بازار در دسترس نیست یا کیفیت داده کهنه/نامعتبر است (امتیاز کیفیت فید: ${dataQualityReport?.overallScore ?? 0}/100). معامله روی داده شبیه‌سازی ممنوع است.`;
    } else if (riskRewardRatio < 1.30) {
      tradeThesis = `🛑 لغو معامله: نسبت R:R ساختاری (${riskRewardRatio}R) کمتر از حداقل مجاز (1.30R) است. تغییر مصنوعی استاپ ممنوع است.`;
    } else if (netExpectedValue <= 0 || setupExpectancyR < 0.15) {
      tradeThesis = `🛑 لغو معامله: امید ریاضی ست‌آپ (EV: ${setupExpectancyR}R - خالص: $${netExpectedValue}) کمتر از حداقل آستانه سودآوری آماری (+0.15R) است.`;
    }
  } else if (!isTriggerConfirmed) {
    entryTiming = 'WAIT_FOR_PULLBACK';
    signalOk = false; // Cannot execute until trigger confirmed (Issue 7 & 21)
  }

  const expectedMaePct = isChasing ? 0.75 : currentFingerprint.expectedMaePct;
  const expectedMfePct = currentFingerprint.expectedMfePct;
  const efficiencyRatio = Math.round((expectedMfePct / (expectedMaePct + 0.01)) * 100) / 100;

  const entryQualityProfile = {
    expectedMaePct,
    expectedMfePct,
    prematureStopHitPct: isChasing ? 25.0 : 8.0,
    entryEfficiencyRatio: efficiencyRatio,
    optimalLocationDescriptionFa: isChasing
      ? '⚠️ هشدار تعقیب قیمت: ورود در قیمت فعلی دارای ریسک دراودان بالاست (Chasing Detected).'
      : 'ورود بهینه در ناحیه تخفیف اردر بلاک و نقدینگی با کمترین MAE احتمالی.',
    isChasingDetected: isChasing,
    distanceFromIdealZonePct: Math.round(distFromOptimalPct * 100) / 100
  };

  const observedAtMs = Date.now();
  const isDirectionalRejection = confDirection === 'LONG'
    ? lastCandle[3] > lastCandle[0] && lastCandle[2] < lastCandle[0]
    : lastCandle[3] < lastCandle[0] && lastCandle[1] > lastCandle[0];
  const isDirectionalDisplacement = currAtr > 0 &&
    (confDirection === 'LONG'
      ? lastCandle[3] > lastCandle[0]
      : lastCandle[3] < lastCandle[0]) &&
    Math.abs(lastCandle[3] - lastCandle[0]) >= currAtr * 0.5;
  const eventSequence = [
    {
      stage: 'LIQUIDITY_SWEEP' as const,
      passed: isLiquiditySweep,
      timestampUtc: observedAtMs,
      descriptionFa: 'جاروب آخرین سقف/کف قبلی و بازگشت قیمت در همین اسنپ‌شات'
    },
    {
      stage: 'REJECTION' as const,
      passed: isDirectionalRejection && isLiquiditySweep,
      timestampUtc: observedAtMs,
      descriptionFa: 'ریجکشن جهت‌دار کندل جاری پس از جاروب نقدینگی'
    },
    {
      stage: 'DISPLACEMENT' as const,
      passed: isDirectionalDisplacement,
      timestampUtc: observedAtMs,
      descriptionFa: 'جابجایی جهت‌دار کندل جاری با بدنه حداقل نیم ATR'
    },
    {
      stage: 'RETEST' as const,
      passed: Boolean(!isChasing),
      timestampUtc: observedAtMs,
      descriptionFa: 'تثبیت و بازآزمایی محدوده تعادلی بدون حرکت شتاب‌زده'
    },
    {
      stage: 'TRIGGER_CONFIRMATION' as const,
      passed: Boolean(isTriggerConfirmed),
      timestampUtc: observedAtMs,
      descriptionFa: 'تایید کندل جاری همراه با OBI و CVD واقعی هم‌جهت'
    },
    {
      stage: 'ENTRY_READY' as const,
      passed: Boolean(signalOk && !isChasing),
      timestampUtc: observedAtMs,
      descriptionFa: 'آماده ورود معاملاتی بر پایه پارامترهای کنترل ریسک'
    }
  ];

  const setupContext: SetupContext = {
    setupType,
    lifecycleState,
    currentMarketPrice: price,
    idealEntryZone: {
      min: optimalEntryZone.low,
      max: optimalEntryZone.high,
      optimal: optimalEntryZone.optimal,
      low: optimalEntryZone.low,
      high: optimalEntryZone.high
    },
    actualExecutableEntry: optimalEntryZone.optimal,
    invalidationLevel,
    triggerCondition: confDirection === 'LONG' ? `نفوذ به زون $${optimalEntryZone.optimal} و تایید کندل بالای $${triggerCandlePrice}` : `نفوذ به زون $${optimalEntryZone.optimal} و تایید کندل زیر $${triggerCandlePrice}`,
    isTriggerConfirmed,
    setupExpectancyR,
    riskRewardRatio,
    maePctExpected: expectedMaePct,
    mfePctExpected: expectedMfePct,
    entryQualityProfile,
    eventSequence,
    triggerQuality
  };

  const baseResult: AnalysisResult = {
    price,
    lastPrice: futuresPrices?.lastPrice || price,
    markPrice: futuresPrices?.markPrice || price,
    indexPrice: futuresPrices?.indexPrice || price,
    futuresPrices,
    slReport,
    maeMfeFingerprint: currentFingerprint,
    entryPriceType: 'LAST_PRICE',
    stopLossPriceType: 'MARK_PRICE',
    liquidationPriceType: 'MARK_PRICE',
    sentiment,
    htfCandles,
    action,
    actionCol,
    direction: confDirection,
    signalOk,
    confScore,
    technicalScore,
    consensusScore,
    confidenceScore,
    calibratedWinProbability: calibratedMetadata.calibratedWinProbability,
    scoreLong,
    scoreShort,
    mtf1m: htf1m,
    mtf5m: htf5m,
    mtf15m,
    mtf1h: htf1h,
    mtf4h: htf4h,
    mtfAlignment,
    mtfNote,
    marketRegime,
    isRangeBound,
    rangeBreakoutConfirmed,
    volatilityPct: Math.round(volatilityPct * 100) / 100,
    pullbackLimitPrice: optimalEntryZone.optimal,
    triggerCandlePrice,
    invalidationPrice: invalidationLevel,
    entryTiming,
    calibratedWinProb,
    calibratedMetadata,
    expectedValue: netExpectedValue,
    tradeThesis,
    setupContext,
    dataStatus,
    dataQualityReport,
    realObiData,
    canonicalSnapshot,
    orderFlowFeatures: orderFlow,
    takerBuyVol,
    takerSellVol,
    takerRatio,
    rawCandles: rawCandles || candles,
    sl,
    tp: tp3,
    tp1,
    tp2,
    tp3,
    slDistPct,
    leverage,
    margin: marginNeeded,
    posUsd,
    qtyBtc,
    riskUsd,
    rsi: currRsi,
    rsi1h: rsi1hResult.rsi1h,
    rsi1hDivergence: rsi1hResult.divergence,
    rsi1hConvergenceNoteFa: rsi1hResult.detailsFa,
    stoch: stochRsi(closes),
    cci: calcCci(candles),
    wr: calcWilliamsR(candles),
    mom: calcMomentum(closes),
    atr: currAtr,
    adx: adxVal,
    pdi,
    mdi,
    obv: obv[obv.length - 1],
    obvSlope,
    obvDiv,
    mfi: mfiVal,
    vwap: vwapVal,
    ema20Val: ema20[ema20.length - 1],
    ema50Val: ema50[ema50.length - 1],
    ema200Val: ema200[ema200.length - 1],
    supertrend: stTrend,
    fngVal: fngData?.status === 'LIVE' ? (fngData.value ?? null) : null,
    fngSent: fngData.sent,
    funding: isFundingLive ? deriv.funding : null,
    fundingRate: isFundingLive ? deriv.funding : null,
    fundingHistory: deriv.fundingHistory,
    fundingTrend: deriv.fundingTrend,
    oi: deriv?.status === 'LIVE' && typeof deriv.oi === 'number' ? deriv.oi : null,
    frNote,
    obi: effectiveObi,
    cvdDelta,
    cvdDivergence,
    fundingSqueezeSignal,
    forecastUp,
    forecastDown,
    smcOrderBlock,
    fvg,
    candles,
    ema20,
    ema50,
    ema200,
    stLine,
    bbUp,
    bbMid,
    bbLow,
    macdLine,
    macdSignal: sigLine,
    macdH,
  };

  try {
    const liqMap = generateLiquidityMap(candles, price, orderFlow, deriv, currAtr);
    const sweepSetup = detectLiquiditySweepReversal(candles, liqMap, price, currAtr);
    const cvdMatrix = computeCvdOiDivergenceMatrix(candles, price, orderFlow, deriv);
    const cascadePrediction = predictLiquidationCascade(candles, price, liqMap, deriv, currAtr);
    const regimeClass = classifyMarketRegime(candles, price, adxVal, currAtr, bbUp, bbLow, bbMid, vwapVal, orderFlow);
    const candidateSetup: EntryCandidateType = sweepSetup?.isReversalSetupActive ? 'LIQUIDITY_SWEEP_RECLAIM' : 'PULLBACK_ENTRY';
    const regimeEdgeMatrix = evaluateRegimeSetupEdge(
      candidateSetup,
      regimeClass.activeRegime,
      '15m',
      confDirection === 'SHORT' ? 'SHORT' : 'LONG'
    );

    const scoreForBias = (bias: string) => bias === 'BULLISH'
      ? scoreLong
      : bias === 'BEARISH'
        ? scoreShort
        : Math.max(scoreLong, scoreShort);
    const mtfStructuralReport = processMtfStructuralAnalysis(
      {
        '4h': htf4h === 'BULLISH' ? 'BULLISH' : (htf4h === 'BEARISH' ? 'BEARISH' : 'NEUTRAL'),
        '1h': htf1h === 'BULLISH' ? 'BULLISH' : (htf1h === 'BEARISH' ? 'BEARISH' : 'NEUTRAL'),
        '15m': mtf15m === 'BULLISH' ? 'BULLISH' : (mtf15m === 'BEARISH' ? 'BEARISH' : 'NEUTRAL'),
        '5m': htf5m === 'BULLISH' ? 'BULLISH' : (htf5m === 'BEARISH' ? 'BEARISH' : 'NEUTRAL'),
        '1m': htf1m === 'BULLISH' ? 'BULLISH' : (htf1m === 'BEARISH' ? 'BEARISH' : 'NEUTRAL'),
      },
      {
        '4h': scoreForBias(htf4h),
        '1h': scoreForBias(htf1h),
        '15m': scoreForBias(mtf15m),
        '5m': scoreForBias(htf5m),
        '1m': scoreForBias(htf1m),
      }
    );

    baseResult.liquidityMap = liqMap;
    baseResult.sweepReversalSetup = sweepSetup;
    baseResult.cvdOiMatrix = cvdMatrix;
    baseResult.liquidationCascadePrediction = cascadePrediction;
    baseResult.regimeClassification = regimeClass;
    baseResult.regimeSetupEdgeMatrix = regimeEdgeMatrix;
    baseResult.mtfStructuralReport = mtfStructuralReport;

    const competitionReport = runScenarioCompetition(candles, price, baseResult);
    baseResult.scenarioCompetitionReport = competitionReport;

    const noTradeReport = evaluateNoTradeProbability(candles, price, baseResult);
    baseResult.noTradePrediction = noTradeReport;
    if (noTradeReport.isNoTradeTriggered) {
      baseResult.signalOk = false;
      baseResult.action = 'HOLD';
      baseResult.actionCol = 'text-amber-400';
    }

    baseResult.marketRegime = regimeClass.activeRegime;
  } catch (error) {
    throw new Error('Market regime analysis failed; trade analysis is halted.', { cause: error });
  }

  try {
    const pipeline = runUnifiedDecisionPipeline({
      analysis: baseResult,
      targetDirection: confDirection,
      multiBrainReport: getLatestMultiBrainConsensusReport(
        baseResult.price,
        baseResult.canonicalSnapshot?.timestampUtc ?? baseResult.realObiData?.timestamp ?? null
      ),
      balance: balance || 1000,
      userLeverage: leverage,
      minWinProbability: 68,
      isAutoTrade: false,
    });
    baseResult.decisionPipeline = pipeline;
  } catch (error) {
    throw new Error('Unified decision pipeline failed; analysis is halted.', { cause: error });
  }

  return baseResult;
}
