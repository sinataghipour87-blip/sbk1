import React, { useState, useEffect } from 'react';
import { Database, Search, ShieldCheck, Cpu, Filter, Layers, CheckCircle2, XCircle, Activity, BarChart3, RefreshCw } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { centralTradeDatasetService, MultiDimensionalPerformanceMatrix, PredictionDatasetRecord } from '../services/centralTradeDataset';

export const CentralDatasetPerformanceMatrixWidget: React.FC = () => {
  const [matrix, setMatrix] = useState<MultiDimensionalPerformanceMatrix | null>(null);
  const [predictions, setPredictions] = useState<PredictionDatasetRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'MATRIX' | 'PREDICTIONS' | 'AUDIT'>('MATRIX');
  const [isEvaluating, setIsExecuting] = useState<boolean>(false);

  const refreshData = () => {
    setMatrix(centralTradeDatasetService.getPerformanceMatrix());
    setPredictions(centralTradeDatasetService.getAllPredictions());
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleManualBatchEvaluation = () => {
    setIsExecuting(true);
    setTimeout(() => {
      centralTradeDatasetService.recalculatePerformanceMatrix();
      refreshData();
      setIsExecuting(false);
    }, 1000);
  };

  if (!matrix) return null;

  const filteredPredictions = predictions.filter(p =>
    !searchQuery ||
    p.predictionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.decisionId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.tradeId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.marketRegime.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <CollapsibleCard
      title="دیتابیس مرکزی پیش‌بینی‌ها و ماتریس عملکرد چندبعدی (Dataset & Performance Matrix)"
      badge={`چرخه ارزیابی دسته: #${matrix.modelUpdateBatchCycle}`}
      badgeColor="text-cyan-300 bg-cyan-950/80 border-cyan-500/40"
      defaultOpen={true}
      icon={<Database className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleManualBatchEvaluation}
          disabled={isEvaluating}
          className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3 h-3 text-cyan-400 ${isEvaluating ? 'animate-spin' : ''}`} />
          <span>{isEvaluating ? 'در حال ارزیابی مدل‌ها...' : 'ارزیابی دسته‌ای مدل‌ها'}</span>
        </button>
      }
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 gap-2 font-sans">
          <button
            onClick={() => setActiveTab('MATRIX')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'MATRIX'
                ? 'bg-cyan-950/80 text-cyan-300 border-t border-x border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
            <span>ماتریس عملکرد چندبعدی</span>
          </button>
          <button
            onClick={() => setActiveTab('PREDICTIONS')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'PREDICTIONS'
                ? 'bg-cyan-950/80 text-cyan-300 border-t border-x border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            <span>دیتابیس پیش‌بینی‌ها و اجرا ({predictions.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('AUDIT')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'AUDIT'
                ? 'bg-cyan-950/80 text-cyan-300 border-t border-x border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>ردیابی کامل شناسه (Audit Trail)</span>
          </button>
        </div>

        {/* TAB 1: MULTI-DIMENSIONAL PERFORMANCE MATRIX (ITEM 20) */}
        {activeTab === 'MATRIX' && (
          <div className="space-y-4">
            {/* Overfitting Protection Banner */}
            <div className="p-3 bg-[#030d1e] border border-cyan-500/40 rounded-xl flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <span className="font-sans font-bold text-slate-200">گارد آنتی-اورفیتینگ (Batch Model Evaluation):</span>
                <span className="text-cyan-300">آموزش بر پایه چرخه‌های دسته‌ای (Batch #{matrix.modelUpdateBatchCycle})</span>
              </div>
              <span className="text-[10px] text-slate-400 font-sans">
                بازخورد بسته‌شده: {matrix.pendingFeedbackQueueCount} معامله
              </span>
            </div>

            {/* Matrix Segment Categories */}
            <div className="space-y-3 font-sans">
              <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>عملکرد به تفکیک رژیم بازار و ستاپ (Regime & Setup Matrix):</span>
              </h5>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 font-mono text-xs">
                {Object.values(matrix.regimeSegments).map((seg) => (
                  <div
                    key={seg.segmentKey}
                    className={`p-3 rounded-xl border space-y-2 transition-all ${
                      seg.isSegmentActivated
                        ? 'bg-[#030e20] border-emerald-500/40'
                        : 'bg-rose-950/20 border-rose-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span className="font-sans font-bold text-slate-100">{seg.labelFa}</span>
                      <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold ${
                        seg.isSegmentActivated
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}>
                        {seg.isSegmentActivated ? 'فعال 🟢' : 'غیرفعال 🔴'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[10.5px] text-slate-300">
                      <div>پیش‌بینی‌ها: <strong className="text-cyan-300">{seg.totalPredictionsCount}</strong></div>
                      <div>نرخ برد: <strong className={seg.winRatePct >= 65 ? 'text-emerald-400' : 'text-amber-300'}>{seg.winRatePct}٪</strong></div>
                      <div>میانگین R: <strong className="text-slate-200">{seg.avgR}R</strong></div>
                      <div>سود کل: <strong className={seg.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>${seg.totalPnlUsd.toFixed(1)}</strong></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Timeframe Matrix */}
            <div className="space-y-3 font-sans pt-2">
              <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-indigo-400" />
                <span>عملکرد به تفکیک تایم‌فریم (Timeframe Matrix):</span>
              </h5>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs">
                {Object.values(matrix.timeframeSegments).map((seg) => (
                  <div
                    key={seg.segmentKey}
                    className="bg-[#030d1d] border border-indigo-900/60 p-2.5 rounded-xl space-y-1 text-center"
                  >
                    <span className="font-bold block text-cyan-300 font-sans">{seg.segmentKey}</span>
                    <span className="text-[11px] font-bold text-emerald-400 block">{seg.winRatePct}٪ Win</span>
                    <span className="text-[10px] text-slate-400 block">{seg.totalPredictionsCount} نمونه</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PREDICTIONS DATASET (ITEMS 16 & 17) */}
        {activeTab === 'PREDICTIONS' && (
          <div className="space-y-3 font-mono text-xs">
            <div className="relative font-sans">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                placeholder="جستجو بر اساس Prediction ID، Decision ID یا رژیم بازار..."
                value={searchQuery ?? ''}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-3 pr-9 py-2 bg-[#020814] border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-cyan-500/60"
              />
            </div>

            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {filteredPredictions.map((pred) => (
                <div
                  key={pred.predictionId}
                  className="bg-[#030d1e] border border-indigo-900/50 p-3 rounded-xl space-y-2"
                >
                  <div className="flex items-center justify-between border-b border-indigo-950 pb-1.5 font-sans">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-cyan-300 font-mono text-[11px]">{pred.predictionId}</span>
                      <span className="text-[10px] text-slate-400">[{pred.timeframe} - {pred.marketRegime}]</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                      pred.executionStatus === 'EXECUTED_FILLED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}>
                      {pred.executionStatus}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] text-slate-300 font-mono">
                    <div>جهت: <strong className={pred.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>{pred.direction}</strong></div>
                    <div>قیمت ورود: <strong>{pred.entryPrice ? `$${pred.entryPrice.toLocaleString()}` : 'نامشخص'}</strong></div>
                    <div>احتمال کالیبره‌شده: <strong className="text-cyan-300">{pred.probability !== null ? `${Math.round(pred.probability * 100)}٪` : 'در انتظار داده'}</strong></div>
                    <div>نتیجه بازخورد: <strong className={pred.outcome === 'WIN' ? 'text-emerald-400' : pred.outcome === 'LOSS' ? 'text-rose-400' : 'text-slate-400'}>{pred.outcome || 'در حال اجرا'}</strong></div>
                  </div>

                  {pred.decisionRejectionReasonFa && (
                    <div className="text-[10.5px] text-amber-300 bg-amber-950/30 p-1.5 rounded border border-amber-900/40 font-sans">
                      ⚠️ دلیل عدم اجرا: {pred.decisionRejectionReasonFa}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: AUDIT TRAIL TRACEABILITY (ITEM 18) */}
        {activeTab === 'AUDIT' && (
          <div className="bg-[#020814] border border-indigo-950 p-4 rounded-xl space-y-3 font-mono text-xs font-sans">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>ردیابی کامل غیرقابل‌تغییر شناسه رکوردهای پیش‌بینی و اجرا (Audit Chain):</span>
            </h4>

            <p className="text-slate-300 text-[11px] leading-relaxed">
              هر پیش‌بینی دارای یک <strong className="text-cyan-300 font-mono">predictionId</strong> یکتا و غیرقابل‌تغییر است که به رکوردهای <strong className="text-indigo-300 font-mono">decisionId</strong>، <strong className="text-emerald-300 font-mono">tradeId</strong> و <strong className="text-amber-300 font-mono">executionAttemptId</strong> متصل بوده و ممیزی کامل ۱۰۰٪ چرخه تصمیم‌گیری را فراهم می‌سازد.
            </p>

            <div className="bg-[#040e21] p-3 rounded-xl border border-slate-800 font-mono text-[11px] space-y-1.5">
              <div className="text-cyan-300">Prediction ID: PRED_1728000000_a1b2c3</div>
              <div className="text-indigo-300 font-sans"> └── Decision Engine Gate: DEC_1728000000_a1b2c3</div>
              <div className="text-emerald-300 font-sans">     └── Order Execution: ORD_1728000000_a1b2c3</div>
              <div className="text-amber-300 font-sans">         └── Closed Trade Result: TRD_1728000000_a1b2c3</div>
            </div>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
};
