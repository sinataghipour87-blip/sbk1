import type { CouncilOptionsData } from './eightMemberCouncil';
import { fetchBinanceEuropeanOptionsData } from './binanceEuropeanOptionsData';
import { fetchBybitOptionsData } from './bybitOptionsData';
import { fetchDeribitOptionsData } from './deribitOptionsData';
import { fetchOkxOptionsData } from './okxOptionsData';
import { getFreqtradePairBaseAsset } from './freqtradePairs';

const MAX_SOURCE_AGE_MS = 60_000;

function hasFreshEvidence(data: CouncilOptionsData, nowMs: number): boolean {
  return data.status === 'LIVE' &&
    data.timestampMs !== null &&
    data.timestampMs <= nowMs + 1_000 &&
    nowMs - data.timestampMs <= MAX_SOURCE_AGE_MS;
}

function unavailable(pair: string, reason: string): CouncilOptionsData {
  return {
    pair,
    asset: getFreqtradePairBaseAsset(pair) ?? undefined,
    status: 'UNAVAILABLE',
    timestampMs: null,
    retrievedAtMs: null,
    ageMs: null,
    qualityPct: 0,
    impliedVolatilityPct: null,
    putCallRatio: null,
    expiryTimestampMs: null,
    strikePrice: null,
    skewPct: null,
    provider: 'OKX V5 + Binance European Options public APIs',
    contractsCount: 0,
    callOpenInterest: null,
    putOpenInterest: null,
    underlyingPrice: null,
    unavailableReason: reason,
  };
}

export async function fetchCouncilOptionsData(options: {
  pair: string;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilOptionsData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  const nowMs = options.nowMs ?? Date.now();
  if (asset === 'BTC' || asset === 'ETH') {
    const deribit = await fetchDeribitOptionsData(options);
    if (hasFreshEvidence(deribit, Math.max(nowMs, Date.now()))) {
      return {
        ...deribit,
        sourceId: 'council.member5.deribit-options',
      };
    }

    if (asset === 'ETH') {
      const okx = await fetchOkxOptionsData(options);
      if (hasFreshEvidence(okx, Math.max(nowMs, Date.now()))) {
        return {
          ...okx,
          sourceId: 'council.member5.okx-opt-summary',
          fallbackSourceId: 'council.member5.deribit-options',
        };
      }

      const bybit = await fetchBybitOptionsData(options);
      if (hasFreshEvidence(bybit, Math.max(nowMs, Date.now()))) {
        return {
          ...bybit,
          sourceId: 'council.member5.bybit-options',
          fallbackSourceId: 'council.member5.okx-opt-summary',
        };
      }

      const binance = await fetchBinanceEuropeanOptionsData(options);
      if (hasFreshEvidence(binance, Math.max(nowMs, Date.now()))) {
        return {
          ...binance,
          sourceId: 'council.member5.binance-eapi',
          fallbackSourceId: 'council.member5.bybit-options',
        };
      }

      return unavailable(
        options.pair,
        `No fresh valid options evidence was available from Deribit (${deribit.unavailableReason ?? deribit.status}), OKX (${okx.unavailableReason ?? okx.status}), Bybit (${bybit.unavailableReason ?? bybit.status}), or Binance European Options (${binance.unavailableReason ?? binance.status}).`,
      );
    }

    const binance = await fetchBinanceEuropeanOptionsData(options);
    if (hasFreshEvidence(binance, Math.max(nowMs, Date.now()))) return binance;

    const bybit = await fetchBybitOptionsData(options);
    if (hasFreshEvidence(bybit, Math.max(nowMs, Date.now()))) return bybit;

    return unavailable(
      options.pair,
      `No fresh valid options evidence was available from Deribit (${deribit.unavailableReason ?? deribit.status}), Binance European Options (${binance.unavailableReason ?? binance.status}), or Bybit (${bybit.unavailableReason ?? bybit.status}).`,
    );
  }
  if (!asset || !['SOL', 'XRP', 'BNB'].includes(asset)) {
    return unavailable(options.pair, 'No approved options provider is configured for this pair.');
  }

  const okx = await fetchOkxOptionsData(options);
  if (hasFreshEvidence(okx, Math.max(nowMs, Date.now()))) return okx;

  const binance = await fetchBinanceEuropeanOptionsData(options);
  if (hasFreshEvidence(binance, Math.max(nowMs, Date.now()))) return binance;

  return unavailable(
    options.pair,
    `No fresh valid options evidence was available from either OKX (${okx.unavailableReason ?? okx.status}) or Binance European Options (${binance.unavailableReason ?? binance.status}).`,
  );
}
