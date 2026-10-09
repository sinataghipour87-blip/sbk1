import React, { useMemo } from 'react';
import {
  Flame,
  AlertTriangle,
  Zap,
  TrendingDown,
  TrendingUp,
  ShieldAlert,
  Clock,
  Target,
  BarChart2,
  CheckCircle2,
  Compass
} from 'lucide-react';
import { AnalysisResult, LiquidationCascadePrediction } from '../types/trading';
import { predictLiquidationCascade } from '../services/derivativesMatrixEngine';

interface LiquidationCascadeWidgetProps {
  analysis?: AnalysisResult | null;
  currentPrice: number;
}

export const LiquidationCascadeWidget: React.FC<LiquidationCascadeWidgetProps> = ({ analysis, currentPrice }) => {
  const price = currentPrice > 0 ? currentPrice : (analysis?.price ?? 0);

  const cascade: LiquidationCascadePrediction = useMemo(() => {
    if (analysis?.liquidationCascadePrediction) {
      return analysis.liquidationCascadePrediction;
    }
    const candles = analysis?.rawCandles || analysis?.candles || [];
    return predictLiquidationCascade(candles, price, analysis?.liquidityMap, undefined, analysis?.atr);
  }, [analysis, price]);

  // تعیین استایل بر اساس سطح خطر
  const getAlertBadge = (level: LiquidationCascadePrediction['cascadeAlertLevel']) => {
    switch (level) {
      case 'CRITICAL_IMMINENT':
        return { label: '🔥 خطر حیاتی Squeeze آبشاری (فوری)', color: 'text-rose-300 bg-rose-950 border-rose-500 animate-pulse' };
      case 'HIGH_BUILDUP':
        return { label: '⚡ احتمال بالای دومینوی لیکوئیدیشن', color: 'text-amber-300 bg-amber-950 border-amber-500' };
      case 'ELEVATED':
        return { label: '⚠️ افزایش تراکم اهرم‌ها', color: 'text-cyan-300 bg-cyan-950 border-cyan-500' };
      default:
        return { label: '🛡️ اهرم‌ها در محدوده امن', color: 'text-emerald-300 bg-emerald-950 border-emerald-500' };
    }
  };

  const alertStyle = getAlertBadge(cascade.cascadeAlertLevel);

  return (
    <div className="bg-slate-900/90 border border-rose-900/50 rounded-2xl p-4 shadow-2xl text-slate-100 flex flex-col gap-3">
      {/* هدر */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-rose-950/80 border border-rose-500/40 rounded-xl text-rose-400">
            <Flame className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-rose-200 flex items-center gap-2">
              پیش‌بینی‌کننده آبشاری لیکوئیدیشن (Liquidation Cascade Predictor)
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-rose-950 text-rose-300 border border-rose-800">
                پیش‌بینی قبل از وقوع Squeeze
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              پایش تراکم OI، نرخ فاندینگ ریت، فشار Squeeze و قیمت ماشه‌چکان دومینوی لیکوئیدیشن
            </p>
          </div>
        </div>

        <div className={`px-3 py-1 rounded-xl border text-xs font-mono font-bold ${alertStyle.color}`}>
          {alertStyle.label}
        </div>
      </div>

      {/* نوار شاخص اصلی خطر آبشاری */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-center shrink-0">
            <div className="text-[10px] text-slate-400">احتمال وقوع Squeeze</div>
            <div className={`font-mono text-xl font-black ${
              cascade.cascadeProbabilityPct >= 70 ? 'text-rose-400' : (cascade.cascadeProbabilityPct >= 40 ? 'text-amber-400' : 'text-emerald-400')
            }`}>
              {cascade.cascadeProbabilityPct}٪
            </div>
          </div>

          <div className="w-px h-10 bg-slate-800" />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-200">
                جهت پیش‌بینی شده:
              </span>
              <span className={`text-xs font-black font-mono px-2 py-0.5 rounded border ${
                cascade.predictedCascadeDirection === 'LONG_SQUEEZE_CASCADE'
                  ? 'text-rose-300 bg-rose-950 border-rose-700'
                  : (cascade.predictedCascadeDirection === 'SHORT_SQUEEZE_CASCADE' ? 'text-emerald-300 bg-emerald-950 border-emerald-700' : 'text-slate-300 bg-slate-800 border-slate-700')
              }`}>
                {cascade.predictedCascadeDirection === 'LONG_SQUEEZE_CASCADE' ? 'Long Squeeze (آبشار ریزشی)' : (cascade.predictedCascadeDirection === 'SHORT_SQUEEZE_CASCADE' ? 'Short Squeeze (جهش انفجاری)' : 'ریسک پایین')}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1">{cascade.verdictFa}</p>
          </div>
        </div>

        {/* قیمت ماشه‌چکان و حجم تخمینی */}
        <div className="flex items-center gap-3 shrink-0 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
          <div className="text-right">
            <div className="text-[10px] text-slate-400">قیمت ماشه‌چکان (Tipping Price)</div>
            <div className="font-mono text-sm font-black text-rose-300">
              ${cascade.squeezeTriggerPrice.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </div>
          </div>
          <div className="w-px h-8 bg-slate-800" />
          <div className="text-right">
            <div className="text-[10px] text-slate-400">حجم لیکوئیدیشن تخمینی</div>
            <div className="font-mono text-sm font-black text-amber-300">
              ${(cascade.estimatedCascadeVolumeUsd / 1000000).toFixed(1)}M USD
            </div>
          </div>
        </div>
      </div>

      {/* فاکتورهای ریسک و توصیه مدیریت ریسک */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {/* فاکتورهای خطر شناسایی شده */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center gap-1.5 font-bold text-amber-400 mb-2 border-b border-slate-800 pb-1.5">
            <ShieldAlert className="w-4 h-4" />
            <span>فاکتورهای ریسک شناسایی شده قبل از Squeeze:</span>
          </div>
          <ul className="space-y-1.5 text-[11px] text-slate-300 list-disc list-inside">
            {cascade.riskFactorsFa.map((factor, i) => (
              <li key={i}>{factor}</li>
            ))}
          </ul>
        </div>

        {/* توصیه مدیریت ریسک معامله‌گر */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 font-bold text-cyan-400 mb-2 border-b border-slate-800 pb-1.5">
              <Compass className="w-4 h-4" />
              <span>دستورالعمل هوشمند مدیریت ریسک:</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {cascade.mitigationAdviceFa}
            </p>
          </div>

          <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
            <span>فاصله تا قیمت ماشه‌چکان: <strong className="text-amber-300 font-mono">{cascade.distanceToCascadeTriggerPct}%</strong></span>
            <span>زمان تخمینی تا نقطه بحرانی: <strong className="text-cyan-300 font-mono">~{cascade.timeToPotentialCascadeMin} دقیقه</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
};
