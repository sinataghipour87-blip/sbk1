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
}, nowMs);

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
]);

const unavailable = await fetchDirectNewsHeadlines(async () => new Response('fail', { status: 503 }), nowMs);
assert.equal(unavailable.status, 'UNAVAILABLE');
assert.deepEqual(unavailable.headlines, []);
assert.ok(unavailable.sources.every((source) => source.error));

console.log('Direct news feed validation checks passed.');
