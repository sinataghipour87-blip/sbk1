export type DirectFeedStatus = 'LIVE' | 'UNAVAILABLE';

export interface DirectMetricResult {
  status: DirectFeedStatus;
  provider: string;
  endpoint: string;
  metric: string;
  value: number | null;
  previousValue: number | null;
  changePct: number | null;
  observedAt: string | null;
  observedAtMs: number | null;
  retrievedAtMs: number | null;
  latencyMs: number | null;
  ageMs: number | null;
  error?: string;
}

export interface FreeMacroDataResult {
  sp500: DirectMetricResult;
  broadDollar: DirectMetricResult;
  fedEffectiveRate: DirectMetricResult;
  fedTargetUpperBound: DirectMetricResult;
  bitcoinActiveAddresses: DirectMetricResult;
}

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const COINMETRICS_ENDPOINT =
  'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=AdrActCnt&limit_per_asset=1&pretty=false';
const FRED_MAX_AGE_MS = 5 * 24 * 60 * 60_000;
const ON_CHAIN_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
const CACHE_TTL_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

const resultCache = new Map<string, { result: DirectMetricResult; cachedAtMs: number }>();

function unavailable(
  provider: string,
  endpoint: string,
  metric: string,
  error: string,
): DirectMetricResult {
  return {
    status: 'UNAVAILABLE',
    provider,
    endpoint,
    metric,
    value: null,
    previousValue: null,
    changePct: null,
    observedAt: null,
    observedAtMs: null,
    retrievedAtMs: null,
    latencyMs: null,
    ageMs: null,
    error,
  };
}

async function fetchJson(
  endpoint: string,
  fetcher: typeof fetch,
): Promise<{ value: unknown; retrievedAtMs: number; latencyMs: number }> {
  const startedAtMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(endpoint, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    const retrievedAtMs = Date.now();
    return { value, retrievedAtMs, latencyMs: Math.max(0, retrievedAtMs - startedAtMs) };
  } finally {
    clearTimeout(timeout);
  }
}

function validObservedAt(value: unknown, nowMs: number, maxAgeMs: number): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const observedAtMs = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isSafeInteger(observedAtMs) ||
    observedAtMs > nowMs + 60_000 ||
    nowMs - observedAtMs > maxAgeMs
  ) return null;
  return observedAtMs;
}

function cachedResult(key: string, nowMs: number): DirectMetricResult | null {
  const cached = resultCache.get(key);
  if (!cached || nowMs - cached.cachedAtMs > CACHE_TTL_MS) return null;
  const result = structuredClone(cached.result);
  if (result.observedAtMs !== null) result.ageMs = Math.max(0, nowMs - result.observedAtMs);
  return result;
}

function storeResult(key: string, result: DirectMetricResult, nowMs: number): DirectMetricResult {
  resultCache.set(key, { result: structuredClone(result), cachedAtMs: nowMs });
  return result;
}

async function fetchFredSeries(
  seriesId: string,
  metric: string,
  nowMs: number,
  fetcher: typeof fetch,
  apiKey = process.env.FRED_API_KEY?.trim(),
): Promise<DirectMetricResult> {
  const cached = cachedResult(`fred:${seriesId}`, nowMs);
  if (cached) return cached;

  const endpointUrl = new URL(FRED_BASE_URL);
  endpointUrl.searchParams.set('series_id', seriesId);
  endpointUrl.searchParams.set('api_key', apiKey ?? '');
  endpointUrl.searchParams.set('file_type', 'json');
  endpointUrl.searchParams.set('sort_order', 'desc');
  endpointUrl.searchParams.set('limit', '10');
  const endpoint = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}`;
  if (!apiKey) {
    return unavailable('FRED', endpoint, metric, 'FRED_API_KEY_NOT_CONFIGURED');
  }

  try {
    const { value, retrievedAtMs, latencyMs } = await fetchJson(endpointUrl.toString(), fetcher);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('observations' in value) ||
      !Array.isArray(value.observations)
    ) throw new Error('FRED returned a malformed observations response.');

    const observations = value.observations.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null || !('date' in item) || !('value' in item)) return [];
      if (typeof item.date !== 'string' || typeof item.value !== 'string') return [];
      const numericValue = Number(item.value);
      return Number.isFinite(numericValue) ? [{ date: item.date, value: numericValue }] : [];
    });
    const latest = observations[0];
    const previous = observations[1];
    const observedAtMs = latest ? validObservedAt(latest.date, nowMs, FRED_MAX_AGE_MS) : null;
    if (!latest || observedAtMs === null) {
      throw new Error(`${seriesId} has no finite, fresh observation.`);
    }

    const result: DirectMetricResult = {
      status: 'LIVE',
      provider: 'FRED',
      endpoint,
      metric,
      value: latest.value,
      previousValue: previous?.value ?? null,
      changePct: previous && previous.value !== 0
        ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
        : null,
      observedAt: latest.date,
      observedAtMs,
      retrievedAtMs,
      latencyMs,
      ageMs: Math.max(0, nowMs - observedAtMs),
    };
    return storeResult(`fred:${seriesId}`, result, nowMs);
  } catch (error) {
    return unavailable(
      'FRED',
      endpoint,
      metric,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function fetchBitcoinActiveAddresses(
  nowMs: number,
  fetcher: typeof fetch,
): Promise<DirectMetricResult> {
  const cached = cachedResult('coinmetrics:btc:AdrActCnt', nowMs);
  if (cached) return cached;
  try {
    const { value, retrievedAtMs, latencyMs } = await fetchJson(COINMETRICS_ENDPOINT, fetcher);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      !Array.isArray(value.data)
    ) throw new Error('Coin Metrics returned a malformed asset-metrics response.');

    const row = value.data.find((item: unknown) =>
      typeof item === 'object' && item !== null &&
      'asset' in item && item.asset === 'btc' &&
      'AdrActCnt' in item && 'time' in item
    );
    if (!row || typeof row.time !== 'string') {
      throw new Error('Coin Metrics has no BTC active-address observation.');
    }
    const observationTimeMs = Date.parse(row.time);
    const activeAddresses = Number(row.AdrActCnt);
    if (
      !Number.isSafeInteger(observationTimeMs) ||
      observationTimeMs > nowMs + 60_000 ||
      nowMs - observationTimeMs > ON_CHAIN_MAX_AGE_MS ||
      !Number.isSafeInteger(activeAddresses) ||
      activeAddresses <= 0
    ) throw new Error('Coin Metrics BTC active-address observation is invalid or stale.');

    const result: DirectMetricResult = {
      status: 'LIVE',
      provider: 'Coin Metrics Community API',
      endpoint: COINMETRICS_ENDPOINT,
      metric: 'BTC daily active addresses (network activity; not whale flow)',
      value: activeAddresses,
      previousValue: null,
      changePct: null,
      observedAt: row.time,
      observedAtMs: observationTimeMs,
      retrievedAtMs,
      latencyMs,
      ageMs: Math.max(0, nowMs - observationTimeMs),
    };
    return storeResult('coinmetrics:btc:AdrActCnt', result, nowMs);
  } catch (error) {
    return unavailable(
      'Coin Metrics Community API',
      COINMETRICS_ENDPOINT,
      'BTC daily active addresses (network activity; not whale flow)',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function fetchFreeMacroData(
  options: {
    nowMs?: number;
    fetcher?: typeof fetch;
    fredApiKey?: string;
  } = {},
): Promise<FreeMacroDataResult> {
  const nowMs = options.nowMs ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const fredApiKey = options.fredApiKey ?? process.env.FRED_API_KEY?.trim();
  const fred = (seriesId: string, metric: string) =>
    fetchFredSeries(seriesId, metric, nowMs, fetcher, fredApiKey);
  const [sp500, broadDollar, fedEffectiveRate, fedTargetUpperBound, bitcoinActiveAddresses] =
    await Promise.all([
      fred('SP500', 'S&P 500 daily close'),
      fred('DTWEXBGS', 'Federal Reserve broad trade-weighted dollar index; not ICE DXY'),
      fred('DFF', 'Federal funds effective rate'),
      fred('DFEDTARU', 'Federal funds target range upper bound'),
      fetchBitcoinActiveAddresses(nowMs, fetcher),
    ]);

  return { sp500, broadDollar, fedEffectiveRate, fedTargetUpperBound, bitcoinActiveAddresses };
}
