/**
 * 🎯 Centralized Price Source Policy Engine (Item 49)
 * 
 * Defines and enforces the institutional single source of truth for all pricing metrics:
 * - Entry Fill Execution: LAST_PRICE (Real market transaction / matching)
 * - Stop Loss Trigger: MARK_PRICE (Prevents wick liquidation and stop hunting)
 * - Take Profit Trigger: LAST_PRICE / MARK_PRICE
 * - Liquidation Calculation: MARK_PRICE (Exchange standard)
 * - PnL & Unrealized Equity: MARK_PRICE
 * - Derivatives Basis & Fair Value: INDEX_PRICE (Spot composite)
 */

export type PriceSourceType = 'LAST_PRICE' | 'MARK_PRICE' | 'INDEX_PRICE';

export interface PriceContextMap {
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  timestampUtc: number;
  spreadBps?: number;
}

export interface PriceUsagePolicyRule {
  operation: 'ENTRY_FILL' | 'STOP_LOSS_TRIGGER' | 'TAKE_PROFIT_TRIGGER' | 'LIQUIDATION_CALC' | 'PNL_UNREALIZED' | 'DERIVATIVES_FAIR_VALUE';
  requiredSource: PriceSourceType;
  rationaleFa: string;
  maxAllowableMarkLastDivergencePct: number; // e.g. 0.5% max spread between mark & last
}

export const CENTRAL_PRICE_SOURCE_POLICIES: Record<PriceUsagePolicyRule['operation'], PriceUsagePolicyRule> = {
  ENTRY_FILL: {
    operation: 'ENTRY_FILL',
    requiredSource: 'LAST_PRICE',
    rationaleFa: 'قیمت اجرای سفارش ورود باید منحصراً از معاملات واقعی دفتر سفارشات (Last / Fill Price) استخراج شود.',
    maxAllowableMarkLastDivergencePct: 0.35,
  },
  STOP_LOSS_TRIGGER: {
    operation: 'STOP_LOSS_TRIGGER',
    requiredSource: 'MARK_PRICE',
    rationaleFa: 'حد ضرر منحصراً با قیمت مارک (Mark Price) تریگر می‌شود تا از هانت استاپ‌ها توسط شدوهای ساختگی صرافی جلوگیری شود.',
    maxAllowableMarkLastDivergencePct: 0.5,
  },
  TAKE_PROFIT_TRIGGER: {
    operation: 'TAKE_PROFIT_TRIGGER',
    requiredSource: 'LAST_PRICE',
    rationaleFa: 'حد سود با قیمت آخرین معامله (Last Price) جهت تضمین خروج در سقف/کف نقدینگی فعال می‌شود.',
    maxAllowableMarkLastDivergencePct: 0.5,
  },
  LIQUIDATION_CALC: {
    operation: 'LIQUIDATION_CALC',
    requiredSource: 'MARK_PRICE',
    rationaleFa: 'محاسبه فاصله تا لیکوئید شدن مطابق استاندارد جهانی صرافی‌ها بر پایه Mark Price است.',
    maxAllowableMarkLastDivergencePct: 0.75,
  },
  PNL_UNREALIZED: {
    operation: 'PNL_UNREALIZED',
    requiredSource: 'MARK_PRICE',
    rationaleFa: 'محاسبه سود و زیان شناور (uPnL) جهت جلوگیری از خطای ارزش‌گذاری با Mark Price انجام می‌شود.',
    maxAllowableMarkLastDivergencePct: 0.5,
  },
  DERIVATIVES_FAIR_VALUE: {
    operation: 'DERIVATIVES_FAIR_VALUE',
    requiredSource: 'INDEX_PRICE',
    rationaleFa: 'ارزیابی ارزش منصفانه اوراق مشتقه و فاندینگ ریت با Index Price اسپات موزون سنجیده می‌شود.',
    maxAllowableMarkLastDivergencePct: 0.5,
  },
};

export class CentralPriceSourcePolicyService {
  private static instance: CentralPriceSourcePolicyService;

  public static getInstance(): CentralPriceSourcePolicyService {
    if (!CentralPriceSourcePolicyService.instance) {
      CentralPriceSourcePolicyService.instance = new CentralPriceSourcePolicyService();
    }
    return CentralPriceSourcePolicyService.instance;
  }

  /**
   * Resolves the exact compliant price for an operational context
   */
  public getCompliantPrice(
    operation: PriceUsagePolicyRule['operation'],
    prices: PriceContextMap
  ): { price: number; source: PriceSourceType; isDivergenceSafe: boolean; warningFa?: string } {
    const policy = CENTRAL_PRICE_SOURCE_POLICIES[operation];
    let price = prices.lastPrice;

    if (policy.requiredSource === 'MARK_PRICE') {
      price = prices.markPrice && prices.markPrice > 0 ? prices.markPrice : prices.lastPrice;
    } else if (policy.requiredSource === 'INDEX_PRICE') {
      price = prices.indexPrice && prices.indexPrice > 0 ? prices.indexPrice : (prices.markPrice || prices.lastPrice);
    } else {
      price = prices.lastPrice && prices.lastPrice > 0 ? prices.lastPrice : (prices.markPrice && prices.markPrice > 0 ? prices.markPrice : (prices.indexPrice || 0));
    }

    // Mark vs Last divergence check
    let isDivergenceSafe = true;
    let warningFa: string | undefined;

    if (prices.markPrice > 0 && prices.lastPrice > 0) {
      const divergencePct = (Math.abs(prices.markPrice - prices.lastPrice) / prices.markPrice) * 100;
      if (divergencePct > policy.maxAllowableMarkLastDivergencePct) {
        isDivergenceSafe = false;
        warningFa = `⚠️ واگرایی شدید بین Mark Price ($${prices.markPrice}) و Last Price ($${prices.lastPrice}) به میزان ${divergencePct.toFixed(2)}% (بیش از سقف مجاز ${policy.maxAllowableMarkLastDivergencePct}%).`;
      }
    }

    return {
      price: Math.round(price * 100) / 100,
      source: policy.requiredSource,
      isDivergenceSafe,
      warningFa,
    };
  }
}

export const centralPriceSourcePolicy = CentralPriceSourcePolicyService.getInstance();
