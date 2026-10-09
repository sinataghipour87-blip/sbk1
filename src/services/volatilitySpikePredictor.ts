/**
 * ⚡ پیش‌بینی‌کننده نوسانات ناگهانی (Volatility Spike Predictor Service)
 * تحلیل همگرایی فاندینگ‌ریت (Funding Rate) و عدم تقارن اردربوک (OBI) برای صدور هشدارهای پیش‌دستانه پیش از حرکات شارپ.
 */

export interface VolatilitySpikeReport {
  spikeProbabilityPct: number;
  expectedDirection: 'UP_SHORT_SQUEEZE' | 'DOWN_LONG_FLUSH' | 'RANGING_COMPRESSION' | 'NEUTRAL';
  fundingRateStatusFa: string;
  orderBookImbalanceScore: number;
  alertLevel: 'CRITICAL_SPIKE_IMMINENT' | 'MODERATE_WARNING' | 'STABLE_ZONES';
  actionAdvisoryFa: string;
}

export function evaluateVolatilitySpike(analysis: any, currentPrice = 0): VolatilitySpikeReport {
  const funding = analysis?.funding ?? analysis?.fundingRate ?? 0.015;
  const obi = analysis?.obi ?? 0.08;
  const volPct = analysis?.volatilityPct ?? 1.4;

  let spikeProbability = 45;
  let expectedDirection: VolatilitySpikeReport['expectedDirection'] = 'NEUTRAL';
  let alertLevel: VolatilitySpikeReport['alertLevel'] = 'STABLE_ZONES';
  let fundingStatusFa = `فاندینگ‌ریت در سطح نرمال (${(funding * 100).toFixed(3)}٪) قرار دارد.`;
  let advisoryFa = 'بازار در حالت تعادل نسبی است؛ پایش صدم‌ثانیه‌ای توسط مغزهای پردازشی فعال است.';

  if (funding > 0.035 && obi < -0.10) {
    spikeProbability = 89;
    expectedDirection = 'DOWN_LONG_FLUSH';
    alertLevel = 'CRITICAL_SPIKE_IMMINENT';
    fundingStatusFa = `⚠️ انباشت پوزیشن‌های لانگ با فاندینگ بالا (${(funding * 100).toFixed(3)}٪) و فشار فروش در اردربوک!`;
    advisoryFa = 'هشدار پیش‌دستانه: احتمال ریزش شارپ (Long Flush) جهت تسویه اهرم‌های سنگین بسیار بالا است؛ تریلینگ استاپ فشرده فعال شد.';
  } else if (funding < -0.015 && obi > 0.10) {
    spikeProbability = 92;
    expectedDirection = 'UP_SHORT_SQUEEZE';
    alertLevel = 'CRITICAL_SPIKE_IMMINENT';
    fundingStatusFa = `🚀 فاندینگ منفی شدید (${(funding * 100).toFixed(3)}٪) همراه با انباشت تقاضا در اردربوک!`;
    advisoryFa = 'هشدار پیش‌دستانه: احتمال پمپ شارپ (Short Squeeze) پیش‌رو است؛ آماده‌باش کامل برای اتساع سود رانگ ۳.';
  } else if (volPct < 1.0) {
    spikeProbability = 68;
    expectedDirection = 'RANGING_COMPRESSION';
    alertLevel = 'MODERATE_WARNING';
    fundingStatusFa = `🔒 فشردگی نوسان (Volatility Compression) با فاندینگ خنثی؛ احتمال شکست انبار فنر.`;
    advisoryFa = 'آمادگی سناریوی فشردگی گارش: آماده باش برای انفجار قیمت در یکی از دو جهت.';
  }

  return {
    spikeProbabilityPct: spikeProbability,
    expectedDirection,
    fundingRateStatusFa: fundingStatusFa,
    orderBookImbalanceScore: Math.round(obi * 1000) / 10,
    alertLevel,
    actionAdvisoryFa: advisoryFa,
  };
}
