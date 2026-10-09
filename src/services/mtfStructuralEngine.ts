/**
 * 🛰️ MTF Structural Engine (Multi-Timeframe Structure & Conflict Resolver)
 * 
 * ۲۹. خروج MTF از رای‌گیری ساده:
 *    - تعیین وظیفه مستقل برای هر تایم‌فریم:
 *      4H = Macro Structure (وزن: ۳۰٪)
 *      1H = Regime/Structure (وزن: ۲۵٪)
 *      15m = Setup (وزن: ۲۰٪)
 *      5m = Entry Zone (وزن: ۱۵٪)
 *      1m = Trigger/Execution (وزن: ۱۰٪)
 * 
 * ۳۰. جلوگیری از Conflict پنهان MTF:
 *    - فرموله‌سازی سناریوهای ساختاری برای تفکیک Pullback از Reversal قطعی ساختار
 */

import {
  MtfRoleDefinition,
  MtfRoleType,
  MtfStructuralScenarioType,
  MtfStructuralReport,
  TradingTimeframe,
} from '../types/trading';

/**
 * نقشه اطلاعات نقش‌های هر تایم‌فریم
 */
export const MTF_ROLE_MAP: Record<TradingTimeframe, { role: MtfRoleType; name: string; weight: number; focus: string }> = {
  '4h': {
    role: 'MACRO_STRUCTURE',
    name: 'ساختار کلان (Macro Structure)',
    weight: 0.30,
    focus: 'تعیین روند اصلی کلان و مکان‌یابی استخرهای سنگین نقدینگی هفتگی/روزانه.',
  },
  '1h': {
    role: 'REGIME_STRUCTURE',
    name: 'رژیم و ساختار میانی (Regime Structure)',
    weight: 0.25,
    focus: 'تشخیص رژیم معاملاتی روزانه، محدوده‌های رنج کلیدی و خط تعادل VWAP.',
  },
  '15m': {
    role: 'SETUP',
    name: 'ستاپ معاملاتی (Setup)',
    weight: 0.20,
    focus: 'کشف الگوهای فنی ورود شامل پولبک‌های اصلاحی، FVG، اوردر بلاک و هانت نقدینگی.',
  },
  '5m': {
    role: 'ENTRY_ZONE',
    name: 'محدوده بهینه ورود (Entry Zone)',
    weight: 0.15,
    focus: 'شناسایی و کالیبره کردن ارزان‌ترین لول قیمتی برای ورود و تنظیم حد ضرر بهینه.',
  },
  '1m': {
    role: 'TRIGGER_EXECUTION',
    name: 'ماشه و اجرای سفارش (Trigger/Execution)',
    weight: 0.10,
    focus: 'تایید نهایی با کندل استیک ثانیه‌ای (ریجکشن شادو، مومنتوم صعودی/نزولی قوی).',
  },
};

/**
 * ۳۰ & ۲۹. تحلیل ساختاری چند تایم‌فریمه و حل تداخل مابین آنها
 */
export function processMtfStructuralAnalysis(
  biases: Record<TradingTimeframe, 'BULLISH' | 'BEARISH' | 'NEUTRAL'>,
  scores: Record<TradingTimeframe, number>
): MtfStructuralReport {
  // ۱. ساخت تعاریف نقش‌ها برای هر تایم‌فریم
  const roles: Record<TradingTimeframe, MtfRoleDefinition> = {} as any;

  for (const tf of ['4h', '1h', '15m', '5m', '1m'] as TradingTimeframe[]) {
    const config = MTF_ROLE_MAP[tf];
    const bias = biases[tf] || 'NEUTRAL';
    const score = scores[tf] || 50;

    let detailsFa = '';
    if (bias === 'BULLISH') {
      detailsFa = `ساختار صعودی قدرتمند در فاز ${config.name} با برتری خریداران (امتیاز: ${score}).`;
    } else if (bias === 'BEARISH') {
      detailsFa = `ساختار نزولی منسجم در فاز ${config.name} تحت سیطره فروشندگان (امتیاز: ${score}).`;
    } else {
      detailsFa = `عدم جهت‌گیری واضح در فاز ${config.name} و تعادل موقت نیروها.`;
    }

    roles[tf] = {
      timeframe: tf,
      role: config.role,
      roleFa: config.name,
      focusAreaFa: config.focus,
      bias,
      score,
      detailsFa,
    };
  }

  // ۲. فرموله‌سازی سناریوهای ساختاری پیشرفته جهت حل تداخل (Conflict Resolution)
  const bias4h = biases['4h'] || 'NEUTRAL';
  const bias1h = biases['1h'] || 'NEUTRAL';
  const bias15m = biases['15m'] || 'NEUTRAL';
  const bias5m = biases['5m'] || 'NEUTRAL';
  const bias1m = biases['1m'] || 'NEUTRAL';

  let activeScenario: MtfStructuralScenarioType = 'CHOPPY_NO_EDGE';
  let scenarioFa = 'نوسان نامنظم بازار (Choppy Noise)';
  let isConflictDetected = false;
  let conflictDetailsFa = 'تایم‌فریم‌ها تداخل پراکنده دارند که لبه معامله معتبری ارائه نمی‌دهد.';
  let actionPermission: MtfStructuralReport['actionPermission'] = 'BLOCKED_BY_CONFLICT';
  let verdictFa = '';

  // بررسی همگرایی کامل صعودی یا نزولی
  const isFullBullish = bias4h === 'BULLISH' && bias1h === 'BULLISH' && bias15m === 'BULLISH' && bias5m === 'BULLISH';
  const isFullBearish = bias4h === 'BEARISH' && bias1h === 'BEARISH' && bias15m === 'BEARISH' && bias5m === 'BEARISH';

  if (isFullBullish) {
    activeScenario = 'CONGRUENT_TREND_CONTINUATION';
    scenarioFa = 'روند صعودی یکپارچه و همگرای تمام تایم‌فریم‌ها';
    isConflictDetected = false;
    conflictDetailsFa = 'هیچ تداخلی وجود ندارد؛ تمام تایم‌فریم‌ها همسو هستند.';
    actionPermission = 'ALLOWED_EXECUTE';
    verdictFa = 'اجازه معامله صعودی: همگرایی کامل بازار در تمام ابعاد ساختار کلان تا تاییدیه نهایی ماشه اجرا صادر شد (توصیه به ورود پوزیشن لانگ).';
  } else if (isFullBearish) {
    activeScenario = 'CONGRUENT_TREND_CONTINUATION';
    scenarioFa = 'روند نزولی یکپارچه و همگرای تمام تایم‌فریم‌ها';
    isConflictDetected = false;
    conflictDetailsFa = 'هیچ تداخلی وجود ندارد؛ تمام تایم‌فریم‌ها همسو هستند.';
    actionPermission = 'ALLOWED_EXECUTE';
    verdictFa = 'اجازه معامله نزولی: همگرایی کامل بازار در جهت ریزش در تمامی لایه‌های ساختار و اجرا تایید شد (توصیه به ورود پوزیشن شورت).';
  }
  // سناریو الف: پولبک در امتداد روند صعودی کلان (4H صعودی، 1H صعودی، 15m نزولی، 5m در حال هانت یا صعودی)
  else if (bias4h === 'BULLISH' && bias1h === 'BULLISH' && (bias15m === 'BEARISH' || bias5m === 'BULLISH')) {
    activeScenario = 'PULLBACK_IN_HTF_TREND';
    scenarioFa = 'اصلاح موقت در امتداد روند صعودی کلان (Pullback in HTF Trend)';
    isConflictDetected = true;
    conflictDetailsFa = 'تداخل مثبت: تایم‌فریم ۱۵ دقیقه نزولی است اما ساختار کلان صعودی است. این یک چرخش نزولی نیست، بلکه یک اصلاح بهینه برای خرید است!';
    actionPermission = 'ALLOWED_PULLBACK_ONLY';
    verdictFa = 'مجوز ورود لانگ در اصلاح: تداخل ساختاری به نفع خریداران مایکرو است. شورت گرفتن اکیداً ممنوع؛ منحصراً منتظر تایید ستاپ خرید در محدوده ۵ دقیقه بمانید.';
  }
  // سناریو ب: پولبک در امتداد روند نزولی کلان (4H نزولی، 1H نزولی، 15m صعودی، 5m در حال هانت یا نزولی)
  else if (bias4h === 'BEARISH' && bias1h === 'BEARISH' && (bias15m === 'BULLISH' || bias5m === 'BEARISH')) {
    activeScenario = 'PULLBACK_IN_HTF_TREND';
    scenarioFa = 'اصلاح صعودی موقت در امتداد روند نزولی کلان (Bearish Pullback)';
    isConflictDetected = true;
    conflictDetailsFa = 'تداخل مثبت شورت: ۱۵ دقیقه صعودی است اما روندهای بالا نزولی هستند. این اصلاح موقت برای فروش در سقف بهینه است.';
    actionPermission = 'ALLOWED_PULLBACK_ONLY';
    verdictFa = 'مجوز ورود شورت در اصلاح صعودی: تداخل به نفع فروشندگان کلان است. لانگ گرفتن زودهنگام ممنوع؛ منتظر تایید ریجکشن ۵ دقیقه بمانید.';
  }
  // سناریو ج: چرخش ساختار کلان تایید شده (4H صعودی اما 1H نزولی، 15m نزولی)
  else if (bias4h === 'BULLISH' && bias1h === 'BEARISH' && bias15m === 'BEARISH') {
    activeScenario = 'HTF_REVERSAL_CONFIRMED';
    scenarioFa = 'چرخش نزولی تایید شده ساختار کلان (HTF Reversal Confirmed)';
    isConflictDetected = true;
    conflictDetailsFa = 'هشدار چرخش روند: روند مایکرو ۴ ساعته صعودی است اما میان‌مدت و میان‌روزی نزولی شده‌اند؛ ساختار کلان صعودی در حال فروپاشی است!';
    actionPermission = 'ALLOWED_EXECUTE'; // اجازه ترید در جهت جدید صادر می‌شود
    verdictFa = 'هشدار چرخش ساختار: به هیچ عنوان پوزیشن لانگ نگیرید. ساختار میان‌روزی معکوس شده و شورت گرفتن در ریتست‌ها با تارگت کف‌های روزانه اولویت دارد.';
  }
  // سناریو د: چرخش صعودی ساختار کلان (4H نزولی اما 1H صعودی، 15m صعودی)
  else if (bias4h === 'BEARISH' && bias1h === 'BULLISH' && bias15m === 'BULLISH') {
    activeScenario = 'HTF_REVERSAL_CONFIRMED';
    scenarioFa = 'چرخش صعودی تایید شده ساختار کلان (HTF Bullish Reversal)';
    isConflictDetected = true;
    conflictDetailsFa = 'چرخش صعودی روند: ساختار ۴ ساعته نزولی است اما روندهای ۱ ساعته و ۱۵ دقیقه صعودی پرقدرت شده‌اند؛ انباشت خریداران آغاز شده است.';
    actionPermission = 'ALLOWED_EXECUTE';
    verdictFa = 'چرخش صعودی ماژور: از پوزیشن‌های فروش خارج شوید. تغییر جهت میان‌مدت به صعودی تایید شده و اولویت با معاملات خرید در پولبک‌هاست.';
  }
  // سناریو هـ: نوسان خنثی یا تداخل شلوغ (بلاک معامله)
  else {
    activeScenario = 'CHOPPY_NO_EDGE';
    scenarioFa = 'تداخل فرساینده نوسانی بدون لبه معاملاتی (Choppy No Edge)';
    isConflictDetected = true;
    conflictDetailsFa = 'تداخل پراکنده و متقاطع در تایم‌فریم‌ها که هیچ برتری آماری ارائه نمی‌دهد.';
    actionPermission = 'BLOCKED_BY_CONFLICT';
    verdictFa = 'معامله ممنوع: تداخل فرساینده ساختارها خطر بالای اسلیپیج و حد ضررهای متوالی دارد. تا خروج قیمت از فاز رنج مبهم صبر کنید.';
  }

  // ۳. محاسبه امتیاز همگرایی وزن‌دهی شده بر اساس وزن مستقل هر تایم‌فریم
  let finalUnifiedScore = 0;
  for (const tf of ['4h', '1h', '15m', '5m', '1m'] as TradingTimeframe[]) {
    const roleConfig = MTF_ROLE_MAP[tf];
    const bias = biases[tf] || 'NEUTRAL';
    const rawScore = scores[tf] || 50;

    // وزن دهی جهت‌گیری
    let biasFactor = 0.5;
    if (bias === 'BULLISH') biasFactor = 1.0;
    else if (bias === 'BEARISH') biasFactor = 0.0;

    finalUnifiedScore += (rawScore * biasFactor) * roleConfig.weight;
  }
  finalUnifiedScore = Math.round(finalUnifiedScore * 1.5); // مقیاس‌گذاری تا ۱۰۰

  return {
    roles,
    activeScenario,
    scenarioFa,
    isConflictDetected,
    conflictDetailsFa,
    actionPermission,
    verdictFa,
    finalUnifiedScore: Math.min(100, Math.max(0, finalUnifiedScore)),
    calculatedAt: Date.now(),
  };
}
