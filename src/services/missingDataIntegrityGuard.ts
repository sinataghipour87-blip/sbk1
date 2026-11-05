/**
 * 🛡️ Missing Data Integrity Guard (Item 50)
 * 
 * Enforces zero-compromise data feed validation:
 * - Distinguishes UNKNOWN / DATA_UNAVAILABLE from numerical 0.
 * - Categorizes features into CRITICAL vs NON_CRITICAL.
 * - Strictly blocks trade generation if ANY critical feature is missing or corrupt.
 */

import { AnalysisResult, FeedStatus } from '../types/trading';

export type FeatureImportance = 'CRITICAL' | 'NON_CRITICAL';
export type FeatureStatus3State = 'VALID' | 'STALE' | 'UNKNOWN';

export interface FeatureAuditItem {
  featureKey: string;
  nameFa: string;
  importance: FeatureImportance;
  status: FeatureStatus3State;
  valueRepr: string;
  isFatalIfMissing: boolean;
  diagnosticFa: string;
}

export interface DataFeedIntegrityReport {
  isTradePermitted: boolean;
  overallFeedHealthPct: number;
  criticalFeaturesAvailable: boolean;
  missingCriticalCount: number;
  features: FeatureAuditItem[];
  blockReasonFa?: string;
  evaluatedAt: number;
}

export class MissingDataIntegrityGuardService {
  private static instance: MissingDataIntegrityGuardService;

  public static getInstance(): MissingDataIntegrityGuardService {
    if (!MissingDataIntegrityGuardService.instance) {
      MissingDataIntegrityGuardService.instance = new MissingDataIntegrityGuardService();
    }
    return MissingDataIntegrityGuardService.instance;
  }

  /**
   * Audits market data feed completeness and flags UNKNOWN states (Items 50, 51, 52)
   */
  public auditMarketDataIntegrity(
    analysis: AnalysisResult | null | undefined,
    options: { allowDemoData?: boolean } = {},
  ): DataFeedIntegrityReport {
    const now = Date.now();
    const allowDemoData = options.allowDemoData === true;
    const features: FeatureAuditItem[] = [];

    if (!analysis) {
      return {
        isTradePermitted: false,
        overallFeedHealthPct: 0,
        criticalFeaturesAvailable: false,
        missingCriticalCount: 6,
        features: [],
        blockReasonFa: '🛑 کل ساختار تحلیل و داده‌های بازار در دسترس نیست (NULL_ANALYSIS).',
        evaluatedAt: now,
      };
    }

    const snapshotTimestamp = analysis.canonicalSnapshot?.timestampUtc;
    const snapshotAgeMs = typeof snapshotTimestamp === 'number' ? now - snapshotTimestamp : Number.POSITIVE_INFINITY;
    const candleFeedTimestamp = analysis.dataQualityReport?.feeds?.candles?.timestamp;
    const observedAtMs = Number.isFinite(snapshotTimestamp) ? snapshotTimestamp : candleFeedTimestamp;
    const observedAgeMs = typeof observedAtMs === 'number' ? now - observedAtMs : Number.POSITIVE_INFINITY;
    const sourceIsLive = analysis.dataStatus === 'LIVE' ||
      analysis.dataStatus === 'VERIFIED_REALTIME' ||
      (allowDemoData && analysis.dataStatus === 'SIMULATED');
    const validDemoCandles = Array.isArray(analysis.candles) &&
      analysis.candles.length >= 30 &&
      analysis.candles.every(([open, high, low, close, volume]) =>
        [open, high, low, close].every((value) => Number.isFinite(value) && value > 0) &&
        high >= Math.max(open, low, close) &&
        low <= Math.min(open, high, close) &&
        (volume === undefined || (Number.isFinite(volume) && volume >= 0))
      );
    const demoProvenanceValid = allowDemoData &&
      sourceIsLive &&
      validDemoCandles &&
      Number.isFinite(analysis.price) &&
      analysis.price > 0 &&
      Number.isFinite(analysis.atr) &&
      analysis.atr > 0 &&
      observedAgeMs >= -1_000 &&
      observedAgeMs <= 15_000;
    const provenanceValid = allowDemoData
      ? demoProvenanceValid
      : sourceIsLive &&
        Number.isFinite(snapshotAgeMs) &&
        snapshotAgeMs >= 0 &&
        snapshotAgeMs <= 15000 &&
        analysis.dataQualityReport?.status === 'LIVE' &&
        analysis.dataQualityReport.isTradeAllowed === true;
    const auditAgeMs = allowDemoData ? observedAgeMs : snapshotAgeMs;
    const validityFor = (hasValue: boolean): FeatureStatus3State =>
      !sourceIsLive || auditAgeMs < 0 || auditAgeMs > 15000
        ? 'STALE'
        : hasValue
          ? 'VALID'
          : 'UNKNOWN';

    // 1. Ticker / Live Price (CRITICAL) - Item 50
    const hasPrice = typeof analysis.price === 'number' && Number.isFinite(analysis.price) && analysis.price > 0;
    features.push({
      featureKey: 'TICKER_PRICE',
      nameFa: 'قیمت زنده تیکر (Last Price)',
      importance: 'CRITICAL',
      status: validityFor(hasPrice),
      valueRepr: hasPrice ? `$${analysis.price}` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasPrice ? 'داده قیمت تیکر با کیفیت زنده دریافت شد.' : 'قیمت تیکر مفقود یا نامعتبر است (UNKNOWN).',
    });

    // 2. Order Book Depth & OBI (CRITICAL) - Item 51: OBI missing is NOT OBI=0
    const rawObi = analysis.obi;
    const isObiPresent = typeof rawObi === 'number' && Number.isFinite(rawObi) && rawObi >= -1 && rawObi <= 1;
    features.push({
      featureKey: 'ORDER_BOOK_OBI',
      nameFa: 'عدم‌توازن دفتر سفارشات (OBI)',
      importance: 'CRITICAL',
      status: validityFor(isObiPresent),
      valueRepr: isObiPresent ? `${rawObi > 0 ? '+' : ''}${rawObi.toFixed(2)}` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: isObiPresent
        ? `عمق دفتر سفارشات دریافت شد (OBI = ${rawObi.toFixed(2)}).`
        : '🛑 عمق اردر بوک در دسترس نیست و نباید با ۰ (تعادل فرضی) جایگزین شود (UNKNOWN).',
    });

    // 3. Derivatives Funding Rate & OI (CRITICAL) - Item 52
    const rawFunding = analysis.fundingRate ?? analysis.funding;
    const isFundingPresent = typeof rawFunding === 'number' && Number.isFinite(rawFunding);
    features.push({
      featureKey: 'DERIVATIVES_FUNDING',
      nameFa: 'نرخ Funding مشتقه',
      importance: 'CRITICAL',
      status: validityFor(isFundingPresent),
      valueRepr: isFundingPresent ? `${(rawFunding * 100).toFixed(4)}%` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: isFundingPresent
        ? `فاندینگ ریت اوراق مشتقه دریافت شد (${(rawFunding * 100).toFixed(4)}٪).`
        : '🛑 داده فاندینگ ریت یا بهره باز قطع است؛ صفر به عنوان مقدار واقعی وارد Prediction نمی‌شود (UNKNOWN).',
    });

    const hasOpenInterest = typeof analysis.oi === 'number' && Number.isFinite(analysis.oi) && analysis.oi > 0;
    features.push({
      featureKey: 'DERIVATIVES_OPEN_INTEREST',
      nameFa: 'بهره باز (Open Interest)',
      importance: 'CRITICAL',
      status: validityFor(hasOpenInterest),
      valueRepr: hasOpenInterest ? String(analysis.oi) : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasOpenInterest ? 'داده Open Interest موجود است.' : 'Open Interest معتبر از منبع پشتیبانی‌شده موجود نیست.',
    });

    // 4. Volatility / ATR / GARCH (CRITICAL)
    const hasAtr = typeof analysis.atr === 'number' && Number.isFinite(analysis.atr) && analysis.atr > 0;
    features.push({
      featureKey: 'VOLATILITY_ATR',
      nameFa: 'شاخص نوسانات بازار (ATR/GARCH)',
      importance: 'CRITICAL',
      status: validityFor(hasAtr),
      valueRepr: hasAtr ? `$${analysis.atr.toFixed(1)}` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasAtr ? 'نوسان‌سنج فعال است.' : 'نوسان ATR نامشخص است (UNKNOWN). ریسک پوزیشن بدون نوسان قابل محاسبه نیست.',
    });

    // 5. Calibrated Probability (CRITICAL) - Item 57
    const rawProb = analysis.calibratedWinProbability;
    const hasCalibratedProb = typeof rawProb === 'number' &&
      Number.isFinite(rawProb) &&
      rawProb >= 0 &&
      rawProb <= 1 &&
      analysis.calibratedMetadata?.isCalibrationVerified === true &&
      analysis.calibratedMetadata.dataSufficient === true;
    features.push({
      featureKey: 'CALIBRATED_PROBABILITY',
      nameFa: 'احتمال کالیبره‌شده آماری',
      importance: 'CRITICAL',
      status: validityFor(hasCalibratedProb),
      valueRepr: hasCalibratedProb ? `${((rawProb as number) * 100).toFixed(1)}%` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasCalibratedProb ? 'احتمال کالیبره‌شده تایید گردید.' : 'احتمال کالیبره‌شده مفقود است (UNKNOWN). معامله در حالت احتمال فرضی مسدود است.',
    });

    // 6. Market Regime Classification (CRITICAL)
    const regimeVal = analysis.regimeClassification?.activeRegime ?? analysis.marketRegime;
    const hasRegime = typeof regimeVal === 'string' &&
      regimeVal.trim().length > 0 &&
      !['UNKNOWN', 'UNAVAILABLE', 'UNCLASSIFIED'].includes(regimeVal.toUpperCase());
    features.push({
      featureKey: 'MARKET_REGIME',
      nameFa: 'رژیم طبقه‌بندی‌شده بازار',
      importance: 'CRITICAL',
      status: validityFor(hasRegime),
      valueRepr: regimeVal || 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasRegime ? 'رژیم بازار شناسایی شده است.' : 'رژیم بازار مشخص نیست (UNKNOWN).',
    });

    features.push({
      featureKey: 'MARKET_DATA_PROVENANCE',
      nameFa: 'اعتبار و تازگی provenance فید بازار',
      importance: 'CRITICAL',
      status: provenanceValid ? 'VALID' : 'UNKNOWN',
      valueRepr: provenanceValid ? `LIVE / ${Math.round(snapshotAgeMs)}ms` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: provenanceValid
        ? 'منبع، وضعیت و زمان snapshot بازار معتبر و تازه هستند.'
        : 'وضعیت فید LIVE، snapshot تازه یا گزارش کیفیت مجاز موجود نیست.',
    });

    // 7. Sentiment Index / Social (NON_CRITICAL)
    const hasSentiment = analysis.fngVal !== undefined || Boolean(analysis.sentiment);
    features.push({
      featureKey: 'SENTIMENT_FEAR_GREED',
      nameFa: 'شاخص ترس و طمع احساسات',
      importance: 'NON_CRITICAL',
      status: hasSentiment ? 'VALID' : 'UNKNOWN',
      valueRepr: analysis.fngVal !== undefined ? `${analysis.fngVal} (${analysis.fngSent || 'N/A'})` : 'UNKNOWN',
      isFatalIfMissing: false,
      diagnosticFa: hasSentiment ? 'احساسات بازار استخراج شد.' : 'داده احساسات ثانویه مفقود است (غیرحیاتی).',
    });

    // Count missing criticals
    const criticals = features.filter(f => f.importance === 'CRITICAL');
    const missingCriticals = criticals.filter(f => f.status === 'UNKNOWN');
    const validCount = features.filter(f => f.status === 'VALID').length;
    const overallFeedHealthPct = Math.round((validCount / features.length) * 100);

    const isSynthetic = (!allowDemoData && analysis.dataStatus === 'SIMULATED') ||
      (analysis as any)?.__isSynthetic === true ||
      (analysis as any)?.__isSyntheticUnsafeForLive__ === true ||
      (analysis as any)?.__isLiveSafe === false;

    const isTradePermitted = missingCriticals.length === 0 && provenanceValid && !isSynthetic;
    let blockReasonFa: string | undefined;

    if (isSynthetic) {
      blockReasonFa = '🛑 توقف معاملات زنده: داده‌های دریافتی از نوع شبیه‌سازی‌شده (SIMULATED) یا آزمایشی هستند. داده‌های مصنوعی فقط در محیط آزمایشگاهی مجازند و هرگز نباید وارد هسته معاملات زنده شوند.';
    } else if (!isTradePermitted) {
      const missingNames = missingCriticals.map(m => m.nameFa).join('، ');
      blockReasonFa = `🛑 توقف معاملات به دلیل تغذیه ناقص داده‌ها: شاخص‌های حیاتی [${missingNames || 'داده نامعتبر'}] در وضعیت UNKNOWN هستند. جایگزینی داده‌های مفقود با صفر اکیداً ممنوع است.`;
    }

    return {
      isTradePermitted,
      overallFeedHealthPct,
      criticalFeaturesAvailable: missingCriticals.length === 0,
      missingCriticalCount: missingCriticals.length,
      features,
      blockReasonFa,
      evaluatedAt: now,
    };
  }
}

export const missingDataIntegrityGuard = MissingDataIntegrityGuardService.getInstance();
