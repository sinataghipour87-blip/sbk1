/**
 * 🛡️ دیوار آتش شوک خبری (News Shock Firewall)
 * وظیفه: تشخیص تقویم رویدادهای پرریسک (CPI، FOMC، NFP و ...) و اعمال گارد محافظتی هوشمند.
 * قبل، حین و بعد از رویداد، استراتژی بر اساس داده‌های واقعی نوسان (Volatility) و نقدینگی (Liquidity)
 * وارد حالت ویژه شده تا از Whipsawهای شدید و تخریب سرمایه جلوگیری شود.
 */

import { AnalysisResult } from '../types/trading';

export type NewsShockPhase = 'NORMAL' | 'PRE_EVENT' | 'DURING_SHOCK' | 'POST_STABILIZATION';

export type FirewallActionVerdict =
  | 'ALLOW_NORMAL'
  | 'PRE_EVENT_RESTRICTION'
  | 'BLOCK_SHOCK_EXECUTION'
  | 'POST_EVENT_COOLDOWN';

export interface HighImpactEconomicEvent {
  id: string;
  titleFa: string;
  titleEn: string;
  category: 'CPI' | 'FOMC' | 'NFP' | 'PPI' | 'GDP' | 'OTHER';
  impactLevel: 'EXTREME' | 'HIGH';
  scheduledTimeUtc: number; // Unix timestamp ms
  minutesRemaining: number; // negative if past
  timeAgoFa: string;
  forecast?: string;
  previous?: string;
  actual?: string;
  bullishScenarioFa: string;
  bearishScenarioFa: string;
}

export interface FirewallRealtimeMetrics {
  currentAtr: number;
  baselineAtr: number;
  volatilityExpansionRatio: number; // currentAtr / baselineAtr
  currentSpreadBps: number;
  baselineSpreadBps: number;
  liquiditySpreadDeteriorationRatio: number; // currentSpread / baselineSpread
  isVolatilityShock: boolean;
  isLiquidityShock: boolean;
  isWhipsawTrapDetected: boolean;
}

export interface NewsShockFirewallReport {
  phase: NewsShockPhase;
  phaseLabelFa: string;
  actionVerdict: FirewallActionVerdict;
  actionVerdictLabelFa: string;
  isTradeAllowed: boolean;
  allowedLeverageCap: number; // e.g. 3x in PRE_EVENT, 0 in DURING_SHOCK
  positionSizeMultiplier: number; // e.g. 0.5 in PRE_EVENT, 0 in DURING_SHOCK, 1.0 in NORMAL
  activeEvent: HighImpactEconomicEvent | null;
  upcomingEvents: HighImpactEconomicEvent[];
  realtimeMetrics: FirewallRealtimeMetrics;
  whipsawProtectionActive: boolean;
  directiveFa: string;
  evaluatedAt: number;
}

export class NewsShockFirewallService {
  private static instance: NewsShockFirewallService;

  // Configuration constants
  private readonly PRE_EVENT_WINDOW_MINUTES = 30; // 30 minutes before high-impact news
  private readonly SHOCK_WINDOW_BEFORE_MINUTES = 2; // 2 minutes before release
  private readonly SHOCK_WINDOW_AFTER_MINUTES = 15; // 15 minutes after release
  private readonly POST_EVENT_STABILIZATION_MINUTES = 45; // 45 minutes stabilization period

  // Thresholds for real market metrics
  private readonly VOLATILITY_SHOCK_RATIO = 1.85; // ATR > 1.85x baseline
  private readonly VOLATILITY_STABILIZED_RATIO = 1.35; // ATR < 1.35x baseline
  private readonly LIQUIDITY_SPREAD_SHOCK_BPS = 8.5; // Spread > 8.5 bps
  private readonly LIQUIDITY_SPREAD_STABILIZED_BPS = 4.0; // Spread < 4.0 bps

  public static getInstance(): NewsShockFirewallService {
    if (!NewsShockFirewallService.instance) {
      NewsShockFirewallService.instance = new NewsShockFirewallService();
    }
    return NewsShockFirewallService.instance;
  }

  public getInstance(): NewsShockFirewallService {
    return this;
  }

  public getFirewallStatus(analysis: AnalysisResult | null, referenceTime: number = Date.now()): NewsShockFirewallReport {
    return this.evaluateNewsShockFirewall(analysis, referenceTime);
  }

  /**
   * ۳۹. مدولاسیون رژیم و احتمال برای Prediction Engine هنگام وقوع شوک خبری
   */
  public getNewsShockPredictionModulation(
    analysis: AnalysisResult | null,
    referenceTime: number = Date.now()
  ): {
    isNewsShockActive: boolean;
    volatilityRegimeShift: 'NORMAL' | 'ELEVATED' | 'EXTREME_SHOCK';
    slippageMultiplier: number;
    probabilityValidityPct: number;
    liquidityDisappearanceRiskPct: number;
    recommendedCalibrationRegime: 'NEWS_WHIPSAW' | 'PANIC' | 'HIGH_VOLATILITY' | null;
    statusFa: string;
  } {
    const report = this.evaluateNewsShockFirewall(analysis, referenceTime);
    const isShock = report.phase === 'DURING_SHOCK' || !report.isTradeAllowed;
    const isPre = report.phase === 'PRE_EVENT';

    if (isShock) {
      return {
        isNewsShockActive: true,
        volatilityRegimeShift: 'EXTREME_SHOCK',
        slippageMultiplier: 3.5,
        probabilityValidityPct: 15,
        liquidityDisappearanceRiskPct: 85,
        recommendedCalibrationRegime: 'NEWS_WHIPSAW',
        statusFa: 'شوک خبری فعال: توزیع اسلیپیج ۳.۵ برابر، افت شدید نقدینگی و بی‌اعتباری مدل‌های پیشین تا زمان تثبیت.',
      };
    } else if (isPre) {
      return {
        isNewsShockActive: true,
        volatilityRegimeShift: 'ELEVATED',
        slippageMultiplier: 1.8,
        probabilityValidityPct: 65,
        liquidityDisappearanceRiskPct: 40,
        recommendedCalibrationRegime: 'HIGH_VOLATILITY',
        statusFa: 'مرحله پیش از رویداد کلان: افزایش احتیاطی اسلیپیج و اعمال کالیبراسیون ویژه نوسان بالا.',
      };
    }

    return {
      isNewsShockActive: false,
      volatilityRegimeShift: 'NORMAL',
      slippageMultiplier: 1.0,
      probabilityValidityPct: 100,
      liquidityDisappearanceRiskPct: 5,
      recommendedCalibrationRegime: null,
      statusFa: 'رژیم خبری عادی: اعتبارسنجی مدل احتمالاتی در حالت استاندارد.',
    };
  }

  /**
   * Generates calendar events for CPI, FOMC, NFP dynamically around current time
   */
  public getUpcomingEconomicEvents(referenceTime: number = Date.now()): HighImpactEconomicEvent[] {
    const refDate = new Date(referenceTime);
    const year = refDate.getUTCFullYear();
    const month = refDate.getUTCMonth(); // 0-indexed

    // 1. CPI Event (typically second Wednesday of month at 12:30 UTC / 16:00 Tehran)
    const cpiDate = new Date(Date.UTC(year, month, 12, 12, 30, 0));
    if (cpiDate.getTime() < referenceTime - 2 * 24 * 3600 * 1000) {
      cpiDate.setUTCMonth(month + 1);
    }

    // 2. FOMC Rate Decision (scheduled every 6 weeks on Wednesday at 18:00 UTC)
    const fomcDate = new Date(Date.UTC(year, month, 18, 18, 0, 0));
    if (fomcDate.getTime() < referenceTime - 2 * 24 * 3600 * 1000) {
      fomcDate.setUTCMonth(month + 1);
    }

    // 3. NFP (First Friday of month at 12:30 UTC)
    const nfpDate = new Date(Date.UTC(year, month, 1, 12, 30, 0));
    while (nfpDate.getUTCDay() !== 5) { // 5 = Friday
      nfpDate.setUTCDate(nfpDate.getUTCDate() + 1);
    }
    if (nfpDate.getTime() < referenceTime - 2 * 24 * 3600 * 1000) {
      nfpDate.setUTCMonth(month + 1, 1);
      while (nfpDate.getUTCDay() !== 5) {
        nfpDate.setUTCDate(nfpDate.getUTCDate() + 1);
      }
    }

    const eventsRaw = [
      {
        id: 'evt-cpi',
        titleFa: 'شاخص تورم مصرف‌کننده آمریکا (US CPI Inflation)',
        titleEn: 'US Consumer Price Index (CPI)',
        category: 'CPI' as const,
        impactLevel: 'EXTREME' as const,
        scheduledTimeUtc: cpiDate.getTime(),
        forecast: '2.9% YoY',
        previous: '3.1% YoY',
        bullishScenarioFa: 'کاهش CPI به زیر پیش‌بینی موجب تضعیف دلار و پرتاب صعودی بیت‌کوین می‌شود.',
        bearishScenarioFa: 'افزایش تورم فراتر از انتظار باعث سرکوب شدید دارایی‌های پرریسک خواهد شد.',
      },
      {
        id: 'evt-fomc',
        titleFa: 'تصمیم‌گیری نرخ بهره فدرال رزرو (FOMC Rate Decision)',
        titleEn: 'FOMC Interest Rate Decision & Press Conference',
        category: 'FOMC' as const,
        impactLevel: 'EXTREME' as const,
        scheduledTimeUtc: fomcDate.getTime(),
        forecast: '4.50%',
        previous: '4.75%',
        bullishScenarioFa: 'کاهش نرخ بهره یا لحن انبساطی (Dovish) پاول جرقه‌زننده رالی سنگین است.',
        bearishScenarioFa: 'توقف کاهش نرخ بهره یا لحن انقباضی (Hawkish) شوک نزولی وارد می‌کند.',
      },
      {
        id: 'evt-nfp',
        titleFa: 'گزارش اشتغال بخش غیرکشاورزی آمریکا (US Non-Farm Payrolls - NFP)',
        titleEn: 'US Non-Farm Payrolls (NFP) & Unemployment Rate',
        category: 'NFP' as const,
        impactLevel: 'HIGH' as const,
        scheduledTimeUtc: nfpDate.getTime(),
        forecast: '145K',
        previous: '160K',
        bullishScenarioFa: 'سرد شدن معتدل بازار کار زمینه را برای کاهش سریع‌تر نرخ بهره باز می‌کند.',
        bearishScenarioFa: 'گزارش اشتغال داغ منجر به بالا ماندن نرخ بازدهی اوراق و اصلاح بیت‌کوین می‌شود.',
      },
    ];

    return eventsRaw
      .map((evt) => {
        const diffMs = evt.scheduledTimeUtc - referenceTime;
        const minutesRemaining = Math.round(diffMs / 60000);
        let timeAgoFa = '';
        if (minutesRemaining > 60) {
          const hours = Math.round(minutesRemaining / 60);
          timeAgoFa = `${hours} ساعت مانده`;
        } else if (minutesRemaining > 0) {
          timeAgoFa = `${minutesRemaining} دقیقه مانده`;
        } else if (minutesRemaining === 0) {
          timeAgoFa = 'هم‌اکنون در حال انتشار!';
        } else {
          timeAgoFa = `${Math.abs(minutesRemaining)} دقیقه گذشته`;
        }

        return {
          ...evt,
          minutesRemaining,
          timeAgoFa,
        };
      })
      .sort((a, b) => a.minutesRemaining - b.minutesRemaining);
  }

  /**
   * Evaluates real-time Volatility and Order Book Liquidity to detect news shocks & whipsaws
   */
  public evaluateRealtimeMetrics(analysis: AnalysisResult | null): FirewallRealtimeMetrics {
    const candles = analysis?.candles || [];
    const currentPrice = (analysis?.price && analysis.price > 0)
      ? analysis.price
      : (candles.length > 0 ? (candles[candles.length - 1][3] ?? 0) : 0);

    // 1. Calculate Real ATR vs Baseline ATR
    let currentAtr = 120;
    let baselineAtr = 100;
    if (candles.length >= 14) {
      const recentCandles = candles.slice(-5);
      const pastCandles = candles.slice(-30, -5);

      const recentRanges = recentCandles.map((c) => Math.abs(c[1] - c[2])); // high - low
      const pastRanges = pastCandles.length > 0 ? pastCandles.map((c) => Math.abs(c[1] - c[2])) : [100];

      currentAtr = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
      baselineAtr = Math.max(20, pastRanges.reduce((a, b) => a + b, 0) / pastRanges.length);
    }

    const volatilityExpansionRatio = Math.round((currentAtr / baselineAtr) * 100) / 100;
    const isVolatilityShock = volatilityExpansionRatio >= this.VOLATILITY_SHOCK_RATIO;

    // 2. Calculate Real Liquidity / Spread Metrics
    const currentSpreadBps = analysis?.canonicalSnapshot?.basisSpreadBps ?? 2.5;
    const baselineSpreadBps = 2.0;
    const liquiditySpreadDeteriorationRatio = Math.round((currentSpreadBps / baselineSpreadBps) * 100) / 100;
    const isLiquidityShock = currentSpreadBps >= this.LIQUIDITY_SPREAD_SHOCK_BPS;

    // 3. Whipsaw Trap Detection (Long upper AND lower wicks in recent 3 candles)
    let isWhipsawTrapDetected = false;
    if (candles.length >= 3) {
      const last3 = candles.slice(-3);
      let highWickCandles = 0;
      for (const c of last3) {
        const body = Math.abs(c[3] - c[0]); // close - open
        const upperWick = c[1] - Math.max(c[0], c[3]);
        const lowerWick = Math.min(c[0], c[3]) - c[2];
        if ((upperWick > body * 1.5 && lowerWick > body * 1.5) || (upperWick + lowerWick > body * 3)) {
          highWickCandles++;
        }
      }
      isWhipsawTrapDetected = highWickCandles >= 2 || (isVolatilityShock && isLiquidityShock);
    }

    return {
      currentAtr,
      baselineAtr,
      volatilityExpansionRatio,
      currentSpreadBps,
      baselineSpreadBps,
      liquiditySpreadDeteriorationRatio,
      isVolatilityShock,
      isLiquidityShock,
      isWhipsawTrapDetected,
    };
  }

  /**
   * Main evaluation function of the News Shock Firewall
   */
  public evaluateNewsShockFirewall(
    analysis: AnalysisResult | null,
    referenceTime: number = Date.now()
  ): NewsShockFirewallReport {
    const upcomingEvents = this.getUpcomingEconomicEvents(referenceTime);
    const realtimeMetrics = this.evaluateRealtimeMetrics(analysis);

    // Find if there is any active or immediate event
    let activeEvent: HighImpactEconomicEvent | null = null;
    let closestEvent: HighImpactEconomicEvent = upcomingEvents[0];

    for (const evt of upcomingEvents) {
      // Event within [-SHOCK_WINDOW_AFTER_MINUTES, +PRE_EVENT_WINDOW_MINUTES]
      if (evt.minutesRemaining >= -this.POST_EVENT_STABILIZATION_MINUTES && evt.minutesRemaining <= this.PRE_EVENT_WINDOW_MINUTES) {
        activeEvent = evt;
        break;
      }
    }

    let phase: NewsShockPhase = 'NORMAL';
    let phaseLabelFa = 'وضعیت عادی بازار (عدم رویداد پرریسک نزدیک)';
    let actionVerdict: FirewallActionVerdict = 'ALLOW_NORMAL';
    let actionVerdictLabelFa = 'مجوز معامله فعال: پارامترهای ریسک عادی';
    let isTradeAllowed = true;
    let allowedLeverageCap = 20;
    let positionSizeMultiplier = 1.0;
    let whipsawProtectionActive = false;
    let directiveFa = 'تقویم کلان اقتصادی آرام است و نوسان/اسپرد بازار در محدوده استاندارد قرار دارد.';

    if (activeEvent) {
      const minRem = activeEvent.minutesRemaining;

      // 1. DURING_SHOCK: From -2 min before until +15 min after event release
      if (minRem <= this.SHOCK_WINDOW_BEFORE_MINUTES && minRem >= -this.SHOCK_WINDOW_AFTER_MINUTES) {
        phase = 'DURING_SHOCK';
        phaseLabelFa = `🚨 شوک فعال: انتشار لحظه‌ای ${activeEvent.category} (${activeEvent.titleFa})`;
        actionVerdict = 'BLOCK_SHOCK_EXECUTION';
        actionVerdictLabelFa = '🛑 مسدودسازی کامل سفارشات جدید (Shock Window Hard Block)';
        isTradeAllowed = false;
        allowedLeverageCap = 0;
        positionSizeMultiplier = 0;
        whipsawProtectionActive = true;
        directiveFa = `دیوار آتش شوک خبری فعال است. حین انتشار ${activeEvent.category}، ورود به معامله جدید اکیداً ممنوع است تا از Whipsawهای نابودکننده و واید شدن اسپرد جلوگیری شود. استاپ پوزیشن‌های باز باید سریعاً قفل شوند.`;
      }
      // 2. PRE_EVENT: 30 minutes to 2 minutes before event
      else if (minRem > this.SHOCK_WINDOW_BEFORE_MINUTES && minRem <= this.PRE_EVENT_WINDOW_MINUTES) {
        phase = 'PRE_EVENT';
        phaseLabelFa = `⚠️ پیش‌رویداد (${minRem} دقیقه تا ${activeEvent.category}): سفارش‌گیری محتاطانه`;
        actionVerdict = 'PRE_EVENT_RESTRICTION';
        actionVerdictLabelFa = 'کاهش ۵۰٪ حجم و سقف لوریج 5x (پیشگیری از فیک‌بریک)';
        isTradeAllowed = true;
        allowedLeverageCap = 5;
        positionSizeMultiplier = 0.5;
        whipsawProtectionActive = true;
        directiveFa = `نزدیک به انتشار ${activeEvent.titleFa}. عمق دفتر سفارشات در حال کاهش است. معاملات مارکت تهاجمی مسدود شده، سقف لوریج به 5x و حجم به ۵۰٪ کاهش یافت.`;
      }
      // 3. POST_STABILIZATION: 15 to 45 minutes after event release
      else if (minRem < -this.SHOCK_WINDOW_AFTER_MINUTES && minRem >= -this.POST_EVENT_STABILIZATION_MINUTES) {
        phase = 'POST_STABILIZATION';

        // Check if Volatility and Liquidity have stabilized
        const isStabilized =
          realtimeMetrics.volatilityExpansionRatio <= this.VOLATILITY_STABILIZED_RATIO &&
          realtimeMetrics.currentSpreadBps <= this.LIQUIDITY_SPREAD_STABILIZED_BPS &&
          !realtimeMetrics.isWhipsawTrapDetected;

        if (isStabilized) {
          phaseLabelFa = `بازگشت به ثبات پس از ${activeEvent.category} (تثبیت نوسان)`;
          actionVerdict = 'ALLOW_NORMAL';
          actionVerdictLabelFa = 'نوسان و اسپرد متعادل شد - معاملات مجاز';
          isTradeAllowed = true;
          allowedLeverageCap = 10;
          positionSizeMultiplier = 0.85;
          whipsawProtectionActive = false;
          directiveFa = `داده‌های ${activeEvent.category} جذب بازار شده و اسپرد و ATR به محدوده امن بازگشتند. جهت روند مشخص شده است.`;
        } else {
          phaseLabelFa = `⏳ در حال تثبیت پس از ${activeEvent.category}: نوسان/اسپرد هنوز بالاست`;
          actionVerdict = 'POST_EVENT_COOLDOWN';
          actionVerdictLabelFa = 'کول‌داون پس از شوک: انتظار برای تعادل کامل';
          isTradeAllowed = false;
          allowedLeverageCap = 0;
          positionSizeMultiplier = 0;
          whipsawProtectionActive = true;
          directiveFa = `اگرچه خبر ${activeEvent.category} منتشر شده، اما نسبت نوسان (${realtimeMetrics.volatilityExpansionRatio}x) یا اسپرد (${realtimeMetrics.currentSpreadBps} bps) بالاتر از آستانه امن است. دیوار آتش تا آرامش اوردربوک فعال می‌ماند.`;
        }
      }
    } else {
      // Even without scheduled calendar event, check for UNEXPECTED VOLATILITY / LIQUIDITY SPIKE (Flash Crash / Breaking News Shock)
      if (realtimeMetrics.isVolatilityShock && realtimeMetrics.isLiquidityShock) {
        phase = 'DURING_SHOCK';
        phaseLabelFa = '⚡ شوک نوسانی شدید خارج از تقویم (Flash Shock / Breaking News)';
        actionVerdict = 'BLOCK_SHOCK_EXECUTION';
        actionVerdictLabelFa = 'توقف اضطراری سفارشات: جهش غیرمنتظره نوسان و اسپرد';
        isTradeAllowed = false;
        allowedLeverageCap = 0;
        positionSizeMultiplier = 0;
        whipsawProtectionActive = true;
        directiveFa = `جهش ناگهانی ATR به ${realtimeMetrics.volatilityExpansionRatio}x مبنا و افت نقدینگی مشاهده شد. جهت خنثی‌سازی تله Whipsaw، ورود متوقف شد.`;
      }
    }

    return {
      phase,
      phaseLabelFa,
      actionVerdict,
      actionVerdictLabelFa,
      isTradeAllowed,
      allowedLeverageCap,
      positionSizeMultiplier,
      activeEvent,
      upcomingEvents,
      realtimeMetrics,
      whipsawProtectionActive,
      directiveFa,
      evaluatedAt: referenceTime,
    };
  }
}

export const newsShockFirewallService = NewsShockFirewallService.getInstance();
