export interface DirectNewsHeadline {
  id: string;
  headline: string;
  publisher: string;
  url: string;
  publishedAt: string;
}

export interface DirectNewsSourceStatus {
  publisher: string;
  endpoint: string;
  status: 'LIVE' | 'UNAVAILABLE';
  retrievedAtMs: number | null;
  latencyMs: number | null;
  ageMs: number | null;
  headlineCount: number;
  error?: string;
}

export interface DirectNewsResult {
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
  },
] as const;

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

function parseHeadlines(
  xml: string,
  source: (typeof sources)[number],
  nowMs: number,
): DirectNewsHeadline[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].flatMap(([, item]) => {
    const headline = readXmlElement(item, 'title');
    const rawUrl = readXmlElement(item, 'link');
    const publishedAt = readXmlElement(item, 'pubDate');
    if (!headline || !rawUrl || !publishedAt) return [];

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
    if (!Number.isFinite(timestamp) || timestamp > nowMs + 5 * 60_000 || nowMs - timestamp > 24 * 60 * 60_000) {
      return [];
    }

    return [{
      id: parsedUrl.toString(),
      headline: headline.replace(/<[^>]*>/g, '').trim(),
      publisher: source.publisher,
      url: parsedUrl.toString(),
      publishedAt: new Date(timestamp).toISOString(),
    }];
  }).filter((item) => item.headline.length > 0);
}

export async function fetchDirectNewsHeadlines(
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
  timeoutMs = 4_000,
): Promise<DirectNewsResult> {
  const results = await Promise.all(sources.map(async (source): Promise<{
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      if (!/<rss\b|<rdf:RDF\b/i.test(xml)) throw new Error('Response is not an RSS or RDF feed.');
      const headlines = parseHeadlines(xml, source, nowMs);
      const retrievedAtMs = Date.now();
      return {
        sourceStatus: {
          publisher: source.publisher,
          endpoint: source.endpoint,
          status: 'LIVE',
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
  const uniqueHeadlines = [...new Map(headlines.map((headline) => [headline.url, headline])).values()]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, 12);
  const retrievedAtMs = uniqueHeadlines.length > 0
    ? Math.max(...results.map((result) => result.sourceStatus.retrievedAtMs ?? 0))
    : null;

  return {
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
