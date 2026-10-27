import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import { fetchEtherscanWhaleTransfers, getConfiguredAddresses } from './etherscanWhaleData';
import { deduplicateOnChainTransfers } from './councilEvidenceDeduplication';
import { fetchWhaleAlertFlow } from './whaleAlertFlow';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import { fetchSolanaOnChainData } from './solanaOnChain';
import { fetchXrpOnChainData } from './xrpOnChain';
import { fetchBscOnChainData } from './bscOnChain';
import { fetchPublicEvmOnChainData } from './publicEvmOnChain';

const MEMPOOL_API = 'https://mempool.space/api';
const BLOCKSTREAM_API = 'https://blockstream.info/api';
const CACHE_TTL_MS = 60_000;
const LAST_SUCCESSFUL_CACHE_TTL_MS = 20 * 60_000;
const MAX_BITCOIN_SAMPLE_AGE_MS = 20 * 60_000;
const MAX_ETH_TRANSFER_AGE_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_MAX_AGE_MS = 20 * 60_000;
const DEFAULT_BTC_THRESHOLD = 10;
const DEFAULT_BLOCK_SAMPLE_COUNT = 3;
const RETRIES = 1;
const MIN_REQUEST_INTERVAL_MS = 100;
const PREFETCH_INTERVAL_MS = 60_000;

interface MempoolBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
}

interface MempoolOutput {
  value: number;
}

interface MempoolTransaction {
  txid: string;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
  vout: MempoolOutput[];
}

let cachedAtMs = 0;
let cachedResult: CouncilWhaleFlowData | null = null;
let lastSuccessfulAtMs = 0;
let lastSuccessfulResult: CouncilWhaleFlowData | null = null;
let lastRequestStartedAtMs = 0;
let requestStartQueue: Promise<void> = Promise.resolve();
let activeRefreshPromise: Promise<CouncilWhaleFlowData> | null = null;
let prefetchTimer: NodeJS.Timeout | null = null;
let prefetchInFlight: Promise<CouncilWhaleFlowData> | null = null;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBlock(value: unknown): value is MempoolBlock {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && /^[0-9a-f]{64}$/i.test(item.id) &&
    Number.isSafeInteger(item.height) && (item.height as number) > 0 &&
    Number.isSafeInteger(item.timestamp) && (item.timestamp as number) > 0 &&
    Number.isSafeInteger(item.tx_count) && (item.tx_count as number) >= 0;
}

function isTransaction(value: unknown): value is MempoolTransaction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(item.txid) || typeof item.status !== 'object' ||
      item.status === null || Array.isArray(item.status) || !Array.isArray(item.vout)) return false;
  const status = item.status as Record<string, unknown>;
  return typeof status.confirmed === 'boolean' &&
    (status.block_height === undefined || (Number.isSafeInteger(status.block_height) && (status.block_height as number) > 0)) &&
    (status.block_time === undefined || (Number.isSafeInteger(status.block_time) && (status.block_time as number) > 0)) &&
    item.vout.every((output) => typeof output === 'object' && output !== null &&
      !Array.isArray(output) && Number.isSafeInteger((output as Record<string, unknown>).value) &&
      ((output as Record<string, unknown>).value as number) >= 0);
}

function unavailable(
  reason: string,
  status: CouncilWhaleFlowData['status'] = 'UNAVAILABLE',
): CouncilWhaleFlowData {
  return {
    status,
    provider: 'mempool.space public REST API',
    timestampMs: null,
    retrievedAtMs: null,
    ageMs: null,
    qualityPct: 0,
    coverageStatus: 'UNAVAILABLE',
    unavailableReason: reason,
    largeTransfers: [],
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 0,
    windowStartHeight: null,
    windowEndHeight: null,
  };
}

function readPositiveEnv(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error(`${name} must be a positive number no greater than ${max}.`);
  }
  return value;
}

async function requestJson(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
  providerName: string,
): Promise<unknown> {
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const startRequest = requestStartQueue.then(async () => {
      const requestWaitMs = Math.max(
        0,
        MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestStartedAtMs),
      );
      if (requestWaitMs > 0) await sleep(requestWaitMs);
      lastRequestStartedAtMs = Date.now();
    });
    requestStartQueue = startRequest.catch(() => {});
    await startRequest;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < RETRIES) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1_000, 500)
            : 250 * (2 ** attempt));
          continue;
        }
      }
      if (!response.ok) throw new Error(`${providerName} returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      if (attempt < RETRIES && !(error instanceof Error && error.message.startsWith(`${providerName} returned HTTP`))) {
        await sleep(250 * (2 ** attempt));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${providerName} retries were exhausted.`);
}

async function refreshPublicBitcoinWhaleData(options: {
  nowMs?: number;
  btcPriceUsd?: number | null;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  forceRefresh?: boolean;
} = {}): Promise<CouncilWhaleFlowData> {
  const nowMs = options.nowMs ?? Date.now();
  const cacheEvaluationNowMs = Math.max(nowMs, Date.now());
  if (!options.forceRefresh && cachedResult && cacheEvaluationNowMs >= cachedAtMs &&
      cacheEvaluationNowMs - cachedAtMs < CACHE_TTL_MS) {
    const ageMs = cachedResult.timestampMs === null
      ? null
      : cacheEvaluationNowMs - cachedResult.timestampMs;
    return {
      ...cachedResult,
      status: ageMs !== null && ageMs <= MAX_BITCOIN_SAMPLE_AGE_MS ? 'LIVE' : 'STALE',
      largeTransfers: (cachedResult.largeTransfers ?? []).map((transfer) => ({
        ...transfer,
        estimatedUsd: finiteNumber(options.btcPriceUsd) && options.btcPriceUsd > 0
          ? transfer.amount * options.btcPriceUsd
          : null,
      })),
      ageMs,
    };
  }
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  try {
    const timeoutMs = readPositiveEnv('SBK1_WHALE_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 3_000);
    const maxAgeMs = readPositiveEnv('SBK1_WHALE_MAX_AGE_MS', DEFAULT_MAX_AGE_MS, 20 * 60_000);
    const thresholdBtc = readPositiveEnv('SBK1_WHALE_MIN_TRANSFER_BTC', DEFAULT_BTC_THRESHOLD, 1_000_000);
    const blockSampleCount = Math.floor(readPositiveEnv(
      'SBK1_WHALE_BLOCK_SAMPLE_COUNT', DEFAULT_BLOCK_SAMPLE_COUNT, 10,
    ));
    const sourceErrors: string[] = [];
    let sourceName = '';
    let blocks: MempoolBlock[] = [];
    let transactionsByBlock: Array<{ block: MempoolBlock; transactions: MempoolTransaction[] }> = [];
    for (const source of [
      { name: 'mempool.space', api: MEMPOOL_API, blocksPath: '/v1/blocks' },
      { name: 'Blockstream', api: BLOCKSTREAM_API, blocksPath: '/blocks' },
    ]) {
      try {
        const rawBlocks = await requestJson(
          `${source.api}${source.blocksPath}`,
          fetcher,
          timeoutMs,
          sleep,
          source.name,
        );
        if (!Array.isArray(rawBlocks) || rawBlocks.length < blockSampleCount ||
            rawBlocks.some((block) => !isBlock(block))) {
          throw new Error(`${source.name} block response is malformed or incomplete.`);
        }
        const sourceBlocks = (rawBlocks as MempoolBlock[]).slice(0, blockSampleCount);
        const sourceTransactions = await Promise.all(sourceBlocks.map(async (block) => {
          const rawTransactions = await requestJson(
            `${source.api}/block/${encodeURIComponent(block.id)}/txs`,
            fetcher,
            timeoutMs,
            sleep,
            source.name,
          );
          if (!Array.isArray(rawTransactions) || rawTransactions.some((transaction) => !isTransaction(transaction))) {
            throw new Error(`${source.name} transactions for block ${block.height} are malformed.`);
          }
          return { block, transactions: rawTransactions as MempoolTransaction[] };
        }));
        sourceName = source.name;
        blocks = sourceBlocks;
        transactionsByBlock = sourceTransactions;
        break;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        sourceErrors.push(reason);
        if (source.name === 'mempool.space') {
          console.warn(`[PublicBitcoinWhaleData] Primary source failed; trying Blockstream mirror: ${reason}`);
        }
      }
    }
    if (!sourceName) {
      throw new Error(`All public Bitcoin block sources failed: ${sourceErrors.join('; ')}`);
    }
    const verificationNowMs = Math.max(nowMs, Date.now());
    const transfers: CouncilWhaleTransfer[] = [];
    const seen = new Set<string>();
    for (const { block, transactions } of transactionsByBlock) {
      for (const transaction of transactions) {
        if (!transaction.status.confirmed) continue;
        const timestampMs = (transaction.status.block_time ?? block.timestamp) * 1_000;
        if (timestampMs > verificationNowMs || verificationNowMs - timestampMs > maxAgeMs) continue;
        transaction.vout.forEach((output, index) => {
          const amount = output.value / 100_000_000;
          if (amount < thresholdBtc) return;
          const key = `bitcoin:${transaction.txid}:${index}`;
          if (seen.has(key)) return;
          seen.add(key);
          transfers.push({
            transactionHash: transaction.txid,
            blockchain: 'bitcoin',
            blockHeight: transaction.status.block_height ?? block.height,
            timestampMs,
            sourceProvider: sourceName,
            asset: 'BTC',
            amount,
            estimatedUsd: finiteNumber(options.btcPriceUsd) && options.btcPriceUsd > 0
              ? amount * options.btcPriceUsd
              : null,
            confirmationStatus: 'CONFIRMED',
            transferId: `vout:${index}`,
          });
        });
      }
    }

    const latestBlock = blocks[0];
    const timestampMs = latestBlock.timestamp * 1_000;
    const ageMs = verificationNowMs - timestampMs;
    const sourceId = sourceName === 'mempool.space'
      ? 'onchain.mempool-blocks'
      : 'onchain.blockstream-blocks';
    const fallbackSourceId = sourceName === 'Blockstream'
      ? 'onchain.mempool-blocks'
      : undefined;
    if (ageMs < 0 || ageMs > maxAgeMs) {
      return {
        ...unavailable(`${sourceName} latest sampled block is stale or has a future timestamp.`, 'STALE'),
        sourceId,
        fallbackSourceId,
      };
    }
    cachedResult = {
      status: ageMs <= MAX_BITCOIN_SAMPLE_AGE_MS ? 'LIVE' : 'STALE',
      provider: `${sourceName} public REST API (sampled confirmed BTC outputs)`,
      timestampMs,
      retrievedAtMs: verificationNowMs,
      ageMs,
      qualityPct: 85,
      coverageStatus: 'SAMPLED',
      largeTransfers: transfers,
      exchangeInflowsBtc: null,
      exchangeOutflowsBtc: null,
      netExchangeFlowBtc: null,
      transactionCount: transfers.length,
      windowStartHeight: blocks[blocks.length - 1].height,
      windowEndHeight: latestBlock.height,
      sourceId,
      fallbackSourceId,
    };
    cachedAtMs = nowMs;
    lastSuccessfulAtMs = nowMs;
    lastSuccessfulResult = { ...cachedResult, largeTransfers: [...transfers] };
    return { ...cachedResult, largeTransfers: [...transfers] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown public Bitcoin provider error.';
    console.error('[PublicBitcoinWhaleData] Source unavailable:', reason);
    if (
      lastSuccessfulResult &&
      nowMs >= lastSuccessfulAtMs &&
      nowMs - lastSuccessfulAtMs <= LAST_SUCCESSFUL_CACHE_TTL_MS
    ) {
      const timestampMs = lastSuccessfulResult.timestampMs;
      const ageMs = timestampMs === null ? null : nowMs - timestampMs;
      return {
        ...lastSuccessfulResult,
        status: ageMs !== null && ageMs <= MAX_BITCOIN_SAMPLE_AGE_MS ? 'LIVE' : 'STALE',
        ageMs,
        unavailableReason: `Public Bitcoin refresh failed (${reason}); using the last successful sample from ${Math.round((nowMs - lastSuccessfulAtMs) / 60_000)} minutes ago.`,
        largeTransfers: [...(lastSuccessfulResult.largeTransfers ?? [])],
      };
    }

    cachedResult = {
      ...unavailable(reason),
      retrievedAtMs: Date.now(),
    };
    cachedAtMs = nowMs;
    return cachedResult;
  }
}

export async function fetchPublicBitcoinWhaleData(options: {
  nowMs?: number;
  btcPriceUsd?: number | null;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  forceRefresh?: boolean;
} = {}): Promise<CouncilWhaleFlowData> {
  const refresh = activeRefreshPromise ?? refreshPublicBitcoinWhaleData(options);
  if (!activeRefreshPromise) activeRefreshPromise = refresh;
  try {
    const result = await refresh;
    return {
      ...result,
      largeTransfers: (result.largeTransfers ?? []).map((transfer) => ({
        ...transfer,
        estimatedUsd: finiteNumber(options.btcPriceUsd) && options.btcPriceUsd > 0
          ? transfer.amount * options.btcPriceUsd
          : null,
      })),
    };
  } finally {
    if (activeRefreshPromise === refresh) activeRefreshPromise = null;
  }
}

export function startPublicBitcoinWhaleDataPrefetch(): void {
  if (prefetchTimer) return;
  const refresh = (): void => {
    if (prefetchInFlight) return;
    const prefetch = fetchPublicBitcoinWhaleData({ forceRefresh: true });
    prefetchInFlight = prefetch;
    void prefetch.then(
      () => {
        if (prefetchInFlight === prefetch) prefetchInFlight = null;
      },
      (error: unknown) => {
        console.error('[PublicBitcoinWhaleData] Background prefetch failed:', error);
        if (prefetchInFlight === prefetch) prefetchInFlight = null;
      },
    );
  };
  refresh();
  prefetchTimer = setInterval(refresh, PREFETCH_INTERVAL_MS);
  prefetchTimer.unref();
}

export async function stopPublicBitcoinWhaleDataPrefetch(): Promise<void> {
  if (prefetchTimer) clearInterval(prefetchTimer);
  prefetchTimer = null;
  await prefetchInFlight;
}

export async function fetchOnChainWhaleData(options: {
  pair: string;
  nowMs?: number;
  priceUsd?: number | null;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  forceRefresh?: boolean;
}): Promise<CouncilWhaleFlowData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (!asset) throw new Error(`Unsupported pair for on-chain analysis: ${options.pair}`);
  if (asset === 'BTC') {
    const bitcoin = await fetchPublicBitcoinWhaleData({
      nowMs: options.nowMs,
      btcPriceUsd: options.priceUsd,
      fetcher: options.fetcher,
      sleep: options.sleep,
      forceRefresh: options.forceRefresh,
    });
    if (bitcoin.status !== 'LIVE') {
      const alert = await fetchWhaleAlertFlow({
        apiKey: process.env.WHALE_ALERT_API_KEY,
        nowMs: options.nowMs,
        fetcher: options.fetcher,
      });
      if (alert.status === 'LIVE') {
        return {
          ...alert,
          pair: options.pair,
          asset,
          provider: `Optional fallback: ${alert.provider}`,
          unavailableReason: bitcoin.unavailableReason,
        };
      }
    }
    return {
      ...bitcoin,
      pair: options.pair,
      asset,
      largeTransfers: (bitcoin.largeTransfers ?? []).map((transfer) => ({
        ...transfer,
        estimatedUsd: finiteNumber(options.priceUsd) && options.priceUsd > 0
          ? transfer.amount * options.priceUsd
          : null,
      })),
    };
  }
  if (asset === 'ETH') {
    const addresses = getConfiguredAddresses();
    const threshold = Number(process.env.SBK1_WHALE_MIN_ETH ?? '100');
    const fetchEthereumPublicRpcFallback = async (
      primaryFailure?: string,
    ): Promise<CouncilWhaleFlowData> => {
      if (addresses.length === 0) {
        return {
          ...unavailable(primaryFailure
            ? `Etherscan unavailable (${primaryFailure}); verified Ethereum CEX watchlist is not configured.`
            : 'Verified Ethereum CEX watchlist is not configured.'),
          pair: options.pair,
          asset,
          provider: 'Ethereum mainnet public JSON-RPC (chainid=1)',
          sourceId: 'onchain.ethereum-publicnode',
          fallbackSourceId: primaryFailure ? 'onchain.etherscan-v2' : undefined,
        };
      }
      const rpcResult = await fetchPublicEvmOnChainData({
        pair: options.pair,
        asset: 'ETH',
        blockchain: 'ethereum',
        chainId: 1,
        providers: [
          { name: 'PublicNode Ethereum RPC', endpoint: 'https://ethereum-rpc.publicnode.com/' },
          { name: '1RPC Ethereum', endpoint: 'https://1rpc.io/eth' },
        ],
        addresses,
        threshold,
        priceUsd: options.priceUsd,
        nowMs: options.nowMs,
        fetcher: options.fetcher,
      });
      const usedOneRpc = rpcResult.provider.includes('1RPC');
      const rpcSourceId = usedOneRpc ? 'onchain.ethereum-1rpc' : 'onchain.ethereum-publicnode';
      return {
        ...rpcResult,
        pair: options.pair,
        asset,
        sourceId: rpcSourceId,
        fallbackSourceId: primaryFailure
          ? 'onchain.etherscan-v2'
          : usedOneRpc
            ? 'onchain.ethereum-publicnode'
            : undefined,
        unavailableReason: primaryFailure
          ? `Etherscan unavailable (${primaryFailure}); ${rpcResult.unavailableReason ?? `using ${rpcResult.provider}.`}`
          : rpcResult.unavailableReason,
      };
    };
    try {
      if (!process.env.ETHERSCAN_API_KEY?.trim()) {
        return fetchEthereumPublicRpcFallback();
      }
      const transfers = await fetchEtherscanWhaleTransfers({
        nowMs: options.nowMs ?? Date.now(),
        ethPriceUsd: options.priceUsd,
        fetcher: options.fetcher,
      });
      if (transfers.length > 0) {
        const timestampMs = Math.max(...transfers.map((transfer) => transfer.timestampMs));
        const ageMs = Math.max(0, (options.nowMs ?? Date.now()) - timestampMs);
        const isFresh = ageMs <= MAX_ETH_TRANSFER_AGE_MS;
        return {
          pair: options.pair,
          asset,
          status: isFresh ? 'LIVE' : 'STALE',
          provider: 'Etherscan Ethereum configured address watchlist (native ETH and ERC-20)',
          sourceId: 'onchain.etherscan-v2',
          timestampMs,
          retrievedAtMs: Date.now(),
          ageMs,
          qualityPct: isFresh ? 80 : 0,
          coverageStatus: isFresh ? 'SAMPLED' : 'UNAVAILABLE',
          unavailableReason: isFresh
            ? undefined
            : 'Latest observed Ethereum chain transaction is older than five minutes.',
          largeTransfers: transfers,
          exchangeInflowsBtc: null,
          exchangeOutflowsBtc: null,
          netExchangeFlowBtc: null,
          transactionCount: transfers.length,
          windowStartHeight: null,
          windowEndHeight: null,
        };
      }
      return fetchEthereumPublicRpcFallback('Etherscan returned no qualifying confirmed native ETH or configured ERC-20 transfers.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error('[PublicBitcoinWhaleData] Ethereum on-chain source unavailable:', reason);
      return fetchEthereumPublicRpcFallback(reason);
    }
  }
  if (asset === 'SOL') {
    return fetchSolanaOnChainData({
      pair: options.pair,
      nowMs: options.nowMs,
      priceUsd: options.priceUsd,
      fetcher: options.fetcher,
    });
  }
  if (asset === 'XRP') {
    return fetchXrpOnChainData({
      pair: options.pair,
      nowMs: options.nowMs,
      priceUsd: options.priceUsd,
      fetcher: options.fetcher,
    });
  }
  if (asset === 'BNB') {
    return fetchBscOnChainData({
      pair: options.pair,
      nowMs: options.nowMs,
      priceUsd: options.priceUsd,
      fetcher: options.fetcher,
    });
  }
  return {
    ...unavailable(`No verified ${asset} chain provider is configured; Bitcoin or other-chain evidence is not substituted.`),
    pair: options.pair,
    asset,
  };
}

export function resetPublicBitcoinWhaleDataCacheForTests(): void {
  if (prefetchTimer) clearInterval(prefetchTimer);
  prefetchTimer = null;
  prefetchInFlight = null;
  cachedAtMs = 0;
  cachedResult = null;
  lastSuccessfulAtMs = 0;
  lastSuccessfulResult = null;
  lastRequestStartedAtMs = 0;
  requestStartQueue = Promise.resolve();
  activeRefreshPromise = null;
}
