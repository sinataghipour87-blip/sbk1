import {
  countDistinctWhaleSourceOperators,
  getWhaleSourceOperator,
  QUORUM_ASSETS,
  writeQuorumCandidateSnapshot,
  type QuorumAsset,
  type QuorumCandidateRecord,
  type QuorumObservedTransfer,
} from './whaleConsensusCandidateRegistry';
import {
  createAttributedQuorumCandidate,
  loadExchangeAddressRegistry,
} from './exchangeAddressRegistry';
import { trackUnknownWhaleAddresses } from './whaleAddressTracker';

const BTC_MIN_TRANSFER = 10;
const ETH_MIN_TRANSFER = 100;
const BNB_MIN_TRANSFER = 1_000;
const SOL_MIN_TRANSFER = 1_000;
const XRP_MIN_TRANSFER = 1_000_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_BOOTSTRAP_BLOCKS = 2;
const MAX_BOOTSTRAP_BLOCKS = 12;
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
  maxHistoricalBlockAgeMs: 15 * 24 * 60 * 60_000,
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
    tx_json?: {
      TransactionType?: string;
      Account?: string;
      Destination?: string;
      Amount?: string | { value?: string; currency?: string; issuer?: string };
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
  for (const url of provider.urls) {
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
          if (endpointAttempt + 1 < maxEndpointAttempts || url !== provider.urls[provider.urls.length - 1]) {
            const delay = Math.min(
              ONCHAIN_SOURCE_CONFIG.requestRetryBaseMs * (2 ** attempt),
              ONCHAIN_SOURCE_CONFIG.requestRetryMaxMs,
            ) + Math.floor(Math.random() * ONCHAIN_SOURCE_CONFIG.requestRetryJitterMs);
            await new Promise((resolve) => setTimeout(resolve, delay));
            attempt += 1;
            continue;
          }
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
        if (error instanceof SourceRateLimitedError) throw error;
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
    ];
  }
  return [
    publicSource('BNB', 'bsc-rpc-publicnode', 'https://bsc-rpc.publicnode.com'),
    publicSource('BNB', 'bsc-rpc-blockrazor', 'https://bsc.blockrazor.xyz'),
    publicSource('BNB', 'bsc-rpc-meowrpc', 'https://bsc.meowrpc.com'),
    publicSource('BNB', 'bsc-rpc-bloxroute', 'https://bsc.rpc.blxrbdn.com'),
    publicSource('BNB', 'bsc-rpc-48club', 'https://rpc-bsc.48.club'),
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
    publicSource('SOL', 'solana-rpc-solana-foundation', 'https://api.mainnet.solana.com'),
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
    publicSource('XRP', 'xrp-rpc-ripple-s2', 'https://s2.ripple.com'),
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
      throw new Error(`${sourceId} exceeded the BTC transaction page limit for block ${blockId}.`);
    }
    const raw = await fetchPage(transactions.length);
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isBtcTransaction)) {
      throw new Error(`${sourceId} returned an invalid or incomplete BTC transaction page.`);
    }
    if (raw.length > transactionCount - transactions.length) {
      throw new Error(`${sourceId} returned excess BTC transactions for block ${blockId}.`);
    }
    for (const transaction of raw) {
      if (seenTransactionIds.has(transaction.txid)) {
        throw new Error(`${sourceId} returned duplicate transactions across BTC pages.`);
      }
      seenTransactionIds.add(transaction.txid);
      transactions.push(transaction);
    }
  }
  if (transactions.length !== transactionCount) {
    throw new Error(`${sourceId} returned an incomplete BTC transaction set.`);
  }
  return transactions;
}

async function scanBitcoin(nowMs: number, blockCount: number): Promise<QuorumObservedTransfer[]> {
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
  const startHeight = Math.min(...inSync.map(({ height }) => height)) - 1;
  const blockSets = await Promise.allSettled(inSync.map(async ({ provider }) => ({
    provider,
    blocks: await fetchBtcBlocks(provider, startHeight, blockCount),
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
    .sort((left, right) => right[0].block.height - left[0].block.height)
    .slice(0, blockCount);
  if (commonBlocks.length === 0) {
    const reason = 'BTC providers returned no matching block headers for the requested scan window.';
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
      console.warn(
        `[PublicWhaleObservationPoller] BTC block ${blockGroup[0].block.height} has fewer than two independent sources with complete transaction pages; skipping the entire block.`,
      );
      continue;
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
  if (completeBlockCount === 0) {
    const reason = 'BTC did not obtain a complete transaction set from two independent sources for any matching block.';
    console.error(`[PublicWhaleObservationPoller] ${reason} Member 6 will abstain.`);
    throw new Error(reason);
  }
  return observations;
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

async function scanEvm(
  asset: 'ETH' | 'BNB',
  nowMs: number,
  blockCount: number,
): Promise<QuorumObservedTransfer[]> {
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
  if (!Number.isSafeInteger(scanEnd) || scanEnd <= 0) return [];
  const minAmount = positiveNumberEnv(
    asset === 'ETH' ? 'SBK1_WHALE_MIN_ETH' : 'SBK1_WHALE_MIN_BNB',
    asset === 'ETH' ? ETH_MIN_TRANSFER : BNB_MIN_TRANSFER,
    1_000_000_000,
  );
  const blockchain = asset === 'ETH' ? 'ethereum' : 'binance-smart-chain';
  const thresholdWei = BigInt(minAmount.toFixed(18).replace('.', ''));
  const transfers: QuorumObservedTransfer[] = [];
  for (let offset = 0; offset < blockCount; offset += 1) {
    const blockNumber = scanEnd - offset;
    if (blockNumber <= 0) break;
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
      console.warn(`[PublicWhaleObservationPoller] ${asset} RPC operators disagree on finalized block ${blockNumber}; skipping it.`);
      continue;
    }
    const [left, right] = matchingPair;
    const rightTransactions = new Map(right.block.transactions.map((tx) => [tx.hash.toLowerCase(), tx]));
    const timestampMs = Number.parseInt(left.block.timestamp, 16) * 1_000;
    if (timestampMs > nowMs ||
        nowMs - timestampMs > ONCHAIN_SOURCE_CONFIG.maxHistoricalBlockAgeMs) continue;
    for (const tx of left.block.transactions) {
      const amountWei = BigInt(tx.value);
      const match = rightTransactions.get(tx.hash.toLowerCase());
      if (!match || match.value.toLowerCase() !== tx.value.toLowerCase() || amountWei < thresholdWei) continue;
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
  return transfers;
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
      Array.isArray(item.transaction.message.instructions));
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

async function scanSolana(nowMs: number, blockCount: number): Promise<QuorumObservedTransfer[]> {
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
  const minSol = positiveNumberEnv('SBK1_WHALE_MIN_SOL', SOL_MIN_TRANSFER, 100_000_000);
  const transfers: QuorumObservedTransfer[] = [];
  for (let offset = 0; offset < blockCount; offset += 1) {
    const slot = endSlot - offset;
    if (slot <= 0) break;
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
    const rightSignatures = new Set(right.block.transactions
      .map(({ transaction }) => transaction.signatures[0])
      .filter((signature): signature is string => typeof signature === 'string'));
    for (const item of left.block.transactions) {
      const signature = item.transaction.signatures[0];
      if (typeof signature !== 'string' ||
          !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature) ||
          !rightSignatures.has(signature)) continue;
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
  return transfers;
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
  return tx.tx_json ?? tx;
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

async function scanXrp(nowMs: number, blockCount: number): Promise<QuorumObservedTransfer[]> {
  const providers = xrpProviders();
  const validatedResults = await Promise.allSettled(providers.map(async (provider) => {
    const [serverInfo, currentLedger, validatedLedger] = await Promise.all([
      xrpRpc(provider, 'server_info', [{}]),
      xrpRpc(provider, 'ledger_current', []),
      xrpRpc(provider, 'ledger', [{ ledger_index: 'validated', transactions: false }]),
    ]);
    const info = isRecord(serverInfo.info) ? serverInfo.info : serverInfo;
    if (!isValidXrpMainnetNetworkId(info.network_id)) {
      throw new Error(`${provider.sourceId} is not on XRPL mainnet (network_id is not 0).`);
    }
    const currentIndex = Number(
      currentLedger.ledger_current_index ?? currentLedger.ledger_index,
    );
    const validatedIndex = Number(validatedLedger.ledger_index);
    if (!Number.isSafeInteger(currentIndex) || !Number.isSafeInteger(validatedIndex) ||
        currentIndex < validatedIndex ||
        currentIndex - validatedIndex > ONCHAIN_SOURCE_CONFIG.maxXrpLedgerLag) {
      throw new Error(`${provider.sourceId} has invalid ledger state or more than 3 ledgers of lag.`);
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
  const minXrp = positiveNumberEnv('SBK1_WHALE_MIN_XRP', XRP_MIN_TRANSFER, 1_000_000_000);
  const transfers: QuorumObservedTransfer[] = [];
  for (let offset = 0; offset < blockCount; offset += 1) {
    const ledgerIndex = endLedger - offset;
    if (ledgerIndex <= 0) break;
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
      if (match?.TransactionType !== 'Payment' || match.Amount !== transaction.Amount) continue;
      const amount = Number(transaction.Amount) / 1_000_000;
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
  return transfers;
}

function emptyAssetRecord<T>(): Record<QuorumAsset, T[]> {
  return { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] };
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
let pollInFlight: Promise<void> | null = null;

export interface PublicWhaleObservationPollResult {
  path: string;
  observedByAsset: Record<QuorumAsset, number>;
  candidatesByAsset: Record<QuorumAsset, number>;
  unavailableAssets: Partial<Record<QuorumAsset, string>>;
  rejectedByAsset: Record<QuorumAsset, number>;
  scanCycleMsByAsset: Record<QuorumAsset, number>;
}

export async function scanPublicWhaleAsset(
  asset: QuorumAsset,
  nowMs = Date.now(),
  blockCount = Math.floor(
    positiveNumberEnv('SBK1_WHALE_BOOTSTRAP_BLOCKS', DEFAULT_BOOTSTRAP_BLOCKS, MAX_BOOTSTRAP_BLOCKS),
  ),
): Promise<QuorumObservedTransfer[]> {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      !Number.isSafeInteger(blockCount) || blockCount <= 0 || blockCount > MAX_BOOTSTRAP_BLOCKS) {
    throw new Error('Public whale observation scan settings are invalid.');
  }
  switch (asset) {
    case 'BTC': return scanBitcoin(nowMs, blockCount);
    case 'ETH':
    case 'BNB': return scanEvm(asset, nowMs, blockCount);
    case 'SOL': return scanSolana(nowMs, blockCount);
    case 'XRP': return scanXrp(nowMs, blockCount);
  }
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
  const unavailableAssets: Partial<Record<QuorumAsset, string>> = {};
  const scanCycleMsByAsset = {} as Record<QuorumAsset, number>;
  await Promise.all(QUORUM_ASSETS.map(async (asset) => {
    const startedAtMs = Date.now();
    try {
      observedTransfers[asset] = await scanPublicWhaleAsset(asset, nowMs, blockCount);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      unavailableAssets[asset] = reason;
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
      console.warn(`[PublicWhaleObservationPoller] ${asset} valuation unavailable:`, reason);
    }
  }));
  try {
    const tracking = await trackUnknownWhaleAddresses({
      observedTransfers,
      exchangeAddresses,
      pricesUsd: Object.fromEntries(QUORUM_ASSETS.flatMap((asset) =>
        prices[asset] ? [[asset, prices[asset]!.value]] : [])) as Partial<Record<QuorumAsset, number>>,
      nowMs: Math.max(nowMs, Date.now()),
    });
    console.info(`[PublicWhaleObservationPoller] Whale address tracker recorded ${tracking.newEvents} new events across ${tracking.trackedAddresses} addresses.`);
  } catch (error) {
    console.warn('[PublicWhaleObservationPoller] Whale address tracking failed:', errorText(error));
  }
  for (const asset of QUORUM_ASSETS) {
    const chainAddresses = exchangeAddresses.filter(({ chain }) => chain === asset);
    const price = prices[asset];
    if (chainAddresses.length === 0 || !price) continue;
    const transfers = observedTransfers[asset];
    if (transfers.length === 0) continue;
    candidatesByAsset[asset] = transfers.flatMap((transfer) => {
      const candidate = createAttributedQuorumCandidate(
        transfer,
        chainAddresses,
        price,
        Math.max(nowMs, price.retrievedAtMs),
      );
      return candidate ? [candidate] : [];
    });
  }
  const historicalCandidatesByAsset = { ...candidatesByAsset };
  const completedAtMs = Math.max(nowMs, Date.now());
  const writeResult = await writeQuorumCandidateSnapshot(candidatesByAsset, {
    nowMs: completedAtMs,
    filePath: options.filePath,
    historicalCandidatesByAsset,
    observedTransfersByAsset: observedTransfers,
  });
  const result = {
    path: writeResult.path,
    observedByAsset: Object.fromEntries(QUORUM_ASSETS.map((asset) =>
      [asset, observedTransfers[asset].length])) as Record<QuorumAsset, number>,
    candidatesByAsset: writeResult.persistedByAsset,
    unavailableAssets,
    rejectedByAsset: writeResult.rejectedByAsset,
    scanCycleMsByAsset,
  };
  console.info(
    `[PublicWhaleObservationPoller] Snapshot heartbeat written; raw observations=${JSON.stringify(result.observedByAsset)}, active candidates=${JSON.stringify(result.candidatesByAsset)}.`,
  );
  return result;
}

export function startPublicWhaleObservationPoller(): void {
  if (pollTimer) return;
  const run = () => {
    if (pollInFlight) return;
    pollInFlight = pollPublicWhaleObservations()
        .then(() => undefined)
        .catch((error) => {
          console.error('[PublicWhaleObservationPoller] Poll failed:', error);
        })
      .finally(() => {
        pollInFlight = null;
      });
  };
  run();
  pollTimer = setInterval(run, ONCHAIN_SOURCE_CONFIG.pollIntervalMs);
  pollTimer.unref();
}

export async function stopPublicWhaleObservationPoller(): Promise<void> {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  await pollInFlight;
}
