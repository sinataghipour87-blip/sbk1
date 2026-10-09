import React, { useMemo } from 'react';
import {
  Ban,
  ShieldAlert,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Gauge,
  Activity,
  Layers,
  Zap,
  TrendingDown,
  Info
} from 'lucide-react';
import {
  AnalysisResult,
  NoTradePredictionReport,
  NoTradeRiskFactorType,
} from '../types/trading';
import { evaluateNoTradeProbability } from '../services/noTradePredictorEngine';

interface NoTradePredictorWidgetProps {
  analysis?: AnalysisResult | null;
  currentPrice: number;
}

export const NoTradePredictorWidget: React.FC<NoTradePredictorWidgetProps> = ({
  analysis,
  currentPrice,
}) => {
  const price = currentPrice > 0 ? currentPrice : (analysis?.price ?? 0);

  const report: NoTradePredictionReport = useMemo(() => {
    if (analysis?.noTradePrediction) {
      return analysis.noTradePrediction;
    }
    const candles = analysis?.rawCandles || analysis?.candles || [];
    return evaluateNoTradeProbability(candles, price, analysis);
  }, [analysis, price]);

  // استایل دکمه تصمیم وتو
  const getVetoBadge = (veto: NoTradePredictionReport['vetoAction']) => {
    switch (veto) {
      case 'HARD_LOCK_NO_TRADE':
        return {
          label: '🚨 وتوی قطعی معامله (STATISTICAL NO-TRADE)',
          style: 'text-rose-300 bg-rose-950 border-rose-500 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.4)]',
          icon: Ban,
        };
      case 'CONDITIONAL_CAUTION':
        return {
          label: '⚠️ احتیاط بالا (HIGH UNCERTAINTY)',
          style: 'text-amber-300 bg-amber-950 border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.3)]',
          icon: AlertTriangle,
        };
      default:
        return {
          label: '✓ بستر معاملاتی استاندارد (SAFE)',
          style: 'text-emerald-300 bg-emerald-950 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]',
          icon: CheckCircle2,
        };
    }
  };

  const badge = getVetoBadge(report.vetoAction);
  const BadgeIcon = badge.icon;

  return (
    <div className="bg-slate-900/90 border border-rose-900/50 rounded-2xl p-4 shadow-2xl text-slate-100 flex flex-col gap-4">
      {/* هدر */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-rose-950/80 border border-rose-500/40 rounded-xl text-rose-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-rose-200 flex items-center gap-2">
              مدل مستقل پیش‌بینی احتمال عدم معامله (No-Trade Predictor Engine)
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-rose-950 text-rose-300 border border-rose-800">
                Statistical Circuit Breaker
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              ارزیابی داده‌محور احتمال نویز، شلاق، شوک خبری و نقدینگی؛ وتوی مستقل ورود حتی در صورت بالا بودن Long/Short Score
            </p>
          </div>
        </div>

        <div className={`px-3.5 py-1.5 rounded-xl border text-xs font-mono font-black flex items-center gap-1.5 ${badge.style}`}>
          <BadgeIcon className="w-4 h-4" />
          <span>{badge.label}</span>
        </div>
      </div>

      {/* پنل آماری اصلی احتمال No-Trade در برابر آستانه آماری */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <div className="text-center shrink-0">
            <div className="text-[10px] text-slate-400">احتمال نویز / عدم معامله</div>
            <div className={`font-mono text-2xl font-black ${
              report.isNoTradeTriggered ? 'text-rose-400 animate-pulse' : (report.noTradeProbabilityPct >= 50 ? 'text-amber-400' : 'text-emerald-400')
            }`}>
              {report.noTradeProbabilityPct}٪
            </div>
          </div>

          <div className="w-px h-10 bg-slate-800" />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-200">وضعیت وتوی آماری:</span>
              <span className="text-[10px] font-mono text-slate-400">
                (آستانه توقف معامله: &gt; {report.statisticalThresholdPct}٪)
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
              {report.overrideMessageFa}
            </p>
          </div>
        </div>

        {/* شاخص پیشرفت نسبت به آستانه */}
        <div className="w-full md:w-56 shrink-0 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex flex-col gap-1.5 text-xs font-mono">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">شدت ناامنی بازار:</span>
            <span className={report.isNoTradeTriggered ? 'text-rose-400 font-bold' : 'text-slate-300'}>
              {report.noTradeProbabilityPct}% / {report.statisticalThresholdPct}%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden relative">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                report.isNoTradeTriggered ? 'bg-rose-500' : (report.noTradeProbabilityPct >= 50 ? 'bg-amber-500' : 'bg-emerald-500')
              }`}
              style={{ width: `${Math.min(100, report.noTradeProbabilityPct)}%` }}
            />
            {/* خط نشانگر آستانه ۶۵٪ */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-400"
              style={{ left: `${report.statisticalThresholdPct}%` }}
              title="آستانه وتو ۶۵٪"
            />
          </div>
        </div>
      </div>

      {/* ۵ فاکتور بحرانی ناامنی بازار (Toxic Market Factors) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {report.riskFactors.map(factor => {
          const isTriggered = factor.isTriggered;

          return (
            <div
              key={factor.factor}
              className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                isTriggered
                  ? 'bg-rose-950/30 border-rose-600/60 shadow-md ring-1 ring-rose-500/30'
                  : factor.severityScore >= 50
                  ? 'bg-amber-950/20 border-amber-800/40'
                  : 'bg-slate-950/50 border-slate-800'
              }`}
            >
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
                  <span className="font-bold text-[11px] text-slate-200 truncate">
                    {factor.factorFa.split(' ')[0]}
                  </span>
                  <span className={`font-mono text-xs font-black ${
                    isTriggered ? 'text-rose-400' : (factor.severityScore >= 50 ? 'text-amber-400' : 'text-slate-400')
                  }`}>
                    {factor.severityScore}٪
                  </span>
                </div>

                <div className="text-[10px] text-slate-300 font-semibold mb-1">
                  {factor.factorFa}
                </div>
                <p className="text-[9px] text-slate-400 leading-relaxed">
                  {factor.evidenceFa}
                </p>
              </div>

              <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[9px] font-mono">
                <span className="text-slate-500">وزن: {Math.round(factor.weight * 100)}٪</span>
                <span className={`px-1.5 py-0.5 rounded font-bold border ${
                  isTriggered
                    ? 'text-rose-300 bg-rose-950 border-rose-700'
                    : 'text-slate-400 bg-slate-900 border-slate-800'
                }`}>
                  {isTriggered ? 'بحرانی ⚠️' : 'عادی'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
