import { setTimeout as delay } from 'node:timers/promises';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
import {
  ONCHAIN_MONITORING_FEEDS,
  type OnChainAsset,
} from '../src/services/onChainFeedRegistry';
import {
  fetchOnChainWhaleData,
  startPublicBitcoinWhaleDataPrefetch,
  stopPublicBitcoinWhaleDataPrefetch,
} from '../src/services/publicBitcoinWhaleData';
import {
  getOnChainWalletCandidateCounts,
  loadOnChainWalletCandidates,
} from '../src/services/onChainWalletDiscovery';
import { getOnChainProviderHealth } from '../src/services/onChainProviderHealth';

const assets: readonly OnChainAsset[] = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
const pairFor = (asset: OnChainAsset): string => `${asset}/USDT:USDT`;

startPublicBitcoinWhaleDataPrefetch();
try {
  await delay(15_000);
  const evaluations = [];
  for (const asset of assets) {
    await loadOnChainWalletCandidates(asset);
    const pair = pairFor(asset);
    const flow = await fetchOnChainWhaleData({ pair });
    const checkedAtMs = Date.now();
    const member = evaluateEightMemberCouncil({
      pair,
      nowMs: checkedAtMs,
      whaleFlowData: flow,
    }).members.find(({ id }) => id === 6);
    evaluations.push({
      asset,
      flowStatus: flow.status,
      ageMs: flow.timestampMs === null ? null : Math.max(0, checkedAtMs - flow.timestampMs),
      independentProviderCount: flow.independentProviderCount ?? 0,
      sourceIds: flow.independentSourceIds ?? [],
      qualifyingTransfers: flow.largeTransfers?.length ?? 0,
      flowSignal: flow.flowSignal
        ? { status: flow.flowSignal.status, direction: flow.flowSignal.direction, reason: flow.flowSignal.reason }
        : null,
      vote: member?.vote ?? 'UNAVAILABLE',
      voteReason: member?.rationaleFa ?? null,
      discoveredCandidates: getOnChainWalletCandidateCounts(asset, checkedAtMs),
      confirmedProtocolSwaps: flow.protocolSwaps?.length ?? 0,
      protocolCandidateWallets: new Set(
        (flow.protocolSwaps ?? []).map(({ walletAddress }) => walletAddress.toLowerCase()),
      ).size,
      protocolLongVolumeNative: (flow.protocolSwaps ?? [])
        .filter(({ direction }) => direction === 'LONG')
        .reduce((sum, { amountNative }) => sum + amountNative, 0),
      protocolShortVolumeNative: (flow.protocolSwaps ?? [])
        .filter(({ direction }) => direction === 'SHORT')
        .reduce((sum, { amountNative }) => sum + amountNative, 0),
      topologyDiagnostics: {
        activeCandidates: flow.networkMetrics?.realtimeTopologyActiveCandidateWalletCount ?? 0,
        possibleAccumulators: flow.networkMetrics?.realtimeTopologyPossibleAccumulatorCount ?? 0,
        repeatedLargeSenders: flow.networkMetrics?.realtimeTopologyRepeatedLargeSenderCount ?? 0,
        repeatedLargeReceivers: flow.networkMetrics?.realtimeTopologyRepeatedLargeReceiverCount ?? 0,
      },
      candidateFlowPressure: {
        status: flow.networkMetrics?.realtimeCandidateFlowPressureStatus ?? 'UNAVAILABLE',
        scorePct: flow.networkMetrics?.realtimeCandidateFlowPressureScorePct ?? null,
        accumulationNative: flow.networkMetrics?.realtimeCandidateFlowAccumulationNative ?? 0,
        distributionNative: flow.networkMetrics?.realtimeCandidateFlowDistributionNative ?? 0,
        transferCount: flow.networkMetrics?.realtimeCandidateFlowTransferCount ?? 0,
        walletCount: flow.networkMetrics?.realtimeCandidateFlowWalletCount ?? 0,
      },
    });
  }
  const providerHealth = getOnChainProviderHealth();
  const providerHealthSummary = {
    httpSuccessResponses: providerHealth.filter((provider) =>
      provider.consecutiveFailures === 0 && provider.cooldownUntilMs <= Date.now()
    ).length,
    rateLimitedOrCoolingDown: providerHealth.filter((provider) =>
      provider.consecutiveFailures > 0 || provider.cooldownUntilMs > Date.now()
    ).length,
    coolingDown: providerHealth.filter((provider) => provider.cooldownUntilMs > Date.now()).length,
    observedOrigins: providerHealth.length,
  };
  const healthByOrigin = new Map(providerHealth.map((entry) => [entry.provider, entry]));
  const feedAudit = ONCHAIN_MONITORING_FEEDS.map((feed) => {
    const origin = new URL(feed.url).origin;
    const health = healthByOrigin.get(origin);
    const category = !health
      ? 'UNOBSERVED'
      : health.cooldownUntilMs > Date.now() ||
          health.lastStatus === 429 ||
          health.lastStatus === 503
        ? 'UNSTABLE_OR_RATE_LIMITED'
        : health.lastStatus !== null && health.lastStatus >= 200 && health.lastStatus < 300
          ? 'SUCCESSFUL_IN_THIS_RUN'
          : 'FAILING_IN_THIS_RUN';
    return {
      asset: feed.asset,
      id: feed.id,
      provider: feed.provider,
      operator: feed.operator,
      endpoint: feed.url,
      category,
      lastHttpStatus: health?.lastStatus ?? null,
      healthScore: health?.score ?? null,
    };
  });
  const feedAuditSummary = {
    httpSuccessInThisRun: feedAudit.filter(({ category }) => category === 'SUCCESSFUL_IN_THIS_RUN').length,
    unstableOrRateLimited: feedAudit.filter(({ category }) => category === 'UNSTABLE_OR_RATE_LIMITED').length,
    failingInThisRun: feedAudit.filter(({ category }) => category === 'FAILING_IN_THIS_RUN').length,
    unobserved: feedAudit.filter(({ category }) => category === 'UNOBSERVED').length,
    note: 'HTTP success does not prove valid chain data; registry rows sharing an operator/origin are not independent; UNOBSERVED is not a failure finding.',
  };
  console.log(JSON.stringify({
    mode: 'LIVE_DATA_ONLY_NO_ORDERS',
    checkedAt: new Date().toISOString(),
    evaluations,
    providerHealthSummary,
    feedAuditSummary,
    feedAudit,
    providerHealth,
  }, null, 2));
  console.log(
    `Provider HTTP health: ${providerHealthSummary.httpSuccessResponses} successful responses, ` +
    `${providerHealthSummary.rateLimitedOrCoolingDown} rate-limited/cooling, ` +
    `${providerHealthSummary.coolingDown} cooling down, ` +
    `${providerHealthSummary.observedOrigins} origins observed in this process.`,
  );
  console.log(
    `Configured feed audit (HTTP only): ${feedAuditSummary.httpSuccessInThisRun} successful, ` +
    `${feedAuditSummary.unstableOrRateLimited} rate-limited/cooling, ` +
    `${feedAuditSummary.failingInThisRun} failing, ${feedAuditSummary.unobserved} unobserved ` +
    `(unobserved does not imply dead).`,
  );
} finally {
  await stopPublicBitcoinWhaleDataPrefetch();
}
