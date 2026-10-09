import React, { useState, useEffect } from 'react';
import { Layers, ShieldCheck, RefreshCw, Zap, Globe, Cpu, CheckCircle2, Sliders, AlertTriangle } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { crossExchangeCorrelationEngine, CrossExchangeAnalysisResult } from '../services/crossExchangeCorrelationEngine';

interface Props {
  currentPrice?: number;
  obi?: number;
  orderSizeUsd?: number;
}

export const CrossExchangeCorrelationWidget: React.FC<Props> = ({
  currentPrice = 0,
  obi = 0.12,
  orderSizeUsd = 100000
}) => {
  const [data, setData] = useState<CrossExchangeAnalysisResult | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  useEffect(() => {
    const res = crossExchangeCorrelationEngine.analyzeCrossExchangeMetrics(currentPrice, orderSizeUsd, obi);
    setData(res);
  }, [currentPrice, obi, orderSizeUsd]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      const res = crossExchangeCorrelationEngine.analyzeCrossExchangeMetrics(currentPrice, orderSizeUsd, obi);
      setData(res);
      setIsRefreshing(false);
    }, 800);
  };

  if (!data) return null;

  return (
    <CollapsibleCard
      title="تحلیلگر همبستگی متقاطع بین‌صرافی و محافظ اسلیپیج (Cross-Exchange Correlation & Slippage Guard)"
      badge="نقدینگی عمقی جهانی"
      badgeColor="text-cyan-300 bg-cyan-950/80 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)]"
      defaultOpen={true}
      icon={<Globe className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'در حال سنجش صرافی‌ها...' : 'برورسانی عمق بین‌صرافی'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Banner */}
        <div className="bg-[#020d1c] border border-cyan-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-cyan-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-500/20 rounded-lg text-cyan-300 border border-cyan-500/30">
                <Globe className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  همبستگی متقاطع اردر بوک جهانی (Binance, Coinbase, OKX, Bybit):
                </span>
                <span className="text-[10px] text-slate-400 font-sans mt-0.5 block">
                  تایید اعتبار روند و محاسبه نقدینگی واقعی بدون ریسک دستکاری صرافی واحد
                </span>
              </div>
            </div>

            <span className="px-3 py-1 rounded-lg bg-cyan-950 text-cyan-300 border border-cyan-500/50 text-xs font-bold font-sans">
              ضریب همبستگی: {Math.round(data.crossCorrelationIndex * 100)}٪
            </span>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-center">
            <div className="bg-[#041328] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">نقدینگی عمقی ۰.۱٪:</span>
              <span className="text-base font-black text-cyan-300">${(data.totalGlobalLiquidity0_1pctUsd / 1000000).toFixed(1)}M</span>
            </div>

            <div className="bg-[#041328] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">اسلیپیج تخمینی:</span>
              <span className="text-base font-black text-emerald-400">{data.slippageGuardStatus.estimatedSlippagePct}٪</span>
            </div>

            <div className="bg-[#041328] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">تعداد اسلایس آیس‌برگ:</span>
              <span className="text-base font-black text-indigo-300">{data.slippageGuardStatus.recommendedOrderSlicingParts} بخش</span>
            </div>

            <div className="bg-[#041328] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">گپ قیمتی آربیتراژ:</span>
              <span className="text-base font-black text-amber-300">${data.arbitrageGapUsd}</span>
            </div>
          </div>

          <p className="text-[11px] text-slate-200 leading-relaxed font-sans bg-[#041021] p-2.5 rounded-xl border border-cyan-900/40">
            {data.slippageGuardStatus.executionGuidanceFa}
          </p>
        </div>

        {/* Individual Exchanges Table */}
        <div className="space-y-1.5">
          <span className="text-slate-300 font-sans font-bold text-[11px] block">
            جزئیات عمق اردر بوک و لاتنسی ۴ صرافی برتر:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10.5px]">
            {data.exchanges.map((ex) => (
              <div key={`${ex.exchange}_${ex.marketType}_${ex.symbol}`} className="bg-[#030a17] border border-cyan-950 p-2.5 rounded-xl flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-white block">{ex.exchangeName}</span>
                    <span className={`px-1.5 py-0.2 text-[8.5px] rounded font-bold ${ex.marketType.includes('FUTURES') ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/50' : 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'}`}>
                      {ex.marketType.includes('FUTURES') ? 'FUTURES' : 'SPOT'}
                    </span>
                  </div>
                  <span className="text-[9.5px] text-slate-400 font-sans block mt-0.5">
                    عمق خرید/فروش: ${(ex.bidDepthUsd0_1pct / 1000000).toFixed(1)}M / ${(ex.askDepthUsd0_1pct / 1000000).toFixed(1)}M
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-cyan-300 font-bold block">{ex.latencyMs || ex.latency}ms</span>
                  <span className="text-[9.5px] text-emerald-400 font-mono">اسپرد: ${ex.bidAskSpreadUsd}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
