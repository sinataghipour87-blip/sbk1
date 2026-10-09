import React, { useState } from 'react';
import {
  BrainCircuit,
  Layers,
  Building2,
  Activity,
  GitMerge,
  Anchor,
  Wind,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Lock,
  Unlock,
  Globe,
} from 'lucide-react';
import { SignalToExecutionResult, IndicatorScoreBreakdown } from '../services/signalToExecution';
import { TradePosition } from '../types/trading';

interface PillarsStatusWidgetProps {
  evalResult: SignalToExecutionResult;
  evalResultLong?: SignalToExecutionResult;
  evalResultShort?: SignalToExecutionResult;
  autoTradeActive: boolean;
  minWinProbGate: number;
  activePositions?: TradePosition[];
}

const getPillarIcon = (category: IndicatorScoreBreakdown['category']) => {
  switch (category) {
    case 'AI_NEURAL':
      return <BrainCircuit className="w-4 h-4 text-cyan-400" />;
    case 'ORDER_BOOK_DERIVATIVES':
      return <Anchor className="w-4 h-4 text-blue-400" />;
    case 'FUNDAMENTAL_MACRO_NEWS':
      return <Globe className="w-4 h-4 text-emerald-400" />;
    case 'HTF_TREND':
      return <Layers className="w-4 h-4 text-indigo-400" />;
    case 'SMC_PRICE_ACTION':
      return <Building2 className="w-4 h-4 text-amber-400" />;
    case 'TREND_RIBBON':
      return <GitMerge className="w-4 h-4 text-teal-400" />;
    case 'VOLATILITY_REGIME':
      return <Wind className="w-4 h-4 text-purple-400" />;
    case 'MOMENTUM_INDICATORS':
      return <Activity className="w-4 h-4 text-rose-400" />;
    case 'RISK_ANTI_TILT':
      return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
    default:
      return <Zap className="w-4 h-4 text-cyan-400" />;
  }
};

export const PillarsStatusWidget: React.FC<PillarsStatusWidgetProps> = ({
  evalResult,
  evalResultLong,
  evalResultShort,
  autoTradeActive,
  minWinProbGate,
  activePositions = [],
}) => {
  const [activeTab, setActiveTab] = useState<'LONG' | 'SHORT'>('LONG');

  React.useEffect(() => {
    if (evalResult.direction === 'SHORT') {
      setActiveTab('SHORT');
    } else {
      setActiveTab('LONG');
    }
  }, [evalResult.direction]);

  const currentEvalResult =
    activeTab === 'LONG'
      ? (evalResultLong || evalResult)
      : (evalResultShort || evalResult);

  const {
    canExecute,
    totalScorePct,
    direction,
    breakdown,
    reasonFa,
    totalPillarsPassed,
    totalPillarsCount,
  } = currentEvalResult;

  const passedCount = totalPillarsPassed;
  const isReady = canExecute;

  return (
    <div className="bg-[#0e1117] border border-slate-800 rounded-xl p-4 shadow-lg space-y-3.5 text-right font-sans">
      {/* Header with Master Live Indicators */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2.5 w-2.5">
            <span
              className={`inline-flex rounded-full h-2.5 w-2.5 ${
                isReady ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            ></span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              <span>داشبورد وضعیت ارکان ۸گانه سیستم</span>
              <span className="text-xs text-slate-400 font-normal">(8-Pillar Confluence Radar)</span>
            </h3>
            <p className="text-[11px] text-slate-400 font-sans">
              پایش لحظه‌ای تاییدیه ارکان و تشخیص موانع یا مشوق‌های ورود خودکار
            </p>
          </div>
        </div>

      </div>
 
      {/* Direction Switch Tabs with Integrated Overall Status */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        {/* LONG Pill & Button Column */}
        <div className="flex flex-col gap-1.5">
          <div
            className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-1.5 ${
              (evalResultLong || evalResult).canExecute
                ? 'bg-[#131722] border-emerald-800 text-emerald-400'
                : 'bg-[#131722] border-slate-800 text-slate-300'
            }`}
          >
            <div className="text-[9px] text-slate-400 font-medium">وضعیت کل خرید:</div>
            <div className="flex items-center gap-1.5">
              <div className="font-mono font-bold text-[11px]">
                {(evalResultLong || evalResult).totalPillarsPassed}/{(evalResultLong || evalResult).totalPillarsCount} ({(evalResultLong || evalResult).totalScorePct}%)
              </div>
              {(evalResultLong || evalResult).canExecute ? (
                <Unlock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
            </div>
          </div>
          <button
            onClick={() => setActiveTab('LONG')}
            className={`w-full py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer border ${
              activeTab === 'LONG'
                ? 'bg-slate-800 border-slate-600 text-white'
                : 'bg-[#131722] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🟢 ارکان خرید / LONG</span>
          </button>
        </div>

        {/* SHORT Pill & Button Column */}
        <div className="flex flex-col gap-1.5">
          <div
            className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-1.5 ${
              (evalResultShort || evalResult).canExecute
                ? 'bg-[#131722] border-rose-800 text-rose-400'
                : 'bg-[#131722] border-slate-800 text-slate-300'
            }`}
          >
            <div className="text-[9px] text-slate-400 font-medium">وضعیت کل فروش:</div>
            <div className="flex items-center gap-1.5">
              <div className="font-mono font-bold text-[11px]">
                {(evalResultShort || evalResult).totalPillarsPassed}/{(evalResultShort || evalResult).totalPillarsCount} ({(evalResultShort || evalResult).totalScorePct}%)
              </div>
              {(evalResultShort || evalResult).canExecute ? (
                <Unlock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
            </div>
          </div>
          <button
            onClick={() => setActiveTab('SHORT')}
            className={`w-full py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer border ${
              activeTab === 'SHORT'
                ? 'bg-slate-800 border-slate-600 text-white'
                : 'bg-[#131722] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🔴 ارکان فروش / SHORT</span>
          </button>
        </div>
      </div>

      {/* Active Position Protective Shield Banner */}
      {(() => {
        const sameDirPos = (activePositions || []).find((p) => p.dir === activeTab);
        if (!sameDirPos) return null;
        return (
          <div className="bg-[#030e1f] border border-cyan-500/50 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-1.5 text-xs font-mono shadow-sm">
            <span className="text-cyan-300 font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span>پوزیشن فعال {activeTab === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)'} در بازار در جریان است</span>
            </span>
            <span className="text-slate-300 text-[10.5px]">
              {isReady
                ? 'ارکان در سقف پولبک با جهت معامله همسو هستند؛ گیت ضدضرر مانع ورود پله‌ای مضاعف تا تثبیت سود است.'
                : 'روند کلان با ارکان همسو است؛ سیستم در حال مدیریت معامله باز تا رسیدن به تارگت‌ها است.'}
            </span>
          </div>
        );
      })()}

      {/* Progress & Target Threshold Bar */}
      <div className="space-y-1 bg-[#131722] p-2.5 rounded-lg border border-slate-800">
        <div className="flex justify-between text-[11px] text-slate-400 font-sans">
          <span className="flex items-center gap-1">
            <span>همگرایی کل سیستم:</span>
            <strong className={isReady ? 'text-emerald-400' : 'text-slate-200'}>
              {totalScorePct}%
            </strong>
          </span>
          <span className="text-[10px] text-slate-400">
            حد نصاب ورود خودکار: <strong className="text-slate-200">≥ {currentEvalResult.executionThreshold || (minWinProbGate >= 90 ? 60 : 56)}% مجموع امتیاز وزنی</strong>
          </span>
        </div>
        <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800 relative">
          <div
            className={`h-full transition-all duration-500 ${
              isReady
                ? 'bg-emerald-500'
                : 'bg-slate-600'
            }`}
            style={{ width: `${Math.min(100, totalScorePct)}%` }}
          />
          {/* Threshold marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-slate-400"
            style={{ left: `${currentEvalResult.executionThreshold || (minWinProbGate >= 90 ? 60 : 56)}%` }}
            title={`آستانه ورود خودکار (${currentEvalResult.executionThreshold || (minWinProbGate >= 90 ? 60 : 56)}%)`}
          />
        </div>
      </div>

      {/* 8-Pillar Interactive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {breakdown.map((item, idx) => {
          const isPassed = item.passed;
          return (
            <div
              key={item.id}
              className={`relative p-2.5 rounded-lg border transition-all duration-300 flex flex-col justify-between overflow-hidden ${
                isPassed
                  ? 'bg-[#131722] border-slate-700/80 hover:border-slate-600'
                  : 'bg-[#131722] border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Top Row: Icon + Title + Status Light */}
              <div className="flex items-start justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="p-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                    {getPillarIcon(item.category)}
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-100 leading-tight">
                      {item.nameFa}
                    </div>
                    <div className="text-[9px] text-slate-400 font-mono">
                      رکن {idx + 1} | وزن {item.weight}%
                    </div>
                  </div>
                </div>

                {/* Status Light */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isPassed
                        ? 'bg-emerald-400'
                        : 'bg-rose-500'
                    }`}
                  />
                </div>
              </div>

              {/* Middle Row: Details / Live Reading */}
              <div className="my-2 p-1.5 rounded bg-[#0e1117] border border-slate-800 text-[10px] text-slate-300">
                <span className="text-slate-400 font-sans">وضعیت: </span>
                <span className="font-mono text-slate-200">{item.details}</span>
              </div>

              {/* Bottom Row: Score & Barrier / Catalyst Tag */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[10px]">
                <div className="font-mono text-slate-300">
                  امتیاز: <span className={isPassed ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{item.score}</span> / {item.weight}
                </div>

                {/* Explicit Barrier or Catalyst Badge */}
                {isPassed ? (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 text-[9px] font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>مشوق ورود</span>
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/50 text-[9px] font-medium flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-rose-400" />
                    <span>مانع ورود</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary Footer Bar */}
      <div
        className={`p-3 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-xs font-sans ${
          isReady
            ? 'bg-[#131722] border-emerald-800/60 text-emerald-300'
            : 'bg-[#131722] border-slate-800 text-slate-300'
        }`}
      >
        <div className="flex items-center gap-2">
          {isReady ? (
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-slate-400 flex-shrink-0" />
          )}
          <span>{reasonFa}</span>
        </div>

        <div className="text-[11px] font-medium">
          {autoTradeActive ? (
            isReady ? (
              <span className="text-emerald-400">⚡ آماده ورود خودکار (بدون مانع)</span>
            ) : (
              <span className="text-slate-400">⏳ در انتظار رفع موانع</span>
            )
          ) : (
            <span className="text-slate-400">ربات خودکار خاموش است</span>
          )}
        </div>
      </div>
    </div>
  );
};
