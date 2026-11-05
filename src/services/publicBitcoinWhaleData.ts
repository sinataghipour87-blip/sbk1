import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import { fetchEtherscanWhaleTransfers, getConfiguredAddresses } from './etherscanWhaleData';
import { deduplicateOnChainTransfers } from './councilEvidenceDeduplication';
import { fetchWhaleAlertFlow } from './whaleAlertFlow';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import { fetchSolanaOnChainData } from './solanaOnChain';
import { fetchXrpOnChainData } from './xrpOnChain';
import { fetchBscOnChainData } from './bscOnChain';
import { fetchPublicEvmOnChainData } from './publicEvmOnChain';
import { getOnChainMonitoringFeeds, type OnChainAsset } from './onChainFeedRegistry';
import { applyOnChainFlowHeuristic } from './onChainFlowHeuristic';
import {
  recordOnChainRealtimeFlow,
  resetOnChainRealtimeStateForTests,
} from './onChainRealtimeState';
import { flushOnChainWalletCandidates, loadOnChainWalletCandidates } from './onChainWalletDiscovery';
import { fetchOnChainProvider, resetOnChainProviderHealthForTests } from './onChainProviderHealth';

const MEMPOOL_API = 'https://mempool.space/api';
const BLOCKSTREAM_API = 'https://blockstream.info/api';
const CACHE_TTL_MS = 60_000;
const LAST_SUCCESSFUL_CACHE_TTL_MS = 20 * 60_000;
const MAX_ONCHAIN_VOTE_AGE_MS = 5 * 60_000 - 1;
const MAX_ETH_TRANSFER_AGE_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_MAX_AGE_MS = MAX_ONCHAIN_VOTE_AGE_MS;
const DEFAULT_BTC_THRESHOLD = 10;
const DEFAULT_BLOCK_SAMPLE_COUNT = 3;
const MAX_MEMPOOL_TX_DETAILS_PER_SOURCE = 3;
const HISTORICAL_SEED_BLOCK_COUNT = 144;
const RETRIES = 1;
const MIN_REQUEST_INTERVAL_MS = 100;
const PREFETCH_INTERVAL_MS = 15_000;
const PRECOMPUTED_FLOW_MAX_AGE_MS = 30_000;
const REALTIME_INGESTION_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'] as const;

interface MempoolBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
}

interface MempoolOutput {
  value: number;
  scriptpubkey_address?: string;
}

interface MempoolTransaction {
  txid: string;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
  vout: MempoolOutput[];
  vin?: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>;
}

interface MempoolRecentTransaction {
  txid: string;
  value: number;
}

interface MempoolSourceSample {
  sourceId: string;
  operator: string;
  sourceName: string;
  observedAtMs: number;
  transfers: CouncilWhaleTransfer[];
}

let cachedAtMs = 0;
let cachedResult: CouncilWhaleFlowData | null = null;
let lastSuccessfulAtMs = 0;
let lastSuccessfulResult: CouncilWhaleFlowData | null = null;
let lastRequestStartedAtMs = 0;
let requestStartQueue: Promise<void> = Promise.resolve();
let activeRefreshPromise: Promise<CouncilWhaleFlowData> | null = null;
let prefetchTimer: NodeJS.Timeout | null = null;
let prefetchInFlight: Promise<readonly (CouncilWhaleFlowData | null)[]> | null = null;
let prefetchRunning = false;
const precomputedFlowByAsset = new Map<OnChainAsset, {
  flow: CouncilWhaleFlowData;
  preparedAtMs: number;
}>();

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSupportedOnChainAsset(value: string): value is OnChainAsset {
  return value === 'BTC' || value === 'ETH' || value === 'SOL' || value === 'BNB' || value === 'XRP';
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
      ((output as Record<string, unknown>).value as number) >= 0) &&
    (item.vin === undefined || Array.isArray(item.vin));
}

function isMempoolRecentTransaction(value: unknown): value is MempoolRecentTransaction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.txid === 'string' && /^[0-9a-f]{64}$/i.test(item.txid) &&
    Number.isSafeInteger(item.value) && (item.value as number) >= 0;
}

async function scanRecentMempoolTransfers(options: {
  nowMs: number;
  thresholdBtc: number;
  timeoutMs: number;
  fetcher: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  btcPriceUsd?: number | null;
}): Promise<CouncilWhaleFlowData | null> {
  const feeds = getOnChainMonitoringFeeds('BTC')
    .filter((feed) => feed.dataType === 'transaction-feed' && feed.url.endsWith('/mempool/recent'));
  const sourceResults = await Promise.all(feeds.map(async (feed): Promise<MempoolSourceSample | null> => {
    try {
      const recentTransactions = await requestJson(
        feed.url,
        options.fetcher,
        options.timeoutMs,
        options.sleep,
        feed.provider,
      );
      if (!Array.isArray(recentTransactions) ||
          recentTransactions.some((transaction) => !isMempoolRecentTransaction(transaction))) {
        throw new Error(`${feed.provider} returned a malformed recent-mempool response.`);
      }
      const candidates = (recentTransactions as MempoolRecentTransaction[])
        .filter(({ value }) => value >= options.thresholdBtc * 100_000_000)
        .slice(0, MAX_MEMPOOL_TX_DETAILS_PER_SOURCE);
      const sourceTransfers = await Promise.all(candidates.map(async (candidate) => {
        const api = new URL(feed.url).origin;
        const rawTransaction = await requestJson(
          `${api}/api/tx/${encodeURIComponent(candidate.txid)}`,
          options.fetcher,
          options.timeoutMs,
          options.sleep,
          feed.provider,
        );
        if (!isTransaction(rawTransaction) || rawTransaction.status.confirmed) return [];
        return rawTransaction.vout.flatMap((output, index) => {
          const amount = output.value / 100_000_000;
          if (amount < options.thresholdBtc) return [];
          return [{
            transactionHash: rawTransaction.txid,
            blockchain: 'bitcoin',
            blockHeight: null,
            timestampMs: Math.max(options.nowMs, Date.now()),
            sourceProvider: `${feed.provider} (mempool observation)`,
            asset: 'BTC',
            amount,
            estimatedUsd: finiteNumber(options.btcPriceUsd) && options.btcPriceUsd > 0
              ? amount * options.btcPriceUsd
              : null,
            confirmationStatus: 'UNCONFIRMED' as const,
            transferId: `vout:${index}`,
            fromAddresses: rawTransaction.vin?.flatMap((input) =>
              typeof input?.prevout?.scriptpubkey_address === 'string'
                ? [input.prevout.scriptpubkey_address]
                : []
            ),
            toAddress: typeof output.scriptpubkey_address === 'string'
              ? output.scriptpubkey_address
              : undefined,
          }];
        });
      }));
      return {
        sourceId: feed.councilSourceId ?? feed.id,
        operator: feed.operator,
        sourceName: feed.provider,
        observedAtMs: Math.max(options.nowMs, Date.now()),
        transfers: sourceTransfers.flat(),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[PublicBitcoinWhaleData] ${feed.provider} mempool scan failed: ${reason}`);
      return null;
    }
  }));
  const successfulSources = sourceResults.filter((source): source is MempoolSourceSample => source !== null);
  const independentSources = [...new Map(successfulSources.map((source) => [source.operator, source])).values()];
  if (independentSources.length < 2) return null;

  const transfersById = new Map<string, {
    transfer: CouncilWhaleTransfer;
    sourceIds: Set<string>;
  }>();
  for (const source of successfulSources) {
    const seenBySource = new Set<string>();
    for (const transfer of source.transfers) {
      const transferKey = `${transfer.transactionHash}:${transfer.transferId}`;
      if (seenBySource.has(transferKey)) continue;
      seenBySource.add(transferKey);
      const existing = transfersById.get(transferKey);
      if (existing) {
        if (existing.transfer.amount === transfer.amount) existing.sourceIds.add(source.sourceId);
      } else {
        transfersById.set(transferKey, {
          transfer,
          sourceIds: new Set([source.sourceId]),
        });
      }
    }
  }
  const quorumPendingTransfers = [...transfersById.values()]
    .filter(({ sourceIds }) => sourceIds.size >= 2)
    .map(({ transfer, sourceIds }) => ({
      ...transfer,
      providerConfirmations: sourceIds.size,
      confirmingSourceIds: [...sourceIds],
    }));
  const observedAtMs = Math.min(...independentSources.map(({ observedAtMs: time }) => time));
  const verificationNowMs = Math.max(options.nowMs, Date.now());
  const ageMs = verificationNowMs - observedAtMs;
  if (ageMs < 0 || ageMs > MAX_ONCHAIN_VOTE_AGE_MS) return null;
  const volumeBtc = quorumPendingTransfers.reduce((sum, transfer) => sum + transfer.amount, 0);
  const sourceIds = [...new Set(independentSources.map(({ sourceId }) => sourceId))];
  return {
    status: 'LIVE',
    provider: `${independentSources.map(({ sourceName }) => sourceName).join(', ')} public mempool feeds (pending, unconfirmed observations)`,
    timestampMs: observedAtMs,
    retrievedAtMs: verificationNowMs,
    ageMs,
    qualityPct: 75,
    coverageStatus: 'SAMPLED',
    largeTransfers: quorumPendingTransfers,
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: quorumPendingTransfers.length,
    windowStartHeight: null,
    windowEndHeight: null,
    sourceId: sourceIds[0],
    fallbackSourceId: sourceIds[1],
    independentProviderCount: independentSources.length,
    independentSourceIds: sourceIds,
    networkMetrics: {
      pendingMempoolScanSources: independentSources.length,
      pendingMempoolWhaleTransferCount: quorumPendingTransfers.length,
      pendingMempoolWhaleVolumeBtc: volumeBtc,
      pendingMempoolObservedAtMs: observedAtMs,
    },
  };
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
      const response = await fetchOnChainProvider(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }, fetcher);
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
  historicalBackfill?: boolean;
} = {}): Promise<CouncilWhaleFlowData> {
  const nowMs = options.nowMs ?? Date.now();
  const cacheEvaluationNowMs = Math.max(nowMs, Date.now());
  if (!options.historicalBackfill && !options.forceRefresh && cachedResult && cacheEvaluationNowMs >= cachedAtMs &&
      cacheEvaluationNowMs - cachedAtMs < CACHE_TTL_MS) {
    const ageMs = cachedResult.timestampMs === null
      ? null
      : cacheEvaluationNowMs - cachedResult.timestampMs;
    return {
      ...cachedResult,
      status: ageMs !== null && ageMs <= MAX_ONCHAIN_VOTE_AGE_MS ? 'LIVE' : 'STALE',
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
    const maxAgeMs = Math.min(
      MAX_ONCHAIN_VOTE_AGE_MS,
      readPositiveEnv('SBK1_WHALE_MAX_AGE_MS', DEFAULT_MAX_AGE_MS, 20 * 60_000),
    );
    const thresholdBtc = Math.max(
      DEFAULT_BTC_THRESHOLD,
      readPositiveEnv('SBK1_WHALE_MIN_TRANSFER_BTC', DEFAULT_BTC_THRESHOLD, 1_000_000),
    );
    const blockSampleCount = options.historicalBackfill
      ? HISTORICAL_SEED_BLOCK_COUNT
      : Math.floor(readPositiveEnv(
      'SBK1_WHALE_BLOCK_SAMPLE_COUNT', DEFAULT_BLOCK_SAMPLE_COUNT, 10,
    ));
    const sourceErrors: string[] = [];
    const sourceErrorsByFeedId = new Map<string, string>();
    const mempoolData = options.historicalBackfill
      ? null
      : await scanRecentMempoolTransfers({
          nowMs,
          thresholdBtc,
          timeoutMs,
          fetcher,
          sleep,
          btcPriceUsd: options.btcPriceUsd,
        });
    const sources = getOnChainMonitoringFeeds('BTC')
      .filter((feed) => feed.dataType === 'block-feed')
      .map((feed) => {
        const blocksUrl = new URL(feed.url);
        return {
          name: feed.provider,
          sourceId: feed.councilSourceId,
          feedId: feed.id,
          api: `${blocksUrl.origin}/api`,
          blocksPath: blocksUrl.pathname.replace(/^\/api/, ''),
        };
      });
    const sourceSamples = await Promise.all(sources.map(async (source) => {
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
        const blocksByHeight = new Map(
          (rawBlocks as MempoolBlock[]).map((block) => [block.height, block]),
        );
        if (options.historicalBackfill) {
          while (blocksByHeight.size < blockSampleCount) {
            const lowestHeight = Math.min(...blocksByHeight.keys());
            if (lowestHeight <= 1) break;
            const batchStartHeight = Math.max(1, lowestHeight - 10);
            const historicalBlocks = await requestJson(
              `${source.api}${source.blocksPath}/${batchStartHeight}`,
              fetcher,
              timeoutMs,
              sleep,
              source.name,
            );
            if (!Array.isArray(historicalBlocks) ||
                historicalBlocks.length === 0 ||
                historicalBlocks.some((block) => !isBlock(block))) {
              throw new Error(`${source.name} historical block batch was malformed or empty.`);
            }
            const previousSize = blocksByHeight.size;
            for (const block of historicalBlocks as MempoolBlock[]) {
              blocksByHeight.set(block.height, block);
            }
            if (blocksByHeight.size === previousSize) {
              throw new Error(`${source.name} historical block pagination did not advance.`);
            }
          }
        }
        const sourceBlocks = [...blocksByHeight.values()]
          .sort((left, right) => right.height - left.height)
          .slice(0, blockSampleCount);
        const latestBlock = sourceBlocks.at(0);
        if (!latestBlock) throw new Error(`${source.name} returned an empty block sample.`);
        const checkedAtMs = Math.max(nowMs, Date.now());
        const latestBlockTimestampMs = latestBlock.timestamp * 1_000;
        if (
          latestBlockTimestampMs > checkedAtMs + 1_000 ||
          checkedAtMs - latestBlockTimestampMs > maxAgeMs
        ) {
          throw new Error(`${source.name} latest block is stale or future-dated; transaction volumes were not processed.`);
        }
        const sourceTransactions = await Promise.all(sourceBlocks.map(async (block) => {
          const transactions: MempoolTransaction[] = [];
          const pages = options.historicalBackfill ? Math.ceil(block.tx_count / 25) : 1;
          for (let page = 0; page < pages; page += 1) {
            const path = page === 0
              ? `/block/${encodeURIComponent(block.id)}/txs`
              : `/block/${encodeURIComponent(block.id)}/txs/${page * 25}`;
            const rawTransactions = await requestJson(
              `${source.api}${path}`,
              fetcher,
              timeoutMs,
              sleep,
              source.name,
            );
            if (!Array.isArray(rawTransactions) ||
                rawTransactions.some((transaction) => !isTransaction(transaction))) {
              throw new Error(`${source.name} transactions for block ${block.height} are malformed.`);
            }
            transactions.push(...rawTransactions as MempoolTransaction[]);
          }
          if (options.historicalBackfill && transactions.length < block.tx_count) {
            throw new Error(`${source.name} did not return every transaction in block ${block.height}.`);
          }
          return { block, transactions };
        }));
        return {
          sourceId: source.sourceId,
          feedId: source.feedId,
          sourceName: source.name,
          blocks: sourceBlocks,
          transactionsByBlock: sourceTransactions,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        sourceErrors.push(reason);
        sourceErrorsByFeedId.set(source.feedId, reason);
        console.warn(`[PublicBitcoinWhaleData] ${source.name} transaction scan failed: ${reason}`);
        return null;
      }
    }));
    const providerParticipation = sourceSamples.map((sample, index) => {
      const source = sources[index];
      if (sample) {
        return {
          sourceId: source.sourceId,
          provider: source.name,
          status: 'VALID' as const,
        };
      }
      const error = sourceErrorsByFeedId.get(source.feedId) ?? 'Provider scan did not complete.';
      return {
        sourceId: source.sourceId,
        provider: source.name,
        status: /HTTP 429|HTTP 503|cooling down after HTTP (429|503)/i.test(error)
          ? 'THROTTLED' as const
          : 'FAILED' as const,
        error,
      };
    });
    const successfulSources = sourceSamples.filter((sample) => sample !== null);
    if (successfulSources.length === 0) {
      if (mempoolData) {
        cachedResult = mempoolData;
        cachedAtMs = Math.max(nowMs, Date.now());
        lastSuccessfulAtMs = cachedAtMs;
        lastSuccessfulResult = {
          ...mempoolData,
          largeTransfers: [...(mempoolData.largeTransfers ?? [])],
        };
        return {
          ...mempoolData,
          providerParticipation,
          largeTransfers: [...(mempoolData.largeTransfers ?? [])],
        };
      }
      if (sourceErrors.length > 0 && sourceErrors.every((error) =>
        error.includes('latest block is stale or future-dated')
      )) {
        return {
          ...unavailable('Latest public Bitcoin block sample is stale or future-dated.', 'STALE'),
          sourceId: sources[0]?.sourceId,
          providerParticipation,
        };
      }
      return {
        ...unavailable(`All public Bitcoin transaction sources failed: ${sourceErrors.join('; ')}`),
        providerParticipation,
      };
    }
    const verificationNowMs = Math.max(nowMs, Date.now());
    const observedTransfers = new Map<string, {
      count: number;
      transfer: CouncilWhaleTransfer;
      sourceIds: Set<string>;
    }>();
    for (const sample of successfulSources) {
      const sourceSeen = new Set<string>();
      for (const { block, transactions } of sample.transactionsByBlock) {
        for (const transaction of transactions) {
          if (!transaction.status.confirmed) continue;
          const timestampMs = (transaction.status.block_time ?? block.timestamp) * 1_000;
          if (timestampMs > verificationNowMs ||
              (!options.historicalBackfill && verificationNowMs - timestampMs >= maxAgeMs + 1)) continue;
          transaction.vout.forEach((output, index) => {
            const amount = output.value / 100_000_000;
            if (amount < thresholdBtc) return;
            const key = `bitcoin:${transaction.txid}:${index}`;
            if (sourceSeen.has(key)) return;
            sourceSeen.add(key);
            const existing = observedTransfers.get(key);
            if (existing) {
              if (existing.transfer.amount === amount) {
                existing.count += 1;
                existing.sourceIds.add(sample.feedId);
              }
              return;
            }
            observedTransfers.set(key, {
              count: 1,
              sourceIds: new Set([sample.feedId]),
              transfer: {
                transactionHash: transaction.txid,
                blockchain: 'bitcoin',
                blockHeight: transaction.status.block_height ?? block.height,
                timestampMs,
                sourceProvider: sample.sourceName,
                asset: 'BTC',
                amount,
                estimatedUsd: finiteNumber(options.btcPriceUsd) && options.btcPriceUsd > 0
                  ? amount * options.btcPriceUsd
                  : null,
                confirmationStatus: 'CONFIRMED',
                transferId: `vout:${index}`,
                fromAddresses: transaction.vin?.flatMap((input) =>
                  typeof input?.prevout?.scriptpubkey_address === 'string'
                    ? [input.prevout.scriptpubkey_address]
                    : []
                ),
                toAddress: typeof output.scriptpubkey_address === 'string'
                  ? output.scriptpubkey_address
                  : undefined,
              },
            });
          });
        }
      }
    }
    const confirmedTransfers = [...observedTransfers.values()]
      .filter(({ count }) => count >= 2)
      .map(({ transfer, count, sourceIds }) => ({
        ...transfer,
        providerConfirmations: count,
        confirmingSourceIds: [...sourceIds],
      }));
    const confirmedTransferKeys = new Set(confirmedTransfers.map((transfer) =>
      `${transfer.transactionHash}:${transfer.transferId}`
    ));
    const pendingTransfers = (mempoolData?.largeTransfers ?? []).filter((transfer) =>
      !confirmedTransferKeys.has(`${transfer.transactionHash}:${transfer.transferId}`)
    );
    const transfers = [...confirmedTransfers, ...pendingTransfers];

    const latestBlocks = successfulSources.map(({ blocks }) => blocks[0]);
    const latestBlock = latestBlocks[0];
    const timestampMs = Math.min(...latestBlocks.map(({ timestamp }) => timestamp * 1_000));
    const ageMs = verificationNowMs - timestampMs;
    const sourceId = successfulSources[0].sourceId;
    const fallbackSourceId = successfulSources[1]?.sourceId;
    if (ageMs < 0 || ageMs > maxAgeMs) {
      return {
        ...unavailable('Latest public Bitcoin block sample is stale or has a future timestamp.', 'STALE'),
        sourceId,
        fallbackSourceId,
      };
    }
    const result: CouncilWhaleFlowData = {
      status: ageMs <= MAX_ONCHAIN_VOTE_AGE_MS ? 'LIVE' : 'STALE',
      provider: [
        mempoolData?.provider,
        `${successfulSources.map(({ sourceName }) => sourceName).join(', ')} public transaction feeds (sampled confirmed BTC outputs)`,
      ].filter(Boolean).join('; '),
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
      windowStartHeight: Math.min(...successfulSources.map(({ blocks }) => blocks.at(-1)!.height)),
      windowEndHeight: latestBlock.height,
      sourceId,
      fallbackSourceId,
      independentProviderCount: new Set([
        ...successfulSources.map(({ sourceId }) => sourceId),
        ...(mempoolData?.independentSourceIds ?? []),
      ]).size,
      independentSourceIds: [...new Set([
        ...successfulSources.map(({ sourceId }) => sourceId),
        ...(mempoolData?.independentSourceIds ?? []),
      ])],
      providerParticipation,
      ...(mempoolData?.networkMetrics ? { networkMetrics: mempoolData.networkMetrics } : {}),
    };
    if (!options.historicalBackfill) {
      cachedResult = result;
      cachedAtMs = nowMs;
      lastSuccessfulAtMs = nowMs;
      lastSuccessfulResult = { ...result, largeTransfers: [...transfers] };
    }
    return { ...result, largeTransfers: [...transfers] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown public Bitcoin provider error.';
    console.error('[PublicBitcoinWhaleData] Source unavailable:', reason);
    if (
      !options.historicalBackfill &&
      lastSuccessfulResult &&
      nowMs >= lastSuccessfulAtMs &&
      nowMs - lastSuccessfulAtMs <= LAST_SUCCESSFUL_CACHE_TTL_MS
    ) {
      const timestampMs = lastSuccessfulResult.timestampMs;
      const ageMs = timestampMs === null ? null : nowMs - timestampMs;
      return {
        ...lastSuccessfulResult,
        status: ageMs !== null && ageMs <= MAX_ONCHAIN_VOTE_AGE_MS ? 'LIVE' : 'STALE',
        ageMs,
        unavailableReason: `Public Bitcoin refresh failed (${reason}); using the last successful sample from ${Math.round((nowMs - lastSuccessfulAtMs) / 60_000)} minutes ago.`,
        largeTransfers: [...(lastSuccessfulResult.largeTransfers ?? [])],
      };
    }

    const failedResult = {
      ...unavailable(reason),
      retrievedAtMs: Date.now(),
    };
    if (!options.historicalBackfill) {
      cachedResult = failedResult;
      cachedAtMs = nowMs;
    }
    return failedResult;
  }
}

export async function fetchPublicBitcoinWhaleData(options: {
  nowMs?: number;
  btcPriceUsd?: number | null;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  forceRefresh?: boolean;
  historicalBackfill?: boolean;
} = {}): Promise<CouncilWhaleFlowData> {
  const refresh = options.historicalBackfill
    ? refreshPublicBitcoinWhaleData(options)
    : activeRefreshPromise ?? refreshPublicBitcoinWhaleData(options);
  if (options.historicalBackfill) {
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
  }
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
  if (prefetchRunning) return;
  prefetchRunning = true;
  const refresh = (): void => {
    if (!prefetchRunning || prefetchInFlight) return;
    const operation = Promise.all(REALTIME_INGESTION_ASSETS.map(async (asset) => {
      const observedAtMs = Date.now();
      try {
        const flow = asset === 'BTC'
          ? await fetchPublicBitcoinWhaleData({ forceRefresh: true })
          : await fetchOnChainWhaleDataUntracked({
              pair: `${asset}/USDT:USDT`,
              nowMs: observedAtMs,
              forceRefresh: true,
            });
        const prepared = asset === 'BTC'
          ? await applyOnChainFlowHeuristic({
              ...flow,
              pair: 'BTC/USDT:USDT',
              asset: 'BTC',
            }, Date.now())
          : flow;
        const completedAtMs = Date.now();
        const enriched = await recordOnChainRealtimeFlow(prepared, completedAtMs);
        if (enriched.status === 'LIVE' &&
            enriched.timestampMs !== null &&
            enriched.timestampMs <= completedAtMs &&
            completedAtMs - enriched.timestampMs < MAX_ONCHAIN_VOTE_AGE_MS) {
          precomputedFlowByAsset.set(asset, {
            flow: enriched,
            preparedAtMs: Date.now(),
          });
        }
        return enriched;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[PublicBitcoinWhaleData] ${asset} background ingestion failed: ${reason}`);
        return null;
      }
    }));
    prefetchInFlight = operation;
    void operation.then(
      () => {},
      (error: unknown) => {
        console.error('[PublicBitcoinWhaleData] Background ingestion cycle failed:', error);
      },
    ).finally(() => {
      if (prefetchInFlight === operation) prefetchInFlight = null;
    });
  };
  refresh();
  prefetchTimer = setInterval(refresh, PREFETCH_INTERVAL_MS);
  prefetchTimer.unref();
}

export async function stopPublicBitcoinWhaleDataPrefetch(): Promise<void> {
  prefetchRunning = false;
  if (prefetchTimer) clearInterval(prefetchTimer);
  prefetchTimer = null;
  await prefetchInFlight;
  await flushOnChainWalletCandidates();
}

async function fetchOnChainWhaleDataUntracked(options: {
  pair: string;
  nowMs?: number;
  priceUsd?: number | null;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  forceRefresh?: boolean;
  historicalBackfill?: boolean;
}): Promise<CouncilWhaleFlowData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (!asset || !isSupportedOnChainAsset(asset)) {
    throw new Error(`Unsupported pair for on-chain analysis: ${options.pair}`);
  }
  const cachedFlow = precomputedFlowByAsset.get(asset);
  const cacheAgeMs = Date.now() - (cachedFlow?.preparedAtMs ?? 0);
  if (
    !options.forceRefresh &&
    !options.fetcher &&
    cachedFlow &&
    cacheAgeMs >= 0 &&
    cacheAgeMs <= PRECOMPUTED_FLOW_MAX_AGE_MS &&
    cachedFlow.flow.timestampMs !== null &&
    Date.now() - cachedFlow.flow.timestampMs <= MAX_ONCHAIN_VOTE_AGE_MS
  ) {
    return {
      ...cachedFlow.flow,
      ageMs: Date.now() - cachedFlow.flow.timestampMs,
      largeTransfers: (cachedFlow.flow.largeTransfers ?? []).map((transfer) => ({
        ...transfer,
        estimatedUsd: finiteNumber(options.priceUsd) && options.priceUsd > 0
          ? transfer.amount * options.priceUsd
          : null,
      })),
    };
  }
  if (asset === 'BTC') {
    const bitcoin = await fetchPublicBitcoinWhaleData({
      nowMs: options.nowMs,
      btcPriceUsd: options.priceUsd,
      fetcher: options.fetcher,
      sleep: options.sleep,
      forceRefresh: options.forceRefresh,
      historicalBackfill: options.historicalBackfill,
    });
    if (bitcoin.status !== 'LIVE' && !options.historicalBackfill) {
      const alert = await fetchWhaleAlertFlow({
        apiKey: process.env.WHALE_ALERT_API_KEY,
        nowMs: options.nowMs,
        fetcher: options.fetcher,
      });
      if (alert.status === 'LIVE') {
        return applyOnChainFlowHeuristic({
          ...alert,
          pair: options.pair,
          asset,
          provider: `Optional fallback: ${alert.provider}`,
          unavailableReason: bitcoin.unavailableReason,
        }, options.nowMs ?? Date.now());
      }
    }
    return applyOnChainFlowHeuristic({
      ...bitcoin,
      pair: options.pair,
      asset,
      largeTransfers: (bitcoin.largeTransfers ?? []).map((transfer) => ({
        ...transfer,
        estimatedUsd: finiteNumber(options.priceUsd) && options.priceUsd > 0
          ? transfer.amount * options.priceUsd
          : null,
      })),
    }, options.nowMs ?? Date.now());
  }
  if (asset === 'ETH') {
    const addresses = getConfiguredAddresses();
    const configuredThreshold = Number(process.env.SBK1_WHALE_MIN_ETH ?? '100');
    if (!Number.isFinite(configuredThreshold) || configuredThreshold <= 0) {
      return {
        ...unavailable('SBK1_WHALE_MIN_ETH must be a positive native-ETH threshold.'),
        pair: options.pair,
        asset,
      };
    }
    const threshold = Math.max(100, configuredThreshold);
    const fetchEthereumPublicRpcFallback = async (): Promise<CouncilWhaleFlowData> => {
      const candidates = await loadOnChainWalletCandidates('ETH', options.nowMs ?? Date.now());
      const rpcResult = await fetchPublicEvmOnChainData({
        pair: options.pair,
        asset: 'ETH',
        blockchain: 'ethereum',
        chainId: 1,
        providers: getOnChainMonitoringFeeds('ETH')
          .filter((feed) => feed.dataType === 'json-rpc')
          .map(({ id, councilSourceId, provider, operator, url }) => ({
            name: provider,
            operator,
            endpoint: url,
            sourceId: councilSourceId ?? id,
          })),
        addresses,
        candidateAddresses: candidates.map(({ address }) => address),
        threshold,
        priceUsd: options.priceUsd,
        nowMs: options.nowMs,
        fetcher: options.fetcher,
        historicalBackfill: options.historicalBackfill,
      });
      return applyOnChainFlowHeuristic({
        ...rpcResult,
        pair: options.pair,
        asset,
        sourceId: 'onchain.ethereum-public-rpc',
        unavailableReason: rpcResult.unavailableReason,
      }, options.nowMs ?? Date.now());
    };
    const rpcResult = await fetchEthereumPublicRpcFallback();
    if (
      rpcResult.status === 'LIVE' &&
      (rpcResult.independentProviderCount ?? 0) >= 2
    ) return rpcResult;
    if (options.historicalBackfill) return rpcResult;
    try {
      if (!process.env.ETHERSCAN_API_KEY?.trim() || addresses.length === 0) {
        return rpcResult;
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
        return applyOnChainFlowHeuristic({
          pair: options.pair,
          asset,
          status: isFresh ? 'LIVE' : 'STALE',
          provider: 'Etherscan Ethereum configured address watchlist (native ETH and ERC-20)',
          sourceId: 'onchain.etherscan-transfers',
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
          independentProviderCount: 1,
        }, options.nowMs ?? Date.now());
      }
      return {
        ...rpcResult,
        unavailableReason: [
          rpcResult.unavailableReason,
          'Etherscan returned no qualifying confirmed native ETH or configured ERC-20 transfers.',
        ].filter(Boolean).join(' '),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error('[PublicBitcoinWhaleData] Ethereum on-chain source unavailable:', reason);
      return {
        ...rpcResult,
        unavailableReason: [rpcResult.unavailableReason, `Etherscan unavailable: ${reason}`]
          .filter(Boolean).join(' '),
      };
    }
  }
  if (asset === 'SOL') {
    const flow = await fetchSolanaOnChainData({
      pair: options.pair,
      nowMs: options.nowMs,
      priceUsd: options.priceUsd,
      fetcher: options.fetcher,
      historicalBackfill: options.historicalBackfill,
    });
    return applyOnChainFlowHeuristic(flow, options.nowMs ?? Date.now());
  }
  if (asset === 'XRP') {
    const flow = await fetchXrpOnChainData({
      pair: options.pair,
      nowMs: options.nowMs,
      priceUsd: options.priceUsd,
      fetcher: options.fetcher,
      historicalBackfill: options.historicalBackfill,
    });
    return applyOnChainFlowHeuristic(flow, options.nowMs ?? Date.now());
  }
  if (asset === 'BNB') {
    const flow = await fetchBscOnChainData({
      pair: options.pair,
      nowMs: options.nowMs,
      priceUsd: options.priceUsd,
      fetcher: options.fetcher,
      historicalBackfill: options.historicalBackfill,
    });
    return applyOnChainFlowHeuristic(flow, options.nowMs ?? Date.now());
  }
  return {
    ...unavailable(`No verified ${asset} chain provider is configured; Bitcoin or other-chain evidence is not substituted.`),
    pair: options.pair,
    asset,
  };
}

export async function fetchOnChainWhaleData(options: {
  pair: string;
  nowMs?: number;
  priceUsd?: number | null;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  forceRefresh?: boolean;
  historicalBackfill?: boolean;
}): Promise<CouncilWhaleFlowData> {
  const flow = await fetchOnChainWhaleDataUntracked(options);
  return recordOnChainRealtimeFlow(flow, options.nowMs ?? Date.now());
}

export function resetPublicBitcoinWhaleDataCacheForTests(): void {
  resetOnChainProviderHealthForTests();
  prefetchRunning = false;
  if (prefetchTimer) clearInterval(prefetchTimer);
  prefetchTimer = null;
  prefetchInFlight = null;
  precomputedFlowByAsset.clear();
  cachedAtMs = 0;
  cachedResult = null;
  lastSuccessfulAtMs = 0;
  lastSuccessfulResult = null;
  lastRequestStartedAtMs = 0;
  requestStartQueue = Promise.resolve();
  activeRefreshPromise = null;
  resetOnChainRealtimeStateForTests();
}
