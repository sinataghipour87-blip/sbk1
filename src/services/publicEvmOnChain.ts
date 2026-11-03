import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import {
  makeOnChainFlow,
  unavailableOnChainFlow,
} from './onChainCexShared';
import { fetchOnChainProvider, resetOnChainProviderHealthForTests } from './onChainProviderHealth';
import { getOnChainProtocol } from './onChainProtocolRegistry';
import type { OnChainProtocolSwap } from './onChainProtocolFlow';

const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;
const MAX_BLOCKS_TO_SCAN = 50;
const CONCURRENCY = 5;
const MAX_AGE_MS = 5 * 60_000;
const REQUIRED_CONFIRMATIONS = 12;
const MAX_PROTOCOL_TRANSACTIONS_PER_PROVIDER = 30;
const PROTOCOL_TRANSACTION_CONCURRENCY = 3;
const V2_SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const HISTORICAL_SEED_BLOCKS = 1_000;
const HISTORICAL_RPC_INTERVAL_MS = 100;

interface PublicEvmTransaction {
  hash: string;
  from?: string;
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
  operator?: string;
  sourceId?: string;
  endpoint: string;
}

interface ProviderScan {
  provider: Provider;
  result: CouncilWhaleFlowData | null;
  protocolSwaps: OnChainProtocolSwap[];
  error: string | null;
}

interface CacheEntry {
  cachedAtMs: number;
  value: CouncilWhaleFlowData;
}

const cache = new Map<string, CacheEntry>();
const providerRequestQueues = new Map<string, Promise<void>>();
const providerLastRequestAt = new Map<string, number>();
const MIN_NATIVE_THRESHOLD: Record<'ETH' | 'BNB', number> = {
  ETH: 100,
  BNB: 5,
};

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
    (value.from !== undefined &&
      (typeof value.from !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value.from))) ||
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
  requestIntervalMs = 0,
): Promise<unknown> {
  if (requestIntervalMs > 0) {
    const previous = providerRequestQueues.get(provider.endpoint) ?? Promise.resolve();
    const requestTurn = previous.then(async () => {
      const waitMs = Math.max(
        0,
        requestIntervalMs - (Date.now() - (providerLastRequestAt.get(provider.endpoint) ?? 0)),
      );
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      providerLastRequestAt.set(provider.endpoint, Date.now());
    });
    providerRequestQueues.set(provider.endpoint, requestTurn.then(() => undefined, () => undefined));
    await requestTurn;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchOnChainProvider(provider.endpoint, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }, fetcher);
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

function addressFromHex(value: unknown): string | null {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value)
    ? `0x${value.slice(-40).toLowerCase()}`
    : null;
}

function encodeAddress(value: string): string {
  return value.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function decodeSwapWords(value: unknown): readonly [bigint, bigint, bigint, bigint] | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{256}$/i.test(value)) return null;
  return [
    BigInt(`0x${value.slice(2, 66)}`),
    BigInt(`0x${value.slice(66, 130)}`),
    BigInt(`0x${value.slice(130, 194)}`),
    BigInt(`0x${value.slice(194, 258)}`),
  ];
}

async function scanCandidateProtocolSwap(options: {
  fetcher: typeof fetch;
  provider: Provider;
  asset: 'ETH' | 'BNB';
  requestIntervalMs: number;
  candidateTransaction: {
    transaction: PublicEvmTransaction;
    blockHeight: number;
    timestampMs: number;
    blockConfirmations: number;
  };
}): Promise<OnChainProtocolSwap | null> {
  const protocol = getOnChainProtocol(options.asset);
  const { transaction, blockHeight, timestampMs, blockConfirmations } = options.candidateTransaction;
  if (!protocol || !transaction.from || !transaction.to ||
      transaction.to.toLowerCase() !== protocol.routerAddress.toLowerCase()) return null;
  const receiptValue = await jsonRpc(options.fetcher, options.provider, 'eth_getTransactionReceipt', [
    transaction.hash,
  ], options.requestIntervalMs);
  if (!isRecord(receiptValue) ||
      typeof receiptValue.status !== 'string' ||
      receiptValue.status.toLowerCase() !== '0x1' ||
      typeof receiptValue.transactionHash !== 'string' ||
      receiptValue.transactionHash.toLowerCase() !== transaction.hash.toLowerCase() ||
      !Array.isArray(receiptValue.logs)) return null;
  let netWrappedNative = 0n;
  let swapLogIndex = -1;
  const pairBlockTag = `0x${blockHeight.toString(16)}`;
  for (const rawLog of receiptValue.logs) {
    if (!isRecord(rawLog) || typeof rawLog.address !== 'string' ||
        !Array.isArray(rawLog.topics) || rawLog.topics[0] !== V2_SWAP_TOPIC ||
        typeof rawLog.data !== 'string') continue;
    const amounts = decodeSwapWords(rawLog.data);
    if (!amounts) continue;
    const pairAddress = rawLog.address.toLowerCase();
    const token0 = addressFromHex(await jsonRpc(options.fetcher, options.provider, 'eth_call', [
      { to: pairAddress, data: '0x0dfe1681' },
      pairBlockTag,
    ], options.requestIntervalMs));
    const token1 = addressFromHex(await jsonRpc(options.fetcher, options.provider, 'eth_call', [
      { to: pairAddress, data: '0xd21220a7' },
      pairBlockTag,
    ], options.requestIntervalMs));
    if (!token0 || !token1 ||
        (token0 !== protocol.wrappedNativeAddress.toLowerCase() &&
          token1 !== protocol.wrappedNativeAddress.toLowerCase())) continue;
    const expectedPair = addressFromHex(await jsonRpc(options.fetcher, options.provider, 'eth_call', [
      {
        to: protocol.factoryAddress,
        data: `0xe6a43905${encodeAddress(token0)}${encodeAddress(token1)}`,
      },
      pairBlockTag,
    ], options.requestIntervalMs));
    if (expectedPair !== pairAddress) continue;
    const [amount0In, amount1In, amount0Out, amount1Out] = amounts;
    netWrappedNative += token0 === protocol.wrappedNativeAddress.toLowerCase()
      ? amount0In - amount0Out
      : amount1In - amount1Out;
    const parsedLogIndex = typeof rawLog.logIndex === 'string'
      ? Number.parseInt(rawLog.logIndex, 16)
      : Number.NaN;
    if (Number.isSafeInteger(parsedLogIndex)) swapLogIndex = parsedLogIndex;
  }
  if (netWrappedNative === 0n || swapLogIndex < 0) return null;
  const rawAmount = (netWrappedNative < 0n ? -netWrappedNative : netWrappedNative).toString();
  const amountNative = unitsToNative(`0x${BigInt(rawAmount).toString(16)}`);
  if (amountNative < MIN_NATIVE_THRESHOLD[options.asset]) return null;
  return {
    evidenceId: `${protocol.id}:${transaction.hash.toLowerCase()}:${swapLogIndex}`,
    transactionHash: transaction.hash,
    blockHeight,
    timestampMs,
    protocolId: protocol.id,
    protocolName: protocol.name,
    walletAddress: transaction.from,
    walletStatus: 'discovered-candidate',
    asset: options.asset,
    direction: netWrappedNative < 0n ? 'LONG' : 'SHORT',
    amountNative,
    rawAmount,
    providerConfirmations: 1,
    blockConfirmations,
    confirmingSourceIds: options.provider.sourceId ? [options.provider.sourceId] : [],
  };
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
  candidateAddresses?: readonly string[];
  historicalBackfill?: boolean;
  threshold: number;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilWhaleFlowData> {
  const providerLabel = options.chainId === 1
    ? 'Ethereum mainnet public JSON-RPC (chainid=1)'
    : 'BNB Smart Chain public JSON-RPC (chainid=56)';
  if (!Number.isFinite(options.threshold) || options.threshold <= 0) {
    return unavailable(options.pair, options.asset, providerLabel, 'Native-asset whale threshold must be positive.');
  }
  if (options.providers.length === 0) {
    return unavailable(options.pair, options.asset, providerLabel, 'No public RPC endpoint is configured.');
  }

  const nowMs = options.nowMs ?? Date.now();
  const cached = options.historicalBackfill ? undefined : cache.get(options.pair);
  if (cached && nowMs >= cached.cachedAtMs && nowMs - cached.cachedAtMs < CACHE_TTL_MS) {
    const ageMs = cached.value.timestampMs === null
      ? null
      : Math.max(0, nowMs - cached.value.timestampMs);
    const status = ageMs !== null && ageMs < MAX_AGE_MS ? 'LIVE' : 'STALE';
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
  const uniqueProviders = [...new Map(options.providers.map((provider) => [
    provider.operator ?? provider.name,
    provider,
  ])).values()];
  if (uniqueProviders.length < 2) {
    return unavailable(
      options.pair,
      options.asset,
      providerLabel,
      'At least two independent public RPC providers are required for confirmation.',
    );
  }
  const scans: ProviderScan[] = await Promise.all(uniqueProviders.map(async (provider): Promise<ProviderScan> => {
    try {
      const requestIntervalMs = options.historicalBackfill ? HISTORICAL_RPC_INTERVAL_MS : 0;
      const reportedChainId = await jsonRpc(fetcher, provider, 'eth_chainId', [], requestIntervalMs);
      if (
        !isHex(reportedChainId) ||
        Number.parseInt(reportedChainId, 16) !== options.chainId
      ) {
        throw new Error(`${provider.name} did not confirm expected chainid=${options.chainId}.`);
      }
      const latestHex = await jsonRpc(fetcher, provider, 'eth_blockNumber', [], requestIntervalMs);
      if (!isHex(latestHex)) throw new Error(`${provider.name} returned an invalid latest block number.`);
      const latestBlockNumber = Number.parseInt(latestHex, 16);
      if (!Number.isSafeInteger(latestBlockNumber) || latestBlockNumber <= 0) {
        throw new Error(`${provider.name} returned an invalid latest block number.`);
      }
      const blockLimit = options.historicalBackfill ? HISTORICAL_SEED_BLOCKS : MAX_BLOCKS_TO_SCAN;
      const firstBlock = Math.max(1, latestBlockNumber - blockLimit + 1);
      const heights = Array.from(
        { length: latestBlockNumber - firstBlock + 1 },
        (_unused, index) => firstBlock + index,
      );
      const blocks = await mapConcurrent(heights, CONCURRENCY, async (height) => {
        const blockValue = await jsonRpc(fetcher, provider, 'eth_getBlockByNumber', [
          `0x${height.toString(16)}`,
          true,
        ], requestIntervalMs);
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
        retrievedAtMs - observedAtMs >= MAX_AGE_MS
      ) {
        throw new Error(`${provider.name} latest sampled block is stale or future-dated.`);
      }

      const transfers: CouncilWhaleTransfer[] = [];
      const candidateTransactions: Array<{
        transaction: PublicEvmTransaction;
        blockHeight: number;
        timestampMs: number;
        blockConfirmations: number;
      }> = [];
      const protocol = getOnChainProtocol(options.asset);
      const candidateAddresses = new Set((options.candidateAddresses ?? []).map((address) => address.toLowerCase()));
      for (const block of blocks) {
        const blockHeight = Number.parseInt(block.number, 16);
        if (latestBlockNumber - blockHeight + 1 < REQUIRED_CONFIRMATIONS) continue;
        const timestampMs = Number.parseInt(block.timestamp, 16) * 1_000;
        if (
          !Number.isSafeInteger(timestampMs) ||
          timestampMs > retrievedAtMs + 1_000 ||
          (!options.historicalBackfill && retrievedAtMs - timestampMs >= MAX_AGE_MS)
        ) continue;
        for (const item of block.transactions) {
          const transaction = parseTransaction(item);
          if (!transaction || !transaction.to) continue;
          if (
            protocol &&
            transaction.from &&
            candidateAddresses.has(transaction.from.toLowerCase()) &&
            transaction.to.toLowerCase() === protocol.routerAddress.toLowerCase()
          ) {
            candidateTransactions.push({
              transaction,
              blockHeight,
              timestampMs,
              blockConfirmations: latestBlockNumber - blockHeight + 1,
            });
          }
          const amount = unitsToNative(transaction.value);
          if (amount < Math.max(MIN_NATIVE_THRESHOLD[options.asset], options.threshold)) continue;
          transfers.push({
            transactionHash: transaction.hash,
            blockchain: options.blockchain,
            blockHeight,
            timestampMs,
            sourceProvider: `${provider.name} (native transfer; wallet ownership unknown)`,
            asset: options.asset,
            amount,
            estimatedUsd: typeof options.priceUsd === 'number' &&
              Number.isFinite(options.priceUsd) &&
              options.priceUsd > 0
              ? amount * options.priceUsd
              : null,
            confirmationStatus: 'CONFIRMED',
            transferId: 'native-transfer',
            fromAddress: transaction.from,
            toAddress: transaction.to,
          });
        }
      }

      const boundedCandidateTransactions = candidateTransactions.length <= MAX_PROTOCOL_TRANSACTIONS_PER_PROVIDER
        ? candidateTransactions
        : [];
      const scannedProtocolSwaps = await mapConcurrent(
        boundedCandidateTransactions,
        PROTOCOL_TRANSACTION_CONCURRENCY,
        async (candidateTransaction) => {
          try {
            return await scanCandidateProtocolSwap({
              fetcher,
              provider,
              asset: options.asset,
              requestIntervalMs,
              candidateTransaction,
            });
          } catch {
            return null;
          }
        },
      );
      const result = makeOnChainFlow({
        pair: options.pair,
        asset: options.asset,
        provider: `${provider.name} public JSON-RPC (chainid=${options.chainId}; ${blocks.length}-block sample)`,
        transfers,
        observedAtMs,
        retrievedAtMs,
      });
      return {
        provider,
        result,
        protocolSwaps: scannedProtocolSwaps.filter((swap): swap is OnChainProtocolSwap => swap !== null),
        error: null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${provider.name}: ${reason}`);
      return { provider, result: null, protocolSwaps: [], error: reason };
    }
  }));
  const providerParticipation = scans.map(({ provider, error }) => ({
    sourceId: provider.sourceId ?? provider.name,
    provider: provider.name,
    status: error === null
      ? 'VALID' as const
      : /HTTP 429|HTTP 503|cooling down after HTTP (429|503)/i.test(error)
        ? 'THROTTLED' as const
        : 'FAILED' as const,
    ...(error === null ? {} : { error }),
  }));
  const successfulScans = scans.filter((scan) => scan.result !== null);
  const independentOperators = new Set(successfulScans.map(({ provider }) =>
    provider.operator ?? provider.sourceId ?? provider.name
  ));
  if (independentOperators.size < 2) {
    return {
      ...unavailable(
      options.pair,
      options.asset,
      providerLabel,
      `Independent confirmation requires two live operators; ${independentOperators.size} succeeded. ${providerErrors.join('; ')}`,
      ),
      providerParticipation,
    };
  }

  const transferVotes = new Map<string, {
    operators: Set<string>;
    transfer: CouncilWhaleTransfer;
    sourceIds: Map<string, string>;
  }>();
  const conflictingTransfers = new Set<string>();
  for (const { provider, result } of successfulScans) {
    const operator = provider.operator ?? provider.sourceId ?? provider.name;
    const sourceId = provider.sourceId ?? provider.name;
    for (const transfer of result!.largeTransfers ?? []) {
      const key = `${transfer.transactionHash.toLowerCase()}:${transfer.transferId ?? ''}`;
      const vote = transferVotes.get(key);
      if (vote) {
        if (vote.transfer.amount !== transfer.amount) {
          conflictingTransfers.add(key);
          continue;
        }
        vote.operators.add(operator);
        vote.sourceIds.set(operator, sourceId);
      } else {
        transferVotes.set(key, {
          operators: new Set([operator]),
          transfer,
          sourceIds: new Map([[operator, sourceId]]),
        });
      }
    }
  }
  const confirmedTransfers = [...transferVotes.values()]
    .filter(({ operators, transfer }) =>
      operators.size >= 2 &&
      !conflictingTransfers.has(`${transfer.transactionHash.toLowerCase()}:${transfer.transferId ?? ''}`)
    )
    .map(({ transfer, operators, sourceIds }) => ({
      ...transfer,
      providerConfirmations: operators.size,
      confirmingSourceIds: [...sourceIds.values()],
    }));
  const protocolSwapVotes = new Map<string, {
    swap: OnChainProtocolSwap;
    operators: Set<string>;
    sourceIds: Map<string, string>;
    conflicted: boolean;
  }>();
  for (const { provider, protocolSwaps } of successfulScans) {
    const operator = provider.operator ?? provider.sourceId ?? provider.name;
    const sourceId = provider.sourceId ?? provider.name;
    for (const swap of protocolSwaps) {
      const vote = protocolSwapVotes.get(swap.evidenceId);
      if (!vote) {
        protocolSwapVotes.set(swap.evidenceId, {
          swap,
          operators: new Set([operator]),
          sourceIds: new Map([[operator, sourceId]]),
          conflicted: false,
        });
      } else if (
        vote.swap.direction !== swap.direction ||
        vote.swap.rawAmount !== swap.rawAmount ||
        vote.swap.walletAddress.toLowerCase() !== swap.walletAddress.toLowerCase()
      ) {
        vote.conflicted = true;
      } else {
        vote.operators.add(operator);
        vote.sourceIds.set(operator, sourceId);
      }
    }
  }
  const confirmedProtocolSwaps = [...protocolSwapVotes.values()]
    .filter(({ operators, conflicted }) => operators.size >= 2 && !conflicted)
    .map(({ swap, operators, sourceIds }) => ({
      ...swap,
      providerConfirmations: operators.size,
      confirmingSourceIds: [...sourceIds.values()],
    }));
  const observedAtMs = Math.min(...successfulScans.map(({ result }) => result!.timestampMs ?? 0));
  const retrievedAtMs = Math.max(...successfulScans.map(({ result }) => result!.retrievedAtMs ?? 0));
  const result = makeOnChainFlow({
    pair: options.pair,
    asset: options.asset,
    provider: `${independentOperators.size} independent public JSON-RPC operators (chainid=${options.chainId})`,
    transfers: confirmedTransfers,
    observedAtMs,
    retrievedAtMs,
  });
  result.independentProviderCount = independentOperators.size;
  result.independentSourceIds = [...new Set(successfulScans.map(({ provider }) =>
    provider.sourceId ?? provider.name
  ))];
  result.providerParticipation = providerParticipation;
  result.protocolSwaps = confirmedProtocolSwaps;
  result.unavailableReason = providerErrors.length > 0
    ? `Some independent providers were unavailable: ${providerErrors.join('; ')}`
    : undefined;
  if (!options.historicalBackfill) {
    cache.set(options.pair, { cachedAtMs: nowMs, value: result });
  }
  return result;
}

export function resetPublicEvmOnChainCacheForTests(): void {
  cache.clear();
  providerRequestQueues.clear();
  providerLastRequestAt.clear();
  resetOnChainProviderHealthForTests();
}
