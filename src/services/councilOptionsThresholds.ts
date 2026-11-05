export interface CouncilOptionsThresholds {
  maxAgeMs: number;
  minimumContracts: number;
  minimumContractsPerSide: number;
  minimumSizedOrderBooks: number;
  minimumIndependentSources: number;
}

const CORE_ASSETS = new Set(['BTC', 'ETH']);
const ALTCOIN_ASSETS = new Set(['SOL', 'BNB', 'XRP']);

export function getCouncilOptionsThresholds(asset: string | undefined): CouncilOptionsThresholds | null {
  if (asset && CORE_ASSETS.has(asset)) {
    return {
      maxAgeMs: 60_000,
      minimumContracts: 20,
      minimumContractsPerSide: 4,
      minimumSizedOrderBooks: 8,
      minimumIndependentSources: 2,
    };
  }
  if (asset && ALTCOIN_ASSETS.has(asset)) {
    return {
      maxAgeMs: 60_000,
      minimumContracts: 6,
      minimumContractsPerSide: 2,
      minimumSizedOrderBooks: 4,
      minimumIndependentSources: 1,
    };
  }
  return null;
}
