import React, { useState, useEffect } from 'react';
import {
  Zap,
  Target,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Activity,
  RefreshCw,
  Layers,
  Cpu,
  BarChart3,
  DollarSign,
  AlertTriangle,
  Play,
  CheckCircle2,
} from 'lucide-react';
import { orderFlowEngine, OrderFlowSnapshot } from '../services/orderFlowEngine';
import { AnalysisResult } from '../types/trading';

interface HunterOrderFlowDashboardWidgetProps {
  analysis?: AnalysisResult | null;
}

interface SignalSubmissionResult {
  accepted: boolean;
  status: string;
  signalId?: string;
  decisionId?: string;
  code?: string;
  correlationId?: string;
  reason: string;
}

export const HunterOrderFlowDashboardWidget: React.FC<HunterOrderFlowDashboardWidgetProps> = ({
  analysis,
}) => {
  const [snapshot, setSnapshot] = useState<OrderFlowSnapshot>(() =>
    orderFlowEngine.analyzeOrderFlowAndLiquidity(
      analysis?.rawCandles || [],
      analysis?.realObiData,
      analysis?.orderFlowFeatures
    )
  );
  const [executionResult, setExecutionResult] = useState<SignalSubmissionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const analysisDataTimestamp =
    analysis?.futuresPrices?.timestampUtc ?? analysis?.canonicalSnapshot?.timestampUtc;
  const isSubmissionDataReady =
    analysis !== null &&
    analysis !== undefined &&
    typeof analysisDataTimestamp === 'number' &&
    Number.isSafeInteger(analysisDataTimestamp) &&
    Date.now() - analysisDataTimestamp >= 0 &&
    Date.now() - analysisDataTimestamp <= 15_000;

  const updateOrderFlow = () => {
    if (analysis?.rawCandles) {
      const snap = orderFlowEngine.analyzeOrderFlowAndLiquidity(
        analysis.rawCandles,
        analysis.realObiData,
        analysis.orderFlowFeatures
      );
      setSnapshot(snap);
    }
  };

  useEffect(() => {
    updateOrderFlow();
    const interval = setInterval(updateOrderFlow, 5000);
    return () => clearInterval(interval);
  }, [analysis]);

  useEffect(() => {
    const signalId = executionResult?.signalId;
    if (!signalId || ['FILLED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'ERROR'].includes(executionResult.status)) {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/hunter/signals/${encodeURIComponent(signalId)}`);
        if (!response.ok) return;
        const record = await response.json();
        setExecutionResult((current) => current?.signalId === signalId
          ? { ...current, status: record.status, reason: record.reason || current.reason }
          : current);
      } catch (error) {
        console.error('Could not refresh the Freqtrade signal lifecycle:', error);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [executionResult?.signalId, executionResult?.status]);

  const handleExecuteOrder = async () => {
    if (
      !analysis ||
      !isSubmissionDataReady
    ) {
      return;
    }
    setIsExecuting(true);
    try {
      const response = await fetch('/api/hunter/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal: snapshot.activeSignal,
          marketData: {
            status: analysis.dataStatus,
            qualityAllowed: analysis.dataQualityReport.isTradeAllowed,
            dataTimestamp: Number(analysisDataTimestamp),
          },
        })
      });
      const result = await response.json();
      if (!response.ok) {
        setExecutionResult({
          accepted: false,
          status: result.status || 'REJECTED',
          reason: result.error || `HTTP ${response.status}`,
          code: typeof result.code === 'string' ? result.code : undefined,
          correlationId: typeof result.correlationId === 'string' ? result.correlationId : undefined,
        });
        return;
      }
      setExecutionResult({
        accepted: result.accepted === true,
        status: result.status,
        signalId: result.signalId,
        decisionId: result.decisionId,
        reason: result.reason || 'Signal queued; Freqtrade has not confirmed an order yet.',
      });
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsExecuting(false);
    }
  };

  const sig = snapshot.activeSignal;

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden transition-all duration-300 hover:border-slate-700">
      {/* Background Accent */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
            <Target className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">
                سیستم شکارچی نقدینگی و اردرپیرامون (Bitcoin Liquidity & CVD OrderFlow Sniper)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                معماری Quant پروداکشن
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              شناسایی سوئیپ استاپ‌اسیست‌ها در سقف/کف‌های کلیدی | تایید جذب هجمه سفارشات CVD | ریسک به بهای حداقل ۱:۲.۸
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            disabled
            title="آرشیو تاریخی سیگنال‌های واقعی SBK1 موجود نیست"
            className="px-3 py-1.5 rounded-lg bg-indigo-600 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1.5"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>بک‌تست: آرشیو سیگنال در دسترس نیست</span>
          </button>
          <button
            onClick={updateOrderFlow}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
          </button>
        </div>
      </div>

      {/* Refactored Architecture Flow Diagram */}
      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 mb-5">
        <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5 mb-2">
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          دیاگرام معماری یکپارچه Quant Decision Pipeline
        </span>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-center text-[10px]">
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200">
            <span className="text-amber-400 font-bold block mb-0.5">۱. Market Data Feed</span>
            <span>Freqtrade DataProvider</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200">
            <span className="text-cyan-400 font-bold block mb-0.5">۲. SBK1 Analysis</span>
            <span>Order flow / setup detection</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200">
            <span className="text-indigo-400 font-bold block mb-0.5">۳. Evidence & Risk Gates</span>
            <span>Calibration is informational</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200">
            <span className="text-emerald-400 font-bold block mb-0.5">۴. Execution</span>
            <span>Freqtrade virtual dry-run wallet</span>
          </div>
        </div>
      </div>

      {/* Orderflow & CVD Live Snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block">قیمت زنده BTCUSDT</span>
          <span className="text-base font-black text-amber-400">
            {snapshot.currentPrice > 0 ? `$${snapshot.currentPrice.toLocaleString()}` : 'UNAVAILABLE'}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block">CVD معاملات تیکر (دادهٔ واقعی)</span>
          <span className={`text-base font-black ${snapshot.cvdValueBtc === null ? 'text-slate-400' : snapshot.cvdValueBtc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {snapshot.cvdValueBtc === null ? 'UNKNOWN' : `${snapshot.cvdValueBtc >= 0 ? '+' : ''}${snapshot.cvdValueBtc} BTC`}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block">نسبت بالانس خریدار/فروشنده</span>
          <span className="text-base font-black text-slate-200">
            {snapshot.deltaRatio === null ? 'UNKNOWN' : `${snapshot.deltaRatio >= 0 ? '+' : ''}${(snapshot.deltaRatio * 100).toFixed(1)}%`}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block">وضعیت جذب اردرپیرامون</span>
          <span className={`text-xs font-bold ${snapshot.isAbsorptionDetected ? 'text-emerald-400' : 'text-slate-400'}`}>
            {snapshot.isAbsorptionDetected === null ? 'UNKNOWN' : snapshot.isAbsorptionDetected ? '⚡ جذب جریان تایید شد' : 'جذب تایید نشد'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5 text-[10px]">
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          ورود / خروج نقدینگی: {snapshot.liquidityInflowUsd === null || snapshot.liquidityWithdrawalUsd === null
            ? 'UNKNOWN'
            : `$${Math.round(snapshot.liquidityInflowUsd).toLocaleString()} / $${Math.round(snapshot.liquidityWithdrawalUsd).toLocaleString()}`}
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          ماندگاری دیوار: {snapshot.wallPersistenceSec === null ? 'UNKNOWN' : `${snapshot.wallPersistenceSec.toFixed(1)} ثانیه`}
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          لغو دیوار: {snapshot.wallCancellationDetected === null ? 'UNKNOWN' : snapshot.wallCancellationDetected ? 'مشاهده شد' : 'مشاهده نشد'}
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          فشردگی / انبساط اسپرد: {snapshot.spreadCompressionUsd === null || snapshot.spreadExpansionUsd === null
            ? 'UNKNOWN'
            : `$${snapshot.spreadCompressionUsd.toFixed(2)} / $${snapshot.spreadExpansionUsd.toFixed(2)}`}
        </div>
      </div>

      {/* Active Liquidity Sweep Signal Card */}
      <div className="p-4 rounded-xl bg-slate-950/90 border border-amber-500/30 mb-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            {sig.direction === 'LONG' ? (
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            ) : sig.direction === 'SHORT' ? (
              <TrendingDown className="w-5 h-5 text-rose-400" />
            ) : (
              <Activity className="w-5 h-5 text-slate-400" />
            )}
            <div>
              <span className="text-sm font-bold text-slate-100 block">
                سیگنال شکار نقدینگی: {sig.setupType !== 'NONE' ? sig.setupType : 'در حال پایش سطح بعدی...'}
              </span>
              <span className="text-[10px] text-slate-400">
                امتیاز موتور: {sig.signalConfidencePct === null ? 'موجود نیست' : sig.signalConfidencePct}
              </span>
            </div>
          </div>

          {sig.direction !== 'NEUTRAL' && (
            <button
              onClick={handleExecuteOrder}
              disabled={isExecuting || !isSubmissionDataReady}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-lg"
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>{isExecuting ? 'در حال ارسال...' : 'ارسال سیگنال به صف Freqtrade'}</span>
            </button>
          )}
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">{sig.rationaleFa}</p>

        {sig.direction !== 'NEUTRAL' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">سطح سوئیپ‌شده</span>
              <strong className="text-amber-400">${sig.sweptLevelPrice.toLocaleString()}</strong>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">حد ضرر قطعی (Hard SL)</span>
              <strong className="text-rose-400">${sig.invalidationStopLoss.toLocaleString()}</strong>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">حد سود اول (۱:۲.۸ R:R)</span>
              <strong className="text-emerald-400">${sig.takeProfitTarget1.toLocaleString()}</strong>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">نسبت Risk-Reward</span>
              <strong className="text-indigo-400">{sig.riskRewardRatio} : 1</strong>
            </div>
          </div>
        )}
      </div>

      {/* Freqtrade Signal Lifecycle Notice */}
      {executionResult && (
        <div
          className={`p-3.5 rounded-xl border mb-5 text-xs ${
            executionResult.accepted
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            {executionResult.accepted
              ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              : <AlertTriangle className="w-4 h-4 text-rose-400" />}
            <span>چرخه سیگنال Freqtrade: {executionResult.status}</span>
          </div>
          <p>{executionResult.reason}</p>
          {executionResult.code && <p className="mt-1 font-mono">Reason code: {executionResult.code}</p>}
          {executionResult.correlationId && <p className="mt-1 font-mono">Correlation ID: {executionResult.correlationId}</p>}
          {executionResult.signalId && <p className="mt-1 font-mono">Signal ID: {executionResult.signalId}</p>}
        </div>
      )}

      <div role="status" className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-950/20 p-3 text-xs text-sky-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
        <div>
          <p className="font-bold">اطلاعات کالیبراسیون</p>
          <p className="mt-1">نبود آرشیو یا احتمال کالیبره‌شده فقط به‌عنوان محدودیت آماری نمایش داده می‌شود؛ ارسال همچنان به snapshot تازه، جهت معتبر و اعتبار فنی ورود/استاپ/هدف وابسته است.</p>
          <p className="mt-1">
            وضعیت Last/Mark/Index: {analysis?.futuresPrices?.status ?? 'UNAVAILABLE'}
            {typeof analysis?.futuresPrices?.ageMs === 'number' ? `؛ سن داده ${analysis.futuresPrices.ageMs}ms` : ''}
          </p>
          {analysis?.dataQualityReport?.reasonsFa.map((reason, index) => (
            <p key={`${index}-${reason}`} className="mt-1">{reason}</p>
          ))}
          <p className="mt-1">داده‌های CVD/جریان معاملات یا هر feature پشتیبانی‌نشدهٔ دیگر `UNKNOWN/UNAVAILABLE` می‌مانند و نباید از اعداد شبیه‌سازی‌شده پر شوند.</p>
        </div>
      </div>
    </div>
  );
};
