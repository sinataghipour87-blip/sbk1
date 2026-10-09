import { Candle, SmcZone, LiquidityPool } from '../types/trading';
import { getMaeMfeFingerprint } from './maeMfeFingerprint';

export interface EntryZoneResult {
  optimalEntry: number;
  zoneStart: number;
  zoneEnd: number;
  expectedMae: number;
  confidenceScore: number;
  factors: {
    atrWeight: number;
    fvgWeight: number;
    liquidityWeight: number;
    orderBlockWeight: number;
    spreadWeight: number;
    maeWeight: number;
  };
}

/**
 * 🎯 ۳۵. ساخت Dynamic Entry Zone (محاسبه هوشمند محدوده ورود بر اساس متغیرهای مارکت)
 * محاسبات بر اساس: ATR، ساختار، نقدینگی، FVG، اوردر بلاک، حجم، اسپرد و MAE انتظاری
 */
export const calculateDynamicEntryZone = (
  candles: Candle[],
  currentPrice: number,
  atr: number,
  spread: number = 0.5,
  setupType: string = 'VWAP_MSS_CONTINUATION',
  marketRegime: string = 'TREND',
  timeframe: string = '15m',
  fvgZone?: SmcZone,
  orderBlock?: SmcZone,
  liquidityPools?: LiquidityPool[],
  volumeSurgeRatio: number = 1.0
): EntryZoneResult => {
  if (!candles || candles.length < 20) {
    return {
      optimalEntry: currentPrice,
      zoneStart: currentPrice - atr * 0.2,
      zoneEnd: currentPrice + atr * 0.2,
      expectedMae: atr * 0.5,
      confidenceScore: 50,
      factors: {
        atrWeight: 0.3,
        fvgWeight: 0.1,
        liquidityWeight: 0.1,
        orderBlockWeight: 0.1,
        spreadWeight: 0.1,
        maeWeight: 0.3
      }
    };
  }

  // ۱. دریافت مشخصات اثر انگشت (MAE Fingerprint) برای ستاپ، رژیم و تایم‌فریم مشخص شده
  const fingerprint = getMaeMfeFingerprint(setupType, marketRegime, timeframe);
  const expectedMaePct = fingerprint.expectedMaePct;
  const expectedMaeUsd = currentPrice * (expectedMaePct / 100);

  // جهت معامله (LONG / SHORT) بر اساس نوع ستاپ یا جهت قیمت فعلی
  // اکثر ستاپ‌ها به طور پیش‌فرض برای خرید هستند مگر ستاپ‌های معکوس یا مومنتوم شورت
  const isLong = !setupType.includes('BEARISH') && !setupType.includes('SHORT');

  // ۲. متغیرهای ساختاری (Structure & OB & FVG)
  let structuralAnchor = currentPrice;
  let fvgAnchor = currentPrice;
  let hasOb = false;
  let hasFvg = false;

  // اوردر بلاک نهادی (Order Block)
  if (orderBlock && orderBlock.top > 0) {
    hasOb = true;
    // لول‌های بلاک خرید یا فروش به عنوان نقطه لنگر ساختاری
    structuralAnchor = isLong ? orderBlock.top : orderBlock.bottom;
  }

  // گپ ارزش منصفانه (FVG)
  if (fvgZone && fvgZone.top > 0) {
    hasFvg = true;
    // تعادل ارزش منصفانه (۵۰٪ لول گپ) به عنوان لنگر پولبک FVG
    fvgAnchor = (fvgZone.top + fvgZone.bottom) / 2;
  }

  // ۳. استخرهای نقدینگی (Liquidity Pools)
  let liquidityAnchor = currentPrice;
  let hasLiquidity = false;
  if (liquidityPools && liquidityPools.length > 0) {
    // یافتن نزدیک‌ترین استخر نقدینگی با قدرت بالا
    const nearbyPools = liquidityPools
      .filter((p) => Math.abs(p.centerPrice - currentPrice) < atr * 2.5)
      .sort((a, b) => b.strengthScore - a.strengthScore);

    if (nearbyPools.length > 0) {
      hasLiquidity = true;
      liquidityAnchor = nearbyPools[0].centerPrice;
    }
  }

  // ۴. تخصیص وزن‌های پویا و ترکیب محاسباتی
  let optimalEntry = currentPrice;
  
  // لنگرهای ورودی چندگانه
  const atrPullbackOffset = isLong ? atr * 0.22 : atr * 0.22;
  const atrBasedPrice = isLong ? currentPrice - atrPullbackOffset : currentPrice + atrPullbackOffset;

  let totalWeight = 0;
  let sumPrices = 0;

  // وزن‌دهی بر اساس وجود مولفه‌ها در چارت
  const wAtr = 0.20;
  const wMae = 0.25;
  const wOb = hasOb ? 0.20 : 0.0;
  const wFvg = hasFvg ? 0.15 : 0.0;
  const wLiq = hasLiquidity ? 0.15 : 0.0;
  const wSpread = 0.05;

  // محاسبه میانگین وزنی نقاط بهینه ورود
  sumPrices += atrBasedPrice * wAtr;
  totalWeight += wAtr;

  // انطباق با MAE انتظاری تاریخی (ورود در نزدیکی کف نوسان انتظاری)
  const maeBasedPrice = isLong ? currentPrice - expectedMaeUsd * 0.8 : currentPrice + expectedMaeUsd * 0.8;
  sumPrices += maeBasedPrice * wMae;
  totalWeight += wMae;

  if (hasOb) {
    sumPrices += structuralAnchor * wOb;
    totalWeight += wOb;
  }
  if (hasFvg) {
    sumPrices += fvgAnchor * wFvg;
    totalWeight += wFvg;
  }
  if (hasLiquidity) {
    sumPrices += liquidityAnchor * wLiq;
    totalWeight += wLiq;
  }

  // جریمه یا پاداش اسپرد: اگر اسپرد بالا باشد، پوزیشن عمیق‌تری می‌خواهیم تا اسلیپیج جبران شود
  const spreadOffset = isLong ? -spread * 1.5 : spread * 1.5;
  const spreadAdjustedPrice = currentPrice + spreadOffset;
  sumPrices += spreadAdjustedPrice * wSpread;
  totalWeight += wSpread;

  // میانگین نهایی نقطه ورود
  optimalEntry = sumPrices / totalWeight;

  // اگر شدت حجم زیاد باشد (حمله خریداران یا فروشندگان پرحجم)، پولبک‌ها سریع و کوتاه‌تر خواهند بود
  if (volumeSurgeRatio > 1.8) {
    optimalEntry = isLong 
      ? optimalEntry * 1.0015 // کمی بالاتر برای هیت شدن سریع اردر
      : optimalEntry * 0.9985; // کمی پایین‌تر
  }

  // ۵. ساخت پهنای محدوده مجاز ورود (Entry Zone Start & End)
  // پهنای محدوده به نوسان‌پذیری (ATR) و کیفیت اسپرد بازار بستگی دارد
  const zoneWidth = atr * 0.12 + spread * 0.5;
  const zoneStart = isLong ? optimalEntry - zoneWidth : optimalEntry + zoneWidth;
  const zoneEnd = isLong ? optimalEntry + zoneWidth : optimalEntry - zoneWidth;

  // محاسبه نمره اطمینان بر اساس هماهنگی مولفه‌ها
  let alignmentScore = 60;
  if (hasOb && hasFvg) alignmentScore += 15;
  if (hasLiquidity) alignmentScore += 15;
  if (volumeSurgeRatio > 1.2 && volumeSurgeRatio < 2.5) alignmentScore += 10;
  alignmentScore = Math.min(99, alignmentScore);

  return {
    optimalEntry: Number(optimalEntry.toFixed(2)),
    zoneStart: Number(Math.min(zoneStart, zoneEnd).toFixed(2)),
    zoneEnd: Number(Math.max(zoneStart, zoneEnd).toFixed(2)),
    expectedMae: Number(expectedMaeUsd.toFixed(2)),
    confidenceScore: alignmentScore,
    factors: {
      atrWeight: Number((wAtr / totalWeight).toFixed(2)),
      fvgWeight: Number((wFvg / totalWeight).toFixed(2)),
      liquidityWeight: Number((wLiq / totalWeight).toFixed(2)),
      orderBlockWeight: Number((wOb / totalWeight).toFixed(2)),
      spreadWeight: Number((wSpread / totalWeight).toFixed(2)),
      maeWeight: Number((wMae / totalWeight).toFixed(2))
    }
  };
};
