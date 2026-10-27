import type { CouncilWhaleFlowData } from './eightMemberCouncil';
import { loadVerifiedEthereumExchangeLabels } from './exchangeLabels';
import { fetchPublicEvmOnChainData } from './publicEvmOnChain';

const PUBLIC_RPC_PROVIDERS = [
  { name: 'PublicNode Ethereum RPC', endpoint: 'https://ethereum-rpc.publicnode.com/' },
  { name: '1RPC Ethereum', endpoint: 'https://1rpc.io/eth' },
] as const;
const DEFAULT_THRESHOLD_ETH = 1_000;

export interface EthereumLargeTransferResult {
  status: 'LIVE' | 'UNAVAILABLE';
  sourceId: 'onchain.ethereum-publicnode' | 'onchain.ethereum-1rpc';
  provider: string;
  thresholdEth: number;
  confirmationsRequired: 12;
  coverage: 'VERIFIED_EXCHANGE_DESTINATIONS' | 'UNAVAILABLE';
  evidence: CouncilWhaleFlowData | null;
  reason?: string;
}

export async function fetchEthereumLargeTransfers(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
  thresholdEth?: number;
  fetcher?: typeof fetch;
}): Promise<EthereumLargeTransferResult> {
  const thresholdEth = options.thresholdEth ??
    Number(process.env.SBK1_ETH_LARGE_TRANSFER_MIN_ETH ?? DEFAULT_THRESHOLD_ETH);
  if (!Number.isFinite(thresholdEth) || thresholdEth <= 0) {
    throw new Error('SBK1_ETH_LARGE_TRANSFER_MIN_ETH must be a positive number.');
  }
  const labels = await loadVerifiedEthereumExchangeLabels(options.nowMs ?? Date.now());
  if (labels.length === 0) {
    return {
      status: 'UNAVAILABLE',
      sourceId: 'onchain.ethereum-publicnode',
      provider: 'PublicNode Ethereum RPC / 1RPC',
      thresholdEth,
      confirmationsRequired: 12,
      coverage: 'UNAVAILABLE',
      evidence: null,
      reason: 'No public-source-verified Ethereum exchange wallet labels are configured; no addresses were inferred.',
    };
  }
  const evidence = await fetchPublicEvmOnChainData({
    pair: options.pair,
    asset: 'ETH',
    blockchain: 'ethereum',
    chainId: 1,
    providers: PUBLIC_RPC_PROVIDERS,
    addresses: labels.map(({ address }) => address),
    threshold: thresholdEth,
    priceUsd: options.priceUsd,
    nowMs: options.nowMs,
    fetcher: options.fetcher,
  });
  return {
    status: evidence.status === 'LIVE' ? 'LIVE' : 'UNAVAILABLE',
    sourceId: evidence.provider.includes('1RPC')
      ? 'onchain.ethereum-1rpc'
      : 'onchain.ethereum-publicnode',
    provider: evidence.provider,
    thresholdEth,
    confirmationsRequired: 12,
    coverage: evidence.status === 'LIVE' ? 'VERIFIED_EXCHANGE_DESTINATIONS' : 'UNAVAILABLE',
    evidence,
    ...(evidence.unavailableReason ? { reason: evidence.unavailableReason } : {}),
  };
}
