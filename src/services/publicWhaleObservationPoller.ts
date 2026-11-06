import {
  countDistinctWhaleSourceOperators,
  getWhaleSourceOperator,
  loadQuorumCandidateNetworkMetrics,
  QUORUM_ASSETS,
  writeQuorumCandidateSnapshot,
  type QuorumAsset,
  type QuorumCandidateRecord,
  type QuorumObservedTransfer,
  type QuorumAggregateExchangeFlowObservation,
  type QuorumAssetPollDiagnosticsInput,
} from './whaleConsensusCandidateRegistry';
import {
  getMember6BlockRange,
  loadMember6BlockCursorStore,
  writeMember6BlockCursorStore,
  type Member6BlockCursorStore,
} from './member6BlockCursor';
import {
  classifyExchangeTransfer,
  createAttributedQuorumCandidate,
  findHighConfidenceExchangeAddress,
  loadExchangeAddressRegistry,
} from './exchangeAddressRegistry';
import {
  getWhaleBehaviors,
  trackObservedWalletProfiles,
  type WhaleBehaviorSummary,
} from './whaleAddressTracker';
import { syncPublicWalletHistories } from './publicWalletHistory';

const BTC_MIN_TRANSFER = 10;
const ETH_MIN_TRANSFER = 100;
const BNB_MIN_TRANSFER = 1_000;
const SOL_MIN_TRANSFER = 1_000;
const XRP_MIN_TRANSFER = 1_000_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const FEE_SPIKE_MIN_SAMPLES = 10;
const FEE_SPIKE_MIN_SPAN_MS = 10 * 60_000;
const FEE_SPIKE_MAX_SAMPLE_AGE_MS = 30 * 60_000;
const FEE_SPIKE_MIN_RATIO = 2;
const WALLET_HISTORY_SYNC_INTERVAL_MS = 5 * 60_000;
const MEMBER6_CANDLE_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_BOOTSTRAP_BLOCKS = 12;
export const MAX_BOOTSTRAP_BLOCKS = 24;
const XRP_EPOCH_SECONDS = 946_684_800;
const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const SOLANA_MAX_SUPPORTED_TRANSACTION_VERSION = 1;

export const ONCHAIN_SOURCE_CONFIG = {
  requestTimeoutMs: 5_000,
  solanaWeb3CdnBlockTimeoutMs: 15_000,
  healthPingAttempts: 5,
  healthPingTimeoutMs: 5_000,
  healthyPingAverageBelowMs: 3_000,
  healthyPingMaxMs: 5_000,
  maxScanCycleMs: 300_000,
  circuitBreakerFailureCount: 3,
  circuitBreakerCooldownMs: 5 * 60_000,
  maxConcurrentRequests: 4,
  rateLimitBackoffBaseMs: 60_000,
  rateLimitBackoffMaxMs: 15 * 60_000,
  rateLimitBackoffMinimumMs: 1_000,
  requestRetryBaseMs: 500,
  requestRetryMaxMs: 5_000,
  requestRetryJitterMs: 250,
  maxBtcTransactionPages: 4_096,
  maxBlockHeightLag: 3,
  maxSolanaSlotLag: 150,
  maxXrpLedgerLag: 3,
  maxHistoricalBlockAgeMs: 90 * 24 * 60 * 60_000,
  maxPriceAgeMs: 5 * 60_000,
  pollIntervalMs: 60_000,
} as const;

interface ProviderEndpoint {
  sourceId: string;
  operatorId: string | null;
  independent: boolean;
  urls: string[];
  timeoutMs?: number;
  blockTimeoutMs?: number;
}

export interface PublicWhaleSource extends ProviderEndpoint {
  asset: QuorumAsset;
}

interface BtcBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
}

interface BtcTransaction {
  txid: string;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: Array<{ prevout?: { scriptpubkey_address?: string } }>;
  vout: Array<{ value: number; scriptpubkey_address?: string }>;
}

export function isUnambiguousBtcTransfer(
  transaction: BtcTransaction,
  matchingTransaction: BtcTransaction,
): boolean {
  return transaction.vin.length === 1 &&
    transaction.vout.length === 1 &&
    matchingTransaction.vin.length === 1 &&
    matchingTransaction.vout.length === 1 &&
    transaction.vout[0]?.value === matchingTransaction.vout[0]?.value &&
    typeof transaction.vin[0]?.prevout?.scriptpubkey_address === 'string' &&
    transaction.vin[0].prevout.scriptpubkey_address ===
      matchingTransaction.vin[0]?.prevout?.scriptpubkey_address &&
    typeof transaction.vout[0]?.scriptpubkey_address === 'string' &&
    transaction.vout[0].scriptpubkey_address ===
      matchingTransaction.vout[0]?.scriptpubkey_address;
}

interface EvmBlock {
  number: string;
  hash: string;
  timestamp: string;
  transactions: Array<{ hash: string; value: string; from?: string; to?: string | null }>;
}

interface SolanaBlock {
  blockhash: string;
  blockTime: number | null;
  transactions: Array<{
    transaction: { signatures: string[]; message: { instructions: unknown[] } };
    meta: { err: unknown };
  }>;
}

interface XrpLedger {
  ledger_hash: string;
  ledger_index: number | string;
  close_time: number;
  transactions: Array<{
    hash: string;
    TransactionType?: string;
    Account?: string;
    Destination?: string;
    Amount?: string | { value?: string; currency?: string; issuer?: string };
    meta?: { TransactionResult?: string; delivered_amount?: string };
    metaData?: { TransactionResult?: string; delivered_amount?: string };
    tx?: {
      TransactionType?: string;
      Account?: string;
      Destination?: string;
      Amount?: string | { value?: string; currency?: string; issuer?: string };
    };
    tx_json?: {
      TransactionType?: string;
      Account?: string;
      Destination?: string;
      Amount?: string | { value?: string; currency?: string; issuer?: string };
      meta?: { TransactionResult?: string; delivered_amount?: string };
    };
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isAllowedPublicEndpointUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !/(?:devnet|testnet)/i.test(value);
  } catch {
    return false;
  }
}

export function isHealthySourcePingSet(latenciesMs: readonly number[]): boolean {
  return latenciesMs.length === ONCHAIN_SOURCE_CONFIG.healthPingAttempts &&
    latenciesMs.every((latency) =>
      Number.isFinite(latency) && latency >= 0 && latency <= ONCHAIN_SOURCE_CONFIG.healthyPingMaxMs) &&
    latenciesMs.reduce((sum, latency) => sum + latency, 0) / latenciesMs.length <
      ONCHAIN_SOURCE_CONFIG.healthyPingAverageBelowMs;
}

export function isValidSolanaMainnetGenesisHash(value: unknown): boolean {
  return value === SOLANA_MAINNET_GENESIS_HASH;
}

export function isValidXrpMainnetNetworkId(value: unknown): boolean {
  return value === 0 || value === '0';
}

export function buildSolanaGetBlockParams(slot: number): unknown[] {
  return [slot, {
    commitment: 'finalized',
    encoding: 'jsonParsed',
    transactionDetails: 'full',
    rewards: false,
    maxSupportedTransactionVersion: SOLANA_MAX_SUPPORTED_TRANSACTION_VERSION,
  }];
}

function positiveNumberEnv(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${name} must be a positive number no greater than ${max}.`);
  }
  return parsed;
}

function endpoint(sourceId: string, url: string, fallbackUrls: string[] = []): ProviderEndpoint {
  const urls = [url, ...fallbackUrls].map((candidate) => {
    if (!isAllowedPublicEndpointUrl(candidate)) {
      throw new Error(`Public endpoint for ${sourceId} must be HTTPS, credential-free, and not a test network.`);
    }
    return new URL(candidate).toString();
  });
  return { sourceId, operatorId: null, independent: false, urls };
}

function publicSource(
  asset: QuorumAsset,
  sourceId: string,
  url: string,
  options: {
    fallbackUrls?: string[];
    independent?: boolean;
    allowUnmapped?: boolean;
    blockTimeoutMs?: number;
  } = {},
): PublicWhaleSource {
  const operatorId = getWhaleSourceOperator(asset, sourceId);
  if (!operatorId && !options.allowUnmapped) {
    throw new Error(`No operator mapping is configured for ${asset} source ${sourceId}.`);
  }
  const urls = [url, ...(options.fallbackUrls ?? [])].map((candidate) => {
    if (!isAllowedPublicEndpointUrl(candidate)) {
      throw new Error(`Public endpoint for ${sourceId} must be HTTPS, credential-free, and not a test network.`);
    }
    return new URL(candidate).toString();
  });
  return {
    asset,
    sourceId,
    operatorId: operatorId ?? null,
    independent: options.independent ?? Boolean(operatorId),
    urls,
    timeoutMs: ONCHAIN_SOURCE_CONFIG.requestTimeoutMs,
    blockTimeoutMs: options.blockTimeoutMs,
  };
}

const sourceBackoff = new Map<string, { untilMs: number; consecutive429s: number }>();
const sourceCircuitBreakers = new Map<string, { untilMs: number; consecutiveFailures: number }>();
const requestWaiters: Array<() => void> = [];
let activeRequests = 0;

class SourceRateLimitedError extends Error {}
class SourceCircuitOpenError extends Error {}

export interface PublicWhaleRequestOptions {
  timeoutMs?: number;
  retries?: boolean;
}

async function withRequestSlot<T>(request: () => Promise<T>): Promise<T> {
  if (activeRequests >= ONCHAIN_SOURCE_CONFIG.maxConcurrentRequests) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve));
  } else {
    activeRequests += 1;
  }
  try {
    return await request();
  } finally {
    const next = requestWaiters.shift();
    if (next) next();
    else activeRequests -= 1;
  }
}

function rateLimitDelayMs(sourceId: string, retryAfter: string | null, nowMs: number): number {
  const previous = sourceBackoff.get(sourceId);
  const consecutive429s = (previous?.consecutive429s ?? 0) + 1;
  const retryAfterSeconds = Number(retryAfter);
  const retryAfterDateMs = retryAfter && !Number.isFinite(retryAfterSeconds)
    ? Date.parse(retryAfter)
    : Number.NaN;
  const requestedDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1_000
    : Number.isFinite(retryAfterDateMs) && retryAfterDateMs > nowMs
      ? retryAfterDateMs - nowMs
      : ONCHAIN_SOURCE_CONFIG.rateLimitBackoffBaseMs * (2 ** (consecutive429s - 1));
  const delayMs = Math.max(
    ONCHAIN_SOURCE_CONFIG.rateLimitBackoffMinimumMs,
    Math.min(requestedDelayMs, ONCHAIN_SOURCE_CONFIG.rateLimitBackoffMaxMs),
  );
  sourceBackoff.set(sourceId, { untilMs: nowMs + delayMs, consecutive429s });
  return delayMs;
}

export function getPublicSourceBackoffUntil(sourceId: string): number | null {
  const state = sourceBackoff.get(sourceId);
  if (!state || state.untilMs <= Date.now()) return null;
  return state.untilMs;
}

export function getPublicSourceCircuitOpenUntil(sourceId: string): number | null {
  const state = sourceCircuitBreakers.get(sourceId);
  if (!state || state.untilMs <= Date.now()) return null;
  return state.untilMs;
}

async function readLimitedResponse(response: Response): Promise<string> {
  if (!response.body) throw new Error('Public provider response body is unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Public provider response exceeded the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function requestJsonAttempt(
  provider: ProviderEndpoint,
  payload?: unknown,
  fetcher: typeof fetch = fetch,
  retries = true,
): Promise<unknown> {
  const currentBackoff = sourceBackoff.get(provider.sourceId);
  if (currentBackoff && currentBackoff.untilMs > Date.now()) {
    throw new SourceRateLimitedError(
      `${provider.sourceId} is temporarily disabled until ${new Date(currentBackoff.untilMs).toISOString()}.`,
    );
  }
  let lastError: unknown;
  let attempt = 0;
  const maxEndpointAttempts = retries ? 2 : 1;
  endpointLoop: for (const url of provider.urls) {
    for (let endpointAttempt = 0; endpointAttempt < maxEndpointAttempts; endpointAttempt += 1) {
      try {
        const { response, text } = await withRequestSlot(async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            provider.timeoutMs ?? ONCHAIN_SOURCE_CONFIG.requestTimeoutMs,
          );
          try {
            const response = await fetcher(url, {
              method: payload === undefined ? 'GET' : 'POST',
              ...(payload === undefined ? {} : {
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
              }),
              signal: controller.signal,
              cache: 'no-store',
            });
            const contentLength = Number(response.headers.get('content-length'));
            if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
              throw new Error(`${provider.sourceId} response exceeded the size limit.`);
            }
            return { response, text: await readLimitedResponse(response) };
          } finally {
            clearTimeout(timeout);
          }
        });
        if (response.status === 429 || response.status >= 500) {
          if (response.status === 429) {
            const delayMs = rateLimitDelayMs(provider.sourceId, response.headers.get('retry-after'), Date.now());
            const until = sourceBackoff.get(provider.sourceId)!.untilMs;
            console.warn(
              `[PublicWhaleObservationPoller] ${provider.sourceId} returned HTTP 429; disabled for ${Math.ceil(delayMs / 1_000)}s.`,
            );
            throw new SourceRateLimitedError(
              `${provider.sourceId} returned HTTP 429 and is disabled until ${new Date(until).toISOString()}.`,
            );
          }
          lastError = new Error(`${provider.sourceId} returned HTTP ${response.status}.`);
          if (endpointAttempt + 1 < maxEndpointAttempts) {
            const delay = Math.min(
              ONCHAIN_SOURCE_CONFIG.requestRetryBaseMs * (2 ** attempt),
              ONCHAIN_SOURCE_CONFIG.requestRetryMaxMs,
            ) + Math.floor(Math.random() * ONCHAIN_SOURCE_CONFIG.requestRetryJitterMs);
            await new Promise((resolve) => setTimeout(resolve, delay));
            attempt += 1;
            continue;
          }
          if (url !== provider.urls[provider.urls.length - 1]) continue endpointLoop;
        }
        if (!response.ok) throw new Error(`${provider.sourceId} returned HTTP ${response.status}.`);
        try {
          const result = JSON.parse(text) as unknown;
          sourceBackoff.delete(provider.sourceId);
          return result;
        } catch {
          const scalar = text.trim();
          if (/^(?:[a-f0-9]{64}|\d+)$/i.test(scalar)) {
            sourceBackoff.delete(provider.sourceId);
            return scalar;
          }
          throw new Error(`${provider.sourceId} returned malformed JSON.`);
        }
      } catch (error) {
        if (error instanceof SourceRateLimitedError) {
          lastError = error;
          if (url !== provider.urls[provider.urls.length - 1]) {
            console.warn(
              `[PublicWhaleObservationPoller] ${provider.sourceId} is rate-limited; trying its configured endpoint fallback.`,
            );
            continue endpointLoop;
          }
          throw error;
        }
        lastError = error;
        if (error instanceof Error && /returned HTTP (400|401|402)\b/.test(error.message)) throw error;
        if (endpointAttempt + 1 === maxEndpointAttempts &&
            url === provider.urls[provider.urls.length - 1]) throw error;
        const delay = Math.min(
          ONCHAIN_SOURCE_CONFIG.requestRetryBaseMs * (2 ** attempt),
          ONCHAIN_SOURCE_CONFIG.requestRetryMaxMs,
        ) + Math.floor(Math.random() * ONCHAIN_SOURCE_CONFIG.requestRetryJitterMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt += 1;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${provider.sourceId} retries were exhausted.`);
}

async function requestJson(
  provider: ProviderEndpoint,
  payload?: unknown,
  fetcher: typeof fetch = fetch,
  options: PublicWhaleRequestOptions = {},
): Promise<unknown> {
  const nowMs = Date.now();
  const circuit = sourceCircuitBreakers.get(provider.sourceId);
  if (circuit && circuit.untilMs > nowMs) {
    throw new SourceCircuitOpenError(
      `${provider.sourceId} circuit is open until ${new Date(circuit.untilMs).toISOString()}.`,
    );
  }
  if (circuit?.untilMs && circuit.untilMs <= nowMs) sourceCircuitBreakers.delete(provider.sourceId);
  try {
    const result = await requestJsonAttempt({
      ...provider,
      timeoutMs: options.timeoutMs ?? provider.timeoutMs ?? ONCHAIN_SOURCE_CONFIG.requestTimeoutMs,
    }, payload, fetcher, options.retries ?? true);
    sourceCircuitBreakers.delete(provider.sourceId);
    return result;
  } catch (error) {
    if (error instanceof SourceRateLimitedError || error instanceof SourceCircuitOpenError) {
      throw error;
    }
    const consecutiveFailures =
      (sourceCircuitBreakers.get(provider.sourceId)?.consecutiveFailures ?? 0) + 1;
    const opensCircuit = consecutiveFailures >= ONCHAIN_SOURCE_CONFIG.circuitBreakerFailureCount;
    const untilMs = opensCircuit
      ? Date.now() + ONCHAIN_SOURCE_CONFIG.circuitBreakerCooldownMs
      : 0;
    sourceCircuitBreakers.set(provider.sourceId, { untilMs, consecutiveFailures });
    if (opensCircuit) {
      console.error(
        `[PublicWhaleObservationPoller] ${provider.sourceId} circuit opened after ${consecutiveFailures} consecutive request failures; cooling down for ${ONCHAIN_SOURCE_CONFIG.circuitBreakerCooldownMs / 1_000}s.`,
      );
    }
    throw error;
  }
}

export async function requestPublicWhaleSourceJson(
  provider: PublicWhaleSource,
  payload?: unknown,
  fetcher: typeof fetch = fetch,
  options: PublicWhaleRequestOptions = {},
): Promise<unknown> {
  return requestJson(provider, payload, fetcher, options);
}

function btcProviders(): PublicWhaleSource[] {
  return [
    publicSource('BTC', 'mempool.space', 'https://mempool.space/api'),
    publicSource('BTC', 'blockstream', 'https://blockstream.info/api'),
    publicSource('BTC', 'mempool-emzy', 'https://mempool.emzy.de/api'),
    publicSource('BTC', 'mempool-ninja', 'https://mempool.ninja/api'),
    publicSource('BTC', 'btcscan', 'https://btcscan.org/api'),
    publicSource('BTC', 'mempool-bullbitcoin', 'https://mempool.bullbitcoin.com/api'),
    publicSource('BTC', 'mempool-sweetsats', 'https://mempool.sweetsats.io/api'),
  ];
}

function evmProviders(asset: 'ETH' | 'BNB'): PublicWhaleSource[] {
  if (asset === 'ETH') {
    return [
      publicSource('ETH', 'ethereum-rpc-publicnode', 'https://ethereum-rpc.publicnode.com'),
      publicSource('ETH', 'ethereum-rpc-mevblocker', 'https://rpc.mevblocker.io'),
      publicSource('ETH', 'ethereum-rpc-blockrazor', 'https://eth.blockrazor.xyz'),
      publicSource('ETH', 'ethereum-rpc-flashbots', 'https://rpc.flashbots.net'),
      publicSource('ETH', 'ethereum-rpc-meowrpc', 'https://eth.meowrpc.com'),
      publicSource('ETH', 'ethereum-rpc-zan', 'https://api.zan.top/eth-mainnet'),
      publicSource('ETH', 'ethereum-rpc-bloxroute', 'https://eth.rpc.blxrbdn.com'),
      publicSource('ETH', 'ethereum-rpc-nownodes', 'https://public-eth.nownodes.io'),
      publicSource('ETH', 'ethereum-rpc-drpc', 'https://eth.drpc.org'),
    ];
  }
  return [
    publicSource('BNB', 'bsc-rpc-publicnode', 'https://bsc-rpc.publicnode.com'),
    publicSource('BNB', 'bsc-rpc-blockrazor', 'https://bsc.blockrazor.xyz'),
    publicSource('BNB', 'bsc-rpc-meowrpc', 'https://bsc.meowrpc.com'),
    publicSource('BNB', 'bsc-rpc-bloxroute', 'https://bsc.rpc.blxrbdn.com'),
    publicSource('BNB', 'bsc-rpc-48club', 'https://rpc-bsc.48.club'),
    publicSource('BNB', 'bsc-rpc-bnbchain', 'https://bsc-dataseed.bnbchain.org'),
    publicSource('BNB', 'bsc-rpc-defibit', 'https://bsc-dataseed1.defibit.io', {
      independent: false,
      allowUnmapped: true,
    }),
  ];
}

export function listPublicWhaleSources(): PublicWhaleSource[] {
  return [
    ...btcProviders(),
    ...evmProviders('ETH'),
    ...evmProviders('BNB'),
    ...solanaProviders(),
    ...xrpProviders(),
  ];
}

export type Member6FeeObservation = {
  provider: PublicWhaleSource;
  value: number;
  observationHeight?: number;
};

interface Member6FeeSample {
  observedAtMs: number;
  value: number;
  sourceIds: string;
}

function medianNumber(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function weightedMedianFeeRate(histogram: unknown): number | null {
  if (!Array.isArray(histogram) || histogram.length === 0) return null;
  const buckets = histogram.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) return [];
    const [feeRate, virtualSize] = entry;
    return typeof feeRate === 'number' && Number.isFinite(feeRate) && feeRate >= 0 &&
      typeof virtualSize === 'number' && Number.isSafeInteger(virtualSize) && virtualSize > 0
      ? [{ feeRate, virtualSize }]
      : [];
  });
  if (buckets.length !== histogram.length) return null;
  const totalVirtualSize = buckets.reduce((total, bucket) => total + bucket.virtualSize, 0);
  if (!Number.isSafeInteger(totalVirtualSize) || totalVirtualSize <= 0) return null;
  buckets.sort((left, right) => left.feeRate - right.feeRate);
  let observedVirtualSize = 0;
  for (const bucket of buckets) {
    observedVirtualSize += bucket.virtualSize;
    if (observedVirtualSize * 2 >= totalVirtualSize) return bucket.feeRate;
  }
  return null;
}

function feeHistoryPriorityGwei(payload: unknown): { value: number; height: number } | null {
  if (!isRecord(payload) || !isRecord(payload.result) ||
      !Array.isArray(payload.result.reward) || !Array.isArray(payload.result.baseFeePerGas) ||
      typeof payload.result.oldestBlock !== 'string' ||
      !/^0x[0-9a-f]+$/i.test(payload.result.oldestBlock) ||
      payload.result.reward.length !== 5 ||
      payload.result.baseFeePerGas.length !== payload.result.reward.length + 1) return null;
  const rewards = payload.result.reward.flatMap((row) =>
    Array.isArray(row) && row.length === 3 ? row.map((item) =>
      typeof item === 'string' && /^0x[0-9a-f]+$/i.test(item)
        ? Number(BigInt(item)) / 1e9
        : Number.NaN) : [Number.NaN]);
  const baseFees = payload.result.baseFeePerGas.map((item) =>
    typeof item === 'string' && /^0x[0-9a-f]+$/i.test(item)
      ? Number(BigInt(item)) / 1e9
      : Number.NaN);
  if (rewards.length === 0 || !rewards.every(Number.isFinite) ||
      !baseFees.every(Number.isFinite)) return null;
  const oldestBlock = Number.parseInt(payload.result.oldestBlock, 16);
  const height = oldestBlock + payload.result.reward.length - 1;
  if (!Number.isSafeInteger(oldestBlock) || !Number.isSafeInteger(height)) return null;
  return {
    value: medianNumber(rewards),
    height,
  };
}

async function fetchMember6FeeObservation(
  asset: QuorumAsset,
  provider: PublicWhaleSource,
): Promise<Member6FeeObservation> {
  if (asset === 'BTC') {
    const response = await requestJson({
      ...provider,
      urls: provider.urls.map((url) => `${url}/mempool`),
    });
    const value = isRecord(response) ? weightedMedianFeeRate(response.fee_histogram) : null;
    if (value === null) {
      throw new Error(`${provider.sourceId} returned an invalid mempool fee histogram.`);
    }
    return { provider, value };
  }
  if (asset === 'ETH' || asset === 'BNB') {
    const response = await requestJson(provider, {
      jsonrpc: '2.0',
      id: 'member6-fee-history',
      method: 'eth_feeHistory',
      params: ['0x5', 'latest', [25, 50, 75]],
    });
    const feeHistory = feeHistoryPriorityGwei(response);
    if (feeHistory === null || !Number.isSafeInteger(feeHistory.height)) {
      throw new Error(`${provider.sourceId} returned malformed eth_feeHistory.`);
    }
    return { provider, ...feeHistory, observationHeight: feeHistory.height };
  }
  if (asset === 'SOL') {
    const response = await requestJson(provider, {
      jsonrpc: '2.0',
      id: 'member6-priority-fees',
      method: 'getRecentPrioritizationFees',
      params: [],
    });
    const entries = isRecord(response) && Array.isArray(response.result)
      ? response.result.filter((item): item is Record<string, unknown> =>
          isRecord(item) && Number.isSafeInteger(item.slot) &&
          typeof item.prioritizationFee === 'number' &&
          Number.isFinite(item.prioritizationFee) && item.prioritizationFee >= 0)
      : [];
    if (entries.length < 3) {
      throw new Error(`${provider.sourceId} returned fewer than three valid priority-fee samples.`);
    }
    const latestSlot = Math.max(...entries.map(({ slot }) => slot as number));
    const recentFees = entries
      .filter(({ slot }) => (slot as number) >= latestSlot - 150)
      .map(({ prioritizationFee }) => prioritizationFee as number);
    return { provider, value: medianNumber(recentFees), observationHeight: latestSlot };
  }

  const response = await requestJson(provider, { method: 'server_info', params: [{}] });
  const outer = isRecord(response) && isRecord(response.result) ? response.result : null;
  const info = outer && isRecord(outer.info) ? outer.info : outer;
  const validatedLedger = info && isRecord(info.validated_ledger)
    ? info.validated_ledger
    : null;
  const baseFeeXrp = validatedLedger ? Number(validatedLedger.base_fee_xrp) : Number.NaN;
  const loadFactor = info ? Number(info.load_factor) : Number.NaN;
  const ledgerIndex = validatedLedger ? Number(validatedLedger.seq) : Number.NaN;
  if (!isValidXrpMainnetNetworkId(info?.network_id) ||
      !Number.isFinite(baseFeeXrp) || baseFeeXrp <= 0 ||
      !Number.isFinite(loadFactor) || loadFactor <= 0 ||
      !Number.isSafeInteger(ledgerIndex) || ledgerIndex <= 0) {
    throw new Error(`${provider.sourceId} returned invalid XRPL mainnet fee data.`);
  }
  return { provider, value: baseFeeXrp, observationHeight: ledgerIndex };
}

export function selectFeeMetricQuorumGroup(
  asset: QuorumAsset,
  values: readonly Member6FeeObservation[],
): Member6FeeObservation[] | null {
  const compatible = (group: readonly Member6FeeObservation[]): boolean => {
    const operators = new Set(group.flatMap(({ provider }) =>
      provider.independent && provider.operatorId ? [provider.operatorId] : []));
    if (operators.size !== group.length || operators.size < 2) return false;
    if (asset === 'SOL' || asset === 'ETH' || asset === 'BNB' || asset === 'XRP') {
      const heights = group.flatMap(({ observationHeight }) =>
        observationHeight === undefined ? [] : [observationHeight]);
      const maximumLag = asset === 'SOL' ? ONCHAIN_SOURCE_CONFIG.maxSolanaSlotLag : 2;
      if (heights.length !== group.length || Math.max(...heights) - Math.min(...heights) > maximumLag) {
        return false;
      }
    }
    const min = Math.min(...group.map(({ value }) => value));
    const max = Math.max(...group.map(({ value }) => value));
    return asset === 'XRP'
      ? max - min <= Math.max(min * 0.01, 1e-8)
      : max - min <= Math.max(min * 0.5, 1e-8);
  };
  const groups: Member6FeeObservation[][] = [];
  for (let mask = 1; mask < (1 << values.length); mask += 1) {
    const group = values.filter((_, index) => (mask & (1 << index)) !== 0);
    if (group.length >= 2 && compatible(group)) groups.push(group);
  }
  const largestSize = Math.max(0, ...groups.map((group) => group.length));
  const largestGroups = groups.filter((group) => group.length === largestSize);
  return largestGroups.length === 1 ? largestGroups[0] : null;
}

async function collectMember6FeeMetrics(
  asset: QuorumAsset,
  previousMetrics: Record<string, number | string | null> | null,
): Promise<Record<string, number | string | null>> {
  const preferredSources: Record<QuorumAsset, readonly string[]> = {
    BTC: ['mempool.space', 'blockstream', 'mempool-ninja'],
    ETH: ['ethereum-rpc-publicnode', 'ethereum-rpc-blockrazor', 'ethereum-rpc-drpc'],
    BNB: ['bsc-rpc-publicnode', 'bsc-rpc-48club', 'bsc-rpc-bnbchain'],
    SOL: ['solana-rpc-solana-foundation', 'solana-rpc-publicnode', 'solana-rpc-pocket'],
    XRP: ['xrp-rpc-honeycluster', 'xrp-rpc-ripple-s1', 'xrp-rpc-xrplcluster'],
  };
  const providers = preferredSources[asset].flatMap((sourceId) => {
    const provider = listPublicWhaleSources().find((item) =>
      item.asset === asset && item.sourceId === sourceId);
    return provider ? [provider] : [];
  });
  const responses = await Promise.allSettled(providers.map((provider) =>
    fetchMember6FeeObservation(asset, provider)));
  const fetchedObservations = responses.flatMap((response) =>
    response.status === 'fulfilled' ? [response.value] : []);
  for (const [index, response] of responses.entries()) {
    if (response.status === 'rejected') {
      console.warn(
        `[PublicWhaleObservationPoller] ${asset} fee telemetry unavailable from ${providers[index].sourceId}: ${errorText(response.reason)}`,
      );
    }
  }
  const feeMetric = asset === 'BTC'
    ? 'mempool_median_fee_rate'
    : asset === 'ETH' || asset === 'BNB'
      ? 'priority_fee_gwei'
      : asset === 'SOL'
        ? 'prioritization_fee_micro_lamports'
        : 'validated_base_fee_xrp';
  const feeUnit = asset === 'BTC' ? 'sat_vbyte'
    : asset === 'ETH' || asset === 'BNB' ? 'gwei'
      : asset === 'SOL' ? 'micro_lamports_per_compute_unit'
        : 'XRP';
  const observations = selectFeeMetricQuorumGroup(asset, fetchedObservations) ?? [];
  const matchingQuorum = observations.length >= 2;
  const observedAtMs = Date.now();
  const feeValue = matchingQuorum
    ? medianNumber(observations.map(({ value }) => value))
    : null;
  const sourceIds = observations
    .filter(({ provider }) => provider.independent && provider.operatorId)
    .map(({ provider }) => provider.sourceId)
    .sort()
    .join(',');
  let validPriorSamples: Member6FeeSample[] = [];
  if (typeof previousMetrics?.fee_history_json === 'string') {
    try {
      const history: unknown = JSON.parse(previousMetrics.fee_history_json);
      if (Array.isArray(history)) {
        validPriorSamples = history.filter((sample): sample is Member6FeeSample =>
          isRecord(sample) &&
          Number.isSafeInteger(sample.observedAtMs) &&
          (sample.observedAtMs as number) <= observedAtMs &&
          observedAtMs - (sample.observedAtMs as number) <= FEE_SPIKE_MAX_SAMPLE_AGE_MS &&
          typeof sample.value === 'number' && Number.isFinite(sample.value) && sample.value >= 0 &&
          typeof sample.sourceIds === 'string' &&
          sample.sourceIds.split(',').length >= 2 &&
          new Set(sample.sourceIds.split(',')).size === sample.sourceIds.split(',').length &&
          new Set(sample.sourceIds.split(',').flatMap((sourceId) => {
            const operator = getWhaleSourceOperator(asset, sourceId);
            return operator ? [operator] : [];
          })).size >= 2);
      }
    } catch (error) {
      console.warn(
        `[PublicWhaleObservationPoller] ${asset} prior fee baseline is malformed and was ignored: ${errorText(error)}`,
      );
    }
  }
  validPriorSamples = [...new Map(validPriorSamples.map((sample) => [
    `${sample.sourceIds}:${sample.observedAtMs}`,
    sample,
  ])).values()]
    .sort((left, right) => left.observedAtMs - right.observedAtMs)
    .slice(-60);
  const baselineSamples = matchingQuorum
    ? validPriorSamples.filter((sample) => sample.sourceIds === sourceIds)
    : [];
  const samples = matchingQuorum && feeValue !== null && feeValue >= 0
    ? [...validPriorSamples, { observedAtMs, value: feeValue, sourceIds }].slice(-60)
    : validPriorSamples.slice(-60);
  const baselineSpanMs = baselineSamples.length >= 2
    ? baselineSamples[baselineSamples.length - 1].observedAtMs - baselineSamples[0].observedAtMs
    : 0;
  const baselineReady = baselineSamples.length >= FEE_SPIKE_MIN_SAMPLES &&
    baselineSpanMs >= FEE_SPIKE_MIN_SPAN_MS;
  const baselineValue = baselineReady
    ? medianNumber(baselineSamples.map(({ value }) => value))
    : null;
  const spikeRatio = baselineValue !== null && baselineValue > 0 && feeValue !== null
    ? feeValue / baselineValue
    : null;
  return {
    fee_status: matchingQuorum ? 'QUORUM' : 'UNAVAILABLE',
    fee_metric: feeMetric,
    fee_unit: feeUnit,
    fee_value: feeValue,
    fee_operator_count: new Set(observations.flatMap(({ provider }) =>
      provider.independent && provider.operatorId ? [provider.operatorId] : [])).size,
    fee_source_ids: sourceIds,
    fee_observed_at_ms: observedAtMs,
    fee_unavailable_reason: matchingQuorum
      ? null
      : 'Fewer than two independent, consistent public fee observations.',
    fee_spike_status: !matchingQuorum
      ? 'UNAVAILABLE'
      : baselineReady
        ? spikeRatio !== null && spikeRatio >= FEE_SPIKE_MIN_RATIO ? 'SPIKE' : 'NO_SPIKE'
        : 'BASELINE_BUILDING',
    fee_spike_ratio: spikeRatio,
    fee_baseline_value: baselineValue,
    fee_baseline_source_ids: baselineReady ? sourceIds : '',
    fee_baseline_operator_count: baselineReady
      ? new Set(sourceIds.split(',').filter(Boolean).map((sourceId) =>
          getWhaleSourceOperator(asset, sourceId)).filter(Boolean)).size
      : 0,
    fee_baseline_sample_count: baselineSamples.length,
    fee_baseline_span_ms: baselineSpanMs,
    fee_history_json: JSON.stringify(samples),
  };
}

export interface SourceHeightObservation {
  sourceId: string;
  operatorId: string | null;
  height: number;
  independent?: boolean;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function filterSourcesByMedianHeight<T extends SourceHeightObservation>(
  asset: string,
  observations: readonly T[],
  maxDistance: number = ONCHAIN_SOURCE_CONFIG.maxBlockHeightLag,
): T[] {
  const independentObservations = observations.filter(({ independent }) => independent !== false);
  const baselineObservations = independentObservations.length > 0 ? independentObservations : observations;
  if (baselineObservations.length === 0) return [];
  const baselineOperators = new Map<string, number[]>();
  for (const observation of baselineObservations) {
    const operatorKey = observation.operatorId ?? observation.sourceId;
    const heights = baselineOperators.get(operatorKey) ?? [];
    heights.push(observation.height);
    baselineOperators.set(operatorKey, heights);
  }
  const baseline = median([...baselineOperators.values()].map(median));
  return observations.filter((observation) => {
    const distance = Math.abs(observation.height - baseline);
    if (distance <= maxDistance) return true;
    console.warn(
      `[PublicWhaleObservationPoller] ${asset} source ${observation.sourceId} is ${distance} ${
        asset === 'SOL' ? 'slots' : asset === 'XRP' ? 'ledgers' : 'blocks'
      } from the operator median (${baseline}); excluded this round.`,
    );
    return false;
  });
}

function distinctOperatorPairs<T extends { provider: ProviderEndpoint }>(
  items: readonly T[],
): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const leftProvider = items[left].provider;
      const rightProvider = items[right].provider;
      if (leftProvider.independent && rightProvider.independent &&
          leftProvider.operatorId && rightProvider.operatorId &&
          leftProvider.operatorId !== rightProvider.operatorId) {
        pairs.push([items[left], items[right]]);
      }
    }
  }
  return pairs;
}

function firstDistinctOperatorPair<T extends { provider: ProviderEndpoint }>(
  items: readonly T[],
): [T, T] | null {
  return distinctOperatorPairs(items)[0] ?? null;
}

function solanaProviders(): PublicWhaleSource[] {
  return [
    publicSource('SOL', 'solana-rpc-solana-foundation', 'https://api.mainnet.solana.com', {
      fallbackUrls: ['https://api.mainnet-beta.solana.com'],
    }),
    publicSource('SOL', 'solana-rpc-solana-foundation-beta', 'https://api.mainnet-beta.solana.com'),
    publicSource('SOL', 'solana-rpc-publicnode', 'https://solana-rpc.publicnode.com'),
    publicSource('SOL', 'solana-rpc-vibestation', 'https://public.rpc.solanavibestation.com'),
    publicSource('SOL', 'solana-rpc-pocket', 'https://solana.api.pocket.network'),
    publicSource('SOL', 'solana-rpc-web3cdn', 'https://solana.web3cdn.rest', {
      blockTimeoutMs: ONCHAIN_SOURCE_CONFIG.solanaWeb3CdnBlockTimeoutMs,
    }),
    publicSource('SOL', 'solana-rpc-tatum', 'https://solana-mainnet.gateway.tatum.io', {
      independent: false,
      allowUnmapped: true,
    }),
  ];
}

function xrpProviders(): PublicWhaleSource[] {
  return [
    publicSource('XRP', 'xrp-rpc-xrplcluster', 'https://xrplcluster.com'),
    publicSource('XRP', 'xrp-rpc-xrpl-ws', 'https://xrpl.ws'),
    publicSource('XRP', 'xrp-rpc-honeycluster', 'https://honeycluster.io'),
    publicSource('XRP', 'xrp-rpc-ripple-s1', 'https://s1.ripple.com'),
    publicSource('XRP', 'xrp-rpc-ripple-s2', 'https://s2.ripple.com', {
      fallbackUrls: ['https://s2.ripple.com:51234'],
    }),
    publicSource('XRP', 'xrp-rpc-ankr', 'https://rpc.ankr.com/xrp_mainnet'),
    publicSource('XRP', 'xrp-rpc-unverified-backup', 'https://xrpl.link', {
      independent: false,
      allowUnmapped: true,
    }),
  ];
}

function isBtcBlock(value: unknown): value is BtcBlock {
  return isRecord(value) &&
    typeof value.id === 'string' && /^[a-f0-9]{64}$/i.test(value.id) &&
    Number.isSafeInteger(value.height) && (value.height as number) > 0 &&
    Number.isSafeInteger(value.timestamp) && (value.timestamp as number) > 0 &&
    Number.isSafeInteger(value.tx_count) && (value.tx_count as number) > 0;
}

function isBtcTransaction(value: unknown): value is BtcTransaction {
  if (!isRecord(value) || typeof value.txid !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(value.txid) || !isRecord(value.status) ||
      typeof value.status.confirmed !== 'boolean' || !Array.isArray(value.vin) ||
      !Array.isArray(value.vout)) return false;
  if (!value.vin.every((input) => isRecord(input) &&
      (input.prevout === undefined || input.prevout === null || isRecord(input.prevout)) &&
      (!isRecord(input.prevout) || input.prevout.scriptpubkey_address === undefined ||
        input.prevout.scriptpubkey_address === null ||
        typeof input.prevout.scriptpubkey_address === 'string'))) return false;
  return value.vout.every((output) => isRecord(output) &&
    Number.isSafeInteger(output.value) && (output.value as number) >= 0 &&
    (output.scriptpubkey_address === undefined || output.scriptpubkey_address === null ||
      typeof output.scriptpubkey_address === 'string'));
}

async function fetchBtcTipHeight(provider: PublicWhaleSource): Promise<number> {
  const tip = await requestJson({
    ...provider,
    urls: provider.urls.map((url) => `${url}/blocks/tip/height`),
  });
  const tipHeight = typeof tip === 'number'
    ? tip
    : typeof tip === 'string' && /^\d+$/.test(tip)
      ? Number(tip)
      : Number.NaN;
  if (!Number.isSafeInteger(tipHeight) || tipHeight <= 0) {
    throw new Error(`${provider.sourceId} returned an invalid tip height.`);
  }
  return tipHeight;
}

async function fetchBtcBlocks(
  provider: PublicWhaleSource,
  startHeight: number,
  blockCount: number,
): Promise<BtcBlock[]> {
  const blocks: BtcBlock[] = [];
  for (let offset = 0; offset < blockCount; offset += 1) {
    const height = startHeight - offset;
    if (height <= 0) break;
    const hash = await requestJson({
      ...provider,
      urls: provider.urls.map((url) => `${url}/block-height/${height}`),
    });
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
      throw new Error(`${provider.sourceId} returned an invalid hash for block ${height}.`);
    }
    const block = await requestJson({
      ...provider,
      urls: provider.urls.map((url) => `${url}/block/${hash}`),
    });
    if (!isBtcBlock(block) || block.id.toLowerCase() !== hash.toLowerCase() || block.height !== height) {
      throw new Error(`${provider.sourceId} returned mismatched block metadata for height ${height}.`);
    }
    blocks.push(block);
  }
  return blocks;
}

async function fetchBtcBlockTransactions(
  provider: ProviderEndpoint,
  block: BtcBlock,
): Promise<BtcTransaction[]> {
  return collectCompleteBtcTransactionPages(
    block.id,
    block.tx_count,
    (startIndex) => {
      const pagePath = startIndex === 0
        ? `/block/${block.id}/txs`
        : `/block/${block.id}/txs/${startIndex}`;
      return requestJson({
        ...provider,
        urls: provider.urls.map((url) => `${url}${pagePath}`),
      });
    },
    provider.sourceId,
  );
}

export async function collectCompleteBtcTransactionPages(
  blockId: string,
  transactionCount: number,
  fetchPage: (startIndex: number) => Promise<unknown>,
  sourceId = 'BTC source',
): Promise<BtcTransaction[]> {
  const transactions: BtcTransaction[] = [];
  const seenTransactionIds = new Set<string>();
  for (let pageIndex = 0; transactions.length < transactionCount; pageIndex += 1) {
    if (pageIndex >= ONCHAIN_SOURCE_CONFIG.maxBtcTransactionPages) {
      throw new Error(
        `${sourceId} incomplete block: got ${transactions.length} of ${transactionCount}; BTC transaction page limit exceeded for block ${blockId}.`,
      );
    }
    let raw: unknown;
    try {
      raw = await fetchPage(transactions.length);
    } catch (error) {
      throw new Error(
        `${sourceId} incomplete block: got ${transactions.length} of ${transactionCount}; ${errorText(error)}`,
      );
    }
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isBtcTransaction)) {
      throw new Error(
        `${sourceId} incomplete block: got ${transactions.length} of ${transactionCount}; invalid or incomplete BTC transaction page.`,
      );
    }
    if (raw.length > transactionCount - transactions.length) {
      throw new Error(
        `${sourceId} incomplete block: got ${transactions.length} of ${transactionCount}; excess BTC transactions for block ${blockId}.`,
      );
    }
    for (const transaction of raw) {
      if (seenTransactionIds.has(transaction.txid)) {
        throw new Error(
          `${sourceId} incomplete block: got ${transactions.length} of ${transactionCount}; duplicate transactions across BTC pages.`,
        );
      }
      seenTransactionIds.add(transaction.txid);
      transactions.push(transaction);
    }
  }
  if (transactions.length !== transactionCount) {
    throw new Error(
      `${sourceId} incomplete block: got ${transactions.length} of ${transactionCount}; incomplete BTC transaction set for block ${blockId}.`,
    );
  }
  return transactions;
}

interface PublicWhaleAssetScan {
  observedTransfers: QuorumObservedTransfer[];
  nextBlock: number;
}

async function scanBitcoin(
  nowMs: number,
  blockCount: number,
  nextBlock: number | undefined,
): Promise<PublicWhaleAssetScan> {
  const providers = btcProviders();
  const results = await Promise.allSettled(providers.map(async (provider) => ({
    provider,
    height: await fetchBtcTipHeight(provider),
  })));
  const available = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : []);
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${providers[index].sourceId}: ${errorText(result.reason)}`]
      : []);
  failures.forEach((failure) =>
    console.warn(`[PublicWhaleObservationPoller] BTC provider unavailable: ${failure}`));
  const inSync = filterSourcesByMedianHeight('BTC', available.map((source) => ({
    ...source,
    sourceId: source.provider.sourceId,
    operatorId: source.provider.operatorId,
    independent: source.provider.independent,
  })));
  const inSyncOperatorCount = countDistinctWhaleSourceOperators(
    'BTC',
    inSync.map(({ sourceId }) => sourceId),
  );
  if (inSyncOperatorCount < 2) {
    const reason = `BTC has only ${inSyncOperatorCount} healthy independent block providers after height filtering.`;
    console.error(`[PublicWhaleObservationPoller] ${reason} Member 6 will abstain. ${failures.join('; ')}`);
    throw new Error(reason);
  }
  const finalizedHead = Math.min(...inSync.map(({ height }) => height)) - 1;
  const range = getMember6BlockRange(finalizedHead, nextBlock, blockCount);
  if (!range) {
    if (nextBlock === undefined) throw new Error('BTC initial block cursor could not be established.');
    return { observedTransfers: [], nextBlock };
  }
  const blockSets = await Promise.allSettled(inSync.map(async ({ provider }) => ({
    provider,
    blocks: await fetchBtcBlocks(
      provider,
      range.throughBlock,
      range.throughBlock - range.fromBlock + 1,
    ),
  })));
  const headers = blockSets.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : []);
  const headerFailures = blockSets.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${inSync[index].sourceId}: ${errorText(result.reason)}`]
      : []);
  headerFailures.forEach((failure) =>
    console.warn(`[PublicWhaleObservationPoller] BTC block header unavailable: ${failure}`));
  const headerOperatorCount = countDistinctWhaleSourceOperators(
    'BTC',
    headers.map(({ provider }) => provider.sourceId),
  );
  if (headerOperatorCount < 2) {
    const reason = `BTC has only ${headerOperatorCount} providers with matching block headers.`;
    console.error(`[PublicWhaleObservationPoller] ${reason} Member 6 will abstain. ${headerFailures.join('; ')}`);
    throw new Error(reason);
  }
  const blockGroups = new Map<string, Array<{ provider: PublicWhaleSource; block: BtcBlock }>>();
  for (const { provider, blocks } of headers) {
    for (const block of blocks) {
      const key = `${block.height}:${block.id.toLowerCase()}:${block.timestamp}`;
      blockGroups.set(key, [...(blockGroups.get(key) ?? []), { provider, block }]);
    }
  }
  const commonBlocks = [...blockGroups.values()]
    .filter((group) => countDistinctWhaleSourceOperators('BTC', group.map(({ provider }) => provider.sourceId)) >= 2)
    .sort((left, right) => left[0].block.height - right[0].block.height);
  if (commonBlocks.length !== range.throughBlock - range.fromBlock + 1 ||
      commonBlocks.some((group, index) => group[0].block.height !== range.fromBlock + index)) {
    const reason = `BTC providers did not return every matching block header from ${range.fromBlock} through ${range.throughBlock}.`;
    console.error(`[PublicWhaleObservationPoller] ${reason} Member 6 will abstain.`);
    throw new Error(reason);
  }
  const threshold = positiveNumberEnv('SBK1_WHALE_MIN_TRANSFER_BTC', BTC_MIN_TRANSFER, 1_000_000);
  const observations: QuorumObservedTransfer[] = [];
  let completeBlockCount = 0;
  for (const blockGroup of commonBlocks) {
    const transactionSets = new Map<string, BtcTransaction[]>();
    const incompleteSources = new Set<string>();
    const loadCompleteTransactions = async (
      item: { provider: PublicWhaleSource; block: BtcBlock },
    ): Promise<BtcTransaction[] | null> => {
      if (transactionSets.has(item.provider.sourceId)) {
        return transactionSets.get(item.provider.sourceId)!;
      }
      if (incompleteSources.has(item.provider.sourceId)) return null;
      try {
        const transactions = await fetchBtcBlockTransactions(item.provider, item.block);
        transactionSets.set(item.provider.sourceId, transactions);
        return transactions;
      } catch (error) {
        incompleteSources.add(item.provider.sourceId);
        console.warn(
          `[PublicWhaleObservationPoller] BTC source ${item.provider.sourceId} returned an incomplete block ${item.block.height}; rejecting that source for this block: ${errorText(error)}`,
        );
        return null;
      }
    };
    let pair: [typeof blockGroup[number], typeof blockGroup[number]] | null = null;
    let transactionPair: [BtcTransaction[], BtcTransaction[]] | null = null;
    for (const candidatePair of distinctOperatorPairs(blockGroup)) {
      const [leftTransactions, rightTransactions] = await Promise.all([
        loadCompleteTransactions(candidatePair[0]),
        loadCompleteTransactions(candidatePair[1]),
      ]);
      if (!leftTransactions || !rightTransactions) continue;
      pair = candidatePair;
      transactionPair = [leftTransactions, rightTransactions];
      break;
    }
    if (!pair || !transactionPair) {
      throw new Error(
        `BTC block ${blockGroup[0].block.height} has fewer than two independent sources with complete transaction pages; the cursor will not advance.`,
      );
    }
    completeBlockCount += 1;
    const [left, right] = pair;
    const { provider: leftProvider, block: leftBlock } = left;
    const { provider: rightProvider, block: rightBlock } = right;
    const [leftTransactions, rightTransactions] = transactionPair;
    const rightByTx = new Map(rightTransactions.map((transaction) => [transaction.txid, transaction]));
    for (const tx of leftTransactions) {
      const matching = rightByTx.get(tx.txid);
      if (!tx.status.confirmed || !matching?.status.confirmed ||
          (tx.status.block_height !== undefined && tx.status.block_height !== leftBlock.height) ||
          (matching.status.block_height !== undefined && matching.status.block_height !== rightBlock.height) ||
          (tx.status.block_time !== undefined && tx.status.block_time !== leftBlock.timestamp) ||
          (matching.status.block_time !== undefined && matching.status.block_time !== rightBlock.timestamp)) continue;
      if (!isUnambiguousBtcTransfer(tx, matching)) continue;
      const timestampMs = (tx.status.block_time ?? leftBlock.timestamp) * 1_000;
      if (timestampMs > nowMs ||
          nowMs - timestampMs > ONCHAIN_SOURCE_CONFIG.maxHistoricalBlockAgeMs) continue;
      const leftInputs = tx.vin.map(({ prevout }) =>
        isRecord(prevout) ? prevout.scriptpubkey_address ?? null : null);
      const rightInputs = matching.vin.map(({ prevout }) =>
        isRecord(prevout) ? prevout.scriptpubkey_address ?? null : null);
      const matchingInputs = leftInputs.length > 0 &&
        leftInputs.every((address): address is string => typeof address === 'string' && address.length > 0) &&
        JSON.stringify(leftInputs) === JSON.stringify(rightInputs);
      const fromAddresses = matchingInputs ? [...new Set(leftInputs)] : [];
      tx.vout.forEach(({ value }, index) => {
        if (value / 100_000_000 < threshold || matching.vout[index]?.value !== value) return;
        const outputAddress = tx.vout[index]?.scriptpubkey_address;
        const matchingOutputAddress = matching.vout[index]?.scriptpubkey_address;
        observations.push({
          assetSymbol: 'BTC',
          blockchain: 'bitcoin',
          transactionHash: tx.txid,
          transferId: `vout:${index}`,
          timestampMs,
          amount: value / 100_000_000,
          unit: 'BTC',
          blockHeight: leftBlock.height,
          sourceIds: [leftProvider.sourceId, rightProvider.sourceId],
          confirmationStatus: 'CONFIRMED',
          fromAddresses,
          toAddresses: outputAddress && outputAddress === matchingOutputAddress
            ? [outputAddress]
            : [],
        });
      });
    }
  }
  if (completeBlockCount !== commonBlocks.length) {
    const reason = `BTC did not obtain complete transaction sets from two independent sources for every requested block (${completeBlockCount}/${commonBlocks.length}).`;
    console.error(`[PublicWhaleObservationPoller] ${reason} Member 6 will abstain.`);
    throw new Error(reason);
  }
  return { observedTransfers: observations, nextBlock: range.nextBlock };
}

function isEvmBlock(value: unknown): value is EvmBlock {
  return isRecord(value) &&
    typeof value.number === 'string' && /^0x[0-9a-f]+$/i.test(value.number) &&
    Number.isSafeInteger(Number.parseInt(value.number, 16)) &&
    typeof value.hash === 'string' && /^0x[0-9a-f]{64}$/i.test(value.hash) &&
    typeof value.timestamp === 'string' && /^0x[0-9a-f]+$/i.test(value.timestamp) &&
    Number.isSafeInteger(Number.parseInt(value.timestamp, 16)) &&
    Number.parseInt(value.timestamp, 16) > 0 &&
    Array.isArray(value.transactions) &&
    value.transactions.every((tx) => isRecord(tx) &&
      typeof tx.hash === 'string' && /^0x[0-9a-f]{64}$/i.test(tx.hash) &&
      typeof tx.value === 'string' && /^0x[0-9a-f]+$/i.test(tx.value) &&
      (tx.from === undefined || (typeof tx.from === 'string' && /^0x[0-9a-f]{40}$/i.test(tx.from))) &&
      (tx.to === undefined || tx.to === null ||
        (typeof tx.to === 'string' && /^0x[0-9a-f]{40}$/i.test(tx.to))));
}

function matchingEvmPair(
  blocks: Array<{ provider: ProviderEndpoint; block: EvmBlock }>,
): Array<{ provider: ProviderEndpoint; block: EvmBlock }> {
  const groups = new Map<string, Array<{ provider: ProviderEndpoint; block: EvmBlock }>>();
  for (const item of blocks) {
    const key = [
      item.block.hash.toLowerCase(),
      Number.parseInt(item.block.number, 16),
      Number.parseInt(item.block.timestamp, 16),
    ].join(':');
    groups.set(key, [
      ...(groups.get(key) ?? []),
      item,
    ]);
  }
  for (const group of [...groups.values()].sort((left, right) => right.length - left.length)) {
    const pair = firstDistinctOperatorPair(group);
    if (pair) return pair;
  }
  return [];
}

async function evmRpc(
  provider: ProviderEndpoint,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const payload = await requestJson(provider, { jsonrpc: '2.0', id: 1, method, params });
  if (!isRecord(payload) || payload.error !== undefined || !('result' in payload)) {
    throw new Error(`${provider.sourceId} returned an invalid ${method} response.`);
  }
  return payload.result;
}

export function isSuccessfulEvmReceipt(
  value: unknown,
  transactionHash: string,
  blockHash: string,
): boolean {
  if (!isRecord(value) ||
      typeof value.transactionHash !== 'string' ||
      value.transactionHash.toLowerCase() !== transactionHash.toLowerCase() ||
      typeof value.blockHash !== 'string' ||
      value.blockHash.toLowerCase() !== blockHash.toLowerCase() ||
      typeof value.status !== 'string' ||
      !/^0x[0-9a-f]+$/i.test(value.status)) return false;
  try {
    return BigInt(value.status) === 1n;
  } catch {
    return false;
  }
}

async function scanEvm(
  asset: 'ETH' | 'BNB',
  nowMs: number,
  blockCount: number,
  nextBlock: number | undefined,
): Promise<PublicWhaleAssetScan> {
  const providers = evmProviders(asset);
  const headResults = await Promise.allSettled(providers.map(async (provider) => ({
    provider,
    head: await evmRpc(provider, 'eth_blockNumber', []),
  })));
  const availableHeads = headResults.flatMap((result) =>
    result.status === 'fulfilled' &&
    typeof result.value.head === 'string' &&
    /^0x[0-9a-f]+$/i.test(result.value.head) &&
    Number.isSafeInteger(Number.parseInt(result.value.head, 16))
      ? [{ ...result.value, height: Number.parseInt(result.value.head, 16) }]
      : []);
  const inSyncHeads = filterSourcesByMedianHeight(asset, availableHeads.map(({ provider, height }) => ({
    provider,
    sourceId: provider.sourceId,
    operatorId: provider.operatorId,
    height,
    independent: provider.independent,
  })));
  const syncedSourceIds = new Set(inSyncHeads.map(({ sourceId }) => sourceId));
  const eligibleHeads = availableHeads.filter(({ provider }) => syncedSourceIds.has(provider.sourceId));
  if (countDistinctWhaleSourceOperators(asset, eligibleHeads.map(({ provider }) => provider.sourceId)) < 2) {
    const failures = headResults.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${providers[index].sourceId}: ${errorText(result.reason)}`]
        : []);
    const reason = `${asset} has fewer than two healthy independent RPC operators after height filtering.`;
    console.error(`[PublicWhaleObservationPoller] ${reason} Member 6 will abstain. ${failures.join('; ')}`);
    throw new Error(reason);
  }
  const headFailures = headResults.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${providers[index].sourceId}: ${errorText(result.reason)}`]
      : []);
  headFailures.forEach((failure) =>
    console.warn(`[PublicWhaleObservationPoller] ${asset} RPC provider unavailable: ${failure}`));
  eligibleHeads.sort((left, right) =>
    Number(right.provider.independent) - Number(left.provider.independent) ||
    right.height - left.height);
  const finalityDepth = asset === 'ETH' ? 12 : 15;
  const independentHeads = eligibleHeads.filter(({ provider }) => provider.independent);
  const scanHeadHeights = independentHeads.length >= 2
    ? independentHeads.map(({ height }) => height)
    : eligibleHeads.map(({ height }) => height);
  const scanEnd = Math.min(...scanHeadHeights) - finalityDepth;
  if (!Number.isSafeInteger(scanEnd) || scanEnd <= 0) {
    throw new Error(`${asset} finalized block height is invalid.`);
  }
  const range = getMember6BlockRange(scanEnd, nextBlock, blockCount);
  if (!range) {
    if (nextBlock === undefined) throw new Error(`${asset} initial block cursor could not be established.`);
    return { observedTransfers: [], nextBlock };
  }
  const minAmount = positiveNumberEnv(
    asset === 'ETH' ? 'SBK1_WHALE_MIN_ETH' : 'SBK1_WHALE_MIN_BNB',
    asset === 'ETH' ? ETH_MIN_TRANSFER : BNB_MIN_TRANSFER,
    1_000_000_000,
  );
  const blockchain = asset === 'ETH' ? 'ethereum' : 'binance-smart-chain';
  const thresholdWei = BigInt(minAmount.toFixed(18).replace('.', ''));
  const transfers: QuorumObservedTransfer[] = [];
  for (let blockNumber = range.fromBlock; blockNumber <= range.throughBlock; blockNumber += 1) {
    const blockTag = `0x${blockNumber.toString(16)}`;
    const blockResults = await Promise.allSettled(eligibleHeads.map(async ({ provider }) => ({
      provider,
      block: await evmRpc(provider, 'eth_getBlockByNumber', [blockTag, true]),
    })));
    blockResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[PublicWhaleObservationPoller] ${asset} block read failed for ${eligibleHeads[index].provider.sourceId} at ${blockNumber}: ${errorText(result.reason)}`,
        );
      } else if (!isEvmBlock(result.value.block) ||
          Number.parseInt(result.value.block.number, 16) !== blockNumber) {
        console.warn(
          `[PublicWhaleObservationPoller] ${asset} invalid block number/hash/timestamp from ${eligibleHeads[index].provider.sourceId} at ${blockNumber}.`,
        );
      }
    });
    const matchingPair = matchingEvmPair(blockResults.flatMap((result) =>
      result.status === 'fulfilled' &&
      isEvmBlock(result.value.block) &&
      Number.parseInt(result.value.block.number, 16) === blockNumber
        ? [{ provider: result.value.provider, block: result.value.block }]
        : []));
    if (matchingPair.length < 2) {
      throw new Error(
        `${asset} RPC operators disagree on finalized block ${blockNumber}; the cursor will not advance.`,
      );
    }
    const [left, right] = matchingPair;
    const rightTransactions = new Map(right.block.transactions.map((tx) => [tx.hash.toLowerCase(), tx]));
    const timestampMs = Number.parseInt(left.block.timestamp, 16) * 1_000;
    if (timestampMs > nowMs ||
        nowMs - timestampMs > ONCHAIN_SOURCE_CONFIG.maxHistoricalBlockAgeMs) continue;
    const candidateTransactions = left.block.transactions.filter((tx) => {
      const match = rightTransactions.get(tx.hash.toLowerCase());
      return match !== undefined &&
        match.value.toLowerCase() === tx.value.toLowerCase() &&
        BigInt(tx.value) >= thresholdWei;
    });
    const successfulTransactions = new Set<string>();
    for (let offset = 0; offset < candidateTransactions.length;
      offset += ONCHAIN_SOURCE_CONFIG.maxConcurrentRequests) {
      const batch = candidateTransactions.slice(
        offset,
        offset + ONCHAIN_SOURCE_CONFIG.maxConcurrentRequests,
      );
      const receiptChecks = await Promise.all(batch.map(async (tx) => {
        const [leftReceipt, rightReceipt] = await Promise.allSettled([
          evmRpc(left.provider, 'eth_getTransactionReceipt', [tx.hash]),
          evmRpc(right.provider, 'eth_getTransactionReceipt', [tx.hash]),
        ]);
        if (leftReceipt.status === 'rejected') {
          throw new Error(
            `${asset} receipt lookup failed for ${tx.hash}; the cursor will not advance: ${errorText(leftReceipt.reason)}`,
          );
        }
        if (rightReceipt.status === 'rejected') {
          throw new Error(
            `${asset} receipt lookup failed for ${tx.hash}; the cursor will not advance: ${errorText(rightReceipt.reason)}`,
          );
        }
        const successful = isSuccessfulEvmReceipt(leftReceipt.value, tx.hash, left.block.hash) &&
          isSuccessfulEvmReceipt(rightReceipt.value, tx.hash, right.block.hash);
        if (!successful) {
          console.warn(
            `[PublicWhaleObservationPoller] ${asset} receipt status or block identity disagrees for ${tx.hash}; transfer excluded.`,
          );
        }
        return successful
          ? tx.hash.toLowerCase()
          : null;
      }));
      receiptChecks.forEach((hash) => {
        if (hash) successfulTransactions.add(hash);
      });
    }
    for (const tx of candidateTransactions) {
      if (!successfulTransactions.has(tx.hash.toLowerCase())) continue;
      const amountWei = BigInt(tx.value);
      const match = rightTransactions.get(tx.hash.toLowerCase());
      if (!match) continue;
      const amount = Number(amountWei) / 1e18;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const addressesMatch = typeof tx.from === 'string' &&
        typeof tx.to === 'string' &&
        typeof match.from === 'string' &&
        typeof match.to === 'string' &&
        tx.from.toLowerCase() === match.from.toLowerCase() &&
        tx.to.toLowerCase() === match.to.toLowerCase();
      transfers.push({
        assetSymbol: asset,
        blockchain,
        transactionHash: tx.hash,
        transferId: 'native:0',
        timestampMs,
        amount,
        unit: asset,
        blockHeight: blockNumber,
        sourceIds: [left.provider.sourceId, right.provider.sourceId],
        confirmationStatus: 'CONFIRMED',
        fromAddresses: addressesMatch ? [tx.from!.toLowerCase()] : [],
        toAddresses: addressesMatch ? [tx.to!.toLowerCase()] : [],
      });
    }
  }
  return { observedTransfers: transfers, nextBlock: range.nextBlock };
}

function isSolanaBlock(value: unknown): value is SolanaBlock {
  return isRecord(value) &&
    typeof value.blockhash === 'string' &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.blockhash) &&
    (value.blockTime === null || (Number.isSafeInteger(value.blockTime) && (value.blockTime as number) > 0)) &&
    Array.isArray(value.transactions) &&
    value.transactions.every((item) => isRecord(item) &&
      isRecord(item.transaction) &&
      Array.isArray(item.transaction.signatures) &&
      isRecord(item.transaction.message) &&
      Array.isArray(item.transaction.message.instructions) &&
      isRecord(item.meta) &&
      'err' in item.meta);
}

export function isSuccessfulSolanaTransaction(value: unknown): boolean {
  return isRecord(value) && 'err' in value && value.err === null;
}

function solanaBlocksHaveCompleteMatchingTransactions(left: SolanaBlock, right: SolanaBlock): boolean {
  if (left.transactions.length !== right.transactions.length) return false;
  const leftSignatures = left.transactions.map(({ transaction }) => transaction.signatures[0]);
  const rightSignatures = right.transactions.map(({ transaction }) => transaction.signatures[0]);
  if (leftSignatures.some((signature) =>
    typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature)) ||
      rightSignatures.some((signature) =>
        typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature))) {
    return false;
  }
  const leftSet = new Set(leftSignatures);
  const rightSet = new Set(rightSignatures);
  return leftSet.size === leftSignatures.length &&
    rightSet.size === rightSignatures.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((signature) => rightSet.has(signature));
}

function matchingSolanaPair(
  blocks: Array<{ provider: ProviderEndpoint; block: SolanaBlock }>,
): Array<{ provider: ProviderEndpoint; block: SolanaBlock }> {
  const groups = new Map<string, Array<{ provider: ProviderEndpoint; block: SolanaBlock }>>();
  for (const item of blocks) {
    groups.set(item.block.blockhash, [
      ...(groups.get(item.block.blockhash) ?? []),
      item,
    ]);
  }
  for (const group of [...groups.values()].sort((left, right) => right.length - left.length)) {
    const pair = firstDistinctOperatorPair(group);
    if (pair) return pair;
  }
  return [];
}

async function solanaRpc(
  provider: ProviderEndpoint,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const timedProvider = {
    ...provider,
    timeoutMs: method === 'getBlock'
      ? provider.blockTimeoutMs ?? ONCHAIN_SOURCE_CONFIG.requestTimeoutMs
      : ONCHAIN_SOURCE_CONFIG.requestTimeoutMs,
  };
  const payload = await requestJson(timedProvider, { jsonrpc: '2.0', id: 1, method, params });
  if (!isRecord(payload) || payload.error !== undefined || !('result' in payload)) {
    throw new Error(`${provider.sourceId} returned an invalid ${method} response.`);
  }
  return payload.result;
}

async function scanSolana(
  nowMs: number,
  blockCount: number,
  nextBlock: number | undefined,
): Promise<PublicWhaleAssetScan> {
  const providers = solanaProviders();
  const slotResults = await Promise.allSettled(providers.map(async (provider) => {
    const [genesisHash, slot] = await Promise.all([
      solanaRpc(provider, 'getGenesisHash', []),
      solanaRpc(provider, 'getSlot', [{ commitment: 'finalized' }]),
    ]);
    if (!isValidSolanaMainnetGenesisHash(genesisHash)) {
      throw new Error(`${provider.sourceId} is not on Solana mainnet (unexpected genesis hash).`);
    }
    return { provider, slot };
  }));
  slotResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `[PublicWhaleObservationPoller] SOL source ${providers[index].sourceId} failed mainnet/slot health: ${errorText(result.reason)}`,
      );
    }
  });
  const availableSlots = slotResults.flatMap((result) =>
    result.status === 'fulfilled' && Number.isSafeInteger(result.value.slot) &&
    (result.value.slot as number) > 0
      ? [{
          provider: result.value.provider,
          sourceId: result.value.provider.sourceId,
          operatorId: result.value.provider.operatorId,
          independent: result.value.provider.independent,
          height: result.value.slot as number,
          slot: result.value.slot as number,
        }]
      : []);
  const inSyncSlots = filterSourcesByMedianHeight(
    'SOL',
    availableSlots,
    ONCHAIN_SOURCE_CONFIG.maxSolanaSlotLag,
  );
  const inSyncSourceIds = new Set(inSyncSlots.map(({ sourceId }) => sourceId));
  const eligibleSlots = availableSlots.filter(({ sourceId }) => inSyncSourceIds.has(sourceId));
  const operatorCount = countDistinctWhaleSourceOperators(
    'SOL',
    eligibleSlots.map(({ sourceId }) => sourceId),
  );
  if (operatorCount < 2) {
    const reason = `Solana has only ${operatorCount} healthy independent mainnet RPC operators after genesis/slot-lag filtering.`;
    console.error(`[PublicWhaleObservationPoller] ${reason} Member 6 will abstain.`);
    throw new Error(reason);
  }
  const independentSlots = eligibleSlots
    .filter(({ provider }) => provider.independent && provider.operatorId)
    .map(({ slot }) => slot);
  const endSlot = Math.min(...independentSlots);
  const range = getMember6BlockRange(endSlot, nextBlock, blockCount);
  if (!range) {
    if (nextBlock === undefined) throw new Error('SOL initial slot cursor could not be established.');
    return { observedTransfers: [], nextBlock };
  }
  const minSol = positiveNumberEnv('SBK1_WHALE_MIN_SOL', SOL_MIN_TRANSFER, 100_000_000);
  const transfers: QuorumObservedTransfer[] = [];
  for (let slot = range.fromBlock; slot <= range.throughBlock; slot += 1) {
    const blockResults = await Promise.allSettled(eligibleSlots.map(async ({ provider }) => ({
      provider,
      block: await solanaRpc(provider, 'getBlock', buildSolanaGetBlockParams(slot)),
    })));
    const matchingPair = matchingSolanaPair(blockResults.flatMap((result) =>
      result.status === 'fulfilled' && isSolanaBlock(result.value.block)
        ? [{ provider: result.value.provider, block: result.value.block }]
        : []));
    if (matchingPair.length === 0 &&
        blockResults.every((result) => result.status === 'fulfilled' && result.value.block === null)) continue;
    if (matchingPair.length < 2) {
      const evidence = blockResults.map((result, index) => {
        if (result.status === 'rejected') return `${eligibleSlots[index].provider.sourceId}: ${errorText(result.reason)}`;
        if (!isSolanaBlock(result.value.block)) return `${eligibleSlots[index].provider.sourceId}: no block`;
        return `${eligibleSlots[index].provider.sourceId}: ${result.value.block.blockhash.slice(0, 12)}`;
      });
      throw new Error(`Solana RPC operators disagree on finalized slot ${slot} (${evidence.join(', ')}).`);
    }
    const [left, right] = matchingPair;
    if (left.block.blockTime === null || right.block.blockTime !== left.block.blockTime) continue;
    if (!solanaBlocksHaveCompleteMatchingTransactions(left.block, right.block)) {
      throw new Error(`Solana RPC operators returned incomplete transaction lists for finalized slot ${slot}.`);
    }
    const timestampMs = left.block.blockTime * 1_000;
    if (timestampMs > nowMs ||
        nowMs - timestampMs > ONCHAIN_SOURCE_CONFIG.maxHistoricalBlockAgeMs) continue;
    const rightTransactions = new Map(right.block.transactions
      .map((item) => [item.transaction.signatures[0], item] as const)
      .filter((entry): entry is readonly [string, SolanaBlock['transactions'][number]] =>
        typeof entry[0] === 'string'));
    for (const item of left.block.transactions) {
      const signature = item.transaction.signatures[0];
      if (typeof signature !== 'string' ||
          !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature) ||
          !rightTransactions.has(signature)) continue;
      const matching = rightTransactions.get(signature)!;
      const leftSucceeded = isSuccessfulSolanaTransaction(item.meta);
      const rightSucceeded = isSuccessfulSolanaTransaction(matching.meta);
      if (leftSucceeded !== rightSucceeded) {
        console.warn(
          `[PublicWhaleObservationPoller] SOL operators disagree on execution status for ${signature}; transfer excluded.`,
        );
        continue;
      }
      if (!leftSucceeded) continue;
      item.transaction.message.instructions.forEach((instruction, index) => {
        if (!isRecord(instruction) || instruction.program !== 'system' ||
            !isRecord(instruction.parsed) || instruction.parsed.type !== 'transfer' ||
            !isRecord(instruction.parsed.info) ||
            typeof instruction.parsed.info.source !== 'string' ||
            typeof instruction.parsed.info.destination !== 'string' ||
            !Number.isSafeInteger(instruction.parsed.info.lamports)) return;
        const amount = (instruction.parsed.info.lamports as number) / 1e9;
        if (amount < minSol) return;
        transfers.push({
          assetSymbol: 'SOL',
          blockchain: 'solana',
          transactionHash: signature,
          transferId: `instruction:${index}`,
          timestampMs,
          amount,
          unit: 'SOL',
          blockHeight: slot,
          sourceIds: [left.provider.sourceId, right.provider.sourceId],
          confirmationStatus: 'CONFIRMED',
          fromAddresses: [instruction.parsed.info.source],
          toAddresses: [instruction.parsed.info.destination],
        });
      });
    }
  }
  return { observedTransfers: transfers, nextBlock: range.nextBlock };
}

function isXrpLedger(value: unknown): value is XrpLedger {
  return isRecord(value) &&
    typeof value.ledger_hash === 'string' && /^[a-f0-9]{64}$/i.test(value.ledger_hash) &&
    Number.isSafeInteger(Number(value.ledger_index)) &&
    Number.isSafeInteger(value.close_time) &&
    Array.isArray(value.transactions) &&
    value.transactions.every((tx) => isRecord(tx) &&
      typeof tx.hash === 'string' && /^[a-f0-9]{64}$/i.test(tx.hash));
}

function xrpTransaction(tx: XrpLedger['transactions'][number]) {
  return tx.tx_json ?? tx.tx ?? tx;
}

export function xrpDeliveredAmountDrops(
  transaction: XrpLedger['transactions'][number],
): string | null {
  const metadata = transaction.meta ?? transaction.metaData ?? transaction.tx_json?.meta;
  if (metadata?.TransactionResult !== 'tesSUCCESS' ||
      typeof metadata.delivered_amount !== 'string' ||
      !/^\d+$/.test(metadata.delivered_amount)) return null;
  return metadata.delivered_amount;
}

function matchingXrpPair(
  ledgers: Array<{ provider: ProviderEndpoint; ledger: XrpLedger }>,
): Array<{ provider: ProviderEndpoint; ledger: XrpLedger }> {
  const groups = new Map<string, Array<{ provider: ProviderEndpoint; ledger: XrpLedger }>>();
  for (const item of ledgers) {
    const key = item.ledger.ledger_hash.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of [...groups.values()].sort((left, right) => right.length - left.length)) {
    const pair = firstDistinctOperatorPair(group);
    if (pair) return pair;
  }
  return [];
}

async function xrpRpc(
  provider: ProviderEndpoint,
  method: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const payload = await requestJson(provider, { method, params });
  if (!isRecord(payload) || !isRecord(payload.result) || payload.result.status === 'error') {
    throw new Error(`${provider.sourceId} returned an invalid ${method} response.`);
  }
  return payload.result;
}

async function scanXrp(
  nowMs: number,
  blockCount: number,
  nextBlock: number | undefined,
): Promise<PublicWhaleAssetScan> {
  const providers = xrpProviders();
  const validatedResults = await Promise.allSettled(providers.map(async (provider) => {
    const [serverInfo, currentLedger, validatedLedger] = await Promise.all([
      xrpRpc(provider, 'server_info', [{}]),
      xrpRpc(provider, 'ledger_current', []),
      xrpRpc(provider, 'ledger', [{ ledger_index: 'validated', transactions: false }]),
    ]);
    const info = isRecord(serverInfo.info) ? serverInfo.info : serverInfo;
    const networkId = info.network_id;
    const currentIndex = Number(
      currentLedger.ledger_current_index ?? currentLedger.ledger_index,
    );
    const validatedIndex = Number(validatedLedger.ledger_index);
    const currentValid = Number.isSafeInteger(currentIndex);
    const validatedValid = Number.isSafeInteger(validatedIndex);
    const lag = currentValid && validatedValid ? currentIndex - validatedIndex : null;
    const reasons: string[] = [];
    if (!isValidXrpMainnetNetworkId(networkId)) reasons.push('network_id is not 0');
    if (!currentValid) reasons.push('current ledger index is invalid');
    if (!validatedValid) reasons.push('validated ledger index is invalid');
    if (lag !== null && currentIndex < validatedIndex) reasons.push('current is below validated');
    if (lag !== null && lag > ONCHAIN_SOURCE_CONFIG.maxXrpLedgerLag) {
      reasons.push(`lag exceeds ${ONCHAIN_SOURCE_CONFIG.maxXrpLedgerLag}`);
    }
    if (reasons.length > 0) {
      throw new Error(
        `${provider.sourceId} XRPL gate rejected: network_id=${String(networkId)}, current=${currentValid ? currentIndex : 'invalid'}, validated=${validatedValid ? validatedIndex : 'invalid'}, lag=${lag ?? 'invalid'}; reason=${reasons.join(', ')}.`,
      );
    }
    return { provider, index: validatedIndex, currentIndex };
  }));
  validatedResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `[PublicWhaleObservationPoller] XRP source ${providers[index].sourceId} failed network/ledger health: ${errorText(result.reason)}`,
      );
    }
  });
  const availableLedgers = validatedResults.flatMap((result) =>
    result.status === 'fulfilled' && Number.isSafeInteger(Number(result.value.index))
      ? [{
          ...result.value,
          sourceId: result.value.provider.sourceId,
          operatorId: result.value.provider.operatorId,
          independent: result.value.provider.independent,
          height: Number(result.value.index),
          index: Number(result.value.index),
        }]
      : []);
  const inSyncLedgers = filterSourcesByMedianHeight(
    'XRP',
    availableLedgers,
    ONCHAIN_SOURCE_CONFIG.maxXrpLedgerLag,
  );
  const inSyncSourceIds = new Set(inSyncLedgers.map(({ sourceId }) => sourceId));
  const eligibleLedgers = availableLedgers.filter(({ sourceId }) => inSyncSourceIds.has(sourceId));
  const operatorCount = countDistinctWhaleSourceOperators(
    'XRP',
    eligibleLedgers.map(({ sourceId }) => sourceId),
  );
  if (operatorCount < 2) {
    const reason = `XRPL has only ${operatorCount} healthy independent mainnet operators after network/ledger-lag filtering.`;
    console.error(`[PublicWhaleObservationPoller] ${reason} Member 6 will abstain.`);
    throw new Error(reason);
  }
  const independentIndexes = eligibleLedgers
    .filter(({ provider }) => provider.independent && provider.operatorId)
    .map(({ index }) => index);
  const endLedger = Math.min(...independentIndexes);
  const range = getMember6BlockRange(endLedger, nextBlock, blockCount);
  if (!range) {
    if (nextBlock === undefined) throw new Error('XRP initial ledger cursor could not be established.');
    return { observedTransfers: [], nextBlock };
  }
  const minXrp = positiveNumberEnv('SBK1_WHALE_MIN_XRP', XRP_MIN_TRANSFER, 1_000_000_000);
  const transfers: QuorumObservedTransfer[] = [];
  for (let ledgerIndex = range.fromBlock; ledgerIndex <= range.throughBlock; ledgerIndex += 1) {
    const results = await Promise.allSettled(eligibleLedgers.map(async ({ provider }) => {
      const result = await xrpRpc(provider, 'ledger', [{
        ledger_index: ledgerIndex,
        transactions: true,
        expand: true,
      }]);
      return { provider, ledger: result.ledger };
    }));
    const matchingPair = matchingXrpPair(results.flatMap((result) =>
      result.status === 'fulfilled' &&
      isXrpLedger(result.value.ledger) &&
      Number(result.value.ledger.ledger_index) === ledgerIndex
        ? [{ provider: result.value.provider, ledger: result.value.ledger }]
        : []));
    if (matchingPair.length < 2) {
      const evidence = results.map((result, index) => {
        if (result.status === 'rejected') return `${eligibleLedgers[index].provider.sourceId}: ${errorText(result.reason)}`;
        if (!isXrpLedger(result.value.ledger)) return `${eligibleLedgers[index].provider.sourceId}: invalid ledger`;
        return `${eligibleLedgers[index].provider.sourceId}: ${result.value.ledger.ledger_hash.slice(0, 12)}`;
      });
      throw new Error(`XRPL operators disagree on validated ledger ${ledgerIndex} (${evidence.join(', ')}).`);
    }
    const [left, right] = matchingPair;
    const leftRaw = left.ledger;
    const rightRaw = right.ledger;
    if (leftRaw.close_time !== rightRaw.close_time) {
      throw new Error(`XRPL operators disagree on validated ledger ${ledgerIndex} close time.`);
    }
    const timestampMs = (leftRaw.close_time + XRP_EPOCH_SECONDS) * 1_000;
    if (timestampMs > nowMs ||
        nowMs - timestampMs > ONCHAIN_SOURCE_CONFIG.maxHistoricalBlockAgeMs) continue;
    const rightTransactions = new Map(rightRaw.transactions
      .map((tx) => [tx.hash.toLowerCase(), tx]));
    for (const tx of leftRaw.transactions) {
      const transaction = xrpTransaction(tx);
      if (transaction.TransactionType !== 'Payment' ||
          typeof transaction.Amount !== 'string' || !/^\d+$/.test(transaction.Amount)) continue;
      const matching = rightTransactions.get(tx.hash.toLowerCase());
      const match = matching ? xrpTransaction(matching) : null;
      const deliveredAmount = xrpDeliveredAmountDrops(tx);
      const matchingDeliveredAmount = matching ? xrpDeliveredAmountDrops(matching) : null;
      if (match?.TransactionType !== 'Payment' ||
          match.Amount !== transaction.Amount ||
          deliveredAmount === null ||
          deliveredAmount !== matchingDeliveredAmount) continue;
      const amount = Number(deliveredAmount) / 1_000_000;
      if (!Number.isFinite(amount) || amount < minXrp) continue;
      transfers.push({
        assetSymbol: 'XRP',
        blockchain: 'xrpledger',
        transactionHash: tx.hash,
        transferId: 'payment:0',
        timestampMs,
        amount,
        unit: 'XRP',
        blockHeight: ledgerIndex,
        sourceIds: [left.provider.sourceId, right.provider.sourceId],
        confirmationStatus: 'CONFIRMED',
        fromAddresses: typeof transaction.Account === 'string' &&
          transaction.Account === match?.Account
          ? [transaction.Account]
          : [],
        toAddresses: typeof transaction.Destination === 'string' &&
          transaction.Destination === match?.Destination
          ? [transaction.Destination]
          : [],
      });
    }
  }
  return { observedTransfers: transfers, nextBlock: range.nextBlock };
}

function emptyAssetRecord<T>(): Record<QuorumAsset, T[]> {
  return { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] };
}

function normalizeProfileAddress(asset: QuorumAsset, address: string): string {
  if (asset === 'ETH' || asset === 'BNB') return address.toLowerCase();
  if (asset === 'BTC' && address.toLowerCase().startsWith('bc1')) return address.toLowerCase();
  return address;
}

async function fetchSpotUsdPrice(
  asset: QuorumAsset,
): Promise<{ value: number; sourceTimestampMs: number; retrievedAtMs: number }> {
  const provider = endpoint(
    `binance-public-${asset.toLowerCase()}-price`,
    `https://api.binance.com/api/v3/avgPrice?symbol=${asset}USDT`,
  );
  const payload = await requestJson(provider);
  if (!isRecord(payload) || payload.mins !== 5) {
    throw new Error(`Binance public ${asset}/USDT price response is malformed.`);
  }
  const value = Number(payload.price);
  const sourceTimestampMs = payload.closeTime;
  const retrievedAtMs = Date.now();
  if (!Number.isFinite(value) || value <= 0 ||
      typeof sourceTimestampMs !== 'number' ||
      !Number.isSafeInteger(sourceTimestampMs) ||
      sourceTimestampMs > retrievedAtMs ||
      retrievedAtMs - sourceTimestampMs > ONCHAIN_SOURCE_CONFIG.maxPriceAgeMs) {
    throw new Error(`Binance public ${asset}/USDT price is invalid.`);
  }
  return { value, sourceTimestampMs, retrievedAtMs };
}

let pollTimer: NodeJS.Timeout | null = null;
let candleCloseTimer: NodeJS.Timeout | null = null;
let pollInFlight: Promise<void> | null = null;
let pollPendingAtCandleClose = false;
let pollerStopping = false;
let walletHistoryTimer: NodeJS.Timeout | null = null;
let walletHistoryInFlight: Promise<void> | null = null;

export function nextMember6CandleCloseMs(nowMs = Date.now()): number {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('Member 6 candle-close scheduling timestamp is invalid.');
  }
  return (Math.floor(nowMs / MEMBER6_CANDLE_INTERVAL_MS) + 1) *
    MEMBER6_CANDLE_INTERVAL_MS;
}

export interface PublicWhaleObservationPollResult {
  path: string;
  observedByAsset: Record<QuorumAsset, number>;
  candidatesByAsset: Record<QuorumAsset, number>;
  nextBlockByAsset: Partial<Record<QuorumAsset, number>>;
  unavailableAssets: Partial<Record<QuorumAsset, string>>;
  rejectedByAsset: Record<QuorumAsset, number>;
  scanCycleMsByAsset: Record<QuorumAsset, number>;
  diagnosticsByAsset: Record<QuorumAsset, QuorumAssetPollDiagnosticsInput & {
    persistedCandidateCount: number;
    rejectedCandidateCount: number;
  }>;
}

async function scanPublicWhaleAssetWithCursor(
  asset: QuorumAsset,
  nowMs = Date.now(),
  blockCount = Math.floor(
    positiveNumberEnv('SBK1_WHALE_BOOTSTRAP_BLOCKS', DEFAULT_BOOTSTRAP_BLOCKS, MAX_BOOTSTRAP_BLOCKS),
  ),
  nextBlock?: number,
): Promise<PublicWhaleAssetScan> {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      !Number.isSafeInteger(blockCount) || blockCount <= 0 || blockCount > MAX_BOOTSTRAP_BLOCKS) {
    throw new Error('Public whale observation scan settings are invalid.');
  }
  switch (asset) {
    case 'BTC': return scanBitcoin(nowMs, blockCount, nextBlock);
    case 'ETH':
    case 'BNB': return scanEvm(asset, nowMs, blockCount, nextBlock);
    case 'SOL': return scanSolana(nowMs, blockCount, nextBlock);
    case 'XRP': return scanXrp(nowMs, blockCount, nextBlock);
  }
}

export async function scanPublicWhaleAsset(
  asset: QuorumAsset,
  nowMs = Date.now(),
  blockCount = Math.floor(
    positiveNumberEnv('SBK1_WHALE_BOOTSTRAP_BLOCKS', DEFAULT_BOOTSTRAP_BLOCKS, MAX_BOOTSTRAP_BLOCKS),
  ),
): Promise<QuorumObservedTransfer[]> {
  return (await scanPublicWhaleAssetWithCursor(asset, nowMs, blockCount)).observedTransfers;
}

export async function pollPublicWhaleObservations(options: {
  nowMs?: number;
  blockCount?: number;
  filePath?: string;
} = {}): Promise<PublicWhaleObservationPollResult> {
  const nowMs = options.nowMs ?? Date.now();
  const blockCount = options.blockCount ??
    Math.floor(positiveNumberEnv('SBK1_WHALE_BOOTSTRAP_BLOCKS', DEFAULT_BOOTSTRAP_BLOCKS, MAX_BOOTSTRAP_BLOCKS));
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      !Number.isSafeInteger(blockCount) || blockCount <= 0 || blockCount > MAX_BOOTSTRAP_BLOCKS) {
    throw new Error('Public whale observation poller settings are invalid.');
  }
  const observedTransfers = emptyAssetRecord<QuorumObservedTransfer>();
  const candidatesByAsset = emptyAssetRecord<QuorumCandidateRecord>();
  const aggregateExchangeFlowsByAsset = emptyAssetRecord<QuorumAggregateExchangeFlowObservation>();
  const unavailableAssets: Partial<Record<QuorumAsset, string>> = {};
  const scanErrors: Partial<Record<QuorumAsset, string>> = {};
  const priceErrors: Partial<Record<QuorumAsset, string>> = {};
  const scanCycleMsByAsset = {} as Record<QuorumAsset, number>;
  const cursorStore = await loadMember6BlockCursorStore();
  const nextBlockByAsset = { ...cursorStore.nextBlockByAsset };
  let cursorAdvanced = false;
  await Promise.all(QUORUM_ASSETS.map(async (asset) => {
    const startedAtMs = Date.now();
    try {
      const scan = await scanPublicWhaleAssetWithCursor(
        asset,
        nowMs,
        blockCount,
        cursorStore.nextBlockByAsset[asset],
      );
      observedTransfers[asset] = scan.observedTransfers;
      if (nextBlockByAsset[asset] !== scan.nextBlock) {
        nextBlockByAsset[asset] = scan.nextBlock;
        cursorAdvanced = true;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      unavailableAssets[asset] = reason;
      scanErrors[asset] = reason;
      console.warn(`[PublicWhaleObservationPoller] ${asset} scan unavailable; Member 6 remains fail-closed:`, reason);
    } finally {
      scanCycleMsByAsset[asset] = Date.now() - startedAtMs;
      const log = scanCycleMsByAsset[asset] > ONCHAIN_SOURCE_CONFIG.maxScanCycleMs
        ? console.warn
        : console.info;
      log(
        `[PublicWhaleObservationPoller] ${asset} scan cycle took ${scanCycleMsByAsset[asset]}ms.${
          scanCycleMsByAsset[asset] > ONCHAIN_SOURCE_CONFIG.maxScanCycleMs
            ? ' WARNING: exceeded the 300-second target.'
            : ''
        }`,
      );
    }
  }));
  const exchangeAddresses = await loadExchangeAddressRegistry();
  const prices = {} as Partial<Record<QuorumAsset, { value: number; sourceTimestampMs: number; retrievedAtMs: number }>>;
  await Promise.all(QUORUM_ASSETS.map(async (asset) => {
    if (observedTransfers[asset].length === 0) return;
    try {
      prices[asset] = await fetchSpotUsdPrice(asset);
    } catch (error) {
      const reason = errorText(error);
      unavailableAssets[asset] = `Public USD price unavailable: ${reason}`;
      priceErrors[asset] = reason;
      console.warn(`[PublicWhaleObservationPoller] ${asset} valuation unavailable:`, reason);
    }
  }));
  const tracking = await trackObservedWalletProfiles({
    observedTransfers,
    exchangeAddresses,
    pricesUsd: Object.fromEntries(QUORUM_ASSETS.flatMap((asset) =>
      prices[asset] ? [[asset, prices[asset]!.value]] : [])) as Partial<Record<QuorumAsset, number>>,
    nowMs: Math.max(nowMs, Date.now()),
  });
  console.info(
    `[PublicWhaleObservationPoller] Wallet profiles updated: ${tracking.newEvents} new address-events across ${tracking.trackedAddresses} wallets; ${tracking.flaggedWhales} meet the observed-volume threshold.`,
  );
  const networkMetricsByAsset = {} as Record<
    QuorumAsset,
    Record<string, number | string | null>
  >;
  await Promise.all(QUORUM_ASSETS.map(async (asset) => {
    try {
      const previousMetrics = await loadQuorumCandidateNetworkMetrics(asset, options.filePath);
      networkMetricsByAsset[asset] = await collectMember6FeeMetrics(asset, previousMetrics);
    } catch (error) {
      const reason = errorText(error);
      console.error(`[PublicWhaleObservationPoller] ${asset} fee telemetry failed:`, reason);
      networkMetricsByAsset[asset] = {
        fee_status: 'UNAVAILABLE',
        fee_metric: null,
        fee_unit: null,
        fee_value: null,
        fee_operator_count: 0,
        fee_source_ids: '',
        fee_observed_at_ms: Date.now(),
        fee_unavailable_reason: reason,
        fee_spike_status: 'UNAVAILABLE',
        fee_spike_ratio: null,
        fee_baseline_value: null,
        fee_baseline_source_ids: '',
        fee_baseline_operator_count: 0,
        fee_baseline_sample_count: 0,
        fee_baseline_span_ms: 0,
        fee_history_json: '[]',
      };
    }
  }));
  const diagnosticsByAsset = {} as Record<QuorumAsset, QuorumAssetPollDiagnosticsInput>;
  const matchedAddressTransferCounts = {} as Record<QuorumAsset, number>;
  const exchangeAttributedTransferCounts = {} as Record<QuorumAsset, number>;
  for (const asset of QUORUM_ASSETS) {
    const chainAddresses = exchangeAddresses.filter(({ chain }) => chain === asset);
    const price = prices[asset];
    const transfers = observedTransfers[asset];
    const profileAddresses = [...new Set(transfers.flatMap((transfer) => [
      ...(transfer.fromAddresses ?? []),
      ...(transfer.toAddresses ?? []),
    ]))];
    let behaviorByAddress: ReadonlyMap<string, WhaleBehaviorSummary>;
    try {
      behaviorByAddress = getWhaleBehaviors(asset, profileAddresses);
    } catch (error) {
      console.error(
        `[PublicWhaleObservationPoller] ${asset} wallet profile lookup failed; Channel 1 will reject unprofiled transfers:`,
        errorText(error),
      );
      behaviorByAddress = new Map(profileAddresses.map((address) => [
        normalizeProfileAddress(asset, address),
        { isWhale: false, behaviorTag: 'UNKNOWN', confidenceScore: 0 },
      ]));
    }
    const priceIsFresh = price !== undefined &&
      price.sourceTimestampMs <= nowMs &&
      price.retrievedAtMs <= nowMs &&
      nowMs - price.sourceTimestampMs <= 5 * 60_000 &&
      nowMs - price.retrievedAtMs <= 5 * 60_000;
    if (priceIsFresh && transfers.length > 0) {
      aggregateExchangeFlowsByAsset[asset] = transfers.flatMap((transfer) => {
        const attribution = classifyExchangeTransfer(exchangeAddresses, {
          chain: asset,
          fromAddresses: transfer.fromAddresses ?? [],
          toAddresses: transfer.toAddresses ?? [],
        });
        if (attribution.direction === 'UNKNOWN' ||
            countDistinctWhaleSourceOperators(asset, transfer.sourceIds) < 2) return [];
        const estimatedUsd = transfer.amount * price.value;
        if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) return [];
        return [{
          blockchain: transfer.blockchain,
          transactionHash: transfer.transactionHash,
          transferId: transfer.transferId,
          timestampMs: transfer.timestampMs,
          direction: attribution.direction,
          amount: transfer.amount,
          estimatedUsd,
          exchangeName: attribution.exchange.exchange,
          exchangeAddress: attribution.exchange.address,
          attributionSourceId: 'local-exchange-address-list' as const,
          sourceIds: [...new Set(transfer.sourceIds)],
        }];
      });
    }
    matchedAddressTransferCounts[asset] = transfers.filter((transfer) =>
      [...(transfer.fromAddresses ?? []), ...(transfer.toAddresses ?? [])]
        .some((address) => findHighConfidenceExchangeAddress(chainAddresses, asset, address) !== null),
    ).length;
    exchangeAttributedTransferCounts[asset] = transfers.filter((transfer) =>
      classifyExchangeTransfer(chainAddresses, {
        chain: asset,
        fromAddresses: transfer.fromAddresses ?? [],
        toAddresses: transfer.toAddresses ?? [],
      }).direction !== 'UNKNOWN',
    ).length;
    if (chainAddresses.length > 0 && price && transfers.length > 0) {
      candidatesByAsset[asset] = transfers.flatMap((transfer) => {
        const candidate = createAttributedQuorumCandidate(
          transfer,
          chainAddresses,
          price,
          Math.max(nowMs, price.retrievedAtMs),
        );
        if (!candidate) return [];
        const senderAddress = transfer.fromAddresses?.length === 1
          ? transfer.fromAddresses[0]
          : null;
        const receiverAddress = transfer.toAddresses?.length === 1
          ? transfer.toAddresses[0]
          : null;
        return [{
          ...candidate,
          senderAddress,
          receiverAddress,
          senderIsExchange: senderAddress !== null &&
            findHighConfidenceExchangeAddress(chainAddresses, asset, senderAddress) !== null,
          receiverIsExchange: receiverAddress !== null &&
            findHighConfidenceExchangeAddress(chainAddresses, asset, receiverAddress) !== null,
          senderProfile: senderAddress
            ? behaviorByAddress.get(normalizeProfileAddress(asset, senderAddress)) ??
              { isWhale: false, behaviorTag: 'UNKNOWN', confidenceScore: 0 }
            : { isWhale: false, behaviorTag: 'UNKNOWN', confidenceScore: 0 },
          receiverProfile: receiverAddress
            ? behaviorByAddress.get(normalizeProfileAddress(asset, receiverAddress)) ??
              { isWhale: false, behaviorTag: 'UNKNOWN', confidenceScore: 0 }
            : { isWhale: false, behaviorTag: 'UNKNOWN', confidenceScore: 0 },
        }];
      });
    }
    diagnosticsByAsset[asset] = {
      scanError: scanErrors[asset] ?? null,
      priceError: priceErrors[asset] ?? null,
      observedTransferCount: transfers.length,
      configuredAddressCount: chainAddresses.length,
      matchedAddressTransferCount: matchedAddressTransferCounts[asset],
      exchangeAttributedTransferCount: exchangeAttributedTransferCounts[asset],
      priceAvailable: transfers.length === 0 ? null : price !== undefined,
      generatedCandidateCount: candidatesByAsset[asset].length,
    };
  }
  const historicalCandidatesByAsset = { ...candidatesByAsset };
  const completedAtMs = Math.max(nowMs, Date.now());
  const writeResult = await writeQuorumCandidateSnapshot(candidatesByAsset, {
    nowMs: completedAtMs,
    filePath: options.filePath,
    historicalCandidatesByAsset,
    observedTransfersByAsset: observedTransfers,
    aggregateExchangeFlowsByAsset,
    networkMetricsByAsset,
    diagnosticsByAsset,
  });
  if (cursorAdvanced) {
    const updatedCursorStore: Member6BlockCursorStore = {
      version: 1,
      nextBlockByAsset,
    };
    await writeMember6BlockCursorStore(updatedCursorStore);
  }
  const fullDiagnosticsByAsset = Object.fromEntries(QUORUM_ASSETS.map((asset) => [
    asset,
    {
      ...diagnosticsByAsset[asset],
      persistedCandidateCount: writeResult.persistedByAsset[asset],
      rejectedCandidateCount: writeResult.rejectedCandidatesByAsset[asset],
    },
  ])) as PublicWhaleObservationPollResult['diagnosticsByAsset'];
  const result = {
    path: writeResult.path,
    observedByAsset: Object.fromEntries(QUORUM_ASSETS.map((asset) =>
      [asset, observedTransfers[asset].length])) as Record<QuorumAsset, number>,
    candidatesByAsset: writeResult.persistedByAsset,
    nextBlockByAsset,
    unavailableAssets,
    rejectedByAsset: writeResult.rejectedByAsset,
    scanCycleMsByAsset,
    diagnosticsByAsset: fullDiagnosticsByAsset,
  };
  console.info(
    `[PublicWhaleObservationPoller] Snapshot heartbeat written; cursors=${JSON.stringify(result.nextBlockByAsset)}; per-asset pipeline=${JSON.stringify(result.diagnosticsByAsset)}.`,
  );
  return result;
}

export function startPublicWhaleObservationPoller(): void {
  if (pollTimer || candleCloseTimer || walletHistoryTimer) return;
  pollerStopping = false;
  const run = (isCandleClose = false) => {
    if (pollerStopping) return;
    if (pollInFlight) {
      if (isCandleClose) pollPendingAtCandleClose = true;
      return;
    }
    pollInFlight = pollPublicWhaleObservations()
        .then(() => undefined)
        .catch((error) => {
          console.error('[PublicWhaleObservationPoller] Poll failed:', error);
        })
      .finally(() => {
        pollInFlight = null;
        if (pollPendingAtCandleClose && !pollerStopping) {
          pollPendingAtCandleClose = false;
          run();
        }
      });
  };
  run();
  pollTimer = setInterval(run, ONCHAIN_SOURCE_CONFIG.pollIntervalMs);
  pollTimer.unref();
  const scheduleCandleClosePoll = () => {
    if (pollerStopping) return;
    const nowMs = Date.now();
    const nextCloseMs = nextMember6CandleCloseMs(nowMs);
    candleCloseTimer = setTimeout(() => {
      candleCloseTimer = null;
      scheduleCandleClosePoll();
      console.info('[PublicWhaleObservationPoller] 15-minute candle-close observation requested.');
      run(true);
    }, nextCloseMs - nowMs);
    candleCloseTimer.unref();
  };
  scheduleCandleClosePoll();
  const runWalletHistory = () => {
    if (walletHistoryInFlight) return;
    walletHistoryInFlight = syncPublicWalletHistories({ maxProfiles: 1 })
      .then(() => undefined)
      .catch((error) => {
        console.error('[WalletHistory] Profile history sync failed:', error);
      })
      .finally(() => {
        walletHistoryInFlight = null;
      });
  };
  runWalletHistory();
  walletHistoryTimer = setInterval(runWalletHistory, WALLET_HISTORY_SYNC_INTERVAL_MS);
  walletHistoryTimer.unref();
}

export async function stopPublicWhaleObservationPoller(): Promise<void> {
  pollerStopping = true;
  if (pollTimer) clearInterval(pollTimer);
  if (candleCloseTimer) clearTimeout(candleCloseTimer);
  if (walletHistoryTimer) clearInterval(walletHistoryTimer);
  pollTimer = null;
  candleCloseTimer = null;
  walletHistoryTimer = null;
  await Promise.all([pollInFlight, walletHistoryInFlight]);
  pollPendingAtCandleClose = false;
}
