import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Flame,
  Clock,
  Activity,
  AlertOctagon,
  CheckCircle2,
  RefreshCw,
  Gauge,
  Lock,
} from 'lucide-react';
import {
  newsShockFirewallService,
  NewsShockFirewallReport,
  HighImpactEconomicEvent,
} from '../services/newsShockFirewall';
import { AnalysisResult } from '../types/trading';

interface NewsShockFirewallWidgetProps {
  analysis?: AnalysisResult | null;
}

export const NewsShockFirewallWidget: React.FC<NewsShockFirewallWidgetProps> = ({ analysis }) => {
  const [report, setReport] = useState<NewsShockFirewallReport>(() =>
    newsShockFirewallService.evaluateNewsShockFirewall(analysis ?? null)
  );

  const refreshReport = () => {
    setReport(newsShockFirewallService.evaluateNewsShockFirewall(analysis ?? null));
  };

  useEffect(() => {
    refreshReport();
    const interval = setInterval(refreshReport, 15000);
    return () => clearInterval(interval);
  }, [analysis]);

  const getPhaseBadge = (phase: string) => {
    switch (phase) {
      case 'DURING_SHOCK':
        return {
          bg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          dot: 'bg-rose-500 animate-ping',
        };
      case 'PRE_EVENT':
        return {
          bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          dot: 'bg-amber-400 animate-pulse',
        };
      case 'POST_STABILIZATION':
        return {
          bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
          dot: 'bg-cyan-400',
        };
      default:
        return {
          bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          dot: 'bg-emerald-400',
        };
    }
  };

  const badge = getPhaseBadge(report.phase);

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden transition-all duration-300 hover:border-slate-700">
      {/* Background Glow */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
            <Flame className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">
                دیوار آتش شوک خبری (News Shock Firewall)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                بند ۴۴ استراتژی
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              تشخیص تقویم رویدادهای پرریسک (CPI، FOMC، NFP) و مسدودسازی هوشمند تله‌های Whipsaw بر اساس نوسان و اسپرد زنده
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={`px-2.5 py-1 rounded-full border text-xs font-bold flex items-center gap-1.5 ${badge.bg}`}>
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            <span>{report.phaseLabelFa}</span>
          </div>
          <button
            onClick={refreshReport}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
            title="به‌روزرسانی وضعیت فایروال"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Directive Banner */}
      <div
        className={`p-3 rounded-xl border mb-4 text-xs font-medium leading-relaxed flex items-start gap-2.5 ${
          !report.isTradeAllowed
            ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            : report.phase === 'PRE_EVENT'
            ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
            : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
        }`}
      >
        {!report.isTradeAllowed ? (
          <AlertOctagon className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="space-y-1">
          <div className="font-bold">دستورالعمل نظارتی فایروال: {report.actionVerdictLabelFa}</div>
          <p className="opacity-90">{report.directiveFa}</p>
        </div>
      </div>

      {/* Realtime Volatility & Liquidity Shock Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {/* ATR Volatility */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>نوسان ATR زنده</span>
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-base font-bold text-slate-100">
            {report.realtimeMetrics.currentAtr.toFixed(1)} USD
          </div>
          <div className="text-[10px] text-slate-400">
            نسبت به میانگین: {report.realtimeMetrics.volatilityExpansionRatio.toFixed(2)}x
          </div>
        </div>

        {/* Spread Bps */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>اسپرد نقدینگی</span>
            <Gauge className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-base font-bold text-slate-100">
            {report.realtimeMetrics.currentSpreadBps.toFixed(1)} bps
          </div>
          <div className="text-[10px] text-slate-400">
            تخریب عمق: {report.realtimeMetrics.liquiditySpreadDeteriorationRatio.toFixed(2)}x
          </div>
        </div>

        {/* Allowed Leverage */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>سقف اهرم مجاز</span>
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className={`text-base font-bold ${report.allowedLeverageCap === 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {report.allowedLeverageCap === 0 ? 'معامله ممنوع' : `${report.allowedLeverageCap}x`}
          </div>
          <div className="text-[10px] text-slate-400">
            ضریب حجم: {(report.positionSizeMultiplier * 100).toFixed(0)}%
          </div>
        </div>

        {/* Whipsaw Trap */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>تله رفت و برگشتی</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className={`text-base font-bold ${report.whipsawProtectionActive ? 'text-rose-400' : 'text-slate-300'}`}>
            {report.whipsawProtectionActive ? 'کشف شد (فعال)' : 'غیرفعال (عادی)'}
          </div>
          <div className="text-[10px] text-slate-400">
            گارد ضد شکار استاپ
          </div>
        </div>
      </div>

      {/* Upcoming High-Impact Economic Events Calendar */}
      <div className="space-y-2">
        <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          تقویم زنده رویدادهای سنگین اقتصادی (CPI, FOMC, NFP)
        </span>

        <div className="space-y-2">
          {report.upcomingEvents.map((evt: HighImpactEconomicEvent) => (
            <div
              key={evt.id}
              className={`p-3 rounded-xl border transition-all ${
                report.activeEvent?.id === evt.id
                  ? 'bg-rose-950/30 border-rose-500/50'
                  : 'bg-slate-950/50 border-slate-800/80'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                      evt.impactLevel === 'EXTREME'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {evt.category} • اثر {evt.impactLevel === 'EXTREME' ? 'بحرانی' : 'بالا'}
                  </span>
                  <span className="text-xs font-bold text-slate-200">{evt.titleFa}</span>
                </div>
                <div className="text-xs font-bold text-amber-300">{evt.timeAgoFa}</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                <div>
                  <span className="text-emerald-400 font-bold">سناریوی صعودی: </span>
                  {evt.bullishScenarioFa}
                </div>
                <div>
                  <span className="text-rose-400 font-bold">سناریوی نزولی: </span>
                  {evt.bearishScenarioFa}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
