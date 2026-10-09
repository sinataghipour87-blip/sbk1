import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Zap,
  Lock,
  Cpu,
  Layers,
  Activity,
  Gauge,
  Clock,
  Database,
  Crosshair,
} from 'lucide-react';
import {
  predictionEngine,
  riskEngine,
  executionEngine,
  FinalProductionGateReport,
  RiskVerdict,
  PredictionCandidatePayload,
} from '../services/productionGateThreeLayerEngine';
import { AnalysisResult, TradeHistory, TradePosition } from '../types/trading';
import { getTradeHistory } from '../services/history';

interface FinalProductionGateWidgetProps {
  analysis?: AnalysisResult | null;
  activePositions?: TradePosition[];
}

export const FinalProductionGateWidget: React.FC<FinalProductionGateWidgetProps> = ({
  analysis,
  activePositions = [],
}) => {
  const [prediction, setPrediction] = useState<PredictionCandidatePayload | null>(null);
  const [riskVerdict, setRiskVerdict] = useState<RiskVerdict | null>(null);
  const [gateReport, setGateReport] = useState<FinalProductionGateReport | null>(null);

  const runFullPipelineAudit = () => {
    const history = getTradeHistory();

    // Layer 1: Prediction Engine
    const predPayload = predictionEngine.generatePredictionPayload(analysis ?? null);
    setPrediction(predPayload);

    // Layer 2: Risk Engine
    const accountState = {
      availableBalanceUsdt: 1000,
      currentDailyLossUsd: 0,
      maxEquityUsd: 1000,
      currentEquityUsd: 1000,
    };
    const riskRes = riskEngine.evaluateRiskGate(
      predPayload,
      accountState,
      activePositions,
      history
    );
    setRiskVerdict(riskRes);

    // Layer 3: Execution Engine Final Production Gate Audit
    const report = executionEngine.evaluateFinalProductionGate(
      riskRes,
      analysis ?? null,
      activePositions,
      history
    );
    setGateReport(report);
  };

  useEffect(() => {
    runFullPipelineAudit();
    const interval = setInterval(runFullPipelineAudit, 10000);
    return () => clearInterval(interval);
  }, [analysis, activePositions]);

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden transition-all duration-300 hover:border-slate-700">
      {/* Background Glow */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
            <ShieldCheck className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">
                گیت نهایی پروداکشن و معماری سه لایه (Final Production Gate & 3-Layer Architecture)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                بند ۴۹ و ۵۰ استراتژی
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              تفکیک کامل Prediction، Risk و Execution | ارزیابی هم‌زمان ۱۹ گیت حیاتی قبل از هر معامله واقعی
            </p>
          </div>
        </div>

        <button
          onClick={runFullPipelineAudit}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5 text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
          <span>ارزیابی مجدد</span>
        </button>
      </div>

      {/* Three Layer Independent Architecture Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {/* Layer 1: Prediction Engine */}
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-cyan-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              ۱. Prediction Engine
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold">
              مستقل (بدون ارسال سفارش)
            </span>
          </div>
          <div className="text-[11px] text-slate-300">
            جهت: <strong className="text-cyan-400">{prediction?.direction || 'NEUTRAL'}</strong> | احتمال: <strong className="text-emerald-400">{prediction?.calibratedProbabilityPct ?? 'N/A'}%</strong>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            محاسبه خالص پیش‌بینی و احتمال کالیبره‌شده. هیچ دسترسی مستقیم به ارسال سفارش صرافی ندارد.
          </p>
        </div>

        {/* Layer 2: Risk Engine */}
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-amber-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              ۲. Risk Engine
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${riskVerdict?.isApproved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
              {riskVerdict?.isApproved ? 'RISK_APPROVED' : 'NO_TRADE'}
            </span>
          </div>
          <div className="text-[11px] text-slate-300">
            وضعیت: <strong className={riskVerdict?.isApproved ? 'text-emerald-400' : 'text-rose-400'}>{riskVerdict?.decision || 'NO_TRADE'}</strong>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            اعمال آستانه‌های احتمالی، $EV، دراوداون کل، حد ضرر روزانه و دیوار آتش شوک خبری.
          </p>
        </div>

        {/* Layer 3: Execution Engine */}
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-emerald-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              ۳. Execution Engine
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${gateReport?.overallVerdict === 'EXECUTION_AUTHORIZED' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
              {gateReport?.gateScore || '0 / 19'}
            </span>
          </div>
          <div className="text-[11px] text-slate-300">
            گیت نهایی: <strong className={gateReport?.overallVerdict === 'EXECUTION_AUTHORIZED' ? 'text-emerald-400 font-black' : 'text-rose-400 font-black'}>{gateReport?.overallVerdict || 'NO_TRADE'}</strong>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            بررسی اسنپ‌شات میلی‌ثانیه‌ای بازار و اجرای شلیک نهایی فقط با قبولی هم‌زمان هر ۱۹ گیت.
          </p>
        </div>
      </div>

      {/* Overall Verdict Banner */}
      <div
        className={`p-4 rounded-xl border mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          gateReport?.overallVerdict === 'EXECUTION_AUTHORIZED'
            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
            : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {gateReport?.overallVerdict === 'EXECUTION_AUTHORIZED' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
            )}
            <span className="text-sm font-bold">
              نتیجه ارزیابی گیت پروداکشن: {gateReport?.overallVerdict === 'EXECUTION_AUTHORIZED' ? 'مجاز به معامله (EXECUTION AUTHORIZED)' : 'عدم معامله (NO TRADE)'}
            </span>
          </div>
          <p className="text-xs opacity-90 leading-relaxed">
            {gateReport?.overallVerdict === 'EXECUTION_AUTHORIZED'
              ? '✅ تمام ۱۹ شرط امنیتی و ۱۱ ستون ضربی قانون نهایی پروداکشن به طور همزمان PASS شدند. سیستم دارای برتری آماری تاییدشده برای معامله است.'
              : '🛑 بر اساس قانون Fail-Closed، به دلیل رد شدن حداقل یک شرط حیاتی، معامله به طور کامل مسدود گردید (NO TRADE). Score بالا به‌تنهایی هرگز مجوز معامله نیست.'}
          </p>
        </div>

        <div className="text-right sm:text-left flex-shrink-0">
          <span className="text-[10px] text-slate-400 block">امتیاز گیت‌های قبولی:</span>
          <span className="text-base font-black text-amber-400">{gateReport?.gateScore || '0 / 19'}</span>
        </div>
      </div>

      {/* ⚖️ منشور و قانون نهایی QUANTUM TRADE AI: ۱۱ ستون ضربی */}
      {gateReport?.quantumLawReport && (
        <div className="mb-6 p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-slate-200">
                قانون نهایی Quantum Trade AI: فرمول ۱۱ شرط ضربی (Multiplicative Gates)
              </h4>
              <span className="text-[10px] px-2 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-bold">
                حاصل‌ضرب قطعی ۱۱ ستون
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">نتیجه معادله:</span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${
                  gateReport.quantumLawReport.isTradePermitted
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                }`}
              >
                {gateReport.quantumLawReport.isTradePermitted ? '1 (APPROVED)' : '0 (FAIL-CLOSED NO_TRADE)'}
              </span>
            </div>
          </div>

          {/* Formula Display */}
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] font-mono text-slate-300 leading-relaxed overflow-x-auto text-center" dir="ltr">
            <span className="text-amber-400 font-bold">TRADE_ALLOWED</span> = DATA_VALID × MODEL_HEALTHY × CALIBRATED_PROBABILITY × CONFIDENCE_INTERVAL × POSITIVE_NET_EDGE × ENTRY_QUALITY × TRIGGER_CONFIRMED × WAVE_CONDITIONS × RISK_APPROVED × FRESH_SNAPSHOT × REAL_EXECUTION
          </div>

          {/* 11 Pillars Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {gateReport.quantumLawReport.pillars.map((pillar, idx) => (
              <div
                key={pillar.key}
                className={`p-2.5 rounded-lg border transition-all flex flex-col justify-between space-y-1.5 ${
                  pillar.passed
                    ? 'bg-slate-900/60 border-slate-800/80'
                    : 'bg-rose-950/25 border-rose-500/30 text-rose-200'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 truncate">
                    {pillar.passed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                    )}
                    <span className="text-[11px] font-bold text-slate-200 truncate">{pillar.labelFa}</span>
                  </div>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold flex-shrink-0 ${
                      pillar.passed
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {pillar.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>

                <div className="text-[10px] text-slate-400 space-y-0.5">
                  <div className="flex justify-between">
                    <span>وضعیت:</span>
                    <strong className="text-slate-200 truncate max-w-[170px]">{pillar.value}</strong>
                  </div>
                  <div className="text-[9px] text-slate-500 border-t border-slate-800/60 pt-1">
                    {pillar.evidenceFa}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Hunter Philosophy & Validation Protocol Footer */}
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/70 text-[11px] text-slate-300 space-y-1.5">
            <div className="flex items-center gap-2 text-amber-300 font-bold text-[11px]">
              <Activity className="w-3.5 h-3.5" />
              <span>هدف سیستم Hunter: کم معامله کردن، اما شکار فرصت‌های باکیفیت و بدون تعقیب قیمت (No Chase)</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              ورود در بهترین بخش موج؛ حفاظت هوشمند از سرمایه؛ نگه‌داشتن Runner در موج‌های پرقدرت؛ خروج هنگام فرسایش برتری آماری (Edge Decay)؛ و یادگیری واقعی از نتیجه هر معامله.
            </p>
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
              <span>پروتکل اثبات موفقیت:</span>
              <span className="font-mono text-cyan-300 font-semibold" dir="ltr">Walk-Forward → OOS → Paper/Testnet → Forward Live Validation</span>
            </div>
          </div>
        </div>
      )}

      {/* The 19 Mandatory Production Gate Checklist */}
      {gateReport && (
        <div className="space-y-2">
          <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            چک‌لیست ۱۹ گیت هم‌زمان قبل از شلیک سفارش (Nineteen Production Gates)
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {gateReport.checks.map((c) => (
              <div
                key={c.id}
                className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between space-y-1.5 ${
                  c.passed
                    ? 'bg-slate-950/60 border-slate-800/80'
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    {c.passed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                    )}
                    <span className="text-xs font-bold text-slate-200 truncate">{c.id}. {c.labelFa}</span>
                  </div>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                      c.passed
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {c.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>

                <div className="text-[10px] text-slate-400 flex items-center justify-between">
                  <span>سنجش: <strong className="text-slate-200">{c.measuredValue}</strong></span>
                  <span>حد نصاب: <strong className="text-slate-400">{c.thresholdValue}</strong></span>
                </div>

                <p className="text-[10px] text-slate-400 leading-tight border-t border-slate-800/60 pt-1">
                  {c.rationaleFa}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
