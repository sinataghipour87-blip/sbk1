import React from 'react';
import { TrendingUp, ShieldCheck, Zap, Activity, BarChart2 } from 'lucide-react';

interface TickerBarProps {
  btcPrice: number;
}

export const TickerBar: React.FC<TickerBarProps> = ({ btcPrice }) => {
  const btcFormatted = btcPrice.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const btcStats = [
    { label: 'نماد منحصر‌به‌فرد:', value: 'BTC / USDT (بیت‌کوین)', icon: '🟠', highlight: true },
    { label: 'قیمت زنده:', value: `$${btcFormatted}`, icon: '⚡', isPrice: true },
    { label: 'تغییر ۲۴ ساعته:', value: '+2.84%', positive: true, icon: '📈' },
    { label: 'حجم ۲۴س بیت‌کوین:', value: '$38.4B USDT', icon: '📊' },
    { label: 'شاخص نوسان پایتون (GARCH):', value: '1.42% (کم‌ریسک)', icon: '🔮' },
    { label: 'تراکم اوردر بوک (OBI):', value: '+68% فشار خرید', positive: true, icon: '🌊' },
  ];

  return (
    <div className="bg-[#020510]/95 border-y border-emerald-500/35 px-4 py-2 overflow-x-auto scrollbar-none shadow-[0_0_20px_rgba(16,185,129,0.1)] backdrop-blur-md">
      <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-6 text-xs whitespace-nowrap min-w-max">
        <div className="flex items-center gap-6">
          <span className="text-[11px] font-mono text-emerald-300 font-bold flex items-center gap-1.5 bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
            <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> مانیتورینگ اختصاصی بیت‌کوین (BTC ONLY):
          </span>
          {btcStats.map((stat, index) => (
            <div
              key={`btc_stat_${index}`}
              className="flex items-center gap-2 pl-4 border-l border-emerald-900/50"
            >
              <span>{stat.icon}</span>
              <span className="text-slate-400 font-sans">{stat.label}</span>
              <span
                className={`font-mono font-bold ${
                  stat.isPrice
                    ? 'text-emerald-300 text-sm tabular-nums'
                    : stat.highlight
                    ? 'text-slate-100'
                    : stat.positive === true
                    ? 'text-emerald-400'
                    : 'text-slate-300'
                }`}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 px-3 py-1 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.2)]">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>حالت تک‌ارز امن: ۱۰۰٪ تمرکز روی بیت‌کوین</span>
        </div>
      </div>
    </div>
  );
};

