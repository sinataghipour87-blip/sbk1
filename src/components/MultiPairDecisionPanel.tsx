import React, { useCallback, useEffect, useState } from 'react';

type PairDecision = {
  pair?: string | null;
  decision?: 'NO TRADE' | 'LONG' | 'SHORT';
  reason?: string;
  updatedAtMs?: number;
  councilReport?: {
    longVotes: number;
    shortVotes: number;
    weightedLongVotes?: number;
    weightedShortVotes?: number;
    neutralVotes: number;
    abstentions: number;
  } | null;
};

type PairMarket = {
  pair: string;
  status: 'READY' | 'UNAVAILABLE';
  generatedAtMs: number | null;
  ticker: { last: number; retrievedAtMs: number } | null;
  lastCandle: { close: number; timestampMs: number } | null;
  decision: PairDecision | null;
  error?: string;
};

type PairMarketsResponse = {
  markets: PairMarket[];
};

type Props = {
  onManualEntry: (pair: string, direction: 'LONG' | 'SHORT') => Promise<void>;
  autoPilotEnabled: boolean;
};

const pairLabels: Record<string, string> = {
  'BTC/USDT:USDT': 'Bitcoin',
  'ETH/USDT:USDT': 'Ethereum',
  'SOL/USDT:USDT': 'Solana',
  'XRP/USDT:USDT': 'XRP',
  'BNB/USDT:USDT': 'BNB',
};

function isPairMarketsResponse(value: unknown): value is PairMarketsResponse {
  return typeof value === 'object' && value !== null &&
    Array.isArray((value as { markets?: unknown }).markets);
}

export const MultiPairDecisionPanel: React.FC<Props> = ({ onManualEntry, autoPilotEnabled }) => {
  const [markets, setMarkets] = useState<PairMarket[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingPair, setPendingPair] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/market/pairs', {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isPairMarketsResponse(payload)) {
        throw new Error(`بازارهای چندگانه بارگذاری نشدند (HTTP ${response.status}).`);
      }
      setMarkets(payload.markets);
      setLoadError(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setLoadError(error instanceof Error ? error.message : 'دریافت وضعیت بازارها ناموفق بود.');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  const submitManualEntry = async (pair: string, direction: 'LONG' | 'SHORT') => {
    setPendingPair(pair);
    try {
      await onManualEntry(pair, direction);
      await refresh();
    } finally {
      setPendingPair(null);
    }
  };

  return (
    <section className="rounded-xl border border-cyan-900/60 bg-slate-950/80 p-4 text-white" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">تحلیل و رصد پنج بازار Freqtrade</h2>
          <p className="text-xs text-slate-400">
            رأی شورا و سیگنال هر نماد جداست؛ سقف پوزیشن و ریسک بین نمادها مشترک است. فقط Dry-Run.
          </p>
        </div>
        <span className={`rounded border px-2 py-1 text-xs ${autoPilotEnabled ? 'border-emerald-700 bg-emerald-950 text-emerald-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
          Auto-Pilot سراسری: {autoPilotEnabled ? 'فعال' : 'خاموش'}
        </span>
      </div>

      {loadError && <p role="alert" className="mb-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-sm text-amber-100">{loadError}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {markets.map((market) => {
          const decision = market.decision;
          const report = decision?.councilReport;
          const ready = market.status === 'READY';
          return (
            <article key={market.pair} className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">{pairLabels[market.pair] ?? market.pair}</h3>
                  <p className="text-[10px] text-slate-400">{market.pair}</p>
                </div>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${ready ? 'bg-emerald-950 text-emerald-200' : 'bg-amber-950 text-amber-200'}`}>
                  {ready ? 'داده تازه' : 'داده ناموجود'}
                </span>
              </div>
              <p className="mt-3 font-mono text-lg">
                {market.ticker?.last.toLocaleString('en-US', { maximumFractionDigits: 6 }) ?? '—'}
                <span className="mr-1 text-xs text-slate-400">USDT</span>
              </p>
              <p className="mt-1 text-xs text-slate-300">
                نتیجه شورا: <strong>{decision?.decision ?? 'در انتظار تحلیل'}</strong>
              </p>
              {report && (
                <p className="mt-1 text-[10px] text-slate-400">
                  رأی LONG {report.longVotes} ({report.weightedLongVotes?.toFixed(1) ?? report.longVotes}) · SHORT {report.shortVotes} ({report.weightedShortVotes?.toFixed(1) ?? report.shortVotes}) · خنثی {report.neutralVotes} · ممتنع {report.abstentions}
                </p>
              )}
              <p className="mt-1 min-h-10 text-[10px] leading-4 text-slate-400">
                {decision?.reason ?? market.error ?? 'هنوز گزارشی از چرخه تصمیم سرور دریافت نشده است.'}
              </p>
              <p className="mb-2 text-[9px] text-slate-500">
                {market.generatedAtMs ? `snapshot: ${new Date(market.generatedAtMs).toLocaleTimeString()}` : 'snapshot تازه موجود نیست'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!ready || pendingPair !== null}
                  onClick={() => void submitManualEntry(market.pair, 'LONG')}
                  className="rounded border border-emerald-800 bg-emerald-950 px-2 py-1.5 text-xs text-emerald-100 disabled:opacity-40"
                >
                  درخواست LONG
                </button>
                <button
                  type="button"
                  disabled={!ready || pendingPair !== null}
                  onClick={() => void submitManualEntry(market.pair, 'SHORT')}
                  className="rounded border border-rose-800 bg-rose-950 px-2 py-1.5 text-xs text-rose-100 disabled:opacity-40"
                >
                  درخواست SHORT
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
