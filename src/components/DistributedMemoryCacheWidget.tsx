/**
 * ⚡ ماژول رابط کاربری مدیریت حافظه کش توزیع‌شده (Distributed Memory Cache Widget)
 * نمایش عملکرد، نرخ برخورد (Hit Ratio)، تاخیر زیر ۱ میلی‌ثانیه و الگوهای موفق مغزها
 */

import React, { useState, useEffect } from 'react';
import { Cpu, Zap, Database, RefreshCw, CheckCircle2, HardDrive, Layers, Activity } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { distributedCache, DistributedCacheStats, CachedTradingPattern } from '../services/distributedMemoryCache';

export const DistributedMemoryCacheWidget: React.FC = () => {
  const [stats, setStats] = useState<DistributedCacheStats>(distributedCache.getCacheStats());
  const [isFlushing, setIsFlushing] = useState<boolean>(false);
  const [samplePattern, setSamplePattern] = useState<CachedTradingPattern | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      // شبیه‌سازی درخواست‌های مداوم مغزها به کش توزیع‌شده
      distributedCache.getPattern('BULLISH_BREAKOUT_30M');
      distributedCache.getPattern('WHALE_SWEEP_REVERSAL');
      setStats(distributedCache.getCacheStats());
    }, 2000);

    setSamplePattern(distributedCache.getPattern('BULLISH_BREAKOUT_30M'));
    return () => clearInterval(timer);
  }, []);

  const handleFlushCache = () => {
    setIsFlushing(true);
    setTimeout(() => {
      distributedCache.flushCache();
      setStats(distributedCache.getCacheStats());
      setIsFlushing(false);
    }, 800);
  };

  return (
    <CollapsibleCard
      title="ماژول مدیریت حافظه کش توزیع‌شده (Distributed Memory Cache) برای ۵ مغز پردازشی"
      badge="0.35ms Zero-Disk Lookup"
      badgeColor="text-cyan-300 bg-cyan-950/80 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
      defaultOpen={true}
      icon={<Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleFlushCache}
          disabled={isFlushing}
          className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isFlushing ? 'animate-spin' : ''}`} />
          <span>{isFlushing ? 'در حال همگام‌سازی کش...' : 'پاکسازی و همگام‌سازی کش'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-cyan-500/30 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-cyan-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-500/20 rounded-lg text-cyan-400 border border-cyan-500/30">
                <Zap className="w-4 h-4 text-cyan-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  شتاب‌دهنده حافظه RAM توزیع‌شده مغزهای پردازشی:
                </span>
                <span className="text-[10px] text-cyan-300 font-mono mt-0.5 block">
                  حذف کوئری‌های تکراری دیسک و دستیابی به سرعت پردازش صدم‌ثانیه‌ای
                </span>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold bg-emerald-950 text-emerald-300 border-emerald-500/50 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>وضعیت توزیع: فعال و همگام 🟢</span>
            </span>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-[11px]">
            <div className="bg-[#041124] p-2.5 rounded-xl border border-cyan-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">نرخ برخورد (Hit Ratio):</span>
              <span className="font-bold text-emerald-400 text-sm">{stats.hitRatioPct}٪</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-cyan-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">تاخیر میانگین دسترسی:</span>
              <span className="font-bold text-cyan-300 text-sm">{stats.averageLookupLatencyMs}ms</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-cyan-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">الگوهای کش‌شده در RAM:</span>
              <span className="font-bold text-indigo-300 text-sm">{stats.totalItemsCached} الگو</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-cyan-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">تعداد Hits / Misses:</span>
              <span className="font-bold text-amber-300 text-xs">{stats.cacheHits} / {stats.cacheMisses}</span>
            </div>
          </div>

          {/* Sample Pattern Detail */}
          {samplePattern && (
            <div className="bg-[#040e21] border border-cyan-900/60 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-cyan-200 font-bold font-sans">نمونه الگوی معاملاتی پرسرعت بازیابی‌شده از کش:</span>
                <span className="text-emerald-400 font-mono text-[10px]">وین‌ریت: {samplePattern.successRatePct}٪</span>
              </div>
              <p className="text-xs text-slate-200 font-sans">{samplePattern.patternNameFa}</p>
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
                <span>میانگین سود الگو: <strong className="text-emerald-300">+{samplePattern.avgProfitPct}٪</strong></span>
                <span>سرعت اجرا: {samplePattern.executionSpeedMs} میلی‌ثانیه</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
};
