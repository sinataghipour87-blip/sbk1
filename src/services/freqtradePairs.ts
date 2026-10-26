export const SUPPORTED_FREQTRADE_PAIRS = [
  'BTC/USDT:USDT',
  'ETH/USDT:USDT',
  'SOL/USDT:USDT',
  'XRP/USDT:USDT',
  'BNB/USDT:USDT',
] as const;

export const PRIMARY_FREQTRADE_PAIR = SUPPORTED_FREQTRADE_PAIRS[0];

export type SupportedFreqtradePair = typeof SUPPORTED_FREQTRADE_PAIRS[number];

export function getFreqtradePairBaseAsset(pair: string): string | null {
  if (!SUPPORTED_FREQTRADE_PAIRS.includes(pair as SupportedFreqtradePair)) return null;
  return pair.slice(0, pair.indexOf('/'));
}

export function parseFreqtradePairs(value: string): SupportedFreqtradePair[] {
  const pairs = value.split(',').map((pair) => pair.trim()).filter(Boolean);
  if (
    pairs.length !== SUPPORTED_FREQTRADE_PAIRS.length ||
    new Set(pairs).size !== pairs.length ||
    SUPPORTED_FREQTRADE_PAIRS.some((supportedPair) => !pairs.includes(supportedPair))
  ) {
    throw new Error(
      `SBK1_FREQTRADE_PAIRS must contain each supported pair exactly once: ${SUPPORTED_FREQTRADE_PAIRS.join(', ')}.`,
    );
  }
  return pairs as SupportedFreqtradePair[];
}

export function getConfiguredFreqtradePairs(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const configuredPairs = env.SBK1_FREQTRADE_PAIRS?.trim();
  if (configuredPairs) return parseFreqtradePairs(configuredPairs);
  const legacyPair = env.SBK1_FREQTRADE_PAIR?.trim() || env.FREQTRADE_PAIR?.trim();
  return legacyPair ? [legacyPair] : [...SUPPORTED_FREQTRADE_PAIRS];
}
