import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExchangeAddressRecord } from './exchangeAddressRegistry';
import { QUORUM_ASSETS, type QuorumAsset, type QuorumObservedTransfer } from './whaleConsensusCandidateRegistry';

const DEFAULT_FILE_PATH = path.resolve(process.cwd(), 'data/whale-addresses.json');
const MAX_PROCESSED_EVENTS = 50_000;
const WHALE_MIN_TX_COUNT = 5;
const WHALE_MIN_VOLUME_USD = 1_000_000;

export interface WhaleAddressRecord {
  address: string;
  chain: QuorumAsset;
  first_seen: string;
  last_seen: string;
  tx_count: number;
  total_volume_usd: number;
  is_whale: boolean;
}

interface ProcessedTransfer {
  id: string;
  timestamp_ms: number;
}

interface WhaleAddressStore {
  version: 1;
  addresses: WhaleAddressRecord[];
  processed_transfer_ids: ProcessedTransfer[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAddress(asset: QuorumAsset, address: string): string {
  if (asset === 'ETH' || asset === 'BNB') return address.toLowerCase();
  if (asset === 'BTC' && address.toLowerCase().startsWith('bc1')) return address.toLowerCase();
  return address;
}

function emptyStore(): WhaleAddressStore {
  return { version: 1, addresses: [], processed_transfer_ids: [] };
}

function parseStore(value: unknown): WhaleAddressStore {
  if (!isRecord(value) || value.version !== 1 ||
      !Array.isArray(value.addresses) || !Array.isArray(value.processed_transfer_ids)) {
    throw new Error('Whale address registry has an unsupported or malformed structure.');
  }
  const validAddresses = value.addresses.every((item) =>
    isRecord(item) &&
    typeof item.address === 'string' && item.address.length > 0 &&
    QUORUM_ASSETS.includes(item.chain as QuorumAsset) &&
    typeof item.first_seen === 'string' && Number.isFinite(Date.parse(item.first_seen)) &&
    typeof item.last_seen === 'string' && Number.isFinite(Date.parse(item.last_seen)) &&
    Number.isSafeInteger(item.tx_count) && (item.tx_count as number) >= 0 &&
    typeof item.total_volume_usd === 'number' && Number.isFinite(item.total_volume_usd) && item.total_volume_usd >= 0 &&
    typeof item.is_whale === 'boolean'
  );
  const validEvents = value.processed_transfer_ids.every((item) =>
    isRecord(item) && typeof item.id === 'string' && item.id.length > 0 &&
    Number.isSafeInteger(item.timestamp_ms) && (item.timestamp_ms as number) > 0
  );
  if (!validAddresses || !validEvents) throw new Error('Whale address registry contains invalid records.');
  return value as unknown as WhaleAddressStore;
}

async function loadStore(filePath: string): Promise<WhaleAddressStore> {
  try {
    return parseStore(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

export async function trackUnknownWhaleAddresses(options: {
  observedTransfers: Readonly<Record<QuorumAsset, readonly QuorumObservedTransfer[]>>;
  exchangeAddresses: readonly ExchangeAddressRecord[];
  pricesUsd: Partial<Record<QuorumAsset, number>>;
  nowMs?: number;
  filePath?: string;
}): Promise<{ newEvents: number; trackedAddresses: number; flaggedWhales: number }> {
  const nowMs = options.nowMs ?? Date.now();
  const filePath = options.filePath ?? process.env.SBK1_WHALE_ADDRESS_FILE ?? DEFAULT_FILE_PATH;
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('Whale address tracking timestamp is invalid.');
  const store = await loadStore(filePath);
  const processed = new Set(store.processed_transfer_ids.map(({ id }) => id));
  const records = new Map(store.addresses.map((item) => [`${item.chain}:${normalizeAddress(item.chain, item.address)}`, item]));
  const knownAddresses = new Set(options.exchangeAddresses.map(({ chain, address }) => `${chain}:${normalizeAddress(chain, address)}`));
  const newEvents: ProcessedTransfer[] = [];
  const transferVolumes = new Map<string, {
    asset: QuorumAsset;
    address: string;
    recordKey: string;
    transactionHash: string;
    timestampMs: number;
    amount: number;
  }>();

  for (const asset of QUORUM_ASSETS) {
    const price = options.pricesUsd[asset];
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
    for (const transfer of options.observedTransfers[asset] ?? []) {
      if (
        transfer.assetSymbol !== asset || transfer.confirmationStatus !== 'CONFIRMED' ||
        !Number.isFinite(transfer.amount) || transfer.amount <= 0 ||
        !Number.isSafeInteger(transfer.timestampMs) || transfer.timestampMs > nowMs
      ) continue;
      const addresses = new Set([
        ...(transfer.fromAddresses ?? []),
        ...(transfer.toAddresses ?? []),
      ].filter((address) => typeof address === 'string' && address.trim().length > 0)
        .map((address) => normalizeAddress(asset, address)));
      for (const address of addresses) {
        const recordKey = `${asset}:${address}`;
        if (knownAddresses.has(recordKey)) continue;
        const transactionHash = asset === 'SOL' ? transfer.transactionHash : transfer.transactionHash.toLowerCase();
        const eventId = `${recordKey}:${transactionHash}`;
        if (processed.has(eventId)) continue;
        const previous = transferVolumes.get(eventId);
        transferVolumes.set(eventId, {
          asset,
          address,
          recordKey,
          transactionHash,
          timestampMs: Math.max(previous?.timestampMs ?? 0, transfer.timestampMs),
          amount: (previous?.amount ?? 0) + transfer.amount,
        });
      }
    }
  }

  for (const [eventId, event] of transferVolumes) {
    const price = options.pricesUsd[event.asset]!;
    const volumeUsd = event.amount * price;
    if (!Number.isFinite(volumeUsd) || volumeUsd <= 0) continue;
    const seenAt = new Date(event.timestampMs).toISOString();
    const previous = records.get(event.recordKey);
    const txCount = (previous?.tx_count ?? 0) + 1;
    const totalVolumeUsd = (previous?.total_volume_usd ?? 0) + volumeUsd;
    records.set(event.recordKey, {
      address: event.address,
      chain: event.asset,
      first_seen: previous && Date.parse(previous.first_seen) <= event.timestampMs
        ? previous.first_seen
        : seenAt,
      last_seen: previous && Date.parse(previous.last_seen) >= event.timestampMs
        ? previous.last_seen
        : seenAt,
      tx_count: txCount,
      total_volume_usd: totalVolumeUsd,
      is_whale: txCount >= WHALE_MIN_TX_COUNT && totalVolumeUsd >= WHALE_MIN_VOLUME_USD,
    });
    processed.add(eventId);
    newEvents.push({ id: eventId, timestamp_ms: event.timestampMs });
  }

  if (newEvents.length === 0) {
    return {
      newEvents: 0,
      trackedAddresses: records.size,
      flaggedWhales: [...records.values()].filter(({ is_whale }) => is_whale).length,
    };
  }
  store.addresses = [...records.values()];
  store.processed_transfer_ids = [...store.processed_transfer_ids, ...newEvents]
    .filter(({ timestamp_ms }) => timestamp_ms >= nowMs - 15 * 24 * 60 * 60_000)
    .slice(-MAX_PROCESSED_EVENTS);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    newEvents: newEvents.length,
    trackedAddresses: store.addresses.length,
    flaggedWhales: store.addresses.filter(({ is_whale }) => is_whale).length,
  };
}