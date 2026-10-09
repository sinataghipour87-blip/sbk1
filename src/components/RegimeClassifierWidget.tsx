import React, { useState, useMemo } from 'react';
import {
  Compass,
  Layers,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  ShieldCheck,
  TrendingUp,
  Activity,
  BarChart2,
  Gauge,
  Sliders,
  Filter,
  Lock,
  Sparkles
} from 'lucide-react';
import {
  AdvancedRegimeType,
  AnalysisResult,
  EntryCandidateType,
  MarketRegimeClassification,
  RegimeSetupMatrixReport,
  TradingTimeframe,
} from '../types/trading';
import { classifyMarketRegime, evaluateRegimeSetupEdge } from '../services/regimeClassifierEngine';

interface RegimeClassifierWidgetProps {
  analysis?: AnalysisResult | null;
  currentPrice: number;
}

export const RegimeClassifierWidget: React.FC<RegimeClassifierWidgetProps> = ({ analysis, currentPrice }) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState<TradingTimeframe>('15m');
  const [selectedSetup, setSelectedSetup] = useState<EntryCandidateType>('PULLBACK_ENTRY');

  const price = currentPrice > 0 ? currentPrice : (analysis?.price ?? 0);

  // ۱. رده‌بندی رژیم بازار
  const regimeData: MarketRegimeClassification | null = useMemo(() => {
    if (analysis?.regimeClassification) {
      return analysis.regimeClassification;
    }
    const candles = analysis?.rawCandles || analysis?.candles || [];
    if (candles.length < 300 || price <= 0) return null;
    return classifyMarketRegime(
      candles,
      price,
      analysis?.adx,
      analysis?.atr,
      analysis?.bbUp,
      analysis?.bbLow,
      analysis?.bbMid,
      analysis?.vwap,
      analysis?.orderFlowFeatures
    );
  }, [analysis, price]);

  // ۲. ماتریس اج ستاپ بر پایه رژیم و تایم‌فریم
  const edgeMatrix: RegimeSetupMatrixReport | null = useMemo(() => {
    if (!regimeData) return null;
    return evaluateRegimeSetupEdge(
      selectedSetup,
      regimeData.activeRegime,
      selectedTimeframe,
      analysis?.direction ?? 'LONG'
    );
  }, [selectedSetup, regimeData?.activeRegime, selectedTimeframe, analysis?.direction]);

  if (!regimeData || !edgeMatrix) {
    return (
      <div className="rounded-xl border border-amber-700/50 bg-slate-950 p-4 text-sm text-amber-300">
        طبقه‌بند رژیم در وضعیت WAIT است: قیمت زنده و حداقل ۳۰۰ کندل واقعی برای آموزش و اعتبارسنجی OOS لازم است.
      </div>
    );
  }

  // استایل رژیم
  const getRegimeBadgeStyle = (regime: AdvancedRegimeType) => {
    switch (regime) {
      case 'TREND':
        return 'text-emerald-300 bg-emerald-950/80 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.2)]';
      case 'RANGE':
        return 'text-cyan-300 bg-cyan-950/80 border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.2)]';
      case 'BREAKOUT':
        return 'text-amber-300 bg-amber-950/80 border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.2)]';
      case 'COMPRESSION':
        return 'text-purple-300 bg-purple-950/80 border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.2)]';
      case 'EXPANSION':
        return 'text-indigo-300 bg-indigo-950/80 border-indigo-500/50 shadow-[0_0_12px_rgba(99,102,241,0.2)]';
      case 'HIGH_VOLATILITY':
        return 'text-orange-300 bg-orange-950/80 border-orange-500/50 shadow-[0_0_12px_rgba(249,115,22,0.2)]';
      case 'PANIC':
        return 'text-rose-300 bg-rose-950/80 border-rose-500/50 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.3)]';
      case 'MEAN_REVERSION':
        return 'text-blue-300 bg-blue-950/80 border-blue-500/50 shadow-[0_0_12px_rgba(59,130,246,0.2)]';
      case 'NEWS_WHIPSAW':
        return 'text-yellow-300 bg-yellow-950/80 border-yellow-500/50 animate-bounce shadow-[0_0_15px_rgba(234,179,8,0.3)]';
      default:
        return 'text-slate-300 bg-slate-800 border-slate-700';
    }
  };

  const allRegimes: { key: AdvancedRegimeType; nameFa: string }[] = [
    { key: 'TREND', nameFa: 'رونددار (Trend)' },
    { key: 'RANGE', nameFa: 'رنج (Range)' },
    { key: 'BREAKOUT', nameFa: 'شکست (Breakout)' },
    { key: 'COMPRESSION', nameFa: 'فشردگی (Compression)' },
    { key: 'EXPANSION', nameFa: 'انبساط (Expansion)' },
    { key: 'HIGH_VOLATILITY', nameFa: 'نوسان بالا (High Vol)' },
    { key: 'PANIC', nameFa: 'وحشت (Panic)' },
    { key: 'MEAN_REVERSION', nameFa: 'بازگشت به میانگین' },
    { key: 'NEWS_WHIPSAW', nameFa: 'شلاق خبری (Whipsaw)' },
  ];

  return (
    <div className="bg-slate-900/90 border border-purple-900/50 rounded-2xl p-4 shadow-2xl text-slate-100 flex flex-col gap-4">
      {/* هدر */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-purple-950/80 border border-purple-500/40 rounded-xl text-purple-400">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-purple-200 flex items-center gap-2">
              رده‌بندی چندبعدی رژیم بازار (Market Regime Classifier)
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-purple-950 text-purple-300 border border-purple-800">
                ۹ رژیم مستقل ساختاری
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              تفکیک علمی رژیم بر اساس ADX، نسبت ATR، فشردگی بولینگر، انحراف VWAP و شلاق نوسانی
            </p>
          </div>
        </div>

        <div className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-2 ${getRegimeBadgeStyle(regimeData.activeRegime)}`}>
          <Sparkles className="w-4 h-4" />
          <span>
            رژیم پیش‌بینی‌شده: {regimeData.regimeFa} ({regimeData.confidencePct}٪؛{' '}
            {regimeData.probabilityModelValidation.status === 'CALIBRATED' ? 'کالیبره OOS' : 'خام / کالیبره‌نشده'})
          </span>
        </div>
      </div>
      <p className="text-[10px] text-slate-500">
        افق: {regimeData.probabilityModelValidation.horizonCandles} کندل آینده · مدل:{' '}
        {regimeData.probabilityModelValidation.modelVersion} · نمونهٔ آموزش/کالیبراسیون/OOS:{' '}
        {regimeData.probabilityModelValidation.trainingSampleSize}/
        {regimeData.probabilityModelValidation.calibrationSampleSize}/
        {regimeData.probabilityModelValidation.oosSampleSize}
        {regimeData.probabilityModelValidation.oosBrierScore !== null
          ? ` · Brier OOS: ${regimeData.probabilityModelValidation.oosBrierScore}`
          : ''}
      </p>

      {/* بخش استراتژی اختصاصی رژیم جاری */}
      <div className="bg-gradient-to-r from-purple-950/50 via-slate-900 to-indigo-950/50 border border-purple-500/30 rounded-xl p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/10 border border-purple-400/30 rounded-xl text-purple-300 shrink-0">
            <Sliders className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-purple-300 font-bold uppercase tracking-wider">
                استراتژی سازگار و اختصاصی برای این رژیم:
              </span>
              <span className="text-[11px] bg-purple-950 text-purple-200 border border-purple-700 px-2 py-0.5 rounded font-bold font-mono">
                {regimeData.suitableStrategy}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {regimeData.strategyDescriptionFa}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 bg-slate-950/90 px-3 py-2 rounded-xl border border-slate-800 text-xs font-mono">
          <div className="text-right">
            <div className="text-[10px] text-slate-400">نسبت ATR</div>
            <div className="font-bold text-amber-300">{regimeData.metrics.atrRatio}x</div>
          </div>
          <div className="w-px h-7 bg-slate-800" />
          <div className="text-right">
            <div className="text-[10px] text-slate-400">پهنای بولینگر</div>
            <div className="font-bold text-cyan-300">{regimeData.metrics.bollingerBandWidthPct}%</div>
          </div>
          <div className="w-px h-7 bg-slate-800" />
          <div className="text-right">
            <div className="text-[10px] text-slate-400">انحراف VWAP</div>
            <div className="font-bold text-indigo-300">{regimeData.metrics.vwapDeviationStd}σ</div>
          </div>
        </div>
      </div>

      {/* ۹ رژیم بازار به صورت کلاسترهای درصدی */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5 text-[10px] font-mono">
        {allRegimes.map(r => {
          const isActive = regimeData.activeRegime === r.key;
          const prob = regimeData.regimeProbabilities[r.key] || 0;
          return (
            <div
              key={r.key}
              className={`p-2 rounded-xl border text-center transition-all flex flex-col justify-between ${
                isActive
                  ? 'bg-purple-950/60 border-purple-500 shadow-md text-purple-200 font-bold ring-1 ring-purple-500/40'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400'
              }`}
            >
              <div className="truncate text-[9px] mb-1">{r.nameFa.split(' ')[0]}</div>
              <div className={`text-xs font-bold ${isActive ? 'text-purple-300' : 'text-slate-300'}`}>
                {prob}%
              </div>
            </div>
          );
        })}
      </div>

      {/* ۲۸. بخش ماتریس تخصصی ستاپ × رژیم (Setup × Regime × Timeframe Edge Matrix) */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <h4 className="text-xs font-bold text-cyan-200">
              ماتریس لبه آماری ستاپ‌ها در رژیم فعلی (Setup × Regime Matrix)
            </h4>
          </div>

          {/* فیلتر تایم‌فریم */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            {(['1m', '5m', '15m', '1h', '4h'] as TradingTimeframe[]).map(tf => (
              <button
                key={tf}
                onClick={() => setSelectedTimeframe(tf)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                  selectedTimeframe === tf
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* خلاصه ارزیابی گیت */}
        <div className={`p-3 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 ${
          edgeMatrix.isSetupAllowedInCurrentRegime
            ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
            : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
        }`}>
          <div className="flex items-center gap-2">
            {edgeMatrix.isSetupAllowedInCurrentRegime ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <div>
              <div className="text-xs font-bold">
                {edgeMatrix.currentEdgeRecord.validationStatus === 'UNVALIDATED'
                  ? 'UNVALIDATED — ستاپ تا کفایت داده واقعی مسدود است'
                  : edgeMatrix.isSetupAllowedInCurrentRegime
                    ? '✓ ستاپ بر اساس Dataset واقعی مجاز است'
                    : '⛔ ستاپ بر اساس داده واقعی فاقد Edge مثبت است'}
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">{edgeMatrix.summaryVerdictFa}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 bg-slate-950/90 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono">
            <div>
              <span className="text-[10px] text-slate-400 block">وین‌ریت:</span>
              <span className="text-emerald-400 font-bold">{edgeMatrix.currentEdgeRecord.winRatePct !== null ? `${edgeMatrix.currentEdgeRecord.winRatePct}%` : 'UNVALIDATED'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">امید ریاضی (Expectancy):</span>
              <span className={`font-bold ${edgeMatrix.currentEdgeRecord.expectancyR !== null && edgeMatrix.currentEdgeRecord.expectancyR > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {edgeMatrix.currentEdgeRecord.expectancyR !== null
                  ? `${edgeMatrix.currentEdgeRecord.expectancyR > 0 ? '+' : ''}${edgeMatrix.currentEdgeRecord.expectancyR}R`
                  : 'UNVALIDATED'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">Profit Factor:</span>
              <span className="text-amber-300 font-bold">{edgeMatrix.currentEdgeRecord.profitFactor ?? 'UNVALIDATED'}</span>
            </div>
          </div>
        </div>

        {/* جدول مقایسه تک‌تک ستاپ‌ها در رژیم و تایم‌فریم فعال */}
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-[10px] font-mono">
                <th className="py-2 pr-2">نوع ستاپ معامله</th>
                <th className="py-2 text-center">وین‌ریت</th>
                <th className="py-2 text-center">Profit Factor</th>
                <th className="py-2 text-center">امید ریاضی (Expectancy)</th>
                <th className="py-2 text-center">وضعیت فعال‌سازی</th>
                <th className="py-2 pl-2">منطق آماری</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {edgeMatrix.matrixRecords.map(record => {
                const isSelected = selectedSetup === record.setupType;
                return (
                  <tr
                    key={record.setupType}
                    onClick={() => setSelectedSetup(record.setupType)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-cyan-950/40' : 'hover:bg-slate-900/60'
                    }`}
                  >
                    <td className="py-2.5 pr-2 font-bold text-slate-200 flex items-center gap-1.5">
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                      <span>{record.setupTypeFa}</span>
                    </td>
                    <td className="py-2.5 text-center font-mono font-bold text-emerald-400">
                      {record.winRatePct !== null ? `${record.winRatePct}%` : 'UNVALIDATED'}
                    </td>
                    <td className="py-2.5 text-center font-mono text-amber-300">
                      {record.profitFactor ?? 'UNVALIDATED'}
                    </td>
                    <td className={`py-2.5 text-center font-mono font-black ${
                        record.expectancyR !== null && record.expectancyR > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {record.expectancyR !== null
                        ? `${record.expectancyR > 0 ? '+' : ''}${record.expectancyR}R`
                        : 'UNVALIDATED'}
                    </td>
                    <td className="py-2.5 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        record.positiveEdgeVerified
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                          : 'bg-rose-950 text-rose-300 border-rose-700'
                      }`}>
                        {record.activationStatus === 'UNVALIDATED'
                          ? 'UNVALIDATED'
                          : record.positiveEdgeVerified ? '✓ مجاز (ACTIVE)' : '⛔ مسدود (BLOCKED)'}
                      </span>
                    </td>
                    <td className="py-2.5 pl-2 text-[10px] text-slate-400 max-w-[280px] truncate">
                      {record.reasonFa}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
