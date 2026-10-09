import React, { useState } from 'react';
import { sbFiveModelsEngine, SbPentagonOutput, SbModelStatus } from '../services/sbFiveModelsEngine';
import { AnalysisResult, TradeHistory, TradePosition } from '../types/trading';
import { Brain, Cpu, ShieldCheck, TrendingUp, Zap, CheckCircle2, RefreshCw, Award, ArrowUpRight, ArrowDownRight, Layers, Target, Sliders } from 'lucide-react';

interface Props {
  analysis: AnalysisResult | null;
  aiPrediction: any;
  currentPrice: number;
  activePositions: TradePosition[];
  tradeHistory: TradeHistory[];
}

export const SbFiveModelsPanel: React.FC<Props> = ({
  analysis,
  aiPrediction,
  currentPrice,
  activePositions,
  tradeHistory,
}) => {
  const [selectedModelId, setSelectedModelId] = useState<'SB1' | 'SB2' | 'SB3' | 'SB4' | 'SB5'>('SB5');
  const [autoTeachMode, setAutoTeachMode] = useState<boolean>(true);

  const pentagonData: SbPentagonOutput = sbFiveModelsEngine.evaluatePentagon(
    analysis,
    aiPrediction,
    currentPrice,
    activePositions,
    tradeHistory
  );

  const selectedModel = pentagonData.models.find(m => m.id === selectedModelId) || pentagonData.models[4];

  const getModelIcon = (id: string) => {
    switch (id) {
      case 'SB1': return <TrendingUp className="w-5 h-5 text-sky-400" />;
      case 'SB2': return <Zap className="w-5 h-5 text-amber-400" />;
      case 'SB3': return <Target className="w-5 h-5 text-emerald-400" />;
      case 'SB4': return <ShieldCheck className="w-5 h-5 text-rose-400" />;
      case 'SB5': return <Cpu className="w-5 h-5 text-purple-400" />;
      default: return <Brain className="w-5 h-5 text-indigo-400" />;
    }
  };

  return (
    <div className="bg-slate-900/95 border border-indigo-500/30 rounded-2xl p-5 shadow-2xl backdrop-blur-md text-white mb-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/20">
            <Cpu className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">
                پنج مدل هوش مصنوعی تخصصی (مدل‌های SB1 تا SB5)
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                هماهنگی ۱۰۰٪ فعال
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              سیستم همگام‌ساز چندمدلی بدون تداخل • بیشینه‌سازی سود در روند مثبت • سپر ضدزیان و خروج سربه‌سر قطعی
            </p>
          </div>
        </div>

        {/* Global Harmonization & Auto-Teach status */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoTeachMode(!autoTeachMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              autoTeachMode
                ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoTeachMode ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            {autoTeachMode ? 'یادگیری و آموزش خودکار: فعال' : 'یادگیری خودکار: متوقف'}
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700/80">
            <span className="text-xs text-slate-400">شاخص یکپارچگی ارکان:</span>
            <span className="text-sm font-black text-emerald-400">
              {pentagonData.harmonizationIndexPct}%
            </span>
          </div>
        </div>
      </div>

      {/* Model Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {pentagonData.models.map((model) => {
          const isSelected = model.id === selectedModelId;
          return (
            <div
              key={model.id}
              onClick={() => setSelectedModelId(model.id)}
              className={`cursor-pointer rounded-xl p-3.5 border transition-all duration-200 text-right ${
                isSelected
                  ? 'bg-gradient-to-b from-indigo-950/70 to-slate-900 border-indigo-500 shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-400/50'
                  : 'bg-slate-800/60 border-slate-700/60 hover:bg-slate-800/90 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 text-xs font-black rounded-md ${
                    model.id === 'SB5' ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40' :
                    model.id === 'SB4' ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40' :
                    model.id === 'SB3' ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40' :
                    model.id === 'SB2' ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40' :
                    'bg-sky-500/30 text-sky-300 border border-sky-500/40'
                  }`}>
                    {model.id}
                  </span>
                </div>
                {getModelIcon(model.id)}
              </div>

              <div className="text-sm font-bold text-slate-100 truncate mb-1">
                {model.nameFa.split('(')[0]}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>اطمینان پیش‌بینی:</span>
                <span className="font-bold text-indigo-300">
                  {model.confidencePct !== null ? `${model.confidencePct}%` : 'فاقد کالیبراسیون OOS'}
                </span>
              </div>

              <div className="w-full bg-slate-700/60 rounded-full h-1.5 overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    model.id === 'SB4' ? 'bg-rose-400' :
                    model.id === 'SB3' ? 'bg-emerald-400' :
                    model.id === 'SB5' ? 'bg-purple-400' : 'bg-indigo-400'
                  }`}
                  style={{ width: `${model.confidencePct ?? 0}%` }}
                />
              </div>

              <div className="text-[11px] text-slate-300 truncate">
                <span className="text-slate-400">{model.metricLabelFa}: </span>
                <span className="font-semibold text-slate-200">{model.metricValue}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Model Focus & Teaching Dossier */}
      <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 text-right">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3 mb-3">
          <div className="flex items-center gap-2">
            {getModelIcon(selectedModel.id)}
            <span className="font-bold text-slate-100 text-sm">
              شناسنامه وظایف و آموزش تخصصی مدل {selectedModel.id} ({selectedModel.nameFa})
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <span className="text-slate-400">
              چرخه‌های یادگیری تکاملی: <strong className="text-emerald-400">{selectedModel.learningCycles.toLocaleString()} دوره</strong>
            </span>
            <span className="text-slate-400">
              بازدهی یادگیری: <strong className="text-indigo-400">{selectedModel.learningEfficiencyPct !== null ? `${selectedModel.learningEfficiencyPct}%` : 'در انتظار اعتبارسنجی'}</strong>
            </span>
          </div>
        </div>

        {/* Detailed role and duty explanation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
            <div className="flex items-center gap-1.5 font-bold text-indigo-300">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>شرح ماموریت و وظیفه تعیین شده در سیستم:</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              {selectedModel.dutyFa}
            </p>
            <div className="text-slate-400 pt-1 border-t border-slate-800/60">
              <strong>نقش سیستمی: </strong>{selectedModel.roleFa}
            </div>
          </div>

          <div className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
            <div className="flex items-center gap-1.5 font-bold text-emerald-300">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span>دستور زنده مدل در این ثانیه برای ترید واقعی:</span>
            </div>
            <p className="text-slate-200 leading-relaxed font-medium">
              {selectedModel.liveDirectiveFa}
            </p>
            <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-800/60">
              <span>جهت‌گیری تحلیلی:</span>
              <span className="font-bold text-slate-200">{selectedModel.bias}</span>
            </div>
          </div>
        </div>

        {/* Interactive Model Teaching & Training Console */}
        <div className="mt-3 p-3 bg-slate-900/80 border border-indigo-500/20 rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-indigo-400" />
              یاد دادن استراتژی‌های جدید به مدل {selectedModel.id}:
            </span>
            <span className="text-[11px] text-slate-400">
              تثبیت در وزن‌های بیزی و شبکه یادگیری تقویتی
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={() => {
                const res = sbFiveModelsEngine.teachModel(selectedModel.id, 'خروج فوری و ذخیره سود در اولین پولبک');
                alert(res.messageFa);
              }}
              className="px-2.5 py-1.5 bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-500/30 text-indigo-200 rounded-lg transition-all"
            >
              🎓 آموزش: خروج فوق‌سریع در پولبک و قفل سود
            </button>
            <button
              onClick={() => {
                const res = sbFiveModelsEngine.teachModel(selectedModel.id, 'عدم ورود به معاملات پله‌ای در شرایط منفی');
                alert(res.messageFa);
              }}
              className="px-2.5 py-1.5 bg-rose-950/70 hover:bg-rose-900 border border-rose-500/30 text-rose-200 rounded-lg transition-all"
            >
              🛡️ آموزش: منع ورود پله دوم در ضرر (تضمین تک معامله)
            </button>
            <button
              onClick={() => {
                const res = sbFiveModelsEngine.teachModel(selectedModel.id, 'دنبال‌کردن پارابولیک روند تا اوج دیوارهای نقدینگی');
                alert(res.messageFa);
              }}
              className="px-2.5 py-1.5 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-200 rounded-lg transition-all"
            >
              🚀 آموزش: دوشیدن روند تا قطره آخر با تریلینگ پارابولیک
            </button>
          </div>
        </div>

        {/* Master Orchestration Summary (SB5 Coordination) */}
        <div className="mt-4 p-3 bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-slate-900/80 border border-purple-500/30 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-purple-400 shrink-0" />
            <span className="text-slate-200 leading-relaxed">
              <strong>نتیجه تجمیع ۵ مدل SB:</strong> {pentagonData.unificationReportFa}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-purple-600/30 text-purple-200 border border-purple-400/40 rounded-lg font-bold">
              تصمیم نهایی: {pentagonData.masterDecision}
            </span>
            <span className="px-3 py-1 bg-emerald-600/30 text-emerald-200 border border-emerald-400/40 rounded-lg font-bold">
              ضریب سود: {pentagonData.profitHarvestMultiplier}x
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
