import React, { useEffect, useState } from 'react';
import { Clock, RefreshCw, Zap, Activity, Menu, Moon, Sun, Wallet } from 'lucide-react';

interface ChartTopBarProps {
  onRefresh: () => void;
  isFetching: boolean;
  source: string;
  isLive?: boolean;
  isDeepBlack?: boolean;
  onToggleTheme?: () => void;
  onOpenSidebar?: () => void;
  balance: number;
  onToggleWallet: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const ChartTopBar: React.FC<ChartTopBarProps> = ({
  onRefresh,
  isFetching,
  source,
  isLive = true,
  isDeepBlack = false,
  onToggleTheme,
  onOpenSidebar,
  balance,
  onToggleWallet,
}) => {
  const [timeLeft, setTimeLeft] = useState({ mm: '00', ss: '00', remaining: 0, progress: 0 });

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const utcSeconds = now.getUTCMinutes() * 60 + now.getUTCSeconds();
      const secondsPassed = utcSeconds % 900; // 15 mins = 900s
      const remaining = 900 - secondsPassed;
      const mm = Math.floor(remaining / 60).toString().padStart(2, '0');
      const ss = (remaining % 60).toString().padStart(2, '0');
      const progress = Math.round(((900 - remaining) / 900) * 100);

      setTimeLeft({ mm, ss, remaining, progress });
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, []);

  const timerColor =
    timeLeft.remaining > 300
      ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
      : timeLeft.remaining > 120
      ? 'text-amber-400 border-amber-500/40 bg-amber-500/10'
      : 'text-rose-400 border-rose-500/40 bg-rose-500/10 animate-pulse';

  return (
    <div className="bg-[#030816]/95 border border-emerald-500/35 rounded-2xl p-2.5 px-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[0_0_25px_rgba(16,185,129,0.12)] backdrop-blur-xl relative mb-2 hud-corner hud-scanline">
      {/* Top Cyber Glow Stripe */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-emerald-400 via-slate-200 to-transparent shadow-[0_0_12px_#10b981] pointer-events-none" />

      {/* 15-min Candle Timer */}
      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span className="text-xs text-slate-200 font-medium font-mono">بسته شدن کندل ۱۵ دقیقه‌ای:</span>
        </div>

        <div className={`px-2.5 py-0.5 rounded-lg border font-mono font-bold text-sm tracking-wider shadow-[0_0_12px_rgba(16,185,129,0.2)] ${timerColor}`}>
          {timeLeft.mm}:{timeLeft.ss}
        </div>

        <div className="hidden md:flex items-center gap-2 pl-2 border-r border-emerald-900/60">
          <div className="w-24 bg-emerald-950/80 rounded-full h-1.5 overflow-hidden border border-emerald-900/40">
            <div
              className="bg-emerald-400 h-full rounded-full transition-all duration-1000 shadow-[0_0_8px_#10b981]"
              style={{ width: `${timeLeft.progress}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-emerald-300">{timeLeft.progress}%</span>
        </div>
      </div>

      {/* Status & Action Buttons */}
      <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end relative">
        <div className="flex items-center gap-2 text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2.5 py-1 rounded-xl text-xs font-mono shadow-[0_0_12px_rgba(16,185,129,0.25)]">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-bold text-[11px]">زنده (LIVE)</span>
          <span className="text-emerald-300/70 text-[10px]">({source})</span>
        </div>

        {/* Wallet Dropdown Button */}
        <div className="relative">
          <button
            id="wallet-topbar-button"
            onClick={onToggleWallet}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 hover:from-emerald-900 hover:to-indigo-900 text-slate-100 font-bold text-xs border border-emerald-400/60 transition cursor-pointer shadow-[0_0_18px_rgba(16,185,129,0.3)]"
            title="مشاهده کیف پول و موجودی"
          >
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span className="font-mono">${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </button>
        </div>

        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 hover:from-emerald-900 hover:to-indigo-900 text-slate-100 font-bold text-xs border border-emerald-400/60 transition cursor-pointer shadow-[0_0_18px_rgba(16,185,129,0.3)] hover:shadow-[0_0_28px_rgba(16,185,129,0.5)]"
          >
            <Menu className="w-4 h-4 text-emerald-300 animate-pulse" />
            <span className="font-mono">سیستم</span>
          </button>
        )}

        <button
          onClick={onRefresh}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/80 hover:border-emerald-500 text-emerald-200 hover:text-white transition-all disabled:opacity-50 text-xs font-medium cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isFetching ? 'animate-spin' : ''}`} />
          <span>به‌روزرسانی</span>
        </button>

        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className={`p-1.5 rounded-lg border transition-all flex items-center gap-1 text-xs font-mono font-bold ${
              isDeepBlack
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30'
                : 'bg-slate-900 text-slate-300 border-emerald-900/60 hover:text-emerald-300 hover:border-emerald-500'
            }`}
            title={isDeepBlack ? 'تغییر به تم تاریک معمولی' : 'فعال‌سازی تم تاریک مطلق (Deep Black OLED)'}
          >
            {isDeepBlack ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-emerald-400" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};
