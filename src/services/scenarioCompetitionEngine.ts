/**
 * ⚔️ Scenario Competition Engine & Evidence Evaluator
 * 
 * ۳۱. ساخت Scenario Competition Engine:
 *    - تولید هم‌زمان ۶ سناریوی رقیب بر اساس داده‌های واقعی بازار:
 *      1. Continuation (امتداد روند)
 *      2. Pullback (اصلاح درون‌روندی)
 *      3. Reversal (چرخش کلی ساختار)
 *      4. Breakout (شکست پرحجم)
 *      5. Fakeout (تله شکست کاذب و هانت)
 *      6. Range (نوسان و تعادل رنج)
 * 
 * ۳۲. انتخاب سناریوی برنده با ۵ شرط الزامی Evidence:
 *    - Probability (> 55%)
 *    - Expected Value (> +0.20R)
 *    - Confidence Interval (تنظیم آماری)
 *    - Market Regime Fit (سازگاری با رژیم)
 *    - Liquidity Structure (هم‌راستایی با نقدینگی/CVD/OBI)
 * 
 * 🚨 قانون NO TRADE: اگر اختلاف احتمال ۲ سناریوی برتر کمتر از ۸٪ باشد، خروجی NO TRADE است.
 */

import {
  AnalysisResult,
  CompetitiveScenarioType,
  MarketScenarioCandidate,
  ScenarioCompetitionReport,
} from '../types/trading';

/**
 * نام‌های فارسی سناریوها
 */
export const SCENARIO_NAMES_FA: Record<CompetitiveScenarioType, string> = {
  CONTINUATION: 'امتداد روند (Continuation)',
  PULLBACK: 'اصلاح درون‌روندی (Pullback)',
  REVERSAL: 'چرخش کامل ساختار (Reversal)',
  BREAKOUT: 'شکست ساختار پرحجم (Breakout)',
  FAKEOUT: 'تله شکست کاذب و هانت (Fakeout)',
  RANGE: 'نوسان رنج و تعادل (Range)',
};

/**
 * ۳۱ & ۳۲. اجرای موتور رقابت سناریوها و ارزیابی شواهد (Evidence Evaluator)
 */
export function runScenarioCompetition(
  candles: any[],
  currentPrice: number,
  analysis?: AnalysisResult | null
): ScenarioCompetitionReport {
  const safePrice = currentPrice > 0 ? currentPrice : (analysis?.price && analysis.price > 0 ? analysis.price : (candles && candles.length > 0 ? (candles[candles.length - 1][3] ?? 0) : 0));

  // استخراج متغیرهای واقعی بازار
  const regime = analysis?.regimeClassification?.activeRegime || 'TREND';
  const adx = analysis?.adx ?? 24;
  const orderFlow = analysis?.orderFlowFeatures;
  const hasFreshTradeFlow = orderFlow?.isRealTradeFlow === true &&
    orderFlow.status === 'LIVE' &&
    typeof orderFlow.ageMs === 'number' && orderFlow.ageMs <= 5000 &&
    typeof orderFlow.takerDelta === 'number';
  const cvdDelta = hasFreshTradeFlow ? orderFlow.takerDelta : null;
  const obi = analysis?.realObiData?.status === 'LIVE' &&
    typeof analysis.realObiData.obi === 'number' &&
    (analysis.realObiData.snapshotAgeMs ?? analysis.realObiData.ageMs) <= 10000
    ? analysis.realObiData.obi
    : null; // Order Book Imbalance
  const isSweepActive = Boolean(analysis?.sweepReversalSetup?.isReversalSetupActive);
  const isTrapAlert = Boolean(analysis?.cvdOiMatrix?.institutionalTrapAlert);
  const cascadeRisk = analysis?.liquidationCascadePrediction?.cascadeRiskScore ?? 20;

  // =========================================================================
  // محاسبه داده‌محور و واقعی شواهد ۵ گانه برای هر یک از ۶ سناریو
  // =========================================================================

  // ۱. سناریوی CONTINUATION (امتداد روند)
  const contProb = Math.min(88, Math.max(10, Math.round(
    (adx * 1.5) + (regime === 'TREND' || regime === 'EXPANSION' ? 30 : 0) - (isSweepActive ? 25 : 0)
  )));
  const contEV = Number(((contProb / 100) * 2.2 - ((100 - contProb) / 100) * 1.0).toFixed(2));
  const contRegimeFit = regime === 'TREND' || regime === 'EXPANSION' ? 90 : (regime === 'RANGE' ? 25 : 50);
  const contLiqFit = cvdDelta === null ? 50 : Math.min(95, Math.max(10, 50 + (cvdDelta > 0 ? 30 : cvdDelta < 0 ? -30 : 0)));
  const contConf = Math.min(90, Math.max(20, Math.round((adx + contRegimeFit) / 2)));

  // ۲. سناریوی PULLBACK (اصلاح درون‌روندی)
  const pullProb = Math.min(88, Math.max(10, Math.round(
    (regime === 'TREND' && !isSweepActive ? 68 : 35) + (obi !== null && obi < 0 ? 15 : obi !== null ? -10 : 0)
  )));
  const pullEV = Number(((pullProb / 100) * 2.4 - ((100 - pullProb) / 100) * 0.9).toFixed(2));
  const pullRegimeFit = regime === 'TREND' ? 95 : (regime === 'EXPANSION' ? 80 : 35);
  const pullLiqFit = obi === null ? 50 : Math.min(95, Math.max(10, 60 + (obi * 40)));
  const pullConf = Math.min(90, Math.max(20, Math.round((pullProb + pullRegimeFit) / 2)));

  // ۳. سناریوی REVERSAL (چرخش کلی ساختار)
  const revProb = Math.min(88, Math.max(10, Math.round(
    (isSweepActive ? 78 : 20) + (regime === 'MEAN_REVERSION' || regime === 'PANIC' ? 30 : 0) + (isTrapAlert ? 20 : 0)
  )));
  const revEV = Number(((revProb / 100) * 3.0 - ((100 - revProb) / 100) * 1.0).toFixed(2));
  const revRegimeFit = regime === 'MEAN_REVERSION' || regime === 'PANIC' ? 92 : (regime === 'TREND' ? 20 : 45);
  const revLiqFit = isSweepActive ? 95 : (isTrapAlert ? 85 : 30);
  const revConf = Math.min(90, Math.max(20, Math.round((revProb + revLiqFit) / 2)));

  // ۴. سناریوی BREAKOUT (شکست ساختار)
  const breakProb = Math.min(88, Math.max(10, Math.round(
    (regime === 'COMPRESSION' || regime === 'BREAKOUT' ? 75 : 30) + (cascadeRisk > 60 ? 15 : 0)
  )));
  const breakEV = Number(((breakProb / 100) * 2.5 - ((100 - breakProb) / 100) * 1.1).toFixed(2));
  const breakRegimeFit = regime === 'COMPRESSION' || regime === 'BREAKOUT' ? 94 : (regime === 'RANGE' ? 25 : 50);
  const breakLiqFit = Math.min(95, Math.max(10, 45 + (cascadeRisk * 0.5)));
  const breakConf = Math.min(90, Math.max(20, Math.round((breakProb + breakRegimeFit) / 2)));

  // ۵. سناریوی FAKEOUT (تله شکست کاذب و هانت)
  const fakeProb = Math.min(88, Math.max(10, Math.round(
    (regime === 'RANGE' && isTrapAlert ? 78 : 25) + (isTrapAlert ? 25 : 0)
  )));
  const fakeEV = Number(((fakeProb / 100) * 2.8 - ((100 - fakeProb) / 100) * 1.0).toFixed(2));
  const fakeRegimeFit = regime === 'RANGE' || regime === 'HIGH_VOLATILITY' ? 90 : 30;
  const fakeLiqFit = isTrapAlert ? 95 : 35;
  const fakeConf = Math.min(90, Math.max(20, Math.round((fakeProb + fakeLiqFit) / 2)));

  // ۶. سناریوی RANGE (نوسان رنج و تعادل)
  const rangeProb = Math.min(88, Math.max(10, Math.round(
    (regime === 'RANGE' ? 82 : 20) + (adx < 20 ? 20 : -15)
  )));
  const rangeEV = Number(((rangeProb / 100) * 1.8 - ((100 - rangeProb) / 100) * 0.8).toFixed(2));
  const rangeRegimeFit = regime === 'RANGE' ? 98 : 20;
  const rangeLiqFit = obi === null ? 50 : Math.abs(obi) < 0.15 ? 85 : 35;
  const rangeConf = Math.min(90, Math.max(20, Math.round((rangeProb + rangeRegimeFit) / 2)));

  // لیست کاندیداها به همراه ارزیابی ۵ شرط الزامی Evidence
  const candidatesRaw: {
    type: CompetitiveScenarioType;
    prob: number;
    ev: number;
    conf: number;
    rFit: number;
    lFit: number;
    dir: 'LONG' | 'SHORT' | 'NEUTRAL';
    triggers: string[];
  }[] = [
    {
      type: 'CONTINUATION',
      prob: contProb,
      ev: contEV,
      conf: contConf,
      rFit: contRegimeFit,
      lFit: contLiqFit,
      dir: cvdDelta === null ? 'NEUTRAL' : cvdDelta > 0 ? 'LONG' : cvdDelta < 0 ? 'SHORT' : 'NEUTRAL',
      triggers: [`شاخص قدرت ADX در سطح ${adx}`, hasFreshTradeFlow ? 'همگامی جهت CVD واقعی' : 'CVD UNKNOWN: دادهٔ ترید زنده در دسترس نیست'],
    },
    {
      type: 'PULLBACK',
      prob: pullProb,
      ev: pullEV,
      conf: pullConf,
      rFit: pullRegimeFit,
      lFit: pullLiqFit,
      dir: cvdDelta === null ? 'NEUTRAL' : cvdDelta > 0 ? 'LONG' : cvdDelta < 0 ? 'SHORT' : 'NEUTRAL',
      triggers: [`اصلاح موقت به محدوده FVG / Order Block`, `بایاس مثبت ساختار کلان`],
    },
    {
      type: 'REVERSAL',
      prob: revProb,
      ev: revEV,
      conf: revConf,
      rFit: revRegimeFit,
      lFit: revLiqFit,
      dir: isSweepActive ? (analysis?.sweepReversalSetup?.direction === 'BULLISH_REVERSAL' ? 'LONG' : 'SHORT') : 'NEUTRAL',
      triggers: [`هانت نقدینگی و ریجکشن ساختاری (Liquidity Sweep)`, `کشیدگی مفرط قیمت از لنگر VWAP`],
    },
    {
      type: 'BREAKOUT',
      prob: breakProb,
      ev: breakEV,
      conf: breakConf,
      rFit: breakRegimeFit,
      lFit: breakLiqFit,
      dir: cascadeRisk > 50 ? 'LONG' : 'SHORT',
      triggers: [`فشردگی شدید باندهای بولینگر (Volatility Squeeze)`, `احتمال بالای Squeeze آبشاری لیکوئیدیشن`],
    },
    {
      type: 'FAKEOUT',
      prob: fakeProb,
      ev: fakeEV,
      conf: fakeConf,
      rFit: fakeRegimeFit,
      lFit: fakeLiqFit,
      dir: isTrapAlert ? 'SHORT' : 'LONG',
      triggers: [`تله جذب و واگرایی CVD/OI (Institutional Trap)`, `نفوذ کاذب به سقف/کف رنج`],
    },
    {
      type: 'RANGE',
      prob: rangeProb,
      ev: rangeEV,
      conf: rangeConf,
      rFit: rangeRegimeFit,
      lFit: rangeLiqFit,
      dir: 'NEUTRAL',
      triggers: [`ضعف شاخص ADX و خنثی بودن نوسان`, `تعادل در لایه ۲ دفتر سفارشات (OBI)`],
    },
  ];

  // تبدیل به اشیاء ساختار یافته Candidate
  const candidates: MarketScenarioCandidate[] = candidatesRaw.map(c => {
    // ۵ شرط الزامی Evidence:
    // 1. probabilityPct > 55
    // 2. expectedValueR > +0.20R
    // 3. confidenceIntervalScore >= 60
    // 4. regimeFitScore >= 60
    // 5. liquidityStructureScore >= 60
    const evidencePassed = c.prob >= 55 && c.ev >= 0.20 && c.conf >= 60 && c.rFit >= 60 && c.lFit >= 60;
    const overallEvidenceScore = Math.round((c.prob * 0.3) + (c.rFit * 0.25) + (c.lFit * 0.2) + (c.conf * 0.15) + (Math.max(0, c.ev * 20) * 0.1));

    return {
      scenarioType: c.type,
      scenarioTypeFa: SCENARIO_NAMES_FA[c.type] || c.type,
      evidence: {
        probabilityPct: c.prob,
        expectedValueR: c.ev,
        confidenceIntervalScore: c.conf,
        regimeFitScore: c.rFit,
        liquidityStructureScore: c.lFit,
      },
      overallEvidenceScore,
      evidencePassed,
      direction: c.dir,
      keyTriggersFa: c.triggers,
    };
  });

  // مرتب‌سازی بر اساس بالاترین احتمال / امتیاز شواهد
  candidates.sort((a, b) => b.evidence.probabilityPct - a.evidence.probabilityPct);

  const winningScenario = candidates[0] || null;
  const runnerUpScenario = candidates[1] || null;

  const winningProb = winningScenario?.evidence.probabilityPct || 0;
  const runnerUpProb = runnerUpScenario?.evidence.probabilityPct || 0;
  const probabilityGapPct = Number((winningProb - runnerUpProb).toFixed(1));

  // 🚨 قانون ۳۲: اگر اختلاف احتمال ۲ سناریوی برتر کمتر از ۸٪ باشد -> رقابت نزدیک و NO TRADE!
  const isCloseCompetition = probabilityGapPct < 8.0;

  let tradeDecision: ScenarioCompetitionReport['tradeDecision'] = 'NO_TRADE_CLOSE_COMPETITION';
  let verdictFa = '';

  if (isCloseCompetition) {
    tradeDecision = 'NO_TRADE_CLOSE_COMPETITION';
    verdictFa = `⛔ معامله ممنوع (NO TRADE): رقابت بسیار فشرده و نزدیک بین سناریوی «${winningScenario?.scenarioTypeFa}» (${winningProb}٪) و «${runnerUpScenario?.scenarioTypeFa}» (${runnerUpProb}٪) وجود دارد (اختلاف ${probabilityGapPct}٪ < ۸٪). تا ایجاد ابهام‌زدایی در داده‌ها معامله مسدود شد.`;
  } else if (!winningScenario?.evidencePassed) {
    tradeDecision = 'NO_TRADE_INSUFFICIENT_EVIDENCE';
    verdictFa = `⛔ معامله ممنوع (NO TRADE): سناریوی «${winningScenario?.scenarioTypeFa}» بالاترین احتمال (${winningProb}٪) را کسب نمود، اما هر ۵ شرط الزامی شواهد (Evidence Checklist) به صورت کامل احراز نگردید.`;
  } else {
    tradeDecision = 'EXECUTE_WINNING_SCENARIO';
    verdictFa = `🎯 تایید سناریوی برنده: سناریوی «${winningScenario.scenarioTypeFa}» با احتمال ${winningProb}٪ و لبه مثبت +${winningScenario.evidence.expectedValueR}R با قاطعیت تمام ۵ شرط شواهد را احراز کرده و برنده رقابت شد.`;
  }

  return {
    candidates,
    winningScenario,
    runnerUpScenario,
    probabilityGapPct,
    isCloseCompetition,
    tradeDecision,
    verdictFa,
    evaluatedAt: Date.now(),
  };
}
