import { TradeHistory } from '../types/trading';
import { centralTradeDatasetService } from './centralTradeDataset';

const MAX_HISTORY_COUNT = 50;

export const saveTradeToHistory = (trade: TradeHistory) => {
  let history = getTradeHistory();
  history.push(trade);

  // Write outcome back to central prediction dataset (Item 19)
  const netPnl = calculateClosedTradeNetPnL(trade);
  const outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' = netPnl > 0.5 ? 'WIN' : netPnl < -0.5 ? 'LOSS' : 'BREAKEVEN';
  const riskAmount = (trade.margin || 10) * (trade.lev || 10) * 0.015;
  const rMultiple = Number((netPnl / (riskAmount || 1)).toFixed(2));

  centralTradeDatasetService.writebackOutcome(
    trade.id,
    outcome,
    netPnl,
    rMultiple,
    trade.maeUsd || 0,
    trade.mfeUsd || 0,
    trade.durationSeconds || 120,
    trade.slippageUsd || 0,
    trade.realizedFeesUsd || 0,
    trade.closeReason || 'TP_SL_HIT'
  );

  // Auto-prune older trades when exceeding 50 entries to keep dashboard clean & performant
  if (history.length > MAX_HISTORY_COUNT) {
    history = history.slice(-MAX_HISTORY_COUNT);
  }
  localStorage.setItem('quantum_history', JSON.stringify(history));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('quantum_history_updated'));
  }
};

export const getTradeHistory = (): TradeHistory[] => {
  const saved = localStorage.getItem('quantum_history');
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > MAX_HISTORY_COUNT) {
      const trimmed = parsed.slice(-MAX_HISTORY_COUNT);
      localStorage.setItem('quantum_history', JSON.stringify(trimmed));
      return trimmed;
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const clearTradeHistory = () => {
  localStorage.removeItem('quantum_history');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('quantum_history_updated'));
  }
};

/**
 * Calculates true net PnL of a trade relying on realizedPnlUsd and pnlUsd safely
 */
export const calculateClosedTradeNetPnL = (trade: TradeHistory): number => {
  if (!trade) return 0;
  if (typeof trade.pnlUsd === 'number' && !isNaN(trade.pnlUsd)) {
    return trade.pnlUsd;
  }
  return trade.realizedPnlUsd || 0;
};

/**
 * Computes exact total PnL, win count, win rate and profitability status without noise
 */
export const calculateTotalHistoryDashboardPnL = (historyList: TradeHistory[]) => {
  if (!historyList || historyList.length === 0) {
    return { totalPnL: 0, winCount: 0, winRate: 0, isProfitable: true };
  }

  const totalPnL = historyList.reduce((acc, h) => acc + calculateClosedTradeNetPnL(h), 0);
  const winCount = historyList.filter((h) => calculateClosedTradeNetPnL(h) > 0).length;
  const winRate = (winCount / historyList.length) * 100.0;

  return {
    totalPnL,
    winCount,
    winRate,
    isProfitable: totalPnL >= 0,
  };
};
