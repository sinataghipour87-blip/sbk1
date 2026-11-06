import { deduplicateNews } from './councilEvidenceDeduplication';
import { getFreqtradePairBaseAsset } from './freqtradePairs';

export interface DirectNewsHeadline {
  id: string;
  pair: string;
  headline: string;
  publisher: string;
  url: string;
  publishedAt: string;
}

export interface DirectNewsSourceStatus {
  publisher: string;
  endpoint: string;
  status: 'LIVE' | 'UNAVAILABLE';
  responseTimestampMs: number | null;
  retrievedAtMs: number | null;
  latencyMs: number | null;
  ageMs: number | null;
  headlineCount: number;
  error?: string;
}

export interface DirectNewsResult {
  pair: string;
  status: 'LIVE' | 'UNAVAILABLE';
  retrievedAtMs: number | null;
  headlines: DirectNewsHeadline[];
  sources: DirectNewsSourceStatus[];
}

const sources = [
  {
    publisher: 'CoinDesk',
    endpoint: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    hostname: 'coindesk.com',
  },
  {
    publisher: 'Cointelegraph',
    endpoint: 'https://cointelegraph.com/rss',
    hostname: 'cointelegraph.com',
  },
  {
    publisher: 'Federal Reserve',
    endpoint: 'https://www.federalreserve.gov/feeds/press_all.xml',
    hostname: 'federalreserve.gov',
    relevance: /\b(federal reserve|fomc|interest rates?|inflation|monetary policy|financial conditions|treasury)\b/i,
  },
  {
    publisher: 'U.S. Securities and Exchange Commission',
    endpoint: 'https://www.sec.gov/news/pressreleases.rss',
    hostname: 'sec.gov',
    relevance: /\b(bitcoin|crypto(?:currency|currencies)?|digital assets?|blockchain|tokens?|tokenization|spot etfs?)\b/i,
  },
  {
    publisher: 'Decrypt',
    endpoint: 'https://decrypt.co/feed',
    hostname: 'decrypt.co',
  },
  {
    publisher: 'The Block',
    endpoint: 'https://www.theblock.co/rss.xml',
    hostname: 'theblock.co',
  },
  {
    publisher: 'Bitcoin Magazine',
    endpoint: 'https://bitcoinmagazine.com/.rss/full/',
    hostname: 'bitcoinmagazine.com',
  },
  {
    publisher: 'CNBC',
    endpoint: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    hostname: 'cnbc.com',
    relevance: /\b(bitcoin|crypto(?:currency|currencies)?|digital assets?|blockchain|federal reserve|fed policy|interest rates?|inflation|consumer prices?|treasury yields?|spot etfs?)\b/i,
  },
  {
    publisher: 'The Wall Street Journal',
    endpoint: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
    hostname: 'wsj.com',
    relevance: /\b(bitcoin|crypto(?:currency|currencies)?|digital assets?|blockchain|federal reserve|fed policy|interest rates?|inflation|consumer prices?|treasury yields?|spot etfs?)\b/i,
  },
  {
    publisher: 'The Guardian',
    endpoint: 'https://www.theguardian.com/uk/business/rss',
    hostname: 'theguardian.com',
    relevance: /\b(bitcoin|crypto(?:currency|currencies)?|digital assets?|blockchain|federal reserve|fed policy|interest rates?|inflation|consumer prices?|treasury yields?|spot etfs?)\b/i,
  },
  {
    publisher: 'Bitcoin Core',
    endpoint: 'https://bitcoincore.org/en/rss.xml',
    hostname: 'bitcoincore.org',
    assets: ['BTC'],
  },
  {
    publisher: 'Ethereum Foundation',
    endpoint: 'https://blog.ethereum.org/feed.xml',
    hostname: 'blog.ethereum.org',
    assets: ['ETH'],
  },
  {
    publisher: 'Solana',
    endpoint: 'https://solana.com/news/rss.xml',
    hostname: 'solana.com',
    assets: ['SOL'],
  },
  {
    publisher: 'Solana Status',
    endpoint: 'https://status.solana.com/history.rss',
    hostname: 'status.solana.com',
    assets: ['SOL'],
    parser: 'solana-status',
  },
  {
    publisher: 'Ripple Insights',
    endpoint: 'https://ripple.com/insights/feed/',
    hostname: 'ripple.com',
    assets: ['XRP'],
    parser: 'ripple-insights',
    enabled: false,
  },
  {
    publisher: 'BNB Chain Blog',
    endpoint: 'https://www.bnbchain.org/en/blog/rss.xml',
    hostname: 'www.bnbchain.org',
    assets: ['BNB'],
    parser: 'bnb-chain-blog',
    enabled: false,
  },
  {
    publisher: 'U.Today',
    endpoint: 'https://u.today/rss',
    hostname: 'u.today',
  },
  {
    publisher: 'Cryptonews',
    endpoint: 'https://cryptonews.com/news/feed/',
    hostname: 'cryptonews.com',
  },
] as const;

const MAX_HEADLINE_AGE_MS = 6 * 60 * 60_000;
const MAX_RETURNED_HEADLINES = 24;

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function readXmlElement(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'i').exec(xml);
  return match ? decodeXmlText(match[1]) : null;
}

function stripHtml(value: string): string {
  return decodeXmlText(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
}

function parseHeadlines(
  xml: string,
  source: (typeof sources)[number],
  pair: string,
  nowMs: number,
): DirectNewsHeadline[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].flatMap(([, item]) => {
    const title = readXmlElement(item, 'title');
    const description = readXmlElement(item, 'description') ?? '';
    const rawUrl = readXmlElement(item, 'link');
    const publishedAt = readXmlElement(item, 'pubDate');
    if (!title || !rawUrl || !publishedAt) return [];
    const descriptionText = stripHtml(description);
    let headline = title;
    if ('parser' in source) {
      if (source.parser === 'solana-status') {
        if (!/\b(solana|mainnet|cluster)\b/i.test(descriptionText) ||
            !/\b(incident|outage|degrad(?:ed|ation)|disruption|resum(?:ed|ption)|resolved)\b/i.test(descriptionText)) {
          return [];
        }
        headline = `${title}: ${descriptionText.slice(0, 240)}`;
      } else if (source.parser === 'ripple-insights') {
        if (!/\b(ripple|xrpl|xrp ledger|xrp)\b/i.test(`${title} ${descriptionText}`)) return [];
      } else if (source.parser === 'bnb-chain-blog') {
        if (!/\b(bnb chain|bnb smart chain|bnb)\b/i.test(`${title} ${descriptionText}`)) return [];
      }
    }
    if ('relevance' in source && !source.relevance.test(headline)) return [];
    const asset = getFreqtradePairBaseAsset(pair);
    const assetPattern = source.publisher === 'BNB Chain Blog'
      ? /\b(bnb chain|bnb smart chain)\b/i
      : source.publisher === 'Ripple Insights'
        ? /\b(ripple|xrpl|xrp ledger|xrp)\b/i
        : asset ? assetHeadlinePattern(asset) : /(?!) /;
    if (!asset || !assetPattern.test(`${headline} ${descriptionText}`)) return [];

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return [];
    }
    if (
      parsedUrl.protocol !== 'https:' ||
      (parsedUrl.hostname !== source.hostname && !parsedUrl.hostname.endsWith(`.${source.hostname}`))
    ) return [];

    const timestamp = Date.parse(publishedAt);
    if (!Number.isFinite(timestamp) || timestamp > nowMs + 5 * 60_000 || nowMs - timestamp > MAX_HEADLINE_AGE_MS) {
      return [];
    }

    return [{
      id: parsedUrl.toString(),
      pair,
      headline: headline.replace(/<[^>]*>/g, '').trim(),
      publisher: source.publisher,
      url: parsedUrl.toString(),
      publishedAt: new Date(timestamp).toISOString(),
    }];
  }).filter((item) => item.headline.length > 0);
}

function assetHeadlinePattern(asset: string): RegExp {
  const terms: Record<string, string> = {
    BTC: String.raw`bitcoin|#bitcoin`,
    ETH: String.raw`ethereum|ether(?:eum)?|#ethereum`,
    SOL: String.raw`solana|#solana`,
    XRP: String.raw`ripple|xrp|#xrp`,
    BNB: String.raw`bnb\s+(?:chain|coin)|binance\s+(?:coin|chain)|#bnb|bnb\b.{0,100}\b(?:ecosystem|layer\s*1|token|network|smart chain)\b`,
  };
  return new RegExp(`(?:^|[^a-z0-9])(?:${terms[asset] ?? '(?!)'})(?=$|[^a-z0-9])`, 'i');
}

export async function fetchDirectNewsHeadlines(
  fetcher: typeof fetch,
  nowMs: number,
  timeoutMs: number,
  pair: string,
): Promise<DirectNewsResult> {
  const asset = getFreqtradePairBaseAsset(pair);
  if (!asset) {
    throw new Error(`Unsupported pair for asset-specific news: ${pair}`);
  }
  const applicableSources = sources.filter((source) =>
    (!('enabled' in source) || source.enabled) &&
    (!('assets' in source) || source.assets.some((sourceAsset) => sourceAsset === asset))
  );
  const results = await Promise.all(applicableSources.map(async (source): Promise<{
    sourceStatus: DirectNewsSourceStatus;
    headlines: DirectNewsHeadline[];
  }> => {
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(source.endpoint, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      });
      if (!response.ok) {
        const restriction = response.status === 403 || response.status === 451
          ? ' (regional/access restriction)'
          : '';
        throw new Error(`HTTP ${response.status}${restriction}`);
      }
      const xml = await response.text();
      if (!/<rss\b|<rdf:RDF\b/i.test(xml)) throw new Error('Response is not an RSS or RDF feed.');
      const headlines = parseHeadlines(xml, source, pair, nowMs);
      const retrievedAtMs = Date.now();
      return {
        sourceStatus: {
          publisher: source.publisher,
          endpoint: source.endpoint,
          status: 'LIVE',
          responseTimestampMs: headlines.reduce(
            (latest, headline) => Math.max(latest, Date.parse(headline.publishedAt)),
            0,
          ) || null,
          retrievedAtMs,
          latencyMs: Math.max(0, retrievedAtMs - startedAtMs),
          ageMs: 0,
          headlineCount: headlines.length,
        },
        headlines,
      };
    } catch (error) {
      return {
        sourceStatus: {
          publisher: source.publisher,
          endpoint: source.endpoint,
          status: 'UNAVAILABLE',
          responseTimestampMs: null,
          retrievedAtMs: null,
          latencyMs: Math.max(0, Date.now() - startedAtMs),
          ageMs: null,
          headlineCount: 0,
          error: error instanceof Error ? error.message : String(error),
        },
        headlines: [],
      };
    } finally {
      clearTimeout(timeout);
    }
  }));

  const headlines = results.flatMap((result) => result.headlines);
  const uniqueHeadlines = deduplicateNews(headlines).values
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, MAX_RETURNED_HEADLINES);
  const retrievedAtMs = uniqueHeadlines.length > 0
    ? Math.max(...results.map((result) => result.sourceStatus.retrievedAtMs ?? 0))
    : null;

  return {
    pair,
    status: uniqueHeadlines.length > 0 ? 'LIVE' : 'UNAVAILABLE',
    retrievedAtMs,
    headlines: uniqueHeadlines,
    sources: results.map((result) => ({
      ...result.sourceStatus,
      ageMs: result.sourceStatus.retrievedAtMs === null
        ? null
        : Math.max(0, Date.now() - result.sourceStatus.retrievedAtMs),
    })),
  };
}
