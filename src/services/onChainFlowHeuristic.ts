import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CouncilWhaleFlowData,
  CouncilWhaleTransfer,
  OnChainFlowSignal,
} from './eightMemberCouncil';
import type { OnChainAsset } from './onChainFeedRegistry';
import {
  findVerifiedOnChainWalletLabel,
  loadVerifiedOnChainWalletLabels,
  type VerifiedOnChainWalletLabel,
} from './onChainWalletLabels';

const WINDOW_MS = 5 * 60_000;
const HISTORY_WINDOWS = 24 * 60 / 5;
const REQUIRED_SPIKE_RATIO = 2;
const MAX_AGE_MS = WINDOW_MS - 1;
const HISTORY_PERSIST_INTERVAL_MS = 60_000;
const MINIMUM_NATIVE_VOLUME: Readonly<Record<OnChainAsset, number>> = {
  BTC: 10,
  ETH: 100,
  SOL: 10,
  BNB: 5,
  XRP: 1_000,
};

export interface OnChainFlowBaselineEvent {
  id: string;
  asset: OnChainAsset;
  direction: 'INFLOW' | 'OUTFLOW';
  exchange: string;
  amount: number;
  timestampMs: number;
  sourceIds: string[];
}

interface FlowHistory {
  schemaVersion: 1;
  labelFingerprint: string;
  observedBuckets: Partial<Record<OnChainAsset, number[]>>;
  events: OnChainFlowBaselineEvent[];
}

const HISTORY_FILE_PATH = process.env.SBK1_ONCHAIN_FLOW_HISTORY_FILE?.trim() ||
  path.join(process.cwd(), '.cache', 'sbk1', 'onchain-flow-history.json');
let writeQueue: Promise<void> = Promise.resolve();
let cachedHistory: FlowHistory | null = null;
let historyLoaded = false;
let cachedHistoryFingerprint: string | null = null;
let historyDirty = false;
let lastHistoryPersistAtMs = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asAsset(value: unknown): OnChainAsset | null {
  return value === 'BTC' || value === 'ETH' || value === 'SOL' || value === 'BNB' || value === 'XRP'
    ? value
    : null;
}

function readHistory(value: unknown): FlowHistory {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      typeof value.labelFingerprint !== 'string' ||
      !isRecord(value.observedBuckets) || !Array.isArray(value.events)) {
    throw new Error('On-chain flow history has an unsupported or malformed schema.');
  }
  const observedBuckets: Partial<Record<OnChainAsset, number[]>> = {};
  for (const [assetName, values] of Object.entries(value.observedBuckets)) {
    const asset = asAsset(assetName);
    if (!asset || !Array.isArray(values) ||
        values.some((timestamp) => typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp))) {
      throw new Error(`On-chain flow history has invalid observed buckets for ${assetName}.`);
    }
    observedBuckets[asset] = values as number[];
  }
  const events = value.events.map((event): OnChainFlowBaselineEvent => {
    const asset = isRecord(event) ? asAsset(event.asset) : null;
    if (!isRecord(event) ||
        typeof event.id !== 'string' ||
        !asset ||
        (event.direction !== 'INFLOW' && event.direction !== 'OUTFLOW') ||
        typeof event.exchange !== 'string' ||
        typeof event.amount !== 'number' || !Number.isFinite(event.amount) || event.amount <= 0 ||
        typeof event.timestampMs !== 'number' || !Number.isSafeInteger(event.timestampMs) ||
        !Array.isArray(event.sourceIds) ||
        event.sourceIds.some((sourceId) => typeof sourceId !== 'string')) {
      throw new Error('On-chain flow history contains an invalid event.');
    }
    return {
      id: event.id,
      asset,
      direction: event.direction,
      exchange: event.exchange,
      amount: event.amount,
      timestampMs: event.timestampMs,
      sourceIds: event.sourceIds,
    };
  });
  return {
    schemaVersion: 1,
    labelFingerprint: value.labelFingerprint,
    observedBuckets,
    events,
  };
}

async function loadHistory(): Promise<FlowHistory | null> {
  try {
    const contents = await readFile(HISTORY_FILE_PATH, 'utf8');
    let decoded: unknown;
    try {
      decoded = JSON.parse(contents);
    } catch (error) {
      throw new Error(`On-chain flow history is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    return readHistory(decoded);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveHistory(history: FlowHistory): Promise<void> {
  const directory = path.dirname(HISTORY_FILE_PATH);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${HISTORY_FILE_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(history), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, HISTORY_FILE_PATH);
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function findExchangeFlow(
  transfer: CouncilWhaleTransfer,
  labels: readonly VerifiedOnChainWalletLabel[],
  asset: OnChainAsset,
): { direction: OnChainFlowBaselineEvent['direction']; exchange: string } | null {
  const fromAddresses = transfer.fromAddresses ?? (transfer.fromAddress ? [transfer.fromAddress] : []);
  const fromLabels = fromAddresses.flatMap((address) => {
    const label = findVerifiedOnChainWalletLabel(labels, asset, address);
    return label ? [label] : [];
  });
  const sourceExchanges = new Set(fromLabels.map(({ exchange }) => exchange.toLowerCase()));
  if (sourceExchanges.size > 1) return null;
  const from = fromLabels[0] ?? null;
  const to = findVerifiedOnChainWalletLabel(labels, asset, transfer.toAddress);
  if (from && to && from.exchange.toLowerCase() !== to.exchange.toLowerCase()) return null;
  if (from && to) return null;
  if (to) return { direction: 'INFLOW', exchange: to.exchange };
  if (from) return { direction: 'OUTFLOW', exchange: from.exchange };
  return null;
}

function buildSignal(options: {
  asset: OnChainAsset;
  nowMs: number;
  history: FlowHistory;
  independentProviderCount: number;
}): OnChainFlowSignal {
  const currentBucket = Math.floor(options.nowMs / WINDOW_MS) * WINDOW_MS;
  const priorBuckets = Array.from(
    { length: HISTORY_WINDOWS },
    (_unused, index) => currentBucket - (index + 1) * WINDOW_MS,
  );
  const observed = new Set(options.history.observedBuckets[options.asset] ?? []);
  const completeBaseline = priorBuckets.every((bucket) => observed.has(bucket));
  const baselineEvents = options.history.events.filter((event) =>
    event.asset === options.asset && priorBuckets.includes(Math.floor(event.timestampMs / WINDOW_MS) * WINDOW_MS)
  );
  const baselineInflow = baselineEvents
    .filter(({ direction }) => direction === 'INFLOW')
    .reduce((sum, { amount }) => sum + amount, 0) / HISTORY_WINDOWS;
  const baselineOutflow = baselineEvents
    .filter(({ direction }) => direction === 'OUTFLOW')
    .reduce((sum, { amount }) => sum + amount, 0) / HISTORY_WINDOWS;
  const currentEvents = options.history.events.filter((event) =>
    event.asset === options.asset &&
    event.timestampMs >= options.nowMs - WINDOW_MS &&
    event.timestampMs <= options.nowMs
  );
  const inflowNative = currentEvents
    .filter(({ direction }) => direction === 'INFLOW')
    .reduce((sum, { amount }) => sum + amount, 0);
  const outflowNative = currentEvents
    .filter(({ direction }) => direction === 'OUTFLOW')
    .reduce((sum, { amount }) => sum + amount, 0);
  const inflowSpikeRatio = baselineInflow === 0
    ? inflowNative > 0 ? Number.POSITIVE_INFINITY : 0
    : inflowNative / baselineInflow;
  const outflowSpikeRatio = baselineOutflow === 0
    ? outflowNative > 0 ? Number.POSITIVE_INFINITY : 0
    : outflowNative / baselineOutflow;
  const inflowIsSpike = inflowNative >= MINIMUM_NATIVE_VOLUME[options.asset] &&
    inflowSpikeRatio >= REQUIRED_SPIKE_RATIO;
  const outflowIsSpike = outflowNative >= MINIMUM_NATIVE_VOLUME[options.asset] &&
    outflowSpikeRatio >= REQUIRED_SPIKE_RATIO;
  const unambiguous = inflowIsSpike !== outflowIsSpike;
  const direction = !completeBaseline || options.independentProviderCount < 2 || !unambiguous
    ? null
    : inflowIsSpike ? 'SHORT' : 'LONG';
  const selectedVolumeNative = direction === 'SHORT'
    ? inflowNative
    : direction === 'LONG'
      ? outflowNative
      : Math.max(inflowNative, outflowNative);
  const baselineMeanNative = direction === 'SHORT'
    ? baselineInflow
    : direction === 'LONG'
      ? baselineOutflow
      : Math.max(baselineInflow, baselineOutflow);
  const spikeRatio = baselineMeanNative === 0
    ? selectedVolumeNative > 0 ? null : 0
    : selectedVolumeNative / baselineMeanNative;
  const reason = !completeBaseline
    ? `24h baseline is incomplete (${observed.size}/${HISTORY_WINDOWS} prior five-minute windows observed).`
    : options.independentProviderCount < 2
      ? 'At least two independent transaction providers are required.'
      : inflowIsSpike && outflowIsSpike
        ? 'Both inflow and outflow are volume spikes; direction is ambiguous.'
        : !inflowIsSpike && !outflowIsSpike
          ? 'No labeled five-minute flow exceeded both its native-volume floor and 2x 24h mean.'
          : direction === 'SHORT'
            ? 'Verified exchange inflow is a 2x-or-greater five-minute volume spike.'
            : 'Verified exchange outflow is a 2x-or-greater five-minute volume spike.';
  return {
    status: direction ? 'CONFIRMED' : 'ABSTAIN',
    direction,
    asset: options.asset,
    inflowNative,
    outflowNative,
    selectedVolumeNative,
    baselineMeanNative,
    spikeRatio,
    requiredSpikeRatio: REQUIRED_SPIKE_RATIO,
    baselineWindows: observed.size,
    requiredBaselineWindows: HISTORY_WINDOWS,
    independentProviderCount: options.independentProviderCount,
    sourceIds: [...new Set(currentEvents.flatMap(({ sourceIds }) => sourceIds))],
    labeledTransferCount: currentEvents.length,
    observedAtMs: options.nowMs,
    reason,
  };
}

export async function applyOnChainFlowHeuristic(
  flow: CouncilWhaleFlowData,
  nowMs = Date.now(),
): Promise<CouncilWhaleFlowData> {
  const asset = asAsset(flow.asset);
  if (!asset) return flow;
  const { labels, fingerprint } = await loadVerifiedOnChainWalletLabels(nowMs);
  return serialize(async () => {
    if (!historyLoaded) {
      cachedHistory = await loadHistory();
      historyLoaded = true;
      cachedHistoryFingerprint = cachedHistory?.labelFingerprint ?? null;
    }
    const loadedHistory = cachedHistory;
    const fingerprintChanged = cachedHistoryFingerprint !== fingerprint;
    const history: FlowHistory = loadedHistory?.labelFingerprint === fingerprint
      ? loadedHistory
      : {
          schemaVersion: 1,
          labelFingerprint: fingerprint,
          observedBuckets: {},
          events: [],
        };
    let changed = fingerprintChanged;
    if (labels.length === 0) {
      const emptyHistory: FlowHistory = {
        schemaVersion: 1,
        labelFingerprint: fingerprint,
        observedBuckets: {},
        events: [],
      };
      const needsReset = loadedHistory !== null && (
        loadedHistory.labelFingerprint !== fingerprint ||
        loadedHistory.events.length > 0 ||
        Object.values(loadedHistory.observedBuckets).some((buckets) => buckets.length > 0)
      );
      cachedHistory = emptyHistory;
      cachedHistoryFingerprint = fingerprint;
      historyDirty ||= needsReset;
      if (historyDirty && (
        lastHistoryPersistAtMs === 0 ||
        nowMs - lastHistoryPersistAtMs >= HISTORY_PERSIST_INTERVAL_MS
      )) {
        await saveHistory(emptyHistory);
        lastHistoryPersistAtMs = nowMs;
        historyDirty = false;
      }
      const signal = buildSignal({
        asset,
        nowMs,
        history: emptyHistory,
        independentProviderCount: flow.independentProviderCount ?? 0,
      });
      return {
        ...flow,
        flowSignal: { ...signal, reason: 'No verified on-chain wallet labels are configured.' },
      };
    }
    const currentBucket = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
    const observedBuckets = new Set(history.observedBuckets[asset] ?? []);
    const flowIsFresh = flow.timestampMs !== null &&
      flow.timestampMs <= nowMs &&
      nowMs - flow.timestampMs < WINDOW_MS &&
      flow.retrievedAtMs !== null &&
      flow.retrievedAtMs !== undefined &&
      flow.retrievedAtMs <= nowMs &&
      nowMs - flow.retrievedAtMs < WINDOW_MS;
    if (flow.status === 'LIVE' && flowIsFresh &&
        Number.isSafeInteger(flow.independentProviderCount) &&
        (flow.independentProviderCount ?? 0) >= 2 &&
        new Set(flow.independentSourceIds ?? []).size >= 2) {
      if (!observedBuckets.has(currentBucket)) changed = true;
      observedBuckets.add(currentBucket);
      const eventIds = new Set(history.events.map(({ id }) => id));
      for (const transfer of flow.largeTransfers ?? []) {
        if (
          (transfer.providerConfirmations ?? 0) < 2 ||
          new Set(transfer.confirmingSourceIds ?? []).size < 2 ||
          transfer.asset !== asset ||
          transfer.confirmationStatus !== 'CONFIRMED' ||
          !Number.isFinite(transfer.timestampMs) ||
          transfer.timestampMs > nowMs ||
          nowMs - transfer.timestampMs > MAX_AGE_MS ||
          transfer.amount < MINIMUM_NATIVE_VOLUME[asset]
        ) continue;
        const attribution = findExchangeFlow(transfer, labels, asset);
        if (!attribution) continue;
        const id = `${asset}:${transfer.blockchain}:${transfer.transactionHash.toLowerCase()}:${transfer.transferId ?? ''}:${attribution.direction}`;
        if (eventIds.has(id)) continue;
        changed = true;
        eventIds.add(id);
        history.events.push({
          id,
          asset,
          direction: attribution.direction,
          exchange: attribution.exchange,
          amount: transfer.amount,
          timestampMs: transfer.timestampMs,
          sourceIds: [...(transfer.confirmingSourceIds ?? [])],
        });
      }
    }
    const oldestBucket = currentBucket - HISTORY_WINDOWS * WINDOW_MS;
    history.observedBuckets[asset] = [...observedBuckets]
      .filter((bucket) => bucket >= oldestBucket && bucket <= currentBucket)
      .sort((a, b) => a - b);
    if (history.observedBuckets[asset].length !== observedBuckets.size) changed = true;
    const eventCountBeforePrune = history.events.length;
    history.events = history.events.filter((event) =>
      event.timestampMs >= nowMs - 24 * 60 * 60_000 && event.timestampMs <= nowMs
    );
    if (history.events.length !== eventCountBeforePrune) changed = true;
    const signal = buildSignal({
      asset,
      nowMs,
      history,
      independentProviderCount: flow.independentProviderCount ?? 0,
    });
    cachedHistory = history;
    cachedHistoryFingerprint = fingerprint;
    historyDirty ||= changed;
    if (historyDirty && (
      lastHistoryPersistAtMs === 0 ||
      nowMs - lastHistoryPersistAtMs >= HISTORY_PERSIST_INTERVAL_MS
    )) {
      await saveHistory(history);
      lastHistoryPersistAtMs = nowMs;
      historyDirty = false;
    }
    return { ...flow, flowSignal: signal };
  });
}

export async function evaluateOnChainFlowHeuristicForDryRun(options: {
  flow: CouncilWhaleFlowData;
  labels: readonly VerifiedOnChainWalletLabel[];
  priorEvents?: readonly OnChainFlowBaselineEvent[];
  observedBuckets: readonly number[];
  nowMs: number;
}): Promise<OnChainFlowSignal> {
  const asset = asAsset(options.flow.asset);
  if (!asset) throw new Error('Dry-run flow must use one of the five supported assets.');
  const history: FlowHistory = {
    schemaVersion: 1,
    labelFingerprint: 'dry-run',
    observedBuckets: { [asset]: [...options.observedBuckets] },
    events: [...(options.priorEvents ?? [])],
  };
  for (const transfer of options.flow.largeTransfers ?? []) {
    if ((transfer.providerConfirmations ?? 0) < 2 ||
        new Set(transfer.confirmingSourceIds ?? []).size < 2 ||
        transfer.confirmationStatus !== 'CONFIRMED' ||
        transfer.asset !== asset ||
        transfer.amount < MINIMUM_NATIVE_VOLUME[asset]) continue;
    const attribution = findExchangeFlow(transfer, options.labels, asset);
    if (!attribution) continue;
    history.events.push({
      id: `${asset}:${transfer.blockchain}:${transfer.transactionHash}:${transfer.transferId ?? ''}:${attribution.direction}`,
      asset,
      direction: attribution.direction,
      exchange: attribution.exchange,
      amount: transfer.amount,
      timestampMs: transfer.timestampMs,
      sourceIds: [...(transfer.confirmingSourceIds ?? [])],
    });
  }
  return buildSignal({
    asset,
    nowMs: options.nowMs,
    history,
    independentProviderCount: options.flow.independentProviderCount ?? 0,
  });
}
