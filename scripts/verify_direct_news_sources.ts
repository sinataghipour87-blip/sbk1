import assert from 'node:assert/strict';
import { fetchDirectNewsHeadlines } from '../src/services/directNewsFeeds';

const nowMs = Date.parse('2026-10-17T20:00:00.000Z');
const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title><![CDATA[Bitcoin &amp; markets]]></title>
    <link><![CDATA[https://www.coindesk.com/markets/article]]></link>
    <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
  <item><title>Syndicated copy with a different headline</title>
    <link>https://coindesk.com/markets/article/?utm_source=feed&amp;fbclid=tracking</link>
    <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
  <item><title>Future article</title><link>https://www.coindesk.com/future</link>
    <pubDate>Sun, 18 Oct 2026 20:00:00 +0000</pubDate></item>
  <item><title>Wrong publisher</title><link>https://example.com/not-coindesk</link>
    <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
  <item><title>Old article</title><link>https://www.coindesk.com/old</link>
    <pubDate>Fri, 16 Oct 2026 19:00:00 +0000</pubDate></item>
</channel></rss>`;
const secXml = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>SEC Provides Guidance on Digital Assets and Bitcoin ETF Filings</title>
    <link>https://www.sec.gov/newsroom/press-releases/crypto-guidance</link>
    <pubDate>Sat, 17 Oct 2026 19:45:00 +0000</pubDate></item>
  <item><title>SEC Announces an Unrelated Advisory Committee Meeting</title>
    <link>https://www.sec.gov/newsroom/press-releases/unrelated-meeting</link>
    <pubDate>Sat, 17 Oct 2026 19:45:00 +0000</pubDate></item>
</channel></rss>`;
const cointelegraphXml = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>Bitcoin &amp; markets</title>
    <link>https://cointelegraph.com/news/syndicated-markets-article</link>
    <pubDate>Sat, 17 Oct 2026 19:35:00 +0000</pubDate></item>
</channel></rss>`;

const result = await fetchDirectNewsHeadlines(async (input) => {
  if (String(input).includes('coindesk')) return new Response(xml, { status: 200 });
  if (String(input).includes('cointelegraph')) return new Response(cointelegraphXml, { status: 200 });
  if (String(input).includes('sec.gov')) return new Response(secXml, { status: 200 });
  return new Response('upstream unavailable', { status: 503 });
}, nowMs, 4_000, 'BTC/USDT:USDT');

assert.equal(result.status, 'LIVE');
assert.equal(result.headlines.length, 2);
const coindeskHeadline = result.headlines.find((headline) => headline.publisher === 'CoinDesk');
assert.ok(coindeskHeadline);
assert.equal(coindeskHeadline.headline, 'Bitcoin & markets');
assert.equal(coindeskHeadline.publishedAt, '2026-10-17T19:30:00.000Z');
assert.equal(coindeskHeadline.url, 'https://www.coindesk.com/markets/article');
const coindeskSource = result.sources.find((source) => source.publisher === 'CoinDesk');
assert.ok(coindeskSource);
assert.equal(coindeskSource.responseTimestampMs, Date.parse('2026-10-17T19:30:00.000Z'));
assert.ok(coindeskSource.retrievedAtMs !== null);
assert.ok(coindeskSource.ageMs !== null);
const secHeadlines = result.headlines.filter((headline) =>
  headline.publisher === 'U.S. Securities and Exchange Commission');
assert.equal(secHeadlines.length, 1);
assert.match(secHeadlines[0].headline, /Bitcoin ETF/);
assert.deepEqual(result.sources.map((source) => source.status), [
  'LIVE',
  'LIVE',
  'UNAVAILABLE',
  'LIVE',
  'UNAVAILABLE',
  'UNAVAILABLE',
  'UNAVAILABLE',
  'UNAVAILABLE',
  'UNAVAILABLE',
  'UNAVAILABLE',
  'UNAVAILABLE',
  'UNAVAILABLE',
  'UNAVAILABLE',
]);
assert.ok(result.headlines.every((headline) => headline.pair === 'BTC/USDT:USDT'));
const ethOnly = await fetchDirectNewsHeadlines(async (input) => {
  if (String(input).includes('coindesk')) {
    return new Response(xml.replaceAll('Bitcoin', 'Ethereum').replaceAll('bitcoin', 'ethereum'), {
      status: 200,
      headers: { 'Content-Type': 'application/rss+xml' },
    });
  }
  return new Response('unavailable', { status: 503 });
}, nowMs, 4_000, 'ETH/USDT:USDT');
assert.equal(ethOnly.status, 'LIVE');
assert.ok(ethOnly.headlines.length > 0);
assert.ok(ethOnly.headlines.every((headline) => headline.pair === 'ETH/USDT:USDT'));
assert.equal(ethOnly.headlines.some((headline) => /bitcoin/i.test(headline.headline)), false,
  'asset-specific news output must not contain BTC headlines for ETH');
const assetHeadlines = [
  ['BTC/USDT:USDT', 'Bitcoin'],
  ['ETH/USDT:USDT', 'Ethereum'],
  ['SOL/USDT:USDT', 'Solana'],
  ['XRP/USDT:USDT', 'Ripple'],
  ['BNB/USDT:USDT', 'BNB Chain'],
] as const;
const assetNewsXml = `<?xml version="1.0"?><rss version="2.0"><channel>${assetHeadlines.map(
  ([, asset], index) => `<item><title>${asset} ecosystem update</title>
    <link>https://www.coindesk.com/asset/${index}</link>
    <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>`,
).join('')}</channel></rss>`;
for (const [pair, asset] of assetHeadlines) {
  const scoped = await fetchDirectNewsHeadlines(async (input) => {
    if (String(input).includes('coindesk')) {
      return new Response(assetNewsXml, { status: 200 });
    }
    return new Response('', { status: 503 });
  }, nowMs, 4_000, pair);
  assert.equal(scoped.headlines.length, 1);
  assert.equal(scoped.headlines[0].pair, pair);
  assert.match(scoped.headlines[0].headline, new RegExp(asset, 'i'));
}

for (const [pair, acceptedTitle] of [
  ['SOL/USDT:USDT', 'Solana network upgrade'],
  ['BNB/USDT:USDT', 'BNB New Layer 1 Puts Its Ecosystem Strategy in Focus'],
] as const) {
  const ambiguousFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>SOL price rallies</title><link>https://www.coindesk.com/ambiguous/sol</link>
      <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
    <item><title>BNB price rallies</title><link>https://www.coindesk.com/ambiguous/bnb</link>
      <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
    <item><title>${acceptedTitle}</title><link>https://www.coindesk.com/specific/${pair.slice(0, 3).toLowerCase()}</link>
      <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
  </channel></rss>`;
  const scoped = await fetchDirectNewsHeadlines(async (input) =>
    String(input).includes('coindesk')
      ? new Response(ambiguousFeed, { status: 200 })
      : new Response('', { status: 503 }),
  nowMs, 4_000, pair);
  assert.equal(scoped.headlines.length, 1);
  assert.equal(scoped.headlines[0].headline, acceptedTitle);
}

for (const source of [
  {
    pair: 'XRP/USDT:USDT',
    publisher: 'U.Today',
    endpoint: 'https://u.today/rss',
    host: 'u.today',
    title: 'XRP Ledger Payment Volume Update',
  },
  {
    pair: 'BNB/USDT:USDT',
    publisher: 'Cryptonews',
    endpoint: 'https://cryptonews.com/news/feed/',
    host: 'cryptonews.com',
    title: 'BNB Chain Adds New Network Feature',
  },
] as const) {
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>${source.title}</title><link>https://${source.host}/story/asset-news</link>
      <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
  </channel></rss>`;
  const scoped = await fetchDirectNewsHeadlines(async (input) =>
    String(input) === source.endpoint
      ? new Response(feed, { status: 200 })
      : new Response('', { status: 503 }),
  nowMs, 4_000, source.pair);
  assert.equal(scoped.headlines.length, 1);
  assert.equal(scoped.headlines[0].publisher, source.publisher);
  assert.equal(scoped.headlines[0].pair, source.pair);
}

const officialFeeds = [
  {
    pair: 'BTC/USDT:USDT',
    publisher: 'Bitcoin Core',
    hostname: 'bitcoincore.org',
    assetText: 'Bitcoin Core',
    path: '/en/rss.xml',
    articlePath: '/en/blog/example-bitcoin-core-update',
  },
  {
    pair: 'ETH/USDT:USDT',
    publisher: 'Ethereum Foundation',
    hostname: 'blog.ethereum.org',
    assetText: 'Ethereum Foundation',
    path: '/feed.xml',
    articlePath: '/2026/10/17/example-ethereum-update',
  },
  {
    pair: 'SOL/USDT:USDT',
    publisher: 'Solana',
    hostname: 'solana.com',
    assetText: 'Solana',
    path: '/news/rss.xml',
    articlePath: '/news/example-solana-update',
  },
] as const;
for (const source of officialFeeds) {
  const requests: string[] = [];
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>${source.assetText} ecosystem update</title>
      <link>https://${source.hostname}${source.articlePath}</link>
      <description>Official ${source.assetText} project news.</description>
      <pubDate>Sat, 17 Oct 2026 19:45:00 +0000</pubDate></item>
  </channel></rss>`;
  const scoped = await fetchDirectNewsHeadlines(async (input) => {
    const url = new URL(String(input));
    requests.push(url.href);
    return url.hostname === source.hostname
      ? new Response(feed, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })
      : new Response('', { status: 503 });
  }, nowMs, 4_000, source.pair);
  assert.ok(requests.some((request) => new URL(request).hostname === source.hostname),
    `${source.publisher} official feed should be queried for its asset room`);
  assert.equal(requests.some((request) =>
    ['bitcoincore.org', 'blog.ethereum.org', 'solana.com'].includes(new URL(request).hostname) &&
    new URL(request).hostname !== source.hostname
  ), false, 'an official feed must not be queried in another asset room');
  assert.equal(scoped.headlines.length, 1);
  assert.equal(scoped.headlines[0].publisher, source.publisher);
  assert.equal(scoped.headlines[0].pair, source.pair);
  assert.equal(scoped.headlines[0].url, `https://${source.hostname}${source.articlePath}`);
}

const proposedOfficialFeeds = [
  {
    pair: 'SOL/USDT:USDT',
    publisher: 'Solana Status',
    host: 'status.solana.com',
    endpoint: 'https://status.solana.com/history.rss',
    title: 'Cluster incident',
    description: 'Resolved: Block production on Solana mainnet beta resumed after validator operators restarted the cluster.',
    url: 'https://status.solana.com/incidents/fixture-solana',
  },
] as const;
for (const source of proposedOfficialFeeds) {
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>${source.title}</title><description>${source.description}</description>
      <link>${source.url}</link><pubDate>Sat, 17 Oct 2026 19:45:00 +0000</pubDate></item>
  </channel></rss>`;
  const scoped = await fetchDirectNewsHeadlines(async (input) => {
    const url = new URL(String(input));
    if (url.href === source.endpoint) {
      return new Response(feed, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
    }
    return new Response('', { status: 503 });
  }, nowMs, 4_000, source.pair);
  const result = scoped.sources.find(({ publisher }) => publisher === source.publisher);
  assert.ok(result, `${source.publisher} is represented in the source inventory`);
  assert.equal(result.endpoint, source.endpoint);
  assert.equal(result.status, 'LIVE');
  assert.equal(scoped.headlines.length, 1);
  assert.equal(scoped.headlines[0].publisher, source.publisher);
  assert.equal(scoped.headlines[0].pair, source.pair);
  assert.equal(scoped.headlines[0].url, source.url);
}

for (const [pair, disabledEndpoint] of [
  ['XRP/USDT:USDT', 'https://ripple.com/insights/feed/'],
  ['BNB/USDT:USDT', 'https://www.bnbchain.org/en/blog/rss.xml'],
] as const) {
  const requests: string[] = [];
  const disabledFeed = await fetchDirectNewsHeadlines(async (input) => {
    requests.push(String(input));
    return new Response('', { status: 503 });
  }, nowMs, 4_000, pair);
  assert.equal(requests.includes(disabledEndpoint), false,
    `${disabledEndpoint} must not be polled as an active voting feed`);
  assert.equal(disabledFeed.sources.some(({ endpoint }) => endpoint === disabledEndpoint), false);
  assert.equal(disabledFeed.headlines.length, 0);
  assert.equal(disabledFeed.status, 'UNAVAILABLE');
}

const unrelatedSolanaStatus = await fetchDirectNewsHeadlines(async (input) => {
  if (String(input) !== 'https://status.solana.com/history.rss') return new Response('', { status: 503 });
  return new Response(`<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Database maintenance</title><description>Resolved: unrelated component maintenance.</description>
      <link>https://status.solana.com/incidents/irrelevant</link>
      <pubDate>Sat, 17 Oct 2026 19:45:00 +0000</pubDate></item>
  </channel></rss>`, { status: 200 });
}, nowMs, 4_000, 'SOL/USDT:USDT');
assert.equal(unrelatedSolanaStatus.headlines.some(({ publisher }) => publisher === 'Solana Status'), false,
  'generic status incidents must not be treated as SOL-specific news');

const unavailable = await fetchDirectNewsHeadlines(
  async () => new Response('fail', { status: 503 }),
  nowMs,
  4_000,
  'BTC/USDT:USDT',
);
assert.equal(unavailable.status, 'UNAVAILABLE');
assert.deepEqual(unavailable.headlines, []);
assert.ok(unavailable.sources.every((source) => source.error));

console.log('Direct news feed validation checks passed.');
