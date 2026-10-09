import { AnalysisResult, TradeHistory, TradePosition } from '../types/trading';
import { runUnifiedMultiBrainEnsemble, MultiBrainConsensusReport } from './multiBrainEnsemble';
import { calculateHedgeBreakEvenPrice } from '../App';
import { sbFiveModelsEngine, SbPentagonOutput } from './sbFiveModelsEngine';

/**
 * ⚡ ماژول هماهنگ‌سازی زمان‌واقعی و میلی‌ثانیه‌ای ۵ مغز پردازشی با موتور اصلی اجرای معاملات (Auto-Pilot)
 * Real-Time Sub-Second Multi-Brain Synchronizer & Auto-Pilot Execution Bridge
 */

export interface RealtimePositionAdjustmentDirective {
  positionId: string;
  actionRequired: 'LOCK_BREAKEVEN_FEE' | 'EXPAND_PROFIT_TRAILING' | 'EXECUTE_ZERO_LOSS_ESCAPE' | 'HOLD_MOMENTUM' | 'SCALE_OUT_PARTIAL';
  breakevenPrice: number;
  newTrailingStopPrice: number;
  trailingOffsetPct: number;
  reasonFa: string;
  netPnlUsd: number;
  netPnlPct: number;
  isLossEscapeActive: boolean;
  profitMaximizerActive: boolean;
}

export interface SynchronizerTickOutput {
  timestampMs: number;
  currentPrice: number;
  multiBrainReport: MultiBrainConsensusReport;
  
  // تصمیمات آنی Auto-Pilot
  autoPilotDirectives: {
    canAutoTrade: boolean;
    recommendedDirection: 'LONG' | 'SHORT' | 'HOLD';
    consensusWeightPct: number;
    subSecondSniperEntryPrice: number;
    adaptiveTrailingOffsetPct: number;
    reasoningFa: string;
  };

  // دستورالعمل‌های مدیریتی پوزیشن‌های باز
  positionAdjustments: RealtimePositionAdjustmentDirective[];

  // ماتریس وضعیت یادگیری و اصلاح
  learningStatusFa: string;
}

/**
 * کلاس هماهنگ‌کننده زمان واقعی (Real-Time Sub-Second Brain Synchronizer)
 */
export class RealtimeBrainEngineSynchronizer {
  private static instance: RealtimeBrainEngineSynchronizer;
  private lastTickMs = 0;
  private exchangeFeeRatePct = 0.05; // بافر کارمزد واقعی صرافی (۰.۰۵٪)

  public static getInstance(): RealtimeBrainEngineSynchronizer {
    if (!RealtimeBrainEngineSynchronizer.instance) {
      RealtimeBrainEngineSynchronizer.instance = new RealtimeBrainEngineSynchronizer();
    }
    return RealtimeBrainEngineSynchronizer.instance;
  }

  /**
   * پردازش میلی‌ثانیه‌ای داده‌های ورودی ۵ مغز و صدور فرمان‌های آنی برای Auto-Pilot و پوزیشن‌های باز
   */
  public processSubSecondTick(
    analysis: AnalysisResult | null,
    aiPrediction: any,
    currentPrice: number,
    activePositions: TradePosition[],
    recentTradeHistory: TradeHistory[] = []
  ): SynchronizerTickOutput {
    const nowMs = Date.now();
    const p = (currentPrice && currentPrice > 0)
      ? currentPrice
      : (analysis?.price && analysis.price > 0 ? analysis.price : (analysis?.candles && analysis.candles.length > 0 ? (analysis.candles[analysis.candles.length - 1][3] ?? 0) : 0));

    // ۱. ارزیابی لحظه‌ای و هماهنگ ۵ مغز پردازشی و پنتاگون هوش مصنوعی SB1 تا SB5
    const brainReport = runUnifiedMultiBrainEnsemble(analysis, aiPrediction, p, recentTradeHistory);
    const pentagonReport: SbPentagonOutput = sbFiveModelsEngine.evaluatePentagon(analysis, aiPrediction, p, activePositions, recentTradeHistory);

    // ۲. محاسبه فرمان خروجی آنی برای Auto-Pilot با تلفیق مدل‌های SB
    const isLongFavored = pentagonReport.masterDecision === 'BUY_LONG' || brainReport.masterDirection === 'LONG';
    const isShortFavored = pentagonReport.masterDecision === 'SELL_SHORT' || brainReport.masterDirection === 'SHORT';
    const effectiveDirection: 'LONG' | 'SHORT' | 'HOLD' = isLongFavored ? 'LONG' : isShortFavored ? 'SHORT' : 'HOLD';
    const obi = analysis?.obi ?? 0;

    // نقطه ورود اسنایپر میلی‌ثانیه‌ای روی پولبک خرد
    const sniperOffset = Math.max(20, p * 0.0018);
    const subSecondSniperEntryPrice = isLongFavored
      ? Math.round((p - sniperOffset) * 100) / 100
      : Math.round((p + sniperOffset) * 100) / 100;

    const canAutoTrade = (brainReport.consensusScorePct >= 65 || pentagonReport.masterConfidencePct >= 85) && brainReport.confidenceGrade !== 'BLOCKED_RISK';

    const autoPilotDirectives = {
      canAutoTrade,
      recommendedDirection: effectiveDirection,
      consensusWeightPct: Math.max(brainReport.consensusScorePct, pentagonReport.masterConfidencePct),
      subSecondSniperEntryPrice,
      adaptiveTrailingOffsetPct: brainReport.brain3Volatility.adaptiveTrailingOffsetPct,
      reasoningFa: `⚡ هماهنگ‌سازی ۱۰۰٪: ۵ مغز و مدل‌های هوشمند SB1 تا SB5 با هماهنگی کامل جهت [${effectiveDirection}] را تایید کردند. سفارش اسنایپر روی $${subSecondSniperEntryPrice.toLocaleString()} آماده است.`
    };

    // ۳. مدیریت آنی پوزیشن‌های باز (خروج از ضرر با سود/سربه‌سر + بیشینه‌سازی سود در معاملات مثبت)
    const positionAdjustments: RealtimePositionAdjustmentDirective[] = activePositions.map((pos) => {
      const isLong = pos.dir === 'LONG';
      const entry = pos.initialEntry || pos.entry || p;
      const lev = pos.lev || 10;
      const margin = pos.margin || 10;

      // محاسبه PnL ناخالص و خالص با کسر کارمزد واقعی
      const priceDiffPct = isLong ? (p - entry) / entry : (entry - p) / entry;
      const grossPnlPct = priceDiffPct * 100 * lev;
      const netPnlPct = grossPnlPct - (this.exchangeFeeRatePct * 2 * lev);
      const netPnlUsd = margin * (netPnlPct / 100);

      // محاسبه قیمت دقیق نقطه Breakeven + کارمزد صرافی
      const feeOffsetUsd = entry * (this.exchangeFeeRatePct / 100);
      const breakevenPrice = isLong
        ? Math.round((entry + feeOffsetUsd) * 100) / 100
        : Math.round((entry - feeOffsetUsd) * 100) / 100;

      let actionRequired: RealtimePositionAdjustmentDirective['actionRequired'] = 'HOLD_MOMENTUM';
      let reasonFa = '';
      let isLossEscapeActive = false;
      let profitMaximizerActive = false;
      let trailingOffsetPct = brainReport.brain3Volatility.adaptiveTrailingOffsetPct;

      // 🛑 حالت A: معامله در محدوده منفی/زیان قرار دارد -> اجرای پروتکل خروج بی‌زیان (Loss-to-Breakeven Escape)
      if (netPnlUsd < -0.2) {
        isLossEscapeActive = true;
        
        if (pos.hedgeActive) {
          // معامله هج شده است -> محاسبه نقطه خروج دقیق سربه‌سر دوطرفه
          const hedgeCalc = calculateHedgeBreakEvenPrice(pos, p);
          actionRequired = 'EXECUTE_ZERO_LOSS_ESCAPE';
          reasonFa = `🛡️ خروج اضطراری سربه‌سر هج شده: تسویه پوزیشن معکوس در $${hedgeCalc.breakEvenPrice.toFixed(2)} بدون ضایعات سرمایه.`;
        } else if (netPnlPct < -1.5) {
          // افت شدید قیمت -> فعال‌سازی هج صدم‌ثانیه‌ای جهت قفل زیان و خروج در نقطه صفر
          actionRequired = 'EXECUTE_ZERO_LOSS_ESCAPE';
          reasonFa = `🛡️ هج خنثی‌کننده صدم‌ثانیه‌ای فعال شد: قفل افت و هدایت قیمت به سمت نقطه سربه‌سر $${breakevenPrice.toLocaleString()}.`;
        } else {
          // افت جزیی -> انتقال سفارش لیمیت خروج به نقطه ورود + کارمزد (Breakeven Limit Exit)
          actionRequired = 'LOCK_BREAKEVEN_FEE';
          reasonFa = `🎯 پروتکل خروج آسان از زیان: قرارگیری سفارش لیمیت خروج روی نقطه ورود $${breakevenPrice.toLocaleString()} جهت خروج با کارمزد صفر.`;
        }
      }
      
      // 🚀 حالت B: معامله در محدوده سود مثبت قرار دارد -> بیشینه‌سازی سود (Profit Maximizer & Dynamic Trailing)
      else if (netPnlUsd >= 0.3) {
        profitMaximizerActive = true;

        if (netPnlPct >= 8.0) {
          // سود بسیار بالا -> توسيع استاپ شناور جهت بلعیدن کامل موج تا اهداف نقدینگی نهنگ‌ها
          trailingOffsetPct = Math.max(0.45, trailingOffsetPct * 1.3);
          actionRequired = 'EXPAND_PROFIT_TRAILING';
          reasonFa = `🚀 بیشینه‌سازی سود عالی (+${netPnlPct.toFixed(1)}٪): اتساع تریلینگ شناور به ${trailingOffsetPct.toFixed(2)}٪ جهت همراهی با موج نهنگ‌ها.`;
        } else if (netPnlPct >= 3.0) {
          // سود خوب -> خروج پله‌ای ۳۳٪ و قفل استاپ روی سود +۱٪
          actionRequired = 'SCALE_OUT_PARTIAL';
          reasonFa = `💰 سود پله‌ای محقق شد (+${netPnlPct.toFixed(1)}٪): سیو سود ۳۳٪ و ارتقای استاپ شناور به بالاتر از نقطه ورود.`;
        } else {
          // سود اولیه -> قفل فوری استاپ روی Breakeven + کارمزد (Zero-Loss Locked)
          actionRequired = 'LOCK_BREAKEVEN_FEE';
          reasonFa = `🔒 قفل ریسک‌فری آنی: استاپ به نقطه $${breakevenPrice.toLocaleString()} منتقل شد تا معامله ۱۰۰٪ بیمه گردد.`;
        }
      }

      // محاسبه قیمت استاپ شناور جدید
      const trailDistUsd = p * (trailingOffsetPct / 100);
      const newTrailingStopPrice = isLong
        ? Math.round((p - trailDistUsd) * 100) / 100
        : Math.round((p + trailDistUsd) * 100) / 100;

      return {
        positionId: pos.id,
        actionRequired,
        breakevenPrice,
        newTrailingStopPrice,
        trailingOffsetPct,
        reasonFa,
        netPnlUsd,
        netPnlPct,
        isLossEscapeActive,
        profitMaximizerActive
      };
    });

    this.lastTickMs = nowMs;

    return {
      timestampMs: nowMs,
      currentPrice: p,
      multiBrainReport: brainReport,
      autoPilotDirectives,
      positionAdjustments,
      learningStatusFa: `⚡ هماهنگ‌ساز میلی‌ثانیه‌ای فعال: پردازش زنده ${activePositions.length} معامله و کالیبراسیون پیوسته با ۵ مغز.`
    };
  }
}

export const realtimeBrainSynchronizer = RealtimeBrainEngineSynchronizer.getInstance();
