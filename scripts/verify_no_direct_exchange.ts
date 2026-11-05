import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'src');
const forbiddenStrings = [
  'api.bybit.com',
  'api-testnet.bybit.com',
  'stream.bybit.com',
  'stream-testnet.bybit.com',
  'okx.com',
  'kucoin.com',
  'nobitex',
];
const publicMarketFeedPath = path.join('src', 'services', 'publicMarketDataFallback.ts');
const okxOptionsFeedPath = path.join('src', 'services', 'okxOptionsData.ts');
const binanceOptionsFeedPath = path.join('src', 'services', 'binanceEuropeanOptionsData.ts');
const bybitOptionsFeedPath = path.join('src', 'services', 'bybitOptionsData.ts');
const sourceRegistryPath = path.join('src', 'services', 'councilSourceRegistry.ts');
const approvedPublicMarketEndpoints = [
  'fapi.binance.com',
  'api.binance.com',
  'api.bybit.com/v5/market/tickers',
  'www.okx.com/api/v5/market/ticker',
];
const approvedOkxOptionsRoutes = [
  'public/instruments',
  'public/opt-summary',
  'public/open-interest',
  'market/tickers',
];
const approvedBinanceOptionsRoutes = [
  "'exchangeInfo'",
  "'index'",
  "'mark'",
  "'openInterest'",
];
const approvedBybitOptionsRoutes = [
  'instruments-info',
  'tickers',
];

function isExcluded(relativePath: string): boolean {
  const segments = relativePath.split(path.sep);
  return segments.some((segment) => /^(?:docs?|tests?|__tests__)$/i.test(segment)) ||
    /\.(?:test|spec)\.[^.]+$/i.test(relativePath);
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    const relativePath = path.relative(repositoryRoot, fullPath);
    return entry.isFile() && !isExcluded(relativePath) ? [fullPath] : [];
  });
}

const files = collectSourceFiles(sourceRoot);
files.push(path.join(repositoryRoot, 'server.ts'));

const findings: string[] = [];
let publicMarketFeedContents: string | null = null;
let okxOptionsFeedContents: string | null = null;
let binanceOptionsFeedContents: string | null = null;
let bybitOptionsFeedContents: string | null = null;
let sourceRegistryContents: string | null = null;
for (const file of files) {
  const relativePath = path.relative(repositoryRoot, file);
  const contents = readFileSync(file, 'utf8');
  if (relativePath === publicMarketFeedPath) {
    publicMarketFeedContents = contents;
    continue;
  }
  if (relativePath === okxOptionsFeedPath) {
    okxOptionsFeedContents = contents;
    continue;
  }
  if (relativePath === binanceOptionsFeedPath) {
    binanceOptionsFeedContents = contents;
    continue;
  }
  if (relativePath === bybitOptionsFeedPath) {
    bybitOptionsFeedContents = contents;
    continue;
  }
  if (relativePath === sourceRegistryPath) {
    sourceRegistryContents = contents;
    continue;
  }
  const lines = contents.split(/\r?\n/);
  lines.forEach((line, index) => {
    const matched = forbiddenStrings.filter((value) => line.toLowerCase().includes(value));
    for (const value of matched) {
      findings.push(`${relativePath}:${index + 1}: forbidden direct-exchange string "${value}"`);
    }
  });
}

assert.ok(publicMarketFeedContents, 'The read-only public market feed adapter must remain present.');
for (const endpoint of approvedPublicMarketEndpoints) {
  assert.ok(
    publicMarketFeedContents.includes(endpoint),
    `The read-only public market feed adapter must connect to ${endpoint}.`,
  );
}
assert.doesNotMatch(
  publicMarketFeedContents,
  /(?:createOrder|cancelOrder|placeOrder|private\/|trade\/order)/i,
  'Direct exchange adapters must remain public-market-data-only.',
);
assert.ok(okxOptionsFeedContents, 'The read-only OKX options adapter must remain present.');
assert.ok(
  okxOptionsFeedContents.includes('www.okx.com/api/v5'),
  'OKX options access must stay on the documented public V5 REST API host.',
);
for (const route of approvedOkxOptionsRoutes) {
  assert.ok(okxOptionsFeedContents.includes(route), `OKX options adapter may use ${route}.`);
}
assert.doesNotMatch(
  okxOptionsFeedContents,
  /(?:new\s+WebSocket|method:\s*['"]POST|private\/|trade\/|account\/|order)/i,
  'OKX options access must remain public, read-only market data.',
);
assert.ok(binanceOptionsFeedContents, 'The read-only Binance European Options adapter must remain present.');
assert.ok(
  binanceOptionsFeedContents.includes('https://eapi.binance.com/eapi/v1'),
  'Binance options access must stay on the documented public European Options API.',
);
for (const route of approvedBinanceOptionsRoutes) {
  assert.ok(binanceOptionsFeedContents.includes(route), `Binance options adapter may use ${route}.`);
}
assert.doesNotMatch(
  binanceOptionsFeedContents,
  /(?:method:\s*['"]POST|private\/|\/order(?:\/|\b)|listenKey)/i,
  'Binance options access must remain public, read-only market data.',
);
assert.ok(bybitOptionsFeedContents, 'The read-only Bybit options adapter must remain present.');
assert.ok(
  bybitOptionsFeedContents.includes('https://api.bybit.com/v5/market'),
  'Bybit options access must stay on the documented public V5 market API.',
);
for (const route of approvedBybitOptionsRoutes) {
  assert.ok(bybitOptionsFeedContents.includes(route), `Bybit options adapter may use ${route}.`);
}
assert.doesNotMatch(
  bybitOptionsFeedContents,
  /(?:method:\s*['"]POST|private\/|createOrder|cancelOrder|placeOrder)/i,
  'Bybit options access must remain public, read-only market data.',
);
assert.ok(sourceRegistryContents, 'The council source inventory must remain present.');
assert.doesNotMatch(
  sourceRegistryContents,
  /(?:fetch\s*\(|new\s+WebSocket|createOrder|cancelOrder|placeOrder)/i,
  'The source registry must remain descriptive metadata, not an exchange connector.',
);

if (findings.length > 0) {
  console.error('Direct-exchange references found:');
  findings.forEach((finding) => console.error(`  ${finding}`));
  assert.fail(`${findings.length} forbidden direct-exchange reference(s) found.`);
}

console.log('Direct exchange access is limited to read-only public market data from the approved venues.');
