import React from 'react';
import { ShieldCheck, Zap } from 'lucide-react';
import type { AnalysisResult } from '../types/trading';

interface TickerBarProps {
  btcPrice: number;
  analysis: AnalysisResult | null;
  isLive: boolean;
}

export const TickerBar: React.FC<TickerBarProps> = ({ btcPrice, analysis, isLive }) => {
  const hasPrice = Number.isFinite(btcPrice) && btcPrice > 0;
  const btcFormatted = hasPrice
    ? btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'ناموجود';
  const recentObi = analysis?.realObiData;
  const hasLiveObi = isLive &&
    recentObi?.status === 'LIVE' &&
    recentObi.obi !== null &&
    Number.isFinite(recentObi.obi) &&
    Date.now() - recentObi.timestamp >= 0 &&
    Date.now() - recentObi.timestamp <= 15_000;
  const liveVolume = analysis?.canonicalSnapshot?.feeds.find(
    (feed) => feed.status === 'LIVE' &&
      Date.now() - feed.timestampUtc >= 0 &&
      Date.now() - feed.timestampUtc <= 15_000 &&
      Number.isFinite(feed.volume24hUsd) &&
      (feed.volume24hUsd ?? 0) > 0,
  )?.volume24hUsd;

  const btcStats = [
    { label: 'نماد:', value: 'BTC / USDT (بیت‌کوین)', icon: '🟠', highlight: true },
    { label: 'قیمت:', value: isLive && hasPrice ? `$${btcFormatted}` : 'دادهٔ زنده تأیید نشده', icon: '⚡', isPrice: true },
    {
      label: 'حجم ۲۴ ساعته:',
      value: liveVolume ? `$${liveVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'داده موجود نیست',
      icon: '📊',
    },
    {
      label: 'نوسان ATR:',
      value: isLive && Number.isFinite(analysis?.volatilityPct)
        ? `${analysis!.volatilityPct!.toFixed(2)}٪`
        : 'داده موجود نیست',
      icon: '📉',
    },
    {
      label: 'عدم‌تعادل دفتر سفارش (OBI):',
      value: hasLiveObi
        ? `${recentObi.obi! > 0 ? '+' : ''}${(recentObi.obi! * 100).toFixed(1)}٪`
        : 'دادهٔ زنده موجود نیست',
      icon: '🌊',
      positive: hasLiveObi && recentObi.obi! > 0,
    },
    { label: 'تغییر ۲۴ ساعته:', value: 'داده موجود نیست', icon: '—' },
  ];

  return (
    <div className="bg-[#020510]/95 border-y border-emerald-500/35 px-3 sm:px-4 py-3 shadow-[0_0_20px_rgba(16,185,129,0.1)] backdrop-blur-md">
      <div className="max-w-[1600px] mx-auto space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-emerald-300 font-bold flex items-center gap-1.5 bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
            <Zap aria-hidden="true" className="w-3.5 h-3.5 text-emerald-400" /> پایش بیت‌کوین (BTC/USDT)
          </span>
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-300 bg-slate-900/80 border border-slate-700 px-3 py-1 rounded-full">
            <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isLive ? 'فید بازار معتبر' : 'دادهٔ بازار تأیید نشده'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {btcStats.map((stat) => (
            <div key={stat.label} className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-950/70 bg-slate-950/50 px-3 py-2">
              <span aria-hidden="true">{stat.icon}</span>
              <span className="text-slate-400 font-sans">{stat.label}</span>
              <span
                dir={stat.isPrice || stat.label.includes('حجم') ? 'ltr' : undefined}
                className={`font-mono font-bold ${
                  stat.isPrice
                    ? 'text-emerald-300 text-sm tabular-nums'
                    : stat.highlight
                      ? 'text-slate-100'
                      : stat.positive
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                }`}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
