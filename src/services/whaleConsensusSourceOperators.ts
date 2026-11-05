export const QUORUM_ASSETS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'] as const;
export type QuorumAsset = typeof QUORUM_ASSETS[number];

const SOURCE_OPERATORS: Readonly<Record<QuorumAsset, Readonly<Record<string, string>>>> = {
  BTC: {
    'mempool.space': 'mempool-space',
    blockstream: 'blockstream',
    'mempool-emzy': 'emzy',
    'mempool-ninja': 'mempool-ninja',
    btcscan: 'btcscan',
    'mempool-bullbitcoin': 'bullbitcoin',
    'mempool-sweetsats': 'sweetsats',
    'whale-alert': 'whale-alert',
    'local-exchange-address-list': 'local-exchange-address-list',
  },
  ETH: {
    etherscan: 'etherscan',
    blockscout: 'blockscout',
    'whale-alert': 'whale-alert',
    'ethereum-rpc-publicnode': 'publicnode',
    'ethereum-rpc-mevblocker': 'mevblocker',
    'ethereum-rpc-blockrazor': 'blockrazor',
    'ethereum-rpc-flashbots': 'flashbots',
    'ethereum-rpc-meowrpc': 'meowrpc',
    'ethereum-rpc-zan': 'zan',
    'ethereum-rpc-bloxroute': 'bloxroute',
    'ethereum-rpc-nownodes': 'nownodes',
    'local-exchange-address-list': 'local-exchange-address-list',
  },
  BNB: {
    bscscan: 'etherscan',
    etherscan: 'etherscan',
    'etherscan-metadata': 'etherscan',
    'bsc-rpc-publicnode': 'publicnode',
    'bsc-rpc-blockrazor': 'blockrazor',
    'bsc-rpc-meowrpc': 'meowrpc',
    'bsc-rpc-bloxroute': 'bloxroute',
    'bsc-rpc-48club': '48club',
  },
  SOL: {
    'whale-alert': 'whale-alert',
    'solana-rpc-solana-foundation': 'solana-foundation',
    'solana-rpc-solana-foundation-beta': 'solana-foundation',
    'solana-rpc-publicnode': 'allnodes-publicnode',
    'solana-rpc-vibestation': 'solanavibestation',
    'solana-rpc-pocket': 'pocket-network',
    'solana-rpc-web3cdn': 'web3cdn',
  },
  XRP: {
    'whale-alert': 'whale-alert',
    'xrp-rpc-xrplcluster': 'infrastructure-xrpl-foundation',
    'xrp-rpc-xrpl-ws': 'infrastructure-xrpl-foundation',
    'xrp-rpc-honeycluster': 'honeycluster',
    'xrp-rpc-ripple-s1': 'ripple',
    'xrp-rpc-ripple-s2': 'ripple',
    'xrp-rpc-ankr': 'ankr',
  },
};

export function getWhaleSourceOperator(asset: string, sourceId: string): string | null {
  if (!QUORUM_ASSETS.includes(asset as QuorumAsset)) return null;
  return SOURCE_OPERATORS[asset as QuorumAsset][sourceId] ?? null;
}
