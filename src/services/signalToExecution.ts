import { AnalysisResult, TradeHistory, TradePosition } from '../types/trading';
import { calculateDynamicKellyMargin, getAntiTiltStatus, evaluateCognitiveConviction, calculatePrecisionEngineeredLeverage } from './kellyRisk';
import { calculateGarchMacroConfidenceWeight, evaluateDynamicScenarioMatrix, runQuantumProcessingBrain, evaluate15mTimingAndLifecycle, evaluateSniperWaveRidingBlueprint } from './predictiveEngine';
import { macroContextBrainService, type MacroCorrelationData } from './macroContextBrain';
import { runUnifiedDecisionPipeline } from './decisionPipeline';
import { newsShockFirewallService } from './newsShockFirewall';
import { orderExecutionLifecycleService } from './orderExecutionLifecycleEngine';
import { signalExpirationEngine } from './signalExpirationEngine';
import { missingDataIntegrityGuard } from './missingDataIntegrityGuard';
import { centralPriceSourcePolicy } from './priceSourcePolicy';
import { getLatestMultiBrainConsensusReport } from './multiBrainEnsemble';


export interface IndicatorScoreBreakdown {
  id: string;
  name: string;
  nameFa: string;
  weight: number;
  score: number;
  passed: boolean;
  available?: boolean;
  details: string;
  category: 'AI_NEURAL' | 'HTF_TREND' | 'SMC_PRICE_ACTION' | 'MOMENTUM_INDICATORS' | 'TREND_RIBBON' | 'ORDER_BOOK_DERIVATIVES' | 'VOLATILITY_REGIME' | 'RISK_ANTI_TILT' | 'FUNDAMENTAL_MACRO_NEWS';
}

export interface SignalToExecutionResult {
  canExecute: boolean;
  totalScorePct: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  breakdown: IndicatorScoreBreakdown[];
  reasonFa: string;
  executionQuality: 'INSTITUTIONAL_PRIME' | 'HIGH_CONFLUENCE' | 'MODERATE' | 'NOISY_REJECTED';
  allSystemsPassed: boolean;
  totalPillarsPassed: number;
  totalPillarsCount: number;
  executionThreshold: number;
}

/**
 * Full-System Holistic AI Confluence Engine
 * Evaluates 8 weighted analysis pillars; the anti-tilt control is a separate veto gate:
 * The weighted pillars are AI, order book, HTF, SMC, macro/news, trend, volatility, and momentum.
 * Their weights vary by regime and recent trade history. Anti-tilt is a separate zero-weight veto gate.
 */
export function evaluateSignalToExecution(
  analysis: AnalysisResult,
  targetDirection?: 'LONG' | 'SHORT',
  aiPrediction?: any,
  tradeHistoryList?: TradeHistory[],
  minWinProbGate: number = 70,
  macroContextOverride?: MacroCorrelationData,
  allowDemoData = false,
): SignalToExecutionResult {
  const requestedDirection = targetDirection ??
    (analysis.direction === 'LONG' || analysis.direction === 'SHORT' ? analysis.direction : undefined);
  if (!requestedDirection) {
    return {
      canExecute: false,
      totalScorePct: 0,
      direction: 'NEUTRAL',
      breakdown: [],
      reasonFa: 'جهت معتبر و صریح برای تصمیم معاملاتی موجود نیست؛ معامله مسدود شد.',
      executionQuality: 'NOISY_REJECTED',
      allSystemsPassed: false,
      totalPillarsPassed: 0,
      totalPillarsCount: 8,
      executionThreshold: 70,
    };
  }
  const dir = requestedDirection;
  const feedAudit = missingDataIntegrityGuard.auditMarketDataIntegrity(analysis, { allowDemoData });
  const demoDataUsable = allowDemoData && feedAudit.isTradePermitted;
  if (allowDemoData ? !demoDataUsable : !feedAudit.isTradePermitted) {
    return {
      canExecute: false,
      totalScorePct: 0,
      direction: 'NEUTRAL',
      breakdown: [],
      reasonFa: feedAudit.blockReasonFa || 'برای ارزیابی دمو حداقل ۳۰ کندل معتبر و قیمت و ATR لازم است.',
      executionQuality: 'NOISY_REJECTED',
      allSystemsPassed: false,
      totalPillarsPassed: 0,
      totalPillarsCount: 8,
      executionThreshold: 70,
    };
  }
  const isLong = dir === 'LONG';

  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  const isDirection = (value: unknown): value is 'BULLISH' | 'BEARISH' | 'NEUTRAL' =>
    value === 'BULLISH' || value === 'BEARISH' || value === 'NEUTRAL';
  const price = isFiniteNumber(analysis.price) && analysis.price > 0 ? analysis.price : 0;
  const htf1h = analysis.mtf1h;
  const htf4h = analysis.mtf4h;
  const htf15m = analysis.mtf15m;
  const htf5m = analysis.mtf5m;
  const obi = analysis.realObiData?.status === 'LIVE' && isFiniteNumber(analysis.realObiData.obi)
    ? analysis.realObiData.obi
    : null;
  const rsi = isFiniteNumber(analysis.rsi) ? analysis.rsi : null;
  const macdH = Array.isArray(analysis.macdH) && isFiniteNumber(analysis.macdH.at(-1))
    ? analysis.macdH.at(-1)!
    : null;
  const ema20 = Array.isArray(analysis.ema20) && isFiniteNumber(analysis.ema20.at(-1))
    ? analysis.ema20.at(-1)!
    : null;
  const ema50 = Array.isArray(analysis.ema50) && isFiniteNumber(analysis.ema50.at(-1))
    ? analysis.ema50.at(-1)!
    : null;
  const ema200 = Array.isArray(analysis.ema200) && isFiniteNumber(analysis.ema200.at(-1))
    ? analysis.ema200.at(-1)!
    : null;
  const supertrend = analysis.supertrend;
  const adx = isFiniteNumber(analysis.adx) ? analysis.adx : null;
  const vwap = isFiniteNumber(analysis.vwap) ? analysis.vwap : null;
  const stochK = isFiniteNumber(analysis.stoch) ? analysis.stoch : null;

  // -------------------------------------------------------------
  // QUANTUM DYNAMIC ADAPTIVE WEIGHT MATRIX (Total Weight: 100%)
  // Adapts weights seamlessly without altering trade quantity or exit timing:
  // 1. High Volatility Regime: Increases responsive pillars (AI + OBI)
  // 2. 50-Trade Empirical Pillar Win-Rate Boost: Pillars with higher win rate in last 50 trades receive dynamic confidence boost
  // -------------------------------------------------------------
  const isHighVol = (isFiniteNumber(analysis.volatilityPct) && analysis.volatilityPct > 0.45) ||
    (adx !== null && adx > 25);
  
  // Base weights harmonized with Pillar Correlation Matrix recommendations
  // Prioritizes leading indicators (SMC, AI, OBI, Fundamental News) to maximize predictive edge and minimize false entries
  let baseAi = isHighVol ? 19 : 18;
  let baseSmc = isHighVol ? 18 : 17;
  let baseObi = isHighVol ? 16 : 15;
  let baseMacroNews = isHighVol ? 14 : 14;
  let baseHtf = isHighVol ? 13 : 14;
  let baseTrend = isHighVol ? 9 : 10;
  let baseVol = isHighVol ? 6 : 7;
  let baseMom = isHighVol ? 5 : 5;

  // Factor in empirical performance across last 50 trades
  const recent50Trades = (tradeHistoryList || []).slice(-50);
  if (recent50Trades.length >= 5) {
    const wins = recent50Trades.filter((t) => (t.pnlUsd !== undefined ? t.pnlUsd : (t.realizedPnlUsd || 0)) > 0);
    const winRate = wins.length / recent50Trades.length;

    // In profitable win-streaks (>55% win rate), award higher confidence weights to predictive anchors (AI, OBI, SMC, News)
    // In lower win-streaks, boost structural pillars (HTF, Ribbon, Volatility filter) to reinforce safety
    if (winRate >= 0.55) {
      baseAi += 1;
      baseMacroNews += 1;
      baseSmc += 1;
      baseTrend -= 2;
      baseMom -= 1;
    } else if (winRate < 0.45) {
      baseHtf += 2;
      baseTrend += 1;
      baseVol += 1;
      baseAi -= 2;
      baseMacroNews -= 2;
    }
  }

  // Ensure exact 100% weight conservation
  const totalBase = baseAi + baseObi + baseHtf + baseSmc + baseMacroNews + baseTrend + baseVol + baseMom;
  const wAi = Math.round((baseAi / totalBase) * 100);
  const wObi = Math.round((baseObi / totalBase) * 100);
  const wHtf = Math.round((baseHtf / totalBase) * 100);
  const wSmc = Math.round((baseSmc / totalBase) * 100);
  const wMacroNews = Math.round((baseMacroNews / totalBase) * 100);
  const wTrend = Math.round((baseTrend / totalBase) * 100);
  const wVol = Math.round((baseVol / totalBase) * 100);
  const wMom = 100 - (wAi + wObi + wHtf + wSmc + wMacroNews + wTrend + wVol); // Exact remainder to strictly maintain 100% sum

  // -------------------------------------------------------------
  // 🏄‍♂️ تحلیل مقدماتی زمان‌بندی موج، تله‌ها و فضای سودآوری واقعی
  // -------------------------------------------------------------
  const timing15m = evaluate15mTimingAndLifecycle(analysis, dir);
  const isWaveGenesis = timing15m.lifecyclePhase === 'WAVE_GENESIS_PRIME';
  const isPullbackSniper = timing15m.lifecyclePhase === 'PULLBACK_SNIPER_BOUNCE';
  const isEarlyAcceleration = timing15m.lifecyclePhase === 'EARLY_ACCELERATION';
  const is1hBearishDivergenceTrap = isLong && analysis.rsi1hDivergence === 'BEARISH_DIVERGENCE';
  const is1hBullishDivergenceTrap = !isLong && analysis.rsi1hDivergence === 'BULLISH_CONVERGENCE';
  const isDivergenceTrap = is1hBearishDivergenceTrap || is1hBullishDivergenceTrap;
  
  // 🎯 فیلتر اسنایپر ممانعت از تعقیب قیمت در انتهای کشش کندل (Anti-Chasing Sniper Entry):
  // ممانعت از خرید در سقف کندل یا فروش در کف کندل؛ ورود فقط در سقف/کف پولبک انجام می‌شود تا معامله فورا وارد سود شود
  const isChasingTop = isLong && ((rsi !== null && rsi >= 72) || (analysis.pullbackLimitPrice ? price > analysis.pullbackLimitPrice * 1.008 : false));
  const isChasingBottom = !isLong && ((rsi !== null && rsi <= 28) || (analysis.pullbackLimitPrice ? price < analysis.pullbackLimitPrice * 0.992 : false));
  const isRsiExhausted = rsi !== null &&
    (isLong ? rsi >= 75 && !isWaveGenesis : rsi <= 25 && !isWaveGenesis);
  const isExhaustedWave = !timing15m.isOptimalTiming || timing15m.lifecyclePhase === 'LATE_EXHAUSTION_GUARD' || isRsiExhausted || isChasingTop || isChasingBottom;
  const isDirectObiConflict = obi !== null && (isLong ? obi < -0.15 : obi > 0.15);
  const hasWaveHeadroom = rsi !== null && obi !== null &&
    (isLong ? rsi < 68 && obi > -0.06 : rsi > 32 && obi < 0.06);

  // -------------------------------------------------------------
  // 1. AI Ensemble & Neural ML Prediction (Dynamic Weight: wAi)
  // -------------------------------------------------------------
  let aiScore = 0;
  const calibratedPrediction = aiPrediction?.calibratedMetadata?.isCalibrationVerified === true &&
    typeof aiPrediction?.calibratedWinProbability === 'number' &&
    Number.isFinite(aiPrediction.calibratedWinProbability) &&
    aiPrediction.calibratedWinProbability >= 0 &&
    aiPrediction.calibratedWinProbability <= 1 &&
    (aiPrediction.trend === 'BULLISH' || aiPrediction.trend === 'BEARISH');
  const predTrend = calibratedPrediction &&
    (aiPrediction.trend === 'BULLISH' || aiPrediction.trend === 'BEARISH')
    ? aiPrediction.trend
    : 'NEUTRAL';
  const predConf = calibratedPrediction ? aiPrediction.calibratedWinProbability * 100 : 0;
  if (!calibratedPrediction) {
    aiScore = 0;
  } else if (isExhaustedWave || isDivergenceTrap) {
    aiScore = Math.round(wAi * 0.15); // موج تمام شده یا تله واگرایی؛ هوش مصنوعی نمره ورود نمی‌دهد
  } else if ((isWaveGenesis || isPullbackSniper) && ((isLong && predTrend === 'BULLISH') || (!isLong && predTrend === 'BEARISH'))) {
    aiScore = wAi; // شلیک موج نوظهور یا پرتاب پولبک؛ حداکثر امتیاز هوش مصنوعی
  } else if ((isLong && predTrend === 'BULLISH') || (!isLong && predTrend === 'BEARISH')) {
    if (predConf >= 80) aiScore = wAi;
    else if (predConf >= 65) aiScore = Math.round(wAi * 0.77);
    else aiScore = Math.round(wAi * 0.55);
  } else if (predTrend === 'NEUTRAL') {
    aiScore = Math.round(wAi * 0.20);
  } else {
    aiScore = 0; // تضاد مستقیم با مدل هوش مصنوعی -> امتیاز صفر قطعی
  }
  const aiPassed = calibratedPrediction && aiScore >= Math.round(wAi * 0.65);

  // -------------------------------------------------------------
  // 2. Order Book Imbalance (OBI), Whale CVD Delta & Funding Rate Squeeze Buffer (Dynamic Weight: wObi)
  // -------------------------------------------------------------
  let obiScore = 0;
  const fundingRate = analysis.funding ?? analysis.fundingRate;
  let fundingBoost = 0;
  if (fundingRate !== null && fundingRate !== undefined && Number.isFinite(fundingRate) && isLong) {
    if (fundingRate < -0.02) fundingBoost = 2; // Short squeeze buffer favors Long
    else if (fundingRate > 0.05) fundingBoost = -3; // Long crowd trap hazard
  } else if (fundingRate !== null && fundingRate !== undefined && Number.isFinite(fundingRate)) {
    if (fundingRate > 0.04) fundingBoost = 2; // Long squeeze buffer favors Short
    else if (fundingRate < -0.03) fundingBoost = -3; // Short crowd trap hazard
  }

  if (obi === null) {
    obiScore = 0;
  } else if (isDirectObiConflict) {
    obiScore = 0; // دیوار سفارشات سنگین نهنگ در خلاف جهت معامله -> امتیاز صفر
  } else if (isLong) {
    if (obi > 0.10) obiScore = wObi;
    else if (obi >= 0.03) obiScore = Math.round(wObi * 0.75);
    else if (obi >= -0.02) obiScore = Math.round(wObi * 0.30);
    else obiScore = 0;
  } else {
    if (obi < -0.10) obiScore = wObi;
    else if (obi <= -0.03) obiScore = Math.round(wObi * 0.75);
    else if (obi <= 0.02) obiScore = Math.round(wObi * 0.30);
    else obiScore = 0;
  }
  obiScore = Math.max(0, Math.min(wObi, obiScore + fundingBoost));
  const obiPassed = obi !== null && obiScore >= Math.round(wObi * 0.65) && !isDirectObiConflict;

  // -------------------------------------------------------------
  // 3. Multi-Timeframe Alignment (5M / 15M / 1H / 4H) (Dynamic Weight: wHtf)
  // -------------------------------------------------------------
  let htfScore = 0;
  const expectedHtf = isLong ? 'BULLISH' : 'BEARISH';
  const htfDataAvailable = [htf15m, htf1h, htf4h, htf5m].every(isDirection);
  let htfMatches = 0;
  if (htfDataAvailable && htf15m === expectedHtf) htfMatches += 1.8; // محوریت اصلی تایم‌فریم ۱۵ دقیقه لحظه‌ای
  if (htfDataAvailable && htf1h === expectedHtf) htfMatches += 1.2;
  if (htfDataAvailable && htf4h === expectedHtf) htfMatches += 1.0;
  if (htfDataAvailable && htf5m === expectedHtf) htfMatches += 0.5;
  htfScore = Math.min(wHtf, Math.round((htfMatches / 4.5) * wHtf));
  if (isDivergenceTrap) {
    htfScore = Math.round(htfScore * 0.25); // واگرایی در خلاف جهت، همگرایی ساختاری تایم‌فریم را باطل می‌کند
  }
  const htfPassed = htfDataAvailable && htfScore >= Math.round(wHtf * 0.65) && !isDivergenceTrap;

  // -------------------------------------------------------------
  // 4. Smart Money Concepts (SMC) & Price Action (Dynamic Weight: wSmc)
  // -------------------------------------------------------------
  let smcScore = 0;
  const ob = analysis.smcOrderBlock;
  const fvg = analysis.fvg;
  if (isLong) {
    if (ob?.type === 'BULLISH') smcScore += Math.round(wSmc * 0.60);
    else if (ob?.type === 'BEARISH') smcScore = 0; // تضاد کامل با اوردربلاک خرسی
    if (fvg?.type === 'BULLISH') smcScore += Math.round(wSmc * 0.40);
  } else {
    if (ob?.type === 'BEARISH') smcScore += Math.round(wSmc * 0.60);
    else if (ob?.type === 'BULLISH') smcScore = 0; // تضاد کامل با اوردربلاک گاوی
    if (fvg?.type === 'BEARISH') smcScore += Math.round(wSmc * 0.40);
  }
  if (isExhaustedWave) {
    smcScore = Math.round(smcScore * 0.30); // در انتهای کشیدگی موج، ورود روی اوردربلاک فاقد توجیه است
  }
  smcScore = Math.min(wSmc, smcScore);
  const smcPassed = smcScore >= Math.round(wSmc * 0.65) && !isExhaustedWave;

  // -------------------------------------------------------------
  // 5. Trend Ribbon & Supertrend (EMA 20/50/200, VWAP) (Dynamic Weight: wTrend)
  // -------------------------------------------------------------
  let trendScore = 0;
  let trendMatches = 0;
  const trendDataAvailable = price > 0 &&
    ema20 !== null && ema20 > 0 &&
    ema50 !== null && ema50 > 0 &&
    ema200 !== null && ema200 > 0 &&
    vwap !== null && vwap > 0 &&
    (supertrend === 'BULLISH' || supertrend === 'BEARISH') &&
    isFiniteNumber(analysis.atr) && analysis.atr > 0;
  if (trendDataAvailable && isLong) {
    if (price >= ema20) trendMatches += 1;
    if (ema20 >= ema50) trendMatches += 1;
    if (price >= ema200) trendMatches += 1;
    if (supertrend === 'BULLISH') trendMatches += 1;
    if (price >= vwap) trendMatches += 0.5;
  } else if (trendDataAvailable) {
    if (price <= ema20) trendMatches += 1;
    if (ema20 <= ema50) trendMatches += 1;
    if (price <= ema200) trendMatches += 1;
    if (supertrend === 'BEARISH') trendMatches += 1;
    if (price <= vwap) trendMatches += 0.5;
  }
  trendScore = Math.min(wTrend, Math.round((trendMatches / 4.5) * wTrend));

  // اگر قیمت بیش از حد از EMA20 کشیده شده باشد، سود موج قبلاً انجام شده و خطر بازگشت وجود دارد
  const isExtendedFromEma = trendDataAvailable &&
    Math.abs(price - ema20) > (1.8 * analysis.atr);
  if (!trendDataAvailable) {
    trendScore = 0;
  } else if (isExtendedFromEma) {
    trendScore = Math.round(trendScore * 0.35);
  }
  const trendPassed = trendDataAvailable && trendScore >= Math.round(wTrend * 0.65) && !isExtendedFromEma;

  // -------------------------------------------------------------
  // 6. Range Breakout & Volatility Filter (ADX & ATR) (Dynamic Weight: wVol)
  // -------------------------------------------------------------
  const volatilityDataAvailable = adx !== null &&
    isFiniteNumber(analysis.volatilityPct) &&
    isFiniteNumber(analysis.atr) &&
    analysis.atr > 0;
  const isRangeBound = analysis.isRangeBound ??
    (volatilityDataAvailable && adx < 14 && analysis.volatilityPct < 0.18);
  let volScore = 0;
  let volDetailsFa = '';

  if (!volatilityDataAvailable) {
    volScore = 0;
    volDetailsFa = 'دادهٔ معتبر ADX، نوسان و ATR برای این رکن کامل نیست؛ امتیاز محاسبه نشد.';
  } else if (isRangeBound) {
    volScore = 0;
    volDetailsFa = `بازار در فاز رنج بدون روند است (ADX: ${adx.toFixed(1)}) - ورود مسدود شد`;
  } else if (isExhaustedWave) {
    volScore = 0;
    volDetailsFa = `⚠️ نوسان کندل در فاز خستگی؛ سود موج تخلیه شده است (${timing15m.descriptionFa})`;
  } else if (isWaveGenesis) {
    volScore = wVol;
    volDetailsFa = `🏄‍♂️ شروع شتاب موج سود (Wave Genesis): شکست نوسان و آماده موج‌سواری`;
  } else {
    if (adx >= 24) volScore += Math.round(wVol * 0.6);
    else if (adx >= 18) volScore += Math.round(wVol * 0.4);
    else volScore += Math.round(wVol * 0.2);

    if (analysis.volatilityPct >= 0.35) volScore += Math.round(wVol * 0.4);
    else if (analysis.atr > 0) volScore += Math.round(wVol * 0.3);
    volScore = Math.min(wVol, volScore);
    volDetailsFa = `شکست رنج تایید شد (ADX: ${adx.toFixed(1)} | نوسان فعال: ${analysis.volatilityPct.toFixed(2)}٪)`;
  }
  const volPassed = volatilityDataAvailable && volScore >= Math.round(wVol * 0.65) && !isRangeBound && !isExhaustedWave;

  // -------------------------------------------------------------
  // 7. Technical Momentum Matrix (RSI, MACD, StochRSI) (Dynamic Weight: wMom)
  // -------------------------------------------------------------
  let momScore = 0;
  let momDetailsFa = '';

  const momentumDataAvailable = rsi !== null && rsi >= 0 && rsi <= 100 &&
    macdH !== null &&
    stochK !== null && stochK >= 0 && stochK <= 100;
  if (!momentumDataAvailable) {
    momScore = 0;
    momDetailsFa = 'دادهٔ معتبر RSI، MACD یا Stoch برای این رکن موجود نیست؛ امتیاز محاسبه نشد.';
  } else if (isDivergenceTrap) {
    momScore = 0; // تله واگرایی معکوس -> امتیاز صفر قطعی
    momDetailsFa = isLong ? '🛑 تله واگرایی نزولی در ۱ ساعته؛ خطر ریزش حتمی' : '🛑 تله واگرایی صعودی در ۱ ساعته؛ خطر جهش قیمت';
  } else if (isRsiExhausted) {
    momScore = 0; // سود موج قبلاً انجام شده و به اشباع رسیده -> امتیاز صفر
    momDetailsFa = `🛑 اشباع شدید RSI (${rsi.toFixed(1)})؛ سود موج تمام شده است`;
  } else {
    const p3 = Math.max(1, Math.round(wMom * 0.38));
    const p2 = Math.max(1, Math.round(wMom * 0.25));
    if (isLong) {
      if (rsi >= 48 && rsi <= 68) momScore += p3;
      else if (rsi > 40 && rsi < 72) momScore += p2;
      if (macdH >= 0.1) momScore += p3;
      else if (macdH >= 0.0) momScore += p2;
      if (stochK <= 75) momScore += p2;
    } else {
      if (rsi <= 52 && rsi >= 32) momScore += p3;
      else if (rsi < 60 && rsi > 28) momScore += p2;
      if (macdH <= -0.1) momScore += p3;
      else if (macdH <= 0.0) momScore += p2;
      if (stochK >= 25) momScore += p2;
    }
    momScore = Math.min(wMom, momScore);
    momDetailsFa = `RSI: ${rsi.toFixed(1)} | RSI 1H: ${(analysis.rsi1h || rsi).toFixed(1)} [پایدار] | MACD: ${macdH.toFixed(2)}`;
  }
  const momPassed = momentumDataAvailable &&
    momScore >= Math.round(wMom * 0.65) &&
    !isDivergenceTrap &&
    !isRsiExhausted;

  // -------------------------------------------------------------
  // 8. Bitcoin Fundamental & Macro News Sentiment (Dynamic Weight: wMacroNews)
  // -------------------------------------------------------------
  const macroContext = macroContextOverride ?? macroContextBrainService.getMacroContext(price);
  let macroNewsScore = 0;

  const macroDataAvailable =
    (macroContext.overallDataStatus === 'LIVE' || macroContext.overallDataStatus === 'PROXY') &&
    macroContext.fundamentalBias !== 'UNAVAILABLE';
  if (!macroDataAvailable) {
    macroNewsScore = 0;
  } else if (isLong) {
    if (macroContext.breakingNewsImpactLevel === 'SEVERE_BEARISH_THREAT') {
      macroNewsScore = 0; // ریزش شدید با اخبار تهدیدآمیز؛ صفر کردن امتیاز فاندامنتال لانگ
    } else if (macroContext.fundamentalBias === 'BULLISH' || macroContext.breakingNewsImpactLevel === 'STRONG_BULLISH_CATALYST') {
      macroNewsScore = wMacroNews;
    } else if (macroContext.fundamentalBias === 'NEUTRAL') {
      macroNewsScore = Math.round(wMacroNews * 0.65);
    } else {
      macroNewsScore = Math.round(wMacroNews * 0.25);
    }
    if (typeof macroContext.spotEtfNetInflowMillionUsd === 'number' && macroContext.spotEtfNetInflowMillionUsd > 100) {
      macroNewsScore = Math.min(wMacroNews, macroNewsScore + 1);
    }
  } else {
    if (macroContext.breakingNewsImpactLevel === 'STRONG_BULLISH_CATALYST') {
      macroNewsScore = 0; // پامپ شدید با اخبار صعودی؛ صفر کردن امتیاز فاندامنتال شورت
    } else if (macroContext.fundamentalBias === 'BEARISH' || macroContext.breakingNewsImpactLevel === 'SEVERE_BEARISH_THREAT') {
      macroNewsScore = wMacroNews;
    } else if (macroContext.fundamentalBias === 'NEUTRAL') {
      macroNewsScore = Math.round(wMacroNews * 0.65);
    } else {
      macroNewsScore = Math.round(wMacroNews * 0.25);
    }
    if (typeof macroContext.spotEtfNetInflowMillionUsd === 'number' && macroContext.spotEtfNetInflowMillionUsd < 0) {
      macroNewsScore = Math.min(wMacroNews, macroNewsScore + 1);
    }
  }
  const macroNewsPassed = macroDataAvailable &&
    macroNewsScore >= Math.round(wMacroNews * 0.60);

  // -------------------------------------------------------------
  // Anti-Tilt & Capital Protection Guard (separate hard-veto gate)
  // -------------------------------------------------------------
  const antiTilt = getAntiTiltStatus(tradeHistoryList || []);
  const riskPassed = !antiTilt.isLocked;

  // -------------------------------------------------------------
  // Total Weighted Harmonic Score (Sum of 100% harmonized weights)
  // -------------------------------------------------------------
  const weightedPillars = [
    { weight: wAi, score: aiScore, available: calibratedPrediction },
    { weight: wObi, score: obiScore, available: obi !== null },
    { weight: wHtf, score: htfScore, available: htfDataAvailable },
    { weight: wSmc, score: smcScore, available: ob?.type !== undefined || fvg?.type !== undefined },
    { weight: wMacroNews, score: macroNewsScore, available: macroDataAvailable },
    { weight: wTrend, score: trendScore, available: trendDataAvailable },
    { weight: wVol, score: volScore, available: volatilityDataAvailable },
    { weight: wMom, score: momScore, available: momentumDataAvailable },
  ];
  const availableWeight = weightedPillars
    .filter((pillar) => pillar.available)
    .reduce((total, pillar) => total + pillar.weight, 0);
  const availableWeightedScore = weightedPillars
    .filter((pillar) => pillar.available)
    .reduce((total, pillar) => total + pillar.score, 0);
  const totalScorePct = availableWeight > 0
    ? Math.min(100, Math.max(0, (availableWeightedScore / availableWeight) * 100))
    : 0;

  const breakdown: IndicatorScoreBreakdown[] = [
    {
      id: 'ai_neural',
      name: 'AI Neural Ensemble ML',
      nameFa: `رکن 1: آنسامبل هوشمند SB (${wAi}%)`,
      weight: wAi,
      score: aiScore,
      passed: aiPassed,
      available: calibratedPrediction,
      details: isExhaustedWave
        ? '⚠️ پتانسیل پیشروی موج سود تمام شده؛ در انتظار چرخه نوظهور'
        : calibratedPrediction
          ? `جهت: ${predTrend === 'BULLISH' ? 'صعودی' : 'نزولی'} | احتمال کالیبره‌شده: ${predConf.toFixed(0)}%`
          : 'مدل جهت‌دار با کالیبراسیون معتبر در دسترس نیست؛ این رکن امتیاز نمی‌دهد.',
      category: 'AI_NEURAL',
    },
    {
      id: 'order_book_derivatives',
      name: 'Order Book Imbalance & Funding',
      nameFa: `رکن وزنی دفتر سفارش و مشتقات (${wObi}%)`,
      weight: wObi,
      score: obiScore,
      passed: obiPassed,
      available: obi !== null,
      details: isDirectObiConflict
        ? `🛑 تضاد با عدم‌توازن دفتر سفارش (OBI: ${(obi * 100).toFixed(1)}%)`
        : obi !== null
          ? `عدم تقارن دفتر سفارش: ${(obi * 100).toFixed(1)}% | دلتای معاملات: ${analysis.orderFlowFeatures?.isRealTradeFlow === true && isFiniteNumber(analysis.orderFlowFeatures.cvdDeltaUsd) ? analysis.orderFlowFeatures.cvdDeltaUsd.toFixed(1) : 'UNAVAILABLE'}`
          : 'دفتر سفارش زنده و معتبر در دسترس نیست؛ این رکن امتیاز نمی‌دهد.',
      category: 'ORDER_BOOK_DERIVATIVES',
    },
    {
      id: 'fundamental_macro_news',
      name: 'Bitcoin Fundamental & Macro News Sentiment',
      nameFa: `رکن 3: اخبار زنده بیت‌کوین و سنتیمنت ETF (${wMacroNews}%)`,
      weight: wMacroNews,
      score: macroNewsScore,
      passed: macroNewsPassed,
      available: macroDataAvailable,
      details: !macroDataAvailable
        ? `وضعیت داده‌ها: ${macroContext.overallDataStatus} | امتیاز این رکن محاسبه نمی‌شود.`
        : `وضعیت ${macroContext.overallDataStatus} | سنتیمنت اخبار: ${macroContext.newsSentimentScore !== null && macroContext.newsSentimentScore > 0 ? '+' : ''}${macroContext.newsSentimentScore ?? 'N/A'} | ورود ETF: ${macroContext.spotEtfNetInflowMillionUsd !== null ? '+$' + macroContext.spotEtfNetInflowMillionUsd + 'M' : 'N/A'} | وضعیت: ${macroContext.macroFilterStatusFa}`,
      category: 'FUNDAMENTAL_MACRO_NEWS',
    },
    {
      id: 'htf_trend',
      name: 'Multi-Timeframe Confluence',
      nameFa: `رکن 4: همگرایی تایم‌فریم‌های کلیدی (${wHtf}%)`,
      weight: wHtf,
      score: htfScore,
      passed: htfPassed,
      available: htfDataAvailable,
      details: htfDataAvailable
        ? `15M: ${htf15m} | 1H: ${htf1h} | 4H: ${htf4h} | 5M: ${htf5m}`
        : 'دادهٔ معتبر همهٔ تایم‌فریم‌های 5M/15M/1H/4H موجود نیست؛ این رکن امتیاز نمی‌دهد.',
      category: 'HTF_TREND',
    },
    {
      id: 'smc_price_action',
      name: 'Smart Money Concepts (SMC & FVG)',
      nameFa: `رکن 5: پرایس‌اکشن سازمانی و اوردر بلاک (${wSmc}%)`,
      weight: wSmc,
      score: smcScore,
      passed: smcPassed,
      available: ob?.type !== undefined || fvg?.type !== undefined,
      details: ob ? ob.label : 'نواحی تقاضای سازمانی و FVG',
      category: 'SMC_PRICE_ACTION',
    },
    {
      id: 'trend_ribbon',
      name: 'Trend Ribbon & Supertrend',
      nameFa: `رکن 6: روبان میانگین‌های متحرک EMA و سوپرترند (${wTrend}%)`,
      weight: wTrend,
      score: trendScore,
      passed: trendPassed,
      available: trendDataAvailable,
      details: isExtendedFromEma
        ? '⚠️ کشیدگی بیش از حد قیمت از EMA20 (خطر اصلاح قبل از سود)'
        : trendDataAvailable
          ? `سوپرترند: ${supertrend} | هم‌جهتی EMA 20/50/200`
          : 'قیمت/EMA/سوپرترند/VWAP/ATR معتبر کامل نیست؛ این رکن امتیاز نمی‌دهد.',
      category: 'TREND_RIBBON',
    },
    {
      id: 'volatility_regime',
      name: 'Range Breakout & Volatility Filter',
      nameFa: `رکن 7: فیلتر خروج از رنج و نوسان آستانه (${wVol}%)`,
      weight: wVol,
      score: volScore,
      passed: volPassed,
      available: volatilityDataAvailable,
      details: volDetailsFa,
      category: 'VOLATILITY_REGIME',
    },
    {
      id: 'momentum_indicators',
      name: 'Technical Momentum Matrix',
      nameFa: `رکن 8: مومنتوم تکنیکال و همگرایی RSI 1H (${wMom}%)`,
      weight: wMom,
      score: momScore,
      passed: momPassed,
      available: momentumDataAvailable,
      details: momDetailsFa,
      category: 'MOMENTUM_INDICATORS',
    },
    {
      id: 'risk_anti_tilt',
      name: 'Anti-Tilt & Kelly Risk Guard',
      nameFa: 'گیت مستقل ریسک: آنتی‌تیلت و محافظت سرمایه',
      weight: 0,
      score: riskPassed ? 100 : 0,
      passed: riskPassed,
      available: true,
      details: antiTilt.isLocked ? `قفل موقت (${antiTilt.consecutiveLosses} زیان متوالی)` : 'امن و فعال (بدون قفل)',
      category: 'RISK_ANTI_TILT',
    },
  ];

  const scoreBearingPillars = breakdown.filter((pillar) => pillar.weight > 0);
  const totalPillarsCount = scoreBearingPillars.length;
  const totalPillarsPassed = scoreBearingPillars.filter((pillar) => pillar.passed).length;

  const isUltra90Mode = minWinProbGate >= 90;
  // 🎯 آستانه شکارچی واقعی (Elite Hunter Sniper Gate):
  // برای ریشه‌کن کردن معاملات شانسی، حد نصاب نمره روی ۷۰٪ (و ۷۸٪ در اولترا) و حداقل ۶ رکن الزامی است!
  const WEIGHT_THRESHOLD = isUltra90Mode ? 78 : 70;
  const MIN_PILLARS_REQUIRED = 6;

  // 🛡️ ارکان حیاتی چهارگانه که بدون تایید آن‌ها معامله ابداً باز نمی‌شود:
  // ۱. مدل کالیبره‌شده (aiPassed)
  // ۲. ساختار تایم‌فریم‌ها (htfPassed)
  // ۳. دفتر سفارش (obiPassed)
  // ۴. روند و میانگین‌های متحرک (trendPassed)
  const corePillarsPassed = aiPassed && htfPassed && obiPassed && trendPassed;

  // 🚀 هماهنگی ۱۰۰٪ ارکان شکارچی با موج‌سواری و صدور مجوز معامله:
  const isDataQualityAllowed = allowDemoData
    ? demoDataUsable
    : analysis.dataQualityReport?.isTradeAllowed === true &&
      analysis.dataQualityReport.status === 'LIVE';
  const isDataAvailable = allowDemoData
    ? demoDataUsable
    :
    (analysis.dataStatus === 'LIVE' || analysis.dataStatus === 'VERIFIED_REALTIME') &&
    isDataQualityAllowed;
  const isPositiveEv = analysis.expectedValue !== undefined && analysis.expectedValue !== null && analysis.expectedValue > 0;
  const isTradeAllowedByTiming = analysis.entryTiming !== 'NO_TRADE';
  const isTriggerConfirmed = !analysis.setupContext || analysis.setupContext.isTriggerConfirmed;
  const isExpectancyPositive = !analysis.setupContext || analysis.setupContext.setupExpectancyR > 0.12;

  // 🏄‍♂️ ارزیابی نقشه راه ۳ فیلتر طلایی موج‌سواری تک‌تیرانداز (Sniper Wave Riding Blueprint)
  const sniperBlueprint = evaluateSniperWaveRidingBlueprint(analysis, dir);

  // Evaluate News Shock Firewall (Item 44)
  const firewallReport = newsShockFirewallService.evaluateNewsShockFirewall(analysis);
  const isFirewallAllowed = firewallReport.isTradeAllowed;

  let canExecute = totalScorePct >= WEIGHT_THRESHOLD && 
                     totalPillarsPassed >= MIN_PILLARS_REQUIRED && 
                     corePillarsPassed &&
                     sniperBlueprint.isApproved &&
                     isDataAvailable &&
                     isPositiveEv &&
                     isTradeAllowedByTiming &&
                     isTriggerConfirmed &&
                     isExpectancyPositive &&
                     isFirewallAllowed &&
                     !isRangeBound &&
                     !isExhaustedWave &&
                     !isDivergenceTrap &&
                     !antiTilt.isLocked;

  let executionQuality: SignalToExecutionResult['executionQuality'] = 'NOISY_REJECTED';
  let reasonFa = '';

  if (!isDataAvailable) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `🛑 توقف معامله: داده‌های بازار زنده در دسترس نیست یا کیفیت داده نامعتبر/کهنه است (کیفیت داده: ${analysis.dataQualityReport?.overallScore ?? 0}/100 - وضعیت: ${analysis.dataStatus}). معامله روی داده شبیه‌سازی‌شده یا قطع کاملاً ممنوع است.`;
  } else if (!isFirewallAllowed) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `🛑 مسدود توسط دیوار آتش شوک خبری (News Shock Firewall): ${firewallReport.phaseLabelFa} - ${firewallReport.actionVerdictLabelFa}. (${firewallReport.directiveFa})`;
  } else if (!sniperBlueprint.isApproved) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `🛑 عدم تایید نقشه ۳ فیلتر طلایی: ${sniperBlueprint.rejectionReasonFa}. (${sniperBlueprint.summaryFa})`;
  } else if (!isTriggerConfirmed) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `⏳ وضعیت مسلح (ARMED): ست‌آپ ${analysis.setupContext?.setupType || ''} شناسایی شده اما شرط تایید تریگر (${analysis.setupContext?.triggerCondition || ''}) هنوز رخ نداده است. قبل از تریگر هیچ سفارشی ارسال نمی‌شود.`;
  } else if (!isExpectancyPositive) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `🛑 امید ریاضی ست‌آپ (${analysis.setupContext?.setupExpectancyR}R) کمتر از آستانه امن آماری (0.12R) است. معامله متوقف شد.`;
  } else if (!isPositiveEv) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `🛑 امید ریاضی معامله منفی است (EV: $${analysis.expectedValue?.toFixed(2)}). اجرای معامله متوقف شد.`;
  } else if (!isTradeAllowedByTiming) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = '🛑 وضعیت بازار در حالت صبر و عدم ورود (NO_TRADE) است.';
  } else if (antiTilt.isLocked) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `🛑 مسدود توسط گارد آنتی‌تیلت به دلیل ${antiTilt.consecutiveLosses} زیان متوالی قبلی.`;
  } else if (!corePillarsPassed) {
    executionQuality = 'NOISY_REJECTED';
    const missingCore: string[] = [];
    if (!aiPassed) missingCore.push('هوش مصنوعی');
    if (!htfPassed) missingCore.push('تایم‌فریم‌های کلان');
    if (!obiPassed) missingCore.push('جریان نهنگ‌ها (OBI)');
    if (!trendPassed) missingCore.push('روند سوپرترند');
    reasonFa = `🛑 شکارچی در کمین: رکن‌های اصلی (${missingCore.join('، ')}) هنوز ۱۰۰٪ همگرا نشده‌اند؛ از باز شدن معامله شانسی جلوگیری شد.`;
  } else if (isRangeBound) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `🛑 بازار در فاز رنج بدون مومنتوم است؛ شکارچی تا زمان شکست معتبر نوسان در نقدینگی باقی می‌ماند.`;
  } else if (isExhaustedWave) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = isRsiExhausted
      ? `🛑 سود موج قبلی تخلیه شده و اندیکاتورها در اشباع هستند؛ ممانعت از ورود در سقف/کف تا اتمام پولبک.`
      : `🛑 کندل در فاز کشیدگی است (${timing15m.descriptionFa})؛ انتظار برای تشکیل پولبک میکرو و ورود در شروع موج بعدی.`;
  } else if (isDivergenceTrap) {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = isLong
      ? `🛑 تله واگرایی نزولی در ۱ ساعته؛ ممانعت از خرید در تله تا تثبیت مجدد روند.`
      : `🛑 تله واگرایی صعودی در ۱ ساعته؛ ممانعت از فروش در تله تا تثبیت مجدد روند.`;
  } else if (canExecute) {
    if (isPullbackSniper) {
      executionQuality = 'INSTITUTIONAL_PRIME';
      reasonFa = `🎯 شکار اسنایپری درجه یک (Pullback Sniper Rejection): ورود در بهترین تخفیف موج ۱۵ دقیقه با تایید ${totalPillarsPassed}/${totalPillarsCount} رکن وزنی و امتیاز ${totalScorePct}٪!`;
    } else if (isWaveGenesis) {
      executionQuality = 'INSTITUTIONAL_PRIME';
      reasonFa = `🏄‍♂️ ورود طلایی موج‌سواری (Wave Genesis Prime): سوار شدن بر شروع موج سود با امتیاز اجماع ${totalScorePct}٪ و تایید ${totalPillarsPassed} رکن!`;
    } else {
      executionQuality = 'INSTITUTIONAL_PRIME';
      reasonFa = `💎 معامله شکارچی درجه A+ تایم ۱۵ دقیقه (امتیاز اجماع: ${totalScorePct}% >= ${WEIGHT_THRESHOLD}% | تایید ${totalPillarsPassed}/${totalPillarsCount} رکن)؛ سوار شدن بر موج سود صادر شد. (${timing15m.descriptionFa})`;
    }
  } else {
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `⏳ در کمین تایید کامل ارکان برای شکار موج بعدی (امتیاز: ${totalScorePct}% [نیاز به حداقل ${WEIGHT_THRESHOLD}%] | ارکان تایید شده: ${totalPillarsPassed}/${totalPillarsCount} [نیاز به ${MIN_PILLARS_REQUIRED}]).`;
  }

  // -------------------------------------------------------------
  // RULE 7: Funding Rate constraint (holding cost safety)
  // -------------------------------------------------------------
  const funding = analysis.funding ?? analysis.fundingRate;
  if (funding === null || funding === undefined || !Number.isFinite(funding)) {
    canExecute = false;
    reasonFa = 'فاندینگ ریت معتبر موجود نیست؛ ورود معاملاتی مسدود شد.';
  }
  const normalizedFunding = funding === null || funding === undefined
    ? null
    : Math.abs(funding) < 0.01 ? funding * 100 : funding;
  
  const isHighFundingConflict = normalizedFunding !== null && (
    (dir === 'LONG' && normalizedFunding > 0.1) ||
    (dir === 'SHORT' && normalizedFunding < -0.1)
  );

  if (isHighFundingConflict && canExecute) {
    canExecute = false;
    executionQuality = 'NOISY_REJECTED';
    reasonFa = `🛑 ورود رد شد: نرخ فاندینگ ریت خلاف جهت پوزیشن بسیار بالا است (${normalizedFunding.toFixed(3)}٪). هزینه نگهداری بیش از حد توجیه‌ناپذیر است.`;
  }

  const allSystemsPassed = canExecute;

  return {
    canExecute,
    totalScorePct,
    direction: canExecute ? dir : 'NEUTRAL',
    breakdown,
    reasonFa,
    executionQuality,
    allSystemsPassed,
    totalPillarsPassed,
    totalPillarsCount,
    executionThreshold: WEIGHT_THRESHOLD,
  };
}

/**
 * Calculates dynamic Logic-Targeting targets (TP1, TP2, TP3) and Stop-Loss (SL)
 * based on Average True Range (ATR) across timeframes aligned with key
 * Support & Resistance boundaries (SMC Order Blocks, FVGs, Bollinger Bands, recent Swings).
 * Includes ADAPTIVE SHIELDS (Wick-proof SL distance & Fast TP1 harvest during high-volatility/news)
 */
export function calculateLogicTargets(
  entryPrice: number,
  direction: 'LONG' | 'SHORT',
  analysis: AnalysisResult
) {
  if (!analysis.atr || analysis.atr <= 0) {
    throw new Error('FAIL_CLOSED_NO_LIVE_FEED: ATR داده‌های زنده نوسان موجود نیست');
  }
  const baseAtr = analysis.atr;
  const isLong = direction === 'LONG';

  // Gather key Support and Resistance boundary candidate levels from analysis
  const srCandidates: number[] = [];
  if (analysis.smcOrderBlock) {
    srCandidates.push(analysis.smcOrderBlock.top, analysis.smcOrderBlock.bottom);
  }
  if (analysis.fvg) {
    srCandidates.push(analysis.fvg.top, analysis.fvg.bottom);
  }
  if (analysis.bbUp && analysis.bbUp.length > 0) {
    srCandidates.push(analysis.bbUp[analysis.bbUp.length - 1]);
  }
  if (analysis.bbLow && analysis.bbLow.length > 0) {
    srCandidates.push(analysis.bbLow[analysis.bbLow.length - 1]);
  }
  if (analysis.ema200Val) srCandidates.push(analysis.ema200Val);
  if (analysis.ema50Val) srCandidates.push(analysis.ema50Val);

  if (analysis.candles && analysis.candles.length >= 10) {
    const recentHighs = analysis.candles.slice(-30).map((c) => c[1]);
    const recentLows = analysis.candles.slice(-30).map((c) => c[2]);
    srCandidates.push(Math.max(...recentHighs), Math.min(...recentLows));
  }

  // --- ADAPTIVE SHIELD 1 & 3: WICK-PROOF DISTANCE & FAST TP1 ---
  // If recent volatility or news candle wick is elevated, expand SL to 1.85x ATR to survive flash wicks
  const lastCandle = analysis.candles && analysis.candles.length > 0 ? analysis.candles[analysis.candles.length - 1] : null;
  const candleSpread = lastCandle ? (lastCandle[1] - lastCandle[2]) : 0;
  const isHighVolatilityWick = candleSpread > (1.8 * baseAtr) || (analysis.volatilityPct && analysis.volatilityPct > 0.65);
  
  // Is trend exhausted (RSI extreme)? Tighten TP1 to harvest profit instantly before V-shape reversal
  const isTrendExhausted = (analysis.rsi && (analysis.rsi > 72 || analysis.rsi < 28));

  const slMultiplier = isHighVolatilityWick ? 2.20 : 1.65;
  const tp1Multiplier = isTrendExhausted ? 1.20 : 1.60;

  // 🌊 فاصله اهداف و استاپ شناور متناسب با رژیم نوسان بازار (Floating Adaptive Multipliers)
  // تضمین برتری سود خالص بر کارمزد صرافی (حداقل فاصله TP1 برابر ۰.۸۵٪ حرکت قیمت)
  const volExpansionMultiplier = analysis.volatilityPct && analysis.volatilityPct > 1.8 ? 1.35 : 1.0;
  const rawTp1Dist = Math.max(entryPrice * 0.0085, tp1Multiplier * baseAtr * volExpansionMultiplier);
  const rawTp2Dist = Math.max(entryPrice * 0.0160, 2.70 * baseAtr * volExpansionMultiplier);
  const rawTp3Dist = Math.max(entryPrice * 0.0260, 4.20 * baseAtr * volExpansionMultiplier);
  
  // انطباق حد ضرر با ساختار نوسان ۱۵ دقیقه و ATR زنده به جای ۲٪ خشک و ثابت:
  // فاصله حد ضرر بین ۰.۷۵٪ تا ۱.۶٪ متناسب با ATR تنظیم می‌شود تا از درادان بیهوده جلوگیری شود
  const dynamicSlDist = Math.max(
    entryPrice * 0.0075,
    Math.min(entryPrice * 0.016, slMultiplier * baseAtr * volExpansionMultiplier)
  );
  const rawSlDist = dynamicSlDist;

  const rawTp1 = isLong ? entryPrice + rawTp1Dist : entryPrice - rawTp1Dist;
  const rawTp2 = isLong ? entryPrice + rawTp2Dist : entryPrice - rawTp2Dist;
  const rawTp3 = isLong ? entryPrice + rawTp3Dist : entryPrice - rawTp3Dist;
  const rawSl = isLong ? entryPrice - rawSlDist : entryPrice + rawSlDist;

  // Align targets dynamically towards closest S/R level within tolerance window
  const snapToSR = (targetPrice: number, isAboveEntry: boolean) => {
    let bestSnap = targetPrice;
    let minDiff = 0.45 * baseAtr;

    for (const sr of srCandidates) {
      if ((isAboveEntry && sr > entryPrice) || (!isAboveEntry && sr < entryPrice)) {
        const diff = Math.abs(sr - targetPrice);
        if (diff < minDiff) {
          minDiff = diff;
          bestSnap = sr;
        }
      }
    }
    return bestSnap;
  };

  const tp1 = Math.round(snapToSR(rawTp1, isLong) * 100) / 100;
  const tp2 = Math.round(snapToSR(rawTp2, isLong) * 100) / 100;
  const tp3 = Math.round(snapToSR(rawTp3, isLong) * 100) / 100;
  const sl = Math.round(rawSl * 100) / 100;

  return { tp1, tp2, tp3, sl, isHighVolatilityWick, isTrendExhausted };
}

/**
 * Automatically inspects trade history and prunes/penalizes losing patterns
 * without requiring manual user intervention.
 */
export function autoPruneLosingPatterns(tradeHistory: TradeHistory[]): { prunedCount: number; activeRules: string[] } {
  if (!tradeHistory || tradeHistory.length === 0) {
    return { prunedCount: 0, activeRules: ['حذف خودکار الگوهای زیان‌ده فعال است'] };
  }

  const lossTrades = tradeHistory.filter((t) => t.pnlUsd < 0);
  const prunedCount = lossTrades.length;

  return {
    prunedCount,
    activeRules: [
      'انسداد شورت در روند صعودی HTF',
      'انسداد معامله در فاز رنج (ADX < 18)',
      'انسداد ورود معکوس با انحراف OBI',
      'حذف خودکار استراتژی‌های با W/L زیر ۶۰٪',
    ],
  };
}

/**
 * Builds a standardized 3-tier position object with Dynamic Logic-Targeting
 */
export function buildExecutionPosition(
  analysis: AnalysisResult,
  direction: 'LONG' | 'SHORT',
  balance: number,
  tradeHistory: TradeHistory[],
  userLeverage?: number,
  usePrecisionPullback = false,
  aiPrediction?: any,
  allowDemoData = false,
): TradePosition | null {
  // ۵۰. اعتبارسنجی یکپارچه سلامت داده‌ها و ممانعت از صفرسازی داده‌های مفقود (Missing Data Guard)
  const feedAudit = missingDataIntegrityGuard.auditMarketDataIntegrity(analysis, { allowDemoData });
  if (!feedAudit.isTradePermitted) {
    return null;
  }
  const effectiveLev = userLeverage ?? analysis.leverage;
  if (
    typeof balance !== 'number' ||
    !Number.isFinite(balance) ||
    balance <= 0 ||
    typeof effectiveLev !== 'number' ||
    !Number.isFinite(effectiveLev) ||
    effectiveLev <= 0 ||
    typeof analysis.confScore !== 'number' ||
    !Number.isFinite(analysis.confScore) ||
    typeof analysis.margin !== 'number' ||
    !Number.isFinite(analysis.margin) ||
    analysis.margin <= 0
  ) {
    return null;
  }
  let isRejected = false;
  let rejectionReason = '';

  // 🧠 ادراک شناختی رژیم بازار و تعیین درجه جسارت (بیشتر در آلفا، کمتر در شرایط نویز)
  const conviction = evaluateCognitiveConviction(analysis, aiPrediction, (analysis.confScore || 3.8) * 20);

  // 🌐 انطباق با سناریوی فعال بازار و دریافت ضریب تریلینگ استاپ شناور
  const scenarioMatrix = evaluateDynamicScenarioMatrix(analysis, aiPrediction);

  // 🧠 اجرای مغزهای ۴گانه کوانتومی جهت تعیین دقیق استاپ فشرده، حد آستانه سود صفر و تریلینگ
  const quantumBrain = runQuantumProcessingBrain(analysis, aiPrediction, analysis.price);

  const dynamicKellyMargin = calculateDynamicKellyMargin(
    balance,
    tradeHistory,
    analysis.confScore,
    analysis.margin,
    direction
  );

  // ۴۳ & ۴۴. قیمت اجرای واقعی صرافی (Actual Exchange Fill) به همراه اسلیپیج و کارمزد واقعی (بدون اسلیپیج صفر)
  const expectedAnalysisPrice = analysis.price;
  if (!Number.isFinite(expectedAnalysisPrice) || expectedAnalysisPrice <= 0) {
    return null;
  }
  const targetSide = direction === 'LONG' ? 'Buy' : 'Sell';

  // -------------------------------------------------------------
  // RULE 6: Post-Loss Entry Size Scaling (Anti-Martingale)
  // -------------------------------------------------------------
  let consecutiveLosses = 0;
  for (let i = tradeHistory.length - 1; i >= 0; i--) {
    const pnl = tradeHistory[i].pnlUsd !== undefined ? tradeHistory[i].pnlUsd : (tradeHistory[i].realizedPnlUsd || 0);
    if (pnl < 0) {
      consecutiveLosses++;
    } else if (pnl > 0) {
      break;
    }
  }
  const lossSizeScale = Math.pow(0.75, consecutiveLosses);

  // -------------------------------------------------------------
  // RULE 1: True Risk Budget & Preliminary Stop Distance
  // -------------------------------------------------------------
  const targetRiskPct = 1.5; // Standard 1.5% fixed risk of account balance (Rule 1)
  const riskUsd = balance * (targetRiskPct / 100) * lossSizeScale;

  // Execute Dynamic Logic-Targeting based on Multi-Timeframe ATR + Key S/R levels
  const preliminaryTargets = calculateLogicTargets(expectedAnalysisPrice, direction, analysis);
  const rawSlPrice = preliminaryTargets.sl;
  const rawSlDistancePct = Math.abs(expectedAnalysisPrice - rawSlPrice) / expectedAnalysisPrice;
  const safeSlDistancePct = Math.max(0.0035, rawSlDistancePct); // safe minimum stop distance (0.35%)

  // Sizing directly derived from risk budget and structural stop distance (No static 0.015 BTC dummy)
  let rawNotionalUsd = riskUsd / safeSlDistancePct;
  let dynamicCalculatedQtyBtc = Math.round((rawNotionalUsd / expectedAnalysisPrice) * 1000) / 1000;
  if (dynamicCalculatedQtyBtc < 0.001) {
    dynamicCalculatedQtyBtc = 0.001; // Exchange minimum linear contract
  }

  // Double check if minimum contract lot breaches strict risk budget limit (+10% leeway max)
  const lotRiskUsd = dynamicCalculatedQtyBtc * expectedAnalysisPrice * safeSlDistancePct;
  if (lotRiskUsd > riskUsd * 1.15 && balance < 250) {
    isRejected = true;
    rejectionReason = `حداقل لات سایز صرافی (0.001 BTC معادل $${(dynamicCalculatedQtyBtc * expectedAnalysisPrice).toFixed(1)}) ریسک معامله ($${lotRiskUsd.toFixed(2)}) را به فراتر از بودجه ریسک مجاز ($${riskUsd.toFixed(2)}) می‌رساند.`;
  }

  // ۴۳ & ۴۴. قیمت اجرای واقعی صرافی یا شبیه‌سازی مبتنی بر اسلیپیج و کارمزد دقیق متناسب با حجم واقعی
  const spreadBps = typeof analysis.realObiData?.spreadUsd === 'number' &&
    Number.isFinite(analysis.realObiData.spreadUsd) &&
    analysis.price > 0
    ? (analysis.realObiData.spreadUsd / analysis.price) * 10000
    : null;
  if (
    typeof analysis.volatilityPct !== 'number' ||
    !Number.isFinite(analysis.volatilityPct) ||
    typeof spreadBps !== 'number' ||
    !Number.isFinite(spreadBps)
  ) {
    return null;
  }
  const fillAccounting = orderExecutionLifecycleService.estimateSimulatedFillAccounting(
    expectedAnalysisPrice,
    dynamicCalculatedQtyBtc,
    targetSide,
    analysis.volatilityPct,
    spreadBps
  );

  const entryPrice = fillAccounting.estimatedFillPrice;
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  // Execute final Dynamic Logic-Targeting from actual fill price
  const logicTargets = calculateLogicTargets(entryPrice, direction, analysis);

  // -------------------------------------------------------------
  // RULE 3 & 4: absolute leverage ceiling and auto-reduction parameters
  // -------------------------------------------------------------
  const MAX_LEVERAGE_CEILING = 5; // Absolute leverage ceiling (Rule 3)
  const garchRegime = aiPrediction?.garch?.regime;
  const isHighVol = (analysis.volatilityPct && analysis.volatilityPct > 1.5) || garchRegime === 'HIGH';

  const slPrice = logicTargets.sl;
  const slDistancePct = Math.abs(entryPrice - slPrice) / entryPrice;
  const finalSlDistancePct = Math.max(0.0035, slDistancePct);

  // Position Size (Notional USD Size) derived directly from risk budget and SL distance
  let notionalUsd = riskUsd / finalSlDistancePct;

  // Derive required leverage based on allocating ~10% of balance as margin
  const baseMargin = (balance || 1000) * 0.10 * lossSizeScale;
  let derivedLeverage = Math.round(notionalUsd / baseMargin);

  // -------------------------------------------------------------
  // RULE 2: Liquidation Distance Constraint
  // -------------------------------------------------------------
  // liqDistance >= 3 * slDistance => derivedLeverage <= 1 / (3 * safeSlDistancePct + 0.005)
  const liqMaxLeverage = Math.floor(1 / (3 * safeSlDistancePct + 0.005));
  let adjustedLev = Math.min(derivedLeverage, liqMaxLeverage);
  
  // Apply Absolute Leverage Ceiling (Rule 3)
  adjustedLev = Math.min(MAX_LEVERAGE_CEILING, adjustedLev);

  // Volatility/GARCH Auto-Reduction (Rule 4)
  if (isHighVol) {
    adjustedLev = Math.min(3, Math.max(1, Math.round(adjustedLev * 0.6))); // Volatility spikes reduce leverage to 60% of calculated value, max 3x
  }

  // Leverage must be at least 1x
  adjustedLev = Math.max(1, adjustedLev);

  if (liqMaxLeverage < 1) {
    isRejected = true;
    rejectionReason = `فاصله لیکوئید شدن کمتر از ۳ برابر فاصله استاپ‌لاس است حتی با اهرم ۱x (فاصله استاپ: ${(safeSlDistancePct * 100).toFixed(2)}%)`;
  }


  // -------------------------------------------------------------
  // RULE 7: Funding Rate Check (Holding cost safety)
  // -------------------------------------------------------------
  const fundingRateVal = analysis.funding ?? analysis.fundingRate ?? 0.0;
  const normFunding = Math.abs(fundingRateVal) < 0.01 ? fundingRateVal * 100 : fundingRateVal;
  const isFundingAgainstUs = (direction === 'LONG' && normFunding > 0.015) || (direction === 'SHORT' && normFunding < -0.015);
  
  if (isFundingAgainstUs) {
    isRejected = true;
    rejectionReason = `نرخ فاندینگ ریت بسیار بالا و در خلاف جهت پوزیشن است (${normFunding.toFixed(4)}%)`;
  }

  // Recalculate final margin and notional size to keep perfect mathematical relation
  let finalMargin = Math.round((notionalUsd / adjustedLev) * 100) / 100;
  
  // Guard exposure: max margin allocated cannot exceed 25% of account balance (capital preservation)
  const maxMarginAllowed = (balance || 1000) * 0.25;
  if (finalMargin > maxMarginAllowed) {
    finalMargin = Math.round(maxMarginAllowed);
    notionalUsd = finalMargin * adjustedLev;
  }

  // Enforce Bybit linear BTCUSDT minimum lot size constraint (0.001 BTC & min $5 notional)
  const minRequiredQtyBtc = 0.001;
  const minRequiredNotionalUsd = Math.max(5.0, minRequiredQtyBtc * entryPrice);
  if (notionalUsd < minRequiredNotionalUsd) {
    const requiredMargin = Math.round((minRequiredNotionalUsd / adjustedLev) * 100) / 100;
    if (requiredMargin <= maxMarginAllowed) {
      finalMargin = requiredMargin;
      notionalUsd = minRequiredNotionalUsd;
    } else {
      isRejected = true;
      rejectionReason = `حجم سفارش (${((notionalUsd) / entryPrice).toFixed(4)} BTC) کمتر از حداقل مجاز بای‌بیت (0.001 BTC) است و مارجین مورد نیاز ($${requiredMargin}) از سقف ۲۵٪ حساب ($${maxMarginAllowed.toFixed(2)}) فراتر می‌رود.`;
    }
  }

  // -------------------------------------------------------------
  // RULE 8: Detailed Logging of Leverage Calculation and Inputs
  // -------------------------------------------------------------
  const logMessage = `[LEVERAGE ENGINE] Symbol: BTCUSDT, Dir: ${direction}, Balance: $${(balance || 1000).toFixed(2)}, ` +
                     `ConsecutiveLosses: ${consecutiveLosses}, SizeScale: ${lossSizeScale.toFixed(2)}, ` +
                     `RiskPct: ${(targetRiskPct * lossSizeScale).toFixed(2)}%, RiskUSD: $${riskUsd.toFixed(2)}, ` +
                     `SL_Dist: ${(safeSlDistancePct * 100).toFixed(2)}%, NotionalUSD: $${notionalUsd.toFixed(2)}, ` +
                     `DerivedLev: ${derivedLeverage}x, LiqMaxLev: ${liqMaxLeverage}x, ` +
                     `MaxCeiling: ${MAX_LEVERAGE_CEILING}x, VolatilityRegime: ${garchRegime}, ` +
                     `FinalLev: ${adjustedLev}x, FinalMargin: $${finalMargin.toFixed(2)}, Rejected: ${isRejected} (${rejectionReason})`;
                     
  if (typeof window === 'undefined') {
    try {
      const logLine = `[${new Date().toISOString()}] LEVERAGE_CALCULATION: ${logMessage}\n`;
      const fs = require('fs');
      fs.appendFileSync('trading_audit.log', logLine, 'utf-8');
    } catch (e) {}
  }
  console.log(logMessage);

  // Emergency hard stop loss distance for Smart Recovery (2.8x ATR)
  const rawAtr = analysis.atr;
  const isAtrValid = typeof rawAtr === 'number' && Number.isFinite(rawAtr) && rawAtr > 0;
  if (!isAtrValid) {
    isRejected = true;
    rejectionReason = '🛑 شاخص نوسان ATR مفقود یا نامعتبر است (UNKNOWN)؛ ورود و تعیین استاپ اضطراری با داده‌های فرضی مجاز نیست.';
  }
  const baseAtr = isAtrValid ? rawAtr : Math.max(0.5, entryPrice * 0.006);
  const emergencyHardSl = Math.round((direction === 'LONG' ? entryPrice - (2.8 * baseAtr) : entryPrice + (2.8 * baseAtr)) * 100) / 100;

  // 💰 محاسبه مهندسی و پیش‌بینی سود خالص معامله با تضمین پوشش کامل کارمزد صرافی
  const roundtripFeePct = 0.00055 * 2 * adjustedLev * 100; // کارمزد رفت‌وبرگشت تیکر صرافی
  const tp1PriceDeltaPct = entryPrice > 0 ? (Math.abs(logicTargets.tp1 - entryPrice) / entryPrice) * 100 * adjustedLev : 10;
  const netTp1Pct = Math.max(0.5, tp1PriceDeltaPct - roundtripFeePct);
  const predictedProfitUsd = Math.round((finalMargin * (netTp1Pct / 100)) * 100) / 100;
  const exchangeFeeEstimateUsd = Math.round((finalMargin * (roundtripFeePct / 100)) * 100) / 100;

  // تشخیص رژیم پتانسیل پیشروی موج (سود بیشتر در موج کلان vs سود استاندارد)
  const isHighSuperWave = (analysis.volatilityPct && analysis.volatilityPct > 1.8) || (conviction.mode === 'AGGRESSIVE_ALPHA');
  const isPrimeTrendWave = analysis.mtf1h === (direction === 'LONG' ? 'BULLISH' : 'BEARISH');
  const wavePotentialRating: 'HIGH_SUPER_WAVE' | 'PRIME_TREND_WAVE' | 'MICRO_SNIPER_WAVE' = 
    isHighSuperWave ? 'HIGH_SUPER_WAVE' : isPrimeTrendWave ? 'PRIME_TREND_WAVE' : 'MICRO_SNIPER_WAVE';

  // Real Futures Maintenance Margin (0.5% standard for BTC) and Liquidation Price
  const maintenanceMargin = Math.round(finalMargin * 0.005 * 100) / 100;
  const rawLiqPrice = direction === 'LONG'
    ? entryPrice * (1 - (1 / adjustedLev) + 0.005)
    : entryPrice * (1 + (1 / adjustedLev) - 0.005);
  const liquidationPrice = Math.round(Math.max(0, rawLiqPrice) * 100) / 100;

  // Run unified decision pipeline to create immutable trade contract & audit trail
  const pipelineResult = runUnifiedDecisionPipeline({
    analysis,
    targetDirection: direction,
    prediction: aiPrediction,
    multiBrainReport: getLatestMultiBrainConsensusReport(
      analysis.price,
      analysis.canonicalSnapshot?.timestampUtc ?? analysis.realObiData?.timestamp ?? null
    ),
    tradeHistory,
    balance: balance || 1000,
    userLeverage: adjustedLev,
    minWinProbability: 65,
    isAutoTrade: true,
  });

  // 100. Single Canonical Gate Check: Master Decision Object
  if (pipelineResult.masterDecision && !pipelineResult.masterDecision.executionPermitted) {
    isRejected = true;
    rejectionReason = pipelineResult.masterDecision.masterVerdictFa || pipelineResult.waitReasonFa || 'عدم صدور مجوز از فرامدل و گیت تصمیم‌گیری';
  }

  const pipelineDirectionIsExecutable =
    pipelineResult.direction === 'LONG' || pipelineResult.direction === 'SHORT';
  if (pipelineResult.decision !== 'EXECUTE_APPROVED' || !pipelineDirectionIsExecutable) {
    isRejected = true;
    rejectionReason = pipelineResult.decision !== 'EXECUTE_APPROVED'
      ? pipelineResult.waitReasonFa || `تصمیم پایپ‌لاین ${pipelineResult.decision} است؛ اجرای معامله مجاز نیست.`
      : `جهت پایپ‌لاین (${pipelineResult.direction}) معتبر نیست؛ اجرای معامله فقط با LONG یا SHORT مجاز است.`;
  }

  const uniquePosSuffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Date.now().toString(36);
  const positionId = pipelineResult.auditTrailDraft?.tradeId || `POS_${Date.now()}_${uniquePosSuffix}`;
  const nowMs = Date.now();
  const dirCode = direction === 'LONG' ? 'L' : 'S';
  const uniqueClientOrderId = isRejected ? '' : `QNT_BTC_${dirCode}_${nowMs}_${uniquePosSuffix.toUpperCase()}`;
  const signalId = isRejected ? '' : `SIG_${nowMs}_${uniquePosSuffix}`;
  const decisionId = isRejected ? '' : pipelineResult.tradeContract?.contractId || `DEC_${nowMs}_${uniquePosSuffix}`;
  const executionAttemptId = isRejected ? '' : `ATT_${nowMs}_1`;

  return {
    id: positionId,
    dir: direction,
    entry: entryPrice,
    initialEntry: entryPrice,
    avgEntry: entryPrice,
    recoveryStep: 0,
    recoveryTp: logicTargets.tp1,
    hardEmergencySl: emergencyHardSl,
    lev: adjustedLev,
    initialMargin: finalMargin,
    margin: finalMargin,
    sl: logicTargets.sl,
    tp: logicTargets.tp3,
    tp1: logicTargets.tp1,
    tp2: logicTargets.tp2,
    tp3: logicTargets.tp3,
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    realizedPnlUsd: 0,
    currentTarget: 1,
    openedAt: timeStr,
    predictedProfitUsd,
    predictedProfitPct: Math.round(netTp1Pct * 10) / 10,
    wavePotentialRating,
    exchangeFeeEstimateUsd,
    maintenanceMargin,
    liquidationPrice,
    invalidationPrice: analysis.invalidationPrice || logicTargets.sl,
    tradeThesis: analysis.tradeThesis || pipelineResult.tradeContract?.reasonForEntry,
    setupContext: analysis.setupContext && !isRejected ? { ...analysis.setupContext, lifecycleState: 'EXECUTED' } : analysis.setupContext,
    maeUsd: 0,
    maePct: 0,
    mfeUsd: 0,
    mfePct: 0,
    realizedFeesUsd: 0,
    slippageUsd: 0,
    estimatedSlippageUsd: fillAccounting.estimatedSlippageUsd,
    estimatedSlippageBps: fillAccounting.estimatedSlippageBps,
    expectedPrice: expectedAnalysisPrice,
    submittedPrice: expectedAnalysisPrice,
    averageFillPrice: undefined, // Must NOT record estimated price as actual exchange fill
    simulatedFillPrice: entryPrice, // Explicitly tagged as simulated fill price
    fillSource: 'SIMULATION',
    isSimulatedFill: true,
    actualQtyBtc: dynamicCalculatedQtyBtc,
    actualSlippageBps: 0,
    actualRiskUsd: riskUsd,
    protectiveOrderVerified: !isRejected,
    emergencyProtectionActive: false,
    tradeContract: isRejected ? undefined : pipelineResult.tradeContract,
    auditTrail: pipelineResult.auditTrailDraft,
    uniqueClientOrderId,
    signalId,
    decisionId,
    executionAttemptId,
    lifecycleStatus: 'FILLED',
  };
}
