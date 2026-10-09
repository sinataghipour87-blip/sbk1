/**
 * 🛡️ الگوریتم پروتکل هشدار زودهنگام مغزها (Brain Consensus Early Warning Protocol)
 * هدف: شناسایی پیش‌دستانه نوسانات شدید یا تلاطم پیش از وقوع، و افزایش خودکار وزن مغزهای امن‌تر و محافظتی (مانند GARCH، ریسک و Auto-Pilot) به جای متوقف کردن معاملات.
 */

export interface EarlyWarningState {
  isEarlyWarningTriggered: boolean;
  volatilityThreatLevel: 'NORMAL' | 'ELEVATED' | 'SEVERE_TURBULENCE';
  safeBrainsWeightBoostPct: number;
  activeProtocolNameFa: string;
  mitigationActionFa: string;
}

export function evaluateEarlyWarningProtocol(volatilityPct: number, obi: number, garchRegime: string): EarlyWarningState {
  const isVolatile = volatilityPct > 2.8 || garchRegime === 'SPIKE_TURBULENCE' || Math.abs(obi) > 0.35;

  if (isVolatile) {
    return {
      isEarlyWarningTriggered: true,
      volatilityThreatLevel: volatilityPct > 4.0 ? 'SEVERE_TURBULENCE' : 'ELEVATED',
      safeBrainsWeightBoostPct: 35.0, // ۳۵٪ تقویت وزن مغزهای امن و محافظتی (GARCH & Risk Hedging)
      activeProtocolNameFa: 'پروتکل دفاع پیش‌دستانه و افزایش وزن مغزهای امن (Safe-Brain Boost)',
      mitigationActionFa: 'به‌جای متوقف کردن سیستم، وزن مغزهای مدیریت ریسک و استاپ شناور ۳۵٪ افزایش یافت تا با حفظ فرکانس معامله، پاداش امن تضمین شود.'
    };
  }

  return {
    isEarlyWarningTriggered: false,
    volatilityThreatLevel: 'NORMAL',
    safeBrainsWeightBoostPct: 0,
    activeProtocolNameFa: 'حالت عادی آلفا و پایداری کامل بازار',
    mitigationActionFa: 'شاخص نوسان و تلاطم در محدوده پایدار است؛ تمام ۱۰ مغز با وزن متغیر استاندارد فعالیت می‌کنند.'
  };
}
