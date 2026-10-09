import React, { useState, useMemo } from 'react';
import { AnalysisResult, TradePosition } from '../types/trading';
import {
  TrendingUp,
  TrendingDown,
  XCircle,
  AlertTriangle,
  Bot,
  Target,
  Layers,
  ShieldCheck,
  Zap,
  Wallet,
  Sliders,
  ArrowUpRight,
  Cpu,
  Edit2,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { evaluateSignalToExecution } from '../services/signalToExecution';
import { getTradeHistory } from '../services/history';
import { calculateKellyRisk, calculateDrawdown } from '../services/kellyRisk';
import { calculateHedgeBreakEvenPrice } from '../App';

interface OrderExecutionPanelProps {
  balance: number;
  onUpdateBalance: (newBal: number) => void;
  userLeverage?: number;
  onSelectLeverage?: (lev: number) => void;
  analysis: AnalysisResult;
  activePositions: TradePosition[];
  onOpenTrade: (direction: 'LONG' | 'SHORT') => void;
  onClosePosition: (id: string) => void;
  onPartialClosePosition?: (id: string) => void;
  onPyramidPosition?: (id: string) => void;
  onDcaPosition?: (posId: string) => void;
  onAutoTrade: (direction: 'LONG' | 'SHORT') => void;
  onUnhedgePosition?: (id: string) => void;
  onActiveHedgeChip?: (posId: string) => void;
  onHedgeLiquidityDca?: (posId: string) => void;
  prediction: any;
  autoTradeActive: boolean;
  onToggleAutoTrade: () => void;
  mode?: 'manual' | 'auto';
}

const OrderExecutionPanelComponent: React.FC<OrderExecutionPanelProps> = ({
  balance,
  onUpdateBalance,
  userLeverage,
  onSelectLeverage,
  analysis,
  activePositions,
  onOpenTrade,
  onClosePosition,
  onPartialClosePosition,
  onPyramidPosition,
  onDcaPosition,
  onAutoTrade,
  onUnhedgePosition,
  onActiveHedgeChip,
  onHedgeLiquidityDca,
  prediction,
  autoTradeActive,
  onToggleAutoTrade,
  mode,
}) => {
  const [isEditingBalance, setIsEditingBalance] = useState<boolean>(false);
  const [balanceInput, setBalanceInput] = useState<string>(balance.toString());
  const [expandedHedgeTradeId, setExpandedHedgeTradeId] = useState<string | null>(null);

  const [smoothedPrice, setSmoothedPrice] = useState<number>(analysis.price || 0);

  React.useEffect(() => {
    if (analysis?.price && analysis.price > 0) {
      setSmoothedPrice(analysis.price);
    }
  }, [analysis?.price]);

  const handleRealignHedgePrice = (posId: string, currentMarketPrice: number) => {
    if (!currentMarketPrice || currentMarketPrice <= 0) return;
    try {
      const currentPositionsJson = localStorage.getItem('quantum_positions');
      if (!currentPositionsJson) return;
      const rawPositions: TradePosition[] = JSON.parse(currentPositionsJson);
      const updated = rawPositions.map((p) => {
        if (p.id === posId) {
          return {
            ...p,
            hedgeEntry: currentMarketPrice,
          };
        }
        return p;
      });
      localStorage.setItem('quantum_positions', JSON.stringify(updated));
      window.dispatchEvent(new Event('quantum_history_updated'));
    } catch (err) {
      // handled
    }
  };

  const handleBoostHedgeMargin = (posId: string, currentMarketPrice: number) => {
    if (!currentMarketPrice || currentMarketPrice <= 0) return;
    try {
      const currentPositionsJson = localStorage.getItem('quantum_positions');
      if (!currentPositionsJson) return;
      const rawPositions: TradePosition[] = JSON.parse(currentPositionsJson);
      const updated = rawPositions.map((p) => {
        if (p.id === posId) {
          const currentHedgeEntry = p.hedgeEntry || p.entry;
          const newHedgeEntry = currentHedgeEntry + (currentMarketPrice - currentHedgeEntry) * 0.85;
          return {
            ...p,
            margin: p.margin * 1.25,
            hedgeEntry: newHedgeEntry,
          };
        }
        return p;
      });
      localStorage.setItem('quantum_positions', JSON.stringify(updated));
      window.dispatchEvent(new Event('quantum_history_updated'));
    } catch (err) {
      // handled
    }
  };

  // EMA Price Filter (Alpha 0.25) to eliminate micro-tick jitter and noise from rapid polling
  React.useEffect(() => {
    if (analysis.price > 0) {
      setSmoothedPrice((prev) => {
        if (prev === 0) return analysis.price;
        // If difference is less than $1.5 on Bitcoin, suppress jitter
        if (Math.abs(analysis.price - prev) < 1.5) return prev;
        return prev * 0.75 + analysis.price * 0.25;
      });
    }
  }, [analysis.price]);

  // All active positions are strictly displayed together with zero disappearance or filtering
  const filteredPositions = useMemo(() => {
    return activePositions;
  }, [activePositions]);

  const currentPos = filteredPositions.length > 0 ? filteredPositions[0] : null;

  // 🛑 قفل محافظتی انجماد دراپ‌داون: اگر هر معامله فعلی در وضعیت ضرر یا هج باشد، ورود جدید قفل می‌شود
  const isDrawdownLocked = useMemo(() => {
    return activePositions.some((p) => {
      if (p.hedgeActive) return true;
      const curP = (smoothedPrice && smoothedPrice > 0) ? smoothedPrice : (analysis.price || 0);
      const entry = p.entry || curP;
      const lev = p.lev || 10;
      const isLong = p.dir === 'LONG';
      const pnlPct = entry > 0
        ? (isLong ? ((curP - entry) / entry) * 100.0 * lev : ((entry - curP) / entry) * 100.0 * lev)
        : 0;
      return pnlPct < -0.05;
    });
  }, [activePositions, smoothedPrice, analysis.price]);

  const history = useMemo(() => getTradeHistory(), [activePositions, balance]);
  const winRate = useMemo(() => {
    return history.length > 0 ? (history.filter((h) => h.pnlUsd > 0).length / history.length) * 100 : 0;
  }, [history]);
  const drawdown = useMemo(() => calculateDrawdown(history), [history]);
  const kellyPct = useMemo(() => calculateKellyRisk(history) * 100, [history]);
  const suggestedPosition = (balance * (kellyPct / 100)).toFixed(1);

  // Volatility & Optimal Leverage Calculation
  const volPct = analysis.price > 0 ? (analysis.atr / analysis.price) * 100 : 1.5;
  const optimalLev = volPct > 2.0 ? 5 : volPct >= 1.0 ? 15 : 25;
  const currentLev = userLeverage ?? analysis.leverage;

  const evalResultLong = useMemo(() => {
    return evaluateSignalToExecution(analysis, 'LONG', prediction, history);
  }, [analysis, prediction, history]);

  const evalResultShort = useMemo(() => {
    return evaluateSignalToExecution(analysis, 'SHORT', prediction, history);
  }, [analysis, prediction, history]);

  const probLong =
    analysis.scoreLong + analysis.scoreShort > 0
      ? Math.round((analysis.scoreLong / (analysis.scoreLong + analysis.scoreShort)) * 100)
      : 50;
  const probShort = 100 - probLong;

  const handleBalanceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(balanceInput);
    if (!isNaN(val) && val > 0) {
      onUpdateBalance(val);
      setIsEditingBalance(false);
    }
  };

  return (
    <div className="space-y-3.5 relative">
      {/* 1. Leverage Configuration Bar */}
      {mode === 'manual' ? (
        <div className="bg-gradient-to-br from-[#04101e] to-[#030712] border border-cyan-500/40 rounded-xl p-3 space-y-2.5 shadow-[0_0_18px_rgba(6,182,212,0.15)] relative hud-corner">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="flex items-center gap-1.5 text-slate-200 font-bold">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>انتخاب اهرم دستی (Manual Leverage):</span>
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-lg bg-cyan-950 border border-cyan-500/60 text-cyan-300 font-black">
              {currentLev}x
            </span>
          </div>

          {/* Quick Manual Leverage Buttons */}
          <div className="grid grid-cols-7 gap-1">
            {[5, 10, 15, 20, 25, 50, 100].map((lev) => (
              <button
                key={lev}
                type="button"
                onClick={() => onSelectLeverage && onSelectLeverage(lev)}
                className={`py-1.5 rounded-lg font-mono font-bold text-xs transition-all cursor-pointer ${
                  currentLev === lev
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)] border border-cyan-300 scale-105'
                    : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {lev}x
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono">
            <div className="bg-[#0a1322] border border-slate-800 rounded p-1.5 text-center">
              <div className="text-slate-400 text-[9px]">مارجین تخمینی</div>
              <div className="text-cyan-300 font-bold">${suggestedPosition}</div>
            </div>
            <div className="bg-[#0a1322] border border-slate-800 rounded p-1.5 text-center">
              <div className="text-slate-400 text-[9px]">فاصله استاپ SL</div>
              <div className="text-rose-400 font-bold">{analysis.slDistPct?.toFixed(2) || '0.65'}٪</div>
            </div>
            <div className="bg-[#0a1322] border border-slate-800 rounded p-1.5 text-center">
              <div className="text-slate-400 text-[9px]">نوسان ATR</div>
              <div className="text-slate-200 font-bold">{volPct.toFixed(2)}٪</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-[#04101e] to-[#030712] border border-emerald-500/35 rounded-xl p-3 space-y-2 shadow-[0_0_18px_rgba(16,185,129,0.12)] relative hud-corner">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="flex items-center gap-1.5 text-slate-300">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>اهرم فیکس و هوشمند ربات خودکار:</span>
              <strong className="text-emerald-300 font-bold text-[12px]">{analysis.leverage || 10}x (Auto-Fixed)</strong>
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
              مارجین خودکار: ${(balance * (calculateKellyRisk(history) || 0.15)).toFixed(1)} ({(calculateKellyRisk(history) * 100).toFixed(0)}٪ کیف پول)
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px] font-mono">
            <div className="bg-[#0a1322] border border-slate-800 rounded p-1.5 text-center">
              <div className="text-slate-400 text-[9px]">نوسان ATR زنده</div>
              <div className="text-slate-200 font-bold">{volPct.toFixed(2)}٪</div>
            </div>
            <div className="bg-[#0a1322] border border-slate-800 rounded p-1.5 text-center">
              <div className="text-slate-400 text-[9px]">فاصله استاپ لاس</div>
              <div className="text-emerald-400 font-bold">{analysis.slDistPct?.toFixed(2) || '0.65'}٪</div>
            </div>
            <div className="bg-[#0a1322] border border-slate-800 rounded p-1.5 text-center">
              <div className="text-slate-400 text-[9px]">فاصله تا لیکوئیدیشن</div>
              <div className="text-amber-400 font-bold">{(100 / (analysis.leverage || 10)).toFixed(1)}٪-</div>
            </div>
            <div className="bg-[#0a1322] border border-slate-800 rounded p-1.5 text-center">
              <div className="text-slate-400 text-[9px]">سود مرکب پویا</div>
              <div className="text-cyan-400 font-bold">فعال ✅</div>
            </div>
          </div>
        </div>
      )}

      {/* Confluence & Direction Probability Bar */}
      {(!mode || mode === 'auto') && (
        <div className="pt-1.5 border-t border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              احتمال خرید: {probLong}%
            </span>
            <span className="text-slate-300 font-bold flex items-center gap-1">
              <Cpu className="w-3 h-3 text-slate-400" />
              همگرایی: {analysis.confScore}/5
            </span>
            <span className="text-rose-400 font-bold flex items-center gap-1">
              احتمال فروش: {probShort}%
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden flex border border-slate-800">
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{ width: `${probLong}%` }}
            />
            <div
              className="bg-rose-500 h-full transition-all duration-500"
              style={{ width: `${probShort}%` }}
            />
          </div>
        </div>
      )}

      {/* 3. AI Auto-Pilot Switch Button & Status Radar */}
      {(!mode || mode === 'auto') && (
        <div
          className={`p-3 rounded-xl border flex flex-col gap-2 transition-all ${
            autoTradeActive
              ? 'bg-emerald-950/40 border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
              : 'bg-slate-900/60 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 space-x-reverse">
              <div
                className={`p-2 rounded-lg ${
                  autoTradeActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                }`}
              >
                <Bot className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="text-xs font-bold font-mono text-white">معامله خودکار SB (Auto-Pilot)</div>
                <div className="text-[10px] text-slate-400">
                  {autoTradeActive
                    ? 'ورود هوشمند با تایید ارکان (معامله بعدی ۲ دقیقه بعد در صورت تداوم تایید ارکان با اهرم ۱.۵x)'
                    : 'ورود دستی یا فعال‌سازی ربات خودکار'}
                </div>
              </div>
            </div>
            <button
              onClick={onToggleAutoTrade}
              className={`px-3 py-1.5 rounded-xl font-mono font-bold text-xs transition-all cursor-pointer ${
                autoTradeActive
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg'
                  : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-700/50'
              }`}
            >
              {autoTradeActive ? '🟢 ربات خودکار فعال است' : '⚪ روشن کردن ربات خودکار'}
            </button>
          </div>

          {/* Strict Hedge Lock Banner */}
          {activePositions.some((p) => p.hedgeActive) && (
            <div className="bg-amber-950/90 border border-amber-500/80 p-2.5 rounded-xl flex items-center justify-between text-amber-200 font-mono text-[11px] font-bold shadow-lg animate-pulse">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>قفل هجینگ فعال است: باز کردن معامله جدید متوقف شده تا تمام مارجین برای خروج فوری بدون ضرر محفوظ بماند.</span>
              </div>
              <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded text-[10px]">
                محفوظ‌سازی مارجین
              </span>
            </div>
          )}

          {/* Live Dual-Radar State (LONG & SHORT Parallel Tracking) */}
          <div className="pt-2 border-t border-cyan-950/60 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pb-0.5">
              <span className="flex items-center gap-1 font-bold">
                <span className={`w-1.5 h-1.5 rounded-full ${autoTradeActive ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'}`} />
                <span>پایش دوطرفه ارکان به صورت همزمان (Dual-Radar):</span>
              </span>
              <span className="text-cyan-400 font-bold">ظرفیت: {filteredPositions.length}/{mode === 'auto' ? 3 : 6}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* 1. LONG Radar */}
              <div className={`p-2 rounded-lg border text-xs font-mono transition-all ${
                autoTradeActive
                  ? evalResultLong.canExecute
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.15)]'
                    : 'bg-[#020b17] border-cyan-950 text-slate-300'
                  : 'bg-slate-950/20 border-transparent text-slate-500'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-full flex items-center justify-center ${
                      autoTradeActive
                        ? evalResultLong.canExecute
                          ? 'bg-emerald-500 animate-ping'
                          : 'bg-amber-500/80'
                        : 'bg-slate-700'
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    </span>
                    <span>رادار لانگ / خرید</span>
                  </span>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[#010912] border border-cyan-950 text-slate-400 font-bold">
                    {evalResultLong.totalPillarsPassed}/8 رکن
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">امتیاز همگرایی:</span>
                  <span className={`font-bold ${evalResultLong.canExecute ? 'text-emerald-400 text-xs' : 'text-amber-300'}`}>
                    {evalResultLong.totalScorePct}%
                  </span>
                </div>
                <div className="mt-1 text-[9px] text-slate-400 text-right">
                  {autoTradeActive
                    ? evalResultLong.canExecute
                      ? '🎯 سیگنال خرید آماده شلیک!'
                      : '⏳ در حال همسوسازی ارکان...'
                    : 'ربات خاموش است'}
                </div>
              </div>

              {/* 2. SHORT Radar */}
              <div className={`p-2 rounded-lg border text-xs font-mono transition-all ${
                autoTradeActive
                  ? evalResultShort.canExecute
                    ? 'bg-rose-950/30 border-rose-500/40 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.15)]'
                    : 'bg-[#020b17] border-cyan-950 text-slate-300'
                  : 'bg-slate-950/20 border-transparent text-slate-500'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-full flex items-center justify-center ${
                      autoTradeActive
                        ? evalResultShort.canExecute
                          ? 'bg-rose-500 animate-ping'
                          : 'bg-amber-500/80'
                        : 'bg-slate-700'
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    </span>
                    <span>رادار شورت / فروش</span>
                  </span>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[#010912] border border-cyan-950 text-slate-400 font-bold">
                    {evalResultShort.totalPillarsPassed}/8 رکن
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">امتیاز همگرایی:</span>
                  <span className={`font-bold ${evalResultShort.canExecute ? 'text-rose-400 text-xs' : 'text-amber-300'}`}>
                    {evalResultShort.totalScorePct}%
                  </span>
                </div>
                <div className="mt-1 text-[9px] text-slate-400 text-right">
                  {autoTradeActive
                    ? evalResultShort.canExecute
                      ? '🎯 سیگنال فروش آماده شلیک!'
                      : '⏳ در حال همسوسازی ارکان...'
                    : 'ربات خاموش است'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. 3-Tier Take Profit Targets Overview */}
      {(!mode || mode === 'auto') && (
        <div className="bg-[#131722] border border-slate-800 rounded-xl p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-sans text-slate-200 font-semibold">
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span>تارگت‌های پیش‌بینی‌شده معامله:</span>
            </span>
            <span className="text-slate-400 text-[10px]">خروج پله‌ای ۳ سطحی</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-xs font-mono">
            <div className="bg-[#181c28] border border-slate-700/60 p-1.5 rounded-lg text-center">
              <span className="text-[10px] text-emerald-400 block font-bold">🎯 تارگت اول TP1 (۳۳٪)</span>
              <span className="font-bold text-white">${analysis.tp1 ? analysis.tp1.toFixed(1) : '-'}</span>
              <span className="text-[8px] text-slate-400 block">+انتقال SL به ورود</span>
            </div>
            <div className="bg-[#181c28] border border-slate-700/60 p-1.5 rounded-lg text-center">
              <span className="text-[10px] text-slate-200 block font-bold">🚀 تارگت دوم TP2 (۳۳٪)</span>
              <span className="font-bold text-white">${analysis.tp2 ? analysis.tp2.toFixed(1) : '-'}</span>
              <span className="text-[8px] text-slate-400 block">+انتقال SL به TP1</span>
            </div>
            <div className="bg-[#181c28] border border-slate-700/60 p-1.5 rounded-lg text-center">
              <span className="text-[10px] text-slate-200 block font-bold">🏆 تارگت نهایی (۳۴٪)</span>
              <span className="font-bold text-white">${analysis.tp3 ? analysis.tp3.toFixed(1) : '-'}</span>
              <span className="text-[8px] text-slate-400 block">تسویه کامل ۱۰۰٪</span>
            </div>
          </div>
        </div>
      )}

      {/* 7. Trade Spec Grid */}
      {(!mode || mode === 'manual') && (
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          {/* Unified Consensus Signal */}
          <div className="bg-[#131722] p-2.5 rounded-xl border border-slate-800 col-span-2">
            <span className="text-slate-400 block text-[10px] mb-1 font-medium">سیگنال نهایی اجماع کل سیستم (Consensus Signal):</span>
            <div className="flex items-center justify-between">
              {(() => {
                const targetSignalDir = evalResultLong.canExecute ? 'LONG' : evalResultShort.canExecute ? 'SHORT' : null;
                const activeSameDirPos = targetSignalDir ? activePositions.find(p => p.dir === targetSignalDir) : null;
                
                if (activeSameDirPos) {
                  return (
                    <div className="flex flex-col">
                      <span className="font-bold text-xs text-cyan-300 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                        <span>🛡️ پوزیشن {targetSignalDir === 'LONG' ? 'خرید' : 'فروش'} فعال است (امتیاز ارکان: {targetSignalDir === 'LONG' ? evalResultLong.totalScorePct : evalResultShort.totalScorePct}٪)</span>
                      </span>
                      <span className="text-[9.5px] text-slate-400 mt-0.5">
                        ارکان با روند معامله همسو هستند؛ ورود مجدد تا تثبیت سود معامله باز قفل است.
                      </span>
                    </div>
                  );
                }

                return (
                  <span className={`font-bold text-xs ${
                    evalResultLong.canExecute 
                      ? 'text-emerald-400' 
                      : evalResultShort.canExecute 
                      ? 'text-rose-400' 
                      : 'text-slate-300'
                  }`}>
                    {evalResultLong.canExecute 
                      ? '🟢 تایید ورود به خرید / LONG' 
                      : evalResultShort.canExecute 
                      ? '🔴 تایید ورود به فروش / SHORT' 
                      : '⏳ حالت خنثی / آماده‌باش (NEUTRAL)'}
                  </span>
                );
              })()}
              <span className="text-[10px] text-slate-400">
                {evalResultLong.canExecute 
                  ? `امتیاز: ${evalResultLong.totalScorePct}%` 
                  : evalResultShort.canExecute 
                  ? `امتیاز: ${evalResultShort.totalScorePct}%` 
                  : 'در انتظار همگرایی ارکان'}
              </span>
            </div>
          </div>

          {/* Technical Trend */}
          <div className="bg-[#131722] p-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">روند تکنیکال (Technical Trend):</span>
            <span className={`font-bold ${analysis.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {analysis.direction === 'LONG' ? 'خرید / LONG' : 'فروش / SHORT'} ({analysis.confScore}/5)
            </span>
          </div>

          {/* Python ML Prediction */}
          <div className="bg-[#131722] p-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">پیش‌بینی سیستم SB (ML Forecast):</span>
            <span className={`font-bold ${
              prediction?.trend === 'BULLISH' 
                ? 'text-emerald-400' 
                : prediction?.trend === 'BEARISH' 
                ? 'text-rose-400' 
                : 'text-slate-300'
            }`}>
              {prediction?.trend === 'BULLISH' 
                ? 'صعودی / LONG' 
                : prediction?.trend === 'BEARISH' 
                ? 'نزولی / SHORT' 
                : 'خنثی / RANGE'} ({prediction?.confidence ? Math.round(prediction.confidence * 100) : 80}%)
            </span>
          </div>

          {/* Dynamic Suggested Leverage */}
          <div className="bg-[#131722] p-2 rounded-xl border border-slate-800 col-span-2 sm:col-span-1">
            <span className="text-slate-400 block text-[10px]">اهرم پیشنهادی پویا:</span>
            <span className="font-bold text-slate-200">{currentLev}x</span>
          </div>

          {/* Dynamic SL */}
          <div className="bg-[#131722] p-2 rounded-xl border border-slate-800 col-span-2 sm:col-span-1">
            <span className="text-slate-400 block text-[10px]">حد ضرر محافظ (SL):</span>
            <span className="font-bold text-rose-400">${analysis.sl.toFixed(1)}</span>
            <span className="text-[10px] text-slate-500 block">فاصله: {analysis.slDistPct.toFixed(2)}%</span>
          </div>
        </div>
      )}

      {/* 8. Active Positions Live Monitor Matrix (Displayed exclusively in Auto-Pilot section) */}
      {(mode === 'auto' || !mode) && filteredPositions.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-[#020b17] border border-cyan-800/80 p-2 rounded-xl">
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-cyan-200">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span>ماتریس معاملات فعال ربات خودکار ({filteredPositions.length} پوزیشن باز)</span>
            </div>
            <button
              onClick={() => {
                filteredPositions.forEach((p) => onClosePosition(p.id));
              }}
              className="py-1 px-3 rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-mono font-black text-xs flex items-center justify-center gap-1.5 transition-all shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-amber-300 animate-bounce" />
              <span>⚡ تسویه آنی و خروج سربه‌سر (بدون ضرر تضمینی)</span>
            </button>
          </div>

          {filteredPositions.map((pos, index) => {
            const curP = (analysis?.price && analysis.price > 0) ? analysis.price : (smoothedPrice || pos.entry || 88400);
            const entry = pos.entry && pos.entry > 0 ? pos.entry : curP;
            const lev = pos.lev || 10;
            const isLong = pos.dir === 'LONG';
            const remainingMargin = pos.margin || 10;
            const baseMargin = pos.initialMargin || remainingMargin;
            const notionalPositionUsd = remainingMargin * lev;

            const priceDiff = isLong ? (curP - entry) : (entry - curP);
            const priceChangePct = entry > 0 ? (priceDiff / entry) * 100.0 : 0;
            const floatingPnlUsd = notionalPositionUsd * (priceChangePct / 100.0);

            // Compute counter hedge leg profit if cross-hedge is active
            let hedgePnlUsd = 0;
            if (pos.hedgeActive && pos.hedgeEntry) {
              const hedgeEntry = pos.hedgeEntry;
              const hedgePnlPct = isLong
                ? ((hedgeEntry - curP) / hedgeEntry) * 100.0 * lev
                : ((curP - hedgeEntry) / hedgeEntry) * 100.0 * lev;
              const hedgeMargin = Math.max(0, remainingMargin - baseMargin);
              hedgePnlUsd = hedgeMargin * (hedgePnlPct / 100.0);
            }

            const realizedPnlUsd = pos.realizedPnlUsd || 0;
            const totalNetPnlUsd = Math.round((floatingPnlUsd + hedgePnlUsd + realizedPnlUsd) * 100) / 100;
            const totalNetPnlPct = baseMargin > 0 ? (totalNetPnlUsd / baseMargin) * 100.0 : 0;

            // 🛡️ فیلتر نویز و منطقه امن نوسان ورود (Breakeven & Spread Noise Filter)
            // اگر تغییر قیمت زیر ۰.۰۶٪ یا سود زیر ۱۵ سنت باشد، معامله در نوسان طبیعی نقطه ورود است و نباید الکی با قرمز هشدارآمیز کاربر را نگران کند
            const isBreakevenNoise = Math.abs(totalNetPnlUsd) <= 0.15 && Math.abs(totalNetPnlPct) <= 0.6;

            const tp1Target = pos.tp1 || (isLong ? entry * 1.015 : entry * 0.985);
            const tp2Target = pos.tp2 || (isLong ? entry * 1.03 : entry * 0.97);
            const tp3Target = pos.tp3 || pos.tp;

            const stageName = pos.name || (index === 0 ? 'S' : index === 1 ? 'SB' : 'SBK');

            // محاسبه پیش‌بینی سود خالص و کارمزد صرافی
            const estFeeUsd = pos.exchangeFeeEstimateUsd || Math.round((baseMargin * lev * 0.00055 * 2) * 100) / 100;
            const estNetProfitUsd = pos.predictedProfitUsd || Math.round((baseMargin * (isLong ? Math.abs(tp1Target - entry) / entry : Math.abs(entry - tp1Target) / entry) * lev - estFeeUsd) * 100) / 100;

            return (
              <div
                key={pos.id + "_" + index}
                className="bg-gradient-to-br from-cyan-950/80 to-blue-950/60 border border-cyan-500/50 rounded-xl p-3 space-y-2.5 shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-cyan-900/60 pb-1.5 text-xs font-mono">
                  <div className="flex items-center gap-1.5 font-bold">
                    {/* Clear prominent Trade Stage Badge: Strictly S for 1st, SB for 2nd, SBK for 3rd */}
                    <span className={`px-2 py-0.5 rounded text-[11px] font-black border ${
                      stageName === 'SBK'
                        ? 'bg-purple-950 text-purple-300 border-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                        : stageName === 'SB'
                        ? 'bg-amber-950 text-amber-300 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.4)]'
                        : 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                    }`}>
                      معامله {stageName}
                    </span>
                    <span className={isLong ? 'text-emerald-400' : 'text-rose-400'}>
                      {isLong ? 'خرید (LONG)' : 'فروش (SHORT)'} {lev}x
                    </span>
                    <span className="text-[10px] text-slate-400">(${entry.toFixed(1)})</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <span>زمان: {pos.openedAt}</span>
                    <span className="text-cyan-400 font-bold bg-cyan-950/90 px-2 py-0.5 rounded border border-cyan-700/60 tabular-nums">
                      ⚡ بیت‌کوین: ${curP > 0 ? curP.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '---'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-xs font-mono">
                  <div className="bg-slate-900/90 p-1.5 rounded text-center border border-cyan-950 flex flex-col justify-center">
                    <span className="text-[9px] text-slate-400 block mb-0.5">مارجین | ارزش با اهرم {lev}x</span>
                    <div className="flex items-center justify-center gap-1 tabular-nums">
                      <span className="font-black text-cyan-300 text-xs" title="مارجین درگیر از کیف پول">${remainingMargin.toFixed(0)}</span>
                      <span className="text-slate-600 font-bold text-[10px]">|</span>
                      <span className="font-black text-amber-300 text-xs bg-amber-950/70 border border-amber-500/40 px-1 py-0.5 rounded shadow-[0_0_6px_rgba(245,158,11,0.2)]" title={`ارزش کل معامله با اهرم ${lev}x در بازار (${remainingMargin.toFixed(0)}$ × ${lev}x = ${notionalPositionUsd.toFixed(0)}$)`}>
                        ${notionalPositionUsd.toFixed(0)}
                      </span>
                    </div>
                  </div>
                  <div className="bg-slate-900/90 p-1.5 rounded text-center border border-cyan-950">
                    <span className="text-[9px] text-slate-400 block">حد ضرر SL</span>
                    <span className="font-bold text-rose-400 tabular-nums">${pos.sl.toFixed(1)}</span>
                  </div>
                  <div className="bg-slate-900/90 p-1.5 rounded text-center border border-cyan-950 overflow-hidden flex flex-col justify-center">
                    <span className="text-[9px] text-slate-400 block mb-0.5">سود دلاری | بازدهی ROE</span>
                    <div className="flex items-center justify-center gap-1 font-black tabular-nums whitespace-nowrap min-h-[18px]">
                      {isBreakevenNoise ? (
                        <span className="inline-block font-mono text-cyan-300 text-[11px] bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-700/60" title="نوسان طبیعی قیمت در محدوده اسپرد ورود">
                          {totalNetPnlUsd >= 0 ? '+' : ''}${totalNetPnlUsd.toFixed(2)} (سربه‌سر)
                        </span>
                      ) : (
                        <>
                          <span className={`inline-block font-mono ${totalNetPnlUsd > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {totalNetPnlUsd > 0 ? '+' : ''}${totalNetPnlUsd.toFixed(2)}
                          </span>
                          <span className={`inline-block text-[10px] font-mono ${totalNetPnlPct > 0 ? 'text-emerald-400/90' : 'text-rose-400/90'}`}>
                            ({totalNetPnlPct > 0 ? '+' : ''}{totalNetPnlPct.toFixed(1)}% ROE)
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* 📐 نوار تفکیک ریاضی و فرمول شفاف محاسبه سود از مارجین و اهرم */}
                <div className="bg-[#020b17] border border-cyan-900/60 rounded px-2.5 py-1 text-[9.5px] font-mono flex flex-wrap items-center justify-between gap-1.5 text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span>حجم کل: <strong className="text-amber-300">${notionalPositionUsd.toFixed(0)}</strong></span>
                    <span className="text-slate-600">|</span>
                    <span>حرکت قیمت BTC: <strong className={priceChangePct >= 0 ? "text-emerald-400" : "text-rose-400"}>{priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(2)}%</strong></span>
                  </div>
                  <div className="text-slate-400">
                    فرمول: <span className="text-cyan-300 font-bold">${notionalPositionUsd.toFixed(0)} × {priceChangePct.toFixed(2)}% = {totalNetPnlUsd >= 0 ? '+' : ''}${totalNetPnlUsd.toFixed(2)}</span>
                  </div>
                </div>

                {/* 🎯 پایش پتانسیل پیشروی موج و سود خالص تضمین‌شده پس از کسر کارمزد */}
                <div className="bg-[#040e1c] border border-cyan-900/70 rounded-lg p-2 flex flex-wrap items-center justify-between gap-1.5 text-[10px] font-mono">
                  <div className="flex items-center gap-1">
                    <span className="text-amber-300 font-bold">
                      {pos.wavePotentialRating === 'HIGH_SUPER_WAVE'
                        ? '🚀 موج کلان پرشتاب (High Super-Wave)'
                        : pos.wavePotentialRating === 'PRIME_TREND_WAVE'
                        ? '🏄‍♂️ موج روندی اصلی (Prime Trend Wave)'
                        : '🎯 موج نوسانی (Micro Sniper)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">
                      کارمزد صرافی: <span className="text-rose-300 font-bold">${estFeeUsd.toFixed(2)}</span>
                    </span>
                    <span className="text-emerald-300 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40">
                      سود خالص پیش‌بینی TP1: +${estNetProfitUsd > 0 ? estNetProfitUsd.toFixed(2) : (baseMargin * 0.10).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Zero-Loss Cross-Hedge Radar & Active Dual-Leg Drilldown Box */}
                {pos.hedgeActive ? (() => {
                  const hedgeEntry = pos.hedgeEntry || entry;
                  const hedgeDir = isLong ? 'SHORT' : 'LONG';
                  const hedgePnlPct = isLong
                    ? ((hedgeEntry - curP) / hedgeEntry) * 100.0 * lev
                    : ((curP - hedgeEntry) / hedgeEntry) * 100.0 * lev;
                  const hedgeMargin = Math.max(0, remainingMargin - baseMargin);
                  const hedgePnlUsd = hedgeMargin * (hedgePnlPct / 100.0);
                  const netCombinedPnl = floatingPnlUsd + hedgePnlUsd;

                  return (
                    <div className="bg-[#020b17] border border-indigo-500 rounded-xl p-2.5 space-y-2 text-xs font-mono shadow-[0_0_15px_rgba(99,102,241,0.2)] animate-fadeIn">
                      {/* Live Hedge Status Header Bar */}
                      <div className="flex items-center justify-between border-b border-indigo-950 pb-1.5">
                        <div className="flex items-center gap-1.5 font-bold text-indigo-200 text-[11px]">
                          <ShieldCheck className="w-4 h-4 text-cyan-400 animate-pulse" />
                          <span>قفل هجینگ هوشمند فعال است (Cross-Hedge On)</span>
                        </div>
                        <span className="text-emerald-300 font-bold bg-emerald-950/90 px-2 py-0.5 rounded border border-emerald-500/50 text-[10px] animate-pulse">
                          ضرر فریز شد 🔒
                        </span>
                      </div>

                      {/* Dual-Leg Live Comparison Box */}
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        {/* Primary Leg */}
                        <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg space-y-1">
                          <div className="flex items-center justify-between text-slate-300 font-bold">
                            <span>لگ اول ({pos.dir}):</span>
                            <span className={isLong ? 'text-emerald-400' : 'text-rose-400'}>${entry.toFixed(1)}</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-400">
                            <span>سود/زیان شناور:</span>
                            <span className={floatingPnlUsd >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                              {floatingPnlUsd >= 0 ? '+' : ''}${floatingPnlUsd.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {/* Counter Hedge Leg */}
                        <div className="bg-indigo-950/40 border border-indigo-800/50 p-2 rounded-lg space-y-1">
                          <div className="flex items-center justify-between text-indigo-200 font-bold">
                            <span>لگ دوم هدج ({hedgeDir}):</span>
                            <span className="text-amber-400">${hedgeEntry.toFixed(1)}</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-400">
                            <span>سود لگ هدج:</span>
                            <span className={hedgePnlUsd >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                              {hedgePnlUsd >= 0 ? '+' : ''}${hedgePnlUsd.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Net Combined Real-time Exit Status & Instant Emergency Exit Button */}
                      <div className="bg-gradient-to-r from-emerald-950/40 to-cyan-950/40 border border-emerald-500/30 p-2 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-200 font-bold flex items-center gap-1">
                            <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin-slow" />
                            برآیند خروج (Net Exit):
                          </span>
                          <span className={`font-black text-xs ${netCombinedPnl >= 0 ? 'text-emerald-400' : 'text-amber-300'}`}>
                            {netCombinedPnl >= 0 ? '+' : ''}${netCombinedPnl.toFixed(2)} USD
                            {netCombinedPnl >= 0 ? ' (آماده خروج با سود! 🚀)' : ' (ضرر کاملاً فریز شده 🛡️)'}
                          </span>
                        </div>

                        {/* Distance to Breakeven Metric */}
                        <div className="bg-slate-950/90 border border-slate-800/80 px-2.5 py-1.5 rounded-md flex items-center justify-between text-[10px]">
                          <span className="text-slate-300 font-bold flex items-center gap-1">
                            <Target className="w-3.5 h-3.5 text-amber-400" />
                            باقیمانده تا نقطه سربه‌سر کامل (Breakeven):
                          </span>
                          <span className={`font-mono font-bold ${netCombinedPnl >= 0 ? 'text-emerald-400' : 'text-amber-300'}`}>
                            {netCombinedPnl >= 0 ? '$0.00 (رسیده به نقطه سربه‌سر ✨)' : `$${Math.abs(netCombinedPnl).toFixed(2)} USD`}
                          </span>
                        </div>

                        {/* Exact Hedge Break-Even Price with Live Visual Difference Radar */}
                        {(() => {
                          const beInfo = calculateHedgeBreakEvenPrice(pos, curP, {
                            fundingRate: analysis?.funding || 0.0001,
                            networkTakerFeeRate: 0.00055,
                          });
                          const bePrice = beInfo.breakEvenPrice;
                          const priceDiffUsd = curP - bePrice;
                          const absPriceDiff = Math.abs(priceDiffUsd);
                          const diffPct = curP > 0 ? (absPriceDiff / curP) * 100.0 : 0;
                          const isHedgeLong = !isLong;
                          const isAtBreakeven = isLong ? curP <= bePrice : curP >= bePrice;

                          // Dynamic Progress calculation towards Break-Even (0% to 100%)
                          const hEntry = pos.hedgeEntry || curP;
                          const totalSpan = Math.max(1, Math.abs(hEntry - bePrice));
                          const currentSpan = Math.abs(curP - hEntry);
                          const progressPct = isAtBreakeven
                            ? 100
                            : Math.min(98, Math.max(4, Math.round((currentSpan / totalSpan) * 100)));

                          return (
                            <div className="bg-[#040e21] border border-cyan-500/50 rounded-xl p-3 space-y-2.5 shadow-[0_0_15px_rgba(6,182,212,0.15)] animate-fadeIn">
                              {/* Header & Target Price */}
                              <div className="flex flex-wrap items-center justify-between gap-1.5 font-bold">
                                <span className="flex items-center gap-1.5 text-xs text-cyan-200">
                                  <Target className="w-4 h-4 text-cyan-400 animate-pulse" />
                                  <span>نمایشگر زنده نقطه سربه‌سر (Break-Even Radar):</span>
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-slate-400 font-normal">قیمت هدف سربه‌سر:</span>
                                  <span className="text-amber-300 font-mono text-xs font-black bg-amber-950/70 border border-amber-600/50 px-2 py-0.5 rounded">
                                    ${bePrice.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              {/* Live Dynamic Distance & Status Gauge */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
                                <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg">
                                  <span className="text-[9.5px] text-slate-400 block mb-0.5">قیمت زنده مارکت</span>
                                  <span className="text-xs font-mono font-bold text-white">
                                    ${curP.toFixed(1)}
                                  </span>
                                </div>

                                <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg">
                                  <span className="text-[9.5px] text-slate-400 block mb-0.5">اختلاف تا سربه‌سر</span>
                                  <span className={`text-xs font-mono font-black ${isAtBreakeven ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    {isAtBreakeven ? '۰.۰۰ دلار (صفر)' : `$${absPriceDiff.toFixed(2)}`}
                                  </span>
                                </div>

                                <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg col-span-2 sm:col-span-1">
                                  <span className="text-[9.5px] text-slate-400 block mb-0.5">فاصله درصدی</span>
                                  <span className={`text-xs font-mono font-bold ${isAtBreakeven ? 'text-emerald-400' : 'text-cyan-300'}`}>
                                    {isAtBreakeven ? '۱۰۰٪ محقق شد' : `${diffPct.toFixed(2)}%`}
                                  </span>
                                </div>
                              </div>

                              {/* Interactive Visual Progress Bar towards Break-Even */}
                              <div className="space-y-1 bg-black/40 p-2.5 rounded-lg border border-cyan-950">
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                  <span className="text-slate-400 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                    شروع هدج (${hEntry.toFixed(1)})
                                  </span>
                                  <span className={`font-bold flex items-center gap-1 ${isAtBreakeven ? 'text-emerald-400 animate-pulse' : 'text-amber-300'}`}>
                                    {isAtBreakeven ? '🎯 سربه‌سر محقق شد (آماده خروج)' : `پیشرفت تا تسویه: ${progressPct}%`}
                                  </span>
                                  <span className="text-amber-400 font-bold flex items-center gap-1">
                                    سربه‌سر (${bePrice.toFixed(1)})
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  </span>
                                </div>

                                {/* Visual Track & Animated Fill Bar */}
                                <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-cyan-900/60 relative">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ease-out relative ${
                                      isAtBreakeven
                                        ? 'bg-gradient-to-r from-teal-500 to-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]'
                                        : 'bg-gradient-to-r from-cyan-600 via-amber-500 to-emerald-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                                    }`}
                                    style={{ width: `${progressPct}%` }}
                                  >
                                    <div className="absolute right-0 top-0 bottom-0 w-2 bg-white rounded-full animate-ping opacity-75" />
                                  </div>
                                </div>

                                {/* Dynamic Guide Caption */}
                                <div className="flex items-center justify-between text-[9px] text-slate-400 pt-0.5">
                                  <span>
                                    {isHedgeLong
                                      ? 'جهت خروج هدج: نیاز به حرکت صعودی قیمت به سمت بالا'
                                      : 'جهت خروج هدج: نیاز به حرکت نزولی قیمت به سمت پایین'}
                                  </span>
                                  <span className={isAtBreakeven ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
                                    {isAtBreakeven
                                      ? '✅ معامله در حاشیه سود/سربه‌سر است'
                                      : `تنها $${absPriceDiff.toFixed(1)} تا خروج کامل بدون زیان`}
                                  </span>
                                </div>
                              </div>

                              {/* Exchange Fees & Deriv Details */}
                              <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-400 font-mono border-t border-cyan-950/80 pt-1.5">
                                <div className="flex items-center justify-between bg-slate-950/60 px-2 py-1 rounded">
                                  <span>کارمزد ورود و خروج صرافی:</span>
                                  <span className="text-rose-300 font-bold">-${beInfo.tradingFeesUsd.toFixed(2)}</span>
                                </div>
                                <div className="flex items-center justify-between bg-slate-950/60 px-2 py-1 rounded">
                                  <span>فاندینگ انباشته در زمان:</span>
                                  <span className="text-amber-300 font-bold">-${beInfo.cumulativeFundingUsd.toFixed(2)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Automated Execution Status Indicator & Proactive Actions */}
                        <div className="bg-gradient-to-r from-emerald-950/80 to-cyan-950/80 border border-emerald-500/50 p-2.5 rounded-lg flex items-center justify-between text-emerald-300 font-mono text-[11px] font-bold shadow-inner">
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-amber-400 animate-bounce" />
                            <span>ربات خودکار در حال پایش و کالیبراسیون لحظه‌ای جهت خروج فوری روی $0.00...</span>
                          </div>
                          <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] animate-pulse">
                            خودکار (AUTOMATIC)
                          </span>
                        </div>

                        {/* ⚡ فرامین اکتیو تسریع خروج از ضرر فریز شده و رساندن سربه‌سر به صفر */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          {onActiveHedgeChip && (
                            <button
                              onClick={() => onActiveHedgeChip(pos.id)}
                              className="py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-800 to-blue-800 hover:from-cyan-700 hover:to-blue-700 text-cyan-100 font-mono font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all border border-cyan-500/50 shadow-md cursor-pointer"
                              title="نقد کردن آنی سود لگ هج، شیفت نقطه ورود هج به قیمت زنده و کاهش فوری فاصله سربه‌سر"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-cyan-300" />
                              <span>⚡ نوسان‌گیری و کاهش فاصله سربه‌سر</span>
                            </button>
                          )}

                          {onHedgeLiquidityDca && (
                            <button
                              onClick={() => onHedgeLiquidityDca(pos.id)}
                              className="py-2 px-3 rounded-lg bg-gradient-to-r from-purple-800 to-indigo-800 hover:from-purple-700 hover:to-indigo-700 text-purple-100 font-mono font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all border border-purple-500/50 shadow-md cursor-pointer"
                              title="تزریق پله نجات در کلاستر نقدینگی اردر بوک برای پرتاب نقطه سربه‌سر به نزدیک‌ترین فاصله"
                            >
                              <Target className="w-3.5 h-3.5 text-amber-300" />
                              <span>🎯 پله نجات DCA در نقدینگی</span>
                            </button>
                          )}
                        </div>

                        {/* Smart Unhedge Action Button (آزادسازی معامله اصلی هنگام بازگشت روند) */}
                        {onUnhedgePosition && (
                          <div className="pt-1 space-y-1.5">
                            {floatingPnlUsd > 0 && (
                              <div className="text-[10px] text-emerald-300 bg-emerald-950/60 border border-emerald-500/50 p-1.5 rounded-lg flex items-center gap-1 font-mono animate-pulse">
                                <span>✨ معامله اصلی به سود بازگشته (+${floatingPnlUsd.toFixed(2)})! جهت جلوگیری از کاهش سود توسط لگ دوم، می‌توانید لگ هدج را فوراً لغو کنید:</span>
                              </div>
                            )}
                            <button
                              onClick={() => onUnhedgePosition(pos.id)}
                              className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-mono font-black text-xs flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(16,185,129,0.35)] cursor-pointer"
                              title="بستن فوری لگ هدج معکوس، قفل حد ضرر روی نقطه ورود و آزادسازی معامله اصلی جهت کسب سود کامل"
                            >
                              <Zap className="w-4 h-4 text-amber-300 animate-pulse" />
                              <span>🔓 آزادسازی هوشمند معامله اصلی (حذف لگ هدج و فعال‌سازی سود TP)</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                  <>
                    {/* Standby Radar Banner while position is active and monitoring for hedge lock */}
                    <div className="flex items-center justify-between text-[10px] font-mono bg-[#020b17] border border-indigo-950/80 p-1.5 rounded-lg text-slate-400">
                      <div className="flex items-center gap-1.5 text-indigo-300">
                        <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                        <span>سپر هجینگ خودکار (Zero-Loss Cross-Hedge):</span>
                      </div>
                      <span className="text-cyan-400 font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                        آماده‌باش و محافظ لحظه‌ای
                      </span>
                    </div>

                    {/* 🛡️ میز مهار هوشمند ضرر زنده (Drawdown Strategy Console) */}
                    {totalNetPnlUsd < 0 && (
                      <div className="bg-[#030914] border border-rose-500/30 rounded-lg p-2.5 space-y-1.5 text-[11px] font-sans">
                        <div className="flex items-center justify-between text-rose-300 font-bold border-b border-rose-950/60 pb-1.5">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                            مدیریت و مهار ضرر زنده (Drawdown Control)
                          </span>
                          <span className="tabular-nums font-mono">ضرر جاری: {totalNetPnlUsd.toFixed(2)}$</span>
                        </div>
                        {(() => {
                          const dcaDistanceUsd = (analysis.atr || 800) * 1.5;
                          const optimalDcaPrice = isLong ? entry - dcaDistanceUsd : entry + dcaDistanceUsd;
                          const dcaVolumeUsd = remainingMargin * 1.5;
                          return (
                            <>
                              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-300">
                                <div className="bg-slate-950/60 p-1 rounded border border-slate-900">
                                  <span className="text-slate-400 block text-[9px] font-sans">پله دوم هوشمند (ATR):</span>
                                  <span className="text-emerald-400 font-bold">${optimalDcaPrice.toFixed(1)}</span>
                                </div>
                                <div className="bg-slate-950/60 p-1 rounded border border-slate-900">
                                  <span className="text-slate-400 block text-[9px] font-sans">مارجین پله دوم (۱.۵x):</span>
                                  <span className="text-amber-400 font-bold">${dcaVolumeUsd.toFixed(1)}</span>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                                <button
                                  onClick={() => {
                                    onClosePosition(pos.id); // Trigger close which instantly locks in the cross-hedge if in loss!
                                  }}
                                  className="py-1.5 px-1.5 rounded-lg bg-gradient-to-r from-indigo-700 to-blue-700 hover:from-indigo-600 hover:to-blue-600 text-white text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-all shadow-[0_0_8px_rgba(99,102,241,0.3)]"
                                  title="انجماد آنی ضرر و قفل کردن پوزیشن با هج معکوس"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  قفل هج فوری 🛡️
                                </button>
                                <button
                                  onClick={() => {
                                    if (onDcaPosition) {
                                      onDcaPosition(pos.id);
                                    } else {
                                      onOpenTrade(pos.dir);
                                    }
                                  }}
                                  className="py-1.5 px-1.5 rounded-lg bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-600 hover:to-teal-600 text-white text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-all shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                                  title="میانگین کم کردن اصولی با پله دوم"
                                >
                                  <Layers className="w-3.5 h-3.5" />
                                  خرید پله دوم 🚀
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </>
                )}

                {/* Ultra-Micro Profit Harvester Status Banner */}
                {(() => {
                  const harvestUnit = Math.max(0.30, parseFloat(((baseMargin || 50) * 0.005).toFixed(2)));
                  return (
                    <div className="flex items-center justify-between text-[10px] font-mono bg-[#020b17] border border-cyan-900/60 p-1.5 rounded-lg">
                      <span className="text-slate-300 flex items-center gap-1 font-bold">
                        <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                        <span>موتور ریزه‌خواری لحظه‌ای سود (گام ${harvestUnit.toFixed(2)}):</span>
                      </span>
                      <span className="text-emerald-400 font-bold">
                        {pos.harvestedPnlUsd && pos.harvestedPnlUsd > 0
                          ? `+$${pos.harvestedPnlUsd.toFixed(2)} سود تثبیت‌شده و ارتقای SL`
                          : `در انتظار اولین سود ریز شناور (+${harvestUnit.toFixed(2)}$)`}
                      </span>
                    </div>
                  );
                })()}

                {/* 3-Tier Stepped Targets Progress */}
                <div className="grid grid-cols-3 gap-1 text-center text-[9px] font-mono">
                  <div className={`p-1 rounded border ${pos.tp1Hit ? 'bg-emerald-950 border-emerald-500 text-emerald-300 font-bold' : 'bg-slate-900/80 border-slate-800 text-slate-400'}`}>
                    <span>{pos.tp1Hit ? '✅ TP1' : 'TP1'} (${tp1Target.toFixed(0)})</span>
                  </div>
                  <div className={`p-1 rounded border ${pos.tp2Hit ? 'bg-cyan-950 border-cyan-500 text-cyan-300 font-bold' : pos.tp1Hit ? 'bg-amber-950/60 border-amber-500 text-amber-300 animate-pulse' : 'bg-slate-900/80 border-slate-800 text-slate-400'}`}>
                    <span>{pos.tp2Hit ? '✅ TP2' : 'TP2'} (${tp2Target.toFixed(0)})</span>
                  </div>
                  <div className={`p-1 rounded border ${pos.tp2Hit ? 'bg-indigo-950 border-indigo-500 text-indigo-300 animate-pulse' : 'bg-slate-900/80 border-slate-800 text-slate-400'}`}>
                    <span>TP3 (${tp3Target.toFixed(0)})</span>
                  </div>
                </div>

                {/* Controls */}
                <div className="pt-1">
                  {onPartialClosePosition && !pos.tp2Hit ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => onPartialClosePosition(pos.id)}
                        className="py-1.5 rounded-lg bg-amber-600/90 hover:bg-amber-500 text-white font-mono font-bold text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer"
                      >
                        <Layers className="w-3 h-3" />
                        تسویه ۱/۳
                      </button>
                      <button
                        onClick={() => onClosePosition(pos.id)}
                        className="py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700/60 font-mono font-bold text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>خروج دستی #{index + 1}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onClosePosition(pos.id)}
                      className="w-full py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700/60 font-mono font-bold text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>خروج دستی معامله #{index + 1}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action Buttons: Open Long / Open Short (Shown when active positions < 6) */}
      {activePositions.length < 6 && (
        <div className="space-y-2 pt-1">
          {/* 🛑 بنر هشدار قفل هوشمند پیشگیری از انباشت زیان (فقط در حالت خودکار یا هج فعال) */}
          {isDrawdownLocked && mode === 'auto' && (
            <div className="bg-gradient-to-r from-rose-950/90 via-slate-900 to-amber-950/90 border border-rose-500/80 p-3 rounded-xl flex items-center justify-between text-rose-200 font-mono text-xs shadow-[0_0_18px_rgba(244,63,94,0.35)] animate-pulse">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
                <div>
                  <div className="font-bold text-white text-xs">پایش هوشمند ورود خودکار (Auto Entry Guard) 🛡️</div>
                  <div className="text-[10px] text-rose-300">
                    ربات خودکار در حال مدیریت معامله باز است تا با نقطه سربه‌سر یا سود تثبیت‌شده تسویه شود.
                  </div>
                </div>
              </div>
              <span className="bg-rose-500/30 text-rose-200 border border-rose-500/50 px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap">
                مدیریت فعال
              </span>
            </div>
          )}

          {!analysis.signalOk && (!mode || mode === 'manual') && (
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-400/90 bg-amber-950/30 border border-amber-800/40 p-2 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>امتیاز همگرایی کمتر از ۴ است یا بازار رِنج است (معامله دستی آزاد است).</span>
            </div>
          )}

          {/* Mode Manual Buttons - Fully Unlocked and Responsive */}
          {(!mode || mode === 'manual') && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onOpenTrade('LONG')}
                  className="py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-mono font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer active:scale-95"
                  title="خرید / لانگ دستی (LONG)"
                >
                  <TrendingUp className="w-4 h-4" />
                  <span>{activePositions.length > 0 ? `افزودن خرید دستی #${activePositions.length + 1}` : 'خرید دستی / LONG'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenTrade('SHORT')}
                  className="py-3 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-mono font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(244,63,94,0.3)] cursor-pointer active:scale-95"
                  title="فروش / شورت دستی (SHORT)"
                >
                  <TrendingDown className="w-4 h-4" />
                  <span>{activePositions.length > 0 ? `افزودن فروش دستی #${activePositions.length + 1}` : 'فروش دستی / SHORT'}</span>
                </button>
              </div>

              {/* Quick Action Helpers in Manual Mode */}
              {activePositions.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px] font-mono">
                  {onDcaPosition && (
                    <button
                      type="button"
                      onClick={() => onDcaPosition(activePositions[0].id)}
                      className="py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 font-bold flex items-center justify-center gap-1 cursor-pointer transition-all"
                    >
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      <span>پله دوم دستی (DCA)</span>
                    </button>
                  )}
                  {onPartialClosePosition && (
                    <button
                      type="button"
                      onClick={() => onPartialClosePosition(activePositions[0].id)}
                      className="py-1.5 rounded-lg bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-700/60 font-bold flex items-center justify-center gap-1 cursor-pointer transition-all"
                    >
                      <Target className="w-3.5 h-3.5 text-amber-400" />
                      <span>تسویه ۱/۳ دستی</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onClosePosition(activePositions[0].id)}
                    className="py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/60 font-bold flex items-center justify-center gap-1 cursor-pointer transition-all"
                  >
                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                    <span>بستن فوری معامله</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mode Auto Buttons */}
          {(!mode || mode === 'auto') && (
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={isDrawdownLocked}
                onClick={() => onAutoTrade('LONG')}
                className={`py-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/50 font-mono text-xs flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(16,185,129,0.15)] ${
                  isDrawdownLocked
                    ? 'opacity-40 cursor-not-allowed filter grayscale text-slate-500'
                    : 'hover:bg-emerald-900/60 text-emerald-300 cursor-pointer'
                }`}
                title={isDrawdownLocked ? 'به دلیل پوزیشن در ضرر، ورود خودکار مسدود است' : 'بررسی فوری کَش آخرین تحلیل و ورود خودکار بدون تاخیر شبکه'}
              >
                <Bot className="w-4 h-4 animate-pulse text-emerald-400" />
                <span>ورود خودکار لانگ (Auto LONG)</span>
              </button>
              <button
                disabled={isDrawdownLocked}
                onClick={() => onAutoTrade('SHORT')}
                className={`py-2.5 rounded-xl bg-rose-950/40 border border-rose-500/50 font-mono text-xs flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(244,63,94,0.15)] ${
                  isDrawdownLocked
                    ? 'opacity-40 cursor-not-allowed filter grayscale text-slate-500'
                    : 'hover:bg-rose-900/60 text-rose-300 cursor-pointer'
                }`}
                title={isDrawdownLocked ? 'به دلیل پوزیشن در ضرر، ورود خودکار مسدود است' : 'بررسی فوری کَش آخرین تحلیل و ورود خودکار بدون تاخیر شبکه'}
              >
                <Bot className="w-4 h-4 animate-pulse text-rose-400" />
                <span>ورود خودکار شورت (Auto SHORT)</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const OrderExecutionPanel = React.memo(OrderExecutionPanelComponent);
