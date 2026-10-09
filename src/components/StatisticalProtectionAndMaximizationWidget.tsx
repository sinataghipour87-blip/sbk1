import React, { useState, useMemo } from 'react';
import { 
  statisticalProtectionAndMaximizationEngine, 
  CombinedProtectionAndMaximizationState 
} from '../services/statisticalProtectionAndMaximizationEngine';
import { Shield, TrendingUp, Sliders, AlertTriangle, CheckCircle2, RefreshCw, BarChart3, Layers, Lock, Cpu, Sparkles } from 'lucide-react';

interface Props {
  currentPrice?: number;
  entryPrice?: number;
  direction?: 'LONG' | 'SHORT';
  setupType?: string;
  marginUsd?: number;
  leverage?: number;
  onApplyStop?: (newStopPrice: number) => void;
}

export const StatisticalProtectionAndMaximizationWidget: React.FC<Props> = ({
  currentPrice = 88950,
  entryPrice = 88000,
  direction = 'LONG',
  setupType = 'BREAKOUT_RETEST',
  marginUsd = 1000,
  leverage = 5,
  onApplyStop
}) => {
  const [simDirection, setSimDirection] = useState<'LONG' | 'SHORT'>(direction);
  const [simSetup, setSimSetup] = useState<string>(setupType);
  const [simEntryPrice, setSimEntryPrice] = useState<number>(entryPrice);
  const [simCurrentPrice, setSimCurrentPrice] = useState<number>(currentPrice);
  const [simMfePct, setSimMfePct] = useState<number>(1.6);
  const [simMaePct, setSimMaePct] = useState<number>(0.22);
  const [simTimeframe, setSimTimeframe] = useState<string>('15m');

  // ارزیابی لحظه‌ای با استفاده از موتور
  const state: CombinedProtectionAndMaximizationState = useMemo(() => {
    const structuralSl = simDirection === 'LONG' 
      ? simEntryPrice * 0.988 
      : simEntryPrice * 1.012;

    return statisticalProtectionAndMaximizationEngine.evaluateState({
      setupType: simSetup,
      regime: 'HIGH_VOLATILITY',
      timeframe: simTimeframe,
      direction: simDirection,
      entryPrice: simEntryPrice,
      currentPrice: simCurrentPrice,
      structuralStopPrice: structuralSl,
      mfePct: simMfePct,
      maePct: simMaePct,
      marginUsd,
      leverage,
      atrValue: simCurrentPrice * 0.0075
    });
  }, [simSetup, simTimeframe, simDirection, simEntryPrice, simCurrentPrice, simMfePct, simMaePct, marginUsd, leverage]);

  const { capitalProtection, profitMaximization, statisticalBreakEven, finalHarmonizedAction } = state;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 text-slate-100 shadow-xl space-y-4">
      {/* هدر ماژول */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base sm:text-lg text-white">Statistical Protection & Profit Maximization</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                اصول ۴۱ و ۴۲
              </span>
            </div>
            <p className="text-xs text-slate-400">
              تفکیک دو موتور مستقل حفاظت سرمایه و بیشینه‌سازی سود • انتقال به Break-even صرفاً مبتنی بر آمار MAE/MFE
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            ستاپ: <strong className="text-emerald-400">{simSetup}</strong> ({simTimeframe})
          </span>
        </div>
      </div>

      {/* بخش ۱: تفکیک دو موتور مستقل (اصل ۴۱) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* موتور اول: Capital Protection Engine */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">Capital Protection Engine</span>
            </div>
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-mono font-bold">
              نمره: {capitalProtection.protectionScore}٪
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400">قیمت استاپ ساختاری اولیه:</span>
              <span className="font-mono font-bold text-slate-200">${capitalProtection.structuralStopPrice.toLocaleString()}</span>
            </div>

            <div className="flex justify-between items-center bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400">حد نویز MAE لول ۹۰٪ ستاپ:</span>
              <span className="font-mono font-bold text-amber-300">{capitalProtection.expectedSetupMaeP90Pct}٪</span>
            </div>

            <div className="flex justify-between items-center bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400">انحراف منفی فعلی معامله (MAE):</span>
              <span className="font-mono font-bold text-slate-200">{capitalProtection.unrealizedMaePct}٪</span>
            </div>
          </div>

          <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/50">
            {capitalProtection.actionRationaleFa}
          </p>
        </div>

        {/* موتور دوم: Profit Maximization Engine */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-semibold text-white">Profit Maximization Engine</span>
            </div>
            <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-xs font-mono font-bold">
              نمره: {profitMaximization.maximizationScore}٪
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400">میزان پیشروی سود (MFE):</span>
              <span className="font-mono font-bold text-emerald-400">+{profitMaximization.currentMfePct}٪</span>
            </div>

            <div className="flex justify-between items-center bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400">ضریب فضای تنفس ATR:</span>
              <span className="font-mono font-bold text-cyan-300">{profitMaximization.breathingRoomAtrMultiplier}x ATR</span>
            </div>

            <div className="flex justify-between items-center bg-slate-900/80 p-2 rounded border border-slate-800">
              <span className="text-slate-400">قیمت استاپ Chandelier Runner:</span>
              <span className="font-mono font-bold text-cyan-300">${profitMaximization.suggestedChandelierStopPrice.toLocaleString()}</span>
            </div>
          </div>

          <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/50">
            {profitMaximization.actionRationaleFa}
          </p>
        </div>
      </div>

      {/* بخش ۲: ارزیابی Break-even آماری (اصل ۴۲) */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-semibold text-white">ارزیابی انتقال به Break-Even بر پایه توزیع آماری تاریخی</span>
          </div>

          <div className={`px-3 py-1 rounded-lg border text-xs font-bold font-mono ${
            statisticalBreakEven.isBePermittedStatistically
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
          }`}>
            {statisticalBreakEven.isBePermittedStatistically ? 'انتقال آماری مجاز' : 'انتقال زودهنگام ممنوع'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
            <span className="text-slate-400 block mb-1">حد آستانه آماری MFE برای BE:</span>
            <div className="text-base font-bold font-mono text-indigo-300">
              {statisticalBreakEven.statisticalBeThresholdMfePct}٪
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">بر اساس P90 نویز MAE + بافر کارمزد</div>
          </div>

          <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
            <span className="text-slate-400 block mb-1">تغییر ارزش متوقع (EV Delta):</span>
            <div className={`text-base font-bold font-mono ${statisticalBreakEven.evDeltaUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {statisticalBreakEven.evDeltaUsd >= 0 ? `+$${statisticalBreakEven.evDeltaUsd}` : `-$${Math.abs(statisticalBreakEven.evDeltaUsd)}`}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">تاثیر انتقال استاپ بر ارزش متوقع</div>
          </div>

          <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
            <span className="text-slate-400 block mb-1">قیمت Break-Even پیشنهادی:</span>
            <div className="text-base font-bold font-mono text-white">
              ${statisticalBreakEven.recommendedBePrice.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">نقطه ورود + پوشش کامل کارمزد</div>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
          <strong className="text-amber-400 block mb-0.5">{statisticalBreakEven.statusTitleFa}</strong>
          {statisticalBreakEven.detailedRationaleFa}
        </p>
      </div>

      {/* جمع‌بندی اقدام هماهنگ شده */}
      <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-emerald-500/20 text-emerald-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-white">تصمیم نهایی موازنه آماری (Harmonized Strategy):</div>
            <div className="text-xs text-emerald-300">{finalHarmonizedAction.evOptimalStrategyFa}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-white bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
            استاپ پیشنهادی: ${finalHarmonizedAction.recommendedStopPrice.toLocaleString()}
          </span>
          {onApplyStop && (
            <button
              onClick={() => onApplyStop(finalHarmonizedAction.recommendedStopPrice)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors"
            >
              اعمال استاپ آماری
            </button>
          )}
        </div>
      </div>

      {/* کنترل‌های تست و تنظیم متغیرهای ستاپ */}
      <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 space-y-2">
        <div className="text-xs font-semibold text-slate-300">تست بلادرنگ ستاپ‌های معاملاتی و نوسانات MFE/MAE:</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">نوع ستاپ معاملاتی:</label>
            <select
              value={simSetup}
              onChange={(e) => setSimSetup(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white"
            >
              <option value="BREAKOUT_RETEST">BREAKOUT_RETEST</option>
              <option value="LIQUIDITY_SWEEP_RECLAIM">LIQUIDITY_SWEEP_RECLAIM</option>
              <option value="PULLBACK_ENTRY">PULLBACK_ENTRY</option>
              <option value="ORDER_BLOCK_RETEST">ORDER_BLOCK_RETEST</option>
              <option value="FVG_RETRACEMENT">FVG_RETRACEMENT</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">میزان MFE فعلی (٪):</label>
            <input 
              type="number"
              step="0.1"
              value={simMfePct}
              onChange={(e) => setSimMfePct(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">میزان MAE فعلی (٪):</label>
            <input 
              type="number"
              step="0.05"
              value={simMaePct}
              onChange={(e) => setSimMaePct(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">تایم‌فریم:</label>
            <select
              value={simTimeframe}
              onChange={(e) => setSimTimeframe(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono"
            >
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
