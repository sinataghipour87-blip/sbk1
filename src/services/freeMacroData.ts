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

const FRED_CSV_ENDPOINT = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
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

async function fetchResponse(
  endpoint: string,
  fetcher: typeof fetch,
  accept = 'application/json',
): Promise<{ response: Response; retrievedAtMs: number; latencyMs: number }> {
  const startedAtMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(endpoint, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: accept },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const retrievedAtMs = Date.now();
    return { response, retrievedAtMs, latencyMs: Math.max(0, retrievedAtMs - startedAtMs) };
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
): Promise<DirectMetricResult> {
  const cached = cachedResult(`fred:${seriesId}`, nowMs);
  if (cached) return cached;

  const endpointUrl = new URL(FRED_CSV_ENDPOINT);
  const endDate = new Date(nowMs).toISOString().slice(0, 10);
  const startDate = new Date(nowMs - 14 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  endpointUrl.searchParams.set('id', seriesId);
  endpointUrl.searchParams.set('cosd', startDate);
  endpointUrl.searchParams.set('coed', endDate);
  const endpoint = endpointUrl.toString();
  try {
    const { response, retrievedAtMs, latencyMs } = await fetchResponse(
      endpoint,
      fetcher,
      'text/csv, application/csv;q=0.9',
    );
    const rows = (await response.text()).trim().split(/\r?\n/);
    const expectedHeader = `observation_date,${seriesId}`;
    if (rows.length < 2 || rows[0].replace(/^\uFEFF/, '').trim() !== expectedHeader) {
      throw new Error('FRED returned a malformed CSV response.');
    }

    const observations = rows.slice(1).flatMap((row) => {
      const separator = row.indexOf(',');
      if (separator < 0) return [];
      const date = row.slice(0, separator).trim();
      const rawValue = row.slice(separator + 1).trim();
      if (rawValue.length === 0 || rawValue === '.') return [];
      const value = Number(rawValue);
      return Number.isFinite(value) ? [{ date, value }] : [];
    }).sort((left, right) => left.date.localeCompare(right.date));
    const latest = observations.at(-1);
    const previous = observations.at(-2);
    const observedAtMs = latest ? validObservedAt(latest.date, nowMs, FRED_MAX_AGE_MS) : null;
    if (!latest || observedAtMs === null) {
      if (!latest) {
        throw new Error(`${seriesId} returned no finite observations in the requested date range.`);
      }
      const latestDateMs = /^\d{4}-\d{2}-\d{2}$/.test(latest.date)
        ? Date.parse(`${latest.date}T00:00:00.000Z`)
        : Number.NaN;
      const ageMs = Number.isFinite(latestDateMs) ? nowMs - latestDateMs : Number.NaN;
      if (Number.isFinite(ageMs) && ageMs < 0) {
        throw new Error(`${seriesId} latest observation ${latest.date} is future-dated.`);
      }
      if (Number.isFinite(ageMs)) {
        throw new Error(
          `${seriesId} latest finite observation is ${latest.date} (${Math.round(ageMs / 60_000)} minutes old), exceeding the ${Math.round(FRED_MAX_AGE_MS / 60_000)}-minute freshness limit.`,
        );
      }
      throw new Error(`${seriesId} latest observation date is malformed.`);
    }

    const result: DirectMetricResult = {
      status: 'LIVE',
      provider: 'FRED public CSV',
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
      'FRED public CSV',
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
    const { response, retrievedAtMs, latencyMs } = await fetchResponse(COINMETRICS_ENDPOINT, fetcher);
    const value: unknown = await response.json();
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
  } = {},
): Promise<FreeMacroDataResult> {
  const nowMs = options.nowMs ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const fred = (seriesId: string, metric: string) =>
    fetchFredSeries(seriesId, metric, nowMs, fetcher);
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
