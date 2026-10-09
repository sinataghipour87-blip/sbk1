import React, { useState, useEffect } from 'react';
import { Brain, Cpu, Sparkles, RefreshCw, Zap, Award, Flame, CheckCircle2, Sliders, ShieldCheck } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { tfjsRlEngine, RlActionOutput, RlStateVector } from '../services/tfjsReinforcementLearningEngine';
import { AnalysisResult, TradeHistory } from '../types/trading';

interface Props {
  analysis: AnalysisResult | null;
  aiPrediction: any;
  historyList?: TradeHistory[];
}

export const TfjsReinforcementLearningWidget: React.FC<Props> = ({
  analysis,
  aiPrediction,
  historyList = []
}) => {
  const [currentAction, setCurrentAction] = useState<RlActionOutput | null>(null);
  const [stats, setStats] = useState({ isTrained: true, epochsCount: 0, replayBufferCount: 0, epsilonExploration: 0.15 });
  const [isTrainingAnim, setIsTrainingAnim] = useState(false);

  // ارزیابی زنده مدل یادگیری تقویتی TensorFlow.js
  useEffect(() => {
    const sv = tfjsRlEngine.extractStateVector(analysis, aiPrediction, historyList);
    const action = tfjsRlEngine.predictOptimalAction(sv);
    setCurrentAction(action);
    setStats(tfjsRlEngine.getTrainingStats());
  }, [analysis, aiPrediction, historyList]);

  const handleManualRlTraining = async () => {
    setIsTrainingAnim(true);
    if (historyList.length > 0) {
      const lastTrade = historyList[historyList.length - 1];
      await tfjsRlEngine.trainOnClosedTrade(lastTrade, analysis, aiPrediction);
    }
    setTimeout(() => {
      setStats(tfjsRlEngine.getTrainingStats());
      setIsTrainingAnim(false);
    }, 1000);
  };

  if (!currentAction) return null;

  return (
    <CollapsibleCard
      title="عامل یادگیری تقویتی TensorFlow.js و اصلاح خودکار نرخ برد (Win-Rate Agent)"
      badge="TensorFlow.js RL Core"
      badgeColor="text-cyan-300 bg-cyan-950/80 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)]"
      defaultOpen={true}
      icon={<Brain className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleManualRlTraining}
          disabled={isTrainingAnim}
          className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isTrainingAnim ? 'animate-spin' : ''}`} />
          <span>{isTrainingAnim ? 'در حال آموزش شبکه tfjs...' : 'آموزش آنلاین بر اساس آخرین معامله'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Active Action Banner */}
        <div className="bg-[#020b18] border border-cyan-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-cyan-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-500/20 rounded-lg text-cyan-400 border border-cyan-500/30">
                <Cpu className="w-4 h-4 text-cyan-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  اکشن انتخابی عامل یادگیری تقویتی (TensorFlow.js RL Action):
                </span>
                <span className="text-[10px] text-slate-400 font-sans mt-0.5 block">
                  بهینه‌سازی بردار ورود و حد سود بر اساس تاریخچه برد/باخت
                </span>
              </div>
            </div>

            <span className="px-3 py-1 rounded-lg bg-cyan-950 text-cyan-300 border border-cyan-500/50 text-xs font-bold font-sans">
              اکشن: {currentAction.actionName}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-center font-mono">
            <div className="bg-[#041224] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">ضریب فاصله پولبک ورود:</span>
              <span className="text-base font-black text-cyan-300">{currentAction.entryPullbackOffsetMultiplier}x</span>
            </div>

            <div className="bg-[#041224] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">ضریب تارگت‌های سود (TP):</span>
              <span className="text-base font-black text-emerald-300">{currentAction.takeProfitMultiplier}x</span>
            </div>

            <div className="bg-[#041224] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">ضریب حدضرور فشرده (SL):</span>
              <span className="text-base font-black text-amber-300">{currentAction.stopLossTightnessMultiplier}x</span>
            </div>

            <div className="bg-[#041224] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">اپوک‌های آموزش‌دیده:</span>
              <span className="text-base font-black text-indigo-300">{stats.epochsCount}</span>
            </div>
          </div>

          <p className="text-[11px] text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-cyan-900/40">
            {currentAction.recommendationFa}
          </p>
        </div>

        {/* Training Diagnostics Bar */}
        <div className="bg-[#030917] border border-cyan-950 rounded-xl p-2.5 flex items-center justify-between text-[10.5px] font-sans">
          <span className="text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>تعداد نمونه‌های Replay Buffer: <strong className="text-cyan-300 font-mono">{stats.replayBufferCount}</strong></span>
          </span>
          <span className="text-slate-400">
            نرخ اکتشاف (Epsilon): <strong className="text-amber-300 font-mono">{stats.epsilonExploration}</strong>
          </span>
        </div>
      </div>
    </CollapsibleCard>
  );
};
