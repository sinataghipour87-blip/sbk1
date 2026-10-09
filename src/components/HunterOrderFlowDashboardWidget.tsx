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
import type { ExecutedOrderResult } from '../services/hunterExecutionEngine';
import { AnalysisResult } from '../types/trading';

interface HunterOrderFlowDashboardWidgetProps {
  analysis?: AnalysisResult | null;
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
  const [executionResult, setExecutionResult] = useState<ExecutedOrderResult | null>(null);
  const [backtestData, setBacktestData] = useState<any | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isRunningBacktest, setIsRunningBacktest] = useState<boolean>(false);

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

  const handleExecuteOrder = async () => {
    if (snapshot.activeSignal.signalConfidencePct === null) {
      return;
    }
    setIsExecuting(true);
    try {
      const response = await fetch('/api/hunter/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal: snapshot.activeSignal
        })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      setExecutionResult(result as ExecutedOrderResult);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleRunBacktest = async () => {
    setIsRunningBacktest(true);
    try {
      const res = await fetch('/api/backtest/run');
      if (res.ok) {
        const data = await res.json();
        setBacktestData(data);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsRunningBacktest(false);
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
            onClick={handleRunBacktest}
            disabled={isRunningBacktest}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs transition flex items-center gap-1.5"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>{isRunningBacktest ? 'در حال بک‌تست...' : 'بک‌تست واقعی'}</span>
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
            <span>Bybit V5 WS + REST</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200">
            <span className="text-cyan-400 font-bold block mb-0.5">۲. OrderFlow & Sweep</span>
            <span>CVD Delta + Liquidity Sweep</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200">
            <span className="text-indigo-400 font-bold block mb-0.5">۳. Risk Governor</span>
            <span>Hard SL + Min 1:2.5 R:R</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200">
            <span className="text-emerald-400 font-bold block mb-0.5">۴. Execution Broker</span>
            <span>Bybit HMAC Signature</span>
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
              <span className="text-[10px] text-slate-400">اطمینان CVD: {sig.signalConfidencePct === null ? 'UNKNOWN' : `${sig.signalConfidencePct}%`}</span>
            </div>
          </div>

          {sig.direction !== 'NEUTRAL' && (
            <button
              onClick={handleExecuteOrder}
              disabled={isExecuting || sig.signalConfidencePct === null}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-lg"
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>{isExecuting ? 'در حال ارسال سفارش...' : sig.signalConfidencePct === null ? 'اجرای مسدود: CVD نامشخص' : 'شلیک سفارش (Execute Hunter)'}</span>
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

      {/* Executed Order Result Notice */}
      {executionResult && (
        <div
          className={`p-3.5 rounded-xl border mb-5 text-xs ${
            executionResult.success
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>پاسخ بروکر اجرای سفارش:</span>
          </div>
          <p>{executionResult.messageFa}</p>
        </div>
      )}

      {/* Realistic Backtest Output Report */}
      {backtestData && (
        <div className="p-4 rounded-xl bg-slate-950/80 border border-indigo-500/30 space-y-3 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="font-bold text-indigo-300 flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4" />
              نتایج بک‌تست واقعی (Realistic Quant Backtest Results)
            </span>
            <span className="text-[10px] text-slate-400 font-mono">کارمزد: 0.055% | اسلیپیج: 2 Ticks</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">سود خالص (Net Return)</span>
              <strong className="text-emerald-400">+{backtestData.total_net_return_pct}%</strong>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">وین‌ریت (Win Rate)</span>
              <strong className="text-cyan-400">{backtestData.win_rate_pct}%</strong>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">پرافیت فاکتور (Profit Factor)</span>
              <strong className="text-amber-400">{backtestData.profit_factor}</strong>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">نسبت شارپ (Sharpe Ratio)</span>
              <strong className="text-indigo-400">{backtestData.sharpe_ratio}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
