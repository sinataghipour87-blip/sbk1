import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExchangeAddressRecord } from './exchangeAddressRegistry';
import { QUORUM_ASSETS, type QuorumAsset, type QuorumObservedTransfer } from './whaleConsensusCandidateRegistry';

const DEFAULT_FILE_PATH = path.resolve(process.cwd(), '.cache/sbk1/wallet-profiles.sqlite');
const PROFILE_WINDOW_MS = 90 * 24 * 60 * 60_000;
const DISCOVERY_RETENTION_MS = 90 * 24 * 60 * 60_000;
const INACTIVE_PROFILE_STATUS_MS = 90 * 24 * 60 * 60_000;
const INACTIVE_PROFILE_RETENTION_MS = 365 * 24 * 60 * 60_000;
export const WALLET_ANALYSIS_ACTIVITY_THRESHOLD = 15;
const LARGE_NATIVE_ACTIVITY_MINIMUM: Readonly<Record<QuorumAsset, number>> = {
  BTC: 10,
  ETH: 100,
  BNB: 1_000,
  SOL: 1_000,
  XRP: 1_000_000,
};
const LARGE_NATIVE_ACTIVITY_ENV: Readonly<Partial<Record<QuorumAsset, {
  name: string;
  maximum: number;
}>>> = {
  BTC: { name: 'SBK1_WHALE_MIN_TRANSFER_BTC', maximum: 1_000_000 },
  ETH: { name: 'SBK1_WHALE_MIN_ETH', maximum: 1_000_000_000 },
  BNB: { name: 'SBK1_WHALE_MIN_BNB', maximum: 1_000_000_000 },
  SOL: { name: 'SBK1_WHALE_MIN_SOL', maximum: 100_000_000 },
  XRP: { name: 'SBK1_WHALE_MIN_XRP', maximum: 1_000_000_000 },
};

export type WalletActivityType =
  | 'NATIVE_TRANSFER'
  | 'TOKEN_TRANSFER'
  | 'SWAP_PATTERN'
  | 'DEX_ORDER'
  | 'CONTRACT_INTERACTION';

export type WalletHistorySyncStatus = 'PENDING' | 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
export type WalletActivityStatus = 'ACTIVE' | 'INACTIVE';

export type WalletBehaviorLabel =
  | 'INSUFFICIENT_ACTIVITY'
  | 'EXCHANGE_FLOW'
  | 'TRANSFER_NETWORK'
  | 'TRANSFER_ACTIVITY';

export interface WhaleAddressRecord {
  address: string;
  chain: QuorumAsset;
  discovery_started_at: string;
  first_seen: string;
  last_seen: string;
  last_large_activity_at: string;
  activity_status: WalletActivityStatus;
  analysis_activity_count: number;
  analysis_eligible: boolean;
  tx_count: number;
  total_volume_usd: number;
  is_whale: boolean;
  window_90d: {
    transfer_count: number;
    transaction_count: number;
    native_volume: number;
    estimated_volume_usd: number;
    incoming_volume: number;
    outgoing_volume: number;
    exchange_interaction_count: number;
    unique_counterparty_count: number;
    active_days: number;
    history_days_covered: number;
    token_transfer_count: number;
    swap_pattern_count: number;
    dex_order_count: number;
    large_activity_count: number;
    large_transaction_count: number;
    large_native_volume: number;
    large_estimated_volume_usd: number;
  };
  cross_asset_address_group_id: string;
  related_assets: QuorumAsset[];
  behavior_score: number;
  behavior_label: WalletBehaviorLabel;
  trading_behavior: 'UNOBSERVED' | 'SWAP_PATTERN_OBSERVED';
  history_sync_status: WalletHistorySyncStatus;
  history_source: string | null;
  history_synced_at: string | null;
  history_coverage_from: string | null;
  history_error: string | null;
  known_exchange_address: boolean;
  exchange_names: string[];
  data_scope: 'CONFIRMED_CHAIN_ACTIVITY' | 'CONFIRMED_LARGE_NATIVE_TRANSFERS';
}

export type WhaleBehaviorTag = 'ACCUMULATOR' | 'DISTRIBUTOR' | 'MM' | 'UNKNOWN';

export interface WhaleBehaviorSummary {
  isWhale: boolean;
  behaviorTag: WhaleBehaviorTag;
  confidenceScore: number;
}

export interface WalletActivitySnapshot {
  transaction_hash: string;
  timestamp_ms: number;
  role: WalletTransferRole;
  activity_type: WalletActivityType;
  large_activity: boolean;
  amount_native: number | null;
  token_amount?: number;
  token_symbol?: string;
  token_address?: string;
  counterparty_addresses: string[];
}

export type WalletTransferRole = 'INCOMING' | 'OUTGOING' | 'SELF' | 'PARTICIPANT';

interface WalletActivityEvent {
  id: string;
  address: string;
  chain: QuorumAsset;
  transaction_hash: string;
  transfer_id: string;
  timestamp_ms: number;
  role: WalletTransferRole;
  amount_native: number | null;
  estimated_volume_usd: number | null;
  activity_type?: WalletActivityType;
  large_activity?: boolean;
  token_amount?: number;
  token_symbol?: string;
  token_address?: string;
  counterparty_addresses: string[];
  exchange_counterparties: string[];
}

export interface WalletHistoryActivity {
  address: string;
  chain: QuorumAsset;
  transactionHash: string;
  transferId: string;
  timestampMs: number;
  role: WalletTransferRole;
  activityType: WalletActivityType;
  amountNative?: number;
  estimatedVolumeUsd?: number;
  tokenAmount?: number;
  tokenSymbol?: string;
  tokenAddress?: string;
  counterpartyAddresses: string[];
}

export interface WalletHistorySyncResult {
  address: string;
  chain: QuorumAsset;
  status: WalletHistorySyncStatus;
  source: string | null;
  coverageFromMs: number | null;
  error?: string | null;
}

interface ProcessedTransfer {
  id: string;
  timestamp_ms: number;
}

interface WhaleAddressStore {
  version: 1;
  updated_at_ms: number | null;
  addresses: WhaleAddressRecord[];
  processed_transfer_ids: ProcessedTransfer[];
  activity_events: WalletActivityEvent[];
}

let storeMutationQueue: Promise<void> = Promise.resolve();

async function withStoreMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = storeMutationQueue;
  let release!: () => void;
  storeMutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAddress(asset: QuorumAsset, address: string): string {
  if (asset === 'ETH' || asset === 'BNB') return address.toLowerCase();
  if (asset === 'BTC' && address.toLowerCase().startsWith('bc1')) return address.toLowerCase();
  return address;
}

function unknownWhaleBehavior(): WhaleBehaviorSummary {
  return { isWhale: false, behaviorTag: 'UNKNOWN', confidenceScore: 0 };
}

function summarizeWhaleBehavior(value: unknown): WhaleBehaviorSummary {
  if (!isRecord(value) ||
      typeof value.analysis_eligible !== 'boolean' ||
      typeof value.is_whale !== 'boolean' ||
      typeof value.behavior_score !== 'number' ||
      !Number.isFinite(value.behavior_score) ||
      !isRecord(value.window_90d) ||
      typeof value.window_90d.incoming_volume !== 'number' ||
      !Number.isFinite(value.window_90d.incoming_volume) ||
      typeof value.window_90d.outgoing_volume !== 'number' ||
      !Number.isFinite(value.window_90d.outgoing_volume) ||
      typeof value.window_90d.unique_counterparty_count !== 'number' ||
      !Number.isFinite(value.window_90d.unique_counterparty_count) ||
      typeof value.window_90d.large_transaction_count !== 'number' ||
      !Number.isFinite(value.window_90d.large_transaction_count)) {
    throw new Error('Stored whale profile has invalid behavioral fields.');
  }
  const isWhale = value.analysis_eligible && value.is_whale &&
    value.window_90d.large_transaction_count >= WALLET_ANALYSIS_ACTIVITY_THRESHOLD &&
    value.known_exchange_address !== true;
  if (!isWhale) return unknownWhaleBehavior();

  const incoming = Math.max(0, value.window_90d.incoming_volume);
  const outgoing = Math.max(0, value.window_90d.outgoing_volume);
  const total = incoming + outgoing;
  const incomingShare = total > 0 ? incoming / total : 0;
  const outgoingShare = total > 0 ? outgoing / total : 0;
  const behaviorTag: WhaleBehaviorTag = incomingShare >= 0.6
    ? 'ACCUMULATOR'
    : outgoingShare >= 0.6
      ? 'DISTRIBUTOR'
      : value.behavior_label === 'TRANSFER_NETWORK' &&
          value.window_90d.unique_counterparty_count >= 5
        ? 'MM'
        : 'UNKNOWN';
  return {
    isWhale: true,
    behaviorTag,
    confidenceScore: Math.max(0, Math.min(1, value.behavior_score / 100)),
  };
}

function walletProfilesFilePath(filePath?: string): string {
  return filePath ??
    process.env.SBK1_WALLET_PROFILES_PATH ??
    process.env.SBK1_WHALE_ADDRESS_FILE ??
    DEFAULT_FILE_PATH;
}

export function getWhaleBehaviors(
  chain: string,
  addresses: readonly string[],
  filePath?: string,
): ReadonlyMap<string, WhaleBehaviorSummary> {
  if (!QUORUM_ASSETS.includes(chain as QuorumAsset)) {
    throw new Error(`Unsupported whale profile chain: ${chain}.`);
  }
  const asset = chain as QuorumAsset;
  const requestedAddresses = [...new Set(addresses.map((address) =>
    normalizeAddress(asset, address)))];
  const behaviors = new Map(requestedAddresses.map((address) =>
    [address, unknownWhaleBehavior()] as const));
  const profilePath = walletProfilesFilePath(filePath);
  if (!/\.(?:sqlite|sqlite3|db)$/i.test(profilePath) || !existsSync(profilePath)) {
    return behaviors;
  }

  const database = new DatabaseSync(profilePath, { readOnly: true });
  try {
    const lookup = database.prepare(
      'SELECT payload FROM wallet_addresses WHERE address_key = ?',
    );
    for (const address of requestedAddresses) {
      const row = lookup.get(`${asset}:${address}`) as { payload: string } | undefined;
      if (row) behaviors.set(address, summarizeWhaleBehavior(JSON.parse(row.payload) as unknown));
    }
  } finally {
    database.close();
  }
  return behaviors;
}

export function getWhaleBehavior(
  address: string,
  chain: string,
  filePath?: string,
): WhaleBehaviorSummary {
  const normalizedAddress = normalizeAddress(chain as QuorumAsset, address);
  return getWhaleBehaviors(chain, [normalizedAddress], filePath).get(normalizedAddress) ??
    unknownWhaleBehavior();
}

function crossAssetAddressGroupId(asset: QuorumAsset, address: string): string {
  if (asset === 'ETH' || asset === 'BNB') return `evm:${address.toLowerCase()}`;
  return `${asset.toLowerCase()}:${normalizeAddress(asset, address)}`;
}

function largeNativeActivityMinimum(asset: QuorumAsset): number {
  const setting = LARGE_NATIVE_ACTIVITY_ENV[asset];
  const raw = setting ? process.env[setting.name]?.trim() : undefined;
  if (!raw) return LARGE_NATIVE_ACTIVITY_MINIMUM[asset];
  const threshold = Number(raw);
  if (!Number.isFinite(threshold) || threshold <= 0 ||
      (setting && threshold > setting.maximum)) {
    throw new Error(`${setting?.name ?? 'Wallet activity threshold'} is invalid.`);
  }
  return threshold;
}

function isLargeActivity(event: WalletActivityEvent): boolean {
  if (event.large_activity === true) return true;
  return (event.activity_type ?? 'NATIVE_TRANSFER') === 'NATIVE_TRANSFER' &&
    event.amount_native !== null &&
    event.amount_native >= largeNativeActivityMinimum(event.chain);
}

function emptyWindow(): WhaleAddressRecord['window_90d'] {
  return {
    transfer_count: 0,
    transaction_count: 0,
    native_volume: 0,
    estimated_volume_usd: 0,
    incoming_volume: 0,
    outgoing_volume: 0,
    exchange_interaction_count: 0,
    unique_counterparty_count: 0,
    active_days: 0,
    history_days_covered: 0,
    token_transfer_count: 0,
    swap_pattern_count: 0,
    dex_order_count: 0,
    large_activity_count: 0,
    large_transaction_count: 0,
    large_native_volume: 0,
    large_estimated_volume_usd: 0,
  };
}

function emptyStore(): WhaleAddressStore {
  return {
    version: 1,
    updated_at_ms: null,
    addresses: [],
    processed_transfer_ids: [],
    activity_events: [],
  };
}

function isLegacyWalletAddress(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    typeof value.address === 'string' && value.address.length > 0 &&
    QUORUM_ASSETS.includes(value.chain as QuorumAsset) &&
    typeof value.first_seen === 'string' && Number.isFinite(Date.parse(value.first_seen)) &&
    typeof value.last_seen === 'string' && Number.isFinite(Date.parse(value.last_seen)) &&
    Number.isSafeInteger(value.tx_count) && (value.tx_count as number) >= 0 &&
    typeof value.total_volume_usd === 'number' && Number.isFinite(value.total_volume_usd) && value.total_volume_usd >= 0 &&
    typeof value.is_whale === 'boolean';
}

function isWalletAddressRecord(value: unknown): value is Record<string, unknown> {
  if (!isLegacyWalletAddress(value)) return false;
  const validDiscoveryTimestamp = value.discovery_started_at === undefined ||
    (typeof value.discovery_started_at === 'string' &&
      Number.isFinite(Date.parse(value.discovery_started_at)));
  const window = value.window_90d;
  const requiredWindowFields = [
    'transfer_count',
    'transaction_count',
    'native_volume',
    'estimated_volume_usd',
    'incoming_volume',
    'outgoing_volume',
    'exchange_interaction_count',
    'unique_counterparty_count',
    'active_days',
    'history_days_covered',
  ];
  const optionalWindowFields = [
    'token_transfer_count',
    'swap_pattern_count',
    'dex_order_count',
    'large_activity_count',
    'large_transaction_count',
    'large_native_volume',
    'large_estimated_volume_usd',
  ];
  const validWindow = window === undefined || (
    isRecord(window) &&
    requiredWindowFields.every((field) => typeof window[field] === 'number' &&
      Number.isFinite(window[field]) && (window[field] as number) >= 0) &&
    optionalWindowFields.every((field) => window[field] === undefined ||
      (typeof window[field] === 'number' && Number.isFinite(window[field]) &&
        (window[field] as number) >= 0))
  );
  const validNames = value.exchange_names === undefined ||
    (Array.isArray(value.exchange_names) && value.exchange_names.every((name) =>
      typeof name === 'string' && name.length > 0));
  return validDiscoveryTimestamp &&
    (value.last_large_activity_at === undefined ||
      (typeof value.last_large_activity_at === 'string' &&
        Number.isFinite(Date.parse(value.last_large_activity_at)))) &&
    (value.activity_status === undefined ||
      ['ACTIVE', 'INACTIVE'].includes(String(value.activity_status))) &&
    (value.analysis_activity_count === undefined ||
      (Number.isSafeInteger(value.analysis_activity_count) &&
        (value.analysis_activity_count as number) >= 0 &&
        (value.analysis_activity_count as number) <= WALLET_ANALYSIS_ACTIVITY_THRESHOLD)) &&
    (value.analysis_eligible === undefined || typeof value.analysis_eligible === 'boolean') &&
    validWindow &&
    (value.behavior_score === undefined ||
      (typeof value.behavior_score === 'number' && Number.isFinite(value.behavior_score) &&
        value.behavior_score >= 0 && value.behavior_score <= 100)) &&
    (value.behavior_label === undefined ||
      ['INSUFFICIENT_ACTIVITY', 'EXCHANGE_FLOW', 'TRANSFER_NETWORK', 'TRANSFER_ACTIVITY']
        .includes(String(value.behavior_label))) &&
    (value.trading_behavior === undefined ||
      ['UNOBSERVED', 'SWAP_PATTERN_OBSERVED'].includes(String(value.trading_behavior))) &&
    (value.history_sync_status === undefined ||
      ['PENDING', 'COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(String(value.history_sync_status))) &&
    (value.history_source === undefined || value.history_source === null ||
      typeof value.history_source === 'string') &&
    (value.history_synced_at === undefined || value.history_synced_at === null ||
      (typeof value.history_synced_at === 'string' &&
        Number.isFinite(Date.parse(value.history_synced_at)))) &&
    (value.history_coverage_from === undefined || value.history_coverage_from === null ||
      (typeof value.history_coverage_from === 'string' &&
        Number.isFinite(Date.parse(value.history_coverage_from)))) &&
    (value.history_error === undefined || value.history_error === null ||
      typeof value.history_error === 'string') &&
    (value.known_exchange_address === undefined || typeof value.known_exchange_address === 'boolean') &&
    validNames &&
    (value.data_scope === undefined ||
      value.data_scope === 'CONFIRMED_LARGE_NATIVE_TRANSFERS' ||
      value.data_scope === 'CONFIRMED_CHAIN_ACTIVITY');
}

function isWalletEvent(value: unknown): value is WalletActivityEvent {
  return isRecord(value) &&
    typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.address === 'string' && value.address.length > 0 &&
    QUORUM_ASSETS.includes(value.chain as QuorumAsset) &&
    typeof value.transaction_hash === 'string' && value.transaction_hash.length > 0 &&
    typeof value.transfer_id === 'string' && value.transfer_id.length > 0 &&
    Number.isSafeInteger(value.timestamp_ms) && (value.timestamp_ms as number) > 0 &&
    ['INCOMING', 'OUTGOING', 'SELF', 'PARTICIPANT'].includes(String(value.role)) &&
    (value.amount_native === null ||
      (typeof value.amount_native === 'number' && Number.isFinite(value.amount_native) &&
        value.amount_native > 0)) &&
    (value.amount_native !== null ||
      ['TOKEN_TRANSFER', 'SWAP_PATTERN', 'DEX_ORDER', 'CONTRACT_INTERACTION']
        .includes(String(value.activity_type))) &&
    (value.activity_type === undefined ||
      ['NATIVE_TRANSFER', 'TOKEN_TRANSFER', 'SWAP_PATTERN', 'DEX_ORDER', 'CONTRACT_INTERACTION']
        .includes(String(value.activity_type))) &&
    (value.large_activity === undefined || typeof value.large_activity === 'boolean') &&
    (value.token_amount === undefined ||
      (typeof value.token_amount === 'number' && Number.isFinite(value.token_amount) &&
        value.token_amount > 0)) &&
    (value.token_symbol === undefined || typeof value.token_symbol === 'string') &&
    (value.token_address === undefined || typeof value.token_address === 'string') &&
    (value.estimated_volume_usd === null ||
      (typeof value.estimated_volume_usd === 'number' &&
        Number.isFinite(value.estimated_volume_usd) && value.estimated_volume_usd > 0)) &&
    Array.isArray(value.counterparty_addresses) &&
    value.counterparty_addresses.every((address) => typeof address === 'string' && address.length > 0) &&
    Array.isArray(value.exchange_counterparties) &&
    value.exchange_counterparties.every((exchange) => typeof exchange === 'string' && exchange.length > 0);
}

function parseStore(value: unknown): WhaleAddressStore {
  if (!isRecord(value) || value.version !== 1 ||
      !Array.isArray(value.addresses) || !Array.isArray(value.processed_transfer_ids) ||
      (value.activity_events !== undefined && !Array.isArray(value.activity_events)) ||
      (value.updated_at_ms !== undefined &&
        value.updated_at_ms !== null &&
        (!Number.isSafeInteger(value.updated_at_ms) || (value.updated_at_ms as number) <= 0))) {
    throw new Error('Wallet profile registry has an unsupported or malformed structure.');
  }
  if (!value.addresses.every(isWalletAddressRecord)) {
    throw new Error('Wallet profile registry contains invalid address records.');
  }
  const validProcessedIds = value.processed_transfer_ids.every((item) =>
    isRecord(item) && typeof item.id === 'string' && item.id.length > 0 &&
    Number.isSafeInteger(item.timestamp_ms) && (item.timestamp_ms as number) > 0
  );
  const activityEvents = Array.isArray(value.activity_events) ? value.activity_events : [];
  if (!validProcessedIds || !activityEvents.every(isWalletEvent)) {
    throw new Error('Wallet profile registry contains invalid activity events.');
  }
  const addresses = value.addresses.map((item) => {
    const record = item as unknown as Partial<WhaleAddressRecord>;
    return {
      ...(item as unknown as WhaleAddressRecord),
      discovery_started_at: record.discovery_started_at ?? record.first_seen,
      analysis_activity_count: Number.isSafeInteger(record.analysis_activity_count)
        ? record.analysis_activity_count!
        : Math.min(WALLET_ANALYSIS_ACTIVITY_THRESHOLD, record.tx_count ?? 0),
      analysis_eligible: record.analysis_eligible ??
        (record.tx_count ?? 0) >= WALLET_ANALYSIS_ACTIVITY_THRESHOLD,
      window_90d: { ...emptyWindow(), ...(record.window_90d ?? {}) },
      last_large_activity_at: record.last_large_activity_at ?? record.last_seen,
      activity_status: record.activity_status === 'INACTIVE' ? 'INACTIVE' as const : 'ACTIVE' as const,
      cross_asset_address_group_id: record.cross_asset_address_group_id ??
        crossAssetAddressGroupId(record.chain, record.address),
      related_assets: Array.isArray(record.related_assets)
        ? record.related_assets
        : [record.chain],
      behavior_score: Number.isFinite(record.behavior_score) ? record.behavior_score! : 0,
      behavior_label: record.behavior_label ?? 'INSUFFICIENT_ACTIVITY',
      trading_behavior: record.trading_behavior === 'SWAP_PATTERN_OBSERVED'
        ? 'SWAP_PATTERN_OBSERVED' as const
        : 'UNOBSERVED' as const,
      history_sync_status: record.history_sync_status ?? 'PENDING',
      history_source: record.history_source ?? null,
      history_synced_at: record.history_synced_at ?? null,
      history_coverage_from: record.history_coverage_from ?? null,
      history_error: record.history_error ?? null,
      known_exchange_address: record.known_exchange_address ?? false,
      exchange_names: Array.isArray(record.exchange_names) ? record.exchange_names : [],
      data_scope: record.data_scope ?? 'CONFIRMED_LARGE_NATIVE_TRANSFERS',
    };
  });
  return {
    version: 1,
    updated_at_ms: typeof value.updated_at_ms === 'number' ? value.updated_at_ms : null,
    addresses,
    processed_transfer_ids: value.processed_transfer_ids as ProcessedTransfer[],
    activity_events: activityEvents as WalletActivityEvent[],
  };
}

async function loadStore(filePath: string): Promise<WhaleAddressStore> {
  if (/\.(?:sqlite|sqlite3|db)$/i.test(filePath)) {
    return loadSqliteStore(filePath);
  }
  try {
    return parseStore(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

function openWalletProfileDatabase(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS wallet_addresses (
      address_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_activity_events (
      event_id TEXT PRIMARY KEY,
      address_key TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wallet_activity_by_address_time
      ON wallet_activity_events(address_key, timestamp_ms DESC);
    CREATE INDEX IF NOT EXISTS wallet_activity_by_time
      ON wallet_activity_events(timestamp_ms);
    CREATE TABLE IF NOT EXISTS wallet_processed_transfers (
      event_id TEXT PRIMARY KEY,
      timestamp_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_profile_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return database;
}

async function saveSqliteStore(filePath: string, store: WhaleAddressStore): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const database = openWalletProfileDatabase(filePath);
  try {
    database.exec('BEGIN IMMEDIATE');
    database.exec(`
      DELETE FROM wallet_addresses;
      DELETE FROM wallet_activity_events;
      DELETE FROM wallet_processed_transfers;
      DELETE FROM wallet_profile_metadata;
    `);
    const insertAddress = database.prepare(
      'INSERT INTO wallet_addresses(address_key, payload) VALUES (?, ?)',
    );
    for (const address of store.addresses) {
      insertAddress.run(
        `${address.chain}:${normalizeAddress(address.chain, address.address)}`,
        JSON.stringify(address),
      );
    }
    const insertEvent = database.prepare(
      'INSERT INTO wallet_activity_events(event_id, address_key, timestamp_ms, payload) VALUES (?, ?, ?, ?)',
    );
    for (const event of store.activity_events) {
      insertEvent.run(
        event.id,
        `${event.chain}:${normalizeAddress(event.chain, event.address)}`,
        event.timestamp_ms,
        JSON.stringify(event),
      );
    }
    const insertProcessed = database.prepare(
      'INSERT INTO wallet_processed_transfers(event_id, timestamp_ms) VALUES (?, ?)',
    );
    for (const event of store.processed_transfer_ids) {
      insertProcessed.run(event.id, event.timestamp_ms);
    }
    if (store.updated_at_ms !== null) {
      database.prepare(
        "INSERT INTO wallet_profile_metadata(key, value) VALUES ('updated_at_ms', ?)",
      ).run(String(store.updated_at_ms));
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

async function loadSqliteStore(filePath: string): Promise<WhaleAddressStore> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let database = openWalletProfileDatabase(filePath);
  const addressCount = database.prepare('SELECT COUNT(*) AS count FROM wallet_addresses')
    .get() as { count: number };
  if (addressCount.count === 0) {
    database.close();
    const legacyPath = filePath.replace(/\.(?:sqlite|sqlite3|db)$/i, '.json');
    let legacyStore = emptyStore();
    try {
      legacyStore = parseStore(JSON.parse(await readFile(legacyPath, 'utf8')) as unknown);
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error;
    }
    if (legacyStore.addresses.length > 0 || legacyStore.activity_events.length > 0 ||
        legacyStore.processed_transfer_ids.length > 0 || legacyStore.updated_at_ms !== null) {
      await saveSqliteStore(filePath, legacyStore);
    }
    database = openWalletProfileDatabase(filePath);
  }
  try {
    const addresses = database.prepare('SELECT payload FROM wallet_addresses')
      .all() as Array<{ payload: string }>;
    const events = database.prepare('SELECT payload FROM wallet_activity_events')
      .all() as Array<{ payload: string }>;
    const processed = database.prepare('SELECT event_id, timestamp_ms FROM wallet_processed_transfers')
      .all() as Array<{ event_id: string; timestamp_ms: number }>;
    const metadata = database.prepare(
      "SELECT value FROM wallet_profile_metadata WHERE key = 'updated_at_ms'",
    ).get() as { value: string } | undefined;
    return parseStore({
      version: 1,
      updated_at_ms: metadata?.value === undefined ? null : Number(metadata.value),
      addresses: addresses.map(({ payload }) => JSON.parse(payload) as unknown),
      activity_events: events.map(({ payload }) => JSON.parse(payload) as unknown),
      processed_transfer_ids: processed.map(({ event_id, timestamp_ms }) => ({
        id: event_id,
        timestamp_ms,
      })),
    });
  } finally {
    database.close();
  }
}

export async function readWalletProfilesDueForHistory(options: {
  nowMs?: number;
  limit?: number;
  filePath?: string;
} = {}): Promise<WhaleAddressRecord[]> {
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? 3;
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('Wallet history scheduling settings are invalid.');
  }
  const filePath = options.filePath ??
    process.env.SBK1_WALLET_PROFILES_PATH ??
    process.env.SBK1_WHALE_ADDRESS_FILE ??
    DEFAULT_FILE_PATH;
  const store = await loadStore(filePath);
  return store.addresses
    .filter((record) => {
      if (record.history_sync_status === 'PENDING' || record.history_synced_at === null) return true;
      const lastSyncedMs = Date.parse(record.history_synced_at);
      const interval = record.history_sync_status === 'COMPLETE'
        ? 6 * 60 * 60_000
        : 24 * 60 * 60_000;
      return nowMs - lastSyncedMs >= interval;
    })
    .sort((left, right) =>
      (left.history_synced_at === null ? 0 : Date.parse(left.history_synced_at)) -
        (right.history_synced_at === null ? 0 : Date.parse(right.history_synced_at)) ||
      left.chain.localeCompare(right.chain) ||
      left.address.localeCompare(right.address))
    .slice(0, limit);
}

async function saveStore(filePath: string, store: WhaleAddressStore): Promise<void> {
  if (/\.(?:sqlite|sqlite3|db)$/i.test(filePath)) {
    await saveSqliteStore(filePath, store);
    return;
  }
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
}

function deriveProfile(
  address: string,
  chain: QuorumAsset,
  events: readonly WalletActivityEvent[],
  knownExchange: ExchangeAddressRecord | undefined,
): WhaleAddressRecord {
  const largeEvents = events.filter(isLargeActivity);
  const transactionHashes = new Set(largeEvents.map(({ transaction_hash }) => transaction_hash));
  const counterparties = new Set(largeEvents.flatMap(({ counterparty_addresses }) => counterparty_addresses));
  const activeDays = new Set(largeEvents.map(({ timestamp_ms }) =>
    new Date(timestamp_ms).toISOString().slice(0, 10)));
  const incoming = largeEvents
    .filter(({ role }) => role === 'INCOMING')
    .reduce((sum, { amount_native }) => sum + (amount_native ?? 0), 0);
  const outgoing = largeEvents
    .filter(({ role }) => role === 'OUTGOING')
    .reduce((sum, { amount_native }) => sum + (amount_native ?? 0), 0);
  const nativeVolume = largeEvents.reduce((sum, { amount_native }) => sum + (amount_native ?? 0), 0);
  const tokenTransferCount = events.filter(({ activity_type }) =>
    activity_type === 'TOKEN_TRANSFER').length;
  const swapPatternCount = events.filter(({ activity_type }) =>
    activity_type === 'SWAP_PATTERN').length;
  const dexOrderCount = events.filter(({ activity_type }) =>
    activity_type === 'DEX_ORDER').length;
  const estimatedVolumeUsd = largeEvents.reduce((sum, { estimated_volume_usd }) =>
    sum + (estimated_volume_usd ?? 0), 0);
  const exchangeInteractionCount = largeEvents.filter(({ exchange_counterparties }) =>
    exchange_counterparties.length > 0).length;
  const firstSeenMs = events.reduce(
    (first, { timestamp_ms }) => Math.min(first, timestamp_ms),
    Number.POSITIVE_INFINITY,
  );
  const lastSeenMs = events.reduce(
    (last, { timestamp_ms }) => Math.max(last, timestamp_ms),
    0,
  );
  const historyDaysCovered = events.length === 0
    ? 0
    : Math.min(90, Math.max(1, Math.floor((lastSeenMs - firstSeenMs) / 86_400_000) + 1));
  const transactionCount = transactionHashes.size;
  const score = Math.min(30, transactionCount * 2) +
    Math.min(30, Math.log10(estimatedVolumeUsd + 1) * 5) +
    Math.min(25, counterparties.size * 2.5) +
    Math.min(15, activeDays.size / 90 * 15);
  const behaviorScore = Math.round(score);
  const behaviorLabel: WalletBehaviorLabel = largeEvents.length < 3
    ? 'INSUFFICIENT_ACTIVITY'
    : knownExchange !== undefined || exchangeInteractionCount / largeEvents.length >= 0.5
      ? 'EXCHANGE_FLOW'
      : counterparties.size >= 5 && transactionCount >= 5
        ? 'TRANSFER_NETWORK'
        : 'TRANSFER_ACTIVITY';
  return {
    address,
    chain,
    discovery_started_at: new Date(firstSeenMs).toISOString(),
    first_seen: new Date(firstSeenMs).toISOString(),
    last_seen: new Date(lastSeenMs).toISOString(),
    last_large_activity_at: new Date(largeEvents.reduce(
      (last, { timestamp_ms }) => Math.max(last, timestamp_ms),
      0,
    ) || firstSeenMs).toISOString(),
    activity_status: 'ACTIVE',
    analysis_activity_count: Math.min(WALLET_ANALYSIS_ACTIVITY_THRESHOLD, transactionCount),
    analysis_eligible: transactionCount >= WALLET_ANALYSIS_ACTIVITY_THRESHOLD,
    tx_count: transactionCount,
    total_volume_usd: estimatedVolumeUsd,
    is_whale: transactionCount >= WALLET_ANALYSIS_ACTIVITY_THRESHOLD,
    window_90d: {
      transfer_count: events.length,
      transaction_count: transactionCount,
      native_volume: nativeVolume,
      estimated_volume_usd: estimatedVolumeUsd,
      incoming_volume: incoming,
      outgoing_volume: outgoing,
      exchange_interaction_count: exchangeInteractionCount,
      unique_counterparty_count: counterparties.size,
      active_days: activeDays.size,
      history_days_covered: historyDaysCovered,
      token_transfer_count: tokenTransferCount,
      swap_pattern_count: swapPatternCount,
      dex_order_count: dexOrderCount,
      large_activity_count: largeEvents.length,
      large_transaction_count: transactionCount,
      large_native_volume: nativeVolume,
      large_estimated_volume_usd: estimatedVolumeUsd,
    },
    behavior_score: behaviorScore,
    behavior_label: behaviorLabel,
    trading_behavior: largeEvents.some(({ activity_type }) =>
      activity_type === 'SWAP_PATTERN') ? 'SWAP_PATTERN_OBSERVED' : 'UNOBSERVED',
    history_sync_status: 'PENDING',
    history_source: null,
    history_synced_at: null,
    history_coverage_from: null,
    history_error: null,
    known_exchange_address: knownExchange !== undefined,
    exchange_names: knownExchange ? [knownExchange.exchange] : [],
    data_scope: 'CONFIRMED_CHAIN_ACTIVITY',
    cross_asset_address_group_id: crossAssetAddressGroupId(chain, address),
    related_assets: [chain],
  };
}

async function ingestWalletHistoryUnlocked(options: {
  activities: readonly WalletHistoryActivity[];
  syncResults: readonly WalletHistorySyncResult[];
  nowMs?: number;
  filePath?: string;
}): Promise<{ newEvents: number; updatedProfiles: number }> {
  const nowMs = options.nowMs ?? Date.now();
  const filePath = options.filePath ??
    process.env.SBK1_WALLET_PROFILES_PATH ??
    process.env.SBK1_WHALE_ADDRESS_FILE ??
    DEFAULT_FILE_PATH;
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error('Wallet history ingestion timestamp is invalid.');
  }
  const store = await loadStore(filePath);
  const cutoffMs = nowMs - PROFILE_WINDOW_MS;
  const eventsById = new Map(store.activity_events
    .filter(({ timestamp_ms }) => timestamp_ms >= cutoffMs && timestamp_ms <= nowMs)
    .map((event) => [event.id, event]));
  const records = new Map(store.addresses.map((record) =>
    [`${record.chain}:${normalizeAddress(record.chain, record.address)}`, record]));
  const largeTransactionKeys = new Set(options.activities
    .filter((activity) =>
      QUORUM_ASSETS.includes(activity.chain) &&
      activity.activityType === 'NATIVE_TRANSFER' &&
      typeof activity.address === 'string' &&
      typeof activity.transactionHash === 'string' &&
      Number.isSafeInteger(activity.timestampMs) &&
      activity.timestampMs >= cutoffMs &&
      activity.timestampMs <= nowMs &&
      typeof activity.amountNative === 'number' &&
      Number.isFinite(activity.amountNative) &&
      activity.amountNative >= largeNativeActivityMinimum(activity.chain))
    .map((activity) => {
      const txHash = activity.chain === 'SOL'
        ? activity.transactionHash
        : activity.transactionHash.toLowerCase();
      return `${activity.chain}:${normalizeAddress(activity.chain, activity.address)}:${txHash}:${activity.timestampMs}`;
    }));
  let newEvents = 0;
  for (const activity of options.activities) {
    if (!QUORUM_ASSETS.includes(activity.chain) ||
        typeof activity.address !== 'string' || activity.address.trim().length === 0 ||
        typeof activity.transactionHash !== 'string' || activity.transactionHash.length === 0 ||
        typeof activity.transferId !== 'string' || activity.transferId.length === 0 ||
        !Number.isSafeInteger(activity.timestampMs) || activity.timestampMs < cutoffMs ||
        activity.timestampMs > nowMs ||
        !['INCOMING', 'OUTGOING', 'SELF', 'PARTICIPANT'].includes(activity.role) ||
        !['NATIVE_TRANSFER', 'TOKEN_TRANSFER', 'SWAP_PATTERN', 'DEX_ORDER', 'CONTRACT_INTERACTION']
          .includes(activity.activityType) ||
        (activity.amountNative !== undefined &&
          (!Number.isFinite(activity.amountNative) || activity.amountNative <= 0)) ||
        (activity.tokenAmount !== undefined &&
          (!Number.isFinite(activity.tokenAmount) || activity.tokenAmount <= 0)) ||
        (activity.estimatedVolumeUsd !== undefined &&
          (!Number.isFinite(activity.estimatedVolumeUsd) || activity.estimatedVolumeUsd < 0)) ||
        (activity.tokenSymbol !== undefined && typeof activity.tokenSymbol !== 'string') ||
        (activity.tokenAddress !== undefined && typeof activity.tokenAddress !== 'string')) {
      continue;
    }
    const address = normalizeAddress(activity.chain, activity.address);
    const key = `${activity.chain}:${address}`;
    if (!records.has(key)) continue;
    const transactionHash = activity.chain === 'SOL'
      ? activity.transactionHash
      : activity.transactionHash.toLowerCase();
    const eventId = `${key}:${transactionHash}:${activity.transferId}`;
    if (eventsById.has(eventId)) continue;
    const counterpartyAddresses = [...new Set(activity.counterpartyAddresses
      .filter((counterparty) => typeof counterparty === 'string' && counterparty.trim().length > 0)
      .map((counterparty) => normalizeAddress(activity.chain, counterparty))
      .filter((counterparty) => counterparty !== address))];
    eventsById.set(eventId, {
      id: eventId,
      address,
      chain: activity.chain,
      transaction_hash: transactionHash,
      transfer_id: activity.transferId,
      timestamp_ms: activity.timestampMs,
      role: activity.role,
      amount_native: activity.amountNative ?? null,
      estimated_volume_usd: activity.estimatedVolumeUsd ?? null,
      activity_type: activity.activityType,
      large_activity: largeTransactionKeys.has(
        `${activity.chain}:${address}:${transactionHash}:${activity.timestampMs}`,
      ),
      ...(activity.tokenAmount !== undefined ? { token_amount: activity.tokenAmount } : {}),
      ...(activity.tokenSymbol !== undefined ? { token_symbol: activity.tokenSymbol } : {}),
      ...(activity.tokenAddress !== undefined ? { token_address: activity.tokenAddress } : {}),
      counterparty_addresses: counterpartyAddresses,
      exchange_counterparties: [],
    });
    newEvents += 1;
  }
  const syncedAt = new Date(nowMs).toISOString();
  for (const result of options.syncResults) {
    const key = `${result.chain}:${normalizeAddress(result.chain, result.address)}`;
    const record = records.get(key);
    if (!record) continue;
    record.history_sync_status = result.status;
    record.history_source = result.source;
    record.history_synced_at = syncedAt;
    record.history_coverage_from = result.status === 'COMPLETE' &&
      record.history_coverage_from !== null
      ? record.history_coverage_from
      : result.coverageFromMs === null
        ? null
        : new Date(result.coverageFromMs).toISOString();
    record.history_error = result.error ?? null;
  }
  const eventsByAddress = new Map<string, WalletActivityEvent[]>();
  for (const event of eventsById.values()) {
    const key = `${event.chain}:${normalizeAddress(event.chain, event.address)}`;
    eventsByAddress.set(key, [...(eventsByAddress.get(key) ?? []), event]);
  }
  for (const [key, record] of records) {
    const events = eventsByAddress.get(key) ?? [];
    if (events.length === 0) continue;
    const profile = deriveProfile(record.address, record.chain, events, undefined);
    record.first_seen = Date.parse(record.first_seen) <= Date.parse(profile.first_seen)
      ? record.first_seen
      : profile.first_seen;
    record.last_seen = Date.parse(record.last_seen) >= Date.parse(profile.last_seen)
      ? record.last_seen
      : profile.last_seen;
    const largeEvents = events.filter(isLargeActivity);
    if (largeEvents.length > 0) {
      record.last_large_activity_at = new Date(Math.max(
        Date.parse(record.last_large_activity_at),
        ...largeEvents.map(({ timestamp_ms }) => timestamp_ms),
      )).toISOString();
    }
    record.analysis_activity_count = Math.min(
      WALLET_ANALYSIS_ACTIVITY_THRESHOLD,
      profile.window_90d.large_transaction_count,
    );
    record.analysis_eligible = record.analysis_eligible ||
      profile.window_90d.large_transaction_count >= WALLET_ANALYSIS_ACTIVITY_THRESHOLD;
    record.tx_count = profile.window_90d.large_transaction_count;
    record.total_volume_usd = profile.window_90d.estimated_volume_usd;
    record.is_whale = record.analysis_eligible;
    record.window_90d = profile.window_90d;
    record.behavior_score = profile.behavior_score;
    record.activity_status = nowMs - Date.parse(record.last_large_activity_at) >=
      INACTIVE_PROFILE_STATUS_MS ? 'INACTIVE' : 'ACTIVE';
    record.behavior_label = record.known_exchange_address
      ? 'EXCHANGE_FLOW'
      : profile.behavior_label;
    record.trading_behavior = profile.trading_behavior;
    record.data_scope = 'CONFIRMED_CHAIN_ACTIVITY';
  }
  const retainedAddressKeys = new Set(records.keys());
  for (const [eventId, event] of eventsById) {
    const key = `${event.chain}:${normalizeAddress(event.chain, event.address)}`;
    if (!retainedAddressKeys.has(key)) eventsById.delete(eventId);
  }
  store.addresses = [...records.values()].sort((left, right) =>
    left.chain.localeCompare(right.chain) || left.address.localeCompare(right.address));
  store.activity_events = [...eventsById.values()].sort((left, right) =>
    left.timestamp_ms - right.timestamp_ms);
  store.updated_at_ms = nowMs;
  await saveStore(filePath, store);
  return { newEvents, updatedProfiles: options.syncResults.length };
}

export async function ingestWalletHistory(options: {
  activities: readonly WalletHistoryActivity[];
  syncResults: readonly WalletHistorySyncResult[];
  nowMs?: number;
  filePath?: string;
}): Promise<{ newEvents: number; updatedProfiles: number }> {
  return withStoreMutationLock(() => ingestWalletHistoryUnlocked(options));
}

export async function readWalletProfileSnapshot(options: {
  filePath?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{
  updatedAtMs: number | null;
  totalWallets: number;
  wallets: Array<WhaleAddressRecord & { recent_activity: WalletActivitySnapshot[] }>;
}> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Wallet profile pagination settings are invalid.');
  }
  const filePath = options.filePath ??
    process.env.SBK1_WALLET_PROFILES_PATH ??
    process.env.SBK1_WHALE_ADDRESS_FILE ??
    DEFAULT_FILE_PATH;
  const store = await loadStore(filePath);
  const sortedWallets = [...store.addresses].sort((left, right) =>
    right.behavior_score - left.behavior_score ||
    right.last_seen.localeCompare(left.last_seen) ||
    left.chain.localeCompare(right.chain) ||
    left.address.localeCompare(right.address));
  const assetsByGroup = new Map<string, Set<QuorumAsset>>();
  for (const profile of store.addresses) {
    const groupId = crossAssetAddressGroupId(profile.chain, profile.address);
    const assets = assetsByGroup.get(groupId) ?? new Set<QuorumAsset>();
    assets.add(profile.chain);
    assetsByGroup.set(groupId, assets);
  }
  return {
    updatedAtMs: store.updated_at_ms,
    totalWallets: sortedWallets.length,
    wallets: sortedWallets.slice(offset, offset + limit).map((profile) => {
      const key = `${profile.chain}:${normalizeAddress(profile.chain, profile.address)}`;
      const recentActivity = store.activity_events
        .filter((event) => `${event.chain}:${normalizeAddress(event.chain, event.address)}` === key)
        .sort((left, right) => right.timestamp_ms - left.timestamp_ms)
        .slice(0, 10)
        .map((event): WalletActivitySnapshot => ({
          transaction_hash: event.transaction_hash,
          timestamp_ms: event.timestamp_ms,
          role: event.role,
          activity_type: event.activity_type ?? 'NATIVE_TRANSFER',
          large_activity: isLargeActivity(event),
          amount_native: event.amount_native,
          ...(event.token_amount !== undefined ? { token_amount: event.token_amount } : {}),
          ...(event.token_symbol !== undefined ? { token_symbol: event.token_symbol } : {}),
          ...(event.token_address !== undefined ? { token_address: event.token_address } : {}),
          counterparty_addresses: event.counterparty_addresses,
        }));
      const groupId = crossAssetAddressGroupId(profile.chain, profile.address);
      return {
        ...profile,
        cross_asset_address_group_id: groupId,
        related_assets: [...(assetsByGroup.get(groupId) ?? new Set([profile.chain]))],
        recent_activity: recentActivity,
      };
    }),
  };
}

async function trackObservedWalletProfilesUnlocked(options: {
  observedTransfers: Readonly<Record<QuorumAsset, readonly QuorumObservedTransfer[]>>;
  exchangeAddresses: readonly ExchangeAddressRecord[];
  pricesUsd: Partial<Record<QuorumAsset, number>>;
  nowMs?: number;
  filePath?: string;
}): Promise<{
  newEvents: number;
  trackedAddresses: number;
  flaggedWhales: number;
  behaviorProfilesUpdated: number;
}> {
  const nowMs = options.nowMs ?? Date.now();
  const filePath = options.filePath ??
    process.env.SBK1_WALLET_PROFILES_PATH ??
    process.env.SBK1_WHALE_ADDRESS_FILE ??
    DEFAULT_FILE_PATH;
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('Wallet profile timestamp is invalid.');
  const store = await loadStore(filePath);
  const cutoffMs = nowMs - PROFILE_WINDOW_MS;
  const eventsById = new Map(
    store.activity_events
      .filter(({ timestamp_ms }) => timestamp_ms >= cutoffMs && timestamp_ms <= nowMs)
      .map((event) => [event.id, event]),
  );
  const records = new Map(store.addresses.map((item) =>
    [`${item.chain}:${normalizeAddress(item.chain, item.address)}`, item]));
  const activityTransactionsByAddress = new Map<string, Set<string>>();
  for (const event of eventsById.values()) {
    const key = `${event.chain}:${normalizeAddress(event.chain, event.address)}`;
    if (isLargeActivity(event)) {
      const transactions = activityTransactionsByAddress.get(key) ?? new Set<string>();
      transactions.add(event.transaction_hash);
      activityTransactionsByAddress.set(key, transactions);
    }
  }
  const exchangeByAddress = new Map(options.exchangeAddresses.map((record) =>
    [`${record.chain}:${normalizeAddress(record.chain, record.address)}`, record]));
  const newEvents: ProcessedTransfer[] = [];

  for (const asset of QUORUM_ASSETS) {
    const price = options.pricesUsd[asset];
    const validPrice = typeof price === 'number' && Number.isFinite(price) && price > 0
      ? price
      : null;
    for (const transfer of options.observedTransfers[asset] ?? []) {
      if (
        transfer.assetSymbol !== asset || transfer.confirmationStatus !== 'CONFIRMED' ||
        !Number.isFinite(transfer.amount) ||
        transfer.amount < largeNativeActivityMinimum(asset) ||
        !Number.isSafeInteger(transfer.timestampMs) ||
        transfer.timestampMs > nowMs || transfer.timestampMs < cutoffMs ||
        typeof transfer.transactionHash !== 'string' || transfer.transactionHash.length === 0 ||
        typeof transfer.transferId !== 'string' || transfer.transferId.length === 0
      ) continue;
      const fromAddresses = [...new Set((transfer.fromAddresses ?? [])
        .filter((address) => typeof address === 'string' && address.trim().length > 0)
        .map((address) => normalizeAddress(asset, address)))];
      const toAddresses = [...new Set((transfer.toAddresses ?? [])
        .filter((address) => typeof address === 'string' && address.trim().length > 0)
        .map((address) => normalizeAddress(asset, address)))];
      const addresses = [...new Set([...fromAddresses, ...toAddresses])];
      const transactionHash = asset === 'SOL'
        ? transfer.transactionHash
        : transfer.transactionHash.toLowerCase();
      const estimatedVolumeUsd = validPrice === null ? null : transfer.amount * validPrice;
      if (estimatedVolumeUsd !== null && !Number.isFinite(estimatedVolumeUsd)) continue;
      const seenAt = new Date(transfer.timestampMs).toISOString();

      for (const address of addresses) {
        const key = `${asset}:${address}`;
        const eventId = `${key}:${transactionHash}:${transfer.transferId}`;
        if (eventsById.has(eventId)) continue;
        const isSender = fromAddresses.includes(address);
        const isRecipient = toAddresses.includes(address);
        const role: WalletTransferRole = isSender && isRecipient
          ? 'SELF'
          : isSender
            ? 'OUTGOING'
            : isRecipient
              ? 'INCOMING'
              : 'PARTICIPANT';
        const counterpartyAddresses = addresses.filter((party) => party !== address);
        const exchangeCounterparties = [...new Set(counterpartyAddresses.flatMap((counterparty) => {
          const exchange = exchangeByAddress.get(`${asset}:${counterparty}`);
          return exchange ? [exchange.exchange] : [];
        }))];
        const event: WalletActivityEvent = {
          id: eventId,
          address,
          chain: asset,
          transaction_hash: transactionHash,
          transfer_id: transfer.transferId,
          timestamp_ms: transfer.timestampMs,
          role,
          amount_native: transfer.amount,
          estimated_volume_usd: estimatedVolumeUsd,
          activity_type: 'NATIVE_TRANSFER',
          large_activity: transfer.amount >= largeNativeActivityMinimum(asset),
          counterparty_addresses: counterpartyAddresses,
          exchange_counterparties: exchangeCounterparties,
        };
        eventsById.set(eventId, event);
        newEvents.push({ id: eventId, timestamp_ms: transfer.timestampMs });
        const previous = records.get(key);
        const activityTransactions = activityTransactionsByAddress.get(key) ?? new Set<string>();
        activityTransactions.add(transactionHash);
        activityTransactionsByAddress.set(key, activityTransactions);
        const discoveryStartedAt = previous?.discovery_started_at ??
          new Date(nowMs).toISOString();
        const analysisActivityCount = Math.min(
          WALLET_ANALYSIS_ACTIVITY_THRESHOLD,
          activityTransactions.size,
        );
        const analysisEligible = previous?.analysis_eligible === true ||
          (analysisActivityCount >= WALLET_ANALYSIS_ACTIVITY_THRESHOLD &&
            nowMs < Date.parse(discoveryStartedAt) + DISCOVERY_RETENTION_MS);
        records.set(key, {
          ...(previous ?? {
            ...deriveProfile(address, asset, [event], exchangeByAddress.get(key)),
            tx_count: 0,
            total_volume_usd: 0,
            is_whale: false,
          }),
          address,
          chain: asset,
          discovery_started_at: discoveryStartedAt,
          analysis_activity_count: analysisActivityCount,
          analysis_eligible: analysisEligible,
          first_seen: previous && Date.parse(previous.first_seen) <= transfer.timestampMs
            ? previous.first_seen
            : seenAt,
          last_seen: previous && Date.parse(previous.last_seen) >= transfer.timestampMs
            ? previous.last_seen
            : seenAt,
          last_large_activity_at: previous && Date.parse(previous.last_large_activity_at) >= transfer.timestampMs
            ? previous.last_large_activity_at
            : seenAt,
          activity_status: 'ACTIVE',
          tx_count: (previous?.tx_count ?? 0) + 1,
          total_volume_usd: (previous?.total_volume_usd ?? 0) + (estimatedVolumeUsd ?? 0),
          is_whale: analysisEligible,
          window_90d: previous?.window_90d ?? emptyWindow(),
          behavior_score: previous?.behavior_score ?? 0,
          behavior_label: previous?.behavior_label ?? 'INSUFFICIENT_ACTIVITY',
          trading_behavior: 'UNOBSERVED',
          history_sync_status: previous?.history_sync_status ?? 'PENDING',
          history_source: previous?.history_source ?? null,
          history_synced_at: previous?.history_synced_at ?? null,
          history_coverage_from: previous?.history_coverage_from ?? null,
          history_error: previous?.history_error ?? null,
          known_exchange_address: exchangeByAddress.has(key),
          exchange_names: exchangeByAddress.has(key)
            ? [exchangeByAddress.get(key)!.exchange]
            : previous?.exchange_names ?? [],
          data_scope: 'CONFIRMED_CHAIN_ACTIVITY',
        });
      }
    }
  }

  for (const [key, record] of records) {
    const largeTransactions = activityTransactionsByAddress.get(key) ?? new Set<string>();
    record.analysis_activity_count = Math.min(
      WALLET_ANALYSIS_ACTIVITY_THRESHOLD,
      largeTransactions.size,
    );
    record.analysis_eligible = record.analysis_eligible ||
      (record.analysis_activity_count >= WALLET_ANALYSIS_ACTIVITY_THRESHOLD &&
        nowMs < Date.parse(record.discovery_started_at) + DISCOVERY_RETENTION_MS);
    record.is_whale = record.analysis_eligible;
    const lastLargeActivityMs = Date.parse(record.last_large_activity_at);
    const discoveryStartedAtMs = Date.parse(record.discovery_started_at);
    const expired = record.analysis_eligible
      ? nowMs - lastLargeActivityMs >= INACTIVE_PROFILE_RETENTION_MS
      : nowMs - discoveryStartedAtMs >= DISCOVERY_RETENTION_MS;
    if (expired) records.delete(key);
    else {
      record.activity_status = nowMs - lastLargeActivityMs >= INACTIVE_PROFILE_STATUS_MS
        ? 'INACTIVE'
        : 'ACTIVE';
    }
  }

  const retainedAddressKeys = new Set(records.keys());
  for (const [eventId, event] of eventsById) {
    const key = `${event.chain}:${normalizeAddress(event.chain, event.address)}`;
    if (!retainedAddressKeys.has(key)) eventsById.delete(eventId);
  }

  const eventsByAddress = new Map<string, WalletActivityEvent[]>();
  for (const event of eventsById.values()) {
    const key = `${event.chain}:${normalizeAddress(event.chain, event.address)}`;
    eventsByAddress.set(key, [...(eventsByAddress.get(key) ?? []), event]);
  }
  for (const [key, record] of records) {
    const events = eventsByAddress.get(key) ?? [];
    if (events.length === 0) {
      records.set(key, {
        ...record,
        tx_count: 0,
        total_volume_usd: 0,
        is_whale: record.analysis_eligible,
        window_90d: emptyWindow(),
        behavior_score: 0,
        behavior_label: 'INSUFFICIENT_ACTIVITY',
        trading_behavior: 'UNOBSERVED',
        known_exchange_address: exchangeByAddress.has(key),
        activity_status: nowMs - Date.parse(record.last_large_activity_at) >=
          INACTIVE_PROFILE_STATUS_MS ? 'INACTIVE' : 'ACTIVE',
      });
      continue;
    }
    const profile = deriveProfile(
      record.address,
      record.chain,
      events,
      exchangeByAddress.get(key),
    );
    records.set(key, {
      ...profile,
      discovery_started_at: record.discovery_started_at,
      analysis_activity_count: record.analysis_activity_count,
      analysis_eligible: record.analysis_eligible,
      last_large_activity_at: record.last_large_activity_at,
      activity_status: nowMs - Date.parse(record.last_large_activity_at) >=
        INACTIVE_PROFILE_STATUS_MS ? 'INACTIVE' : 'ACTIVE',
      is_whale: record.analysis_eligible,
      first_seen: record.first_seen,
      last_seen: record.last_seen,
      tx_count: profile.window_90d.large_transaction_count,
      total_volume_usd: profile.window_90d.estimated_volume_usd,
    });
  }

  store.addresses = [...records.values()].sort((left, right) =>
    left.chain.localeCompare(right.chain) || left.address.localeCompare(right.address));
  store.updated_at_ms = nowMs;
  store.activity_events = [...eventsById.values()].sort((left, right) =>
    left.timestamp_ms - right.timestamp_ms);
  store.processed_transfer_ids = [
    ...new Map([
      ...store.processed_transfer_ids.filter(({ timestamp_ms }) => timestamp_ms >= cutoffMs),
      ...newEvents,
    ].map((event) => [event.id, event])).values(),
  ];

  await saveStore(filePath, store);
  return {
    newEvents: newEvents.length,
    trackedAddresses: store.addresses.length,
    flaggedWhales: store.addresses.filter(({ is_whale }) => is_whale).length,
    behaviorProfilesUpdated: store.addresses.length,
  };
}

export async function trackObservedWalletProfiles(options: {
  observedTransfers: Readonly<Record<QuorumAsset, readonly QuorumObservedTransfer[]>>;
  exchangeAddresses: readonly ExchangeAddressRecord[];
  pricesUsd: Partial<Record<QuorumAsset, number>>;
  nowMs?: number;
  filePath?: string;
}): Promise<{
  newEvents: number;
  trackedAddresses: number;
  flaggedWhales: number;
  behaviorProfilesUpdated: number;
}> {
  return withStoreMutationLock(() => trackObservedWalletProfilesUnlocked(options));
}
