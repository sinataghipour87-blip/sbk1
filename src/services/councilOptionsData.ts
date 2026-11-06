import type { CouncilOptionsData } from './eightMemberCouncil';
import { fetchBinanceEuropeanOptionsData } from './binanceEuropeanOptionsData';
import { fetchBybitOptionsData } from './bybitOptionsData';
import { fetchDeltaOptionsData } from './deltaOptionsData';
import { fetchDeribitOptionsData } from './deribitOptionsData';
import { fetchGateioOptionsData } from './gateioOptionsData';
import { fetchOkxOptionsData } from './okxOptionsData';
import { getFreqtradePairBaseAsset } from './freqtradePairs';

const MAX_SOURCE_AGE_MS = 60_000;

type MemberFiveSource = 'deribit-options' | 'okx-opt-summary' | 'bybit-options' | 'binance-eapi' | 'delta-options' | 'gateio-options';

function memberFiveSourceId(asset: string, source: MemberFiveSource): string {
  return asset === 'ETH'
    ? `council.member5.${source}`
    : `council.member5.${asset}.${source}`;
}

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
        sourceId: memberFiveSourceId(asset, 'deribit-options'),
      };
    }

    if (asset === 'ETH') {
      const bybit = await fetchBybitOptionsData(options);
      if (hasFreshEvidence(bybit, Math.max(nowMs, Date.now()))) {
        return {
          ...bybit,
          sourceId: memberFiveSourceId(asset, 'bybit-options'),
          fallbackSourceId: memberFiveSourceId(asset, 'deribit-options'),
        };
      }

      const okx = await fetchOkxOptionsData(options);
      if (hasFreshEvidence(okx, Math.max(nowMs, Date.now()))) {
        return {
          ...okx,
          sourceId: memberFiveSourceId(asset, 'okx-opt-summary'),
          fallbackSourceId: memberFiveSourceId(asset, 'bybit-options'),
        };
      }

      const binance = await fetchBinanceEuropeanOptionsData(options);
      if (hasFreshEvidence(binance, Math.max(nowMs, Date.now()))) {
        return {
          ...binance,
          sourceId: memberFiveSourceId(asset, 'binance-eapi'),
          fallbackSourceId: memberFiveSourceId(asset, 'bybit-options'),
        };
      }

      const delta = await fetchDeltaOptionsData(options);
      if (hasFreshEvidence(delta, Math.max(nowMs, Date.now()))) {
        return {
          ...delta,
          sourceId: memberFiveSourceId(asset, 'delta-options'),
          fallbackSourceId: memberFiveSourceId(asset, 'binance-eapi'),
        };
      }

      const gateio = await fetchGateioOptionsData(options);
      if (hasFreshEvidence(gateio, Math.max(nowMs, Date.now()))) {
        return {
          ...gateio,
          sourceId: memberFiveSourceId(asset, 'gateio-options'),
          fallbackSourceId: memberFiveSourceId(asset, 'delta-options'),
        };
      }

      return unavailable(
        options.pair,
        `No fresh valid options evidence was available from Deribit (${deribit.unavailableReason ?? deribit.status}), OKX (${okx.unavailableReason ?? okx.status}), Bybit (${bybit.unavailableReason ?? bybit.status}), Binance European Options (${binance.unavailableReason ?? binance.status}), Delta India (${delta.unavailableReason ?? delta.status}), or Gate.io (${gateio.unavailableReason ?? gateio.status}).`,
      );
    }

    const bybit = await fetchBybitOptionsData(options);
    if (hasFreshEvidence(bybit, Math.max(nowMs, Date.now()))) {
      return {
        ...bybit,
        sourceId: memberFiveSourceId(asset, 'bybit-options'),
        fallbackSourceId: memberFiveSourceId(asset, 'deribit-options'),
      };
    }

    const binance = await fetchBinanceEuropeanOptionsData(options);
    if (hasFreshEvidence(binance, Math.max(nowMs, Date.now()))) {
      return {
        ...binance,
        sourceId: memberFiveSourceId(asset, 'binance-eapi'),
        fallbackSourceId: memberFiveSourceId(asset, 'bybit-options'),
      };
    }

    const delta = await fetchDeltaOptionsData(options);
    if (hasFreshEvidence(delta, Math.max(nowMs, Date.now()))) {
      return {
        ...delta,
        sourceId: memberFiveSourceId(asset, 'delta-options'),
        fallbackSourceId: memberFiveSourceId(asset, 'binance-eapi'),
      };
    }

    const gateio = await fetchGateioOptionsData(options);
    if (hasFreshEvidence(gateio, Math.max(nowMs, Date.now()))) {
      return {
        ...gateio,
        sourceId: memberFiveSourceId(asset, 'gateio-options'),
        fallbackSourceId: memberFiveSourceId(asset, 'delta-options'),
      };
    }

    return unavailable(
      options.pair,
      `No fresh valid options evidence was available from Deribit (${deribit.unavailableReason ?? deribit.status}), Binance European Options (${binance.unavailableReason ?? binance.status}), Bybit (${bybit.unavailableReason ?? bybit.status}), Delta India (${delta.unavailableReason ?? delta.status}), or Gate.io (${gateio.unavailableReason ?? gateio.status}).`,
    );
  }
  if (!asset || !['SOL', 'XRP', 'BNB'].includes(asset)) {
    return unavailable(options.pair, 'No approved options provider is configured for this pair.');
  }

  if (asset === 'SOL' || asset === 'XRP') {
    const bybit = await fetchBybitOptionsData(options);
    if (hasFreshEvidence(bybit, Math.max(nowMs, Date.now()))) {
      return {
        ...bybit,
        sourceId: memberFiveSourceId(asset, 'bybit-options'),
      };
    }

    const okx = asset === 'SOL' ? await fetchOkxOptionsData(options) : null;
    if (okx && hasFreshEvidence(okx, Math.max(nowMs, Date.now()))) {
      return {
        ...okx,
        sourceId: memberFiveSourceId(asset, 'okx-opt-summary'),
        fallbackSourceId: memberFiveSourceId(asset, 'bybit-options'),
      };
    }

    const binance = await fetchBinanceEuropeanOptionsData(options);
    if (hasFreshEvidence(binance, Math.max(nowMs, Date.now()))) {
      return {
        ...binance,
        sourceId: memberFiveSourceId(asset, 'binance-eapi'),
        fallbackSourceId: memberFiveSourceId(asset, 'bybit-options'),
      };
    }

    return unavailable(
      options.pair,
      `No fresh valid options evidence was available from Bybit (${bybit.unavailableReason ?? bybit.status}), ${asset === 'SOL' ? `OKX (${okx?.unavailableReason ?? okx?.status})` : 'OKX is not configured for XRP'}, or Binance European Options (${binance.unavailableReason ?? binance.status}).`,
    );
  }

  const okx = await fetchOkxOptionsData(options);
  if (hasFreshEvidence(okx, Math.max(nowMs, Date.now()))) {
    return {
      ...okx,
      sourceId: memberFiveSourceId(asset, 'okx-opt-summary'),
    };
  }

  const binance = await fetchBinanceEuropeanOptionsData(options);
  if (hasFreshEvidence(binance, Math.max(nowMs, Date.now()))) {
    return {
      ...binance,
      sourceId: memberFiveSourceId(asset, 'binance-eapi'),
      fallbackSourceId: memberFiveSourceId(asset, 'okx-opt-summary'),
    };
  }

  return unavailable(
    options.pair,
    `No fresh valid options evidence was available from either OKX (${okx.unavailableReason ?? okx.status}) or Binance European Options (${binance.unavailableReason ?? binance.status}).`,
  );
}
