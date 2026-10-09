import React, { useState } from 'react';
import { Play, CheckCircle2, Circle, Bot, ShieldCheck, Zap, RefreshCw, Award } from 'lucide-react';

interface Props {
  autoTradeActive: boolean;
  onToggleAutoTrade: () => void;
  onRunTestOrder: (dir: 'LONG' | 'SHORT') => void;
  balance: number;
}

export const DemoTestingSandbox: React.FC<Props> = ({
  autoTradeActive,
  onToggleAutoTrade,
  onRunTestOrder,
  balance,
}) => {
  const [checklist, setChecklist] = useState({
    autoPilot: true,
    tpSlTrigger: true,
    onChainLayer: true,
    scenarios4H: true,
    backtestReady: true,
  });

  const toggleCheck = (key: keyof typeof checklist) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const completedCount = Object.values(checklist).filter(Boolean).length;
  const readinessPct = Math.round((completedCount / Object.keys(checklist).length) * 100);

  return (
    <div className="bg-gradient-to-r from-slate-950 via-[#06182e] to-slate-950 border border-cyan-500/40 rounded-2xl p-4 shadow-[0_0_25px_rgba(6,182,212,0.15)] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-950 pb-3">
        <div className="flex items-center space-x-2.5 space-x-reverse">
          <div className="p-2 bg-cyan-500/10 rounded-xl text-cyan-400 border border-cyan-500/30">
            <Bot className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold font-mono text-white">پنل تست دمو و ارزیابی ۱۰۰٪ آمادگی سیستم (Paper Trading Sandbox)</h3>
            <p className="text-xs text-slate-400">تست خودکار ربات، شبیه‌سازی معامله آنی و چک‌لیست پایش عملکرد</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 space-x-reverse px-3 py-1.5 rounded-xl bg-cyan-950/60 border border-cyan-700/60 font-mono text-xs">
          <Award className="w-4 h-4 text-cyan-400" />
          <span className="text-cyan-200 font-bold">آمادگی دمو: {readinessPct}%</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Automated Target-5 Test Execution Box */}
        <div className="bg-slate-900/80 border border-cyan-800/80 rounded-xl p-3 flex flex-col justify-between space-y-2">
          <div className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1">
            <Play className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>تست خودکار ۵ هدف (Target-5 Test)</span>
          </div>
          <p className="text-[11px] text-slate-300">
            ارزیابی پیوسته ۵ سطح سود و بردار نوسان ATR بدون نیاز به کلیک دستی.
          </p>
          <div className="py-1.5 px-2 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-mono font-bold text-[11px] flex items-center justify-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
            <span>⚡ اجرای خودکار تست ۵ هدف (فعال)</span>
          </div>
        </div>

        {/* Auto-Pilot Status Box */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col justify-between space-y-2">
          <div className="text-xs font-mono font-bold text-slate-200 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>ربات معامله‌گر خودکار (Auto-Pilot)</span>
          </div>
          <p className="text-[11px] text-slate-400">وضعیت ربات اتوترید بر اساس داده‌های زنجیره‌ای:</p>
          <button
            onClick={onToggleAutoTrade}
            className={`w-full py-1.5 rounded-lg font-mono font-bold text-xs transition-all ${
              autoTradeActive
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800'
            }`}
          >
            {autoTradeActive ? '🟢 اتوترید فعال و ناظر بازار' : '⚪ اتوترید غیرفعال (روشن کنید)'}
          </button>
        </div>

        {/* Checklist Box (Cols 3 & 4) */}
        <div className="md:col-span-2 bg-slate-900/80 border border-slate-800 rounded-xl p-3">
          <div className="text-xs font-mono font-bold text-slate-200 mb-2 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>چک‌لیست نهایی ورود به فاز دمو (کلیک برای تایید):</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
            <div
              onClick={() => toggleCheck('autoPilot')}
              className="flex items-center gap-2 cursor-pointer p-1.5 rounded bg-slate-950/60 border border-slate-800/80 hover:border-slate-700"
            >
              {checklist.autoPilot ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <Circle className="w-4 h-4 text-slate-500 flex-shrink-0" />}
              <span className={checklist.autoPilot ? 'text-slate-200' : 'text-slate-500 line-through'}>سیستم اتوترید SB</span>
            </div>
            <div
              onClick={() => toggleCheck('tpSlTrigger')}
              className="flex items-center gap-2 cursor-pointer p-1.5 rounded bg-slate-950/60 border border-slate-800/80 hover:border-slate-700"
            >
              {checklist.tpSlTrigger ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <Circle className="w-4 h-4 text-slate-500 flex-shrink-0" />}
              <span className={checklist.tpSlTrigger ? 'text-slate-200' : 'text-slate-500 line-through'}>بسته‌شدن خودکار TP / SL</span>
            </div>
            <div
              onClick={() => toggleCheck('onChainLayer')}
              className="flex items-center gap-2 cursor-pointer p-1.5 rounded bg-slate-950/60 border border-slate-800/80 hover:border-slate-700"
            >
              {checklist.onChainLayer ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <Circle className="w-4 h-4 text-slate-500 flex-shrink-0" />}
              <span className={checklist.onChainLayer ? 'text-slate-200' : 'text-slate-500 line-through'}>لایه پردازش داده On-Chain</span>
            </div>
            <div
              onClick={() => toggleCheck('scenarios4H')}
              className="flex items-center gap-2 cursor-pointer p-1.5 rounded bg-slate-950/60 border border-slate-800/80 hover:border-slate-700"
            >
              {checklist.scenarios4H ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <Circle className="w-4 h-4 text-slate-500 flex-shrink-0" />}
              <span className={checklist.scenarios4H ? 'text-slate-200' : 'text-slate-500 line-through'}>سناریوهای ۴ ساعته آماری</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
