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
  public auditMarketDataIntegrity(analysis: AnalysisResult | null | undefined): DataFeedIntegrityReport {
    const now = Date.now();
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

    // 1. Ticker / Live Price (CRITICAL) - Item 50
    const hasPrice = typeof analysis.price === 'number' && analysis.price > 1000 && !isNaN(analysis.price);
    features.push({
      featureKey: 'TICKER_PRICE',
      nameFa: 'قیمت زنده تیکر (Last Price)',
      importance: 'CRITICAL',
      status: hasPrice ? 'VALID' : 'UNKNOWN',
      valueRepr: hasPrice ? `$${analysis.price}` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasPrice ? 'داده قیمت تیکر با کیفیت زنده دریافت شد.' : 'قیمت تیکر مفقود یا نامعتبر است (UNKNOWN).',
    });

    // 2. Order Book Depth & OBI (CRITICAL) - Item 51: OBI missing is NOT OBI=0
    const rawObi = analysis.obi;
    const isObiPresent = rawObi !== undefined && rawObi !== null && typeof rawObi === 'number' && !isNaN(rawObi);
    features.push({
      featureKey: 'ORDER_BOOK_OBI',
      nameFa: 'عدم‌توازن دفتر سفارشات (OBI)',
      importance: 'CRITICAL',
      status: isObiPresent ? 'VALID' : 'UNKNOWN',
      valueRepr: isObiPresent ? `${rawObi > 0 ? '+' : ''}${rawObi.toFixed(2)}` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: isObiPresent
        ? `عمق دفتر سفارشات دریافت شد (OBI = ${rawObi.toFixed(2)}).`
        : '🛑 عمق اردر بوک در دسترس نیست و نباید با ۰ (تعادل فرضی) جایگزین شود (UNKNOWN).',
    });

    // 3. Derivatives Funding Rate & OI (CRITICAL) - Item 52
    const rawFunding = analysis.fundingRate ?? analysis.funding;
    const isFundingPresent = rawFunding !== undefined && rawFunding !== null && typeof rawFunding === 'number' && !isNaN(rawFunding);
    features.push({
      featureKey: 'DERIVATIVES_FUNDING_OI',
      nameFa: 'داده‌های مشتقه و فاندینگ ریت',
      importance: 'CRITICAL',
      status: isFundingPresent ? 'VALID' : 'UNKNOWN',
      valueRepr: isFundingPresent ? `${(rawFunding * 100).toFixed(4)}%` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: isFundingPresent
        ? `فاندینگ ریت اوراق مشتقه دریافت شد (${(rawFunding * 100).toFixed(4)}٪).`
        : '🛑 داده فاندینگ ریت یا بهره باز قطع است؛ صفر به عنوان مقدار واقعی وارد Prediction نمی‌شود (UNKNOWN).',
    });

    // 4. Volatility / ATR / GARCH (CRITICAL)
    const hasAtr = typeof analysis.atr === 'number' && analysis.atr > 0 && !isNaN(analysis.atr);
    features.push({
      featureKey: 'VOLATILITY_ATR',
      nameFa: 'شاخص نوسانات بازار (ATR/GARCH)',
      importance: 'CRITICAL',
      status: hasAtr ? 'VALID' : 'UNKNOWN',
      valueRepr: hasAtr ? `$${analysis.atr.toFixed(1)}` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasAtr ? 'نوسان‌سنج فعال است.' : 'نوسان ATR نامشخص است (UNKNOWN). ریسک پوزیشن بدون نوسان قابل محاسبه نیست.',
    });

    // 5. Calibrated Probability (CRITICAL) - Item 57
    const rawProb = analysis.calibratedWinProbability;
    const hasCalibratedProb = rawProb !== null && rawProb !== undefined && !isNaN(rawProb);
    features.push({
      featureKey: 'CALIBRATED_PROBABILITY',
      nameFa: 'احتمال کالیبره‌شده آماری',
      importance: 'CRITICAL',
      status: hasCalibratedProb ? 'VALID' : 'UNKNOWN',
      valueRepr: hasCalibratedProb ? `${((rawProb as number) * 100).toFixed(1)}%` : 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasCalibratedProb ? 'احتمال کالیبره‌شده تایید گردید.' : 'احتمال کالیبره‌شده مفقود است (UNKNOWN). معامله در حالت احتمال فرضی مسدود است.',
    });

    // 6. Market Regime Classification (CRITICAL)
    const regimeVal = (analysis as any).regime || (analysis as any).marketRegime || analysis.regimeClassification?.activeRegime;
    const hasRegime = Boolean(regimeVal);
    features.push({
      featureKey: 'MARKET_REGIME',
      nameFa: 'رژیم طبقه‌بندی‌شده بازار',
      importance: 'CRITICAL',
      status: hasRegime ? 'VALID' : 'UNKNOWN',
      valueRepr: regimeVal || 'UNKNOWN',
      isFatalIfMissing: true,
      diagnosticFa: hasRegime ? 'رژیم بازار شناسایی شده است.' : 'رژیم بازار مشخص نیست (UNKNOWN).',
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

    const isSynthetic = analysis.dataStatus === 'SIMULATED' ||
      (analysis as any)?.__isSynthetic === true ||
      (analysis as any)?.__isSyntheticUnsafeForLive__ === true ||
      (analysis as any)?.__isLiveSafe === false;

    const isTradePermitted = missingCriticals.length === 0 &&
      analysis.dataStatus !== 'DATA_UNAVAILABLE' &&
      analysis.dataStatus !== 'UNAVAILABLE' &&
      !isSynthetic;
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
