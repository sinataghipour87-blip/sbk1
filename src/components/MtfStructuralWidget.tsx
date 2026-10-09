import React, { useMemo } from 'react';
import {
  Compass,
  Layers,
  AlertTriangle,
  Zap,
  TrendingUp,
  TrendingDown,
  Activity,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ShieldAlert,
  ArrowRightLeft,
  Timer,
  Boxes,
  Split
} from 'lucide-react';
import { AnalysisResult, MtfStructuralReport, TradingTimeframe } from '../types/trading';
import { processMtfStructuralAnalysis, MTF_ROLE_MAP } from '../services/mtfStructuralEngine';
import { classifyMultiTimeframeRegimes, MultiTimeframeRegimeReport } from '../services/regimeClassifierEngine';

interface MtfStructuralWidgetProps {
  analysis?: AnalysisResult | null;
}

export const MtfStructuralWidget: React.FC<MtfStructuralWidgetProps> = ({ analysis }) => {
  // ۱. ارزیابی یا تولید گزارش چندتایم‌فریمه واقعی
  const mtfReport: MtfStructuralReport = useMemo(() => {
    if (analysis?.mtfStructuralReport) {
      return analysis.mtfStructuralReport;
    }

    const scoreLong = analysis?.scoreLong ?? 65;
    const scoreShort = analysis?.scoreShort ?? 35;
    const bias4h = analysis?.mtf4h === 'BULLISH' ? 'BULLISH' : (analysis?.mtf4h === 'BEARISH' ? 'BEARISH' : 'NEUTRAL');
    const bias1h = analysis?.mtf1h === 'BULLISH' ? 'BULLISH' : (analysis?.mtf1h === 'BEARISH' ? 'BEARISH' : 'NEUTRAL');
    const bias15m = analysis?.mtf15m === 'BULLISH' ? 'BULLISH' : (analysis?.mtf15m === 'BEARISH' ? 'BEARISH' : 'NEUTRAL');
    const bias5m = analysis?.mtf5m === 'BULLISH' ? 'BULLISH' : (analysis?.mtf5m === 'BEARISH' ? 'BEARISH' : 'NEUTRAL');
    const bias1m = analysis?.mtf1m === 'BULLISH' ? 'BULLISH' : (analysis?.mtf1m === 'BEARISH' ? 'BEARISH' : 'NEUTRAL');

    return processMtfStructuralAnalysis(
      { '4h': bias4h, '1h': bias1h, '15m': bias15m, '5m': bias5m, '1m': bias1m },
      {
        '4h': scoreLong > scoreShort ? 82 : 45,
        '1h': scoreLong > scoreShort ? 78 : 48,
        '15m': scoreLong > scoreShort ? 72 : 52,
        '5m': scoreLong > scoreShort ? 65 : 55,
        '1m': scoreLong > scoreShort ? 60 : 60,
      }
    );
  }, [analysis]);

  // ۳۸. ماتریس رژیم چند تایم‌فریمه (Multi-Timeframe Regime Matrix)
  const mtfRegimes: MultiTimeframeRegimeReport | null = useMemo(() => {
    const candlesByTimeframe = analysis?.htfCandles;
    if (
      !candlesByTimeframe ||
      (['5m', '15m', '1h', '4h'] as const).some(timeframe => (candlesByTimeframe[timeframe]?.length ?? 0) < 300) ||
      !analysis?.price
    ) return null;
    return classifyMultiTimeframeRegimes(
      {
        '5m': candlesByTimeframe['5m'],
        '15m': candlesByTimeframe['15m'],
        '1h': candlesByTimeframe['1h'],
        '4h': candlesByTimeframe['4h'],
      },
      analysis.price
    );
  }, [analysis]);

  // تعیین استایل دکمه سناریو
  const getScenarioStyle = (scenario: MtfStructuralReport['activeScenario']) => {
    switch (scenario) {
      case 'CONGRUENT_TREND_CONTINUATION':
        return 'text-emerald-400 bg-emerald-950/80 border-emerald-500/50';
      case 'PULLBACK_IN_HTF_TREND':
        return 'text-cyan-400 bg-cyan-950/80 border-cyan-500/50';
      case 'HTF_REVERSAL_CONFIRMED':
        return 'text-amber-400 bg-amber-950/80 border-amber-500/50';
      default:
        return 'text-rose-400 bg-rose-950/80 border-rose-500/50 animate-pulse';
    }
  };

  // تعیین استایل دسترسی اقدام
  const getPermissionBadge = (permission: MtfStructuralReport['actionPermission']) => {
    switch (permission) {
      case 'ALLOWED_EXECUTE':
        return { label: '✓ معامله کاملاً مجاز (FULL_TRADE)', color: 'text-emerald-300 bg-emerald-950 border-emerald-700' };
      case 'ALLOWED_PULLBACK_ONLY':
        return { label: '⏳ فقط ورود اصلاحی (PULLBACK_ONLY)', color: 'text-cyan-300 bg-cyan-950 border-cyan-700' };
      default:
        return { label: '⛔ معامله مسدود (BLOCKED_CONFLICT)', color: 'text-rose-300 bg-rose-950 border-rose-700' };
    }
  };

  const permissionStyle = getPermissionBadge(mtfReport.actionPermission);
  const tfs: TradingTimeframe[] = ['4h', '1h', '15m', '5m', '1m'];

  return (
    <div className="bg-slate-900/90 border border-cyan-900/50 rounded-2xl p-4 shadow-2xl text-slate-100 flex flex-col gap-4">
      {/* هدر */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-cyan-950/80 border border-cyan-500/40 rounded-xl text-cyan-400">
            <Timer className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-cyan-200 flex items-center gap-2">
              سیستم هوشمند ساختار چند تایم‌فریمه (MTF Structural Engine)
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                نقش‌دهی تخصصی + ماتریس رژیم‌های متقاطع
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              تفکیک مستقل رژیم هر تایم‌فریم (۵m، ۱۵m، ۱H، ۴H) و مدل‌سازی ساختاری تضادها (بند ۳۸)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-1.5 ${getScenarioStyle(mtfReport.activeScenario)}`}>
            <Compass className="w-4 h-4 animate-spin-slow" />
            <span>سناریو: {mtfReport.scenarioFa}</span>
          </div>
        </div>
      </div>

      {/* ۳۸. بخش ماتریس رژیم چندتایم‌فریمه (Multi-Timeframe Regime Matrix) */}
      <div className="bg-gradient-to-r from-slate-950 via-cyan-950/30 to-slate-950 border border-cyan-800/40 rounded-xl p-3 flex flex-col gap-2.5">
        {mtfRegimes ? (
          <>
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-cyan-200">ماتریس رژیم ساختاری چند تایم‌فریمه (بند ۳۸):</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            {mtfRegimes.conflictDetected ? '⚠️ تضاد ساختاری فعال' : '✓ همگرایی کامل'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['4h', '1h', '15m', '5m'] as const).map(tfKey => {
            const item = mtfRegimes.timeframes[tfKey];
            return (
              <div key={tfKey} className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-bold text-cyan-300 uppercase">{tfKey}</span>
                  <span className="text-[9px] font-mono text-slate-400">
                    {item.confidencePct}% · {item.probabilityModelValidation.status === 'CALIBRATED' ? 'OOS' : 'خام'}
                  </span>
                </div>
                <div className="text-xs font-black text-amber-300 font-mono my-0.5">
                  {item.regime}
                </div>
                <div className="text-[10px] text-slate-300 truncate">
                  {item.regimeFa}
                </div>
                <div className="text-[9px] text-slate-500 mt-1 truncate border-t border-slate-800/60 pt-1">
                  {item.roleFa}
                </div>
              </div>
            );
          })}
        </div>

        {/* جعبه حل تضاد ساختاری */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 text-[11px] flex items-start gap-2 text-slate-300">
          <Split className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-amber-300">تحلیل و حل تضاد ساختاری: </span>
            {mtfRegimes.conflictResolutionFa}
            <span className="block text-cyan-300 font-medium mt-0.5">دستورالعمل اجرا: {mtfRegimes.actionGuidanceFa}</span>
          </div>
        </div>
          </>
        ) : (
          <p className="text-xs text-amber-300">
            ماتریس چندتایم‌فریمه تا دریافت حداقل ۳۰۰ کندل واقعی و جداگانه برای 5m، 15m، 1h و 4h در وضعیت WAIT است.
          </p>
        )}
      </div>

      {/* بخش حل تداخل پنهان و مجوز اقدام */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <div className="text-center shrink-0">
            <div className="text-[10px] text-slate-400">شاخص یکپارچگی</div>
            <div className="font-mono text-xl font-black text-cyan-400">
              {mtfReport.finalUnifiedScore}٪
            </div>
          </div>

          <div className="w-px h-10 bg-slate-800" />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-200">وضعیت تداخل پنهان:</span>
              {mtfReport.isConflictDetected ? (
                <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  تداخل شناسایی و خنثی شد
                </span>
              ) : (
                <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  همگرایی کامل ساختار
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-300 mt-1">{mtfReport.verdictFa}</p>
          </div>
        </div>

        <div className={`px-3.5 py-2 rounded-xl border text-xs font-mono font-black shrink-0 ${permissionStyle.color}`}>
          {permissionStyle.label}
        </div>
      </div>

      {/* نمایش ۵ تایم‌فریم به همراه نقش اختصاصی و وزن هر کدام */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {tfs.map(tf => {
          const roleDef = mtfReport.roles[tf];
          if (!roleDef) return null;

          const isBull = roleDef.bias === 'BULLISH';
          const isBear = roleDef.bias === 'BEARISH';

          return (
            <div
              key={tf}
              className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                isBull
                  ? 'bg-emerald-950/20 border-emerald-900/40 hover:border-emerald-700/60'
                  : isBear
                  ? 'bg-rose-950/20 border-rose-900/40 hover:border-rose-700/60'
                  : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
                  <span className="font-mono text-sm font-black text-cyan-300 uppercase">{tf}</span>
                  <span className="text-[9px] bg-slate-900 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded font-mono font-semibold">
                    وزن: {Math.round(MTF_ROLE_MAP[tf].weight * 100)}٪
                  </span>
                </div>

                <div className="text-[11px] font-bold text-slate-200">
                  {roleDef.roleFa}
                </div>
                <p className="text-[9px] text-slate-400 mt-1 leading-relaxed">
                  {roleDef.focusAreaFa}
                </p>
              </div>

              <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                <span className="text-slate-400">بایاس ساختار:</span>
                <span className={`font-mono font-black flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] ${
                  isBull
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                    : isBear
                    ? 'bg-rose-950 text-rose-300 border border-rose-800/50'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {isBull ? <TrendingUp className="w-3 h-3" /> : (isBear ? <TrendingDown className="w-3 h-3" /> : null)}
                  {roleDef.bias}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
