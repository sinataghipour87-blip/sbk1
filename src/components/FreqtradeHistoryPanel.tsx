import React, { useCallback, useEffect, useState } from 'react';
import {
  FreqtradeClosedTrade,
  FreqtradeDashboardStatus,
  getFreqtradeClosedTrades,
  getFreqtradeDashboardStatus,
} from '../services/freqtradeDashboard';

const FreqtradeHistoryPanel: React.FC = () => {
  const [status, setStatus] = useState<FreqtradeDashboardStatus | null>(null);
  const [trades, setTrades] = useState<FreqtradeClosedTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      getFreqtradeDashboardStatus(),
      getFreqtradeClosedTrades(),
    ]);
    const failures: string[] = [];
    if (results[0].status === 'fulfilled') setStatus(results[0].value);
    else failures.push(results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason));
    if (results[1].status === 'fulfilled') setTrades(results[1].value);
    else failures.push(results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason));
    setError(failures.length > 0 ? failures.join(' ') : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="mb-4 rounded-xl border border-cyan-900 bg-slate-950/70 p-3" aria-label="Freqtrade authoritative status and closed trades">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="font-mono text-xs font-bold text-cyan-200">Freqtrade authoritative status and closed trades</h4>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded border border-cyan-800 px-2 py-1 text-[10px] text-cyan-200 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {status ? (
        <p className="mb-3 text-[11px] text-slate-300" role="status">
          Freqtrade: {status.freqtrade.status}; dry-run: {status.freqtrade.dryRun ? 'enabled' : 'disabled'};
          kill switch: {status.killSwitchActive ? 'engaged' : 'disarmed'};
          {' '}open positions: {status.activePositions.length}
        </p>
      ) : (
        <p className="mb-3 text-[11px] text-slate-400">Authoritative Freqtrade status unavailable.</p>
      )}

      {error && <p className="mb-3 text-[11px] text-amber-300" role="alert">{error}</p>}

      {trades ? (
        trades.length > 0 ? (
          <ul className="space-y-1 text-[11px] text-slate-300">
            {trades.map((trade) => (
              <li key={trade.trade_id}>
                Trade #{trade.trade_id} · {trade.pair} · {trade.is_short ? 'SHORT' : 'LONG'} · closed{' '}
                {trade.close_timestamp === null
                  ? 'time unavailable'
                  : new Date(trade.close_timestamp).toLocaleString()}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-slate-400">Freqtrade reports no closed trades in the returned history.</p>
        )
      ) : (
        <p className="text-[11px] text-slate-400">Closed-trade history unavailable.</p>
      )}
    </section>
  );
};

export default FreqtradeHistoryPanel;
