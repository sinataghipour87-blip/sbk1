import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getTradeHistory, clearTradeHistory, calculateTotalHistoryDashboardPnL, calculateClosedTradeNetPnL } from '../services/history';
import { TradeHistory, TradePosition } from '../types/trading';
import { BarChart3, TrendingUp, TrendingDown, Layers, ShieldCheck, CheckCircle2, Trash2, Activity, Eye, FileCheck } from 'lucide-react';
import { VolatilityHarvestingWidget } from './VolatilityHarvestingWidget';

interface HistoryDashboardProps {
  activePositions?: TradePosition[];
  currentPrice?: number;
  onUpdateBalance?: (newBal: number) => void;
  onClearHistory?: () => void;
}

/**
 * Custom hook for Exponential Moving Average (EMA) value smoothing
 * Suppresses high-frequency WebSocket noise with low alpha (0.05)
 */
export function useSmoothedValue(rawValue: number, alpha: number = 0.05): number {
  const smoothedRef = useRef<number | null>(null);
  const [smoothedValue, setSmoothedValue] = useState<number>(rawValue);

  useEffect(() => {
    if (smoothedRef.current === null || isNaN(smoothedRef.current)) {
      smoothedRef.current = rawValue;
    } else {
      smoothedRef.current = alpha * rawValue + (1 - alpha) * smoothedRef.current;
    }
    setSmoothedValue(smoothedRef.current);
  }, [rawValue, alpha]);

  return smoothedValue;
}

const HistoryDashboardComponent: React.FC<HistoryDashboardProps> = ({
  activePositions = [],
  currentPrice = 0,
  onClearHistory,
}) => {
  const [historyList, setHistoryList] = useState<TradeHistory[]>(() => getTradeHistory());
  const [selectedAuditTrade, setSelectedAuditTrade] = useState<TradeHistory | null>(null);

  const refreshHistory = useCallback(() => {
    setHistoryList(getTradeHistory());
  }, []);

  useEffect(() => {
    window.addEventListener('quantum_history_updated', refreshHistory);
    return () => {
      window.removeEventListener('quantum_history_updated', refreshHistory);
    };
  }, [refreshHistory]);

  const { totalPnL, winCount, winRate } = calculateTotalHistoryDashboardPnL(historyList);

  const handleClear = () => {
    clearTradeHistory();
    setHistoryList([]);
    if (onClearHistory) {
      onClearHistory();
    }
  };

  return (
    <div className="bg-[#051424] border border-cyan-800/60 rounded-2xl p-4 shadow-[0_0_20px_rgba(6,182,212,0.1)] mt-4">
      <div className="flex items-center justify-between border-b border-cyan-950 pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-mono font-bold tracking-wider text-emerald-300">
            گزارش عملکرد معاملات و تسویه ۳ پله‌ای (TRADE HISTORY & TP ANALYTICS)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-300">
            حداکثر ۵۰ معامله آخر
          </span>

          {historyList.length > 0 && (
            <button
              onClick={handleClear}
              className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-700/60 text-rose-300 hover:text-white transition-all text-xs font-mono font-medium flex items-center gap-1 cursor-pointer"
              title="پاک‌سازی کامل تاریخچه معاملات"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>پاک‌سازی تاریخچه</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950">
          <span className="text-[10px] text-slate-400 block">تعداد کل معاملات ثبت‌شده:</span>
          <span className="font-mono text-lg font-bold text-slate-200">{historyList.length} معامله</span>
        </div>
        <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950">
          <span className="text-[10px] text-slate-400 block">معاملات موفق و بدون ضرر:</span>
          <span className="font-mono text-lg font-bold text-emerald-400">{winCount}</span>
        </div>
        <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950">
          <span className="text-[10px] text-slate-400 block">نرخ برد واقعی (Win Rate):</span>
          <span className="font-mono text-lg font-bold text-cyan-300">
            {historyList.length > 0 ? `${winRate.toFixed(1)}%` : '۰٪ (آماده ثبت)'}
          </span>
        </div>
        <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 block">سود/زیان قطعی تحقق‌یافته:</span>
            <span className="text-[9px] text-emerald-400 flex items-center gap-1 font-mono">
              <CheckCircle2 className="w-2.5 h-2.5" />
              Realized PnL
            </span>
          </div>
          <span className={`font-mono text-lg font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
          </span>
        </div>
      </div>

      {/* ⚡ Real-Time Volatility Harvesting Stats Widget */}
      <VolatilityHarvestingWidget
        historyList={historyList}
        activePositions={activePositions}
        currentPrice={currentPrice}
      />

      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
        {historyList.length === 0 ? (
          <div className="text-center py-6 text-slate-500 font-mono text-xs">
            هنوز معامله بسته‌شده‌ای ثبت نشده است. پس از اولین ورود یا فعال‌سازی Auto-Pilot، گزارش لحظه‌ای در اینجا ثبت می‌شود.
          </div>
        ) : (
          historyList
            .slice()
            .reverse()
            .map((trade, index) => {
              const tradePnl = calculateClosedTradeNetPnL(trade);
              const isWin = tradePnl >= 0;

              return (
                <div
                  key={`history_${trade.id}_${index}`}
                  className="flex flex-wrap items-center justify-between p-2.5 rounded-xl bg-[#020b17] border border-cyan-950/80 text-xs font-mono gap-2 hover:border-cyan-800 transition-all"
                >
                  <div className="flex items-center gap-2">
                    {isWin ? (
                      <div className="p-1 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
                        <TrendingUp className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <div className="p-1 rounded bg-rose-950/80 border border-rose-500/40 text-rose-400">
                        <TrendingDown className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-black border ${
                          trade.name === 'SBK'
                            ? 'bg-purple-950 text-purple-300 border-purple-500/80'
                            : trade.name === 'SB'
                            ? 'bg-amber-950 text-amber-300 border-amber-500/80'
                            : 'bg-cyan-950 text-cyan-300 border-cyan-500/80'
                        }`}>
                          {trade.name || 'S'}
                        </span>
                        <span className={`font-bold ${trade.dir === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {trade.dir === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)'} {trade.lev}x
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span>ورود: ${trade.entry.toFixed(1)}</span>
                        <span>|</span>
                        <span>مارجین: ${(trade.initialMargin || trade.margin || 10).toFixed(1)}</span>
                        <span>|</span>
                        <span>زمان بسته‌شدن: {trade.closedAt}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {trade.closeReason && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/40 text-cyan-300">
                        {trade.closeReason}
                      </span>
                    )}

                    <button
                      onClick={() => setSelectedAuditTrade(trade)}
                      className="px-2 py-0.5 rounded bg-cyan-950 hover:bg-cyan-900 border border-cyan-700/60 text-cyan-300 text-[10px] font-mono flex items-center gap-1 cursor-pointer transition-all"
                      title="مشاهده گزارش ممیزی کامل این معامله"
                    >
                      <Eye className="w-3 h-3 text-cyan-400" />
                      <span>ممیزی (Audit)</span>
                    </button>

                    <span
                      className={`font-black text-sm ${
                        isWin ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isWin ? '+' : ''}${tradePnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })
        )}
      </div>

      {/* Trade Audit Trail Inspection Modal */}
      {selectedAuditTrade && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#051424] border border-cyan-600 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 shadow-[0_0_40px_rgba(6,182,212,0.25)]">
            <div className="flex items-center justify-between border-b border-cyan-900 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-cyan-400" />
                <h3 className="font-mono font-bold text-sm text-slate-100">
                  شناسنامه و ممیزی جامع معامله (TRADE AUDIT TRAIL)
                </h3>
              </div>
              <button
                onClick={() => setSelectedAuditTrade(null)}
                className="text-slate-400 hover:text-white font-mono text-xs px-2 py-1 rounded bg-cyan-950 border border-cyan-800 cursor-pointer"
              >
                ✕ بستن
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              {/* Summary */}
              <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block">مشخصات معامله:</span>
                  <span className="font-bold text-cyan-300">
                    {selectedAuditTrade.name || 'S'} {selectedAuditTrade.dir === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)'} {selectedAuditTrade.lev}x (ورود: ${selectedAuditTrade.entry.toFixed(1)})
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">سود/زیان نهایی:</span>
                  <span className={`font-bold text-sm ${calculateClosedTradeNetPnL(selectedAuditTrade) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {calculateClosedTradeNetPnL(selectedAuditTrade) >= 0 ? '+' : ''}${calculateClosedTradeNetPnL(selectedAuditTrade).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* MAE, MFE, Fees, Slippage */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-[#020b17] p-2.5 rounded-xl border border-cyan-950">
                  <span className="text-[10px] text-slate-400 block">بیشترین افت (MAE):</span>
                  <span className="font-bold text-rose-400">
                    ${(selectedAuditTrade.auditTrail?.executionMetrics.maeUsd || selectedAuditTrade.maeUsd || 0).toFixed(2)} ({((selectedAuditTrade.auditTrail?.executionMetrics.maePct || selectedAuditTrade.maePct || 0)).toFixed(1)}%)
                  </span>
                </div>

                <div className="bg-[#020b17] p-2.5 rounded-xl border border-cyan-950">
                  <span className="text-[10px] text-slate-400 block">بیشترین سود (MFE):</span>
                  <span className="font-bold text-emerald-400">
                    +${(selectedAuditTrade.auditTrail?.executionMetrics.mfeUsd || selectedAuditTrade.mfeUsd || 0).toFixed(2)} ({((selectedAuditTrade.auditTrail?.executionMetrics.mfePct || selectedAuditTrade.mfePct || 0)).toFixed(1)}%)
                  </span>
                </div>

                <div className="bg-[#020b17] p-2.5 rounded-xl border border-cyan-950">
                  <span className="text-[10px] text-slate-400 block">کارمزد صرافی (Fee):</span>
                  <span className="font-bold text-slate-200">
                    ${(selectedAuditTrade.auditTrail?.executionMetrics.actualFeeUsd || selectedAuditTrade.exchangeFeeEstimateUsd || 0).toFixed(2)}
                  </span>
                </div>

                <div className="bg-[#020b17] p-2.5 rounded-xl border border-cyan-950">
                  <span className="text-[10px] text-slate-400 block">اسپرد ورود:</span>
                  <span className="font-bold text-slate-200">
                    ${selectedAuditTrade.auditTrail?.entryFeatures.spreadUsd?.toFixed(2) || '1.50'}
                  </span>
                </div>
              </div>

              {/* Snapshot Features */}
              {selectedAuditTrade.auditTrail?.entryFeatures ? (
                <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950">
                  <span className="text-[10px] text-cyan-400 font-bold block mb-2">
                    وضعیت تمام فیچرها در لحظه ورود (Features Snapshot):
                  </span>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-300">
                    <div>RSI: {selectedAuditTrade.auditTrail.entryFeatures.rsi?.toFixed(1)}</div>
                    <div>ADX: {selectedAuditTrade.auditTrail.entryFeatures.adx?.toFixed(1)}</div>
                    <div>ATR: ${selectedAuditTrade.auditTrail.entryFeatures.atr?.toFixed(1)}</div>
                    <div>OBI: {((selectedAuditTrade.auditTrail.entryFeatures.obi || 0) * 100).toFixed(1)}%</div>
                    <div>CVD: {selectedAuditTrade.auditTrail.entryFeatures.cvdDelta?.toFixed(1) || '0.0'}</div>
                    <div>Taker: {((selectedAuditTrade.auditTrail.entryFeatures.takerRatio || 0.5) * 100).toFixed(1)}%</div>
                    <div>Funding: {((selectedAuditTrade.auditTrail.entryFeatures.fundingRate || 0.01)).toFixed(3)}%</div>
                    <div>GARCH: {selectedAuditTrade.auditTrail.entryFeatures.garchRegime || 'NORMAL'}</div>
                    <div>1H HTF: {selectedAuditTrade.auditTrail.entryFeatures.htf1h}</div>
                    <div>4H HTF: {selectedAuditTrade.auditTrail.entryFeatures.htf4h}</div>
                    <div>کیفیت داده: {selectedAuditTrade.auditTrail.entryFeatures.feedQualityScore}/100</div>
                    <div>تاخیر فید: {selectedAuditTrade.auditTrail.entryFeatures.dataFreshnessAgeMs}ms</div>
                  </div>
                </div>
              ) : (
                <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950 text-slate-400 text-xs">
                  اطلاعات فیچرهای لحظه ورود با قرارداد ثبت شده است: {selectedAuditTrade.tradeThesis || selectedAuditTrade.tradeContract?.reasonForEntry || 'ورود طبق الگوی تایید شده ارکان'}
                </div>
              )}

              {/* Trade Contract if present */}
              {selectedAuditTrade.tradeContract && (
                <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950">
                  <span className="text-[10px] text-emerald-400 font-bold block mb-1">
                    قرارداد معامله مهرشده (Trade Contract Seal):
                  </span>
                  <p className="text-slate-300 text-xs">
                    {selectedAuditTrade.tradeContract.reasonForEntry}
                  </p>
                  <div className="mt-1 text-[10px] text-slate-500 flex justify-between">
                    <span>شناسه: {selectedAuditTrade.tradeContract.contractId}</span>
                    <span>مهر هش: {selectedAuditTrade.tradeContract.contractSealHash}</span>
                  </div>
                </div>
              )}

              <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950">
                <span className="text-[10px] text-slate-400 block mb-1">دلیل بسته‌شدن و نتیجه نهایی:</span>
                <p className="text-slate-200 text-xs">
                  {selectedAuditTrade.closeReason || 'تارگت سود یا تریلینگ استاپ'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const HistoryDashboard = React.memo(HistoryDashboardComponent);

