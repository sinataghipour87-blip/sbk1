export type HyperliquidWhaleStatus = 'LIVE' | 'UNAVAILABLE' | 'REGION_RESTRICTED';

export interface HyperliquidWhalePosition {
  address: string;
  sizeEth: number;
  side: 'LONG' | 'SHORT';
  leverage: number;
  notionalUsd: number;
}

export interface HyperliquidWhaleData {
  status: HyperliquidWhaleStatus;
  provider: 'Hyperliquid public info endpoint';
  sourceId: 'whale.hyperliquid-accounts';
  timestampMs: number | null;
  longEth: number;
  shortEth: number;
  averageLeverage: number | null;
  positions: HyperliquidWhalePosition[];
  coverage: 'CONFIGURED_ACCOUNTS_ONLY' | 'UNAVAILABLE';
  error?: string;
}

const ENDPOINT = 'https://api.hyperliquid.xyz/info';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10_000;
const MIN_REQUEST_INTERVAL_MS = 250;
const MAX_ACCOUNTS = 20;
const cache = new Map<string, { cachedAtMs: number; value: HyperliquidWhaleData }>();
let lastRequestAtMs = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unavailable(error: string, status: HyperliquidWhaleStatus = 'UNAVAILABLE'): HyperliquidWhaleData {
  return {
    status,
    provider: 'Hyperliquid public info endpoint',
    sourceId: 'whale.hyperliquid-accounts',
    timestampMs: null,
    longEth: 0,
    shortEth: 0,
    averageLeverage: null,
    positions: [],
    coverage: 'UNAVAILABLE',
    error,
  };
}

function readConfiguredAccounts(): string[] {
  const raw = process.env.SBK1_HYPERLIQUID_WHALE_ADDRESSES ?? '';
  const addresses = raw.split(',').map((address) => address.trim().toLowerCase()).filter(Boolean);
  if (addresses.some((address) => !/^0x[a-f0-9]{40}$/.test(address))) {
    throw new Error('SBK1_HYPERLIQUID_WHALE_ADDRESSES contains an invalid account address.');
  }
  const unique = [...new Set(addresses)];
  if (unique.length > MAX_ACCOUNTS) {
    throw new Error(`Hyperliquid configured account limit is ${MAX_ACCOUNTS}.`);
  }
  return unique;
}

async function fetchAccount(
  address: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAtMs));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAtMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: address }),
    });
    if (response.status === 403 || response.status === 451) {
      throw Object.assign(new Error(`Hyperliquid HTTP ${response.status} (regional/access restriction).`), {
        regionalRestriction: true,
      });
    }
    if (response.status === 429) {
      throw new Error('Hyperliquid HTTP 429 (rate limit).');
    }
    if (!response.ok) throw new Error(`Hyperliquid returned HTTP ${response.status}.`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHyperliquidWhalePositions(options: {
  addresses?: readonly string[];
  nowMs?: number;
  fetcher?: typeof fetch;
} = {}): Promise<HyperliquidWhaleData> {
  const nowMs = options.nowMs ?? Date.now();
  let addresses: string[];
  try {
    addresses = options.addresses
      ? [...new Set(options.addresses.map((address) => address.trim().toLowerCase()))]
      : readConfiguredAccounts();
    if (addresses.some((address) => !/^0x[a-f0-9]{40}$/.test(address))) {
      throw new Error('A configured Hyperliquid account address is invalid.');
    }
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
  if (addresses.length === 0) {
    return unavailable('No independently verified Hyperliquid account addresses are configured.');
  }
  if (addresses.length > MAX_ACCOUNTS) {
    return unavailable(`Hyperliquid configured account limit is ${MAX_ACCOUNTS}.`);
  }
  const cacheKey = addresses.slice().sort().join(',');
  const cached = cache.get(cacheKey);
  if (cached && nowMs >= cached.cachedAtMs && nowMs - cached.cachedAtMs < CACHE_TTL_MS) {
    return structuredClone(cached.value);
  }
  const fetcher = options.fetcher ?? fetch;
  const positions: HyperliquidWhalePosition[] = [];
  try {
    for (const address of addresses) {
      const payload = await fetchAccount(address, fetcher);
      if (!isRecord(payload) || !Array.isArray(payload.assetPositions)) {
        throw new Error('Hyperliquid clearinghouseState response is malformed.');
      }
      for (const item of payload.assetPositions) {
        if (!isRecord(item) || !isRecord(item.position) || item.position.coin !== 'ETH') continue;
        const sizeEth = Number(item.position.szi);
        const leverageValue = isRecord(item.position.leverage) ? Number(item.position.leverage.value) : Number.NaN;
        const entryPrice = Number(item.position.entryPx);
        if (![sizeEth, leverageValue, entryPrice].every(Number.isFinite) || sizeEth === 0 || leverageValue <= 0) continue;
        positions.push({
          address,
          sizeEth,
          side: sizeEth > 0 ? 'LONG' : 'SHORT',
          leverage: leverageValue,
          notionalUsd: Math.abs(sizeEth) * entryPrice,
        });
      }
    }
  } catch (error) {
    const isRegional = isRecord(error) && error.regionalRestriction === true;
    return unavailable(error instanceof Error ? error.message : String(error), isRegional ? 'REGION_RESTRICTED' : 'UNAVAILABLE');
  }
  const longEth = positions.reduce((sum, position) =>
    sum + (position.side === 'LONG' ? Math.abs(position.sizeEth) : 0), 0);
  const shortEth = positions.reduce((sum, position) =>
    sum + (position.side === 'SHORT' ? Math.abs(position.sizeEth) : 0), 0);
  const leverageWeight = positions.reduce((sum, position) =>
    sum + Math.abs(position.sizeEth) * position.leverage, 0);
  const totalPositionSize = positions.reduce((sum, position) =>
    sum + Math.abs(position.sizeEth), 0);
  const result: HyperliquidWhaleData = {
    status: 'LIVE',
    provider: 'Hyperliquid public info endpoint',
    sourceId: 'whale.hyperliquid-accounts',
    timestampMs: Date.now(),
    longEth,
    shortEth,
    averageLeverage: totalPositionSize > 0 ? leverageWeight / totalPositionSize : null,
    positions,
    coverage: 'CONFIGURED_ACCOUNTS_ONLY',
  };
  cache.set(cacheKey, { cachedAtMs: nowMs, value: result });
  return structuredClone(result);
}

export function resetHyperliquidWhaleCacheForTests(): void {
  cache.clear();
  lastRequestAtMs = 0;
}
