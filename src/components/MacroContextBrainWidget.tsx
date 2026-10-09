/**
 * 🌐 ویجت مغز پردازش کلان بازار و دیوار آتش شوک خبری (Macro-Context Brain & News Shock Firewall)
 * نمایش همبستگی زنده بیت‌کوین با S&P 500، DXY، ترس و طمع، ETF، انتظارات بهره فدرال و ردپای نهنگ‌ها.
 * رعایت قاعده ۴۳: عدم نمایش مقادیر فیک و نمایش برچسب صریح UNAVAILABLE در صورت قطع منبع.
 * رعایت قاعده ۴۴: پایش تقویم رویدادهای پرریسک (CPI, FOMC, NFP) و محافظت در برابر شوک و Whipsaw.
 */

import React, { useState, useEffect } from 'react';
import { Globe, TrendingUp, TrendingDown, RefreshCw, Layers, CheckCircle2, AlertTriangle, ShieldAlert, ShieldCheck, Flame, Clock, Radio } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { macroContextBrainService, MacroCorrelationData } from '../services/macroContextBrain';
import { newsShockFirewallService, NewsShockFirewallReport } from '../services/newsShockFirewall';

interface Props {
  currentPrice?: number;
}

export const MacroContextBrainWidget: React.FC<Props> = ({ currentPrice = 0 }) => {
  const [data, setData] = useState<MacroCorrelationData>(() =>
    macroContextBrainService.getMacroContext(currentPrice)
  );
  const [firewallReport, setFirewallReport] = useState<NewsShockFirewallReport>(() =>
    newsShockFirewallService.evaluateNewsShockFirewall(null)
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  useEffect(() => {
    // Initial fetch on mount
    macroContextBrainService.refreshLiveMacroContext().then((res) => {
      setData(res);
      setFirewallReport(newsShockFirewallService.evaluateNewsShockFirewall(null));
    });

    const timer = setInterval(() => {
      setFirewallReport(newsShockFirewallService.evaluateNewsShockFirewall(null));
    }, 15000);

    return () => clearInterval(timer);
  }, [currentPrice]);

  const handleRefreshMacro = async () => {
    setIsRefreshing(true);
    try {
      const freshData = await macroContextBrainService.refreshLiveMacroContext();
      setData(freshData);
      setFirewallReport(newsShockFirewallService.evaluateNewsShockFirewall(null));
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  };

  const getBadgeColor = () => {
    if (firewallReport.phase === 'DURING_SHOCK') {
      return 'text-rose-300 bg-rose-950/80 border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.4)] animate-pulse';
    }
    if (data.macroFilterStatus === 'BULLISH_CONFIRMED') {
      return 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]';
    }
    if (data.macroFilterStatus === 'UNAVAILABLE') {
      return 'text-slate-300 bg-slate-900 border-slate-700';
    }
    return 'text-amber-300 bg-amber-950/80 border-amber-500/40';
  };

  const getBadgeText = () => {
    if (firewallReport.phase === 'DURING_SHOCK') {
      return '🚨 شوک خبری فعال (ورود مسدود)';
    }
    if (firewallReport.phase === 'PRE_EVENT') {
      return '⚠️ احتیاط پیش‌رویداد کلان';
    }
    if (data.macroFilterStatus === 'BULLISH_CONFIRMED') {
      return 'تایید کلان صعودی 🟢';
    }
    if (data.macroFilterStatus === 'UNAVAILABLE') {
      return 'داده کلان: UNAVAILABLE ⚠️';
    }
    return 'ریسک کلان متوسط ⚠️';
  };

  return (
    <CollapsibleCard
      title="مغز پردازش کلان بازار و دیوار آتش اخبار (Macro & News Shock Firewall)"
      badge={getBadgeText()}
      badgeColor={getBadgeColor()}
      defaultOpen={true}
      icon={<Globe className="w-5 h-5 text-teal-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleRefreshMacro}
          disabled={isRefreshing}
          className="px-2.5 py-1 rounded-lg bg-teal-950 hover:bg-teal-900 border border-teal-500/50 text-teal-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-teal-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'بروزرسانی داده‌های زنده...' : 'بروزرسانی ماکرو'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* ========================================================= */}
        {/* 🛡️ NEWS SHOCK FIREWALL MONITOR (Item 44)                  */}
        {/* ========================================================= */}
        <div className={`rounded-2xl p-3.5 border shadow-xl transition-all ${
          firewallReport.phase === 'DURING_SHOCK'
            ? 'bg-rose-950/40 border-rose-500/60 text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
            : firewallReport.phase === 'PRE_EVENT'
            ? 'bg-amber-950/30 border-amber-500/50 text-amber-100'
            : 'bg-[#020b18] border-teal-500/40 text-slate-200'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-teal-950/80">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg border ${
                firewallReport.phase === 'DURING_SHOCK'
                  ? 'bg-rose-500/30 border-rose-500 text-rose-300 animate-pulse'
                  : 'bg-teal-500/20 border-teal-500/30 text-teal-300'
              }`}>
                {firewallReport.phase === 'DURING_SHOCK' ? <Flame className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans flex items-center gap-1.5">
                  دیوار آتش شوک خبری (News Shock Firewall)
                  {firewallReport.whipsawProtectionActive && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      گارد ضد Whipsaw فعال
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-teal-300 font-mono mt-0.5 block">
                  {firewallReport.phaseLabelFa}
                </span>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-sans font-bold flex items-center gap-1 ${
              firewallReport.isTradeAllowed
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50'
                : 'bg-rose-950/90 text-rose-300 border-rose-500/60 animate-pulse'
            }`}>
              {firewallReport.isTradeAllowed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />}
              <span>{firewallReport.actionVerdictLabelFa}</span>
            </span>
          </div>

          {/* Realtime Volatility & Liquidity shock meters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-2.5 text-[10px]">
            <div className="bg-[#031326] p-2 rounded-xl border border-teal-950/60">
              <span className="text-slate-400 block font-sans">نسبت گسترش نوسان (ATR):</span>
              <span className={`font-bold ${firewallReport.realtimeMetrics.isVolatilityShock ? 'text-rose-400' : 'text-emerald-400'}`}>
                {firewallReport.realtimeMetrics.volatilityExpansionRatio}x مبنا {firewallReport.realtimeMetrics.isVolatilityShock ? '⚡ شوک' : 'عادی'}
              </span>
            </div>

            <div className="bg-[#031326] p-2 rounded-xl border border-teal-950/60">
              <span className="text-slate-400 block font-sans">اسپرد اوردربوک فیوچرز:</span>
              <span className={`font-bold ${firewallReport.realtimeMetrics.isLiquidityShock ? 'text-rose-400' : 'text-emerald-400'}`}>
                {firewallReport.realtimeMetrics.currentSpreadBps} bps {firewallReport.realtimeMetrics.isLiquidityShock ? '⚠️ واید' : 'طبیعی'}
              </span>
            </div>

            <div className="bg-[#031326] p-2 rounded-xl border border-teal-950/60">
              <span className="text-slate-400 block font-sans">سقف لوریج مجاز شوک:</span>
              <span className="font-bold text-cyan-300">
                {firewallReport.allowedLeverageCap > 0 ? `${firewallReport.allowedLeverageCap}x` : '0x (توقف کامل)'}
              </span>
            </div>

            <div className="bg-[#031326] p-2 rounded-xl border border-teal-950/60">
              <span className="text-slate-400 block font-sans">ضریب حجم مجاز:</span>
              <span className="font-bold text-amber-300">
                {Math.round(firewallReport.positionSizeMultiplier * 100)}% حجم نرمال
              </span>
            </div>
          </div>

          {/* Calendar Events Radar */}
          <div className="space-y-1.5 pt-1">
            <span className="text-[10px] font-bold text-teal-300 font-sans flex items-center gap-1">
              <Clock className="w-3 h-3 text-teal-400" />
              تقویم رویدادهای پرریسک آتی (CPI, FOMC, NFP):
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {firewallReport.upcomingEvents.map((evt) => (
                <div key={evt.id} className="bg-[#041224] p-2 rounded-lg border border-teal-900/40 text-[10px]">
                  <div className="flex items-center justify-between font-sans">
                    <span className="font-bold text-slate-200">{evt.category}</span>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono ${
                      evt.minutesRemaining <= 30 && evt.minutesRemaining >= -15
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                    }`}>
                      {evt.timeAgoFa}
                    </span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1 truncate">{evt.titleFa}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed font-sans bg-[#010712] p-2 rounded-lg border border-teal-900/40 mt-2 text-slate-300">
            🛡️ <strong>دستورالعمل استراتژی:</strong> {firewallReport.directiveFa}
          </p>
        </div>

        {/* ========================================================= */}
        {/* 🌐 7 MACRO METRICS (Item 43: Zero hardcoding, UNAVAILABLE) */}
        {/* ========================================================= */}
        <div className="bg-[#020917] border border-teal-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-teal-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-teal-500/20 rounded-lg text-teal-400 border border-teal-500/30">
                <Radio className="w-4 h-4 text-teal-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  داده‌های کلان و فاندامنتال (۷ شاخص بنیادین):
                </span>
                <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
                  بروزرسانی زنده: {data.lastUpdatedStr} | بدون داده ساختگی (Fail-Closed)
                </span>
              </div>
            </div>

            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
              data.overallDataStatus === 'LIVE' ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-700'
            }`}>
              وضعیت کلی: {data.overallDataStatus === 'LIVE' ? 'LIVE 🟢' : 'UNAVAILABLE ⚪'}
            </span>
          </div>

          {/* 7 Live / UNAVAILABLE Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-[11px]">
            {/* 1. S&P 500 */}
            <div className="bg-[#041124] p-2.5 rounded-xl border border-teal-950/80 space-y-1">
              <span className="text-[10px] text-slate-400 block font-sans">۱. شاخص S&P 500 بورس:</span>
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-100">
                  {data.sp500Status === 'LIVE' && data.sp500Price !== null ? `$${data.sp500Price.toLocaleString()}` : 'UNAVAILABLE'}
                </span>
                {data.sp500Status === 'LIVE' && data.sp500DailyChangePct !== null ? (
                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${data.sp500DailyChangePct >= 0 ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
                    {data.sp500DailyChangePct >= 0 ? '+' : ''}{data.sp500DailyChangePct}%
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">UNAVAILABLE</span>
                )}
              </div>
            </div>

            {/* 2. DXY */}
            <div className="bg-[#041124] p-2.5 rounded-xl border border-teal-950/80 space-y-1">
              <span className="text-[10px] text-slate-400 block font-sans">۲. شاخص دلار آمریکا (DXY):</span>
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-100">
                  {data.dxyStatus === 'LIVE' && data.dxyIndex !== null ? data.dxyIndex : 'UNAVAILABLE'}
                </span>
                {data.dxyStatus === 'LIVE' && data.dxyDailyChangePct !== null ? (
                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${data.dxyDailyChangePct < 0 ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
                    {data.dxyDailyChangePct}%
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">UNAVAILABLE</span>
                )}
              </div>
            </div>

            {/* 3. Fear & Greed */}
            <div className="bg-[#041124] p-2.5 rounded-xl border border-teal-950/80 space-y-1">
              <span className="text-[10px] text-slate-400 block font-sans">۳. شاخص ترس و طمع:</span>
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-300">
                  {data.fearAndGreedStatus === 'LIVE' && data.fearAndGreedIndex !== null ? data.fearAndGreedIndex : 'UNAVAILABLE'}
                </span>
                <span className={`text-[9px] px-1.5 py-0.2 rounded font-sans ${data.fearAndGreedStatus === 'LIVE' ? 'bg-emerald-950/80 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                  {data.fearAndGreedStatus === 'LIVE' ? data.fearAndGreedLabelFa : 'قطع منبع'}
                </span>
              </div>
            </div>

            {/* 4. ETF Flow */}
            <div className="bg-[#041124] p-2.5 rounded-xl border border-teal-950/80 space-y-1">
              <span className="text-[10px] text-slate-400 block font-sans">۴. ورود خالص ETF اسپات:</span>
              <div className="flex items-center justify-between">
                <span className={`font-bold ${data.etfFlowStatus === 'LIVE' && data.spotEtfNetInflowMillionUsd !== null && data.spotEtfNetInflowMillionUsd >= 0 ? 'text-cyan-300' : 'text-slate-400'}`}>
                  {data.etfFlowStatus === 'LIVE' && data.spotEtfNetInflowMillionUsd !== null ? `${data.spotEtfNetInflowMillionUsd > 0 ? '+' : ''}$${data.spotEtfNetInflowMillionUsd}M` : 'UNAVAILABLE'}
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300">
                  {data.etfFlowStatus === 'LIVE' ? 'جریان نهادی' : 'UNAVAILABLE'}
                </span>
              </div>
            </div>

            {/* 5. Fed Expectations */}
            <div className="bg-[#041124] p-2.5 rounded-xl border border-teal-950/80 space-y-1">
              <span className="text-[10px] text-slate-400 block font-sans">۵. احتمال کاهش نرخ بهره فدرال:</span>
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-300">
                  {data.fedExpectationsStatus === 'LIVE' && data.fedRateCutExpectationPct !== null ? `${data.fedRateCutExpectationPct}%` : 'UNAVAILABLE'}
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300">CME Watch</span>
              </div>
            </div>

            {/* 6. News Sentiment */}
            <div className="bg-[#041124] p-2.5 rounded-xl border border-teal-950/80 space-y-1">
              <span className="text-[10px] text-slate-400 block font-sans">۶. سنتیمنت اخبار زنده:</span>
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-300">
                  {data.newsSentimentStatus === 'LIVE' && data.newsSentimentScore !== null ? `${data.newsSentimentScore > 0 ? '+' : ''}${data.newsSentimentScore}` : 'UNAVAILABLE'}
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300">
                  {data.newsSentimentStatus === 'LIVE' ? 'News Engine' : 'UNAVAILABLE'}
                </span>
              </div>
            </div>

            {/* 7. Whale Flow */}
            <div className="bg-[#041124] p-2.5 rounded-xl border border-teal-950/80 space-y-1 col-span-2">
              <span className="text-[10px] text-slate-400 block font-sans">۷. جریان خالص نهنگ‌ها (Whale Flow):</span>
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">
                  {data.whaleFlowStatus === 'LIVE' && data.whaleNetflowBtc !== null ? `${data.whaleNetflowBtc > 0 ? '+' : ''}${data.whaleNetflowBtc} BTC` : 'UNAVAILABLE'}
                </span>
                <span className="text-[9px] px-2 py-0.2 rounded bg-slate-800 text-slate-300 font-sans">
                  {data.whaleFlowStatus === 'LIVE' ? (data.whaleSentiment === 'ACCUMULATION' ? 'انباشت نهنگ' : 'فشار عرضه') : 'منبع در دسترس نیست'}
                </span>
              </div>
            </div>
          </div>

          {/* Recent Headlines if LIVE */}
          {data.newsSentimentStatus === 'LIVE' && data.recentHeadlines.length > 0 && (
            <div className="mt-2.5 bg-[#030d1d] p-2.5 rounded-xl border border-teal-900/40 space-y-1.5">
              <span className="font-bold text-teal-300 font-sans text-[11px] block">
                📰 تیترهای رصدشده توسط سرور:
              </span>
              {data.recentHeadlines.slice(0, 2).map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-2 text-[10px] text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                    <span className="font-sans leading-tight">{item.headlineFa}</span>
                  </div>
                  <span className="text-slate-500 font-mono shrink-0">{item.timeAgoFa}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-teal-900/40 mt-3">
            🌐 {data.macroFilterStatusFa}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};

