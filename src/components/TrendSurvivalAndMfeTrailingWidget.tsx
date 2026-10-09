import React, { useState, useEffect, useMemo } from 'react';
import { 
  trendSurvivalAndMfeTrailingEngine, 
  ComprehensiveTrendAndTrailingState 
} from '../services/trendSurvivalAndMfeTrailingEngine';
import { Shield, Zap, TrendingUp, Activity, Lock, AlertTriangle, CheckCircle, ArrowUpRight, ArrowDownRight, RefreshCw, BarChart2, Layers } from 'lucide-react';

interface Props {
  currentPrice?: number;
  entryPrice?: number;
  direction?: 'LONG' | 'SHORT';
  marginUsd?: number;
  leverage?: number;
  onUpdateStop?: (newStopPrice: number) => void;
}

export const TrendSurvivalAndMfeTrailingWidget: React.FC<Props> = ({
  currentPrice = 88920,
  entryPrice = 87800,
  direction = 'LONG',
  marginUsd = 1000,
  leverage = 5,
  onUpdateStop
}) => {
  const [simDirection, setSimDirection] = useState<'LONG' | 'SHORT'>(direction);
  const [simEntryPrice, setSimEntryPrice] = useState<number>(entryPrice);
  const [simCurrentPrice, setSimCurrentPrice] = useState<number>(currentPrice);
  const [simMfePct, setSimMfePct] = useState<number>(2.4);
  const [simRsi, setSimRsi] = useState<number>(64);
  const [simCvdDelta, setSimCvdDelta] = useState<number>(75);
  const [simObi, setSimObi] = useState<number>(0.24);
  const [simStructureIntact, setSimStructureIntact] = useState<boolean>(true);
  const [isLiveSimulating, setIsLiveSimulating] = useState<boolean>(false);

  // هماهنگی با پروپ‌های ورودی در صورت تغییر
  useEffect(() => {
    if (entryPrice && entryPrice > 0) setSimEntryPrice(entryPrice);
    if (currentPrice && currentPrice > 0) setSimCurrentPrice(currentPrice);
    if (direction) setSimDirection(direction);
  }, [entryPrice, currentPrice, direction]);

  // ارزیابی لحظه‌ای با استفاده از موتور
  const evaluation: ComprehensiveTrendAndTrailingState = useMemo(() => {
    return trendSurvivalAndMfeTrailingEngine.evaluateState({
      direction: simDirection,
      entryPrice: simEntryPrice,
      currentPrice: simCurrentPrice,
      marginUsd,
      leverage,
      mfeAchievedPct: simMfePct,
      rsi: simRsi,
      rsiPrevious: simRsi - 2,
      macdHist: simDirection === 'LONG' ? 1.5 : -1.5,
      macdHistPrevious: simDirection === 'LONG' ? 1.2 : -1.2,
      cvdDelta: simCvdDelta,
      cvdSlope: simCvdDelta > 0 ? 15 : -15,
      orderBookImbalance: simObi,
      isStructureIntact: simStructureIntact,
      atrValue: simCurrentPrice * 0.0072,
      barsInTrade: 14,
      recentSwingProtectionPrice: simDirection === 'LONG' 
        ? simEntryPrice * 1.008 
        : simEntryPrice * 0.992
    });
  }, [simDirection, simEntryPrice, simCurrentPrice, marginUsd, leverage, simMfePct, simRsi, simCvdDelta, simObi, simStructureIntact]);

  // شبیه‌ساز نوسانات زنده مارکت در صورت فعال بودن
  useEffect(() => {
    if (!isLiveSimulating) return;
    const interval = setInterval(() => {
      setSimCurrentPrice(prev => {
        const delta = (Math.random() - 0.45) * 35;
        const nextPrice = Math.round((prev + delta) * 100) / 100;
        const nextDeltaPct = simDirection === 'LONG'
          ? ((nextPrice - simEntryPrice) / simEntryPrice) * 100
          : ((simEntryPrice - nextPrice) / simEntryPrice) * 100;
        if (nextDeltaPct > simMfePct) {
          setSimMfePct(Math.round(nextDeltaPct * 100) / 100);
        }
        return nextPrice;
      });
      setSimRsi(prev => Math.min(85, Math.max(15, prev + (Math.random() - 0.5) * 2)));
    }, 1500);
    return () => clearInterval(interval);
  }, [isLiveSimulating, simDirection, simEntryPrice, simMfePct]);

  const { trendSurvival, mfeTrailing, recommendedCompositeAction } = evaluation;

  // انتخاب رنگ وضعیت بقای روند
  const getSurvivalColor = (prob: number) => {
    if (prob >= 65) return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    if (prob >= 50) return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
    if (prob >= 35) return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
    return 'text-rose-400 border-rose-500/30 bg-rose-500/10';
  };

  const getFactorBadge = (status: 'EXCELLENT' | 'HEALTHY' | 'DEGRADING' | 'FAILED' | 'UNKNOWN') => {
    switch (status) {
      case 'EXCELLENT':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">عالی</span>;
      case 'HEALTHY':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">سالم</span>;
      case 'DEGRADING':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">هشدار فرسایش</span>;
      case 'FAILED':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">شکست/ابطال</span>;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 text-slate-100 shadow-xl space-y-4">
      {/* هدر ماژول */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-400">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base sm:text-lg text-white">Trend Survival & MFE Dynamic Trailing</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                اصول ۳۹ و ۴۰
              </span>
            </div>
            <p className="text-xs text-slate-400">
              محاسبه پیوسته دوام روند پس از ورود • تریلینگ غیرخطی MFE/ATR بدون پس دادن سود
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLiveSimulating(!isLiveSimulating)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isLiveSimulating 
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLiveSimulating ? 'animate-spin' : ''}`} />
            {isLiveSimulating ? 'پایش بلادرنگ زنده فعال' : 'شبیه‌سازی زنده جریان مارکت'}
          </button>
        </div>
      </div>

      {/* ردیف دو ستونه اصلی: Trend Survival در چپ / MFE Trailing در راست */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* ۱. ماژول Trend Survival Probability (اصل ۳۹) */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">احتمال بقای روند (Trend Survival)</span>
            </div>
            <div className={`px-2.5 py-1 rounded-lg border text-xs font-bold font-mono ${getSurvivalColor(trendSurvival.trendSurvivalProbabilityPct)}`}>
              {trendSurvival.trendSurvivalProbabilityPct}٪
            </div>
          </div>

          {/* گیج پیشرفت احتمال بقا */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-400">
              <span>وضعیت دونده (Runner Status):</span>
              <span className="font-semibold text-slate-200">{trendSurvival.statusTitleFa}</span>
            </div>
            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden flex">
              <div 
                className={`h-full transition-all duration-500 ${
                  trendSurvival.trendSurvivalProbabilityPct >= 65 
                    ? 'bg-gradient-to-r from-teal-500 to-emerald-400' 
                    : trendSurvival.trendSurvivalProbabilityPct >= 50
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-400'
                    : trendSurvival.trendSurvivalProbabilityPct >= 35
                    ? 'bg-gradient-to-r from-amber-500 to-orange-400'
                    : 'bg-gradient-to-r from-rose-600 to-red-500'
                }`}
                style={{ width: `${trendSurvival.trendSurvivalProbabilityPct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {trendSurvival.primaryActionFa}
            </p>
          </div>

          {/* فاکتورهای ۶گانه شواهد بقا */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2 space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">مومنتوم و RSI:</span>
                {getFactorBadge(trendSurvival.factors.momentumHealth.status)}
              </div>
              <div className="text-xs font-mono font-bold text-slate-200">نمره: {trendSurvival.factors.momentumHealth.score}٪</div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2 space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">دلتای حجم (CVD):</span>
                {getFactorBadge(trendSurvival.factors.orderFlowCvdHealth.status)}
              </div>
              <div className="text-xs font-mono font-bold text-slate-200">نمره: {trendSurvival.factors.orderFlowCvdHealth.score}٪</div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2 space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">عمق اردر بوک (OBI):</span>
                {getFactorBadge(trendSurvival.factors.orderBookImbalanceHealth.status)}
              </div>
              <div className="text-xs font-mono font-bold text-slate-200">نمره: {trendSurvival.factors.orderBookImbalanceHealth.score}٪</div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2 space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">ساختار سویینگ ۵دقیقه:</span>
                {getFactorBadge(trendSurvival.factors.marketStructureIntegrity.status)}
              </div>
              <div className="text-xs font-mono font-bold text-slate-200">نمره: {trendSurvival.factors.marketStructureIntegrity.score}٪</div>
            </div>
          </div>
        </div>

        {/* ۲. ماژول MFE-Based Dynamic Trailing (اصل ۴۰) */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-semibold text-white">تریلینگ داینامیک MFE / ATR</span>
            </div>
            <div className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-bold font-mono">
              پله: {mfeTrailing.activeRung}
            </div>
          </div>

          {/* کارت وضعیت استاپ و سود قفل‌شده */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-lg">
              <span className="text-[11px] text-slate-400 block mb-1">قیمت Trailing Stop پویا:</span>
              <div className="text-base font-bold font-mono text-cyan-300">
                ${mfeTrailing.dynamicTrailingStopPrice.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                فاصله: {mfeTrailing.dynamicTrailingOffsetPct}٪ ({mfeTrailing.stopDistanceInAtr}x ATR)
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-lg">
              <span className="text-[11px] text-slate-400 block mb-1">سود قفل‌شده در استاپ:</span>
              <div className={`text-base font-bold font-mono ${mfeTrailing.lockedProfitUsd > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                ${mfeTrailing.lockedProfitUsd > 0 ? `+${mfeTrailing.lockedProfitUsd}` : '۰.۰۰'}
              </div>
              <div className="text-[10px] text-emerald-400/80 mt-0.5">
                MFE اوج: +{mfeTrailing.currentMfePct}٪
              </div>
            </div>
          </div>

          {/* توضیح منطق سفت‌سازی استاپ */}
          <div className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-2.5 text-[11px] text-slate-300 leading-relaxed">
            <div className="font-semibold text-cyan-400 mb-0.5">{mfeTrailing.actionGuidanceFa}</div>
            <div className="text-slate-400 text-[10px]">{mfeTrailing.tighteningRationaleFa}</div>
          </div>

          {/* دکمه اعمال سریع به اردرها */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-400">
              رژیم نوسان: <strong className="text-slate-200">{mfeTrailing.volatilityRegime}</strong>
            </span>
            {onUpdateStop && (
              <button
                onClick={() => onUpdateStop(mfeTrailing.dynamicTrailingStopPrice)}
                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium transition-colors"
              >
                به‌روزرسانی استاپ معامله
              </button>
            )}
          </div>
        </div>
      </div>

      {/* جمع‌بندی توصیه اقدام سیستم */}
      <div className="bg-slate-950 border border-indigo-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-indigo-500/20 text-indigo-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-white">دستور ترکیبی هسته معاملاتی:</div>
            <div className="text-[11px] text-slate-300">{recommendedCompositeAction.reasonFa}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {recommendedCompositeAction.actionType === 'PARTIAL_TAKE_PROFIT' && (
            <span className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold">
              خروج پله‌ای {recommendedCompositeAction.exitAmountPct}٪ فعال
            </span>
          )}
          {recommendedCompositeAction.actionType === 'HOLD_RUNNER' && (
            <span className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold">
              حفظ کامل ۱۰۰٪ Runner
            </span>
          )}
          {recommendedCompositeAction.actionType === 'TIGHTEN_TRAILING_STOP' && (
            <span className="px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold">
              سفت‌سازی تریلینگ استاپ
            </span>
          )}
          {recommendedCompositeAction.actionType === 'FULL_CLOSE' && (
            <span className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold">
              تسویه کامل (Full Close)
            </span>
          )}
        </div>
      </div>

      {/* کنترل‌های تست و تنظیم بلادرنگ پارامترها */}
      <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 cursor-pointer">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            تنظیمات و شبیه‌سازی متغیرهای بازار (Real-Time Inputs)
          </span>
          <span className="text-[10px] text-slate-500">برای ارزیابی رفتار سیستم در شرایط مختلف مقادیر را تغییر دهید</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">MFE اوج رالی (٪):</label>
            <input 
              type="number"
              step="0.1"
              value={simMfePct}
              onChange={(e) => setSimMfePct(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">شاخص RSI جاری:</label>
            <input 
              type="number"
              value={simRsi}
              onChange={(e) => setSimRsi(parseInt(e.target.value) || 50)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">دلتای حجم CVD:</label>
            <input 
              type="number"
              value={simCvdDelta}
              onChange={(e) => setSimCvdDelta(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">ساختار سویینگ ۵دقیقه:</label>
            <button
              onClick={() => setSimStructureIntact(!simStructureIntact)}
              className={`w-full py-1 px-2 rounded text-xs font-bold border transition-colors ${
                simStructureIntact
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
              }`}
            >
              {simStructureIntact ? 'ساختار دست‌نخورده' : 'شکست ساختار'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
