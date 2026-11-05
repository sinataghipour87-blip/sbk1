import type { CouncilWhaleFlowData } from './eightMemberCouncil';
import type { OnChainAsset } from './onChainFeedRegistry';
import { getOnChainProtocol } from './onChainProtocolRegistry';

export const ONCHAIN_BEHAVIOR_WINDOW_MS = 15 * 60_000;
export const ONCHAIN_PROTOCOL_SWAP_MAX_AGE_MS = 5 * 60_000 - 1;
export const ONCHAIN_PROTOCOL_MIN_PRESSURE_PCT = 75;
export const ONCHAIN_PROTOCOL_MIN_WALLETS = 3;
export const ONCHAIN_PROTOCOL_MIN_SWAPS = 3;

const NATIVE_VOLUME_FLOOR: Readonly<Record<OnChainAsset, number>> = {
  BTC: 10,
  ETH: 100,
  SOL: 10,
  BNB: 5,
  XRP: 1_000,
};

export interface OnChainProtocolSwap {
  evidenceId: string;
  transactionHash: string;
  blockHeight: number;
  timestampMs: number;
  protocolId: string;
  protocolName: string;
  walletAddress: string;
  walletStatus: 'discovered-candidate';
  asset: 'ETH' | 'BNB';
  direction: 'LONG' | 'SHORT';
  amountNative: number;
  rawAmount: string;
  providerConfirmations: number;
  blockConfirmations: number;
  confirmingSourceIds: readonly string[];
}

export interface OnChainProtocolPressure {
  status: 'CONFIRMED' | 'ABSTAIN';
  direction: 'LONG' | 'SHORT' | null;
  asset: OnChainAsset;
  longVolumeNative: number;
  shortVolumeNative: number;
  selectedVolumeNative: number;
  pressurePct: number;
  confidencePct: number;
  candidateWalletCount: number;
  verifiedSwapCount: number;
  independentProviderCount: number;
  sourceIds: readonly string[];
  observedAtMs: number;
  reason: string;
}

function isValidSwap(
  swap: OnChainProtocolSwap,
  flow: CouncilWhaleFlowData,
  asset: OnChainAsset,
  nowMs: number,
): boolean {
  const protocol = getOnChainProtocol(asset);
  const trustedSources = new Set(flow.independentSourceIds ?? []);
  return protocol !== null &&
    swap.asset === asset &&
    swap.protocolId === protocol.id &&
    swap.protocolName === protocol.name &&
    swap.walletStatus === 'discovered-candidate' &&
    /^0x[0-9a-f]{64}$/i.test(swap.transactionHash) &&
    swap.evidenceId.length > 0 &&
    Number.isSafeInteger(swap.blockHeight) && swap.blockHeight > 0 &&
    Number.isSafeInteger(swap.timestampMs) &&
    swap.timestampMs <= nowMs &&
    nowMs - swap.timestampMs <= ONCHAIN_BEHAVIOR_WINDOW_MS &&
    /^0x[0-9a-f]{40}$/i.test(swap.walletAddress) &&
    Number.isFinite(swap.amountNative) &&
    swap.amountNative > 0 &&
    /^\d+$/.test(swap.rawAmount) &&
    BigInt(swap.rawAmount) > 0n &&
    (swap.direction === 'LONG' || swap.direction === 'SHORT') &&
    Number.isSafeInteger(swap.providerConfirmations) &&
    swap.providerConfirmations >= 2 &&
    Number.isSafeInteger(swap.blockConfirmations) &&
    swap.blockConfirmations >= 12 &&
    new Set(swap.confirmingSourceIds).size >= 2 &&
    swap.confirmingSourceIds.every((sourceId) => trustedSources.has(sourceId));
}

export function evaluateOnChainProtocolPressure(options: {
  asset: OnChainAsset;
  nowMs: number;
  flow: CouncilWhaleFlowData;
  swaps: readonly OnChainProtocolSwap[];
}): OnChainProtocolPressure {
  const { asset, nowMs, flow } = options;
  const valid = flow.status === 'LIVE' &&
    flow.timestampMs !== null &&
    flow.timestampMs <= nowMs &&
    nowMs - flow.timestampMs <= ONCHAIN_PROTOCOL_SWAP_MAX_AGE_MS &&
    flow.retrievedAtMs !== null &&
    flow.retrievedAtMs !== undefined &&
    flow.retrievedAtMs <= nowMs &&
    nowMs - flow.retrievedAtMs <= ONCHAIN_PROTOCOL_SWAP_MAX_AGE_MS &&
    (flow.independentProviderCount ?? 0) >= 2 &&
    new Set(flow.independentSourceIds ?? []).size >= 2
    ? options.swaps.filter((swap) => isValidSwap(swap, flow, asset, nowMs))
    : [];
  const deduplicated = [...new Map(valid.map((swap) => [swap.evidenceId, swap])).values()];
  const longVolumeNative = deduplicated
    .filter((swap) => swap.direction === 'LONG')
    .reduce((sum, swap) => sum + swap.amountNative, 0);
  const shortVolumeNative = deduplicated
    .filter((swap) => swap.direction === 'SHORT')
    .reduce((sum, swap) => sum + swap.amountNative, 0);
  const totalVolumeNative = longVolumeNative + shortVolumeNative;
  const netVolumeNative = longVolumeNative - shortVolumeNative;
  const pressurePct = totalVolumeNative > 0
    ? Math.round((netVolumeNative / totalVolumeNative) * 100)
    : 0;
  const direction = netVolumeNative > 0 ? 'LONG' : netVolumeNative < 0 ? 'SHORT' : null;
  const selectedVolumeNative = direction === 'LONG' ? longVolumeNative : shortVolumeNative;
  const candidateWalletCount = new Set(deduplicated.map((swap) => swap.walletAddress.toLowerCase())).size;
  const sourceIds = [...new Set(deduplicated.flatMap((swap) => swap.confirmingSourceIds))];
  const independentProviderCount = flow.independentProviderCount ?? 0;
  const meetsThreshold = getOnChainProtocol(asset) !== null &&
    direction !== null &&
    Math.abs(pressurePct) >= ONCHAIN_PROTOCOL_MIN_PRESSURE_PCT &&
    selectedVolumeNative >= NATIVE_VOLUME_FLOOR[asset] * 2 &&
    candidateWalletCount >= ONCHAIN_PROTOCOL_MIN_WALLETS &&
    deduplicated.length >= ONCHAIN_PROTOCOL_MIN_SWAPS &&
    independentProviderCount >= 2 &&
    sourceIds.length >= 2;
  const reason = flow.status !== 'LIVE' || flow.timestampMs === null ||
      nowMs - flow.timestampMs > ONCHAIN_PROTOCOL_SWAP_MAX_AGE_MS
    ? 'Protocol swap evidence is not fresh and live.'
    : getOnChainProtocol(asset) === null
      ? 'No verified protocol-swap adapter is enabled for this asset.'
      : deduplicated.length < ONCHAIN_PROTOCOL_MIN_SWAPS
        ? `At least ${ONCHAIN_PROTOCOL_MIN_SWAPS} quorum-confirmed swaps are required.`
        : candidateWalletCount < ONCHAIN_PROTOCOL_MIN_WALLETS
          ? `At least ${ONCHAIN_PROTOCOL_MIN_WALLETS} distinct discovered candidate wallets are required.`
          : selectedVolumeNative < NATIVE_VOLUME_FLOOR[asset] * 2
            ? `Directional volume is below twice the native ${asset} floor.`
            : Math.abs(pressurePct) < ONCHAIN_PROTOCOL_MIN_PRESSURE_PCT
              ? `Directional dominance is below ${ONCHAIN_PROTOCOL_MIN_PRESSURE_PCT}%.`
              : sourceIds.length < 2 || independentProviderCount < 2
                ? 'At least two independent providers are required.'
                : 'Fresh, verified protocol swaps meet the volume, wallet, pressure, and quorum thresholds.';
  return {
    status: meetsThreshold ? 'CONFIRMED' : 'ABSTAIN',
    direction: meetsThreshold ? direction : null,
    asset,
    longVolumeNative,
    shortVolumeNative,
    selectedVolumeNative,
    pressurePct,
    confidencePct: Math.abs(pressurePct),
    candidateWalletCount,
    verifiedSwapCount: deduplicated.length,
    independentProviderCount,
    sourceIds,
    observedAtMs: flow.timestampMs ?? nowMs,
    reason,
  };
}
