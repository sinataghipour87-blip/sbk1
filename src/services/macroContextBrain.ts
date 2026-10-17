/**
 * 🌐 مغز پردازش کلان بازار (Macro-Context Brain)
 * هدف: اتصال به ۱۰ مغز پردازشی دیگر و ادغام شاخص S&P 500 (بورس آمریکا) و DXY (شاخص دلار)
 * به عنوان فیلتر اعتبارگیری نهایی (Final Macro Filter) جهت تایید قطعی حرکت بیت‌کوین.
 * 
 * بر اساس قاعده ۴۳: تمام داده‌های هاردکد شده حذف شده‌اند و در صورت قطع یا شکست منبع،
 * وضعیت دقیقاً UNAVAILABLE نمایش داده می‌شود و از هرگونه داده ساختگی جلوگیری به عمل می‌آید.
 */

export type MetricDataStatus = 'LIVE' | 'UNKNOWN' | 'UNAVAILABLE';

export interface BitcoinNewsItem {
  id: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
}

export interface MacroCorrelationData {
  overallDataStatus: MetricDataStatus;
  lastUpdatedTime: number | null;
  lastUpdatedStr: string;
  provenance: Record<string, unknown>;

  // 1. S&P 500
  sp500Status: MetricDataStatus;
  sp500Price: number | null;
  sp500DailyChangePct: number | null;

  // 2. DXY (US Dollar Index)
  dxyStatus: MetricDataStatus;
  dxyIndex: number | null;
  dxyDailyChangePct: number | null;

  // 3. Fear & Greed
  fearAndGreedStatus: MetricDataStatus;
  fearAndGreedIndex: number | null;
  fearAndGreedLabelFa: string;

  // 4. Spot ETF Flow
  etfFlowStatus: MetricDataStatus;
  spotEtfNetInflowMillionUsd: number | null;

  // 5. Fed Expectations
  fedExpectationsStatus: MetricDataStatus;
  fedRateCutExpectationPct: number | null;

  // 6. News Sentiment
  newsSentimentStatus: MetricDataStatus;
  newsSentimentScore: number | null;
  newsHeadlinesStatus: MetricDataStatus;
  recentHeadlines: BitcoinNewsItem[];

  // 7. Whale Flow
  whaleFlowStatus: MetricDataStatus;
  whaleNetflowBtc: number | null;
  whalePressureIndex: number | null;
  whaleSentiment: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' | 'UNKNOWN' | null;

  // Macro & Correlation Filters
  btcCorrelationWithSP500: number | null;
  btcCorrelationWithDXY: number | null;
  macroFilterStatus: 'BULLISH_CONFIRMED' | 'BEARISH_CONFIRMED' | 'RISK_OFF_HOLD' | 'UNAVAILABLE';
  macroFilterStatusFa: string;
  isTradeApprovedByMacro: boolean;
  fundamentalScorePct: number | null;
  fundamentalBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE';
  breakingNewsImpactLevel: 'SEVERE_BEARISH_THREAT' | 'STRONG_BULLISH_CATALYST' | 'NORMAL_NEWS_FLOW' | 'UNAVAILABLE';
  breakingNewsActionDirectiveFa: string;
  emergencyDefensiveShield: boolean;
  runnerExpansionBoost: boolean;
}

function createDefaultUnavailableState(): MacroCorrelationData {
  return {
    overallDataStatus: 'UNAVAILABLE',
    lastUpdatedTime: null,
    lastUpdatedStr: 'در دسترس نیست (UNAVAILABLE)',
    provenance: {},

    sp500Status: 'UNAVAILABLE',
    sp500Price: null,
    sp500DailyChangePct: null,

    dxyStatus: 'UNAVAILABLE',
    dxyIndex: null,
    dxyDailyChangePct: null,

    fearAndGreedStatus: 'UNAVAILABLE',
    fearAndGreedIndex: null,
    fearAndGreedLabelFa: 'UNAVAILABLE (عدم دسترسی به منبع)',

    etfFlowStatus: 'UNAVAILABLE',
    spotEtfNetInflowMillionUsd: null,

    fedExpectationsStatus: 'UNAVAILABLE',
    fedRateCutExpectationPct: null,

    newsSentimentStatus: 'UNAVAILABLE',
    newsSentimentScore: null,
    newsHeadlinesStatus: 'UNAVAILABLE',
    recentHeadlines: [],

    whaleFlowStatus: 'UNKNOWN',
    whaleNetflowBtc: null,
    whalePressureIndex: null,
    whaleSentiment: 'UNKNOWN',

    btcCorrelationWithSP500: null,
    btcCorrelationWithDXY: null,
    macroFilterStatus: 'UNAVAILABLE',
    macroFilterStatusFa: '⚠️ وضعیت داده‌های ماکرو: UNAVAILABLE (قطع منبع داده زنده). هیچ داده فرضی یا ساختگی اعمال نمی‌شود.',
    isTradeApprovedByMacro: false,
    fundamentalScorePct: null,
    fundamentalBias: 'UNAVAILABLE',
    breakingNewsImpactLevel: 'UNAVAILABLE',
    breakingNewsActionDirectiveFa: 'منبع اخبار زنده در دسترس نیست. جهت محافظت از سرمایه، ورود خودکار بر اساس شایعه متوقف است.',
    emergencyDefensiveShield: false,
    runnerExpansionBoost: false,
  };
}

export class MacroContextBrainService {
  private static instance: MacroContextBrainService;
  private currentData: MacroCorrelationData = createDefaultUnavailableState();
  private isFetching = false;
  private lastFetchTimestamp = 0;

  public static getInstance(): MacroContextBrainService {
    if (!MacroContextBrainService.instance) {
      MacroContextBrainService.instance = new MacroContextBrainService();
    }
    return MacroContextBrainService.instance;
  }

  public getMacroContext(_btcPrice?: number): MacroCorrelationData {
    // Automatically trigger background refresh if stale (> 60s)
    const now = Date.now();
    if (!this.isFetching && now - this.lastFetchTimestamp > 60000) {
      this.refreshLiveMacroContext().catch(() => {});
    }
    return this.currentData;
  }

  public async refreshLiveMacroContext(): Promise<MacroCorrelationData> {
    if (this.isFetching) return this.currentData;
    this.isFetching = true;

    try {
      const res = await fetch('/api/macro-context', {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        this.currentData = createDefaultUnavailableState();
        return this.currentData;
      }

      const json = await res.json();
      const now = Date.now();
      this.lastFetchTimestamp = now;

      // Extract and validate all 7 metrics with zero fallback to hardcoded mock values
      const sp500Status: MetricDataStatus = json.sp500Status === 'LIVE' &&
        typeof json.sp500Price === 'number' &&
        Number.isFinite(json.sp500Price) &&
        json.sp500Price > 0 &&
        typeof json.sp500DailyChangePct === 'number' &&
        Number.isFinite(json.sp500DailyChangePct)
        ? 'LIVE'
        : 'UNAVAILABLE';
      const sp500Price = sp500Status === 'LIVE' ? json.sp500Price : null;
      const sp500DailyChangePct = sp500Status === 'LIVE' ? json.sp500DailyChangePct : null;

      const dxyStatus: MetricDataStatus = json.dxyStatus === 'LIVE' &&
        typeof json.dxyIndex === 'number' &&
        Number.isFinite(json.dxyIndex) &&
        json.dxyIndex > 0 &&
        typeof json.dxyDailyChangePct === 'number' &&
        Number.isFinite(json.dxyDailyChangePct)
        ? 'LIVE'
        : 'UNAVAILABLE';
      const dxyIndex = dxyStatus === 'LIVE' ? json.dxyIndex : null;
      const dxyDailyChangePct = dxyStatus === 'LIVE' ? json.dxyDailyChangePct : null;

      const fearAndGreedStatus: MetricDataStatus = json.fearAndGreedStatus === 'LIVE' &&
        typeof json.fearAndGreedIndex === 'number' &&
        Number.isInteger(json.fearAndGreedIndex) &&
        json.fearAndGreedIndex >= 0 &&
        json.fearAndGreedIndex <= 100
        ? 'LIVE'
        : 'UNAVAILABLE';
      const fearAndGreedIndex = fearAndGreedStatus === 'LIVE' ? json.fearAndGreedIndex : null;
      const fearAndGreedLabelFa = fearAndGreedStatus === 'LIVE' ? (json.fearAndGreedLabelFa || `${fearAndGreedIndex}`) : 'UNAVAILABLE';

      const etfFlowStatus: MetricDataStatus = json.etfFlowStatus === 'LIVE' &&
        typeof json.spotEtfNetInflowMillionUsd === 'number' &&
        Number.isFinite(json.spotEtfNetInflowMillionUsd)
        ? 'LIVE'
        : 'UNAVAILABLE';
      const spotEtfNetInflowMillionUsd = etfFlowStatus === 'LIVE' ? json.spotEtfNetInflowMillionUsd : null;

      const fedExpectationsStatus: MetricDataStatus = json.fedExpectationsStatus === 'LIVE' &&
        typeof json.fedRateCutExpectationPct === 'number' &&
        Number.isFinite(json.fedRateCutExpectationPct) &&
        json.fedRateCutExpectationPct >= 0 &&
        json.fedRateCutExpectationPct <= 100
        ? 'LIVE'
        : 'UNAVAILABLE';
      const fedRateCutExpectationPct = fedExpectationsStatus === 'LIVE' ? json.fedRateCutExpectationPct : null;

      const recentHeadlines: BitcoinNewsItem[] = Array.isArray(json.recentHeadlines)
        ? json.recentHeadlines.filter((item: unknown): item is BitcoinNewsItem =>
          typeof item === 'object' && item !== null &&
          'id' in item && typeof item.id === 'string' &&
          'headline' in item && typeof item.headline === 'string' &&
          'source' in item && typeof item.source === 'string' &&
          'url' in item && typeof item.url === 'string' &&
          'publishedAt' in item && typeof item.publishedAt === 'string' &&
          Number.isFinite(Date.parse(item.publishedAt)) &&
          (() => {
            try {
              return new URL(item.url).protocol === 'https:';
            } catch {
              return false;
            }
          })()
        )
        : [];
      const newsHeadlinesStatus: MetricDataStatus =
        json.newsHeadlinesStatus === 'LIVE' && recentHeadlines.length > 0 ? 'LIVE' : 'UNAVAILABLE';
      const newsSentimentStatus: MetricDataStatus = 'UNAVAILABLE';
      const newsSentimentScore = null;

      const whaleFlowStatus: MetricDataStatus = json.whaleFlowStatus === 'LIVE' &&
        typeof json.whaleNetflowBtc === 'number' &&
        Number.isFinite(json.whaleNetflowBtc) &&
        typeof json.whalePressureIndex === 'number' &&
        Number.isFinite(json.whalePressureIndex) &&
        json.whalePressureIndex >= 0 &&
        json.whalePressureIndex <= 100 &&
        ['ACCUMULATION', 'DISTRIBUTION', 'NEUTRAL'].includes(json.whaleSentiment)
        ? 'LIVE'
        : 'UNKNOWN';
      const whaleNetflowBtc = whaleFlowStatus === 'LIVE' ? json.whaleNetflowBtc : null;
      const whalePressureIndex = whaleFlowStatus === 'LIVE' ? json.whalePressureIndex : null;
      const whaleSentiment = whaleFlowStatus === 'LIVE' ? json.whaleSentiment : 'UNKNOWN';

      // Overall status: LIVE if at least 2 key macro indicators are LIVE, else UNAVAILABLE
      const liveMetricsCount = [
        sp500Status === 'LIVE',
        dxyStatus === 'LIVE',
        fearAndGreedStatus === 'LIVE',
        etfFlowStatus === 'LIVE',
        newsSentimentStatus === 'LIVE',
        whaleFlowStatus === 'LIVE',
      ].filter(Boolean).length;

      const overallDataStatus: MetricDataStatus = liveMetricsCount >= 2 ? 'LIVE' : 'UNAVAILABLE';

      // Evaluate correlations and macro filter
      let btcCorrelationWithSP500: number | null = null;
      let btcCorrelationWithDXY: number | null = null;
      let macroFilterStatus: MacroCorrelationData['macroFilterStatus'] = 'UNAVAILABLE';
      let macroFilterStatusFa = '⚠️ وضعیت داده‌های ماکرو: UNAVAILABLE (قطع منبع داده زنده).';
      let isTradeApprovedByMacro = false;

      if (sp500Status === 'LIVE' && dxyStatus === 'LIVE' && sp500DailyChangePct !== null && dxyDailyChangePct !== null) {
        const isSP500Bullish = sp500DailyChangePct > 0;
        const isDXYBearish = dxyDailyChangePct < 0;

        if (isSP500Bullish && isDXYBearish) {
          macroFilterStatus = 'BULLISH_CONFIRMED';
          macroFilterStatusFa = `🚀 تاییدیه ماکرو: صعود S&P 500 (+${sp500DailyChangePct}%) و افت DXY (${dxyDailyChangePct}%). جریان نقدینگی جهانی به نفع بیت‌کوین تایید شد.`;
          isTradeApprovedByMacro = true;
        } else if (!isSP500Bullish && !isDXYBearish) {
          macroFilterStatus = 'BEARISH_CONFIRMED';
          macroFilterStatusFa = `🛑 هشدار ماکرو: افت شاخص S&P 500 (${sp500DailyChangePct}%) همزمان با تقویت دلار DXY (+${dxyDailyChangePct}%).`;
          isTradeApprovedByMacro = false;
        } else {
          macroFilterStatus = 'RISK_OFF_HOLD';
          macroFilterStatusFa = '⚠️ عدم قطعیت ماکرو: عدم همگرایی شاخص دلار و بازارهای مالی. حالت احتیاط و بافر ریسک.';
          isTradeApprovedByMacro = false;
        }
      } else {
        macroFilterStatus = 'UNAVAILABLE';
        macroFilterStatusFa = '⚠️ وضعیت داده‌های ماکرو: UNAVAILABLE (قطع اتصال زنده به بورس آمریکا یا دلار). هیچ فرض کاذبی اعمال نشد.';
        isTradeApprovedByMacro = false;
      }

      // Fundamental score calculation ONLY from live valid numbers
      let fundamentalScorePct: number | null = null;
      let fundamentalBias: MacroCorrelationData['fundamentalBias'] = 'UNAVAILABLE';
      let breakingNewsImpactLevel: MacroCorrelationData['breakingNewsImpactLevel'] = 'UNAVAILABLE';
      let breakingNewsActionDirectiveFa = 'داده‌های خبری در وضعیت UNAVAILABLE است.';
      let emergencyDefensiveShield = false;
      let runnerExpansionBoost = false;

      if (
        newsSentimentStatus === 'LIVE' &&
        newsSentimentScore !== null &&
        fearAndGreedStatus === 'LIVE' &&
        fearAndGreedIndex !== null &&
        etfFlowStatus === 'LIVE' &&
        spotEtfNetInflowMillionUsd !== null
      ) {
        const fgScore = fearAndGreedIndex;
        const etfScore = spotEtfNetInflowMillionUsd > 0 ? 30 : 5;
        fundamentalScorePct = Math.round((newsSentimentScore * 0.4) + (fgScore * 0.3) + etfScore);
        fundamentalBias = fundamentalScorePct >= 65 ? 'BULLISH' : fundamentalScorePct <= 40 ? 'BEARISH' : 'NEUTRAL';

        if (newsSentimentScore >= 70) {
          breakingNewsImpactLevel = 'STRONG_BULLISH_CATALYST';
          breakingNewsActionDirectiveFa = '🔥 محرک خبری سنگین صعودی: پتانسیل جهش قیمت و اتساع تارگت‌ها.';
          runnerExpansionBoost = true;
        } else if (newsSentimentScore <= -60) {
          breakingNewsImpactLevel = 'SEVERE_BEARISH_THREAT';
          breakingNewsActionDirectiveFa = '🛑 تهدید خبری شدید: فعال‌سازی شیلد دفاعی و محافظت فوری از استاپ‌ها.';
          emergencyDefensiveShield = true;
        } else {
          breakingNewsImpactLevel = 'NORMAL_NEWS_FLOW';
          breakingNewsActionDirectiveFa = 'جریان اخبار در محدوده نرمال بازار.';
        }
      }

      this.currentData = {
        overallDataStatus,
        lastUpdatedTime: now,
        lastUpdatedStr: json.lastUpdated || new Date().toLocaleTimeString('fa-IR'),
        provenance: typeof json.provenance === 'object' && json.provenance !== null ? json.provenance : {},

        sp500Status,
        sp500Price,
        sp500DailyChangePct,

        dxyStatus,
        dxyIndex,
        dxyDailyChangePct,

        fearAndGreedStatus,
        fearAndGreedIndex,
        fearAndGreedLabelFa,

        etfFlowStatus,
        spotEtfNetInflowMillionUsd,

        fedExpectationsStatus,
        fedRateCutExpectationPct,

        newsSentimentStatus,
        newsSentimentScore,
        newsHeadlinesStatus,
        recentHeadlines,

        whaleFlowStatus,
        whaleNetflowBtc,
        whalePressureIndex,
        whaleSentiment,

        btcCorrelationWithSP500,
        btcCorrelationWithDXY,
        macroFilterStatus,
        macroFilterStatusFa,
        isTradeApprovedByMacro,
        fundamentalScorePct,
        fundamentalBias,
        breakingNewsImpactLevel,
        breakingNewsActionDirectiveFa,
        emergencyDefensiveShield,
        runnerExpansionBoost,
      };

      return this.currentData;
    } catch {
      this.currentData = createDefaultUnavailableState();
      return this.currentData;
    } finally {
      this.isFetching = false;
    }
  }
}

export const macroContextBrainService = MacroContextBrainService.getInstance();
