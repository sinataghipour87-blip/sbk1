import {
  COUNCIL_MEMBER_SOURCES,
  getCouncilMemberSources,
  type CouncilSourceDefinition,
} from './councilSourceRegistry';
import type {
  CouncilMemberSourceCheck,
  CouncilWhaleFlowData,
} from './eightMemberCouncil';

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10_000;
const MIN_HOST_INTERVAL_MS = 250;
const ETH_STAKING_DEPOSIT_CONTRACT = '0x00000000219ab540356cBB839CBe05303d7705Fa';
const ETH_STAKING_DEPOSIT_EVENT_TOPIC =
  '0x649bbc62d0e31342afea4e5cd82d4049e7e1ee912fc0889aa790803be39038c5';
type HealthStatus = CouncilMemberSourceCheck['status'];

interface HealthResult {
  status: HealthStatus;
  detail: string;
  httpHealthy?: boolean | null;
  dataValid?: boolean | null;
  dataDetail?: string;
  observedAtMs?: number | null;
  normalizedData?: Readonly<Record<string, number | string | null>>;
  ethPriceUsd?: number | null;
  voteValue?: 'USEFUL' | 'LOW_VALUE' | 'UNKNOWN';
}
interface CacheEntry {
  cachedAtMs: number;
  result: HealthResult;
}

const sourceCache = new Map<string, CacheEntry>();
const sourceInFlight = new Map<string, Promise<HealthResult>>();
const hostQueues = new Map<string, Promise<void>>();
const lastRequestByHost = new Map<string, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timestampMs(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}

function csvObservations(text: string): Array<{ dateMs: number; value: number }> {
  const rows = text.trim().split(/\r?\n/);
  return rows.slice(1).flatMap((row) => {
    const [date, rawValue] = row.split(',');
    const dateMs = Date.parse(date);
    const value = Number(rawValue);
    return date && Number.isFinite(dateMs) && Number.isFinite(value)
      ? [{ dateMs, value }]
      : [];
  });
}

export interface CouncilNewsHeadline {
  title: string;
  description: string;
  categories: string[];
  publishedAt: string;
  publishedAtMs: number | null;
  publisher: string;
  url: string;
}

export interface CouncilNewsFeedDiagnostics {
  valid: boolean;
  detail: string;
  totalItems: number;
  latestPublishedAtMs: number | null;
  relatedItems6h: number;
  relatedItems24h: number;
  relatedItems72h: number;
  invalidDateCount: number;
  missingTimezoneCount: number;
  latestFive: CouncilNewsHeadline[];
  recentRelatedItems: CouncilNewsHeadline[];
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readXmlTag(item: string, tag: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = item.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, 'i'));
  return match ? decodeXmlText(match[1]) : '';
}

function explicitTimezone(date: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(date.trim());
}

function isAssetNewsText(asset: string, value: string): boolean {
  const patterns: Readonly<Record<string, RegExp>> = {
    BTC: /\bBTC\b|\bBitcoin\b/i,
    SOL: /\bSOL\b|\bSolana\b/i,
    XRP: /\bXRP\b|\bRipple\b/i,
    BNB: /\bBNB\b|\bBinance Coin\b|\bBNB Chain\b/i,
    ETH: /\bETH\b|\bEthereum\b|\bEther\b/i,
  };
  return (patterns[asset] ?? new RegExp(`\\b${asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))
    .test(value);
}

function isCouncilNewsFeedSource(source: CouncilSourceDefinition): boolean {
  return source.memberIds?.includes(8) === true &&
    [
      'google-news',
      'ethereum-foundation',
      'coindesk',
      'cointelegraph',
      'decrypt',
      'the-block',
    ].some((suffix) => source.id.endsWith(`.${suffix}`));
}

function sourcePublisher(source: CouncilSourceDefinition): string {
  if (source.id.endsWith('.decrypt')) return 'Decrypt';
  if (source.id.endsWith('.the-block')) return 'The Block';
  if (source.id.endsWith('.coindesk')) return 'CoinDesk';
  if (source.id.endsWith('.cointelegraph')) return 'Cointelegraph';
  return source.provider;
}

export function inspectCouncilNewsFeed(
  source: CouncilSourceDefinition,
  text: string,
  nowMs = Date.now(),
  asset = source.assets?.[0] ?? 'ETH',
): CouncilNewsFeedDiagnostics {
  const itemXml = [
    ...[...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, item]) => item),
    ...[...text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(([, item]) => item),
  ];
  let invalidDateCount = 0;
  let missingTimezoneCount = 0;
  const items = itemXml.map((item): CouncilNewsHeadline => {
    const title = readXmlTag(item, 'title');
    const description = readXmlTag(item, 'description') || readXmlTag(item, 'content:encoded') ||
      readXmlTag(item, 'summary');
    const categories = [...item.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
      .map(([, category]) => decodeXmlText(category));
    const publishedAt = readXmlTag(item, 'pubDate') || readXmlTag(item, 'published') ||
      readXmlTag(item, 'updated');
    const hasTimezone = explicitTimezone(publishedAt);
    if (publishedAt && !hasTimezone) missingTimezoneCount += 1;
    const parsedDate = hasTimezone ? Date.parse(publishedAt) : NaN;
    if (publishedAt && !Number.isFinite(parsedDate)) invalidDateCount += 1;
    const linkTag = item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1];
    const linkHref = item.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1];
    const publisher = readXmlTag(item, 'source') || sourcePublisher(source);
    return {
      title,
      description,
      categories,
      publishedAt,
      publishedAtMs: Number.isFinite(parsedDate) ? parsedDate : null,
      publisher,
      url: decodeXmlText(linkTag ?? linkHref ?? ''),
    };
  });
  const datedItems = items
    .filter((item) => item.publishedAtMs !== null && item.publishedAtMs <= nowMs)
    .sort((left, right) => (right.publishedAtMs ?? 0) - (left.publishedAtMs ?? 0));
  const related = datedItems.filter((item) =>
    isAssetNewsText(asset, `${item.title} ${item.description} ${item.categories.join(' ')}`)
  );
  const within = (hours: number): CouncilNewsHeadline[] =>
    related.filter((item) => nowMs - (item.publishedAtMs ?? 0) <= hours * 60 * 60_000);
  const recentRelatedItems = within(24);
  const latestFive = datedItems.slice(0, 5);
  const latestPublishedAtMs = datedItems[0]?.publishedAtMs ?? null;
  const valid = items.length > 0 && datedItems.length > 0;
  return {
    valid,
    detail: valid
      ? `${items.length} RSS items; latest ${latestPublishedAtMs === null ? 'unknown' : new Date(latestPublishedAtMs).toISOString()}; ${asset} keyword matches: ${within(6).length}/6h, ${recentRelatedItems.length}/24h, ${within(72).length}/72h; ${missingTimezoneCount} missing timezone, ${invalidDateCount} invalid date.`
      : 'RSS has no items with a parseable, timezone-qualified publication date.',
    totalItems: items.length,
    latestPublishedAtMs,
    relatedItems6h: within(6).length,
    relatedItems24h: recentRelatedItems.length,
    relatedItems72h: within(72).length,
    invalidDateCount,
    missingTimezoneCount,
    latestFive,
    recentRelatedItems,
  };
}

function pairedOptionIvMetrics(
  rows: readonly Record<string, unknown>[],
  instrumentField: 'instId' | 'symbol' | 'instrument_name',
  volatilityField: 'markVol' | 'markIV' | 'markIv' | 'mark_iv',
): {
  pairCount: number;
  callAverageIv: number | null;
  putAverageIv: number | null;
  putCallIvSpread: number | null;
} {
  const calls = new Map<string, number>();
  const puts = new Map<string, number>();
  for (const row of rows) {
    const instrument = typeof row[instrumentField] === 'string'
      ? row[instrumentField] as string
      : '';
    const match = instrument.match(/^(.*)-([CP])(?:-[A-Z]+)?$/);
    const rawVolatility = positiveNumber(row[volatilityField]);
    const volatility = rawVolatility === null
      ? null
      : volatilityField === 'mark_iv'
        ? rawVolatility / 100
        : rawVolatility;
    if (!match || volatility === null) continue;
    (match[2] === 'C' ? calls : puts).set(match[1], volatility);
  }
  const pairs = [...calls].flatMap(([instrument, callIv]) => {
    const putIv = puts.get(instrument);
    return putIv === undefined ? [] : [{ callIv, putIv }];
  });
  if (pairs.length === 0) {
    return { pairCount: 0, callAverageIv: null, putAverageIv: null, putCallIvSpread: null };
  }
  const callAverageIv = pairs.reduce((sum, pair) => sum + pair.callIv, 0) / pairs.length;
  const putAverageIv = pairs.reduce((sum, pair) => sum + pair.putIv, 0) / pairs.length;
  return {
    pairCount: pairs.length,
    callAverageIv,
    putAverageIv,
    putCallIvSpread: putAverageIv - callAverageIv,
  };
}

function parseFredSeries(
  text: string,
  endpoint: string,
  nowMs: number,
): DataValidation {
  const invalid = (detail: string): DataValidation => ({
    valid: false, detail, normalizedData: {}, ethPriceUsd: null, voteValue: 'USEFUL',
  });
  const rows = csvObservations(text);
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const series = new URL(endpoint).searchParams.get('id') ?? 'unknown';
  const maxAgeMs = series === 'WALCL' ? 14 * 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
  const bounds: Readonly<Record<string, readonly [number, number]>> = {
    DGS10: [0, 30],
    DTWEXBGS: [50, 200],
    SP500: [500, 20_000],
    VIXCLS: [0, 150],
    WALCL: [100_000, 20_000_000],
  };
  const [minimum, maximum] = bounds[series] ?? [0, Number.POSITIVE_INFINITY];
  if (!latest || !previous || latest.value <= minimum || latest.value >= maximum ||
      previous.value <= minimum || previous.value >= maximum ||
      nowMs - latest.dateMs < 0 || nowMs - latest.dateMs > maxAgeMs) {
    return invalid(`FRED ${series} has no two positive dated observations within its ${maxAgeMs / 86_400_000}-day freshness window.`);
  }
  const changePct = ((latest.value - previous.value) / previous.value) * 100;
  return {
    valid: true,
    detail: `FRED ${series}=${latest.value}; previous=${previous.value}; date=${new Date(latest.dateMs).toISOString().slice(0, 10)}.`,
    normalizedData: {
      [`fred_${series}`]: latest.value,
      [`fred_${series}_changePct`]: changePct,
      [`fred_${series}_timestampMs`]: latest.dateMs,
    },
    ethPriceUsd: null,
    voteValue: 'USEFUL',
  };
}

interface DataValidation {
  valid: boolean | null;
  detail: string;
  normalizedData: Readonly<Record<string, number | string | null>>;
  ethPriceUsd: number | null;
  voteValue: 'USEFUL' | 'LOW_VALUE' | 'UNKNOWN';
}

function validateData(
  source: CouncilSourceDefinition,
  endpoint: string,
  text: string,
  json: unknown,
  nowMs: number,
  receivedAtMs: number,
): DataValidation {
  const invalid = (detail: string): DataValidation => ({
    valid: false, detail, normalizedData: {}, ethPriceUsd: null, voteValue: 'USEFUL',
  });
  const valid = (
    detail: string,
    ethPriceUsd: number | null = null,
    normalizedData: Readonly<Record<string, number | string | null>> = {},
  ): DataValidation => ({
    valid: true, detail, normalizedData, ethPriceUsd, voteValue: 'USEFUL',
  });
  const lowValue = (
    detail: string,
    normalizedData: Readonly<Record<string, number | string | null>> = {},
  ): DataValidation => ({
    valid: true, detail, normalizedData, ethPriceUsd: null, voteValue: 'LOW_VALUE',
  });
  const stale = (timestamp: number | null, allowanceMs = source.maxAgeMs): boolean =>
    timestamp === null || timestamp > nowMs + 60_000 || nowMs - timestamp > allowanceMs;

  if (source.id.startsWith('council.member1.')) {
    let candle: { low: number; high: number; open: number; close: number; volume: number } | null = null;
    let timestamp: number | null = null;
    if (source.id.endsWith('coinbase-candles') && Array.isArray(json) && Array.isArray(json[0])) {
      const row = json.filter((entry): entry is unknown[] => Array.isArray(entry))
        .sort((a, b) => Number(b[0]) - Number(a[0]))[0];
      if (row) {
        candle = { low: Number(row[1]), high: Number(row[2]), open: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
        timestamp = timestampMs(row[0]);
      }
    } else if (source.id.endsWith('kraken-ohlc') && isRecord(json) && isRecord(json.result)) {
      const series = Object.entries(json.result).find(([key, value]) => key !== 'last' && Array.isArray(value));
      if (series && Array.isArray(series[1])) {
        const candles = series[1].filter((row): row is unknown[] => Array.isArray(row));
        const latest = candles.reduce<unknown[] | null>((selected, row) =>
          selected === null || Number(row[0]) > Number(selected[0]) ? row : selected
        , null);
        if (latest) {
          candle = { low: Number(latest[3]), high: Number(latest[2]), open: Number(latest[1]), close: Number(latest[4]), volume: Number(latest[6]) };
          timestamp = timestampMs(latest[0]);
        }
      }
    } else if (source.id.endsWith('okx-candles') && isRecord(json) && Array.isArray(json.data) && Array.isArray(json.data[0])) {
      const latest = [...json.data]
        .filter((row): row is unknown[] => Array.isArray(row))
        .sort((a, b) => Number(b[0]) - Number(a[0]))[0];
      if (latest) {
        candle = { low: Number(latest[3]), high: Number(latest[2]), open: Number(latest[1]), close: Number(latest[4]), volume: Number(latest[5]) };
        timestamp = timestampMs(latest[0]);
      }
    } else if (source.id.endsWith('bitstamp-ohlc') && isRecord(json) && isRecord(json.data) && Array.isArray(json.data.ohlc)) {
      const latest = [...json.data.ohlc].sort((a, b) =>
        Number(isRecord(b) ? b.timestamp : 0) - Number(isRecord(a) ? a.timestamp : 0)
      )[0];
      if (isRecord(latest)) {
        candle = {
          low: Number(latest.low), high: Number(latest.high), open: Number(latest.open),
          close: Number(latest.close), volume: Number(latest.volume),
        };
        timestamp = timestampMs(latest.timestamp);
      }
    }
    if (!candle) return invalid('Expected latest candle fields are missing.');
    const { low, high, open, close, volume } = candle;
    const price = positiveNumber(close);
    if (!positiveNumber(low) || !positiveNumber(high) || !positiveNumber(open) || !price ||
        high < low || open < low || open > high || close < low || close > high ||
        !Number.isFinite(volume) || volume < 0) {
      return invalid('OHLCV fields are missing or outside valid numeric bounds.');
    }
    if (stale(timestamp, source.maxAgeMs + 60 * 60_000)) return invalid('Latest hourly candle timestamp is stale or invalid.');
    return valid(
      `Latest hourly candle valid; close=${price}, volume=${volume}.`,
      source.assets?.includes('ETH') ? price : null,
      {
      open, high, low, close, volume, returnPct: ((close - open) / open) * 100,
      candleTimestampMs: timestamp,
      },
    );
  }

  if (source.id.startsWith('council.member2.')) {
    let trades: unknown[] = [];
    let readTrade: (trade: unknown) => {
      price: number | null;
      size: number | null;
      timestamp: number | null;
      aggressor: 'BUY' | 'SELL' | null;
    } = () => ({
      price: null, size: null, timestamp: null, aggressor: null,
    });
    if (source.id.endsWith('coinbase-trades') && Array.isArray(json)) {
      trades = json;
      readTrade = (trade) => isRecord(trade)
        ? {
          price: positiveNumber(trade.price),
          size: positiveNumber(trade.size),
          timestamp: timestampMs(Date.parse(String(trade.time))),
          aggressor: trade.side === 'buy' ? 'BUY' : trade.side === 'sell' ? 'SELL' : null,
        }
        : { price: null, size: null, timestamp: null, aggressor: null };
    } else if (source.id.endsWith('kraken-trades') && isRecord(json) && isRecord(json.result)) {
      const series = Object.values(json.result).find(Array.isArray);
      if (Array.isArray(series)) trades = series;
      readTrade = (trade) => Array.isArray(trade)
        ? {
          price: positiveNumber(trade[0]),
          size: positiveNumber(trade[1]),
          timestamp: timestampMs(trade[2]),
          aggressor: trade[3] === 'b' ? 'BUY' : trade[3] === 's' ? 'SELL' : null,
        }
        : { price: null, size: null, timestamp: null, aggressor: null };
    } else if (source.id.endsWith('okx-trades') && isRecord(json) && Array.isArray(json.data)) {
      trades = json.data;
      readTrade = (trade) => isRecord(trade)
        ? {
          price: positiveNumber(trade.px),
          size: positiveNumber(trade.sz),
          timestamp: timestampMs(trade.ts),
          aggressor: trade.side === 'buy' ? 'BUY' : trade.side === 'sell' ? 'SELL' : null,
        }
        : { price: null, size: null, timestamp: null, aggressor: null };
    } else if (source.id.endsWith('bitfinex-trades') && Array.isArray(json)) {
      trades = json;
      readTrade = (trade) => Array.isArray(trade)
        ? (() => {
          const amount = Number(trade[2]);
          return {
            price: positiveNumber(trade[3]),
            size: Number.isFinite(amount) ? positiveNumber(Math.abs(amount)) : null,
            timestamp: timestampMs(trade[1]),
            aggressor: amount > 0 ? 'BUY' : amount < 0 ? 'SELL' : null,
          };
        })()
        : { price: null, size: null, timestamp: null, aggressor: null };
    } else if (source.id.endsWith('bitstamp-transactions') && Array.isArray(json)) {
      trades = json;
      readTrade = (trade) => isRecord(trade)
        ? {
          price: positiveNumber(trade.price),
          size: positiveNumber(trade.amount),
          timestamp: timestampMs(trade.date),
          aggressor: null,
        }
        : { price: null, size: null, timestamp: null, aggressor: null };
    }
    const parsedTrades = trades.map(readTrade).filter(({ price, size }) => price !== null && size !== null)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    const fiveMinuteStartMs = nowMs - 5 * 60_000;
    const validTrades = trades.map(readTrade).filter(({ price, size, timestamp }) =>
      price !== null && size !== null && timestamp !== null &&
      timestamp >= fiveMinuteStartMs && timestamp <= nowMs && !stale(timestamp)
    );
    const latest = parsedTrades;
    if (!latest) return invalid('No trade has a positive price and size.');
    if (latest.timestamp === null || stale(latest.timestamp)) {
      return invalid(`Latest trade timestamp is missing or stale (age ${(nowMs - (latest.timestamp ?? 0)) / 1_000}s).`);
    }
    const classifiedTrades = validTrades.filter(({ aggressor }) => aggressor !== null);
    if (classifiedTrades.length < 5) {
      return invalid(
        `Insufficient 5-minute CVD data: ${classifiedTrades.length} aggressor-classified trades; minimum is 5.`,
      );
    }
    const buyVolumeBase = validTrades.reduce((sum, trade) =>
      trade.aggressor === 'BUY' ? sum + (trade.size ?? 0) : sum, 0);
    const sellVolumeBase = validTrades.reduce((sum, trade) =>
      trade.aggressor === 'SELL' ? sum + (trade.size ?? 0) : sum, 0);
    return valid(
      `Latest trade age=${((nowMs - latest.timestamp) / 1_000).toFixed(2)}s (limit ${source.maxAgeMs / 1_000}s); 5-minute CVD uses ${classifiedTrades.length} classified trades (minimum 5).`,
      null,
      {
      tradePrice: latest.price,
      tradeSizeEth: latest.size,
      tradeTimestampMs: latest.timestamp,
      buyVolumeBase,
      sellVolumeBase,
      cvdBase: buyVolumeBase - sellVolumeBase,
      buyVolumeEth: buyVolumeBase,
      sellVolumeEth: sellVolumeBase,
      cvdEth: buyVolumeBase - sellVolumeBase,
      classifiedTradeCount: classifiedTrades.length,
      cvdWindowMs: 5 * 60_000,
      minimumClassifiedTradeCount: 5,
      },
    );
  }

  if (source.id.startsWith('council.member3.')) {
    let bids: unknown[] = [];
    let asks: unknown[] = [];
    if (source.id.endsWith('coinbase-level2') && isRecord(json)) {
      bids = Array.isArray(json.bids) ? json.bids : [];
      asks = Array.isArray(json.asks) ? json.asks : [];
    } else if (source.id.endsWith('kraken-depth') && isRecord(json) && isRecord(json.result)) {
      const book = Object.values(json.result).find(isRecord);
      if (book) {
        bids = Array.isArray(book.bids) ? book.bids : [];
        asks = Array.isArray(book.asks) ? book.asks : [];
      }
    } else if (source.id.endsWith('okx-books') && isRecord(json) && Array.isArray(json.data) && isRecord(json.data[0])) {
      bids = Array.isArray(json.data[0].bids) ? json.data[0].bids : [];
      asks = Array.isArray(json.data[0].asks) ? json.data[0].asks : [];
    } else if (source.id.endsWith('bitstamp-order-book') && isRecord(json)) {
      bids = Array.isArray(json.bids) ? json.bids : [];
      asks = Array.isArray(json.asks) ? json.asks : [];
    }
    const bestBid = Array.isArray(bids[0]) ? positiveNumber(bids[0][0]) : null;
    const bestAsk = Array.isArray(asks[0]) ? positiveNumber(asks[0][0]) : null;
    const bidSize = Array.isArray(bids[0]) ? positiveNumber(bids[0][1]) : null;
    const askSize = Array.isArray(asks[0]) ? positiveNumber(asks[0][1]) : null;
    if (!bestBid || !bestAsk || !bidSize || !askSize || bestBid >= bestAsk) {
      return invalid('Order book is missing positive best bid/ask prices and sizes or has a crossed spread.');
    }
    return valid(`Best bid=${bestBid}; ask=${bestAsk}; received=${new Date(receivedAtMs).toISOString()}.`, null, {
      bestBid,
      bestAsk,
      bidSize,
      askSize,
      orderBookImbalance: (bidSize - askSize) / (bidSize + askSize),
      receivedAtMs,
    });
  }

  if (source.id.endsWith('.okx-derivatives')) {
    if (!isRecord(json) || json.code !== '0' || !Array.isArray(json.data) || !isRecord(json.data[0])) {
      return invalid('OKX funding-rate fields are missing.');
    }
    const funding = Number(json.data[0].fundingRate);
    const fundingTime = timestampMs(json.data[0].fundingTime);
    if (!Number.isFinite(funding) || Math.abs(funding) > 0.02 || fundingTime === null ||
        fundingTime > nowMs + 12 * 60 * 60_000 || nowMs - fundingTime > 12 * 60 * 60_000) {
      return invalid('Funding rate or funding interval is outside validated bounds.');
    }
    return valid(`Funding rate=${funding}; settlement/interval=${new Date(fundingTime).toISOString()}.`, null, {
      fundingRate: funding,
      fundingTimestampMs: fundingTime,
    });
  }
  if (source.id.endsWith('.deribit-perpetual')) {
    if (!isRecord(json) || !isRecord(json.result)) return invalid('Deribit ticker result is missing.');
    const price = positiveNumber(json.result.last_price);
    const funding = Number(json.result.current_funding ?? json.result.funding_8h);
    const timestamp = timestampMs(json.result.timestamp);
    if (!price || !Number.isFinite(funding) || Math.abs(funding) > 0.02 || stale(timestamp)) {
      return invalid(`Deribit ${source.symbol} price, funding or timestamp is outside validated bounds.`);
    }
    return valid(`Mark/last price=${price}; funding=${funding}; timestamp=${new Date(timestamp!).toISOString()}.`, null, {
      markPrice: positiveNumber(json.result.mark_price) ?? price,
      lastPrice: price,
      fundingRate: funding,
      openInterest: positiveNumber(json.result.open_interest),
      observedAtMs: timestamp,
    });
  }
  if (source.id.endsWith('.hyperliquid')) {
    if (!Array.isArray(json) || !isRecord(json[0]) || !Array.isArray(json[0].universe) ||
        !Array.isArray(json[1]) || !isRecord(json[1][0])) return invalid('Hyperliquid meta/context fields are missing.');
    const assetSymbol = source.symbol;
    const index = json[0].universe.findIndex((asset) => isRecord(asset) && asset.name === assetSymbol);
    const context = index >= 0 ? json[1][index] : null;
    if (!isRecord(context)) return invalid(`${assetSymbol} perpetual context is absent.`);
    const price = positiveNumber(context.markPx);
    const funding = Number(context.funding);
    const openInterest = positiveNumber(context.openInterest);
    if (!price || !Number.isFinite(funding) || Math.abs(funding) > 0.02 || !openInterest) {
      return invalid(`Hyperliquid ${assetSymbol} mark price, funding or open interest is outside validated bounds.`);
    }
    return valid(`${assetSymbol} mark=${price}; funding=${funding}; open interest=${openInterest}.`, null, {
      markPrice: price,
      fundingRate: funding,
      openInterest,
    });
  }
  if (source.id.endsWith('.binance-fapi')) {
    if (!isRecord(json)) return invalid('Binance open-interest response is malformed.');
    const openInterest = positiveNumber(json.openInterest);
    const timestamp = timestampMs(json.time);
    if (!openInterest || stale(timestamp)) return invalid('Binance open interest is missing or stale.');
    return valid(`${source.symbol} open interest=${openInterest}; timestamp=${new Date(timestamp!).toISOString()}.`, null, {
      openInterest,
      openInterestTimestampMs: timestamp,
    });
  }
  if (source.id.endsWith('.bybit-funding')) {
    const result = isRecord(json) && isRecord(json.result) ? json.result : null;
    const row = result && Array.isArray(result.list) && isRecord(result.list[0])
      ? result.list[0]
      : null;
    const funding = row ? Number(row.fundingRate) : Number.NaN;
    const timestamp = row ? timestampMs(row.fundingRateTimestamp) : null;
    if (!row || !Number.isFinite(funding) || Math.abs(funding) > 0.02 ||
        timestamp === null || timestamp > nowMs + 60_000 || nowMs - timestamp > 12 * 60 * 60_000) {
      return invalid('Bybit perpetual funding or timestamp is outside validated bounds.');
    }
    return valid(`Funding rate=${funding}; timestamp=${new Date(timestamp).toISOString()}.`, null, {
      fundingRate: funding,
      fundingTimestampMs: timestamp,
    });
  }
  if (source.id.startsWith('council.member5.')) {
    let instruments: unknown[] = [];
    if (source.id.endsWith('deribit-options') && isRecord(json) && Array.isArray(json.result)) {
      instruments = json.result;
    } else if (source.id.endsWith('okx-opt-summary') && isRecord(json) && Array.isArray(json.data)) {
      instruments = json.data;
    } else if (source.id.endsWith('bybit-options') && isRecord(json) && isRecord(json.result) && Array.isArray(json.result.list)) {
      instruments = json.result.list;
    } else if (source.id.endsWith('binance-eapi') && Array.isArray(json)) {
      const asset = source.assets?.[0] ?? 'ETH';
      instruments = json.filter((entry) =>
        isRecord(entry) && typeof entry.symbol === 'string' &&
        entry.symbol.startsWith(`${asset}-`)
      );
    }
    if (source.id.endsWith('binance-eapi')) {
      const asset = source.assets?.[0] ?? 'ETH';
      const assetInstruments = instruments.filter((entry): entry is Record<string, unknown> =>
        isRecord(entry) && positiveNumber(entry.markPrice) !== null &&
        positiveNumber(entry.markIV) !== null
      );
      const iv = pairedOptionIvMetrics(assetInstruments, 'symbol', 'markIV');
      if (assetInstruments.length === 0 || iv.pairCount === 0) {
        return invalid(`Binance mark response has no paired ${asset} call/put mark price and IV values.`);
      }
      return lowValue(
        `${assetInstruments.length} ${asset} mark rows; ${iv.pairCount} paired strikes; request-received timestamp ${new Date(receivedAtMs).toISOString()} (not provider time). Current IV skew=${iv.putCallIvSpread?.toFixed(6)}; IV parity is not directionally informative.`,
        {
          optionInstrumentCount: assetInstruments.length,
          callMarkIv: iv.callAverageIv,
          putMarkIv: iv.putAverageIv,
          putCallIvSpread: iv.putCallIvSpread,
          averageMarkPrice: assetInstruments.reduce((sum, entry) =>
            sum + (            positiveNumber(entry.markPrice) ?? 0), 0) / assetInstruments.length,
          receivedAtMs,
          timestampProvenance: 'response-received-not-provider',
        },
      );
    }
    const usable = instruments.filter((entry) => isRecord(entry) &&
      Object.values(entry).some((value) => positiveNumber(value) !== null));
    const asset = source.assets?.[0] ?? 'ETH';
    if (!usable.length) return invalid(`No ${asset} option instrument contains a positive market field.`);
    const optionRows = usable.filter(isRecord);
    const optionTimestamp = source.id.endsWith('deribit-options')
      ? isRecord(json) && positiveNumber(json.usOut) !== null
        ? Number(json.usOut) / 1_000
        : null
      : source.id.endsWith('bybit-options')
        ? timestampMs(isRecord(json) ? json.time : null)
        : null;
    if ((source.id.endsWith('deribit-options') || source.id.endsWith('bybit-options')) &&
        (optionTimestamp === null || stale(optionTimestamp))) {
      return invalid('Options response has no fresh provider timestamp.');
    }
    const callInterest = optionRows.reduce((sum, entry) =>
      /-C(?:-|$)|CALL/i.test(String(entry.instrument_name ?? entry.instId ?? entry.symbol ?? ''))
        ? sum + (positiveNumber(entry.open_interest ?? entry.oi ?? entry.openInterest) ?? 0)
        : sum, 0);
    const putInterest = optionRows.reduce((sum, entry) =>
      /-P(?:-|$)|PUT/i.test(String(entry.instrument_name ?? entry.instId ?? entry.symbol ?? ''))
        ? sum + (positiveNumber(entry.open_interest ?? entry.oi ?? entry.openInterest) ?? 0)
        : sum, 0);
    const impliedVolatilities = optionRows.map((entry) =>
      positiveNumber(entry.mark_iv ?? entry.markVol ?? entry.markIV ?? entry.iv)
    ).filter((value): value is number => value !== null);
    const isOkx = source.id.endsWith('okx-opt-summary');
    const isBybit = source.id.endsWith('bybit-options');
    const isDeribit = source.id.endsWith('deribit-options');
    const ivMetrics = isOkx
      ? pairedOptionIvMetrics(optionRows, 'instId', 'markVol')
      : isBybit
        ? pairedOptionIvMetrics(optionRows, 'symbol', 'markIv')
        : isDeribit
          ? pairedOptionIvMetrics(optionRows, 'instrument_name', 'mark_iv')
      : { pairCount: 0, callAverageIv: null, putAverageIv: null, putCallIvSpread: null };
    const sourceTimestamp = isOkx
      ? optionRows.reduce<number | null>((latest, entry) => {
        const rowTimestamp = timestampMs(entry.ts);
        return rowTimestamp === null ? latest : Math.max(latest ?? 0, rowTimestamp);
      }, null)
      : optionTimestamp;
    if ((isOkx || isBybit || isDeribit) &&
        (sourceTimestamp === null || stale(sourceTimestamp))) {
      return invalid(`${source.provider} option summary has no fresh provider timestamp.`);
    }
    const callPutRatio = callInterest > 0 ? putInterest / callInterest : null;
    const directionalIvSkew = ivMetrics.putCallIvSpread !== null &&
      Math.abs(ivMetrics.putCallIvSpread) >= 0.02;
    const hasDirectionalOpenInterest = callPutRatio !== null && (callInterest > 0 || putInterest > 0);
    const metrics = {
      optionInstrumentCount: usable.length,
      callOpenInterest: callInterest,
      putOpenInterest: putInterest,
      putCallOpenInterestRatio: callPutRatio,
      averageImpliedVolatility: impliedVolatilities.length
        ? impliedVolatilities.reduce((sum, value) => sum + value, 0) / impliedVolatilities.length
        : null,
      callMarkIv: ivMetrics.callAverageIv,
      putMarkIv: ivMetrics.putAverageIv,
      putCallIvSpread: ivMetrics.putCallIvSpread,
      pairedIvInstrumentCount: ivMetrics.pairCount,
      ...(sourceTimestamp === null ? {} : { optionTimestampMs: sourceTimestamp }),
    };
    const detail = `${usable.length} ${source.provider} ${asset} option rows; ${ivMetrics.pairCount} matched call/put strikes; provider timestamp=${new Date(sourceTimestamp!).toISOString()}; put-call IV spread=${ivMetrics.putCallIvSpread?.toFixed(6)}.`;
    if (hasDirectionalOpenInterest || directionalIvSkew) return valid(detail, null, metrics);
    return lowValue(
      `${detail} No directional OI skew; IV levels are context-only unless put-call IV spread reaches 0.02 (2 volatility points).`,
      metrics,
    );
  }

  if (source.id === 'council.member6.defillama-dex-volume') {
    const observations = isRecord(json) && Array.isArray(json.totalDataChart)
      ? json.totalDataChart.flatMap((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) return [];
        const observedAtMs = timestampMs(entry[0]);
        const volumeUsd = positiveNumber(entry[1]);
        return observedAtMs !== null && volumeUsd !== null
          ? [{ observedAtMs, volumeUsd }]
          : [];
      }).sort((left, right) => left.observedAtMs - right.observedAtMs)
      : [];
    const latest = observations.at(-1);
    const previous = observations.at(-2);
    const baseline = latest
      ? [...observations].reverse().find(({ observedAtMs }) =>
        observedAtMs <= latest.observedAtMs - 7 * 24 * 60 * 60_000
      )
      : undefined;
    if (!latest || !previous || !baseline ||
        stale(latest.observedAtMs, source.maxAgeMs) ||
        latest.observedAtMs - baseline.observedAtMs > 8 * 24 * 60 * 60_000) {
      return invalid('DefiLlama Ethereum DEX volume requires a fresh daily value and dated one/seven-day comparison points.');
    }
    const change1dPct = ((latest.volumeUsd - previous.volumeUsd) / previous.volumeUsd) * 100;
    const change7dPct = ((latest.volumeUsd - baseline.volumeUsd) / baseline.volumeUsd) * 100;
    return lowValue(
      `Ethereum DEX volume=${latest.volumeUsd.toFixed(2)} USD; one-day change=${change1dPct.toFixed(4)}%; seven-day change=${change7dPct.toFixed(4)}%. Daily activity context from DefiLlama, not a standalone price-direction signal.`,
      {
        ethereumDexVolume24hUsd: latest.volumeUsd,
        ethereumDexVolumeChange1dPct: change1dPct,
        ethereumDexVolumeChange7dPct: change7dPct,
        observationTimestampMs: latest.observedAtMs,
        baselineTimestampMs: baseline.observedAtMs,
      },
    );
  }
  if (source.id === 'council.member6.fee-history') {
    const rows = Array.isArray(json) ? json.filter(isRecord) : [];
    const block = rows.find((row) => row.id === 1)?.result;
    const history = rows.find((row) => row.id === 2)?.result;
    const observedAt = isRecord(block) ? timestampMs(block.timestamp) : null;
    const ratios = isRecord(history) && Array.isArray(history.gasUsedRatio)
      ? history.gasUsedRatio.map(Number)
      : [];
    const fees = isRecord(history) && Array.isArray(history.baseFeePerGas)
      ? history.baseFeePerGas.flatMap((fee) => {
        if (typeof fee !== 'string' || !/^0x[0-9a-f]+$/i.test(fee)) return [];
        return [Number(BigInt(fee)) / 1e9];
      })
      : [];
    if (observedAt === null || stale(observedAt, source.maxAgeMs) ||
        ratios.length < 2 || ratios.some((ratio) => !Number.isFinite(ratio) || ratio < 0 || ratio > 1.05) ||
        fees.length < 2 || fees.some((fee) => !Number.isFinite(fee) || fee <= 0 || fee > 1_000_000)) {
      return invalid('PublicNode feeHistory is missing plausible gas-use/base-fee values or a fresh latest-block timestamp.');
    }
    const meanGasUsedRatio = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
    const latestBaseFeeGwei = fees.at(-1)!;
    return lowValue(
      `Recent feeHistory: mean gas-used ratio=${meanGasUsedRatio.toFixed(4)}, latest base fee=${latestBaseFeeGwei.toFixed(4)} gwei; network-activity context, not a standalone ETH price signal.`,
      {
        meanGasUsedRatio,
        latestBaseFeeGwei,
        baseFeeChangePct: ((fees.at(-1)! - fees[0]) / fees[0]) * 100,
        observationTimestampMs: observedAt,
      },
    );
  }
  if (source.id === 'council.member6.blockscout') {
    if (!isRecord(json) || !positiveNumber(json.total_blocks)) return invalid('Blockscout total_blocks is missing or non-positive.');
    return lowValue(`Chain statistics only (total_blocks=${json.total_blocks}); no recent transaction/flow data.`, {
      totalBlocks: Number(json.total_blocks),
    });
  }
  if (source.id === 'council.member6.defillama') {
    const chart = Array.isArray(json) ? json : [];
    const latest = chart.map((entry) => isRecord(entry) ? entry : null)
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .sort((a, b) => Number(b.date) - Number(a.date))[0];
    const amount = latest && isRecord(latest.totalCirculating)
      ? positiveNumber(latest.totalCirculating.peggedUSD)
      : null;
    const timestamp = latest ? timestampMs(latest.date) : null;
    const target = timestamp === null ? null : timestamp - 7 * 24 * 60 * 60_000;
    const baseline = target === null ? null : chart
      .filter((entry) => isRecord(entry) && Number(entry.date) * 1_000 <= target)
      .reduce<Record<string, unknown> | null>((selected, entry) =>
        selected === null || Number(entry.date) > Number(selected.date) ? entry : selected
      , null);
    const baselineAmount = baseline && isRecord(baseline.totalCirculating)
      ? positiveNumber(baseline.totalCirculating.peggedUSD)
      : null;
    const baselineTimestamp = baseline ? timestampMs(baseline.date) : null;
    if (!amount || !baselineAmount || timestamp === null ||
        stale(timestamp, 48 * 60 * 60_000) || baselineTimestamp === null ||
        timestamp - baselineTimestamp > 8 * 24 * 60 * 60_000) {
      return invalid('DefiLlama stablecoin supply needs fresh latest and approximately seven-day baseline observations.');
    }
    return valid(
      `Ethereum stablecoin circulating supply changed ${(((amount - baselineAmount) / baselineAmount) * 100).toFixed(4)}% over seven days; heuristic non-conclusive.`,
      null,
      {
        stablecoinCirculatingUsd: amount,
        stablecoinSupplyChange7dUsd: amount - baselineAmount,
        stablecoinSupplyChange7dPct: ((amount - baselineAmount) / baselineAmount) * 100,
        observationTimestampMs: timestamp,
        baselineTimestampMs: baselineTimestamp,
      },
    );
  }
  if (source.id === 'council.member6.beacon-api') {
    if (!isRecord(json) || !isRecord(json.data) || typeof json.data.version !== 'string' || !json.data.version) {
      return invalid('Beacon API node version is missing.');
    }
    return lowValue(`Beacon node version only (${json.data.version}); no finalized slot/head evidence.`, {
      beaconNodeVersion: json.data.version,
    });
  }
  if (source.id.startsWith('council.member7.fred')) {
    return parseFredSeries(text, endpoint, nowMs);
  }
  if (source.id === 'council.member7.stooq') {
    const lines = text.trim().split(/\r?\n/);
    const fields = lines.at(-1)?.split(',') ?? [];
    const close = positiveNumber(fields[4]);
    const timestamp = Date.parse(`${fields[0]}T${fields[1]}Z`);
    if (!close || !Number.isFinite(timestamp) || stale(timestamp, 14 * 24 * 60 * 60_000)) return invalid('Stooq quote is missing a positive close or fresh date.');
    return valid(`USD index close=${close}; date=${fields[0]}.`, null, {
      usdIndexClose: close,
      observationTimestampMs: timestamp,
    });
  }
  if (source.id === 'council.member7.cboe-vix') {
    const rows = text.trim().split(/\r?\n/).slice(1).flatMap((row) => {
      const [date, , , , rawClose] = row.split(',');
      const timestamp = Date.parse(date);
      const close = positiveNumber(rawClose);
      return Number.isFinite(timestamp) && close ? [{ timestamp, close }] : [];
    });
    const latest = rows.at(-1);
    const previous = rows.at(-2);
    if (!latest || !previous || latest.close >= 200 || stale(latest.timestamp, source.maxAgeMs)) {
      return invalid('Cboe VIX has no two positive dated daily closes within the registered freshness window.');
    }
    const changePct = ((latest.close - previous.close) / previous.close) * 100;
    return valid(`Cboe VIX close=${latest.close}; daily change=${changePct.toFixed(4)}%; date=${new Date(latest.timestamp).toISOString().slice(0, 10)}.`, null, {
      vixClose: latest.close,
      vixChangePct: changePct,
      observationTimestampMs: latest.timestamp,
      macroDirectionValue: changePct === 0 ? 0 : changePct > 0 ? -1 : 1,
    });
  }
  if (source.id === 'council.member7.yahoo-chart') {
    const result = isRecord(json) && isRecord(json.chart) && Array.isArray(json.chart.result)
      ? json.chart.result[0]
      : null;
    const chart = isRecord(result) ? result : null;
    const timestamps = chart && Array.isArray(chart.timestamp) ? chart.timestamp.map(Number) : [];
    const quote = chart && isRecord(chart.indicators) && Array.isArray(chart.indicators.quote)
      ? chart.indicators.quote[0]
      : null;
    const closes = isRecord(quote) && Array.isArray(quote.close)
      ? quote.close.map((value) => value === null ? NaN : Number(value))
      : [];
    const validRows = timestamps.flatMap((timestamp, index) =>
      Number.isFinite(timestamp) && Number.isFinite(closes[index]) && closes[index] > 0
        ? [{ timestamp: timestamp * 1_000, close: closes[index] }]
        : []);
    const latest = validRows.at(-1);
    const previous = validRows.at(-2);
    if (!latest || !previous || stale(latest.timestamp, source.maxAgeMs)) {
      return invalid('Yahoo chart has no two positive dated daily closes within the registered freshness window.');
    }
    const ticker = decodeURIComponent(new URL(endpoint).pathname.split('/').at(-1) ?? '');
    const changePct = ((latest.close - previous.close) / previous.close) * 100;
    const validPriceRange = ticker === '^GSPC'
      ? latest.close >= 500 && latest.close <= 20_000
      : latest.close >= 50 && latest.close <= 200;
    if (!validPriceRange) return invalid(`Yahoo ${ticker} close is outside the validated index range.`);
    const field = ticker === '^GSPC' ? 'sp500ChangePct' : 'dxyChangePct';
    const direction = changePct === 0 ? 0
      : ticker === '^GSPC' ? Math.sign(changePct) : -Math.sign(changePct);
    return valid(`Yahoo ${ticker}=${latest.close}; daily change=${changePct.toFixed(4)}%; date=${new Date(latest.timestamp).toISOString().slice(0, 10)} (unofficial API).`, null, {
      [ticker === '^GSPC' ? 'sp500Index' : 'dxyIndex']: latest.close,
      [field]: changePct,
      observationTimestampMs: latest.timestamp,
      macroDirectionValue: direction,
    });
  }
  if (isCouncilNewsFeedSource(source)) {
    const asset = source.assets?.[0] ?? 'ETH';
    const diagnostics = inspectCouncilNewsFeed(source, text, nowMs, asset);
    if (!diagnostics.valid) return invalid(diagnostics.detail);
    return valid(diagnostics.detail, null, {
      rssTotalItems: diagnostics.totalItems,
      rssLatestPublishedAtMs: diagnostics.latestPublishedAtMs,
      assetRelevantItemCount6h: diagnostics.relatedItems6h,
      assetRelevantItemCount24h: diagnostics.relatedItems24h,
      assetRelevantItemCount72h: diagnostics.relatedItems72h,
      rssInvalidDateCount: diagnostics.invalidDateCount,
      rssMissingTimezoneCount: diagnostics.missingTimezoneCount,
      rssLatestFiveJson: JSON.stringify(diagnostics.latestFive),
      rssAssetItemsJson: JSON.stringify(diagnostics.recentRelatedItems),
      ...(asset === 'ETH'
        ? {
            ethRelevantItemCount6h: diagnostics.relatedItems6h,
            ethRelevantItemCount24h: diagnostics.relatedItems24h,
            ethRelevantItemCount72h: diagnostics.relatedItems72h,
            freshEthItemCount: diagnostics.relatedItems24h,
            rssEthItemsJson: JSON.stringify(diagnostics.recentRelatedItems),
          }
        : {}),
    });
  }
  if (source.id === 'council.member8.alternative-fng') {
    const entry = isRecord(json) && Array.isArray(json.data) && isRecord(json.data[0]) ? json.data[0] : null;
    const value = entry ? Number(entry.value) : NaN;
    const timestamp = entry ? timestampMs(entry.timestamp) : null;
    if (!Number.isFinite(value) || value < 0 || value > 100 || stale(timestamp, 24 * 60 * 60_000)) {
      return invalid('Fear & Greed value must be 0..100 with a fresh timestamp.');
    }
    return valid(`Fear & Greed=${value}; timestamp=${new Date(timestamp!).toISOString()}.`, null, {
      fearGreedIndex: value,
      observationTimestampMs: timestamp,
    });
  }

  return json === null && !/<rss\b|<rdf:RDF\b/i.test(text)
    ? invalid('No parseable payload for source-specific data validation.')
    : { valid: null, detail: 'No source-specific data validator is defined.', normalizedData: {}, ethPriceUsd: null, voteValue: 'UNKNOWN' };
}

function validateSupplemental(
  source: CouncilSourceDefinition,
  endpoint: string,
  text: string,
  json: unknown,
  nowMs: number,
): DataValidation {
  const invalid = (detail: string): DataValidation => ({
    valid: false, detail, normalizedData: {}, ethPriceUsd: null, voteValue: 'USEFUL',
  });
  const valid = (detail: string): DataValidation => ({
    valid: true, detail, normalizedData: {}, ethPriceUsd: null, voteValue: 'USEFUL',
  });
  if (source.id.startsWith('council.member7.fred') ||
      source.id === 'council.member7.yahoo-chart') {
    return validateData(source, endpoint, text, json, nowMs, nowMs);
  }
  if (source.id.endsWith('.okx-derivatives')) {
    const payload = isRecord(json) ? json : null;
    const row = payload && Array.isArray(payload.data) && isRecord(payload.data[0]) ? payload.data[0] : null;
    const oi = row ? positiveNumber(row.oi) : null;
    const oiCcy = row ? positiveNumber(row.oiCcy) : null;
    if (!row || payload?.code !== '0' || (!oi && !oiCcy)) return invalid('OKX open-interest value is missing or non-positive.');
    return {
      ...valid(`Open interest=${oi ?? oiCcy}.`),
      normalizedData: { openInterest: oi ?? oiCcy },
    };
  }
  if (source.id.endsWith('.binance-fapi')) {
    if (!isRecord(json)) return invalid('Binance premium-index response is malformed.');
    const price = positiveNumber(json.markPrice);
    const funding = Number(json.lastFundingRate);
    const time = timestampMs(json.time);
    if (!price || !Number.isFinite(funding) || Math.abs(funding) > 0.02 ||
        time === null || time > nowMs + 60_000 || nowMs - time > source.maxAgeMs) {
      return invalid('Binance mark price, funding or response timestamp is outside validated bounds.');
    }
    return {
      ...valid(`Mark price=${price}; funding=${funding}; timestamp=${new Date(time).toISOString()}.`),
      normalizedData: {
        markPrice: price,
        fundingRate: funding,
        observedAtMs: time,
      },
    };
  }
  if (source.id.endsWith('.bybit-funding')) {
    const result = isRecord(json) && isRecord(json.result) ? json.result : null;
    const row = result && Array.isArray(result.list) && isRecord(result.list[0])
      ? result.list[0]
      : null;
    const openInterest = row ? positiveNumber(row.openInterest) : null;
    if (!row || !openInterest) return invalid('Bybit open-interest value is missing or non-positive.');
    return {
      ...valid(`Open interest=${openInterest}.`),
      normalizedData: { openInterest },
    };
  }
  if (source.id.endsWith('.deribit-options')) {
    const result = isRecord(json) && isRecord(json.result) ? json.result : null;
    const rows = result && Array.isArray(result.data) ? result.data : [];
    const validRows = rows.filter((entry) => Array.isArray(entry) && entry.length >= 5 &&
      entry.slice(1, 5).every((value) => Number.isFinite(Number(value)) && Number(value) >= 0));
    if (!validRows.length) return invalid('Deribit DVOL history has no numeric observation rows.');
    const latest = validRows.reduce<unknown[]>((selected, row) =>
      Number(row[0]) > Number(selected[0]) ? row : selected
    , validRows[0] as unknown[]);
    const time = timestampMs(latest[0]);
    if (time === null || time > nowMs + 60_000 || nowMs - time > 2 * 60 * 60_000) {
      return invalid('Latest Deribit DVOL observation is stale or future-dated.');
    }
    return {
      ...valid(`Latest DVOL close=${latest[4]}; timestamp=${new Date(time).toISOString()}.`),
      normalizedData: {
        dvol: Number(latest[4]),
        dvolTimestampMs: time,
      },
    };
  }
  return { valid: null, detail: `No supplemental data validator is defined for ${endpoint}.`, normalizedData: {}, ethPriceUsd: null, voteValue: 'UNKNOWN' };
}

function supplementalUrls(source: CouncilSourceDefinition, nowMs: number): string[] {
  if (source.id.startsWith('council.member7.fred')) {
    return [...(source.additionalHealthUrls ?? [])];
  }
  switch (source.id) {
    case 'council.member7.yahoo-chart':
      return [...(source.additionalHealthUrls ?? [])];
    case 'council.member4.okx-derivatives':
      return [...(source.additionalHealthUrls ?? [])];
    case 'council.member4.binance-fapi':
      return [...(source.additionalHealthUrls ?? [])];
    case 'council.member5.deribit-options':
      return [
        `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=ETH&start_timestamp=${nowMs - 3_600_000}&end_timestamp=${nowMs}&resolution=3600`,
      ];
    default:
      return source.id.endsWith('.okx-derivatives') ||
        source.id.endsWith('.binance-fapi') ||
        source.id.endsWith('.bybit-funding')
        ? [...(source.additionalHealthUrls ?? [])]
        : source.id.endsWith('.deribit-options')
          ? [`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${source.assets?.[0] ?? 'ETH'}&start_timestamp=${nowMs - 3_600_000}&end_timestamp=${nowMs}&resolution=3600`]
        : [];
  }
}

async function paceHost(hostname: string): Promise<void> {
  const previous = hostQueues.get(hostname) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  hostQueues.set(hostname, previous.then(() => current));
  await previous;
  const waitMs = Math.max(
    0,
    MIN_HOST_INTERVAL_MS - (Date.now() - (lastRequestByHost.get(hostname) ?? 0)),
  );
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestByHost.set(hostname, Date.now());
  release();
}

function decodeStakingDepositAmountEth(data: unknown): number | null {
  if (typeof data !== 'string' || !/^0x[0-9a-f]+$/i.test(data)) return null;
  const encoded = data.slice(2);
  if (encoded.length !== 576 * 2) return null;
  const amountOffset = Number(BigInt(`0x${encoded.slice(128, 192)}`));
  if (!Number.isSafeInteger(amountOffset) || amountOffset % 32 !== 0 ||
      amountOffset < 160 || amountOffset + 64 > 576) return null;
  const lengthStart = amountOffset * 2;
  const amountLength = Number(BigInt(`0x${encoded.slice(lengthStart, lengthStart + 64)}`));
  if (amountLength !== 8 || lengthStart + 64 + amountLength * 2 > encoded.length) return null;
  const amountBytes = encoded.slice(lengthStart + 64, lengthStart + 64 + amountLength * 2);
  let amountGwei = 0n;
  for (let index = 0; index < amountBytes.length; index += 2) {
    amountGwei |= BigInt(`0x${amountBytes.slice(index, index + 2)}`) << BigInt(index * 4);
  }
  const amountEth = Number(amountGwei) / 1e9;
  return Number.isFinite(amountEth) && amountEth > 0 ? amountEth : null;
}

async function requestStakingDeposits24h(
  source: CouncilSourceDefinition,
  endpoint: string,
  fetcher: typeof fetch,
): Promise<HealthResult> {
  const url = new URL(endpoint);
  const send = async (body: unknown): Promise<{
    response: Response;
    payload: unknown;
  }> => {
    await paceHost(url.hostname);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
      return { response, payload };
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    const latestResponse = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBlockByNumber',
      params: ['latest', false],
    });
    if (latestResponse.response.status === 403 || latestResponse.response.status === 451) {
      return { status: 'REGION_RESTRICTED', detail: `HTTP ${latestResponse.response.status} (regional/access restriction).`, httpHealthy: false };
    }
    if (latestResponse.response.status === 429) {
      return { status: 'BROKEN', detail: 'PublicNode HTTP 429 (rate limited) while reading the latest block.', httpHealthy: false };
    }
    if (!latestResponse.response.ok) {
      return { status: 'BROKEN', detail: `PublicNode latest-block HTTP ${latestResponse.response.status}.`, httpHealthy: false };
    }
    const latestPayload = isRecord(latestResponse.payload) ? latestResponse.payload : null;
    const latestBlock = latestPayload && isRecord(latestPayload.result) ? latestPayload.result : null;
    if (!latestBlock || typeof latestBlock.number !== 'string' ||
        !/^0x[0-9a-f]+$/i.test(latestBlock.number) ||
        typeof latestBlock.timestamp !== 'string' ||
        !/^0x[0-9a-f]+$/i.test(latestBlock.timestamp)) {
      return { status: 'BROKEN', detail: 'PublicNode returned no valid latest block number/timestamp.', httpHealthy: true, dataValid: false };
    }
    const latestBlockNumber = BigInt(latestBlock.number);
    if (latestBlockNumber < 7_212n) {
      return { status: 'BROKEN', detail: 'PublicNode latest block is too low to inspect the confirmed 24-hour interval.', httpHealthy: true, dataValid: false };
    }
    const fromBlockNumber = latestBlockNumber - 7_200n;
    const toBlockNumber = latestBlockNumber - 12n;
    const fromBlockTag = `0x${fromBlockNumber.toString(16)}`;
    const toBlockTag = `0x${toBlockNumber.toString(16)}`;
    const intervalResponse = await send([
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_getBlockByNumber',
        params: [fromBlockTag, false],
      },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'eth_getBlockByNumber',
        params: [toBlockTag, false],
      },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'eth_getLogs',
        params: [{
          address: ETH_STAKING_DEPOSIT_CONTRACT,
          topics: [ETH_STAKING_DEPOSIT_EVENT_TOPIC],
          fromBlock: fromBlockTag,
          toBlock: toBlockTag,
        }],
      },
    ]);
    if (intervalResponse.response.status === 403 || intervalResponse.response.status === 451) {
      return { status: 'REGION_RESTRICTED', detail: `HTTP ${intervalResponse.response.status} (regional/access restriction).`, httpHealthy: false };
    }
    if (intervalResponse.response.status === 429) {
      return { status: 'BROKEN', detail: 'PublicNode HTTP 429 (rate limited) while reading confirmed deposit logs.', httpHealthy: false };
    }
    if (!intervalResponse.response.ok) {
      return { status: 'BROKEN', detail: `PublicNode confirmed deposit-log HTTP ${intervalResponse.response.status}.`, httpHealthy: false };
    }
    const rows = Array.isArray(intervalResponse.payload)
      ? intervalResponse.payload.filter(isRecord)
      : [];
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const rpcError = [2, 3, 4]
      .map((id) => rowById.get(id)?.error)
      .find(isRecord);
    if (rpcError) {
      const message = typeof rpcError.message === 'string' ? rpcError.message : 'RPC method error.';
      return {
        status: 'BROKEN',
        detail: `PublicNode confirmed staking-deposit logs unavailable: ${message}`,
        httpHealthy: true,
        dataValid: false,
        dataDetail: message,
      };
    }
    const startBlock = rowById.get(2)?.result;
    const endBlock = rowById.get(3)?.result;
    const rawLogs = rowById.get(4)?.result;
    const startTimestamp = isRecord(startBlock) && typeof startBlock.timestamp === 'string' &&
      /^0x[0-9a-f]+$/i.test(startBlock.timestamp)
      ? timestampMs(Number(BigInt(startBlock.timestamp)))
      : null;
    const endTimestamp = isRecord(endBlock) && typeof endBlock.timestamp === 'string' &&
      /^0x[0-9a-f]+$/i.test(endBlock.timestamp)
      ? timestampMs(Number(BigInt(endBlock.timestamp)))
      : null;
    const latestTimestamp = timestampMs(Number(BigInt(latestBlock.timestamp)));
    if (!Array.isArray(rawLogs) || startTimestamp === null ||
        endTimestamp === null || latestTimestamp === null) {
      return { status: 'BROKEN', detail: 'PublicNode returned malformed confirmed deposit logs or block timestamps.', httpHealthy: true, dataValid: false };
    }
    const intervalHours = (endTimestamp - startTimestamp) / 3_600_000;
    if (intervalHours < 23 || intervalHours > 25) {
      return {
        status: 'BROKEN',
        detail: `PublicNode confirmed deposit-log interval is ${intervalHours.toFixed(2)} hours; a 24-hour observation must be within 23–25 hours.`,
        httpHealthy: true,
        dataValid: false,
      };
    }
    const depositsEth: number[] = [];
    for (const log of rawLogs) {
      if (!isRecord(log) || typeof log.address !== 'string' ||
          log.address.toLowerCase() !== ETH_STAKING_DEPOSIT_CONTRACT.toLowerCase() ||
          !Array.isArray(log.topics) || log.topics[0] !== ETH_STAKING_DEPOSIT_EVENT_TOPIC ||
          typeof log.blockNumber !== 'string' || !/^0x[0-9a-f]+$/i.test(log.blockNumber)) {
        return { status: 'BROKEN', detail: 'PublicNode returned an unexpected staking DepositEvent log.', httpHealthy: true, dataValid: false };
      }
      const blockNumber = BigInt(log.blockNumber);
      if (blockNumber < fromBlockNumber || blockNumber > toBlockNumber) {
        return { status: 'BROKEN', detail: 'PublicNode returned a staking DepositEvent outside the requested confirmed block interval.', httpHealthy: true, dataValid: false };
      }
      const amountEth = decodeStakingDepositAmountEth(log.data);
      if (amountEth === null) {
        return { status: 'BROKEN', detail: 'PublicNode returned a DepositEvent with malformed amount encoding.', httpHealthy: true, dataValid: false };
      }
      depositsEth.push(amountEth);
    }
    const deposits24hEth = depositsEth.reduce((sum, amount) => sum + amount, 0);
    if (!Number.isFinite(deposits24hEth) || deposits24hEth > 500_000_000) {
      return { status: 'BROKEN', detail: 'PublicNode staking deposit volume is outside plausible numeric bounds.', httpHealthy: true, dataValid: false };
    }
    return {
      status: 'HEALTHY',
      detail: `Confirmed staking deposit events=${depositsEth.length}; total inflow=${deposits24hEth.toFixed(4)} ETH over ${intervalHours.toFixed(2)}h.`,
      httpHealthy: true,
      dataValid: true,
      dataDetail: `Decoded ${depositsEth.length} official DepositEvent amount fields; gross inflow=${deposits24hEth.toFixed(4)} ETH over ${intervalHours.toFixed(2)}h. No archive-state access or API key required.`,
      observedAtMs: endTimestamp,
      normalizedData: {
        stakingDeposits24hEth: deposits24hEth,
        stakingDepositEventCount: depositsEth.length,
        stakingDepositIntervalHours: intervalHours,
        observationTimestampMs: endTimestamp,
        startBlockTimestampMs: startTimestamp,
        confirmedEndBlockTimestampMs: endTimestamp,
        latestBlockTimestampMs: latestTimestamp,
      },
      voteValue: 'USEFUL',
    };
  } catch (error) {
    return {
      status: 'BROKEN',
      detail: `PublicNode confirmed staking-deposit log check failed: ${error instanceof Error ? error.message : String(error)}`,
      httpHealthy: false,
      dataValid: false,
    };
  }
}

function validateResponse(
  source: CouncilSourceDefinition,
  text: string,
  json: unknown,
): HealthResult {
  if (source.id.includes('rss') || source.id.includes('foundation') ||
      source.id.includes('coindesk') || source.id.includes('cointelegraph') ||
      source.id.includes('decrypt') || source.id.includes('the-block') ||
      source.id.includes('google-news')) {
    return /<rss\b|<rdf:RDF\b/i.test(text)
      ? { status: 'HEALTHY', detail: 'RSS/XML feed returned.' }
      : { status: 'BROKEN', detail: 'Response did not contain an RSS document.' };
  }
  if (source.id.startsWith('council.member7.fred')) {
    return /^observation_date,[A-Z0-9]+(?:\r?\n|$)/.test(text)
      ? { status: 'HEALTHY', detail: 'FRED public CSV returned.' }
      : { status: 'BROKEN', detail: 'FRED response is not a dated series CSV.' };
  }
  if (source.id === 'council.member7.cboe-vix') {
    return /^Cboe\r?\nDate,Open,High,Low,Close(?:,Volume)?/i.test(text) ||
      /^Date,Open,High,Low,Close(?:,Volume)?/i.test(text)
      ? { status: 'HEALTHY', detail: 'Cboe VIX daily CSV returned.' }
      : { status: 'BROKEN', detail: 'Cboe response is not the expected VIX OHLC CSV.' };
  }
  if (source.id === 'council.member7.stooq') {
    return text.startsWith('Date,Open,High,Low,Close,Volume') ||
      /^\d{4}-\d{2}-\d{2},/.test(text)
      ? { status: 'HEALTHY', detail: 'CSV quote returned.' }
      : { status: 'BROKEN', detail: 'Response is not the expected CSV schema.' };
  }
  if (json === null) return { status: 'BROKEN', detail: 'Response is not valid JSON.' };
  if (source.id.includes('.okx-derivatives') ||
      source.id.includes('.okx-opt-summary')) {
    return isRecord(json) && json.code === '0' &&
      Array.isArray(json.data) && json.data.length > 0
      ? { status: 'HEALTHY', detail: 'Expected OKX response returned.' }
      : { status: 'BROKEN', detail: 'OKX returned an empty or unsuccessful response.' };
  }
  if (source.id.includes('.deribit-perpetual') ||
      source.id.endsWith('.deribit-options')) {
    return isRecord(json) && Object.hasOwn(json, 'result')
      ? { status: 'HEALTHY', detail: 'Deribit returned a result payload.' }
      : { status: 'BROKEN', detail: 'Deribit returned no result payload.' };
  }
  if (source.id.endsWith('.hyperliquid')) {
    return Array.isArray(json) && isRecord(json[0]) && Array.isArray(json[0].universe)
      ? { status: 'HEALTHY', detail: 'Hyperliquid market metadata returned.' }
      : { status: 'BROKEN', detail: 'Hyperliquid returned malformed market metadata.' };
  }
  if (source.id.endsWith('.bybit-funding')) {
    return isRecord(json) && json.retCode === 0 &&
      isRecord(json.result) && Array.isArray(json.result.list) &&
      isRecord(json.result.list[0])
      ? { status: 'HEALTHY', detail: 'Bybit funding history returned.' }
      : { status: 'BROKEN', detail: 'Bybit returned no funding history.' };
  }
  if (source.id.endsWith('.bybit-options')) {
    return isRecord(json) && json.retCode === 0 &&
      isRecord(json.result) && Array.isArray(json.result.list)
      ? { status: 'HEALTHY', detail: `Bybit returned a ${source.symbol} options list.` }
      : { status: 'BROKEN', detail: `Bybit returned no valid ${source.symbol} option list.` };
  }
  if (source.id.endsWith('.binance-eapi')) {
    const asset = source.assets?.[0] ?? 'ETH';
    return Array.isArray(json) && json.some((item) => isRecord(item) &&
      String(item.symbol).startsWith(`${asset}-`) &&
      positiveNumber(item.markPrice) !== null && positiveNumber(item.markIV) !== null)
      ? { status: 'HEALTHY', detail: `Binance returned ${asset} option marks.` }
      : { status: 'BROKEN', detail: `Binance returned no valid ${asset} option marks.` };
  }
  if (source.id === 'council.member6.defillama-dex-volume') {
    return isRecord(json) && Array.isArray(json.totalDataChart) &&
      json.totalDataChart.length >= 2
      ? { status: 'HEALTHY', detail: 'DefiLlama Ethereum DEX-volume history returned.' }
      : { status: 'BROKEN', detail: 'DefiLlama returned no valid Ethereum DEX-volume history.' };
  }
  if (source.id === 'council.member6.defillama') {
    return Array.isArray(json) && json.length > 0
      ? { status: 'HEALTHY', detail: 'DefiLlama Ethereum observations returned.' }
      : { status: 'BROKEN', detail: 'DefiLlama returned no Ethereum observations.' };
  }
  if (source.id.startsWith('council.member7.treasury')) {
    return isRecord(json) && Array.isArray(json.data) && json.data.length > 0
      ? { status: 'HEALTHY', detail: 'Treasury observations returned.' }
      : { status: 'BROKEN', detail: 'Treasury returned no observations.' };
  }
  if (source.id.startsWith('council.member8.alternative')) {
    return isRecord(json) && Array.isArray(json.data) && isRecord(json.data[0]) &&
      typeof json.data[0].value === 'string'
      ? { status: 'HEALTHY', detail: 'Fear & Greed observation returned.' }
      : { status: 'BROKEN', detail: 'Alternative.me returned no Fear & Greed observation.' };
  }
  if (source.id.startsWith('council.member6.blockscout')) {
    return isRecord(json) && Object.hasOwn(json, 'total_blocks')
      ? { status: 'HEALTHY', detail: 'Blockscout chain statistics returned.' }
      : { status: 'BROKEN', detail: 'Blockscout returned no chain statistics.' };
  }
  if (source.id.startsWith('council.member6.beacon')) {
    return isRecord(json) && isRecord(json.data) && typeof json.data.version === 'string'
      ? { status: 'HEALTHY', detail: 'Beacon API node information returned.' }
      : { status: 'BROKEN', detail: 'Beacon API returned no node version.' };
  }
  if (source.id.startsWith('council.member7.fred')) {
    return isRecord(json) && Array.isArray(json.observations) && json.observations.length > 0
      ? { status: 'HEALTHY', detail: 'FRED series observations returned.' }
      : { status: 'BROKEN', detail: 'FRED returned no series observations.' };
  }
  if (Array.isArray(json) && json.length === 0) {
    return { status: 'BROKEN', detail: 'Response array is empty.' };
  }
  if (isRecord(json) && Array.isArray(json.error) && json.error.length > 0) {
    return { status: 'BROKEN', detail: `Provider error: ${json.error.join(', ')}` };
  }
  if (isRecord(json) && json.code && json.code !== '0') {
    return { status: 'BROKEN', detail: `Provider code ${String(json.code)}.` };
  }
  return { status: 'HEALTHY', detail: 'Expected response schema returned.' };
}

async function request(
  source: CouncilSourceDefinition,
  endpoint: string,
  fetcher: typeof fetch,
  requestBody?: unknown,
): Promise<HealthResult> {
  if (source.id === 'council.member6.staking-deposits') {
    return requestStakingDeposits24h(source, endpoint, fetcher);
  }
  const url = new URL(endpoint);
  await paceHost(url.hostname);
  const hyperliquid = source.id.endsWith('.hyperliquid');
  const feeHistory = source.id === 'council.member6.fee-history';
  const rpcBody = feeHistory
    ? [
        { jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] },
        { jsonrpc: '2.0', id: 2, method: 'eth_feeHistory', params: ['0x20', 'latest', [50]] },
      ]
    : null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(endpoint, {
      method: hyperliquid || feeHistory || requestBody !== undefined ? 'POST' : 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json, text/csv, application/rss+xml, application/xml;q=0.9',
        ...(hyperliquid || feeHistory || requestBody !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(hyperliquid || feeHistory || requestBody !== undefined
        ? { body: JSON.stringify(requestBody ?? (hyperliquid ? { type: 'metaAndAssetCtxs' } : rpcBody)) }
        : {}),
    });
    if (response.status === 403 || response.status === 451) {
      return { status: 'REGION_RESTRICTED', detail: `HTTP ${response.status} (regional/access restriction).`, httpHealthy: false };
    }
    if (response.status === 429) {
      return { status: 'BROKEN', detail: 'HTTP 429 (rate limited).', httpHealthy: false };
    }
    if (!response.ok) {
      return { status: 'BROKEN', detail: `HTTP ${response.status}.`, httpHealthy: false };
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
    const receivedAtMs = Date.now();
    const schema = validateResponse(source, text, json);
    const data = endpoint === source.url
      ? validateData(source, endpoint, text, json, receivedAtMs, receivedAtMs)
      : validateSupplemental(source, endpoint, text, json, receivedAtMs);
    const healthy = schema.status === 'HEALTHY' && data.valid !== false;
    return {
      status: healthy ? 'HEALTHY' : 'BROKEN',
      detail: healthy ? schema.detail : data.valid === false ? data.detail : schema.detail,
      httpHealthy: true,
      dataValid: data.valid,
      dataDetail: data.detail,
      observedAtMs: receivedAtMs,
      normalizedData: data.normalizedData,
      ethPriceUsd: data.ethPriceUsd,
      voteValue: data.voteValue,
    };
  } catch (error) {
    return { status: 'BROKEN', detail: error instanceof Error ? error.message : String(error), httpHealthy: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkSource(
  source: CouncilSourceDefinition,
  nowMs: number,
  fetcher: typeof fetch,
): Promise<HealthResult> {
  const cacheKey = `${source.id}:${Boolean(process.env.FRED_API_KEY?.trim())}`;
  const cached = sourceCache.get(cacheKey);
  if (cached && nowMs >= cached.cachedAtMs && nowMs - cached.cachedAtMs < CACHE_TTL_MS) {
    return cached.result;
  }
  const pending = sourceInFlight.get(cacheKey);
  if (pending) return pending;
  const operation = (async (): Promise<HealthResult> => {
    const endpoints = [source.url, ...supplementalUrls(source, Date.now())];
    const dataResults: DataValidation[] = [];
    for (const endpoint of endpoints) {
      const result = await request(source, endpoint, fetcher);
      if (result.status !== 'HEALTHY') {
        sourceCache.set(cacheKey, { cachedAtMs: nowMs, result });
        return result;
      }
      dataResults.push({
        valid: result.dataValid ?? null,
        detail: result.dataDetail ?? 'Data-level validation was not available.',
        normalizedData: result.normalizedData ?? {},
        ethPriceUsd: result.ethPriceUsd ?? null,
        voteValue: result.voteValue ?? 'UNKNOWN',
      });
    }
    const result: HealthResult = {
      status: 'HEALTHY',
      httpHealthy: true,
      dataValid: dataResults.every(({ valid }) => valid === true) ? true : null,
      dataDetail: dataResults.map(({ detail }) => detail).join(' | '),
      observedAtMs: Date.now(),
      normalizedData: Object.assign({}, ...dataResults.map(({ normalizedData }) => normalizedData)),
      ethPriceUsd: dataResults.find(({ ethPriceUsd }) => ethPriceUsd !== null)?.ethPriceUsd ?? null,
      voteValue: dataResults.some(({ voteValue }) => voteValue === 'LOW_VALUE')
        ? 'LOW_VALUE'
        : dataResults.every(({ voteValue }) => voteValue !== 'UNKNOWN') ? 'USEFUL' : 'UNKNOWN',
      detail: endpoints.length > 1
        ? `All ${endpoints.length} required API responses returned successfully.`
        : 'Expected response schema returned.',
    };
    if (source.id.startsWith('council.member7.fred') ||
        source.id === 'council.member7.yahoo-chart') {
      const normalizedData = { ...(result.normalizedData ?? {}) };
      const sp500Change = source.id.startsWith('council.member7.fred')
        ? normalizedData.fred_SP500_changePct
        : normalizedData.sp500ChangePct;
      const dollarChange = source.id.startsWith('council.member7.fred')
        ? normalizedData.fred_DTWEXBGS_changePct
        : normalizedData.dxyChangePct;
      if (typeof sp500Change === 'number' && typeof dollarChange === 'number') {
        normalizedData.macroDirectionValue =
          (Math.sign(sp500Change) - Math.sign(dollarChange)) / 2;
      }
      result.normalizedData = normalizedData;
    }
    sourceCache.set(cacheKey, { cachedAtMs: nowMs, result });
    return result;
  })();
  sourceInFlight.set(cacheKey, operation);
  try {
    return await operation;
  } finally {
    if (sourceInFlight.get(cacheKey) === operation) sourceInFlight.delete(cacheKey);
  }
}

export async function checkCouncilMemberSources(
  nowMs = Date.now(),
  fetcher: typeof fetch = fetch,
  asset = 'ETH',
  onChainFlow?: CouncilWhaleFlowData | null,
): Promise<Readonly<Record<number, readonly CouncilMemberSourceCheck[]>>> {
  const memberDefinitions = asset === 'ETH'
    ? COUNCIL_MEMBER_SOURCES
    : [1, 2, 3, 4, 5, 6, 7, 8].flatMap((memberId) =>
      getCouncilMemberSources(memberId, asset)
    );
  const members = [...new Set(memberDefinitions.flatMap(({ memberIds }) => memberIds ?? []))];
  const checked = await Promise.all(members.map(async (memberId) => {
    const orderedSources = getCouncilMemberSources(memberId, asset);
    if (memberId === 6 && asset !== 'ETH') {
      const flowMatchesPair = onChainFlow?.pair === `${asset}/USDT:USDT` &&
        onChainFlow.asset === asset;
      const flowAgeMs = onChainFlow?.timestampMs === null ||
        onChainFlow?.timestampMs === undefined
        ? null
        : nowMs - onChainFlow.timestampMs;
      const flowIsFresh = flowAgeMs !== null && flowAgeMs >= 0 &&
        flowAgeMs <= (asset === 'BTC' ? 20 * 60_000 : 5 * 60_000);
      return [
        memberId,
        orderedSources.map((source): CouncilMemberSourceCheck => {
          const missingApiKey =
            source.id === 'onchain.helius-solana' && !process.env.HELIUS_API_KEY?.trim() ||
            source.id === 'onchain.bscscan-bnb' && !process.env.BSCSCAN_API_KEY?.trim();
          if (missingApiKey) {
            return {
              sourceId: source.id,
              status: 'MISSING_API_KEY',
              detail: `Required key is not configured for this optional provider.`,
              httpHealthy: null,
              dataValid: false,
              dataDetail: 'No request was made because the provider key is missing.',
              voteValue: 'LOW_VALUE',
            };
          }
          if (flowMatchesPair && onChainFlow?.sourceId === source.id) {
            const healthy = onChainFlow.status === 'LIVE' &&
              flowIsFresh &&
              onChainFlow.coverageStatus === 'SAMPLED' &&
              onChainFlow.qualityPct >= 80;
            return {
              sourceId: source.id,
              status: healthy ? 'HEALTHY' : 'BROKEN',
              detail: healthy
                ? `${onChainFlow.provider} returned a fresh, confirmed ${asset} on-chain sample; it is context only and does not infer owner or trade direction.`
                : onChainFlow.unavailableReason ??
                  `${onChainFlow.provider} did not provide a fresh, sufficiently covered on-chain sample.`,
              httpHealthy: null,
              dataValid: healthy,
              dataDetail: healthy
                ? 'Valid on-chain sample; low-value/context-only for price direction.'
                : onChainFlow.unavailableReason ?? 'The on-chain sample is unavailable, stale, or incomplete.',
              observedAtMs: onChainFlow.timestampMs,
              voteValue: 'LOW_VALUE',
            };
          }
          return {
            sourceId: source.id,
            status: 'UNTESTED',
            detail: onChainFlow?.unavailableReason ??
              'This provider was not independently queried in the on-chain flow check; it is not counted as healthy.',
            httpHealthy: null,
            dataValid: false,
            dataDetail: 'No independent provider response or direction-bearing metric was observed.',
            voteValue: 'LOW_VALUE',
          };
        }),
      ] as const;
    }
    const checks: CouncilMemberSourceCheck[] = [];
    for (const source of orderedSources) {
      const result = await checkSource(source, nowMs, fetcher);
      checks.push({
        sourceId: source.id,
        status: result.status,
        detail: result.detail,
        httpHealthy: result.httpHealthy ?? null,
        dataValid: result.dataValid ?? null,
        dataDetail: result.dataDetail ?? result.detail,
        observedAtMs: result.observedAtMs ?? null,
        normalizedData: result.normalizedData ?? {},
        ethPriceUsd: result.ethPriceUsd ?? null,
        voteValue: result.voteValue ?? 'UNKNOWN',
      });
    }
    return [memberId, checks] as const;
  }));
  return Object.fromEntries(checked);
}

export function resetCouncilSourceHealthCacheForTests(): void {
  sourceCache.clear();
  sourceInFlight.clear();
  hostQueues.clear();
  lastRequestByHost.clear();
}
