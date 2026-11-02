import { getFreqtradePairBaseAsset } from './freqtradePairs';
import {
  parseCexWallets,
  unavailableOnChainFlow,
} from './onChainCexShared';
import {
  fetchPublicEvmOnChainData,
  resetPublicEvmOnChainCacheForTests,
} from './publicEvmOnChain';

const PROVIDER = 'BNB Smart Chain public JSON-RPC (chainid=56)';
const PUBLIC_RPC_PROVIDERS = [
  { name: 'PublicNode BSC RPC', endpoint: 'https://bsc-rpc.publicnode.com/' },
  { name: '1RPC BSC', endpoint: 'https://1rpc.io/bnb' },
] as const;
const MAX_WALLETS = 10;

function validBscAddress(address: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(address);
}

function positiveThreshold(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function fetchBscOnChainData(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
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
  const threshold = positiveThreshold('SBK1_WHALE_MIN_BNB');
  if (watchlist.wallets.length === 0) {
    return unavailableOnChainFlow(
      options.pair,
      'BNB',
      PROVIDER,
      'Verified BNB Smart Chain CEX watchlist is not configured.',
    );
  }
  if (watchlist.wallets.length > MAX_WALLETS || threshold === null) {
    return unavailableOnChainFlow(
      options.pair,
      'BNB',
      PROVIDER,
      [
        watchlist.wallets.length > MAX_WALLETS
          ? `SBK1_BNB_WATCH_ADDRESSES may contain at most ${MAX_WALLETS} addresses.`
          : watchlist.error ?? '',
        threshold === null
          ? 'SBK1_WHALE_MIN_BNB must be configured as a positive native-BNB threshold.'
          : '',
      ].filter(Boolean).join(' '),
    );
  }

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
  const sourceId = result.provider.includes('1RPC')
    ? 'onchain.bsc-1rpc'
    : 'onchain.bsc-publicnode';
  return {
    ...result,
    sourceId,
    ...(sourceId === 'onchain.bsc-1rpc'
      ? { fallbackSourceId: 'onchain.bsc-publicnode' }
      : {}),
  };
}

export function resetBscOnChainCacheForTests(): void {
  resetPublicEvmOnChainCacheForTests();
}
