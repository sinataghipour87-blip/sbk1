import React, { useState, useEffect } from 'react';
import {
  Zap,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Lock,
  Flame,
  Activity,
  Award,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { realtimeBrainSynchronizer, SynchronizerTickOutput } from '../services/realtimeBrainEngineSynchronizer';

interface Props {
  analysis: any;
  aiPrediction: any;
  currentPrice: number;
  activePositions: any[];
  recentHistory?: any[];
}

export const RealtimeSynchronizerWidget: React.FC<Props> = ({
  analysis,
  aiPrediction,
  currentPrice,
  activePositions,
  recentHistory = []
}) => {
  const [tickOutput, setTickOutput] = useState<SynchronizerTickOutput | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  // اجرای میلی‌ثانیه‌ای هماهنگ‌ساز (200ms Heartbeat Sync)
  useEffect(() => {
    const runSync = () => {
      const output = realtimeBrainSynchronizer.processSubSecondTick(
        analysis,
        aiPrediction,
        currentPrice,
        activePositions,
        recentHistory
      );
      setTickOutput(output);
    };

    runSync();
    const interval = setInterval(runSync, 200); // 200ms sub-second sync loop
    return () => clearInterval(interval);
  }, [analysis, aiPrediction, currentPrice, activePositions, recentHistory]);

  if (!tickOutput) return null;

  const { autoPilotDirectives, positionAdjustments, multiBrainReport } = tickOutput;

  return (
    <CollapsibleCard
      title="ماژول هماهنگ‌سازی میلی‌ثانیه‌ای ۵ مغز با موتور Auto-Pilot و خروج آسان از زیان"
      badge="۲۰۰ms Sync Speed"
      badgeColor="text-cyan-300 bg-cyan-950/80 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)]"
      defaultOpen={true}
      icon={<Zap className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-[11px] font-mono font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>اتصال زنده میلی‌ثانیه‌ای</span>
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Real-time Sub-second Status Banner */}
        <div className="bg-[#020b18] border border-cyan-500/40 rounded-2xl p-3.5 shadow-xl font-mono text-xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-cyan-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-500/20 rounded-lg text-cyan-400 border border-cyan-500/30">
                <Cpu className="w-4 h-4 text-cyan-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  فرمان آنی هماهنگ‌ساز به موتور ترید خودکار (Auto-Pilot Directive)
                </span>
                <span className="text-[10px] text-slate-400 font-sans mt-0.5 block">
                  کالیبراسیون میلی‌ثانیه‌ای وزن مغزها و تعیین نقاط خروج سربه‌سر
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-lg border text-xs font-bold font-sans ${
                autoPilotDirectives.recommendedDirection === 'LONG'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
                  : 'bg-rose-950 text-rose-300 border-rose-500/40'
              }`}>
                {autoPilotDirectives.recommendedDirection === 'LONG' ? 'سیگنال اجماع: LONG ▲' : 'سیگنال اجماع: SHORT ▼'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-center">
            <div className="bg-[#041224] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">وزن اجماع ۵ مغز:</span>
              <span className="text-base font-black text-cyan-300">{autoPilotDirectives.consensusWeightPct}٪</span>
            </div>

            <div className="bg-[#041224] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">اسنایپ پولبک میلی‌ثانیه‌ای:</span>
              <span className="text-base font-black text-emerald-300">${autoPilotDirectives.subSecondSniperEntryPrice.toLocaleString()}</span>
            </div>

            <div className="bg-[#041224] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">استاپ شناور نوسان‌سنج:</span>
              <span className="text-base font-black text-amber-300">{autoPilotDirectives.adaptiveTrailingOffsetPct}٪</span>
            </div>

            <div className="bg-[#041224] p-2.5 rounded-xl border border-cyan-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">وضعیت Auto-Pilot:</span>
              <span className={`text-xs font-bold font-sans ${
                autoPilotDirectives.canAutoTrade ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {autoPilotDirectives.canAutoTrade ? '✅ مجاز و آماده شلیک' : '⏳ منتظر تاییدیه همگرایی'}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-cyan-900/40">
            {autoPilotDirectives.reasoningFa}
          </p>
        </div>

        {/* Position-Specific Real-time Loss Escape & Profit Maximizer Directives */}
        {positionAdjustments.length > 0 && (
          <div className="bg-[#020916] border border-emerald-500/40 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-emerald-950 pb-2">
              <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5 font-sans">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>دستورالعمل‌های آنی مدیریت معاملات باز ({positionAdjustments.length} معامله):</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                تضمین خروج بی‌زیان + بیشینه‌سازی سود
              </span>
            </div>

            <div className="space-y-2">
              {positionAdjustments.map((adj) => (
                <div
                  key={adj.positionId}
                  className={`p-3 rounded-xl border font-mono text-xs transition-all ${
                    adj.isLossEscapeActive
                      ? 'bg-rose-950/20 border-rose-500/40'
                      : adj.profitMaximizerActive
                      ? 'bg-emerald-950/20 border-emerald-500/40'
                      : 'bg-[#041124] border-slate-800'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 font-sans">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        adj.netPnlUsd >= 0 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}>
                        {adj.netPnlUsd >= 0 ? '+' : ''}${adj.netPnlUsd.toFixed(2)} ({adj.netPnlPct >= 0 ? '+' : ''}{adj.netPnlPct.toFixed(2)}٪)
                      </span>
                      <span className="text-xs text-slate-200 font-bold">
                        {adj.reasonFa}
                      </span>
                    </div>

                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#020a16] border border-cyan-800 text-cyan-300 font-mono">
                      اقدام: {adj.actionRequired}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] pt-2 border-t border-slate-800/80 font-sans">
                    <div>
                      نقطه خروج Breakeven + کارمزد: <strong className="text-amber-300 font-mono">${adj.breakevenPrice.toLocaleString()}</strong>
                    </div>
                    <div>
                      استاپ شناور جدید: <strong className="text-cyan-300 font-mono">${adj.newTrailingStopPrice.toLocaleString()}</strong>
                    </div>
                    <div>
                      فاصله تریلینگ شناور: <strong className="text-indigo-300 font-mono">{adj.trailingOffsetPct}٪</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
};
