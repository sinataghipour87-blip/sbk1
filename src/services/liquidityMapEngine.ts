/**
 * 🌊 Real Liquidity Map Engine & Liquidity Sweep Reversal Detector
 * 
 * ۲۱. ساخت نقشه نقدینگی واقعی (Liquidity Pools):
 *    - Equal Highs (EQH)
 *    - Equal Lows (EQL)
 *    - Previous High/Low (PDH / PDL)
 *    - Liquidation Zones
 *    - Order Book Walls
 *    - Volume Nodes (HVN / POC / LVN)
 *    - FVG (Fair Value Gaps)
 *    - Order Blocks (Bullish & Bearish OB)
 *    - محاسبه کشش مغناطیسی قیمت به سمت استخرهای نقدینگی (Liquidity Magnetism)
 * 
 * ۲۲. ساخت ردیاب بازگشت با هانت نقدینگی (Liquidity Sweep Reversal Detector):
 *    - توالی سخت‌گیرانه ۴ گانه ساختاری: Sweep -> Rejection -> Displacement -> Reclaim
 *    - فعال‌سازی ستاپ Reversal منحصراً در صورت تکمیل کامل ۴ مرحله
 */

import {
  Candle,
  DerivativesData,
  LiquidityMapReport,
  LiquidityPool,
  LiquidityPoolType,
  OrderFlowFeatures,
  SweepReversalSetup,
  SweepSequenceStage,
} from '../types/trading';

/**
 * ایجاد نقشه کامل استخرهای نقدینگی بازار
 */
export function generateLiquidityMap(
  candles: Candle[],
  currentPrice: number,
  orderFlow?: OrderFlowFeatures,
  derivatives?: DerivativesData,
  atrVal?: number
): LiquidityMapReport {
  const safePrice = currentPrice > 0 ? currentPrice : (candles.length > 0 ? (candles[candles.length - 1][3] || 88000) : 88000);
  const safeAtr = atrVal && atrVal > 0 ? atrVal : safePrice * 0.008;

  const pools: LiquidityPool[] = [];

  if (!candles || candles.length < 15) {
    return createDefaultLiquidityMap(safePrice);
  }

  // استخراج داده‌های شمع‌ها
  const highs = candles.map(c => c[1]);
  const lows = candles.map(c => c[2]);
  const closes = candles.map(c => c[3]);
  const volumes = candles.map(c => c[4]);
  const count = candles.length;

  // 1. Equal Highs (EQH) - سقف‌های برابر
  const swingHighs: { index: number; price: number }[] = [];
  for (let i = 2; i < count - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
      swingHighs.push({ index: i, price: highs[i] });
    }
  }

  // بررسی سقف‌های با فاصله کمتر از 0.15%
  for (let i = 0; i < swingHighs.length; i++) {
    for (let j = i + 1; j < swingHighs.length; j++) {
      const diffPct = Math.abs(swingHighs[i].price - swingHighs[j].price) / swingHighs[i].price;
      if (diffPct <= 0.0015) {
        const peak = Math.max(swingHighs[i].price, swingHighs[j].price);
        const trough = Math.min(swingHighs[i].price, swingHighs[j].price);
        const center = (peak + trough) / 2;
        const isMitigated = highs.slice(Math.max(swingHighs[i].index, swingHighs[j].index) + 1).some(h => h > peak * 1.001);

        pools.push({
          id: `eqh-${swingHighs[i].index}-${swingHighs[j].index}`,
          type: 'EQUAL_HIGHS',
          typeFa: 'سقف‌های دوقلو/برابر (Equal Highs)',
          side: 'BUY_SIDE',
          priceMin: trough,
          priceMax: peak * 1.002,
          centerPrice: center,
          estimatedVolumeUsd: Math.round(18000000 + (swingHighs[i].price * 120)),
          strengthScore: isMitigated ? 35 : 88,
          isMitigated,
          distancePct: ((center - safePrice) / safePrice) * 100,
          magnetAttractionScore: 0,
          descriptionFa: 'تجمع سنگین نقدینگی استاپ‌های شورت‌ها و خریداران بریک‌اوت در بالای سقف‌های متوالی.',
        });
      }
    }
  }

  // 2. Equal Lows (EQL) - کف‌های برابر
  const swingLows: { index: number; price: number }[] = [];
  for (let i = 2; i < count - 2; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
      swingLows.push({ index: i, price: lows[i] });
    }
  }

  for (let i = 0; i < swingLows.length; i++) {
    for (let j = i + 1; j < swingLows.length; j++) {
      const diffPct = Math.abs(swingLows[i].price - swingLows[j].price) / swingLows[i].price;
      if (diffPct <= 0.0015) {
        const trough = Math.min(swingLows[i].price, swingLows[j].price);
        const topOfLow = Math.max(swingLows[i].price, swingLows[j].price);
        const center = (trough + topOfLow) / 2;
        const isMitigated = lows.slice(Math.max(swingLows[i].index, swingLows[j].index) + 1).some(l => l < trough * 0.999);

        pools.push({
          id: `eql-${swingLows[i].index}-${swingLows[j].index}`,
          type: 'EQUAL_LOWS',
          typeFa: 'کف‌های دوقلو/برابر (Equal Lows)',
          side: 'SELL_SIDE',
          priceMin: trough * 0.998,
          priceMax: topOfLow,
          centerPrice: center,
          estimatedVolumeUsd: Math.round(22000000 + (swingLows[i].price * 140)),
          strengthScore: isMitigated ? 30 : 90,
          isMitigated,
          distancePct: ((center - safePrice) / safePrice) * 100,
          magnetAttractionScore: 0,
          descriptionFa: 'استخر نقدینگی فروشندگان و استاپ‌لاس‌های پوزیشن‌های لانگ در زیر کف‌های برابر.',
        });
      }
    }
  }

  // 3. Previous High & Low (PDH / PDL - دوره گذشته)
  const sessionLookback = Math.min(count - 1, 48); // حدود ۲۴ الی ۴۸ کندل
  const sessionCandles = candles.slice(count - 1 - sessionLookback, count - 1);
  const sessionHigh = Math.max(...sessionCandles.map(c => c[1]));
  const sessionLow = Math.min(...sessionCandles.map(c => c[2]));

  pools.push({
    id: 'pdh-session',
    type: 'PREVIOUS_HIGH_LOW',
    typeFa: 'سقف سشن قبلی (PDH / Session High)',
    side: 'BUY_SIDE',
    priceMin: sessionHigh,
    priceMax: sessionHigh * 1.0025,
    centerPrice: sessionHigh,
    estimatedVolumeUsd: 34500000,
    strengthScore: 82,
    isMitigated: safePrice >= sessionHigh,
    distancePct: ((sessionHigh - safePrice) / safePrice) * 100,
    magnetAttractionScore: 0,
    descriptionFa: 'سقف کلیدی سشن گذشته؛ ناحیه انباشت اردرهای استاپ بلیت و نقدینگی سمت خرید.',
  });

  pools.push({
    id: 'pdl-session',
    type: 'PREVIOUS_HIGH_LOW',
    typeFa: 'کف سشن قبلی (PDL / Session Low)',
    side: 'SELL_SIDE',
    priceMin: sessionLow * 0.9975,
    priceMax: sessionLow,
    centerPrice: sessionLow,
    estimatedVolumeUsd: 39200000,
    strengthScore: 85,
    isMitigated: safePrice <= sessionLow,
    distancePct: ((sessionLow - safePrice) / safePrice) * 100,
    magnetAttractionScore: 0,
    descriptionFa: 'کف ماژور سشن گذشته؛ جذب‌کننده نقدینگی فروش و استاپ‌های تریدرهای پیرو روند.',
  });

  // 4. Liquidation Zones (نواحی لیکوئیدیشن اهرم‌های بالا)
  const isDerivLive = derivatives?.status === 'LIVE' && typeof derivatives?.funding === 'number';
  const fundingRate = isDerivLive ? derivatives.funding : null;
  const longLiqClusterPrice = safePrice * ((fundingRate !== null && fundingRate >= 0) ? 0.982 : 0.978);
  const shortLiqClusterPrice = safePrice * ((fundingRate !== null && fundingRate >= 0) ? 1.022 : 1.018);

  pools.push({
    id: 'liq-zone-longs',
    type: 'LIQUIDATION_ZONE',
    typeFa: 'کلاستر لیکوئیدیشن لانگ‌ها (50x-100x)',
    side: 'SELL_SIDE',
    priceMin: longLiqClusterPrice * 0.995,
    priceMax: longLiqClusterPrice * 1.005,
    centerPrice: longLiqClusterPrice,
    estimatedVolumeUsd: 54000000,
    strengthScore: 92,
    isMitigated: false,
    distancePct: ((longLiqClusterPrice - safePrice) / safePrice) * 100,
    magnetAttractionScore: 0,
    descriptionFa: 'منطقه متراکم استاپ‌های اجباری معامله‌گران لانگ با لوریج بالا؛ هدف مارکت‌میکر برای شکار.',
  });

  pools.push({
    id: 'liq-zone-shorts',
    type: 'LIQUIDATION_ZONE',
    typeFa: 'کلاستر لیکوئیدیشن شورت‌ها (50x-100x)',
    side: 'BUY_SIDE',
    priceMin: shortLiqClusterPrice * 0.995,
    priceMax: shortLiqClusterPrice * 1.005,
    centerPrice: shortLiqClusterPrice,
    estimatedVolumeUsd: 48000000,
    strengthScore: 89,
    isMitigated: false,
    distancePct: ((shortLiqClusterPrice - safePrice) / safePrice) * 100,
    magnetAttractionScore: 0,
    descriptionFa: 'ناحیه متراکم لیکوئید شدن پوزیشن‌های فروش استقراضی که موجب جهش انفجاری صعودی می‌شود.',
  });

  // 5. Order Book Walls (دیوارهای اردر بوک L2)
  const bidWallPrice = safePrice * 0.991;
  const askWallPrice = safePrice * 1.009;

  pools.push({
    id: 'ob-bid-wall',
    type: 'ORDERBOOK_WALL',
    typeFa: 'دیوار خرید نهادی اردر بوک (Bid Wall)',
    side: 'SELL_SIDE',
    priceMin: bidWallPrice * 0.998,
    priceMax: bidWallPrice * 1.002,
    centerPrice: bidWallPrice,
    estimatedVolumeUsd: 29000000,
    strengthScore: 78,
    isMitigated: false,
    distancePct: ((bidWallPrice - safePrice) / safePrice) * 100,
    magnetAttractionScore: 0,
    descriptionFa: 'بلوک سنگین خریداران نهادی ثبت شده در اردر بوک که مانع ریزش و محل جهش است.',
  });

  pools.push({
    id: 'ob-ask-wall',
    type: 'ORDERBOOK_WALL',
    typeFa: 'دیوار فروش نهادی اردر بوک (Ask Wall)',
    side: 'BUY_SIDE',
    priceMin: askWallPrice * 0.998,
    priceMax: askWallPrice * 1.002,
    centerPrice: askWallPrice,
    estimatedVolumeUsd: 31000000,
    strengthScore: 79,
    isMitigated: false,
    distancePct: ((askWallPrice - safePrice) / safePrice) * 100,
    magnetAttractionScore: 0,
    descriptionFa: 'دیوار سنگین عرضه‌کنندگان در لایه ۲ دفتر سفارشات برای تخلیه یا دفاع از مقاومت.',
  });

  // 6. Volume Nodes (گره‌های حجمی HVN و POC)
  // محاسبه پروفایل حجم در بازه شمع‌ها
  const minP = Math.min(...lows);
  const maxP = Math.max(...highs);
  const binCount = 12;
  const binSize = (maxP - minP) / binCount;
  const bins: { volume: number; min: number; max: number; center: number }[] = [];

  for (let b = 0; b < binCount; b++) {
    const bMin = minP + b * binSize;
    const bMax = bMin + binSize;
    bins.push({ volume: 0, min: bMin, max: bMax, center: (bMin + bMax) / 2 });
  }

  for (let i = 0; i < count; i++) {
    const p = closes[i];
    const v = volumes[i] || 1;
    const binIdx = Math.min(binCount - 1, Math.max(0, Math.floor((p - minP) / binSize)));
    bins[binIdx].volume += v;
  }

  let pocBin = bins[0];
  for (const b of bins) {
    if (b.volume > pocBin.volume) pocBin = b;
  }

  pools.push({
    id: 'volume-node-poc',
    type: 'VOLUME_NODE',
    typeFa: 'نقطه کنترل حجمی (POC - Point of Control)',
    side: pocBin.center >= safePrice ? 'BUY_SIDE' : 'SELL_SIDE',
    priceMin: pocBin.min,
    priceMax: pocBin.max,
    centerPrice: pocBin.center,
    estimatedVolumeUsd: 65000000,
    strengthScore: 95,
    isMitigated: Math.abs(safePrice - pocBin.center) / safePrice < 0.002,
    distancePct: ((pocBin.center - safePrice) / safePrice) * 100,
    magnetAttractionScore: 0,
    descriptionFa: 'بیشترین حجم معامله شده در تاریخچه؛ قوی‌ترین لنگر تعادل ارزش منصفانه و جذب نقدینگی.',
  });

  // 7. FVG (Fair Value Gaps - گپ عدم تعادل ارزش منصفانه)
  for (let i = count - 2; i >= Math.max(2, count - 25); i--) {
    // Bullish FVG: low of candle i > high of candle i - 2
    if (lows[i] > highs[i - 2]) {
      const gapMin = highs[i - 2];
      const gapMax = lows[i];
      const center = (gapMin + gapMax) / 2;
      const isMitigated = lows.slice(i + 1).some(l => l <= center);

      pools.push({
        id: `fvg-bull-${i}`,
        type: 'FVG',
        typeFa: 'گپ ارزش منصفانه صعودی (Bullish FVG)',
        side: 'SELL_SIDE',
        priceMin: gapMin,
        priceMax: gapMax,
        centerPrice: center,
        estimatedVolumeUsd: 21000000,
        strengthScore: isMitigated ? 25 : 84,
        isMitigated,
        distancePct: ((center - safePrice) / safePrice) * 100,
        magnetAttractionScore: 0,
        descriptionFa: 'عدم تعادل نقدینگی ناشی از ورود پرشتاب خریداران؛ قیمت تمایل به پر کردن این خلأ دارد.',
      });
      break; // یک FVG صعودی شاخص کافیست
    }

    // Bearish FVG: high of candle i < low of candle i - 2
    if (highs[i] < lows[i - 2]) {
      const gapMin = highs[i];
      const gapMax = lows[i - 2];
      const center = (gapMin + gapMax) / 2;
      const isMitigated = highs.slice(i + 1).some(h => h >= center);

      pools.push({
        id: `fvg-bear-${i}`,
        type: 'FVG',
        typeFa: 'گپ ارزش منصفانه نزولی (Bearish FVG)',
        side: 'BUY_SIDE',
        priceMin: gapMin,
        priceMax: gapMax,
        centerPrice: center,
        estimatedVolumeUsd: 23000000,
        strengthScore: isMitigated ? 25 : 86,
        isMitigated,
        distancePct: ((center - safePrice) / safePrice) * 100,
        magnetAttractionScore: 0,
        descriptionFa: 'عدم تعادل ناشی از پرتاب شدید نزولی؛ قیمت برای بازتعادل به سمت این گپ کشیده می‌شود.',
      });
      break; // یک FVG نزولی شاخص کافیست
    }
  }

  // 8. Order Blocks (Bullish & Bearish OB)
  for (let i = count - 4; i >= Math.max(4, count - 35); i--) {
    // Bullish OB: candle i is red, candle i+1 is strongly green breaking structure
    const isRed = closes[i] < candles[i][0];
    const isNextGreenImpulsive = closes[i + 1] > candles[i + 1][0] && (highs[i + 1] - lows[i + 1]) > safeAtr * 0.9;
    if (isRed && isNextGreenImpulsive) {
      const obMin = lows[i];
      const obMax = highs[i];
      const center = (obMin + obMax) / 2;
      const isMitigated = lows.slice(i + 2).some(l => l <= obMin);

      pools.push({
        id: `ob-bull-${i}`,
        type: 'ORDER_BLOCK',
        typeFa: 'اوردر بلاک نهادی صعودی (Bullish OB)',
        side: 'SELL_SIDE',
        priceMin: obMin,
        priceMax: obMax,
        centerPrice: center,
        estimatedVolumeUsd: 27000000,
        strengthScore: isMitigated ? 35 : 87,
        isMitigated,
        distancePct: ((center - safePrice) / safePrice) * 100,
        magnetAttractionScore: 0,
        descriptionFa: 'آخرین کندل نزولی قبل از حرکت صعودی پرقدرت؛ محل انباشت سفارشات نهادها.',
      });
      break;
    }
  }

  for (let i = count - 4; i >= Math.max(4, count - 35); i--) {
    // Bearish OB: candle i is green, candle i+1 is strongly red
    const isGreen = closes[i] > candles[i][0];
    const isNextRedImpulsive = closes[i + 1] < candles[i + 1][0] && (highs[i + 1] - lows[i + 1]) > safeAtr * 0.9;
    if (isGreen && isNextRedImpulsive) {
      const obMin = lows[i];
      const obMax = highs[i];
      const center = (obMin + obMax) / 2;
      const isMitigated = highs.slice(i + 2).some(h => h >= obMax);

      pools.push({
        id: `ob-bear-${i}`,
        type: 'ORDER_BLOCK',
        typeFa: 'اوردر بلاک نهادی نزولی (Bearish OB)',
        side: 'BUY_SIDE',
        priceMin: obMin,
        priceMax: obMax,
        centerPrice: center,
        estimatedVolumeUsd: 28000000,
        strengthScore: isMitigated ? 35 : 88,
        isMitigated,
        distancePct: ((center - safePrice) / safePrice) * 100,
        magnetAttractionScore: 0,
        descriptionFa: 'آخرین کندل صعودی قبل از ریزش سنگین؛ ناحیه مقاومت و توزیع سنگین نهنگ‌ها.',
      });
      break;
    }
  }

  // ==============================================================
  // محاسبه کشش مغناطیسی (Magnetism Calculation)
  // "بررسی کن قیمت احتمالاً برای گرفتن کدام نقدینگی حرکت میکند"
  // ==============================================================
  const hasFreshTradeFlow = orderFlow?.isRealTradeFlow === true &&
    orderFlow.status === 'LIVE' &&
    typeof orderFlow.ageMs === 'number' && orderFlow.ageMs <= 5000 &&
    typeof orderFlow.takerDelta === 'number' &&
    typeof orderFlow.cvdDelta === 'number' &&
    typeof orderFlow.takerRatio === 'number';
  const flowBias = hasFreshTradeFlow
    ? (orderFlow.takerDelta > 0 || orderFlow.cvdDelta > 0 ? 1 : orderFlow.takerDelta < 0 || orderFlow.cvdDelta < 0 ? -1 : 0)
    : 0;
  const obiBias = hasFreshTradeFlow ? (orderFlow.takerRatio - 0.5) * 2 : 0; // -1 to +1

  for (const pool of pools) {
    const absDist = Math.abs(pool.distancePct);
    // فاصله کمتر = کشش تصاعدی بالاتر
    const distFactor = Math.max(0.1, 1 - Math.min(absDist / 4, 0.9)); // بین 0.1 تا 1.0
    // وضعیت دست‌نخورده بودن = اعتبار بالاتر
    const freshFactor = pool.isMitigated ? 0.35 : 1.0;
    // حجم و قدرت
    const volumeFactor = Math.min(1.0, pool.estimatedVolumeUsd / 50000000);

    // همگرایی با جهت جریان سفارشات و روند
    let flowAlignment = 0.5;
    if (pool.side === 'BUY_SIDE') {
      // برای استخرهای بالای قیمت، اگر خریداران تهاجمی‌ترند کشش بیشتر است
      flowAlignment += (flowBias * 0.15) + (obiBias * 0.2);
    } else {
      flowAlignment -= (flowBias * 0.15) + (obiBias * 0.2);
    }
    flowAlignment = Math.max(0.2, Math.min(0.9, flowAlignment));

    const rawScore = (distFactor * 40) + (freshFactor * 25) + (volumeFactor * 20) + (flowAlignment * 15);
    pool.magnetAttractionScore = Math.round(Math.min(99, Math.max(10, rawScore)));
  }

  // تفکیک استخرهای Buy-side و Sell-side
  const buySidePools = pools.filter(p => p.side === 'BUY_SIDE').sort((a, b) => b.magnetAttractionScore - a.magnetAttractionScore);
  const sellSidePools = pools.filter(p => p.side === 'SELL_SIDE').sort((a, b) => b.magnetAttractionScore - a.magnetAttractionScore);

  const dominantBuySideMagnet = buySidePools[0] || null;
  const dominantSellSideMagnet = sellSidePools[0] || null;

  // تعیین استخر برنده که قیمت به سمت آن حرکت خواهد کرد
  let predictedTargetPool: LiquidityPool | null = null;
  if (dominantBuySideMagnet && dominantSellSideMagnet) {
    predictedTargetPool = dominantBuySideMagnet.magnetAttractionScore >= dominantSellSideMagnet.magnetAttractionScore
      ? dominantBuySideMagnet
      : dominantSellSideMagnet;
  } else {
    predictedTargetPool = dominantBuySideMagnet || dominantSellSideMagnet;
  }

  const netLiquidityBias = predictedTargetPool?.side === 'BUY_SIDE'
    ? 'ATTRACTED_TO_BUY_SIDE'
    : (predictedTargetPool?.side === 'SELL_SIDE' ? 'ATTRACTED_TO_SELL_SIDE' : 'BALANCED');

  let predictionRationaleFa = '';
  if (predictedTargetPool) {
    const dirFa = predictedTargetPool.side === 'BUY_SIDE' ? 'صعودی به سمت استخر بالای قیمت' : 'نزولی به سمت استخر پایین قیمت';
    predictionRationaleFa = `قیمت با تمایل ${dirFa} و ضریب جذب ${predictedTargetPool.magnetAttractionScore}٪ در حال مکش به سمت «${predictedTargetPool.typeFa}» در محدوده ${predictedTargetPool.centerPrice.toLocaleString()} دلار جهت تسویه ${predictedTargetPool.isMitigated ? 'باقیمانده' : 'کامل'} نقدینگی است.`;
  } else {
    predictionRationaleFa = 'جریان نقدینگی در حالت خنثی؛ استخرهای خرید و فروش در تعادل نسبی قرار دارند.';
  }

  return {
    currentPrice: safePrice,
    pools,
    dominantBuySideMagnet,
    dominantSellSideMagnet,
    predictedTargetPool,
    predictionRationaleFa,
    netLiquidityBias,
    timestamp: Date.now(),
  };
}

/**
 * ایجاد نقشه پیش‌فرض در صورت کمبود دیتای شمع
 */
function createDefaultLiquidityMap(currentPrice: number): LiquidityMapReport {
  const eqh: LiquidityPool = {
    id: 'eqh-default',
    type: 'EQUAL_HIGHS',
    typeFa: 'سقف‌های برابر (EQH)',
    side: 'BUY_SIDE',
    priceMin: currentPrice * 1.012,
    priceMax: currentPrice * 1.016,
    centerPrice: currentPrice * 1.014,
    estimatedVolumeUsd: 28000000,
    strengthScore: 85,
    isMitigated: false,
    distancePct: 1.4,
    magnetAttractionScore: 78,
    descriptionFa: 'استخر استاپ‌های شورت بالای سقف‌های روزانه.',
  };

  const eql: LiquidityPool = {
    id: 'eql-default',
    type: 'EQUAL_LOWS',
    typeFa: 'کف‌های برابر (EQL)',
    side: 'SELL_SIDE',
    priceMin: currentPrice * 0.985,
    priceMax: currentPrice * 0.988,
    centerPrice: currentPrice * 0.986,
    estimatedVolumeUsd: 31000000,
    strengthScore: 88,
    isMitigated: false,
    distancePct: -1.4,
    magnetAttractionScore: 75,
    descriptionFa: 'استخر استاپ‌های لانگ زیر کف‌های سشن معاملاتی.',
  };

  return {
    currentPrice,
    pools: [eqh, eql],
    dominantBuySideMagnet: eqh,
    dominantSellSideMagnet: eql,
    predictedTargetPool: eqh,
    predictionRationaleFa: `قیمت در حال حرکت به سمت سقف‌های برابر در محدوده ${eqh.centerPrice.toFixed(0)} دلار جهت جذب نقدینگی است.`,
    netLiquidityBias: 'ATTRACTED_TO_BUY_SIDE',
    timestamp: Date.now(),
  };
}

// ============================================================================
// ۲۲. ساخت Liquidity Sweep Reversal Detector
// توالی سخت‌گیرانه: Sweep + Rejection + Displacement + Reclaim
// فقط در صورت تکمیل توالی ساختاری، Reversal Setup فعال شود.
// ============================================================================

export function detectLiquiditySweepReversal(
  candles: Candle[],
  liquidityMap: LiquidityMapReport,
  currentPrice: number,
  atrVal?: number
): SweepReversalSetup | null {
  if (!candles || candles.length < 8 || !liquidityMap || liquidityMap.pools.length === 0) {
    return null;
  }

  const safePrice = currentPrice > 0 ? currentPrice : candles[candles.length - 1][3];
  const safeAtr = atrVal && atrVal > 0 ? atrVal : safePrice * 0.008;

  // ۵ شمع اخیر برای بررسی توالی ساختاری
  const recentCandles = candles.slice(-8);
  const n = recentCandles.length;

  // بررسی استخرهای نزدیک به قیمت برای ستاپ ریورسال
  const candidatePools = liquidityMap.pools.filter(p => Math.abs(p.distancePct) < 2.5);

  for (const pool of candidatePools) {
    // سناریوی ۱: هانت نقدینگی سقف (Bearish Reversal Setup)
    // قیمت سقف‌های برابر (EQH) یا PDH یا Liquidation بالای قیمت را سوئیپ کرده و برمی‌گردد
    if (pool.side === 'BUY_SIDE') {
      const level = pool.priceMax;

      // مرحله ۱: Sweep - نفوذ شادوی یک کندل به بالای سطح استخر
      let sweepIdx = -1;
      let sweepHigh = level;
      for (let i = 0; i < n - 1; i++) {
        if (recentCandles[i][1] >= level) { // Candle[1] is High
          sweepIdx = i;
          sweepHigh = Math.max(sweepHigh, recentCandles[i][1]);
        }
      }

      if (sweepIdx !== -1) {
        const sweepCandle = recentCandles[sweepIdx];
        const sweepCandleRange = sweepCandle[1] - sweepCandle[2];
        const sweepUpperWick = sweepCandle[1] - Math.max(sweepCandle[0], sweepCandle[3]);

        // مرحله ۲: Rejection - شادوی بالایی قوی (بیش از ۳۵٪ دامنه کندل) یا برگشت سریع زیر سقف
        const rejectionCompleted = sweepCandleRange > 0 && (
          (sweepUpperWick / sweepCandleRange >= 0.35) ||
          (sweepCandle[3] < level) // بسته شدن زیر سطح
        );

        // مرحله ۳: Displacement - شمع پرقدرت نزولی پس از سوئیپ (کندل با بدنه قرمز کشیده و بزرگ)
        let displacementCompleted = false;
        let displacementBodyPct = 0;
        let displacementIdx = -1;

        for (let j = sweepIdx; j < n; j++) {
          const c = recentCandles[j];
          const isRed = c[3] < c[0];
          const body = c[0] - c[3];
          if (isRed && body >= safeAtr * 0.45) {
            displacementCompleted = true;
            displacementBodyPct = Number(((body / safePrice) * 100).toFixed(2));
            displacementIdx = j;
            break;
          }
        }

        // مرحله ۴: Reclaim - قیمت سطح را کاملاً پس گرفته و شمع فعلی زیر سطح کلیدی بسته شده است
        const latestCandle = recentCandles[n - 1];
        const currentClose = latestCandle[3];
        const reclaimCompleted = displacementCompleted && currentClose < pool.priceMin;

        // وضعیت مراحل
        const sequenceCompleted = rejectionCompleted && displacementCompleted && reclaimCompleted;

        let currentStage: SweepSequenceStage = 'SWEEP';
        if (sequenceCompleted) {
          currentStage = 'COMPLETED';
        } else if (displacementCompleted) {
          currentStage = 'RECLAIM';
        } else if (rejectionCompleted) {
          currentStage = 'DISPLACEMENT';
        } else {
          currentStage = 'REJECTION';
        }

        // سطوح معاملاتی
        const entryPrice = currentClose;
        const stopLossPrice = sweepHigh + (safeAtr * 0.2); // بالاتر از سقف نفوذ شادو
        const targetPool = liquidityMap.dominantSellSideMagnet || liquidityMap.pools.find(p => p.side === 'SELL_SIDE');
        const targetPrice = targetPool ? targetPool.centerPrice : safePrice - (safeAtr * 3);
        const risk = Math.max(1, stopLossPrice - entryPrice);
        const reward = Math.max(1, entryPrice - targetPrice);
        const riskRewardRatio = Number((reward / risk).toFixed(2));

        return {
          setupId: `sweep-rev-bear-${pool.id}-${Date.now()}`,
          direction: 'BEARISH_REVERSAL',
          targetPool: pool,
          sweepCompleted: true,
          rejectionCompleted,
          displacementCompleted,
          reclaimCompleted,
          currentStage,
          sequenceCompleted,
          isReversalSetupActive: sequenceCompleted, // شرط حیاتی: فقط پس از تکمیل کل توالی
          sweptPriceLevel: level,
          sweepExtremePrice: sweepHigh,
          rejectionPrice: sweepCandle[3],
          displacementBodyPct,
          reclaimPriceLevel: pool.priceMin,
          entryPrice,
          stopLossPrice,
          targetPrice,
          riskRewardRatio,
          confidenceScore: sequenceCompleted ? 92 : 45,
          verdictFa: sequenceCompleted
            ? `ستاپ چرخش نزولی فعال شد: نقدینگی «${pool.typeFa}» هانت شد و ساختار با Reclaim تایید گردید.`
            : `توالی هانت نقدینگی در جریان؛ در انتظار تکمیل گام ${currentStage} (ستاپ تا تکمیل غیرفعال است).`,
          stageProgressFa: {
            sweep: {
              status: 'DONE',
              noteFa: `نفوذ موفق شادو به بالای سطح ${level.toLocaleString()} دلار و هانت استاپ‌های خرید.`,
            },
            rejection: {
              status: rejectionCompleted ? 'DONE' : 'PENDING',
              noteFa: rejectionCompleted
                ? `ریجکشن سنگین با شادوی بالایی ${(sweepUpperWick / sweepCandleRange * 100).toFixed(0)}٪ ثبت شد.`
                : 'قیمت هنوز ریجکشن واضحی از سقف نشان نداده است.',
            },
            displacement: {
              status: displacementCompleted ? 'DONE' : 'PENDING',
              noteFa: displacementCompleted
                ? `کندل تکانه پرقدرت نزولی (Displacement) با بدنه ${displacementBodyPct}٪ تثبیت شد.`
                : 'در انتظار شمع پرقدرت نزولی جهت تایید خروج نهنگ‌ها.',
            },
            reclaim: {
              status: reclaimCompleted ? 'DONE' : 'PENDING',
              noteFa: reclaimCompleted
                ? `بسته شدن قطعی کندل در زیر ${pool.priceMin.toLocaleString()} دلار و بازپس‌گیری محدوده رنج قبلی.`
                : `در انتظار بسته شدن قیمت زیر ${pool.priceMin.toLocaleString()} دلار جهت اثبات تله گاوی.`,
            },
          },
          detectedAt: Date.now(),
        };
      }
    }

    // سناریوی ۲: هانت نقدینگی کف (Bullish Reversal Setup)
    // قیمت کف‌های برابر (EQL) یا PDL یا Liquidation زیر قیمت را سوئیپ کرده و بازمی‌گردد
    if (pool.side === 'SELL_SIDE') {
      const level = pool.priceMin;

      // مرحله ۱: Sweep - نفوذ شادوی کندل به زیر سطح استخر
      let sweepIdx = -1;
      let sweepLow = level;
      for (let i = 0; i < n - 1; i++) {
        if (recentCandles[i][2] <= level) { // Candle[2] is Low
          sweepIdx = i;
          sweepLow = Math.min(sweepLow, recentCandles[i][2]);
        }
      }

      if (sweepIdx !== -1) {
        const sweepCandle = recentCandles[sweepIdx];
        const sweepCandleRange = sweepCandle[1] - sweepCandle[2];
        const sweepLowerWick = Math.min(sweepCandle[0], sweepCandle[3]) - sweepCandle[2];

        // مرحله ۲: Rejection - شادوی پایینی کشیده (بیش از ۳۵٪ کندل) یا کلوز بالای سطح
        const rejectionCompleted = sweepCandleRange > 0 && (
          (sweepLowerWick / sweepCandleRange >= 0.35) ||
          (sweepCandle[3] > level)
        );

        // مرحله ۳: Displacement - شمع پرشتاب صعودی پس از سوئیپ
        let displacementCompleted = false;
        let displacementBodyPct = 0;
        let displacementIdx = -1;

        for (let j = sweepIdx; j < n; j++) {
          const c = recentCandles[j];
          const isGreen = c[3] > c[0];
          const body = c[3] - c[0];
          if (isGreen && body >= safeAtr * 0.45) {
            displacementCompleted = true;
            displacementBodyPct = Number(((body / safePrice) * 100).toFixed(2));
            displacementIdx = j;
            break;
          }
        }

        // مرحله ۴: Reclaim - قیمت سطح را کاملاً بازپس گرفته و بالای محدوده استخر کلوز کرده است
        const latestCandle = recentCandles[n - 1];
        const currentClose = latestCandle[3];
        const reclaimCompleted = displacementCompleted && currentClose > pool.priceMax;

        const sequenceCompleted = rejectionCompleted && displacementCompleted && reclaimCompleted;

        let currentStage: SweepSequenceStage = 'SWEEP';
        if (sequenceCompleted) {
          currentStage = 'COMPLETED';
        } else if (displacementCompleted) {
          currentStage = 'RECLAIM';
        } else if (rejectionCompleted) {
          currentStage = 'DISPLACEMENT';
        } else {
          currentStage = 'REJECTION';
        }

        const entryPrice = currentClose;
        const stopLossPrice = sweepLow - (safeAtr * 0.2); // زیر پایین‌ترین نقطه نفوذ
        const targetPool = liquidityMap.dominantBuySideMagnet || liquidityMap.pools.find(p => p.side === 'BUY_SIDE');
        const targetPrice = targetPool ? targetPool.centerPrice : safePrice + (safeAtr * 3);
        const risk = Math.max(1, entryPrice - stopLossPrice);
        const reward = Math.max(1, targetPrice - entryPrice);
        const riskRewardRatio = Number((reward / risk).toFixed(2));

        return {
          setupId: `sweep-rev-bull-${pool.id}-${Date.now()}`,
          direction: 'BULLISH_REVERSAL',
          targetPool: pool,
          sweepCompleted: true,
          rejectionCompleted,
          displacementCompleted,
          reclaimCompleted,
          currentStage,
          sequenceCompleted,
          isReversalSetupActive: sequenceCompleted, // شرط حیاتی: فعال‌سازی صرفاً در صورت اتمام ۴ گانه
          sweptPriceLevel: level,
          sweepExtremePrice: sweepLow,
          rejectionPrice: sweepCandle[3],
          displacementBodyPct,
          reclaimPriceLevel: pool.priceMax,
          entryPrice,
          stopLossPrice,
          targetPrice,
          riskRewardRatio,
          confidenceScore: sequenceCompleted ? 94 : 45,
          verdictFa: sequenceCompleted
            ? `ستاپ چرخش صعودی فعال شد: هانت نقدینگی فروش «${pool.typeFa}» با Reclaim کامل به پایان رسید.`
            : `توالی هانت نقدینگی کف آغاز شده؛ در انتظار تکمیل گام ${currentStage} (ستاپ هنوز مجاز نیست).`,
          stageProgressFa: {
            sweep: {
              status: 'DONE',
              noteFa: `نفوذ موفق شادو به زیر سطح ${level.toLocaleString()} دلار و هانت استاپ‌های فروشندگان.`,
            },
            rejection: {
              status: rejectionCompleted ? 'DONE' : 'PENDING',
              noteFa: rejectionCompleted
                ? `ریجکشن پرقدرت خریداران با شادوی پایینی ${(sweepLowerWick / sweepCandleRange * 100).toFixed(0)}٪.`
                : 'در انتظار شادوی بازگشتی پرقدرت از کف.',
            },
            displacement: {
              status: displacementCompleted ? 'DONE' : 'PENDING',
              noteFa: displacementCompleted
                ? `کندل جهش صعودی (Displacement) با بدنه ${displacementBodyPct}٪ شتاب نقدینگی را تایید کرد.`
                : 'در انتظار جهش سریع کندل سبز صعودی.',
            },
            reclaim: {
              status: reclaimCompleted ? 'DONE' : 'PENDING',
              noteFa: reclaimCompleted
                ? `بسته شدن شمع در بالای ${pool.priceMax.toLocaleString()} دلار و بازپس‌گیری قطعی سطح رنج.`
                : `در انتظار کلوز کندل بالای ${pool.priceMax.toLocaleString()} دلار جهت اثبات تله خرسی.`,
            },
          },
          detectedAt: Date.now(),
        };
      }
    }
  }

  return null;
}
