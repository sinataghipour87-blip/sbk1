import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Brain,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Scale,
  Sparkles,
} from 'lucide-react';
import {
  antiSelfDeceptionOnlineLearning,
  AntiSelfDeceptionAudit,
} from '../services/antiSelfDeceptionOnlineLearning';
import { getTradeHistory } from '../services/history';

export const AntiSelfDeceptionOnlineLearningWidget: React.FC = () => {
  const [selectedPillar, setSelectedPillar] = useState<string>('Pillar 1: SB Ensemble');
  const [rawDelta, setRawDelta] = useState<number>(3.0);
  const [audit, setAudit] = useState<AntiSelfDeceptionAudit | null>(null);

  const pillars = [
    'Pillar 1: SB Ensemble',
    'Pillar 2: Order Book & Whale OBI',
    'Pillar 3: Macro & ETF Flows',
    'Pillar 4: HTF Confluence',
    'Pillar 5: SMC & FVG',
    'Pillar 6: Volatility Regime',
  ];

  const runAudit = () => {
    const history = getTradeHistory();
    const res = antiSelfDeceptionOnlineLearning.verifyWeightAdjustment(history, selectedPillar, rawDelta);
    setAudit(res);
  };

  useEffect(() => {
    runAudit();
  }, [selectedPillar, rawDelta]);

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden transition-all duration-300 hover:border-slate-700">
      {/* Background Glow */}
      <div className="absolute -top-20 -left-20 w-44 h-44 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">
                گیت یادگیری آنلاین ضد خودفریبی (Anti-Self-Deception Learning Gate)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                بند ۴۷ استراتژی
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              جلوگیری از افزایش هیجانی وزن مدل‌ها پس از چند برد تصادفی با اعتبارسنجی OOS، اندازه نمونه، P-Value و پایداری رژیم‌ها
            </p>
          </div>
        </div>

        <button
          onClick={runAudit}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5 text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5 text-rose-400" />
          <span>ارزیابی مجدد</span>
        </button>
      </div>

      {/* Interactive Testing Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
        <div>
          <label className="text-[11px] font-medium text-slate-400 block mb-1">
            انتخاب رکن کاندید برای تغییر وزن:
          </label>
          <select
            value={selectedPillar}
            onChange={(e) => setSelectedPillar(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-rose-500"
          >
            {pillars.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-400 block mb-1">
            درخواست افزایش وزن اولیه ({rawDelta > 0 ? '+' : ''}{rawDelta}٪):
          </label>
          <input
            type="range"
            min="-5"
            max="10"
            step="0.5"
            value={rawDelta}
            onChange={(e) => setRawDelta(parseFloat(e.target.value))}
            className="w-full accent-rose-500 cursor-pointer"
          />
        </div>
      </div>

      {/* Four Strict Anti-Self-Deception Gates */}
      {audit && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* Gate 1: Sample Size */}
            <div
              className={`p-3 rounded-xl border space-y-1.5 ${
                audit.sampleSizeGate.passed
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : 'bg-rose-950/20 border-rose-500/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">۱. کف اندازه نمونه</span>
                {audit.sampleSizeGate.passed ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>
              <div className="text-xs font-bold text-slate-300">
                {audit.sampleSizeGate.score} معامله (حداقل {audit.sampleSizeGate.threshold})
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                {audit.sampleSizeGate.detailsFa}
              </p>
            </div>

            {/* Gate 2: Out-of-Sample (OOS) */}
            <div
              className={`p-3 rounded-xl border space-y-1.5 ${
                audit.outOfSampleGate.passed
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : 'bg-rose-950/20 border-rose-500/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">۲. عملکرد OOS</span>
                {audit.outOfSampleGate.passed ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>
              <div className="text-xs font-bold text-slate-300">
                وین‌ریت OOS: {audit.outOfSampleGate.score}٪ (کف {audit.outOfSampleGate.threshold}٪)
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                {audit.outOfSampleGate.detailsFa}
              </p>
            </div>

            {/* Gate 3: Statistical Significance */}
            <div
              className={`p-3 rounded-xl border space-y-1.5 ${
                audit.statisticalSignificanceGate.passed
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : 'bg-rose-950/20 border-rose-500/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">۳. معناداری آماری</span>
                {audit.statisticalSignificanceGate.passed ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>
              <div className="text-xs font-bold text-slate-300">
                ضریب اطمینان: {audit.statisticalSignificanceGate.score}٪ (کف {audit.statisticalSignificanceGate.threshold}٪)
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                {audit.statisticalSignificanceGate.detailsFa}
              </p>
            </div>

            {/* Gate 4: Regime Stability */}
            <div
              className={`p-3 rounded-xl border space-y-1.5 ${
                audit.regimeStabilityGate.passed
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : 'bg-rose-950/20 border-rose-500/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">۴. پایداری رژیم‌ها</span>
                {audit.regimeStabilityGate.passed ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>
              <div className="text-xs font-bold text-slate-300">
                {audit.regimeStabilityGate.score} رژیم سودآور (کف {audit.regimeStabilityGate.threshold})
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                {audit.regimeStabilityGate.detailsFa}
              </p>
            </div>
          </div>

          {/* Verdict Summary Box */}
          <div
            className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              audit.isApproved
                ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                : 'bg-slate-950/80 border-slate-800 text-slate-300'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold">
                  {audit.isApproved ? 'تغییر وزن تایید گردید' : 'تغییر وزن رد شد (محافظت فعال)'}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed opacity-90">{audit.verdictFa}</p>
            </div>

            <div className="text-right sm:text-left flex-shrink-0">
              <span className="text-[10px] text-slate-400 block">تغییر وزن مجاز و نهایی:</span>
              <span
                className={`text-sm font-bold ${
                  audit.approvedWeightDelta > 0
                    ? 'text-emerald-400'
                    : audit.approvedWeightDelta < 0
                    ? 'text-rose-400'
                    : 'text-slate-400'
                }`}
              >
                {audit.approvedWeightDelta > 0 ? '+' : ''}
                {audit.approvedWeightDelta.toFixed(1)}٪
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
