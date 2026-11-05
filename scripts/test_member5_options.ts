import assert from 'node:assert/strict';
import { checkCouncilMemberSources } from '../src/services/councilSourceHealth';
import {
  evaluateEightMemberCouncil,
  getOptionsDirectionalScore,
  type CouncilMemberSourceCheck,
} from '../src/services/eightMemberCouncil';
import { getCouncilMemberSources } from '../src/services/councilSourceRegistry';
import { getCouncilOptionsThresholds } from '../src/services/councilOptionsThresholds';
import {
  MEMBER_FIVE_PROXY_CACHE_TTL_MS,
  MEMBER_FIVE_PROXY_QUORUM,
} from '../src/services/memberFiveFuturesProxy';

const ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'] as const;
type Asset = typeof ASSETS[number];

function requestedAssets(): Asset[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return [...ASSETS];
  if (args.length !== 2 || args[0] !== '--asset' || !ASSETS.includes(args[1] as Asset)) {
    throw new Error('Usage: npx tsx scripts/test_member5_options.ts [--asset BTC|ETH|SOL|BNB|XRP]');
  }
  return [args[1] as Asset];
}

function metric(source: CouncilMemberSourceCheck, name: string): number | null {
  const value = source.normalizedData?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function describeSource(source: CouncilMemberSourceCheck) {
  const pcr = metric(source, 'putCallOpenInterestRatio');
  const ivSpread = metric(source, 'putCallIvSpread');
  const score = getOptionsDirectionalScore(pcr, ivSpread === null ? null : ivSpread * 100);
  const proxyScore = metric(source, 'proxyDirectionScore');
  return {
    provider: source.provider,
    sourceId: source.sourceId,
    health: source.status,
    futuresProxyHealth: source.sourceId.includes('.proxy.')
      ? source.normalizedData?.proxyHealthStatus ?? (
        source.status === 'HEALTHY' && source.dataValid === true
          ? 'HEALTHY'
          : 'FAILED'
      )
      : undefined,
    dataValid: source.dataValid ?? false,
    voteUsage: source.voteUsage ?? 'NOT_EVALUATED',
    detail: source.dataDetail ?? source.detail,
    sourceTimestamp: source.sourceTimestampMs
      ? new Date(source.sourceTimestampMs).toISOString()
      : null,
    observedAt: source.observedAtMs
      ? new Date(source.observedAtMs).toISOString()
      : null,
    ageMs: source.sourceTimestampMs === null || source.sourceTimestampMs === undefined
      ? null
      : Date.now() - source.sourceTimestampMs,
    cache: source.sourceId.includes('.proxy.') ? {
      status: source.normalizedData?.proxyCacheStatus ?? 'UNAVAILABLE',
      ageMs: metric(source, 'proxyCacheReceivedAtMs') === null
        ? metric(source, 'proxyCacheAgeMs')
        : Date.now() - metric(source, 'proxyCacheReceivedAtMs')!,
      maxAgeMs: MEMBER_FIVE_PROXY_CACHE_TTL_MS,
      receivedAtMs: metric(source, 'proxyCacheReceivedAtMs'),
      refreshIssue: source.normalizedData?.proxyCacheFallbackReason ?? null,
    } : undefined,
    contracts: metric(source, 'optionInstrumentCount'),
    calls: metric(source, 'optionCallContractCount'),
    puts: metric(source, 'optionPutContractCount'),
    putCallOpenInterestRatio: pcr,
    putCallIvSkewPct: ivSpread === null ? null : ivSpread * 100,
    directionScore: score,
    futuresProxy: source.sourceId.includes('.proxy.') ? {
      fundingRate: metric(source, 'proxyFundingRate'),
      fundingBaselineRate: metric(source, 'proxyFundingBaselineRate'),
      fundingDeviation: metric(source, 'proxyFundingDeviation'),
      longShortRatio: metric(source, 'proxyLongShortRatio'),
      openInterestChangePct: metric(source, 'proxyOpenInterestChangePct'),
      priceReturnPct: metric(source, 'proxyPriceReturnPct'),
      realizedVolatilityPct: metric(source, 'proxyRealizedVolatilityPct'),
      liquidationLongNotional: source.normalizedData?.proxyLiquidationLongNotional ?? null,
      liquidationShortNotional: source.normalizedData?.proxyLiquidationShortNotional ?? null,
      liquidationTimestamp: metric(source, 'proxyLiquidationTimestampMs') === null
        ? null
        : new Date(metric(source, 'proxyLiquidationTimestampMs')!).toISOString(),
      liquidationEventCount: metric(source, 'proxyLiquidationEventCount') ?? 0,
      liquidationFeedStatus: source.normalizedData?.proxyLiquidationFeedStatus ?? 'UNAVAILABLE',
      longShortRatioMethod: source.normalizedData?.proxyLongShortRatioMethod ?? null,
      proxyHealthStatus: source.normalizedData?.proxyHealthStatus ?? null,
      proxyOpenInterest: metric(source, 'proxyOpenInterest'),
      proxyBuyTradeVolume: metric(source, 'proxyBuyTradeVolume'),
      proxySellTradeVolume: metric(source, 'proxySellTradeVolume'),
      directionScore: proxyScore,
    } : undefined,
  };
}

async function main(): Promise<void> {
  const assets = requestedAssets();
  for (const asset of assets) {
    const nowMs = Date.now();
    const pair = `${asset}/USDT:USDT`;
    const thresholds = getCouncilOptionsThresholds(asset);
    assert.ok(thresholds, `Missing member 5 thresholds for ${asset}.`);

    console.log(`\n=== عضو ۵ / Options: ${asset} ===`);
    console.log(`حدنصاب مستقیم آپشن: ${thresholds.minimumIndependentSources} منبع؛ حدنصاب futures proxy: ${MEMBER_FIVE_PROXY_QUORUM} از 5 منبع مستقل؛ حداقل قرارداد=${thresholds.minimumContracts} (${thresholds.minimumContractsPerSide} از هر سمت)، تازگی <= ${thresholds.maxAgeMs}ms.`);

    const checksByMember = await checkCouncilMemberSources(
      nowMs,
      fetch,
      asset,
      null,
      [5],
    );
    const sourceChecks = checksByMember[5] ?? [];
    const registeredSources = getCouncilMemberSources(5, asset);
    assert.equal(
      sourceChecks.length,
      registeredSources.length,
      `${asset} health check must test every registered member 5 source and no other member's sources.`,
    );

    const report = evaluateEightMemberCouncil({
      pair,
      memberSourceChecks: { 5: sourceChecks },
      requireMemberSourceQuorum: true,
      nowMs: Date.now(),
    });
    const vote = report.members[4];
    const requiredSources = vote.sourceQuorumRequired ?? thresholds.minimumIndependentSources;
    const reportAtMs = Date.now();
    const healthyProxyVenuesAtCheck = registeredSources.filter((definition) => {
      if (!definition.id.includes('.proxy.')) return false;
      const source = sourceChecks.find((candidate) => candidate.sourceId === definition.id);
      if (!source || source.status !== 'HEALTHY' || source.dataValid !== true) return false;
      const cacheReceivedAtMs = metric(source, 'proxyCacheReceivedAtMs');
      const cacheAgeMs = cacheReceivedAtMs === null
        ? null
        : reportAtMs - cacheReceivedAtMs;
      const cacheStatus = source.normalizedData?.proxyCacheStatus;
      const isFresh = (timestampMs: number | null, maxAgeMs: number) =>
        timestampMs !== null &&
        timestampMs <= reportAtMs + 1_000 &&
        reportAtMs - timestampMs <= maxAgeMs;
      return isFresh(metric(source, 'proxyTimestampMs'), definition.maxAgeMs) &&
        (cacheStatus === 'FRESH' || cacheStatus === 'CACHED_OK') &&
        cacheAgeMs !== null &&
        cacheAgeMs >= 0 &&
        cacheAgeMs <= MEMBER_FIVE_PROXY_CACHE_TTL_MS &&
        isFresh(metric(source, 'proxyFundingTimestampMs'), 60_000) &&
        isFresh(metric(source, 'proxyPositioningTimestampMs'), 6 * 60_000) &&
        isFresh(metric(source, 'proxyPriceTimestampMs'), 60_000);
    }).length;
    const quorumMet = vote.vote === 'ABSTAIN'
      ? false
      : (vote.healthySourceCount ?? 0) >= requiredSources;

    console.log(JSON.stringify({
      asset,
      pair,
      testedMemberIds: Object.keys(checksByMember).map(Number),
      dynamicQuorum: {
        optionsRequiredIndependentSources: thresholds.minimumIndependentSources,
        activeTrack: vote.evidenceTrack ?? null,
        requiredIndependentSources: requiredSources,
        healthyIndependentSources: vote.healthySourceCount ?? 0,
        passed: quorumMet,
        healthyProxyVenues: healthyProxyVenuesAtCheck,
        proxyVenuesUsedByFinalVote: vote.evidenceTrack === 'FUTURES_PROXY'
          ? vote.usedSourceIds?.length ?? 0
          : 0,
        healthyProxyVenuesAtCheck,
        proxyQuorumRequired: MEMBER_FIVE_PROXY_QUORUM,
        proxyQuorumPassedForFinalVote: vote.evidenceTrack === 'FUTURES_PROXY'
          ? (vote.usedSourceIds?.length ?? 0) >= MEMBER_FIVE_PROXY_QUORUM
          : null,
        registeredProxyVenues: registeredSources.filter(({ id }) => id.includes('.proxy.')).length,
      },
      sources: vote.sourceChecks.map(describeSource),
      finalVote: {
        vote: vote.vote,
        evidenceTrack: vote.evidenceTrack ?? null,
        sourceId: vote.sourceId,
        usedSourceIds: vote.usedSourceIds ?? [],
        proxyAggregate: vote.proxyAggregate ?? null,
        dataQualityPct: vote.dataQualityPct,
        confidencePct: vote.confidencePct,
        confidenceIsHeuristic: vote.evidenceTrack === 'OPTIONS' ||
          vote.evidenceTrack === 'FUTURES_PROXY',
        confidenceMethod: vote.evidenceTrack === 'OPTIONS'
          ? 'Options rule-based estimate; not a calibrated probability'
          : vote.evidenceTrack === 'FUTURES_PROXY'
            ? 'Futures proxy heuristic; not a calibrated probability'
            : 'No member-5 track metadata',
        voteWeightPct: vote.voteWeightPct,
        timestamp: vote.sourceTimestampMs
          ? new Date(vote.sourceTimestampMs).toISOString()
          : null,
        ageMs: vote.sourceAgeMs,
        rationale: vote.rationaleFa,
        qualityChecks: vote.qualityChecks.map(({ labelFa, passed, detailFa }) => ({
          label: labelFa,
          passed,
          detail: detailFa,
        })),
      },
    }, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error('[MEMBER5_OPTIONS_TEST] Failed:', error);
  process.exitCode = 1;
});
