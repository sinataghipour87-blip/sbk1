import assert from 'node:assert/strict';
import { fetchDirectNewsHeadlines } from '../src/services/directNewsFeeds';

const nowMs = Date.parse('2026-10-17T20:00:00.000Z');
const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title><![CDATA[Bitcoin &amp; markets]]></title>
    <link><![CDATA[https://www.coindesk.com/markets/article]]></link>
    <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
  <item><title>Future article</title><link>https://www.coindesk.com/future</link>
    <pubDate>Sun, 18 Oct 2026 20:00:00 +0000</pubDate></item>
  <item><title>Wrong publisher</title><link>https://example.com/not-coindesk</link>
    <pubDate>Sat, 17 Oct 2026 19:30:00 +0000</pubDate></item>
  <item><title>Old article</title><link>https://www.coindesk.com/old</link>
    <pubDate>Fri, 16 Oct 2026 19:00:00 +0000</pubDate></item>
</channel></rss>`;

const result = await fetchDirectNewsHeadlines(async (input) => {
  if (String(input).includes('coindesk')) return new Response(xml, { status: 200 });
  if (String(input).includes('cointelegraph')) return new Response('<html>blocked</html>', { status: 200 });
  return new Response('upstream unavailable', { status: 503 });
}, nowMs);

assert.equal(result.status, 'LIVE');
assert.equal(result.headlines.length, 1);
assert.equal(result.headlines[0].headline, 'Bitcoin & markets');
assert.equal(result.headlines[0].publisher, 'CoinDesk');
assert.equal(result.headlines[0].publishedAt, '2026-10-17T19:30:00.000Z');
assert.equal(result.headlines[0].url, 'https://www.coindesk.com/markets/article');
assert.deepEqual(result.sources.map((source) => source.status), ['LIVE', 'UNAVAILABLE', 'UNAVAILABLE']);

const unavailable = await fetchDirectNewsHeadlines(async () => new Response('fail', { status: 503 }), nowMs);
assert.equal(unavailable.status, 'UNAVAILABLE');
assert.deepEqual(unavailable.headlines, []);
assert.ok(unavailable.sources.every((source) => source.error));

console.log('Direct news feed validation checks passed.');
