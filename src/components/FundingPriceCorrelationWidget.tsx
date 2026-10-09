import React, { useState, useEffect } from 'react';
import {
  BarChart2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Activity
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { evaluateFundingPriceCorrelation, FundingCorrelationReport } from '../services/fundingPriceCorrelationEngine';

interface Props {
  analysis?: any;
  currentPrice?: number;
}

export const FundingPriceCorrelationWidget: React.FC<Props> = ({ analysis, currentPrice = 0 }) => {
  const [report, setReport] = useState<FundingCorrelationReport | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const res = evaluateFundingPriceCorrelation(analysis, currentPrice);
    setReport(res);
  }, [analysis, currentPrice]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      const res = evaluateFundingPriceCorrelation(analysis, currentPrice);
      setReport(res);
      setIsRefreshing(false);
    }, 600);
  };

  if (!report) return null;

  return (
    <CollapsibleCard
      title="ویجت همبستگی نوسانات فاندینگ و انحراف معیار قیمت (۱۰ دقیقه گذشته)"
      badge="پایش هزینه و همبستگی"
      badgeColor={report.costlyTradeWarning ? "text-rose-300 bg-rose-950/80 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)]" : "text-cyan-300 bg-cyan-950/80 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.3)]"}
      defaultOpen={true}
      icon={<BarChart2 className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'بروزرسانی...' : 'بررسی همبستگی'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-cyan-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-cyan-950">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-cyan-500/20 rounded-xl text-cyan-300 border border-cyan-500/30">
                <Activity className="w-4 h-4" /> ضریب همبستگی: {report.currentCorrelation}
              </div>
              <div>
                <div className="text-white font-bold font-sans text-xs">تحلیل ۱۰ دقیقه‌ای فاندینگ و انحراف معیار قیمت:</div>
                <div className="text-[11px] text-cyan-300 font-mono mt-0.5">{report.correlationStatusFa}</div>
              </div>
            </div>

            <span className={`px-3 py-1 rounded-xl border text-xs font-bold font-sans flex items-center gap-1 ${
              report.costlyTradeWarning ? 'bg-rose-950 text-rose-300 border-rose-500/50' : 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
            }`}>
              {report.costlyTradeWarning ? <AlertTriangle className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              <span>{report.costlyTradeWarning ? 'هشدار معاملات پرهزینه' : 'هزینه بهینه و ایمن'}</span>
            </span>
          </div>

          {/* Chart points breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10.5px]">
            {report.chartPoints.map((pt, idx) => (
              <div key={idx} className="bg-[#041124] p-2.5 rounded-xl border border-cyan-950 text-center space-y-1">
                <span className="text-[9.5px] text-slate-400 font-mono block">{pt.timeStr}</span>
                <div className="text-cyan-300 font-bold">فاندینگ: {pt.fundingRate}%</div>
                <div className="text-emerald-400 font-bold">انحراف: {pt.priceStdDev}%</div>
              </div>
            ))}
          </div>

          <div className="bg-[#040e21] p-3 rounded-xl border border-cyan-900/40 text-[11px] text-slate-200 leading-relaxed font-sans flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{report.warningMessageFa}</span>
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
