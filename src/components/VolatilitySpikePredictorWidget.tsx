import React, { useState, useEffect } from 'react';
import {
  Zap,
  Flame,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Activity
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { evaluateVolatilitySpike, VolatilitySpikeReport } from '../services/volatilitySpikePredictor';

interface Props {
  analysis?: any;
  currentPrice?: number;
}

export const VolatilitySpikePredictorWidget: React.FC<Props> = ({ analysis, currentPrice = 0 }) => {
  const [report, setReport] = useState<VolatilitySpikeReport | null>(null);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);

  useEffect(() => {
    const res = evaluateVolatilitySpike(analysis, currentPrice);
    setReport(res);
  }, [analysis, currentPrice]);

  const handleRefresh = () => {
    setIsEvaluating(true);
    setTimeout(() => {
      const res = evaluateVolatilitySpike(analysis, currentPrice);
      setReport(res);
      setIsEvaluating(false);
    }, 600);
  };

  if (!report) return null;

  const isCritical = report.alertLevel === 'CRITICAL_SPIKE_IMMINENT';

  return (
    <CollapsibleCard
      title="ویجت پیش‌بینی نوسانات ناگهانی (Volatility Spike Predictor)"
      badge="هشدار پیش‌دستانه شارپ"
      badgeColor={isCritical ? "text-rose-300 bg-rose-950/80 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.4)] animate-pulse" : "text-amber-300 bg-amber-950/80 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.3)]"}
      defaultOpen={true}
      icon={<Flame className={`w-5 h-5 ${isCritical ? 'text-rose-400 animate-bounce' : 'text-amber-400'}`} />}
      headerAction={
        <button
          onClick={handleRefresh}
          disabled={isEvaluating}
          className="px-2.5 py-1 rounded-lg bg-amber-950 hover:bg-amber-900 border border-amber-500/50 text-amber-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isEvaluating ? 'animate-spin' : ''}`} />
          <span>{isEvaluating ? 'تحلیل همگرایی...' : 'بررسی پیش‌دستانه'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Main Alert Banner */}
        <div className={`p-4 rounded-2xl border ${
          isCritical 
            ? 'bg-rose-950/40 border-rose-500/60 shadow-xl' 
            : 'bg-[#020917] border-amber-500/40 shadow-xl'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-amber-950/80">
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-xl border ${isCritical ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'}`}>
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <div className="text-white font-bold font-sans text-xs">احتمال وقوع نوسان ناگهانی و شارپ:</div>
                <div className="text-[11px] text-amber-300 font-mono mt-0.5">
                  احتمال هشدار: {report.spikeProbabilityPct}٪ | جهت پیش‌بینی: [{report.expectedDirection}]
                </div>
              </div>
            </div>

            <span className={`px-3 py-1 rounded-xl border text-xs font-bold font-sans flex items-center gap-1 ${
              isCritical ? 'bg-rose-950 text-rose-300 border-rose-500/50' : 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
            }`}>
              {isCritical ? <AlertTriangle className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              <span>{isCritical ? 'وضعیت بحرانی / احتمال شلیک شارپ' : 'وضعیت پایدار'}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-3">
            <div className="bg-[#041124] p-3 rounded-xl border border-amber-950/80">
              <span className="text-[10px] text-slate-400 font-sans block mb-1">وضعیت فاندینگ‌ریت (Funding Rate):</span>
              <p className="text-[11px] text-slate-200 font-sans leading-relaxed">{report.fundingRateStatusFa}</p>
            </div>
            <div className="bg-[#041124] p-3 rounded-xl border border-amber-950/80">
              <span className="text-[10px] text-slate-400 font-sans block mb-1">عدم تقارن اردربوک (OBI Score):</span>
              <div className="flex items-center justify-between text-xs font-mono pt-1">
                <span className="text-slate-300">امتیاز فشار سفارشات:</span>
                <span className={`font-bold ${report.orderBookImbalanceScore >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {report.orderBookImbalanceScore > 0 ? `+${report.orderBookImbalanceScore}` : report.orderBookImbalanceScore}٪
                </span>
              </div>
            </div>
          </div>

          <div className="bg-[#040e21] p-3 rounded-xl border border-amber-900/40 text-[11px] text-slate-200 leading-relaxed font-sans flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{report.actionAdvisoryFa}</span>
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
