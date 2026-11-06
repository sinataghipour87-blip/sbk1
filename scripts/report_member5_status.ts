import { checkCouncilMemberSources } from '../src/services/councilSourceHealth';
import {
  evaluateEightMemberCouncil,
  getOptionsDirectionalScore,
  type CouncilMemberSourceCheck,
} from '../src/services/eightMemberCouncil';
import {
  getCouncilMemberSources,
  type CouncilSourceDefinition,
} from '../src/services/councilSourceRegistry';
import { getCouncilOptionsThresholds } from '../src/services/councilOptionsThresholds';
import {
  MEMBER_FIVE_PROXY_CACHE_TTL_MS,
  MEMBER_FIVE_PROXY_QUORUM,
} from '../src/services/memberFiveFuturesProxy';

const ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'] as const;
type Asset = typeof ASSETS[number];

function metric(source: CouncilMemberSourceCheck, name: string): number | null {
  const value = source.normalizedData?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestamp(source: CouncilMemberSourceCheck): number | null {
  if (source.sourceId.includes('.proxy.')) {
    return metric(source, 'proxyCacheReceivedAtMs') ??
      source.sourceTimestampMs ??
      metric(source, 'proxyTimestampMs');
  }
  return source.sourceTimestampMs ??
    metric(source, 'optionTimestampMs') ??
    metric(source, 'proxyTimestampMs');
}

function futuresProxyApis(definition: CouncilSourceDefinition): string[] {
  const asset = definition.assets?.[0];
  if (!asset) return [];
  const symbol = `${asset}USDT`;
  const encodedSymbol = encodeURIComponent(symbol);
  if (definition.id.includes('.binance-futures.')) {
    return [
      `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${encodedSymbol}&period=5m&limit=3`,
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodedSymbol}&period=5m&limit=3`,
      `https://fapi.binance.com/fapi/v1/klines?symbol=${encodedSymbol}&interval=1m&limit=5`,
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodedSymbol}&limit=8`,
    ];
  }
  if (definition.id.includes('.bybit-futures.')) {
    return [
      `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${encodedSymbol}&period=5min&limit=3`,
      `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${encodedSymbol}&intervalTime=5min&limit=3`,
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodedSymbol}&interval=1&limit=5`,
      `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${encodedSymbol}&limit=8`,
    ];
  }
  if (definition.id.includes('.okx-futures.')) {
    const instrument = encodeURIComponent(`${asset}-USDT-SWAP`);
    const currency = encodeURIComponent(asset);
    return [
      `https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${currency}&period=5m`,
      `https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${currency}&period=5m`,
      `https://www.okx.com/api/v5/market/candles?instId=${instrument}&bar=1m&limit=5`,
      `https://www.okx.com/api/v5/public/funding-rate-history?instId=${instrument}&limit=8`,
    ];
  }
  if (definition.id.includes('.kucoin-futures.')) {
    const kucoinSymbol = encodeURIComponent(`${asset === 'BTC' ? 'XBT' : asset}USDTM`);
    const nowMs = Date.now();
    return [
      `https://api-futures.kucoin.com/api/v1/funding-rate/${kucoinSymbol}/current`,
      `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${kucoinSymbol}&granularity=1&from=${nowMs - 5 * 60_000}&to=${nowMs}`,
      `https://api-futures.kucoin.com/api/v1/trade/history?symbol=${kucoinSymbol}`,
    ];
  }
  if (definition.id.includes('.gateio-futures.')) {
    const contract = encodeURIComponent(`${asset}_USDT`);
    return [
      `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${contract}&interval=1m&limit=5`,
    ];
  }
  return [];
}

function liquidationWebsocket(definition: CouncilSourceDefinition) {
  const asset = definition.assets?.[0];
  if (!asset) return undefined;
  const symbol = `${asset}USDT`;
  if (definition.id.includes('.binance-futures.')) {
    return {
      endpoint: `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@forceOrder`,
      subscription: 'forceOrder stream',
    };
  }
  if (definition.id.includes('.bybit-futures.')) {
    return {
      endpoint: 'wss://stream.bybit.com/v5/public/linear',
      subscription: `allLiquidation.${symbol}`,
    };
  }
  return undefined;
}

function freshness(source: CouncilMemberSourceCheck, definition: CouncilSourceDefinition, nowMs: number) {
  const isProxy = definition.id.includes('.proxy.');
  const proxyCacheStatus = source.normalizedData?.proxyCacheStatus;
  const proxyCacheReceivedAtMs = metric(source, 'proxyCacheReceivedAtMs');
  const proxyCacheAgeMs = proxyCacheReceivedAtMs === null
    ? metric(source, 'proxyCacheAgeMs')
    : nowMs - proxyCacheReceivedAtMs;
  if (isProxy && proxyCacheStatus === 'EXPIRED') {
    const receivedAtMs = metric(source, 'proxyCacheReceivedAtMs');
    return {
      status: 'EXPIRED',
      updatedAt: receivedAtMs === null ? null : new Date(receivedAtMs).toISOString(),
      ageMs: proxyCacheAgeMs,
      maxAgeMs: MEMBER_FIVE_PROXY_CACHE_TTL_MS,
    };
  }
  if (isProxy && proxyCacheStatus === 'UNAVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      updatedAt: null,
      ageMs: null,
      maxAgeMs: MEMBER_FIVE_PROXY_CACHE_TTL_MS,
    };
  }
  const updatedAtMs = timestamp(source);
  if (updatedAtMs === null) {
    return {
      status: 'UNAVAILABLE',
      updatedAt: null,
      ageMs: null,
      maxAgeMs: definition.maxAgeMs,
    };
  }
  const ageMs = nowMs - updatedAtMs;
  const proxyFreshness = isProxy
    ? [
        ['funding', metric(source, 'proxyFundingTimestampMs'), 60_000],
        ['positioning', metric(source, 'proxyPositioningTimestampMs'), 6 * 60_000],
        ['price', metric(source, 'proxyPriceTimestampMs'), 60_000],
      ] as const
    : [];
  const proxyFieldsFresh = proxyFreshness.every(([, fieldTimestampMs, maxAgeMs]) =>
    fieldTimestampMs !== null &&
    fieldTimestampMs <= nowMs + 1_000 &&
    nowMs - fieldTimestampMs <= maxAgeMs
  );
  const fresh = updatedAtMs <= nowMs + 1_000 &&
    nowMs - updatedAtMs >= 0 &&
    ageMs <= definition.maxAgeMs &&
    proxyFieldsFresh &&
    (!isProxy ||
      (proxyCacheStatus === 'FRESH' || proxyCacheStatus === 'CACHED_OK') &&
      proxyCacheAgeMs !== null &&
      proxyCacheAgeMs >= 0 &&
      proxyCacheAgeMs <= MEMBER_FIVE_PROXY_CACHE_TTL_MS) &&
    source.status === 'HEALTHY' &&
    source.dataValid === true;
  return {
    status: fresh ? 'FRESH' : 'STALE',
    updatedAt: new Date(updatedAtMs).toISOString(),
    ageMs,
    maxAgeMs: definition.maxAgeMs,
    ...(proxyFreshness.length > 0 ? {
      componentMaxAgeMs: {
        funding: 60_000,
        positioning: 6 * 60_000,
        price: 60_000,
      },
    } : {}),
  };
}

function describeSource(
  definition: CouncilSourceDefinition,
  check: CouncilMemberSourceCheck | undefined,
  nowMs: number,
  activeTrack: 'OPTIONS' | 'FUTURES_PROXY' | null,
  voteUsedSourceIds: readonly string[],
) {
  const sourceCheck = check ?? {
    sourceId: definition.id,
    status: 'UNTESTED' as const,
    detail: 'Health check did not return this registered source.',
  };
  const isProxy = definition.id.includes('.proxy.');
  const isCoreOptionVoteSource = !isProxy &&
    ['.deribit-options', '.okx-opt-summary', '.bybit-options']
      .some((suffix) => definition.id.endsWith(suffix));
  const voteEligible = activeTrack === 'FUTURES_PROXY'
    ? isProxy
    : activeTrack === 'OPTIONS'
      ? !isProxy && (definition.assets?.[0] !== 'BTC' && definition.assets?.[0] !== 'ETH' ||
        isCoreOptionVoteSource)
      : false;
  const sourceTime = freshness(sourceCheck, definition, nowMs);
  const normalized = sourceCheck.normalizedData ?? {};
  const liquidationFeedStatus = normalized.proxyLiquidationFeedStatus;
  const liquidationEventCount = metric(sourceCheck, 'proxyLiquidationEventCount') ?? 0;
  const liquidationLongNotional = metric(sourceCheck, 'proxyLiquidationLongNotional');
  const liquidationShortNotional = metric(sourceCheck, 'proxyLiquidationShortNotional');
  const liquidationAffectedScore =
    liquidationFeedStatus === 'LIVE' &&
    liquidationEventCount > 0 &&
    liquidationLongNotional !== null &&
    liquidationShortNotional !== null &&
    liquidationLongNotional + liquidationShortNotional > 0;
  const websocket = isProxy ? liquidationWebsocket(definition) : undefined;
  const proxyApis = isProxy ? futuresProxyApis(definition) : [];

  return {
    provider: definition.provider,
    sourceId: definition.id,
    group: definition.group,
    marketType: definition.marketType ?? null,
    independenceGroup: definition.independenceGroup ?? null,
    api: definition.url,
    relatedApis: proxyApis.length
      ? proxyApis
      : definition.additionalHealthUrls ?? [],
    liquidationWebsocket: isProxy ? {
      ...(websocket ?? {
        endpoint: null,
        subscription: null,
      }),
      status: typeof liquidationFeedStatus === 'string'
        ? liquidationFeedStatus
        : 'UNAVAILABLE',
    } : undefined,
    enabled: definition.enabled,
    trackEligible: voteEligible,
    usedInFinalVote: voteUsedSourceIds.includes(definition.id),
    voteUsage: sourceCheck.voteUsage ?? 'NOT_EVALUATED',
    health: sourceCheck.status,
    feedHealth: isProxy
      ? normalized.proxyHealthStatus ?? (
        sourceCheck.status === 'HEALTHY' && sourceCheck.dataValid === true
          ? 'HEALTHY'
          : Object.values(normalized).some((value) => value !== null)
            ? 'DEGRADED'
            : 'FAILED'
      )
      : undefined,
    cache: isProxy ? {
      status: typeof normalized.proxyCacheStatus === 'string'
        ? normalized.proxyCacheStatus
        : 'UNAVAILABLE',
      ageMs: metric(sourceCheck, 'proxyCacheReceivedAtMs') === null
        ? metric(sourceCheck, 'proxyCacheAgeMs')
        : nowMs - metric(sourceCheck, 'proxyCacheReceivedAtMs')!,
      maxAgeMs: MEMBER_FIVE_PROXY_CACHE_TTL_MS,
      receivedAt: metric(sourceCheck, 'proxyCacheReceivedAtMs') === null
        ? null
        : new Date(metric(sourceCheck, 'proxyCacheReceivedAtMs')!).toISOString(),
      refreshIssue: normalized.proxyCacheFallbackReason ?? null,
    } : undefined,
    dataValid: sourceCheck.dataValid ?? false,
    freshness: sourceTime,
    observedAt: sourceCheck.observedAtMs
      ? new Date(sourceCheck.observedAtMs).toISOString()
      : null,
    detail: sourceCheck.dataDetail ?? sourceCheck.detail,
    optionFactors: !isProxy ? {
      putCallOpenInterestRatio: metric(sourceCheck, 'putCallOpenInterestRatio'),
      putCallIvSkewPct: metric(sourceCheck, 'putCallIvSpread') === null
        ? null
        : metric(sourceCheck, 'putCallIvSpread')! * 100,
      directionalScore: getOptionsDirectionalScore(
        metric(sourceCheck, 'putCallOpenInterestRatio'),
        metric(sourceCheck, 'putCallIvSpread') === null
          ? null
          : metric(sourceCheck, 'putCallIvSpread')! * 100,
      ),
      contracts: metric(sourceCheck, 'optionInstrumentCount'),
      calls: metric(sourceCheck, 'optionCallContractCount'),
      puts: metric(sourceCheck, 'optionPutContractCount'),
    } : undefined,
    futuresFactors: isProxy ? {
      fundingRate: metric(sourceCheck, 'proxyFundingRate'),
      fundingBaselineRate: metric(sourceCheck, 'proxyFundingBaselineRate'),
      fundingDeviation: metric(sourceCheck, 'proxyFundingDeviation'),
      longShortRatio: metric(sourceCheck, 'proxyLongShortRatio'),
      longShortRatioMethod: normalized.proxyLongShortRatioMethod ?? null,
      openInterestChangePct: metric(sourceCheck, 'proxyOpenInterestChangePct'),
      openInterest: metric(sourceCheck, 'proxyOpenInterest'),
      takerBuyVolume: metric(sourceCheck, 'proxyBuyTradeVolume'),
      takerSellVolume: metric(sourceCheck, 'proxySellTradeVolume'),
      priceReturnPct: metric(sourceCheck, 'proxyPriceReturnPct'),
      realizedVolatilityPct: metric(sourceCheck, 'proxyRealizedVolatilityPct'),
      score: metric(sourceCheck, 'proxyDirectionScore'),
    } : undefined,
    liquidation: isProxy ? {
      status: typeof liquidationFeedStatus === 'string'
        ? liquidationFeedStatus
        : 'UNAVAILABLE',
      eventCount: liquidationEventCount,
      longNotional: liquidationLongNotional,
      shortNotional: liquidationShortNotional,
      updatedAt: metric(sourceCheck, 'proxyLiquidationTimestampMs') === null
        ? null
        : new Date(metric(sourceCheck, 'proxyLiquidationTimestampMs')!).toISOString(),
      affectedProxyScore: liquidationAffectedScore,
      scoreTreatment: liquidationAffectedScore
        ? 'Fresh liquidation imbalance was included in the proxy score.'
        : 'No fresh liquidation event was included; score uses the other validated metrics only.',
    } : undefined,
  };
}

function selectedScore(vote: {
  usedSourceIds?: readonly string[];
  evidenceTrack?: 'OPTIONS' | 'FUTURES_PROXY';
  proxyAggregate?: { directionScore: number };
}, sourceChecks: readonly CouncilMemberSourceCheck[]): number | null {
  if (vote.evidenceTrack === 'FUTURES_PROXY') {
    return vote.proxyAggregate?.directionScore ?? null;
  }
  const used = new Set(vote.usedSourceIds ?? []);
  const scores = sourceChecks.flatMap((source) => {
    if (!used.has(source.sourceId)) return [];
    if (vote.evidenceTrack === 'FUTURES_PROXY') {
      const score = metric(source, 'proxyDirectionScore');
      return score === null ? [] : [score];
    }
    if (vote.evidenceTrack === 'OPTIONS') {
      const score = getOptionsDirectionalScore(
        metric(source, 'putCallOpenInterestRatio'),
        metric(source, 'putCallIvSpread') === null
          ? null
          : metric(source, 'putCallIvSpread')! * 100,
      );
      return score === null ? [] : [score];
    }
    return [];
  });
  return scores.length
    ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(6))
    : null;
}

async function main(): Promise<void> {
  const runAtMs = Date.now();
  const report: Array<Record<string, unknown>> = [];
  for (const asset of ASSETS) {
    const thresholds = getCouncilOptionsThresholds(asset);
    if (!thresholds) throw new Error(`Member 5 thresholds are not defined for ${asset}.`);
    const checksByMember = await checkCouncilMemberSources(
      Date.now(),
      fetch,
      asset,
      null,
      [5],
    );
    const checks = checksByMember[5] ?? [];
    const definitions = getCouncilMemberSources(5, asset);
    if (checks.length !== definitions.length) {
      throw new Error(
        `${asset} diagnostic expected ${definitions.length} source checks but received ${checks.length}.`,
      );
    }
    const council = evaluateEightMemberCouncil({
      pair: `${asset}/USDT:USDT`,
      memberSourceChecks: { 5: checks },
      requireMemberSourceQuorum: true,
      nowMs: Date.now(),
    });
    const vote = council.members[4];
    const reportAtMs = Date.now();
    const checkById = new Map(vote.sourceChecks.map((source) => [source.sourceId, source]));
    const allChecksById = new Map(checks.map((source) => [source.sourceId, source]));
    const healthyProxySources = definitions.filter((definition) => {
      if (!definition.id.includes('.proxy.')) return false;
      const source = allChecksById.get(definition.id);
      if (!source || source.status !== 'HEALTHY' || source.dataValid !== true) return false;
      const sourceTimestampMs = metric(source, 'proxyTimestampMs');
      const cacheReceivedAtMs = metric(source, 'proxyCacheReceivedAtMs');
      const cacheAgeMs = cacheReceivedAtMs === null
        ? null
        : reportAtMs - cacheReceivedAtMs;
      const cacheStatus = source.normalizedData?.proxyCacheStatus;
      const fundingTimestampMs = metric(source, 'proxyFundingTimestampMs');
      const positioningTimestampMs = metric(source, 'proxyPositioningTimestampMs');
      const priceTimestampMs = metric(source, 'proxyPriceTimestampMs');
      const isFresh = (timestampMs: number | null, maxAgeMs: number) =>
        timestampMs !== null &&
        timestampMs <= reportAtMs + 1_000 &&
        reportAtMs - timestampMs <= maxAgeMs;
      return sourceTimestampMs !== null &&
        isFresh(sourceTimestampMs, definition.maxAgeMs) &&
        (cacheStatus === 'FRESH' || cacheStatus === 'CACHED_OK') &&
        cacheAgeMs !== null &&
        cacheAgeMs >= 0 &&
        cacheAgeMs <= MEMBER_FIVE_PROXY_CACHE_TTL_MS &&
        isFresh(fundingTimestampMs, 60_000) &&
        isFresh(positioningTimestampMs, 6 * 60_000) &&
        isFresh(priceTimestampMs, 60_000);
    }).length;

    report.push({
      asset,
      pair: `${asset}/USDT:USDT`,
      checkedAt: new Date(reportAtMs).toISOString(),
      activeTrack: vote.evidenceTrack ?? 'UNAVAILABLE',
      quorum: {
        healthyIndependentSources: vote.healthySourceCount ?? 0,
        requiredIndependentSources: vote.sourceQuorumRequired ??
          thresholds.minimumIndependentSources,
        passed: vote.vote !== 'ABSTAIN' &&
          (vote.healthySourceCount ?? 0) >=
            (vote.sourceQuorumRequired ?? thresholds.minimumIndependentSources),
      },
      proxyQuorum: {
        healthyIndependentSourcesAtCheck: healthyProxySources,
        requiredIndependentSources: MEMBER_FIVE_PROXY_QUORUM,
        usedForFinalVote: vote.evidenceTrack === 'FUTURES_PROXY',
        passed: vote.evidenceTrack === 'FUTURES_PROXY'
          ? (vote.usedSourceIds?.length ?? 0) >= MEMBER_FIVE_PROXY_QUORUM
          : null,
      },
      signal: {
        vote: vote.vote,
        score: selectedScore(vote, checks),
        confidencePct: vote.confidencePct,
        confidenceMethod: vote.evidenceTrack
          ? `${vote.evidenceTrack} rule-based heuristic; not a calibrated probability`
          : 'Unavailable',
        voteWeightPct: vote.voteWeightPct,
        sourceIdsUsed: vote.usedSourceIds ?? [],
        proxyAggregate: vote.proxyAggregate ?? null,
        rationale: vote.rationaleFa,
      },
      sources: definitions.map((definition) => {
        const check = checkById.get(definition.id) ?? allChecksById.get(definition.id);
        return describeSource(
          definition,
          check,
          reportAtMs,
          vote.evidenceTrack ?? null,
          vote.usedSourceIds ?? [],
        );
      }),
    });
  }

  console.log(JSON.stringify({
    report: 'Member 5 Options Council Diagnostic Status',
    runAt: new Date(runAtMs).toISOString(),
    assets: report,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error('[MEMBER5_STATUS_REPORT] Failed:', error);
  process.exitCode = 1;
});
