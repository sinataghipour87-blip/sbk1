import { getFreqtradePairBaseAsset } from './freqtradePairs';
import {
  nativeThreshold,
  parseCexWallets,
  unavailableOnChainFlow,
} from './onChainCexShared';
import { fetchPublicEvmOnChainData, resetPublicEvmOnChainCacheForTests } from './publicEvmOnChain';
import { getOnChainMonitoringFeeds } from './onChainFeedRegistry';
import { loadOnChainWalletCandidates } from './onChainWalletDiscovery';

const PROVIDER = 'BNB Smart Chain public JSON-RPC (chainid=56)';
function getPublicRpcProviders() {
  return getOnChainMonitoringFeeds('BNB')
    .filter((feed) => feed.dataType === 'json-rpc')
    .map(({ id, councilSourceId, provider, operator, url }) => ({
      name: provider,
      operator,
      endpoint: url,
      sourceId: councilSourceId ?? id,
    }));
}
const MAX_WALLETS = 10;

function validBscAddress(address: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(address);
}

export async function fetchBscOnChainData(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
  historicalBackfill?: boolean;
}): Promise<Awaited<ReturnType<typeof unavailableOnChainFlow>>> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (asset !== 'BNB') {
    return unavailableOnChainFlow(
      options.pair,
      asset ?? 'UNKNOWN',
      PROVIDER,
      'This provider only serves native BNB on BNB Smart Chain (chainid=56).',
    );
  }
  const watchlist = parseCexWallets('SBK1_BNB_WATCH_ADDRESSES', validBscAddress);
  const configuredWatchlist = process.env.SBK1_BNB_WATCH_ADDRESSES?.trim();
  const threshold = nativeThreshold('SBK1_WHALE_MIN_BNB', 5);
  if (watchlist.wallets.length > MAX_WALLETS || threshold === null ||
      (configuredWatchlist && watchlist.error)) {
    return unavailableOnChainFlow(
      options.pair,
      'BNB',
      PROVIDER,
      [
        watchlist.wallets.length > MAX_WALLETS
          ? `SBK1_BNB_WATCH_ADDRESSES may contain at most ${MAX_WALLETS} addresses.`
          : '',
        threshold === null ? 'SBK1_WHALE_MIN_BNB must be a positive native-BNB threshold.' : '',
        configuredWatchlist && watchlist.error ? watchlist.error : '',
      ].filter(Boolean).join(' '),
    );
  }

  const candidates = await loadOnChainWalletCandidates('BNB', options.nowMs ?? Date.now());
  const result = await fetchPublicEvmOnChainData({
    pair: options.pair,
    asset: 'BNB',
    blockchain: 'binance_smart_chain',
    chainId: 56,
    providers: getPublicRpcProviders(),
    addresses: watchlist.wallets.map(({ address }) => address),
    candidateAddresses: candidates.map(({ address }) => address),
    threshold,
    priceUsd: options.priceUsd,
    nowMs: options.nowMs,
    fetcher: options.fetcher,
    historicalBackfill: options.historicalBackfill,
  });
  const sourceId = 'onchain.bsc-publicnode';
  return {
    ...result,
    sourceId,
    fallbackSourceId: result.status === 'UNAVAILABLE' ? undefined : 'onchain.bsc-publicnode',
  };
}

export function resetBscOnChainCacheForTests(): void {
  resetPublicEvmOnChainCacheForTests();
}
