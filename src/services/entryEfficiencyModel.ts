import { TradeHistory } from '../types/trading';

export interface EntryEfficiencyMetrics {
  tradeId: string;
  actualEntry: number;
  bestPossibleEntry: number;
  slippageUsd: number;
  maePct: number;
  mfePct: number;
  capturedMovePct: number;
  efficiencyScore: number;
}

export const evaluateEntryEfficiency = (
  trade: TradeHistory,
  priceHistoryAfterEntry: number[]
): EntryEfficiencyMetrics => {
  if (!priceHistoryAfterEntry || priceHistoryAfterEntry.length === 0) {
    return {
      tradeId: trade.id,
      actualEntry: trade.entry,
      bestPossibleEntry: trade.entry,
      slippageUsd: 0,
      maePct: 0,
      mfePct: 0,
      capturedMovePct: 100,
      efficiencyScore: 90
    };
  }

  const isLong = trade.dir === 'LONG';
  const extremePrice = isLong 
    ? Math.min(...priceHistoryAfterEntry) 
    : Math.max(...priceHistoryAfterEntry);

  const bestPossibleEntry = extremePrice;
  const slippageUsd = Math.abs(trade.entry - bestPossibleEntry);
  
  const adversePrices = priceHistoryAfterEntry.map(p => isLong ? trade.entry - p : p - trade.entry);
  const maxAdverse = Math.max(0, ...adversePrices);
  const maePct = (maxAdverse / trade.entry) * 100;

  const favorablePrices = priceHistoryAfterEntry.map(p => isLong ? p - trade.entry : trade.entry - p);
  const maxFavorable = Math.max(0, ...favorablePrices);
  const mfePct = (maxFavorable / trade.entry) * 100;

  const diffFromBest = Math.abs(trade.entry - bestPossibleEntry);
  const efficiencyScore = Math.max(0, Math.min(100, 100 - (diffFromBest / trade.entry) * 1000));

  return {
    tradeId: trade.id,
    actualEntry: trade.entry,
    bestPossibleEntry: Number(bestPossibleEntry.toFixed(2)),
    slippageUsd: Number(slippageUsd.toFixed(2)),
    maePct: Number(maePct.toFixed(2)),
    mfePct: Number(mfePct.toFixed(2)),
    capturedMovePct: mfePct > 0 ? Number(((trade.pnlPct / mfePct) * 100).toFixed(1)) : 0,
    efficiencyScore: Number(efficiencyScore.toFixed(1))
  };
};
