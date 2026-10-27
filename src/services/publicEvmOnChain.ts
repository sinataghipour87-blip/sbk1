import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import {
  makeOnChainFlow,
  unavailableOnChainFlow,
} from './onChainCexShared';

const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;
const MAX_BLOCKS_TO_SCAN = 50;
const CONCURRENCY = 5;
const MAX_AGE_MS = 5 * 60_000;
const REQUIRED_CONFIRMATIONS = 12;

interface PublicEvmTransaction {
  hash: string;
  to: string | null;
  value: string;
  blockNumber: string;
}

interface PublicEvmBlock {
  number: string;
  timestamp: string;
  transactions: unknown[];
}

interface Provider {
  name: string;
  endpoint: string;
}

interface CacheEntry {
  cachedAtMs: number;
  value: CouncilWhaleFlowData;
}

const cache = new Map<string, CacheEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value);
}

function parseBlock(value: unknown): PublicEvmBlock | null {
  if (
    !isRecord(value) ||
    !isHex(value.number) ||
    !isHex(value.timestamp) ||
    !Array.isArray(value.transactions)
  ) return null;
  return value as unknown as PublicEvmBlock;
}

function parseTransaction(value: unknown): PublicEvmTransaction | null {
  if (
    !isRecord(value) ||
    typeof value.hash !== 'string' ||
    !/^0x[0-9a-f]{64}$/i.test(value.hash) ||
    (value.to !== null && (typeof value.to !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value.to))) ||
    !isHex(value.value) ||
    !isHex(value.blockNumber)
  ) return null;
  return value as unknown as PublicEvmTransaction;
}

function unitsToNative(value: string): number {
  const amount = BigInt(value);
  const divisor = 10n ** 18n;
  const whole = Number(amount / divisor);
  const fraction = Number(amount % divisor) / Number(divisor);
  return Number.isFinite(whole + fraction) ? whole + fraction : 0;
}

async function jsonRpc(
  fetcher: typeof fetch,
  provider: Provider,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(provider.endpoint, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) {
      const restriction = response.status === 403 || response.status === 451
        ? ' (regional/access restriction)'
        : '';
      throw new Error(`${provider.name} returned HTTP ${response.status}${restriction}.`);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.error || !Object.hasOwn(payload, 'result')) {
      throw new Error(`${provider.name} returned a malformed ${method} response.`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await map(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function unavailable(
  pair: string,
  asset: string,
  provider: string,
  reason: string,
): CouncilWhaleFlowData {
  return unavailableOnChainFlow(pair, asset, provider, reason);
}

export async function fetchPublicEvmOnChainData(options: {
  pair: string;
  asset: 'ETH' | 'BNB';
  blockchain: 'ethereum' | 'binance_smart_chain';
  chainId: 1 | 56;
  providers: readonly Provider[];
  addresses: readonly string[];
  threshold: number;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilWhaleFlowData> {
  const providerLabel = options.chainId === 1
    ? 'Ethereum mainnet public JSON-RPC (chainid=1)'
    : 'BNB Smart Chain public JSON-RPC (chainid=56)';
  if (options.addresses.length === 0) {
    return unavailable(options.pair, options.asset, providerLabel, 'Verified CEX watchlist is not configured.');
  }
  if (!Number.isFinite(options.threshold) || options.threshold <= 0) {
    return unavailable(options.pair, options.asset, providerLabel, 'Native-asset whale threshold must be positive.');
  }
  if (options.providers.length === 0) {
    return unavailable(options.pair, options.asset, providerLabel, 'No public RPC endpoint is configured.');
  }

  const nowMs = options.nowMs ?? Date.now();
  const cached = cache.get(options.pair);
  if (cached && nowMs >= cached.cachedAtMs && nowMs - cached.cachedAtMs < CACHE_TTL_MS) {
    const ageMs = cached.value.timestampMs === null
      ? null
      : Math.max(0, nowMs - cached.value.timestampMs);
    const status = ageMs !== null && ageMs <= MAX_AGE_MS ? 'LIVE' : 'STALE';
    return {
      ...cached.value,
      status,
      ageMs,
      qualityPct: status === 'LIVE' ? cached.value.qualityPct : 0,
      coverageStatus: status === 'LIVE' ? cached.value.coverageStatus : 'UNAVAILABLE',
      unavailableReason: status === 'LIVE'
        ? undefined
        : 'Latest observed chain block is older than five minutes.',
      largeTransfers: cached.value.largeTransfers.map((transfer) => ({
        ...transfer,
        estimatedUsd: typeof options.priceUsd === 'number' &&
          Number.isFinite(options.priceUsd) &&
          options.priceUsd > 0
          ? transfer.amount * options.priceUsd
          : null,
      })),
    };
  }

  const fetcher = options.fetcher ?? fetch;
  const providerErrors: string[] = [];
  for (const provider of options.providers) {
    try {
      const reportedChainId = await jsonRpc(fetcher, provider, 'eth_chainId', []);
      if (
        !isHex(reportedChainId) ||
        Number.parseInt(reportedChainId, 16) !== options.chainId
      ) {
        throw new Error(`${provider.name} did not confirm expected chainid=${options.chainId}.`);
      }
      const latestHex = await jsonRpc(fetcher, provider, 'eth_blockNumber', []);
      if (!isHex(latestHex)) throw new Error(`${provider.name} returned an invalid latest block number.`);
      const latestBlockNumber = Number.parseInt(latestHex, 16);
      if (!Number.isSafeInteger(latestBlockNumber) || latestBlockNumber <= 0) {
        throw new Error(`${provider.name} returned an invalid latest block number.`);
      }
      const firstBlock = Math.max(1, latestBlockNumber - MAX_BLOCKS_TO_SCAN + 1);
      const heights = Array.from(
        { length: latestBlockNumber - firstBlock + 1 },
        (_unused, index) => firstBlock + index,
      );
      const blocks = await mapConcurrent(heights, CONCURRENCY, async (height) => {
        const blockValue = await jsonRpc(fetcher, provider, 'eth_getBlockByNumber', [
          `0x${height.toString(16)}`,
          true,
        ]);
        const block = parseBlock(blockValue);
        if (!block || Number.parseInt(block.number, 16) !== height) {
          throw new Error(`${provider.name} returned a missing or mismatched block ${height}.`);
        }
        return block;
      });
      const retrievedAtMs = Date.now();
      const latestSampledBlock = blocks.at(-1);
      if (!latestSampledBlock) throw new Error(`${provider.name} returned an empty block sample.`);
      const observedAtMs = Number.parseInt(latestSampledBlock.timestamp, 16) * 1_000;
      if (
        !Number.isSafeInteger(observedAtMs) ||
        observedAtMs > retrievedAtMs + 1_000 ||
        retrievedAtMs - observedAtMs > MAX_AGE_MS
      ) {
        throw new Error(`${provider.name} latest sampled block is stale or future-dated.`);
      }

      const addressSet = new Set(options.addresses.map((address) => address.toLowerCase()));
      const transfers: CouncilWhaleTransfer[] = [];
      for (const block of blocks) {
        const blockHeight = Number.parseInt(block.number, 16);
        if (latestBlockNumber - blockHeight + 1 < REQUIRED_CONFIRMATIONS) continue;
        const timestampMs = Number.parseInt(block.timestamp, 16) * 1_000;
        if (
          !Number.isSafeInteger(timestampMs) ||
          timestampMs > retrievedAtMs + 1_000 ||
          retrievedAtMs - timestampMs > MAX_AGE_MS
        ) continue;
        for (const item of block.transactions) {
          const transaction = parseTransaction(item);
          if (!transaction || !transaction.to || !addressSet.has(transaction.to.toLowerCase())) continue;
          const amount = unitsToNative(transaction.value);
          if (amount < options.threshold) continue;
          transfers.push({
            transactionHash: transaction.hash,
            blockchain: options.blockchain,
            blockHeight,
            timestampMs,
            sourceProvider: `${provider.name} (configured CEX destination)`,
            asset: options.asset,
            amount,
            estimatedUsd: typeof options.priceUsd === 'number' &&
              Number.isFinite(options.priceUsd) &&
              options.priceUsd > 0
              ? amount * options.priceUsd
              : null,
            confirmationStatus: 'CONFIRMED',
            transferId: 'native-transfer',
          });
        }
      }

      const result = makeOnChainFlow({
        pair: options.pair,
        asset: options.asset,
        provider: `${provider.name} public JSON-RPC (chainid=${options.chainId}; ${blocks.length}-block sample)`,
        transfers,
        observedAtMs,
        retrievedAtMs,
      });
      cache.set(options.pair, { cachedAtMs: nowMs, value: result });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${provider.name}: ${reason}`);
      if (provider !== options.providers.at(-1)) {
        console.warn(`[PublicEvmOnChain] ${provider.name} unavailable; trying the next public RPC: ${reason}`);
      }
    }
  }
  return unavailable(
    options.pair,
    options.asset,
    providerLabel,
    `All keyless public RPC providers failed: ${providerErrors.join('; ')}`,
  );
}

export function resetPublicEvmOnChainCacheForTests(): void {
  cache.clear();
}
