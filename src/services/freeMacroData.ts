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
  dxy: DirectMetricResult;
  broadDollar: DirectMetricResult;
  fedEffectiveRate: DirectMetricResult;
  fedTargetUpperBound: DirectMetricResult;
  bitcoinActiveAddresses: DirectMetricResult;
}

const FRED_CSV_ENDPOINT = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const NYFED_EFFR_ENDPOINT = 'https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json';
const MASSIVE_INDICES_SNAPSHOT_ENDPOINT = 'https://api.massive.com/v3/snapshot/indices';
const YAHOO_CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';
const COINMETRICS_ENDPOINT =
  'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=AdrActCnt&limit_per_asset=1&pretty=false';
const FRED_MAX_AGE_MS = 5 * 24 * 60 * 60_000;
const DXY_MAX_AGE_MS = 2 * 60_000;
const DXY_CACHE_TTL_MS = 30_000;
const ON_CHAIN_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
const CACHE_TTL_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

const resultCache = new Map<string, { result: DirectMetricResult; cachedAtMs: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function cachedResult(
  key: string,
  nowMs: number,
  ttlMs = CACHE_TTL_MS,
): DirectMetricResult | null {
  const cached = resultCache.get(key);
  const cacheAgeMs = cached ? nowMs - cached.cachedAtMs : Number.NaN;
  if (!cached || cacheAgeMs < 0 || cacheAgeMs > ttlMs) return null;
  const result = structuredClone(cached.result);
  if (result.observedAtMs !== null) result.ageMs = Math.max(0, nowMs - result.observedAtMs);
  return result;
}

function storeResult(key: string, result: DirectMetricResult, nowMs: number): DirectMetricResult {
  resultCache.set(key, { result: structuredClone(result), cachedAtMs: nowMs });
  return result;
}

function preservePrimaryFailure(
  primary: DirectMetricResult,
  fallback: DirectMetricResult,
): DirectMetricResult {
  if (primary.status === 'LIVE') return primary;
  if (fallback.status === 'LIVE') return fallback;
  return {
    ...fallback,
    error: `${fallback.error ?? 'Fallback unavailable.'} Primary ${primary.provider}: ${primary.error ?? 'unavailable.'}`,
  };
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
    const csv = (await response.text()).trim();
    if (csv.startsWith('<')) {
      throw new Error('FRED returned an HTML maintenance/access page instead of CSV.');
    }
    const rows = csv.split(/\r?\n/);
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

async function fetchNewYorkFedEffectiveRate(
  nowMs: number,
  fetcher: typeof fetch,
): Promise<DirectMetricResult> {
  const cached = cachedResult('nyfed:effr', nowMs);
  if (cached) return cached;

  const endDate = new Date(nowMs).toISOString().slice(0, 10);
  const startDate = new Date(nowMs - 14 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const endpointUrl = new URL(NYFED_EFFR_ENDPOINT);
  endpointUrl.searchParams.set('startDate', startDate);
  endpointUrl.searchParams.set('endDate', endDate);
  const endpoint = endpointUrl.toString();
  try {
    const { response, retrievedAtMs, latencyMs } = await fetchResponse(endpoint, fetcher);
    const payload: unknown = await response.json();
    const rates = isRecord(payload) && Array.isArray(payload.refRates)
      ? payload.refRates
      : [];
    const observations = rates.flatMap((row: unknown) => {
      if (!isRecord(row) || row.type !== 'EFFR' || typeof row.effectiveDate !== 'string') return [];
      const value = Number(row.percentRate);
      const observedAtMs = validObservedAt(row.effectiveDate, nowMs, FRED_MAX_AGE_MS);
      return Number.isFinite(value) && value > 0 && observedAtMs !== null
        ? [{ date: row.effectiveDate, value, observedAtMs }]
        : [];
    }).sort((left, right) => left.date.localeCompare(right.date));
    const latest = observations.at(-1);
    const previous = observations.at(-2);
    if (!latest) {
      throw new Error('New York Fed returned no fresh, finite EFFR observations.');
    }

    return storeResult('nyfed:effr', {
      status: 'LIVE',
      provider: 'Federal Reserve Bank of New York reference rates API (EFFR)',
      endpoint,
      metric: 'Federal funds effective rate',
      value: latest.value,
      previousValue: previous?.value ?? null,
      changePct: previous && previous.value !== 0
        ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
        : null,
      observedAt: latest.date,
      observedAtMs: latest.observedAtMs,
      retrievedAtMs,
      latencyMs,
      ageMs: Math.max(0, nowMs - latest.observedAtMs),
    }, nowMs);
  } catch (error) {
    return unavailable(
      'Federal Reserve Bank of New York reference rates API (EFFR)',
      endpoint,
      'Federal funds effective rate',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function fetchYahooIndex(
  symbol: '^GSPC' | 'DX-Y.NYB',
  metric: string,
  nowMs: number,
  fetcher: typeof fetch,
  maxAgeMs: number,
): Promise<DirectMetricResult> {
  const endpoint = `${YAHOO_CHART_ENDPOINT}/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const cacheKey = `yahoo:index:${symbol}`;
  const cached = cachedResult(cacheKey, nowMs, symbol === 'DX-Y.NYB' ? DXY_CACHE_TTL_MS : CACHE_TTL_MS);
  if (cached) return cached;
  try {
    const { response, retrievedAtMs, latencyMs } = await fetchResponse(endpoint, fetcher);
    const payload: unknown = await response.json();
    const chart = isRecord(payload) && isRecord(payload.chart) ? payload.chart : null;
    const resultRows = chart && Array.isArray(chart.result) ? chart.result : [];
    const row = resultRows.find(isRecord);
    const meta = row && isRecord(row.meta) ? row.meta : null;
    const timestamps = row && Array.isArray(row.timestamp) ? row.timestamp : [];
    const quoteBlock = row && isRecord(row.indicators) && Array.isArray(row.indicators.quote)
      ? row.indicators.quote.find(isRecord)
      : null;
    const closes = quoteBlock && Array.isArray(quoteBlock.close) ? quoteBlock.close : [];
    const latestIndex = Math.min(timestamps.length, closes.length) - 1;
    const observedAtMs = latestIndex >= 0 && Number.isFinite(Number(timestamps[latestIndex]))
      ? Number(timestamps[latestIndex]) * 1_000
      : Number(meta?.regularMarketTime) * 1_000;
    const value = Number(closes[latestIndex] ?? meta?.regularMarketPrice);
    const previousValue = Number(meta?.chartPreviousClose ?? meta?.previousClose);
    if (
      !Number.isSafeInteger(observedAtMs) ||
      !Number.isFinite(value) || value <= 0 ||
      !Number.isFinite(previousValue) || previousValue <= 0 ||
      observedAtMs > nowMs + 60_000 ||
      nowMs - observedAtMs > maxAgeMs
    ) {
      throw new Error(`${symbol} quote is malformed or stale (maximum age ${maxAgeMs}ms).`);
    }
    const result: DirectMetricResult = {
      status: 'LIVE',
      provider: `Yahoo Finance chart (${symbol}; timestamp-validated fallback)`,
      endpoint,
      metric,
      value,
      previousValue,
      changePct: ((value - previousValue) / previousValue) * 100,
      observedAt: new Date(observedAtMs).toISOString(),
      observedAtMs,
      retrievedAtMs,
      latencyMs,
      ageMs: Math.max(0, nowMs - observedAtMs),
    };
    return storeResult(cacheKey, result, nowMs);
  } catch (error) {
    return unavailable(
      `Yahoo Finance chart (${symbol})`,
      endpoint,
      metric,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function fetchMassiveDxy(
  nowMs: number,
  fetcher: typeof fetch,
  apiKey: string | undefined,
): Promise<DirectMetricResult> {
  const endpointUrl = new URL(MASSIVE_INDICES_SNAPSHOT_ENDPOINT);
  endpointUrl.searchParams.set('ticker', 'I:DXY');
  const endpoint = endpointUrl.toString();
  const key = apiKey?.trim();
  if (!key) {
    return unavailable(
      'Massive Indices API',
      endpoint,
      'ICE U.S. Dollar Index (DXY)',
      'MASSIVE_API_KEY is not configured.',
    );
  }

  const cacheKey = 'massive:dxy';
  const cached = cachedResult(cacheKey, nowMs, DXY_CACHE_TTL_MS);
  if (cached) return cached;

  const requestUrl = new URL(endpoint);
  requestUrl.searchParams.set('apiKey', key);
  try {
    const { response, retrievedAtMs, latencyMs } = await fetchResponse(
      requestUrl.toString(),
      fetcher,
    );
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new Error('Massive returned a malformed indices snapshot.');
    }
    const quote = payload.results.find((item: unknown) =>
      isRecord(item) && item.ticker === 'I:DXY'
    );
    if (!isRecord(quote) || quote.timeframe !== 'REAL-TIME' || !isRecord(quote.session)) {
      throw new Error('Massive has no entitled real-time I:DXY index snapshot.');
    }
    const value = Number(quote.value);
    const previousValue = Number(quote.session.previous_close);
    const lastUpdatedNs = Number(quote.last_updated);
    const observedAtMs = Number.isFinite(lastUpdatedNs) && lastUpdatedNs > 0
      ? Math.floor(lastUpdatedNs / 1_000_000)
      : Number.NaN;
    if (
      !Number.isFinite(value) || value <= 0 ||
      !Number.isFinite(previousValue) || previousValue <= 0 ||
      !Number.isSafeInteger(observedAtMs) ||
      observedAtMs > nowMs + 60_000 ||
      nowMs - observedAtMs > DXY_MAX_AGE_MS
    ) {
      throw new Error(
        `Massive I:DXY quote is malformed or stale (maximum age ${DXY_MAX_AGE_MS}ms).`,
      );
    }

    const result: DirectMetricResult = {
      status: 'LIVE',
      provider: 'Massive Indices Snapshot (I:DXY)',
      endpoint,
      metric: 'ICE U.S. Dollar Index (DXY)',
      value,
      previousValue,
      changePct: ((value - previousValue) / previousValue) * 100,
      observedAt: new Date(observedAtMs).toISOString(),
      observedAtMs,
      retrievedAtMs,
      latencyMs,
      ageMs: Math.max(0, nowMs - observedAtMs),
    };
    return storeResult(cacheKey, result, nowMs);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const safeDetail = detail
      .replace(/([?&]apiKey=)[^&\s"']+/gi, '$1[redacted]')
      .replaceAll(key, '[redacted]')
      .replaceAll(encodeURIComponent(key), '[redacted]');
    return unavailable(
      'Massive Indices API',
      endpoint,
      'ICE U.S. Dollar Index (DXY)',
      safeDetail,
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
    massiveApiKey?: string;
  } = {},
): Promise<FreeMacroDataResult> {
  const nowMs = options.nowMs ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const dxyApiKey = options.massiveApiKey ?? process.env.MASSIVE_API_KEY;
  const fred = (seriesId: string, metric: string) =>
    fetchFredSeries(seriesId, metric, nowMs, fetcher);
  const [fredSp500, massiveDxy, broadDollar, fredEffectiveRate, fedTargetUpperBound, bitcoinActiveAddresses] =
    await Promise.all([
      fred('SP500', 'S&P 500 daily close'),
      fetchMassiveDxy(nowMs, fetcher, dxyApiKey),
      fred('DTWEXBGS', 'Federal Reserve broad trade-weighted dollar index; not ICE DXY'),
      fred('DFF', 'Federal funds effective rate'),
      fred('DFEDTARU', 'Federal funds target range upper bound'),
      fetchBitcoinActiveAddresses(nowMs, fetcher),
    ]);

  const [sp500, fallbackDxy, fallbackFedEffectiveRate] = await Promise.all([
    fredSp500.status === 'LIVE'
      ? Promise.resolve(fredSp500)
      : fetchYahooIndex('^GSPC', 'S&P 500 index', nowMs, fetcher, FRED_MAX_AGE_MS),
    massiveDxy.status === 'LIVE'
      ? Promise.resolve(massiveDxy)
      : fetchYahooIndex('DX-Y.NYB', 'ICE U.S. Dollar Index (DXY)', nowMs, fetcher, DXY_MAX_AGE_MS),
    fredEffectiveRate.status === 'LIVE'
      ? Promise.resolve(fredEffectiveRate)
      : fetchNewYorkFedEffectiveRate(nowMs, fetcher),
  ]);

  return {
    sp500: preservePrimaryFailure(fredSp500, sp500),
    dxy: preservePrimaryFailure(massiveDxy, fallbackDxy),
    broadDollar,
    fedEffectiveRate: preservePrimaryFailure(fredEffectiveRate, fallbackFedEffectiveRate),
    fedTargetUpperBound,
    bitcoinActiveAddresses,
  };
}
