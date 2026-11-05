export type OnChainAsset = 'BTC' | 'ETH' | 'SOL' | 'BNB' | 'XRP';

export interface OnChainMonitoringFeed {
  id: string;
  asset: OnChainAsset;
  provider: string;
  operator: string;
  url: string;
  dataType: 'block-feed' | 'transaction-feed' | 'json-rpc';
  apiKeyRequired: boolean;
  councilSourceId?: string;
  feedType?: 'finalized-slot' | 'finalized-block-list' | 'full-transaction-blocks';
}

const bitcoinFeeds: readonly OnChainMonitoringFeed[] = [
  { id: 'onchain.monitor.btc.mempool-blocks', asset: 'BTC', provider: 'mempool.space', operator: 'mempool.space', url: 'https://mempool.space/api/v1/blocks', dataType: 'block-feed', apiKeyRequired: false, councilSourceId: 'onchain.mempool-blocks' },
  { id: 'onchain.monitor.btc.mempool-recent', asset: 'BTC', provider: 'mempool.space pending transactions', operator: 'mempool.space', url: 'https://mempool.space/api/mempool/recent', dataType: 'transaction-feed', apiKeyRequired: false, councilSourceId: 'onchain.mempool-blocks' },
  { id: 'onchain.monitor.btc.blockstream-blocks', asset: 'BTC', provider: 'Blockstream Esplora', operator: 'Blockstream', url: 'https://blockstream.info/api/blocks', dataType: 'block-feed', apiKeyRequired: false, councilSourceId: 'onchain.blockstream-blocks' },
  { id: 'onchain.monitor.btc.blockstream-mempool-recent', asset: 'BTC', provider: 'Blockstream Esplora pending transactions', operator: 'Blockstream', url: 'https://blockstream.info/api/mempool/recent', dataType: 'transaction-feed', apiKeyRequired: false, councilSourceId: 'onchain.blockstream-blocks' },
  { id: 'onchain.monitor.btc.btcscan-blocks', asset: 'BTC', provider: 'BTCscan Esplora', operator: 'BTCscan', url: 'https://btcscan.org/api/blocks', dataType: 'block-feed', apiKeyRequired: false, councilSourceId: 'onchain.btcscan-bitcoin' },
  { id: 'onchain.monitor.btc.btcscan-mempool-recent', asset: 'BTC', provider: 'BTCscan pending transactions', operator: 'BTCscan', url: 'https://btcscan.org/api/mempool/recent', dataType: 'transaction-feed', apiKeyRequired: false, councilSourceId: 'onchain.btcscan-bitcoin' },
];

const ethereumFeeds: readonly OnChainMonitoringFeed[] = [
  { id: 'onchain.monitor.eth.publicnode', asset: 'ETH', provider: 'PublicNode Ethereum', operator: 'PublicNode', url: 'https://ethereum-rpc.publicnode.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.ethereum-public-rpc' },
  { id: 'onchain.monitor.eth.publicnode-alias', asset: 'ETH', provider: 'PublicNode Ethereum alias', operator: 'PublicNode', url: 'https://ethereum.publicnode.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.ethereum-public-rpc' },
  { id: 'onchain.monitor.eth.drpc', asset: 'ETH', provider: 'dRPC Ethereum', operator: 'dRPC', url: 'https://eth.drpc.org/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.ethereum-drpc' },
  { id: 'onchain.monitor.eth.blastapi', asset: 'ETH', provider: 'BlastAPI Ethereum', operator: 'BlastAPI', url: 'https://eth-mainnet.public.blastapi.io', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.monitor.eth.blastapi' },
  { id: 'onchain.monitor.eth.flashbots', asset: 'ETH', provider: 'Flashbots Ethereum RPC', operator: 'Flashbots', url: 'https://rpc.flashbots.net', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.ethereum-flashbots' },
  { id: 'onchain.monitor.eth.publicnode-secondary', asset: 'ETH', provider: 'PublicNode Ethereum secondary endpoint', operator: 'PublicNode', url: 'https://ethereum.publicnode.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.ethereum-public-rpc' },
];

const solanaFeeds: readonly OnChainMonitoringFeed[] = [
  { id: 'onchain.monitor.sol.foundation-slots', asset: 'SOL', provider: 'Solana Foundation finalized-slot feed', operator: 'Solana Foundation', url: 'https://api.mainnet-beta.solana.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.solana-public-rpc', feedType: 'finalized-slot' },
  { id: 'onchain.monitor.sol.foundation-block-list', asset: 'SOL', provider: 'Solana Foundation finalized-block-list feed', operator: 'Solana Foundation', url: 'https://api.mainnet-beta.solana.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.solana-public-rpc', feedType: 'finalized-block-list' },
  { id: 'onchain.monitor.sol.foundation-transactions', asset: 'SOL', provider: 'Solana Foundation full-transaction-block feed', operator: 'Solana Foundation', url: 'https://api.mainnet-beta.solana.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.solana-public-rpc', feedType: 'full-transaction-blocks' },
  { id: 'onchain.monitor.sol.publicnode-slots', asset: 'SOL', provider: 'PublicNode finalized-slot feed', operator: 'PublicNode', url: 'https://solana-rpc.publicnode.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.solana-publicnode', feedType: 'finalized-slot' },
  { id: 'onchain.monitor.sol.publicnode-block-list', asset: 'SOL', provider: 'PublicNode finalized-block-list feed', operator: 'PublicNode', url: 'https://solana-rpc.publicnode.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.solana-publicnode', feedType: 'finalized-block-list' },
  { id: 'onchain.monitor.sol.publicnode-transactions', asset: 'SOL', provider: 'PublicNode full-transaction-block feed', operator: 'PublicNode', url: 'https://solana-rpc.publicnode.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.solana-publicnode', feedType: 'full-transaction-blocks' },
];

const bnbFeeds: readonly OnChainMonitoringFeed[] = [
  { id: 'onchain.monitor.bnb.binance-dataseed', asset: 'BNB', provider: 'Binance BSC public RPC', operator: 'Binance', url: 'https://bsc-dataseed.binance.org/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.bsc-public-rpc' },
  { id: 'onchain.monitor.bnb.binance-dataseed-2', asset: 'BNB', provider: 'Binance BSC public RPC dataseed 2', operator: 'Binance', url: 'https://bsc-dataseed2.binance.org/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.bsc-public-rpc' },
  { id: 'onchain.monitor.bnb.publicnode', asset: 'BNB', provider: 'PublicNode BSC', operator: 'PublicNode', url: 'https://bsc-rpc.publicnode.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.bsc-publicnode' },
  { id: 'onchain.monitor.bnb.blastapi', asset: 'BNB', provider: 'BlastAPI BNB Smart Chain', operator: 'BlastAPI', url: 'https://bsc-mainnet.public.blastapi.io', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.bsc-blastapi' },
  { id: 'onchain.monitor.bnb.defibit', asset: 'BNB', provider: 'Defibit BSC public RPC', operator: 'Defibit', url: 'https://bsc-dataseed1.defibit.io/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.bsc-defibit' },
  { id: 'onchain.monitor.bnb.binance-dataseed-3', asset: 'BNB', provider: 'Binance Official BSC DataSeed', operator: 'Binance', url: 'https://bsc-dataseed.binance.org', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.bsc-binance-dataseed' },
];

const xrpFeeds: readonly OnChainMonitoringFeed[] = [
  { id: 'onchain.monitor.xrp.xrpscan', asset: 'XRP', provider: 'XRPSCAN', operator: 'XRPSCAN', url: 'https://api.xrpscan.com/api/v1/account/{address}/transactions?limit=10', dataType: 'transaction-feed', apiKeyRequired: false, councilSourceId: 'onchain.xrpscan-xrp' },
  { id: 'onchain.monitor.xrp.ripple-s1', asset: 'XRP', provider: 'Ripple s1 validated RPC', operator: 'Ripple', url: 'https://s1.ripple.com:51234/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.ripple-s2-xrp' },
  { id: 'onchain.monitor.xrp.ripple-s2', asset: 'XRP', provider: 'Ripple s2 validated RPC', operator: 'Ripple', url: 'https://s2.ripple.com:51234/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.ripple-s2-xrp' },
  { id: 'onchain.monitor.xrp.xrplcluster', asset: 'XRP', provider: 'XRPL Cluster', operator: 'XRPL Cluster', url: 'https://xrplcluster.com/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.xrplcluster-xrp' },
  { id: 'onchain.monitor.xrp.xrpl-ws-http', asset: 'XRP', provider: 'XRPL WS HTTP gateway', operator: 'XRPL Cluster', url: 'https://xrpl.ws/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.xrplcluster-xrp' },
  { id: 'onchain.monitor.xrp.xrpl-link-http', asset: 'XRP', provider: 'XRPL Link HTTP gateway', operator: 'XRPL Cluster', url: 'https://xrpl.link/', dataType: 'json-rpc', apiKeyRequired: false, councilSourceId: 'onchain.xrplcluster-xrp' },
];

export const ONCHAIN_MONITORING_FEEDS: readonly OnChainMonitoringFeed[] = [
  ...bitcoinFeeds,
  ...ethereumFeeds,
  ...solanaFeeds,
  ...bnbFeeds,
  ...xrpFeeds,
];

export function getOnChainMonitoringFeeds(asset: OnChainAsset): readonly OnChainMonitoringFeed[] {
  return ONCHAIN_MONITORING_FEEDS.filter((feed) => feed.asset === asset);
}
