import React, { useState, useMemo } from 'react';
import {
  Layers,
  Zap,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Activity,
  CheckCircle2,
  Clock,
  Crosshair,
  Lock,
  Compass
} from 'lucide-react';
import { AnalysisResult, LiquidityMapReport, LiquidityPool, LiquidityPoolType, SweepReversalSetup } from '../types/trading';
import { generateLiquidityMap, detectLiquiditySweepReversal } from '../services/liquidityMapEngine';

interface LiquidityHeatmapProps {
  currentPrice: number;
  analysis?: AnalysisResult | null;
}

export const LiquidityHeatmapWidget: React.FC<LiquidityHeatmapProps> = ({ currentPrice, analysis }) => {
  const [filterSide, setFilterSide] = useState<'ALL' | 'BUY_SIDE' | 'SELL_SIDE'>('ALL');
  const [filterMitigated, setFilterMitigated] = useState<boolean>(false);

  const price = currentPrice > 0 ? currentPrice : (analysis?.price ?? 0);

  // استخراج یا تولید نقشه نقدینگی واقعی
  const liquidityMap: LiquidityMapReport = useMemo(() => {
    if (analysis?.liquidityMap) {
      return analysis.liquidityMap;
    }
    const candles = analysis?.rawCandles || analysis?.candles || [];
    return generateLiquidityMap(candles, price, analysis?.orderFlowFeatures, undefined, analysis?.atr);
  }, [analysis, price]);

  // ستاپ ریورسال با سوئیپ نقدینگی
  const sweepSetup: SweepReversalSetup | null = useMemo(() => {
    if (analysis?.sweepReversalSetup !== undefined) {
      return analysis.sweepReversalSetup;
    }
    const candles = analysis?.rawCandles || analysis?.candles || [];
    return detectLiquiditySweepReversal(candles, liquidityMap, price, analysis?.atr);
  }, [analysis, liquidityMap, price]);

  // فیلتر کردن استخرهای نقدینگی
  const filteredPools = useMemo(() => {
    return liquidityMap.pools.filter(pool => {
      if (filterSide === 'BUY_SIDE' && pool.side !== 'BUY_SIDE') return false;
      if (filterSide === 'SELL_SIDE' && pool.side !== 'SELL_SIDE') return false;
      if (filterMitigated && pool.isMitigated) return false;
      return true;
    }).sort((a, b) => b.magnetAttractionScore - a.magnetAttractionScore);
  }, [liquidityMap.pools, filterSide, filterMitigated]);

  // آیکون و برچسب هر نوع استخر نقدینگی
  const getPoolBadge = (type: LiquidityPoolType) => {
    switch (type) {
      case 'EQUAL_HIGHS':
        return { label: 'EQH (سقف‌های برابر)', color: 'text-amber-300 bg-amber-950/60 border-amber-500/40' };
      case 'EQUAL_LOWS':
        return { label: 'EQL (کف‌های برابر)', color: 'text-rose-300 bg-rose-950/60 border-rose-500/40' };
      case 'PREVIOUS_HIGH_LOW':
        return { label: 'PDH / PDL (سقف/کف سشن)', color: 'text-cyan-300 bg-cyan-950/60 border-cyan-500/40' };
      case 'LIQUIDATION_ZONE':
        return { label: 'کلاستر لیکوئیدیشن', color: 'text-purple-300 bg-purple-950/60 border-purple-500/40' };
      case 'ORDERBOOK_WALL':
        return { label: 'دیوار اوردر بوک', color: 'text-emerald-300 bg-emerald-950/60 border-emerald-500/40' };
      case 'VOLUME_NODE':
        return { label: 'گره حجمی POC', color: 'text-blue-300 bg-blue-950/60 border-blue-500/40' };
      case 'FVG':
        return { label: 'گپ ارزش منصفانه (FVG)', color: 'text-orange-300 bg-orange-950/60 border-orange-500/40' };
      case 'ORDER_BLOCK':
        return { label: 'اوردر بلاک نهادی (OB)', color: 'text-indigo-300 bg-indigo-950/60 border-indigo-500/40' };
      default:
        return { label: type, color: 'text-slate-300 bg-slate-800 border-slate-700' };
    }
  };

  return (
    <div className="bg-slate-900/90 border border-cyan-900/50 rounded-2xl p-4 shadow-2xl text-slate-100 flex flex-col gap-4">
      {/* هدر ویجت */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-cyan-950/80 border border-cyan-500/40 rounded-xl text-cyan-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-cyan-200 flex items-center gap-2">
              نقشه جامع استخرهای نقدینگی واقعی (Liquidity Pools Map)
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-cyan-950 text-cyan-400 border border-cyan-800">
                8 رده نقدینگی فعال
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              شناسایی عمیق استخرهای EQH, EQL, PDH/PDL, Liquidation, Walls, Volume Nodes, FVG و Order Blocks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[11px] bg-slate-950/90 border border-slate-800 px-2.5 py-1 rounded-lg">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400">بایاس نقدینگی:</span>
            <span className={`font-bold ${
              liquidityMap.netLiquidityBias === 'ATTRACTED_TO_BUY_SIDE'
                ? 'text-emerald-400'
                : (liquidityMap.netLiquidityBias === 'ATTRACTED_TO_SELL_SIDE' ? 'text-rose-400' : 'text-slate-300')
            }`}>
              {liquidityMap.netLiquidityBias === 'ATTRACTED_TO_BUY_SIDE' ? 'کشش به نقدینگی بالا (صعودی)' : (liquidityMap.netLiquidityBias === 'ATTRACTED_TO_SELL_SIDE' ? 'کشش به نقدینگی پایین (نزولی)' : 'متعادل')}
            </span>
          </div>
        </div>
      </div>

      {/* ۲۱. بخش پیش‌بینی مقصد نقدینگی (Liquidity Magnet Target) */}
      {liquidityMap.predictedTargetPool && (
        <div className="bg-gradient-to-r from-cyan-950/60 via-slate-900 to-indigo-950/60 border border-cyan-500/30 rounded-xl p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 border border-cyan-400/30 rounded-xl text-cyan-300">
              <Target className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-cyan-300 font-bold uppercase tracking-wider">
                  محتمل‌ترین هدف مغناطیسی حرکت قیمت (Predicted Target):
                </span>
                <span className="text-[11px] bg-cyan-950 text-cyan-200 border border-cyan-700/50 px-2 py-0.5 rounded font-bold">
                  {liquidityMap.predictedTargetPool.typeFa}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 leading-relaxed font-sans">
                {liquidityMap.predictionRationaleFa}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 bg-slate-950/80 px-3 py-2 rounded-xl border border-slate-800">
            <div className="text-right">
              <div className="text-[10px] text-slate-400">قیمت هدف مغناطیس</div>
              <div className="font-mono text-sm font-black text-cyan-300">
                ${liquidityMap.predictedTargetPool.centerPrice.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </div>
            </div>
            <div className="w-px h-8 bg-slate-800" />
            <div className="text-right">
              <div className="text-[10px] text-slate-400">ضریب کشش نقدینگی</div>
              <div className="font-mono text-sm font-black text-amber-300">
                {liquidityMap.predictedTargetPool.magnetAttractionScore}٪
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ۲۲. ردیاب بازگشت با هانت نقدینگی (Liquidity Sweep Reversal Detector) */}
      <div className="bg-slate-950/90 border border-indigo-900/40 rounded-xl p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-indigo-900/30">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-bold text-indigo-200">
              ردیاب بازگشت با هانت نقدینگی (Liquidity Sweep Reversal Detector)
            </h4>
          </div>
          <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800/60 px-2.5 py-0.5 rounded-full font-mono">
            توالی اجباری ۴ مرحله‌ای: Sweep + Rejection + Displacement + Reclaim
          </span>
        </div>

        {sweepSetup ? (
          <div className="flex flex-col gap-3">
            {/* نوار وضعیت ستاپ */}
            <div className={`p-3 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 ${
              sweepSetup.isReversalSetupActive
                ? (sweepSetup.direction === 'BULLISH_REVERSAL'
                    ? 'bg-emerald-950/60 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                    : 'bg-rose-950/60 border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.2)]')
                : 'bg-slate-900/80 border-amber-500/30'
            }`}>
              <div className="flex items-center gap-2.5">
                {sweepSetup.isReversalSetupActive ? (
                  <CheckCircle2 className={`w-5 h-5 ${sweepSetup.direction === 'BULLISH_REVERSAL' ? 'text-emerald-400' : 'text-rose-400'}`} />
                ) : (
                  <Clock className="w-5 h-5 text-amber-400 animate-spin" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-black ${
                      sweepSetup.isReversalSetupActive
                        ? (sweepSetup.direction === 'BULLISH_REVERSAL' ? 'text-emerald-300' : 'text-rose-300')
                        : 'text-amber-300'
                    }`}>
                      {sweepSetup.isReversalSetupActive ? '✓ ستاپ بازگشتی (Reversal) فعال شد' : '⏳ توالی سوئیپ در جریان (ستاپ هنوز مجاز نیست)'}
                    </span>
                    <span className="text-[10px] bg-slate-900 px-2 py-0.5 rounded border border-slate-700 font-mono">
                      {sweepSetup.direction === 'BULLISH_REVERSAL' ? 'چرخش صعودی (Bullish Reversal)' : 'چرخش نزولی (Bearish Reversal)'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-0.5">{sweepSetup.verdictFa}</p>
                </div>
              </div>

              {sweepSetup.isReversalSetupActive && (
                <div className="flex items-center gap-3 bg-slate-950/90 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-400 block">نقطه ورود:</span>
                    <span className="text-cyan-300 font-bold">${sweepSetup.entryPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">حد ضرر (SL):</span>
                    <span className="text-rose-400 font-bold">${sweepSetup.stopLossPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">تارگت استخر:</span>
                    <span className="text-emerald-400 font-bold">${sweepSetup.targetPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">R:R:</span>
                    <span className="text-amber-300 font-bold">1:{sweepSetup.riskRewardRatio}</span>
                  </div>
                </div>
              )}
            </div>

            {/* گام‌های ۴ گانه ساختاری */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {/* Step 1: Sweep */}
              <div className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                sweepSetup.stageProgressFa.sweep.status === 'DONE'
                  ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">1</span>
                    هانت نقدینگی (Sweep)
                  </span>
                  {sweepSetup.stageProgressFa.sweep.status === 'DONE' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                  )}
                </div>
                <p className="text-[10px] text-slate-300">{sweepSetup.stageProgressFa.sweep.noteFa}</p>
              </div>

              {/* Step 2: Rejection */}
              <div className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                sweepSetup.stageProgressFa.rejection.status === 'DONE'
                  ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">2</span>
                    ریجکشن (Rejection)
                  </span>
                  {sweepSetup.stageProgressFa.rejection.status === 'DONE' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                  )}
                </div>
                <p className="text-[10px] text-slate-300">{sweepSetup.stageProgressFa.rejection.noteFa}</p>
              </div>

              {/* Step 3: Displacement */}
              <div className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                sweepSetup.stageProgressFa.displacement.status === 'DONE'
                  ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">3</span>
                    جهش پرقدرت (Displacement)
                  </span>
                  {sweepSetup.stageProgressFa.displacement.status === 'DONE' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                  )}
                </div>
                <p className="text-[10px] text-slate-300">{sweepSetup.stageProgressFa.displacement.noteFa}</p>
              </div>

              {/* Step 4: Reclaim */}
              <div className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                sweepSetup.stageProgressFa.reclaim.status === 'DONE'
                  ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">4</span>
                    بازپس‌گیری سطح (Reclaim)
                  </span>
                  {sweepSetup.stageProgressFa.reclaim.status === 'DONE' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                  )}
                </div>
                <p className="text-[10px] text-slate-300">{sweepSetup.stageProgressFa.reclaim.noteFa}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-500" />
              در حال حاضر سوئیپ فعالی روی استخرهای ماژور نقدینگی ثبت نشده است. ستاپ چرخش تا تکمیل توالی ۴ مرحله‌ای قفل خواهد بود.
            </span>
            <span className="text-[11px] font-mono text-cyan-400">نظارت بلادرنگ فعال</span>
          </div>
        )}
      </div>

      {/* فیلترهای نقشه نقدینگی */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setFilterSide('ALL')}
            className={`px-2.5 py-1 rounded-lg transition-all ${
              filterSide === 'ALL' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            همه استخرها ({liquidityMap.pools.length})
          </button>
          <button
            onClick={() => setFilterSide('BUY_SIDE')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all ${
              filterSide === 'BUY_SIDE' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-emerald-300'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            نقدینگی خرید (بالای قیمت)
          </button>
          <button
            onClick={() => setFilterSide('SELL_SIDE')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all ${
              filterSide === 'SELL_SIDE' ? 'bg-rose-600 text-white font-bold' : 'text-slate-400 hover:text-rose-300'
            }`}
          >
            <ArrowDownRight className="w-3.5 h-3.5" />
            نقدینگی فروش (پایین قیمت)
          </button>
        </div>

        <button
          onClick={() => setFilterMitigated(!filterMitigated)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-xl border text-xs transition-all ${
            filterMitigated
              ? 'bg-amber-950/80 border-amber-500/50 text-amber-300'
              : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          <span>فقط استخرهای دست‌نخورده (Unmitigated)</span>
        </button>
      </div>

      {/* شبکه کارت‌های استخرهای نقدینگی */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
        {filteredPools.map(pool => {
          const badge = getPoolBadge(pool.type);
          const isTarget = liquidityMap.predictedTargetPool?.id === pool.id;
          const isAbove = pool.side === 'BUY_SIDE';

          return (
            <div
              key={pool.id}
              className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                isTarget
                  ? 'bg-cyan-950/40 border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/40'
                  : pool.side === 'BUY_SIDE'
                  ? 'bg-slate-950/70 border-emerald-900/30 hover:border-emerald-800/60'
                  : 'bg-slate-950/70 border-rose-900/30 hover:border-rose-800/60'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border font-sans ${badge.color}`}>
                    {badge.label}
                  </span>
                  <span className={`flex items-center gap-0.5 text-[10px] font-mono font-bold ${
                    isAbove ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {isAbove ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {pool.distancePct > 0 ? `+${pool.distancePct.toFixed(2)}%` : `${pool.distancePct.toFixed(2)}%`}
                  </span>
                </div>

                <div className="flex items-baseline justify-between mt-1">
                  <div className="font-mono text-base font-bold text-slate-100">
                    ${pool.centerPrice.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </div>
                  <div className="text-[11px] font-mono font-semibold text-amber-300">
                    ${(pool.estimatedVolumeUsd / 1000000).toFixed(1)}M USD
                  </div>
                </div>

                <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                  {pool.descriptionFa}
                </div>
              </div>

              <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">کشش مغناطیسی:</span>
                  <div className="w-14 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${isTarget ? 'bg-cyan-400' : 'bg-amber-400'}`}
                      style={{ width: `${pool.magnetAttractionScore}%` }}
                    />
                  </div>
                  <span className="font-mono font-bold text-slate-200">{pool.magnetAttractionScore}%</span>
                </div>

                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                  pool.isMitigated
                    ? 'bg-slate-800 text-slate-400'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                }`}>
                  {pool.isMitigated ? 'تست شده (Mitigated)' : 'دست‌نخورده (Fresh)'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
