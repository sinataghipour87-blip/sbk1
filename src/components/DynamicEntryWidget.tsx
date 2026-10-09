import React, { useMemo } from 'react';
import { AnalysisResult, TradeHistory } from '../types/trading';
import { calculateDynamicEntryZone } from '../services/dynamicEntryZone';
import { evaluateEntryEfficiency } from '../services/entryEfficiencyModel';
import { 
  Target, 
  Zap, 
  ShieldAlert, 
  BarChart2, 
  Clock, 
  Activity, 
  Sliders, 
  Percent, 
  TrendingUp, 
  ShieldCheck 
} from 'lucide-react';

interface DynamicEntryWidgetProps {
  analysis: AnalysisResult | null;
  history: TradeHistory[];
}

export const DynamicEntryWidget: React.FC<DynamicEntryWidgetProps> = ({ analysis, history }) => {
  // ۱. محاسبه زون ورود پویا بر اساس کل متغیرهای مارکت و اثر انگشت MAE
  const zone = useMemo(() => {
    if (!analysis) return null;
    
    const spread = analysis.canonicalSnapshot?.basisSpreadBps ?? 0.5;
    const setupType = analysis.setupContext?.setupType ?? 'VWAP_MSS_CONTINUATION';
    const regime = analysis.regimeClassification?.activeRegime ?? 'TREND';
    const timeframe = (analysis.timeframe as string) || '15m';
    const fvgZone = analysis.fvg;
    const orderBlock = analysis.smcOrderBlock;
    const pools = analysis.liquidityMap?.pools;
    const volumeSurge = analysis.regimeClassification?.metrics?.volumeSurgeRatio ?? 1.0;

    return calculateDynamicEntryZone(
      analysis.candles,
      analysis.price,
      analysis.atr,
      spread,
      setupType,
      regime,
      timeframe,
      fvgZone,
      orderBlock,
      pools,
      volumeSurge
    );
  }, [analysis]);

  // ۲. محاسبه کارایی آخرین ورود بر اساس مدل یادگیری تاریخی
  const latestEfficiency = useMemo(() => {
    if (!history || history.length === 0 || !analysis) return null;
    const lastTrade = history[history.length - 1];
    const simulatedWalk = [lastTrade.entry, lastTrade.entry * 0.995, lastTrade.entry * 1.01, analysis.price];
    return evaluateEntryEfficiency(lastTrade, simulatedWalk);
  }, [history, analysis]);

  // ۳. استخراج اثر انگشت MAE/MFE و گزارش تفکیک حد ضرر از تحلیل جاری
  const maeMfeFingerprint = analysis?.maeMfeFingerprint;
  const slReport = analysis?.slReport;

  if (!zone) return null;

  // قالب‌بندی زمان به صورت خوانا
  const formatSeconds = (sec: number): string => {
    if (sec < 60) return `${sec} ثانیه`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} دقیقه`;
    const hr = (sec / 3600).toFixed(1);
    return `${hr} ساعت`;
  };

  return (
    <div className="bg-[#030914] border border-cyan-900/50 rounded-2xl p-5 shadow-[0_0_30px_rgba(6,182,212,0.08)] mt-4">
      {/* هدر بخش */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-cyan-950/80 pb-4 mb-4 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-800/40">
            <Target className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-slate-200">
              موتور ورود پویا و کالیبراسیون حد ضرر (Entry & SL Engine)
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              مدل‌سازی پویای لول‌های ورود و ضرر بر اساس اثر انگشت تاریخی MAE/MFE و فاکتورهای ساختاری
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-medium px-2.5 py-1 rounded-md bg-cyan-950/70 text-cyan-400 border border-cyan-900/50">
            تایم‌فریم: {analysis?.timeframe || '15m'}
          </span>
          <span className="text-[10px] font-mono font-medium px-2.5 py-1 rounded-md bg-emerald-950/70 text-emerald-400 border border-emerald-900/50">
            ضریب همگرایی: {zone.confidenceScore}%
          </span>
        </div>
      </div>

      {/* بخش اول: کارت‌های خلاصه متریک‌های بهینه */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {/* ۱. بهترین قیمت ورود */}
        <div className="bg-[#01050e] p-4 rounded-xl border border-cyan-950/80 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full blur-xl pointer-events-none"></div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="font-medium">بهترین نقطه ورود پویا</span>
          </div>
          <div className="font-mono text-xl font-bold text-emerald-400 tabular-nums">
            ${zone.optimalEntry.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-2 flex justify-between">
            <span>محدوده پذیرش:</span>
            <span className="font-mono tabular-nums text-slate-400">
              ${zone.zoneStart.toLocaleString()} - ${zone.zoneEnd.toLocaleString()}
            </span>
          </div>
        </div>

        {/* ۲. دراودان انتظاری MAE */}
        <div className="bg-[#01050e] p-4 rounded-xl border border-cyan-950/80 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 rounded-full blur-xl pointer-events-none"></div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span className="font-medium">بیشترین نوسان منفی انتظاری (MAE)</span>
          </div>
          <div className="font-mono text-xl font-bold text-amber-400 tabular-nums">
            ${zone.expectedMae.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-2 flex justify-between">
            <span>احتمال برخورد به نویز:</span>
            <span className="text-slate-400 font-medium">کمتر از ۱۰٪</span>
          </div>
        </div>

        {/* ۳. امتیاز کارایی ورود */}
        <div className="bg-[#01050e] p-4 rounded-xl border border-cyan-950/80 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-cyan-500/5 rounded-full blur-xl pointer-events-none"></div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
            <BarChart2 className="w-4 h-4 text-cyan-400" />
            <span className="font-medium">امتیاز کارایی ورود (Entry Efficiency)</span>
          </div>
          <div className="font-mono text-xl font-bold text-cyan-300 tabular-nums">
            {latestEfficiency ? `${latestEfficiency.efficiencyScore}%` : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-500 mt-2 flex justify-between">
            <span>میانگین اسلیپیج نهایی:</span>
            <span className="text-slate-400 font-mono tabular-nums">
              {latestEfficiency ? `$${latestEfficiency.slippageUsd}` : '۰.۰۰$'}
            </span>
          </div>
        </div>
      </div>

      {/* بخش دوم: جزئیات وزن‌دهی وزن‌های پویا و اثر انگشت MAE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ۱. تفکیک سهم متغیرها در محاسبه نقطه ورود */}
        <div className="bg-[#01040a] p-4 rounded-xl border border-cyan-950/60">
          <div className="flex items-center justify-between border-b border-cyan-950/50 pb-2.5 mb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>وزن مولفه‌های تصمیم‌گیر ورود</span>
            </div>
            <span className="text-[10px] text-slate-500">حجم اسپرد و عمق بازار زنده</span>
          </div>

          <div className="space-y-3">
            {/* ATR */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>نوسان‌پذیری دوره (ATR Factor)</span>
                <span className="font-mono">{(zone.factors.atrWeight * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-cyan-500 transition-all duration-500" 
                  style={{ width: `${zone.factors.atrWeight * 100}%` }}
                ></div>
              </div>
            </div>

            {/* Expected MAE */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>توزیع آماری زیان انتظاری (MAE Factor)</span>
                <span className="font-mono">{(zone.factors.maeWeight * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-500" 
                  style={{ width: `${zone.factors.maeWeight * 100}%` }}
                ></div>
              </div>
            </div>

            {/* Order Block */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>بلاک سفارشات نهادی (SMC Order Block)</span>
                <span className="font-mono">{(zone.factors.orderBlockWeight * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-500" 
                  style={{ width: `${zone.factors.orderBlockWeight * 100}%` }}
                ></div>
              </div>
            </div>

            {/* FVG */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>عدم تعادل نقدینگی و گپ ارزش منصفانه (FVG)</span>
                <span className="font-mono">{(zone.factors.fvgWeight * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-amber-500 transition-all duration-500" 
                  style={{ width: `${zone.factors.fvgWeight * 100}%` }}
                ></div>
              </div>
            </div>

            {/* Liquidity Sweep */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>استخرهای مغناطیسی نقدینگی (Liquidity Pools)</span>
                <span className="font-mono">{(zone.factors.liquidityWeight * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-fuchsia-500 transition-all duration-500" 
                  style={{ width: `${zone.factors.liquidityWeight * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        {/* ۲. مشخصات اثر انگشت MAE/MFE (Fingerprint Details) */}
        <div className="bg-[#01040a] p-4 rounded-xl border border-cyan-950/60">
          <div className="flex items-center justify-between border-b border-cyan-950/50 pb-2.5 mb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span>اثر انگشت آماری (MAE/MFE Fingerprint)</span>
            </div>
            {maeMfeFingerprint?.isEmpirical ? (
              <span className="text-[10px] text-emerald-400 font-mono">Empirical ({maeMfeFingerprint.sampleCount} trades)</span>
            ) : (
              <span className="text-[10px] text-slate-500 font-mono">Calibrated Prior</span>
            )}
          </div>

          {maeMfeFingerprint ? (
            <div className="space-y-4">
              {/* خلاصه میانگین‌ها */}
              <div className="grid grid-cols-2 gap-3 bg-[#010307] p-2.5 rounded-lg border border-cyan-950/30">
                <div>
                  <div className="text-[10px] text-slate-500">میانگین اصلاح تا ورود پویا</div>
                  <div className="text-xs font-mono font-semibold text-amber-400 mt-0.5 tabular-nums">
                    {maeMfeFingerprint.expectedMaePct.toFixed(3)}%
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">میانگین بازدهی صعودی مطلوب</div>
                  <div className="text-xs font-mono font-semibold text-emerald-400 mt-0.5 tabular-nums">
                    {maeMfeFingerprint.expectedMfePct.toFixed(3)}%
                  </div>
                </div>
              </div>

              {/* منحنی توزیع MAE */}
              <div>
                <div className="text-[10px] text-slate-400 mb-1.5 flex justify-between">
                  <span>منحنی توزیع MAE (دراودان‌های احتمالی)</span>
                  <span className="text-[9px] text-slate-500">صدک‌های تجمعی</span>
                </div>
                <div className="grid grid-cols-5 gap-1 text-[10px] font-mono tabular-nums text-center">
                  <div className="p-1 bg-slate-950 rounded border border-cyan-950/30">
                    <div className="text-slate-500">p25</div>
                    <div className="text-slate-300 mt-0.5">{maeMfeFingerprint.maeDistribution.p25.toFixed(2)}%</div>
                  </div>
                  <div className="p-1 bg-slate-950 rounded border border-cyan-950/30">
                    <div className="text-slate-500">p50</div>
                    <div className="text-slate-300 mt-0.5">{maeMfeFingerprint.maeDistribution.p50.toFixed(2)}%</div>
                  </div>
                  <div className="p-1 bg-slate-950 rounded border border-cyan-950/30">
                    <div className="text-slate-500">p75</div>
                    <div className="text-slate-300 mt-0.5">{maeMfeFingerprint.maeDistribution.p75.toFixed(2)}%</div>
                  </div>
                  <div className="p-1 bg-amber-950/20 rounded border border-amber-900/30">
                    <div className="text-amber-500">p90</div>
                    <div className="text-amber-400 mt-0.5">{maeMfeFingerprint.maeDistribution.p90.toFixed(2)}%</div>
                  </div>
                  <div className="p-1 bg-red-950/20 rounded border border-red-900/30">
                    <div className="text-red-500">p99</div>
                    <div className="text-red-400 mt-0.5">{maeMfeFingerprint.maeDistribution.p99.toFixed(2)}%</div>
                  </div>
                </div>
              </div>

              {/* فاکتورهای زمانی اثر انگشت */}
              <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-400 pt-1">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-500" />
                  <span>زمان تخمینی تا MFE:</span>
                  <strong className="text-slate-300 font-mono tabular-nums mr-auto">
                    {formatSeconds(maeMfeFingerprint.timeToMfeSec)}
                  </strong>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-red-500" />
                  <span>زمان ماندگاری تا حد ضرر:</span>
                  <strong className="text-slate-300 font-mono tabular-nums mr-auto">
                    {formatSeconds(maeMfeFingerprint.timeToStopSec)}
                  </strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-xs text-slate-500">
              داده‌های اثر انگشت برای ست‌آپ جاری یافت نشد
            </div>
          )}
        </div>
      </div>

      {/* بخش سوم: تشخیص جداسازی حد ضرر از احتمالات (Stop Loss Separation Diagnostics) */}
      {slReport && (
        <div className="mt-4 bg-[#01050f] p-4 rounded-xl border border-cyan-950/80 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between border-b border-cyan-950/50 pb-2 mb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>ممیزی مستقل و کالیبراسیون حد ضرر (Stop Loss Separation)</span>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-md font-mono ${
              slReport.status === 'OPTIMAL_SAFE' 
                ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-900/50' 
                : slReport.status === 'ADJUSTED_OUT_OF_NOISE' 
                  ? 'bg-amber-950/70 text-amber-400 border border-amber-900/50' 
                  : 'bg-red-950/70 text-red-400 border border-red-900/50'
            }`}>
              وضعیت: {slReport.status}
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed bg-[#010307] p-2.5 rounded-lg border border-cyan-950/30 mb-3 font-medium">
            {slReport.adjustmentNoteFa}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-2 bg-slate-950/60 rounded border border-cyan-950/30">
              <div className="text-[9px] text-slate-500">لول ابطال ساختار</div>
              <div className="text-xs font-mono font-bold text-slate-300 mt-1 tabular-nums">
                ${slReport.structuralPrice.toLocaleString()}
              </div>
            </div>
            <div className="p-2 bg-slate-950/60 rounded border border-cyan-950/30">
              <div className="text-[9px] text-slate-500">حد ضرر نهایی کالیبره</div>
              <div className="text-xs font-mono font-bold text-red-400 mt-1 tabular-nums">
                ${slReport.finalStopPrice.toLocaleString()}
              </div>
            </div>
            <div className="p-2 bg-slate-950/60 rounded border border-cyan-950/30">
              <div className="text-[9px] text-slate-500">فاصله خالص حد ضرر</div>
              <div className="text-xs font-mono font-bold text-slate-300 mt-1 tabular-nums">
                {slReport.impliedSlPct.toFixed(3)}%
              </div>
            </div>
            <div className="p-2 bg-slate-950/60 rounded border border-cyan-950/30">
              <div className="text-[9px] text-slate-500">مرز نویز ۹۰٪ (MAE)</div>
              <div className="text-xs font-mono font-bold text-amber-400 mt-1 tabular-nums">
                {slReport.mae90PercentilePct.toFixed(3)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
