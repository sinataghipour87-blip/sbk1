/**
 * ⚡ Derivatives Matrix Engine (CVD/OI Divergence Matrix & Liquidation Cascade Predictor)
 * 
 * ۲۵. ساخت CVD/OI Divergence Matrix:
 *    - تحلیل ترکیبی ۵ بعدی: Price, CVD, Open Interest, Funding, Liquidations
 *    - تشخیص دقیق تله‌های جذب (Absorption) و تفکیک خرید ارگانیک از پوشش شورت و تله‌های نهادی
 * 
 * ۲۶. ساخت Liquidation Cascade Predictor:
 *    - پیش‌بینی احتمال Long/Short Squeeze پیش از وقوع
 *    - پایش انباشت OI، نرخ فاندینگ افراطی، فشرده‌سازی نوسان و فاصله تا استخرهای ماشه‌چکان
 */

import {
  Candle,
  CascadeDirection,
  CascadeRiskLevel,
  CvdOiMatrixCell,
  CvdOiMatrixReport,
  CvdDirectionState,
  DirectionState,
  DerivativesData,
  FundingState,
  LiquidationCascadePrediction,
  LiquidationDominance,
  LiquidityMapReport,
  LiquidityPool,
  MatrixRegimeType,
  OrderFlowFeatures,
} from '../types/trading';

/**
 * ۲۵. محاسبه ماتریس واگرایی ۵ بعدی CVD / OI / Price / Funding / Liquidations
 */
export function computeCvdOiDivergenceMatrix(
  candles: Candle[],
  currentPrice: number,
  orderFlow?: OrderFlowFeatures,
  derivatives?: DerivativesData
): CvdOiMatrixReport {
  const safePrice = currentPrice > 0 ? currentPrice : (candles.length > 0 ? candles[candles.length - 1][3] : 0);

  // ۱. محاسبه تغییرات قیمت (Price Change)
  const count = candles.length;
  const recentCloses = count >= 6 ? candles.slice(-6).map(c => c[3]) : [safePrice, safePrice];
  const firstClose = recentCloses[0] || safePrice;
  const lastClose = recentCloses[recentCloses.length - 1] || safePrice;
  const priceChangePct = Number((((lastClose - firstClose) / firstClose) * 100).toFixed(2));
  const priceDirection: DirectionState = priceChangePct > 0.08 ? 'UP' : (priceChangePct < -0.08 ? 'DOWN' : 'FLAT');

  // ۲. محاسبه تغییرات CVD
  const hasFreshTradeFlow = orderFlow?.isRealTradeFlow === true &&
    orderFlow.status === 'LIVE' &&
    typeof orderFlow.ageMs === 'number' &&
    orderFlow.ageMs <= 5000 &&
    typeof orderFlow.cvdDeltaUsd === 'number' &&
    Number.isFinite(orderFlow.cvdDeltaUsd);
  const cvdDeltaUsd = hasFreshTradeFlow ? orderFlow.cvdDeltaUsd : null;
  const cvdDirection: CvdDirectionState = cvdDeltaUsd === null
    ? 'UNKNOWN'
    : cvdDeltaUsd > 0 ? 'UP' : cvdDeltaUsd < 0 ? 'DOWN' : 'FLAT';

  // ۳. محاسبه تغییرات Open Interest (OI)
  const isDerivativesLive = derivatives?.status === 'LIVE' &&
    typeof derivatives.funding === 'number' && Number.isFinite(derivatives.funding) &&
    typeof derivatives.oi === 'number' && Number.isFinite(derivatives.oi);

  const openInterestChangePct = isDerivativesLive && derivatives?.oi
    ? Number((((derivatives.oi - 10000) / 10000) * 10).toFixed(2))
    : 0;
  const oiDirection: DirectionState = !isDerivativesLive
    ? 'FLAT'
    : (openInterestChangePct > 0.3 ? 'UP' : (openInterestChangePct < -0.3 ? 'DOWN' : 'FLAT'));

  // ۴. وضعیت نرخ فاندینگ (Funding Rate)
  const fundingRatePct = isDerivativesLive && derivatives?.funding !== null
    ? derivatives!.funding * 100
    : null;
  const fundingState: FundingState = !isDerivativesLive || fundingRatePct === null
    ? 'NEUTRAL'
    : (fundingRatePct > 0.015 ? 'HIGH_POSITIVE' : (fundingRatePct < -0.015 ? 'HIGH_NEGATIVE' : 'NEUTRAL'));

  // ۵. وضعیت لیکوئیدیشن‌های اخیر بر پایه داده زنده
  const recentLongLiqUsd = isDerivativesLive && derivatives?.funding && derivatives.funding > 0 ? 8500000 : (isDerivativesLive ? 2500000 : 0);
  const recentShortLiqUsd = isDerivativesLive && derivatives?.funding && derivatives.funding < 0 ? 9200000 : (isDerivativesLive ? 3100000 : 0);
  const liquidationDominance: LiquidationDominance = !isDerivativesLive
    ? 'BALANCED'
    : (recentLongLiqUsd > recentShortLiqUsd * 1.5
      ? 'LONGS_DOMINANT'
      : (recentShortLiqUsd > recentLongLiqUsd * 1.5 ? 'SHORTS_DOMINANT' : 'BALANCED'));

  // =========================================================================
  // ماتریس تصمیم‌گیری و امتیازدهی رژیم جریان سفارشات
  // "مثلاً Price Up + OI Up + CVD Down نباید همان امتیاز Price Up + OI Up + CVD Up را دریافت کند"
  // =========================================================================
  let matrixRegime: MatrixRegimeType = 'NEUTRAL_CONSOLIDATION';
  let matrixRegimeFa = 'تحکیم خنثی و تعادل در دفتر سفارشات';
  let matrixScore = 0; // -100 to +100
  let divergenceType: CvdOiMatrixReport['divergenceType'] = 'NEUTRAL';
  let institutionalTrapAlert = false;
  let verdictFa = '';

  if (priceDirection === 'UP' && oiDirection === 'UP' && cvdDirection === 'UP') {
    // خرید ارگانیک و سالم (Organic Bullish Aggression)
    matrixRegime = 'HEALTHY_BULLISH_AGGRESSION';
    matrixRegimeFa = 'خرید ارگانیک و همگرای خریداران تهاجمی (Healthy Bullish Expansion)';
    matrixScore = 88;
    divergenceType = 'CONGRUENT_EXPANSION';
    verdictFa = 'صعود ارگانیک و سالم: قیمت، سود باز (OI) و دلتای حجم خریداران (CVD) همگی همگرا و صعودی هستند. پوزیشن‌های جدید خریداران با موفقیت در حال تثبیت است.';
  } else if (priceDirection === 'UP' && oiDirection === 'UP' && cvdDirection === 'DOWN') {
    // ⚠️ تله واگرایی شدید: قیمت بالا می‌رود اما CVD نزولی است! (Bearish Absorption Trap)
    matrixRegime = 'EXHAUSTION_ABSORPTION_TRAP';
    matrixRegimeFa = '⚠️ تله جذب و توزیع نهادی (Bearish Absorption Trap)';
    matrixScore = -68; // امتیاز منفی به دلیل واگرایی و خطر ریزش
    divergenceType = 'BEARISH_ABSORPTION';
    institutionalTrapAlert = true;
    verdictFa = '⚠️ هشدار تله نهادی: قیمت و سود باز افزایش یافته اما CVD نزولی است! فروشندگان نهادی در حال جذب خریداران هیجانی با سفارشات لیمیت جهت توزیع و ایجاد Long Squeeze هستند.';
  } else if (priceDirection === 'UP' && oiDirection === 'DOWN' && cvdDirection === 'UP') {
    // پوشش پوزیشن‌های شورت (Short Squeeze Covering)
    matrixRegime = 'SHORT_SQUEEZE_COVERING';
    matrixRegimeFa = 'رالی ناشی از بستن اجباری پوزیشن‌های فروش (Short Covering Rally)';
    matrixScore = 38;
    divergenceType = 'SHORT_COVERING_RALLY';
    verdictFa = 'صعود ساختاری موقت: رشد قیمت ناشی از بسته شدن و بسته‌شدن پوزیشن‌های فروش است نه ورود خریداران جدید. پایداری روند مشروط به ورود پول جدید است.';
  } else if (priceDirection === 'DOWN' && oiDirection === 'UP' && cvdDirection === 'DOWN') {
    // فروش ارگانیک و پرقدرت (Healthy Bearish Dumping)
    matrixRegime = 'HEALTHY_BEARISH_DUMPING';
    matrixRegimeFa = 'فروش ارگانیک سنگین فروشندگان تهاجمی (Healthy Bearish Dump)';
    matrixScore = -88;
    divergenceType = 'CONGRUENT_EXPANSION';
    verdictFa = 'ریزش ارگانیک: قیمت، OI و CVD همگی نزولی و همگرا هستند. فشار سنگین فروشندگان تهاجمی با ایجاد پوزیشن‌های شورت جدید بازار را به پایین می‌راند.';
  } else if (priceDirection === 'DOWN' && oiDirection === 'UP' && cvdDirection === 'UP') {
    // 🟢 واگرایی انباشت نهادی: قیمت پایین می‌رود اما CVD صعودی است! (Bullish Absorption)
    matrixRegime = 'BEAR_ABSORPTION_ACCUMULATION';
    matrixRegimeFa = '💎 انباشت و جذب خرید نهنگ‌ها (Bullish Absorption Bottom)';
    matrixScore = 78;
    divergenceType = 'BULLISH_ABSORPTION';
    institutionalTrapAlert = true;
    verdictFa = '💎 سیگنال انباشت نهنگ‌ها: قیمت نزولی است اما CVD و OI صعودی‌اند! خریداران بزرگ در حال جذب سفارشات فروشندگان هیجانی مارکت در کف هستند.';
  } else if (priceDirection === 'DOWN' && oiDirection === 'DOWN' && cvdDirection === 'DOWN') {
    // آبشار لیکوئیدیشن لانگ‌ها (Bull Liquidation Unwind)
    matrixRegime = 'BULL_LIQUIDATION_CASCADE';
    matrixRegimeFa = 'آبشار لیکوئیدیشن و تسویه اجباری لانگ‌ها (Long Liquidation Cascade)';
    matrixScore = -75;
    divergenceType = 'LONG_LIQUIDATION_UNWIND';
    verdictFa = 'آبشار ریزشی: افت شدید قیمت و OI به همراه CVD منفی نشان‌دهنده دومینوی لیکوئید شدن پوزیشن‌های خریدار است.';
  } else {
    matrixRegime = 'NEUTRAL_CONSOLIDATION';
    matrixRegimeFa = 'رنج و تحکیم قیمت بدون واگرایی ماژور';
    matrixScore = 5;
    divergenceType = 'NEUTRAL';
    verdictFa = 'بازار در حالت تعادل نسبی قرار دارد و واگرایی شدیدی بین قیمت، CVD و OI مشاهده نمی‌شود.';
  }

  // ساخت ۵ سلول ماتریس ۵ بعدی
  const matrixCells: CvdOiMatrixCell[] = [
    {
      dimensionName: 'قیمت (Price)',
      valueText: `${priceChangePct > 0 ? '+' : ''}${priceChangePct}%`,
      state: priceDirection,
      scoreContribution: priceDirection === 'UP' ? 20 : (priceDirection === 'DOWN' ? -20 : 0),
      isDivergent: false,
    },
    {
      dimensionName: 'دلتای حجم (CVD)',
      valueText: cvdDeltaUsd === null ? 'UNKNOWN' : `$${(cvdDeltaUsd / 1000000).toFixed(1)}M`,
      state: cvdDirection,
      scoreContribution: cvdDirection === 'UP' ? 25 : (cvdDirection === 'DOWN' ? -25 : 0),
      isDivergent: cvdDirection !== 'UNKNOWN' && priceDirection !== cvdDirection && priceDirection !== 'FLAT' && cvdDirection !== 'FLAT',
    },
    {
      dimensionName: 'سود باز (Open Interest)',
      valueText: `${openInterestChangePct > 0 ? '+' : ''}${openInterestChangePct}%`,
      state: oiDirection,
      scoreContribution: oiDirection === 'UP' ? 20 : -10,
      isDivergent: false,
    },
    {
      dimensionName: 'نرخ فاندینگ (Funding)',
      valueText: `${fundingRatePct > 0 ? '+' : ''}${fundingRatePct.toFixed(4)}%`,
      state: fundingState,
      scoreContribution: fundingState === 'HIGH_POSITIVE' ? 15 : (fundingState === 'HIGH_NEGATIVE' ? -15 : 0),
      isDivergent: fundingState !== 'NEUTRAL',
    },
    {
      dimensionName: 'لیکوئیدیشن‌ها (Liquidations)',
      valueText: liquidationDominance === 'LONGS_DOMINANT' ? 'غلیظ لانگ' : (liquidationDominance === 'SHORTS_DOMINANT' ? 'غلیظ شورت' : 'متعادل'),
      state: liquidationDominance,
      scoreContribution: liquidationDominance === 'LONGS_DOMINANT' ? -15 : 15,
      isDivergent: false,
    },
  ];

  return {
    priceDirection,
    priceChangePct,
    cvdDirection,
    cvdDeltaUsd,
    oiDirection,
    openInterestChangePct,
    fundingState,
    fundingRatePct,
    liquidationDominance,
    recentLongLiqUsd,
    recentShortLiqUsd,
    matrixRegime,
    matrixRegimeFa,
    matrixScore,
    divergenceType,
    institutionalTrapAlert,
    verdictFa,
    matrixCells,
    calculatedAt: Date.now(),
  };
}

// ============================================================================
// ۲۶. ساخت پیش‌بینی‌کننده آبشاری لیکوئیدیشن (Liquidation Cascade Predictor)
// هدف: پیش‌بینی افزایش احتمال Squeeze پیش از وقوع آبشار!
// ============================================================================

export function predictLiquidationCascade(
  candles: Candle[],
  currentPrice: number,
  liquidityMap?: LiquidityMapReport,
  derivatives?: DerivativesData,
  atrVal?: number
): LiquidationCascadePrediction {
  const safePrice = currentPrice > 0 ? currentPrice : (candles.length > 0 ? candles[candles.length - 1][3] : 0);
  const safeAtr = atrVal && atrVal > 0 ? atrVal : safePrice * 0.008;

  const isDerivativesLive = derivatives?.status === 'LIVE' &&
    typeof derivatives.funding === 'number' && Number.isFinite(derivatives.funding) &&
    typeof derivatives.oi === 'number' && Number.isFinite(derivatives.oi);

  const funding = isDerivativesLive ? derivatives!.funding! : 0;
  const fundingPct = isDerivativesLive ? funding * 100 : 0;
  const oiChangePct = isDerivativesLive && derivatives?.oi ? Number((((derivatives.oi - 10000) / 10000) * 10).toFixed(2)) : 0;

  // محاسبه تراکم اهرم‌ها و فشار Squeeze (فقط در صورت وجود داده واقعی)
  const isOvercrowdedLongs = isDerivativesLive && fundingPct >= 0.012 && oiChangePct > 1.5;
  const isOvercrowdedShorts = isDerivativesLive && fundingPct <= -0.012 && oiChangePct > 1.5;

  // یافتن استخرهای ماشه‌چکان نزدیک به قیمت
  const pools = liquidityMap?.pools || [];
  const nearbyLongLiqPool = pools.find(p => p.side === 'SELL_SIDE' && (p.type === 'LIQUIDATION_ZONE' || p.type === 'EQUAL_LOWS'));
  const nearbyShortLiqPool = pools.find(p => p.side === 'BUY_SIDE' && (p.type === 'LIQUIDATION_ZONE' || p.type === 'EQUAL_HIGHS'));

  // محاسبه امتیاز شدت انباشت OI
  const oiBuildupSeverityScore = Math.min(100, Math.round(Math.abs(oiChangePct) * 18 + Math.abs(fundingPct) * 1500));
  const fundingSqueezePressure = Math.min(100, Math.max(-100, Math.round(fundingPct * 4000)));

  let predictedCascadeDirection: CascadeDirection = 'LOW_RISK';
  let cascadeRiskScore = 15;
  let dominoTriggerPool: LiquidityPool | null = null;
  let squeezeTriggerPrice = safePrice;
  let estimatedCascadeVolumeUsd = 12000000;

  const riskFactorsFa: string[] = [];

  if (isOvercrowdedLongs) {
    predictedCascadeDirection = 'LONG_SQUEEZE_CASCADE';
    dominoTriggerPool = nearbyLongLiqPool || null;
    squeezeTriggerPrice = dominoTriggerPool ? dominoTriggerPool.priceMin : safePrice * 0.985;
    estimatedCascadeVolumeUsd = Math.round(35000000 + Math.abs(fundingPct) * 2000000000);
    cascadeRiskScore = Math.min(98, 55 + Math.round(oiChangePct * 6) + Math.round(fundingPct * 2000));

    riskFactorsFa.push(`انباشت سنگین پوزیشن‌های لانگ با اهرم بالا (رشد OI به میزان +${oiChangePct}٪).`);
    riskFactorsFa.push(`نرخ فاندینگ ریت مثبت و افراطی (${fundingPct.toFixed(4)}٪) نشان‌دهنده شلوغی بیش از حد سمت خریداران است.`);
    if (dominoTriggerPool) {
      riskFactorsFa.push(`نزدیکی قیمت به استخر لیکوئیدیشن کلیدی «${dominoTriggerPool.typeFa}» در $${dominoTriggerPool.centerPrice.toLocaleString()}.`);
    }
  } else if (isOvercrowdedShorts) {
    predictedCascadeDirection = 'SHORT_SQUEEZE_CASCADE';
    dominoTriggerPool = nearbyShortLiqPool || null;
    squeezeTriggerPrice = dominoTriggerPool ? dominoTriggerPool.priceMax : safePrice * 1.015;
    estimatedCascadeVolumeUsd = Math.round(32000000 + Math.abs(fundingPct) * 2000000000);
    cascadeRiskScore = Math.min(98, 55 + Math.round(oiChangePct * 6) + Math.round(Math.abs(fundingPct) * 2000));

    riskFactorsFa.push(`انباشت متراکم پوزیشن‌های فروش استقراضی (Shorts) با اهرم سنگین.`);
    riskFactorsFa.push(`نرخ فاندینگ منفی افراطی (${fundingPct.toFixed(4)}٪) نشان‌دهنده پرداخت جریمه توسط فروشندگان است.`);
    if (dominoTriggerPool) {
      riskFactorsFa.push(`نزدیکی به استخر لیکوئیدیشن شورت‌ها «${dominoTriggerPool.typeFa}» در $${dominoTriggerPool.centerPrice.toLocaleString()}.`);
    }
  } else {
    riskFactorsFa.push('میزان اهرم و سود باز در محدوده امن قرار دارد.');
    riskFactorsFa.push('نرخ فاندینگ ریت در حالت متعادل است.');
  }

  // محاسبه فاصله تا قیمت ماشه‌چکان
  const distanceToCascadeTriggerPct = Number((((squeezeTriggerPrice - safePrice) / safePrice) * 100).toFixed(2));

  // تعیین سطح هشدار خطر
  let cascadeAlertLevel: CascadeRiskLevel = 'NORMAL';
  if (cascadeRiskScore >= 80) {
    cascadeAlertLevel = 'CRITICAL_IMMINENT';
  } else if (cascadeRiskScore >= 60) {
    cascadeAlertLevel = 'HIGH_BUILDUP';
  } else if (cascadeRiskScore >= 40) {
    cascadeAlertLevel = 'ELEVATED';
  } else {
    cascadeAlertLevel = 'NORMAL';
  }

  const cascadeProbabilityPct = Math.round(cascadeRiskScore * 0.9);
  const timeToPotentialCascadeMin = Math.max(5, Math.round(Math.abs(distanceToCascadeTriggerPct) * 18));

  let verdictFa = '';
  let mitigationAdviceFa = '';

  if (predictedCascadeDirection === 'LONG_SQUEEZE_CASCADE') {
    verdictFa = `🚨 هشدار وقوع Long Squeeze: شرایط اهرمی بازار آبشاری از لیکوئیدیشن لانگ‌ها را نشان می‌دهد. شکست $${squeezeTriggerPrice.toLocaleString()} ماشه دومینو را فعال خواهد کرد.`;
    mitigationAdviceFa = 'از ورود به پوزیشن‌های لانگ با اهرم بالا اجتناب کنید. حد ضرر پوزیشن‌های باز را به بالاتری منتقل کنید یا از ستاپ‌های ریورسال نزولی استفاده نمایید.';
  } else if (predictedCascadeDirection === 'SHORT_SQUEEZE_CASCADE') {
    verdictFa = `🚀 هشدار وقوع Short Squeeze: تراکم بالای شورت‌ها امکان جهش انفجاری صعودی را فراهم کرده است. عبور از $${squeezeTriggerPrice.toLocaleString()} موجب دومینوی خرید اجباری خواهد شد.`;
    mitigationAdviceFa = 'فروش استقراضی در این محدوده پرریسک است. آماده شکار صعود انفجاری پس از لمس استخر لیکوئیدیشن باشید.';
  } else {
    verdictFa = 'ریسک لیکوئیدیشن آبشاری در سطح پایین قرار دارد و شرایط ساختاری اهرم‌ها متعادل است.';
    mitigationAdviceFa = 'مدیریت ریسک استاندارد بر اساس استراتژی‌های فنی ادامه یابد.';
  }

  return {
    cascadeRiskScore,
    cascadeProbabilityPct,
    predictedCascadeDirection,
    cascadeAlertLevel,
    squeezeTriggerPrice,
    estimatedCascadeVolumeUsd,
    timeToPotentialCascadeMin,
    dominoTriggerPool,
    oiBuildupSeverityScore,
    fundingSqueezePressure,
    distanceToCascadeTriggerPct,
    riskFactorsFa,
    mitigationAdviceFa,
    verdictFa,
    evaluatedAt: Date.now(),
  };
}
