import React, { useMemo } from 'react';
import {
  Grid,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  ShieldCheck,
  CheckCircle2,
  HelpCircle,
  BarChart3,
  Flame,
  Scale
} from 'lucide-react';
import { AnalysisResult, CvdOiMatrixReport } from '../types/trading';
import { computeCvdOiDivergenceMatrix } from '../services/derivativesMatrixEngine';

interface CvdOiMatrixWidgetProps {
  analysis?: AnalysisResult | null;
  currentPrice: number;
}

export const CvdOiMatrixWidget: React.FC<CvdOiMatrixWidgetProps> = ({ analysis, currentPrice }) => {
  const price = currentPrice > 0 ? currentPrice : (analysis?.price ?? 0);

  const matrix: CvdOiMatrixReport = useMemo(() => {
    if (analysis?.cvdOiMatrix) {
      return analysis.cvdOiMatrix;
    }
    const candles = analysis?.rawCandles || analysis?.candles || [];
    return computeCvdOiDivergenceMatrix(candles, price, analysis?.orderFlowFeatures);
  }, [analysis, price]);

  // تعیین استایل بر اساس امتیاز ماتریس
  const getScoreBadge = (score: number) => {
    if (score >= 70) return 'text-emerald-400 bg-emerald-950 border-emerald-500/50';
    if (score >= 20) return 'text-cyan-400 bg-cyan-950 border-cyan-500/50';
    if (score <= -60) return 'text-rose-400 bg-rose-950 border-rose-500/50';
    if (score <= -20) return 'text-amber-400 bg-amber-950 border-amber-500/50';
    return 'text-slate-300 bg-slate-800 border-slate-700';
  };

  return (
    <div className="bg-slate-900/90 border border-indigo-900/50 rounded-2xl p-4 shadow-2xl text-slate-100 flex flex-col gap-3">
      {/* هدر */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-950/80 border border-indigo-500/40 rounded-xl text-indigo-400">
            <Grid className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-indigo-200 flex items-center gap-2">
              ماتریس تحلیل ۵ بعدی واگرایی جریان سفارشات (CVD / OI Matrix)
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-indigo-950 text-indigo-300 border border-indigo-800">
                Price + CVD + OI + Funding + Liq
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              ارزیابی همگرایی واقعی و تشخیص تله‌های جذب نهادی (Absorption Traps)
            </p>
          </div>
        </div>

        <div className={`px-3 py-1 rounded-xl border text-xs font-mono font-bold flex items-center gap-1.5 ${getScoreBadge(matrix.matrixScore)}`}>
          <Activity className="w-4 h-4" />
          <span>امتیاز ماتریس: {matrix.matrixScore > 0 ? `+${matrix.matrixScore}` : matrix.matrixScore}</span>
        </div>
      </div>

      {/* هشدار تله نهادی در صورت وجود واگرایی جذب */}
      {matrix.institutionalTrapAlert && (
        <div className="bg-gradient-to-r from-rose-950/80 via-slate-900 to-amber-950/80 border border-rose-500/50 rounded-xl p-3 flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-6 h-6 text-rose-400 animate-bounce shrink-0" />
            <div>
              <span className="text-xs font-bold text-rose-300 block">
                🚨 {matrix.matrixRegimeFa}
              </span>
              <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                {matrix.verdictFa}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono bg-rose-950 text-rose-300 border border-rose-700 px-2 py-1 rounded shrink-0 font-bold">
            TRAP_DETECTED
          </span>
        </div>
      )}

      {/* شبکه ۵ سلولی ابعاد ماتریس */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {matrix.matrixCells.map((cell, idx) => (
          <div
            key={idx}
            className={`p-2.5 rounded-xl border flex flex-col justify-between text-xs transition-all ${
              cell.isDivergent
                ? 'bg-rose-950/40 border-rose-500/50 ring-1 ring-rose-500/30'
                : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="text-[10px] text-slate-400 font-medium mb-1 flex items-center justify-between">
              <span>{cell.dimensionName}</span>
              {cell.isDivergent && (
                <span className="text-[9px] text-rose-400 font-bold bg-rose-950 px-1 rounded border border-rose-800">
                  واگرا
                </span>
              )}
            </div>

            <div className="font-mono font-black text-sm text-slate-100">
              {cell.valueText}
            </div>

            <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
              <span className="text-slate-400">وضعیت:</span>
              <span className={`font-mono font-bold ${
                cell.state === 'UP' || cell.state === 'HIGH_POSITIVE' || cell.state === 'SHORTS_DOMINANT'
                  ? 'text-emerald-400'
                  : (cell.state === 'DOWN' || cell.state === 'HIGH_NEGATIVE' || cell.state === 'LONGS_DOMINANT' ? 'text-rose-400' : 'text-slate-300')
              }`}>
                {cell.state}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* جمع‌بندی تحلیلی ماتریس */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-cyan-400" />
          <span>رژیم فعال جریان سفارشات: <strong className="text-cyan-200">{matrix.matrixRegimeFa}</strong></span>
        </div>
        <span className="text-[10px] font-mono text-slate-400">
          نوع واگرایی: <strong className="text-amber-300">{matrix.divergenceType}</strong>
        </span>
      </div>
    </div>
  );
};
