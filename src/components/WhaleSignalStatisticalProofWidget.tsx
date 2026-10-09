/**
 * 🐋 ویجت ارزیابی برتری آماری سیگنال‌های نهنگ (Whale Signal Statistical Proof Widget)
 * بر اساس بند ۴۵ و ۴۶:
 * ۱. حذف کامل مقادیر فیک و نمایش برچسب صریح UNKNOWN در صورت عدم دسترسی به داده زنده.
 * ۲. جدول بازدهی ثبت‌شده در افق‌های زمانی 1m، 5m، 15m و 1h برای تمام سیگنال‌های نهنگ.
 * ۳. صفر کردن خودکار وزن سیگنال‌هایی که فاقد برتری آماری اثبات‌شده هستند.
 */

import React, { useState, useEffect } from 'react';
import { Database, ShieldCheck, ShieldAlert, Activity, RefreshCw, BarChart2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { whaleStatisticalProofEngine, WhaleSignalProofReport } from '../services/whaleStatisticalProofEngine';
import { macroContextBrainService } from '../services/macroContextBrain';

export const WhaleSignalStatisticalProofWidget: React.FC = () => {
  const [proofSummary, setProofSummary] = useState(() => {
    const macroCtx = macroContextBrainService.getMacroContext();
    const isLive = macroCtx.whaleFlowStatus === 'LIVE' && macroCtx.whaleNetflowBtc !== null;
    return whaleStatisticalProofEngine.evaluateAllWhaleSignalsProof(isLive, null);
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const macroCtx = await macroContextBrainService.refreshLiveMacroContext();
      const isLive = macroCtx.whaleFlowStatus === 'LIVE' && macroCtx.whaleNetflowBtc !== null;
      const summary = whaleStatisticalProofEngine.evaluateAllWhaleSignalsProof(isLive, null);
      setProofSummary(summary);
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    handleRefresh();
  }, []);

  return (
    <CollapsibleCard
      title="ماتریس اثبات آماری سیگنال‌های نهنگ (Whale Statistical Proof Matrix)"
      badge={proofSummary.isDataLive ? `سیگنال‌های اثبات‌شده: ${proofSummary.activeProvenCount}` : 'وضعیت داده: UNKNOWN 🛑'}
      badgeColor={
        proofSummary.isDataLive
          ? 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40'
          : 'text-amber-300 bg-amber-950/80 border-amber-500/40'
      }
      defaultOpen={true}
      icon={<BarChart2 className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>ارزیابی مجدد آماری</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Banner header */}
        <div className="bg-[#020b18] border border-cyan-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-cyan-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-500/20 rounded-lg text-cyan-300 border border-cyan-500/30">
                <Database className="w-4 h-4 text-cyan-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  اعتبارسنجی اثبات بازدهی در افق‌های زمانی 1m، 5m، 15m و 1h:
                </span>
                <span className="text-[10px] text-cyan-300 font-mono mt-0.5 block">
                  بر اساس قانون ۴۵ و ۴۶: صفر شدن خودکار وزن سیگنال‌های فاقد اثر آماری اثبات‌شده
                </span>
              </div>
            </div>

            <span
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-sans font-bold flex items-center gap-1 ${
                proofSummary.isDataLive
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                  : 'bg-amber-950 text-amber-300 border-amber-500/50'
              }`}
            >
              {proofSummary.isDataLive ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>{proofSummary.isDataLive ? 'داده آن‌چین زنده' : 'وضعیت داده: UNKNOWN'}</span>
            </span>
          </div>

          {!proofSummary.isDataLive && (
            <div className="p-3 my-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs leading-relaxed font-sans flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>توقف ورود سیگنال‌های نهنگ به فرمول احتمال (قانون ۴۵):</strong>
                <p className="text-[11px] text-amber-300/90 mt-0.5">
                  منبع زنده رادار آن‌چین در دسترس نیست (`UNKNOWN`). هیچ عدد ساختگی جایگزین نشد و ضریب تمام سیگنال‌های نهنگ در محاسبه احتمال و ورودی معامله به طور کامل **صفر** شد.
                </p>
              </div>
            </div>
          )}

          {/* Signal Return Performance Grid Table */}
          <div className="space-y-2.5 my-3">
            {proofSummary.reports.map((report) => (
              <div
                key={report.signalType}
                className={`p-3 rounded-xl border transition-all ${
                  report.dataStatus === 'UNKNOWN'
                    ? 'bg-[#030914] border-slate-800/80 text-slate-400'
                    : report.isStatisticallyProven
                    ? 'bg-[#031326] border-cyan-500/40 text-slate-100'
                    : 'bg-[#120508] border-rose-900/50 text-rose-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-cyan-950/60">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        report.dataStatus === 'UNKNOWN'
                          ? 'bg-slate-500'
                          : report.isStatisticallyProven
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                          : 'bg-rose-500'
                      }`}
                    ></span>
                    <span className="font-bold font-sans text-xs text-slate-100">{report.signalNameFa}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-slate-400 font-mono">تعداد نمونه: {report.sampleCount}</span>
                    <span
                      className={`px-2 py-0.5 rounded font-sans font-bold border ${
                        report.assignedWeightMultiplier > 0
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
                          : 'bg-rose-950 text-rose-300 border-rose-500/40'
                      }`}
                    >
                      وزن سیگنال: {report.assignedWeightMultiplier.toFixed(1)}x
                    </span>
                  </div>
                </div>

                {/* 1m, 5m, 15m, 1h Timeframe Return Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-2 text-[10px]">
                  {[report.tf1m, report.tf5m, report.tf15m, report.tf1h].map((tf) => (
                    <div
                      key={tf.tfLabel}
                      className="bg-[#020712] p-2 rounded-lg border border-cyan-950/40 text-center space-y-0.5"
                    >
                      <span className="text-slate-400 font-bold block">افق زمانی {tf.tfLabel}:</span>
                      {report.dataStatus === 'UNKNOWN' ? (
                        <span className="text-slate-500 font-bold block">UNKNOWN</span>
                      ) : (
                        <>
                          <div className="font-bold text-cyan-300">
                            وین‌ریت: {tf.winRatePct}%
                          </div>
                          <div className={tf.avgReturnPct >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            بازدهی: {tf.avgReturnPct >= 0 ? '+' : ''}{tf.avgReturnPct}%
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-[10px] text-slate-300 font-sans leading-tight mt-1">
                  💡 {report.rationaleFa}
                </p>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-300 bg-[#010712] p-2.5 rounded-xl border border-cyan-950/60 leading-relaxed font-sans mt-3">
            🛡️ <strong>جمع‌بندی موتور اثبات آماری:</strong> {proofSummary.summaryDirectiveFa}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
