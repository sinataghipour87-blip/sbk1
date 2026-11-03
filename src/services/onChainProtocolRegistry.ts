import type { OnChainAsset } from './onChainFeedRegistry';

export interface OnChainProtocolDefinition {
  id: string;
  asset: 'ETH' | 'BNB';
  chainId: 1 | 56;
  factoryAddress: string;
  routerAddress: string;
  wrappedNativeAddress: string;
  name: string;
  sourceUrl: string;
}

export const ONCHAIN_PROTOCOLS: readonly OnChainProtocolDefinition[] = [
  {
    id: 'uniswap-v2-ethereum',
    asset: 'ETH',
    chainId: 1,
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    wrappedNativeAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    name: 'Uniswap V2',
    sourceUrl: 'https://developers.uniswap.org/docs/protocols/v2/deployments',
  },
  {
    id: 'pancakeswap-v2-bsc',
    asset: 'BNB',
    chainId: 56,
    factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    wrappedNativeAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    name: 'PancakeSwap V2',
    sourceUrl: 'https://developer.pancakeswap.finance/contracts/v2/addresses',
  },
];

export function getOnChainProtocol(
  asset: OnChainAsset,
): OnChainProtocolDefinition | null {
  return ONCHAIN_PROTOCOLS.find((protocol) => protocol.asset === asset) ?? null;
}
