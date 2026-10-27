import type { CouncilWhaleTransfer } from './eightMemberCouncil';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import {
  fetchJson,
  isRecord,
  makeOnChainFlow,
  parseCexWallets,
  redactCredential,
  unavailableOnChainFlow,
} from './onChainCexShared';
import { fetchPublicEvmOnChainData } from './publicEvmOnChain';

const PROVIDER = 'BNB Smart Chain native-asset provider (chainid=56)';
const ETHERSCAN_PROVIDER = 'Etherscan V2 (BNB Smart Chain chainid=56)';
const PUBLIC_RPC_PROVIDERS = [
  { name: 'Binance BSC public RPC', endpoint: 'https://bsc-dataseed.binance.org/' },
  { name: 'PublicNode BSC RPC', endpoint: 'https://bsc-rpc.publicnode.com/' },
] as const;
const CACHE_TTL_MS = 60_000;
const MAX_AGE_MS = 5 * 60_000;
const REQUIRED_CONFIRMATIONS = 12;
const MAX_WALLETS = 10;
let lastRequestAtMs = 0;
const cached = new Map<string, { cachedAtMs: number; value: Awaited<ReturnType<typeof fetchBscOnChainData>> }>();

interface BscTransaction {
  hash: string;
  timeStamp: string;
  blockNumber: string;
  confirmations: string;
  value: string;
  to: string;
  isError: string;
}

function validBscAddress(address: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(address);
}

function positiveThreshold(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validTransaction(value: unknown): value is BscTransaction {
  return isRecord(value) &&
    typeof value.hash === 'string' &&
    /^0x[0-9a-f]{64}$/i.test(value.hash) &&
    typeof value.timeStamp === 'string' &&
    /^\d+$/.test(value.timeStamp) &&
    typeof value.blockNumber === 'string' &&
    /^\d+$/.test(value.blockNumber) &&
    typeof value.confirmations === 'string' &&
    /^\d+$/.test(value.confirmations) &&
    typeof value.value === 'string' &&
    /^\d+$/.test(value.value) &&
    typeof value.to === 'string' &&
    /^0x[0-9a-f]{40}$/i.test(value.to) &&
    typeof value.isError === 'string';
}

function unitsToBnb(wei: string): number {
  const value = BigInt(wei);
  const scale = 10n ** 18n;
  const amount = Number(value / scale) + Number(value % scale) / Number(scale);
  return Number.isFinite(amount) ? amount : 0;
}

async function requestTransactions(
  fetcher: typeof fetch,
  apiKey: string,
  address: string,
): Promise<unknown[]> {
  const waitMs = Math.max(0, 350 - (Date.now() - lastRequestAtMs));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAtMs = Date.now();
  const url = new URL('https://api.etherscan.io/v2/api');
  url.searchParams.set('chainid', '56');
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '999999999');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '100');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('apikey', apiKey);
  const payload = await fetchJson(url, fetcher, 'BscScan');
  if (
    isRecord(payload) &&
    payload.status === '0' &&
    payload.message === 'No transactions found'
  ) return [];
  if (!isRecord(payload) || !Array.isArray(payload.result)) {
    throw new Error('BscScan transaction response is malformed or unavailable.');
  }
  if (payload.status !== '1' && payload.message !== 'No transactions found') {
    throw new Error('BscScan transaction query was not successful.');
  }
  return payload.result;
}

export async function fetchBscOnChainData(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<Awaited<ReturnType<typeof unavailableOnChainFlow>>> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (asset !== 'BNB') {
    return unavailableOnChainFlow(options.pair, asset ?? 'UNKNOWN', PROVIDER, 'This provider only serves native BNB on BNB Smart Chain (chainid=56).');
  }
  const apiKey = process.env.BSCSCAN_API_KEY?.trim();
  const selectedProvider = apiKey ? ETHERSCAN_PROVIDER : 'BNB Smart Chain public JSON-RPC (chainid=56)';
  const watchlist = parseCexWallets('SBK1_BNB_WATCH_ADDRESSES', validBscAddress);
  const threshold = positiveThreshold('SBK1_WHALE_MIN_BNB');
  if (watchlist.wallets.length === 0) {
    return unavailableOnChainFlow(options.pair, 'BNB', selectedProvider, 'Verified BNB Smart Chain CEX watchlist is not configured.');
  }
  if (watchlist.wallets.length > MAX_WALLETS || threshold === null) {
    return unavailableOnChainFlow(
      options.pair,
      'BNB',
      selectedProvider,
      [
        watchlist.wallets.length > MAX_WALLETS
          ? `SBK1_BNB_WATCH_ADDRESSES may contain at most ${MAX_WALLETS} addresses.`
          : watchlist.error ?? '',
        threshold === null ? 'SBK1_WHALE_MIN_BNB must be configured as a positive native-BNB threshold.' : '',
      ].filter(Boolean).join(' '),
    );
  }
  if (!apiKey) {
    const result = await fetchPublicEvmOnChainData({
      pair: options.pair,
      asset: 'BNB',
      blockchain: 'binance_smart_chain',
      chainId: 56,
      providers: PUBLIC_RPC_PROVIDERS,
      addresses: watchlist.wallets.map(({ address }) => address),
      threshold,
      priceUsd: options.priceUsd,
      nowMs: options.nowMs,
      fetcher: options.fetcher,
    });
    if (result.status !== 'UNAVAILABLE') {
      const sourceId = result.provider.includes('PublicNode')
        ? 'onchain.bsc-publicnode'
        : 'onchain.bsc-public-rpc';
      return {
        ...result,
        provider: `${result.provider} (keyless fallback for BscScan)`,
        sourceId,
        fallbackSourceId: sourceId === 'onchain.bsc-publicnode'
          ? 'onchain.bsc-public-rpc'
          : undefined,
      };
    }
    return result;
  }
  const nowMs = options.nowMs ?? Date.now();
  const cacheEntry = cached.get(options.pair);
  if (cacheEntry && nowMs >= cacheEntry.cachedAtMs && nowMs - cacheEntry.cachedAtMs < CACHE_TTL_MS) {
    return {
      ...cacheEntry.value,
      ageMs: cacheEntry.value.timestampMs === null ? null : nowMs - cacheEntry.value.timestampMs,
    };
  }
  const fetcher = options.fetcher ?? fetch;
  try {
    const transfers: CouncilWhaleTransfer[] = [];
    let latestObservedAtMs = 0;
    for (const wallet of watchlist.wallets) {
      const transactions = await requestTransactions(fetcher, apiKey, wallet.address);
      for (const candidate of transactions) {
        if (!validTransaction(candidate) || candidate.to.toLowerCase() !== wallet.address.toLowerCase() ||
            candidate.isError !== '0') continue;
        const observedAtMs = Number(candidate.timeStamp) * 1_000;
        if (!Number.isSafeInteger(observedAtMs) || observedAtMs > nowMs + 1_000) continue;
        latestObservedAtMs = Math.max(latestObservedAtMs, observedAtMs);
        const amount = unitsToBnb(candidate.value);
        if (
          amount < threshold ||
          Number(candidate.confirmations) < REQUIRED_CONFIRMATIONS ||
          nowMs - observedAtMs > MAX_AGE_MS
        ) continue;
        transfers.push({
          transactionHash: candidate.hash,
          blockchain: 'binance_smart_chain',
          blockHeight: Number(candidate.blockNumber),
          timestampMs: observedAtMs,
          sourceProvider: `${ETHERSCAN_PROVIDER} (configured ${wallet.exchange} destination)`,
          asset: 'BNB',
          amount,
          estimatedUsd: typeof options.priceUsd === 'number' &&
            Number.isFinite(options.priceUsd) &&
            options.priceUsd > 0
            ? amount * options.priceUsd
            : null,
          confirmationStatus: 'CONFIRMED',
          transferId: 'native-bnb',
        });
      }
    }
    const retrievedAtMs = Date.now();
    if (latestObservedAtMs === 0) {
      return unavailableOnChainFlow(
        options.pair,
        'BNB',
        ETHERSCAN_PROVIDER,
        'BscScan returned no timestamped native-BNB transactions for the configured CEX wallets.',
      );
    }
    const result = {
      ...makeOnChainFlow({
        pair: options.pair,
        asset: 'BNB',
        provider: ETHERSCAN_PROVIDER,
        transfers,
        observedAtMs: latestObservedAtMs,
        retrievedAtMs,
      }),
      sourceId: 'onchain.bscscan-bnb',
    };
    cached.set(options.pair, { cachedAtMs: nowMs, value: result });
    return { ...result };
  } catch (error) {
    const reason = redactCredential(error, apiKey);
    console.error('[BscOnChain] BscScan source unavailable:', reason);
    return unavailableOnChainFlow(options.pair, 'BNB', ETHERSCAN_PROVIDER, reason);
  }
}

export function resetBscOnChainCacheForTests(): void {
  cached.clear();
  lastRequestAtMs = 0;
}
