export type CouncilSourceGroup =
  | 'trend'
  | 'tradeflow'
  | 'onchain'
  | 'macro'
  | 'news'
  | 'derivatives'
  | 'options'
  | 'orderbook';

export type CouncilSourceHealth =
  | 'LIVE'
  | 'STALE'
  | 'UNAVAILABLE'
  | 'REGION_RESTRICTED'
  | 'DISABLED'
  | 'UNOBSERVED';

export interface CouncilSourceObservation {
  responseTimestampMs: number | null;
  receivedAtMs: number | null;
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'REGION_RESTRICTED';
  url?: string;
  symbol?: string;
  error?: string;
}

export interface CouncilSourceRegistryEntry {
  id: string;
  group: CouncilSourceGroup;
  provider: string;
  url: string;
  dataType: string;
  symbol: string;
  cadence: 'realtime' | 'daily' | 'periodic' | 'event-driven';
  realtimeEligible: boolean;
  enabled: boolean;
  responseTimestampMs: number | null;
  receivedAtMs: number | null;
  maxAgeMs: number;
  health: CouncilSourceHealth;
  reason: string | null;
  priority?: number;
  fallbackGroup?: string;
  memberIds?: readonly number[];
  assets?: readonly string[];
  apiKeyRequired?: boolean;
  memberSource?: boolean;
  additionalHealthUrls?: readonly string[];
}

export interface CouncilSourceDefinition extends Omit<
  CouncilSourceRegistryEntry,
  'responseTimestampMs' | 'receivedAtMs' | 'health' | 'reason'
> {
  disabledReason?: string;
}

export const COUNCIL_MEMBER_SOURCES: readonly CouncilSourceDefinition[] = [
  { id: 'council.member1.coinbase-candles', group: 'trend', provider: 'Coinbase Exchange', url: 'https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=3600', dataType: 'hourly ETH-USD OHLCV candles', symbol: 'ETH-USD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 65_000, priority: 1, fallbackGroup: 'council.member1.trend', memberIds: [1], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member1.kraken-ohlc', group: 'trend', provider: 'Kraken', url: 'https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=60', dataType: 'hourly ETH/USD OHLCV candles', symbol: 'ETHUSD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 65_000, priority: 2, fallbackGroup: 'council.member1.trend', memberIds: [1], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member1.okx-candles', group: 'trend', provider: 'OKX V5', url: 'https://www.okx.com/api/v5/market/candles?instId=ETH-USDT&bar=1H', dataType: 'hourly ETH-USDT OHLCV candles', symbol: 'ETH-USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 65_000, priority: 3, fallbackGroup: 'council.member1.trend', memberIds: [1], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member1.bitstamp-ohlc', group: 'trend', provider: 'Bitstamp', url: 'https://www.bitstamp.net/api/v2/ohlc/ethusd/?step=3600&limit=2', dataType: 'hourly ETH/USD OHLCV candles', symbol: 'ETH/USD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 65_000, priority: 4, fallbackGroup: 'council.member1.trend', memberIds: [1], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member2.coinbase-trades', group: 'tradeflow', provider: 'Coinbase Exchange', url: 'https://api.exchange.coinbase.com/products/ETH-USD/trades?limit=100', dataType: 'executed ETH-USD trades and aggressor side; 5-minute CVD; at least 5 classified trades', symbol: 'ETH-USD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 1, fallbackGroup: 'council.member2.trades', memberIds: [2], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member2.kraken-trades', group: 'tradeflow', provider: 'Kraken', url: 'https://api.kraken.com/0/public/Trades?pair=ETHUSD&count=100', dataType: 'executed ETH/USD trades and aggressor side; 5-minute CVD; at least 5 classified trades', symbol: 'ETHUSD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 2, fallbackGroup: 'council.member2.trades', memberIds: [2], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member2.okx-trades', group: 'tradeflow', provider: 'OKX V5', url: 'https://www.okx.com/api/v5/market/trades?instId=ETH-USDT&limit=100', dataType: 'executed ETH-USDT trades and aggressor side; 5-minute CVD; at least 5 classified trades', symbol: 'ETH-USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 3, fallbackGroup: 'council.member2.trades', memberIds: [2], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member2.bitfinex-trades', group: 'tradeflow', provider: 'Bitfinex public trades', url: 'https://api-pub.bitfinex.com/v2/trades/tETHUSD/hist?limit=100', dataType: 'executed ETH-USD trades with aggressor side encoded by amount sign; 5-minute CVD; at least 5 classified trades', symbol: 'tETHUSD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 4, fallbackGroup: 'council.member2.trades', memberIds: [2], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member3.coinbase-level2', group: 'orderbook', provider: 'Coinbase Exchange', url: 'https://api.exchange.coinbase.com/products/ETH-USD/book?level=2', dataType: 'ETH-USD level-2 order book', symbol: 'ETH-USD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 1, fallbackGroup: 'council.member3.book', memberIds: [3], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member3.kraken-depth', group: 'orderbook', provider: 'Kraken', url: 'https://api.kraken.com/0/public/Depth?pair=ETHUSD&count=10', dataType: 'ETH/USD market depth', symbol: 'ETHUSD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 2, fallbackGroup: 'council.member3.book', memberIds: [3], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member3.okx-books', group: 'orderbook', provider: 'OKX V5', url: 'https://www.okx.com/api/v5/market/books?instId=ETH-USDT&sz=20', dataType: 'ETH-USDT order-book depth', symbol: 'ETH-USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 3, fallbackGroup: 'council.member3.book', memberIds: [3], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member3.bitstamp-order-book', group: 'orderbook', provider: 'Bitstamp', url: 'https://www.bitstamp.net/api/v2/order_book/ethusd/', dataType: 'ETH/USD order-book depth', symbol: 'ETH/USD', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 4, fallbackGroup: 'council.member3.book', memberIds: [3], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member4.okx-derivatives', group: 'derivatives', provider: 'OKX V5', url: 'https://www.okx.com/api/v5/public/funding-rate?instId=ETH-USDT-SWAP', additionalHealthUrls: ['https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=ETH-USDT-SWAP'], dataType: 'ETH perpetual funding rate and open interest (separate public requests)', symbol: 'ETH-USDT-SWAP', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 1, fallbackGroup: 'council.member4.derivatives', memberIds: [4], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member4.deribit-perpetual', group: 'derivatives', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/ticker?instrument_name=ETH-PERPETUAL', dataType: 'ETH-PERPETUAL funding and open interest', symbol: 'ETH-PERPETUAL', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 2, fallbackGroup: 'council.member4.derivatives', memberIds: [4], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member4.hyperliquid', group: 'derivatives', provider: 'Hyperliquid', url: 'https://api.hyperliquid.xyz/info', dataType: 'ETH perpetual context and open interest', symbol: 'ETH', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 3, fallbackGroup: 'council.member4.derivatives', memberIds: [4], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member4.binance-fapi', group: 'derivatives', provider: 'Binance USD-M Futures', url: 'https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT', dataType: 'ETHUSDT perpetual open interest and funding; final fallback', symbol: 'ETHUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 4, fallbackGroup: 'council.member4.derivatives', memberIds: [4], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member5.deribit-options', group: 'options', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=option', dataType: 'ETH options book summary and DVOL', symbol: 'ETH options', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 1, fallbackGroup: 'council.member5.options', memberIds: [5], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member5.okx-opt-summary', group: 'options', provider: 'OKX V5', url: 'https://www.okx.com/api/v5/public/opt-summary?uly=ETH-USD', dataType: 'ETH option summary (live-tested public route)', symbol: 'ETH-USD options', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 2, fallbackGroup: 'council.member5.options', memberIds: [5], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member5.bybit-options', group: 'options', provider: 'Bybit V5', url: 'https://api.bybit.com/v5/market/tickers?category=option&baseCoin=ETH', dataType: 'ETH options market tickers', symbol: 'ETH options', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 3, fallbackGroup: 'council.member5.options', memberIds: [5], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member5.binance-eapi', group: 'options', provider: 'Binance European Options', url: 'https://eapi.binance.com/eapi/v1/mark', dataType: 'ETH option mark price and IV; timestamp is response-received time, not provider time; current put/call IV parity is non-directional', symbol: 'ETH options', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 4, fallbackGroup: 'council.member5.options', memberIds: [5], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member6.staking-deposits', group: 'onchain', provider: 'PublicNode Ethereum JSON-RPC', url: 'https://ethereum-rpc.publicnode.com/', dataType: 'Confirmed Ethereum staking-deposit contract DepositEvent logs over approximately 24 hours; public eth_getLogs, no key', symbol: 'ETH staking deposit flow', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 2, fallbackGroup: 'council.member6.onchain', memberIds: [6], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member6.defillama', group: 'onchain', provider: 'DefiLlama', url: 'https://stablecoins.llama.fi/stablecoincharts/Ethereum', dataType: 'Ethereum stablecoin circulating supply and seven-day change; heuristic, not conclusive', symbol: 'Ethereum stablecoins', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 48 * 60 * 60_000, priority: 1, fallbackGroup: 'council.member6.onchain', memberIds: [6], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member6.fee-history', group: 'onchain', provider: 'PublicNode Ethereum JSON-RPC', url: 'https://ethereum-rpc.publicnode.com/', dataType: 'Recent Ethereum feeHistory network activity; context, not a price-direction signal', symbol: 'ETH mainnet gas activity', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 3, fallbackGroup: 'council.member6.onchain', memberIds: [6], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member6.defillama-dex-volume', group: 'onchain', provider: 'DefiLlama public DEX volumes', url: 'https://api.llama.fi/overview/dexs/ethereum?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true', dataType: 'Daily Ethereum DEX volume and one/seven-day changes; free, no key; activity context, not a standalone direction signal', symbol: 'Ethereum DEX volume USD', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 48 * 60 * 60_000, priority: 4, fallbackGroup: 'council.member6.onchain', memberIds: [6], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member7.fred', group: 'macro', provider: 'FRED (public CSV; API key optional)', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10', additionalHealthUrls: ['https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL'], dataType: 'Daily DGS10, DTWEXBGS, SP500, VIXCLS and weekly WALCL; dated CSV observations', symbol: 'U.S. yields, broad dollar, equities, volatility and Fed balance sheet', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 7 * 24 * 60 * 60_000, priority: 1, fallbackGroup: 'council.member7.macro', memberIds: [7], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member7.cboe-vix', group: 'macro', provider: 'Cboe', url: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', dataType: 'Dated daily VIX OHLC and close; risk context', symbol: 'VIX', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 7 * 24 * 60 * 60_000, priority: 2, fallbackGroup: 'council.member7.macro', memberIds: [7], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member7.yahoo-chart', group: 'macro', provider: 'Yahoo Finance chart API (غیررسمی)', url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d', additionalHealthUrls: ['https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=5d&interval=1d'], dataType: 'Dated daily S&P 500 and U.S. dollar index observations; unofficial API', symbol: '^GSPC, DX-Y.NYB', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 7 * 24 * 60 * 60_000, priority: 3, fallbackGroup: 'council.member7.macro', memberIds: [7], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member7.fred-market-series', group: 'macro', provider: 'FRED public CSV (same provider as primary; not independent)', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500', additionalHealthUrls: ['https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS'], dataType: 'Daily dated S&P 500 and broad-dollar observations; duplicate provider family, not independent evidence', symbol: 'SP500, DTWEXBGS', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 7 * 24 * 60 * 60_000, priority: 4, fallbackGroup: 'council.member7.macro', memberIds: [7], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member8.decrypt', group: 'news', provider: 'Decrypt', url: 'https://decrypt.co/feed', dataType: 'ETH-filtered RSS headlines with publication timestamps', symbol: 'ETH', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000, priority: 1, fallbackGroup: 'council.member8.news', memberIds: [8], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member8.the-block', group: 'news', provider: 'The Block', url: 'https://www.theblock.co/rss.xml', dataType: 'ETH-filtered RSS headlines with publication timestamps', symbol: 'ETH', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000, priority: 2, fallbackGroup: 'council.member8.news', memberIds: [8], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member8.coindesk', group: 'news', provider: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', dataType: 'ETH-filtered CoinDesk RSS headlines with publication timestamps', symbol: 'ETH', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000, priority: 3, fallbackGroup: 'council.member8.news', memberIds: [8], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
  { id: 'council.member8.google-news', group: 'news', provider: 'Google News RSS aggregator (unofficial; publisher is read from each item)', url: 'https://news.google.com/rss/search?q=Ethereum&hl=en-US&gl=US&ceid=US:en', dataType: 'ETH/Ethereum/Ether-filtered RSS items; 24-hour window; Google aggregator is not counted as an independent publisher', symbol: 'Ethereum news', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 24 * 60 * 60_000, priority: 4, fallbackGroup: 'council.member8.news', memberIds: [8], assets: ['ETH'], apiKeyRequired: false, memberSource: true },
];

type MarketAsset = 'BTC' | 'SOL' | 'XRP' | 'BNB';

const ASSET_MARKETS: Record<MarketAsset, {
  coinbase: string;
  kraken: string;
  okx: string;
  bitstamp: string;
  binancePerpetual: string;
  bybitPerpetual: string;
  deribitPerpetual?: string;
}> = {
  BTC: { coinbase: 'BTC-USD', kraken: 'XBTUSD', okx: 'BTC-USDT', bitstamp: 'btcusd', binancePerpetual: 'BTCUSDT', bybitPerpetual: 'BTCUSDT', deribitPerpetual: 'BTC-PERPETUAL' },
  SOL: { coinbase: 'SOL-USD', kraken: 'SOLUSD', okx: 'SOL-USDT', bitstamp: 'solusd', binancePerpetual: 'SOLUSDT', bybitPerpetual: 'SOLUSDT' },
  XRP: { coinbase: 'XRP-USD', kraken: 'XRPUSD', okx: 'XRP-USDT', bitstamp: 'xrpusd', binancePerpetual: 'XRPUSDT', bybitPerpetual: 'XRPUSDT' },
  BNB: { coinbase: 'BNB-USD', kraken: 'BNBUSD', okx: 'BNB-USDT', bitstamp: 'bnbusd', binancePerpetual: 'BNBUSDT', bybitPerpetual: 'BNBUSDT' },
};

function makeAssetSource(
  asset: MarketAsset,
  memberId: number,
  priority: number,
  suffix: string,
  details: Pick<CouncilSourceDefinition, 'group' | 'provider' | 'url' | 'dataType' | 'symbol' | 'cadence' | 'realtimeEligible' | 'maxAgeMs' | 'additionalHealthUrls'>,
): CouncilSourceDefinition {
  return {
    ...details,
    id: `council.member${memberId}.${asset}.${suffix}`,
    enabled: true,
    priority,
    fallbackGroup: `council.member${memberId}.${asset}`,
    memberIds: [memberId],
    assets: [asset],
    apiKeyRequired: false,
    memberSource: true,
  };
}

function buildAssetMarketSources(asset: MarketAsset): CouncilSourceDefinition[] {
  const market = ASSET_MARKETS[asset];
  const sources: CouncilSourceDefinition[] = [];
  const add = (
    memberId: number,
    suffix: string,
    details: Parameters<typeof makeAssetSource>[4],
  ) => sources.push(makeAssetSource(asset, memberId, sources.filter(({ memberIds }) => memberIds?.[0] === memberId).length + 1, suffix, details));

  add(1, 'coinbase-candles', {
    group: 'trend', provider: 'Coinbase Exchange',
    url: `https://api.exchange.coinbase.com/products/${market.coinbase}/candles?granularity=3600`,
    dataType: `Hourly ${asset}/USD OHLCV candles`, symbol: market.coinbase,
    cadence: 'realtime', realtimeEligible: true, maxAgeMs: 65_000,
  });
  add(1, 'kraken-ohlc', {
    group: 'trend', provider: 'Kraken',
    url: `https://api.kraken.com/0/public/OHLC?pair=${market.kraken}&interval=60`,
    dataType: `Hourly ${asset}/USD OHLCV candles`, symbol: market.kraken,
    cadence: 'realtime', realtimeEligible: true, maxAgeMs: 65_000,
  });
  add(1, 'okx-candles', {
    group: 'trend', provider: 'OKX V5',
    url: `https://www.okx.com/api/v5/market/candles?instId=${market.okx}&bar=1H`,
    dataType: `Hourly ${asset}-USDT OHLCV candles`, symbol: market.okx,
    cadence: 'realtime', realtimeEligible: true, maxAgeMs: 65_000,
  });
  add(1, 'bitstamp-ohlc', {
    group: 'trend', provider: 'Bitstamp',
    url: `https://www.bitstamp.net/api/v2/ohlc/${market.bitstamp}/?step=3600&limit=2`,
    dataType: `Hourly ${asset}/USD OHLCV candles`, symbol: market.bitstamp,
    cadence: 'realtime', realtimeEligible: true, maxAgeMs: 65_000,
  });

  add(2, 'coinbase-trades', {
    group: 'tradeflow', provider: 'Coinbase Exchange',
    url: `https://api.exchange.coinbase.com/products/${market.coinbase}/trades?limit=100`,
    dataType: `Executed ${asset}/USD trades and aggressor side; five-minute CVD`,
    symbol: market.coinbase, cadence: 'realtime', realtimeEligible: true, maxAgeMs: 60_000,
  });
  add(2, 'kraken-trades', {
    group: 'tradeflow', provider: 'Kraken',
    url: `https://api.kraken.com/0/public/Trades?pair=${market.kraken}`,
    dataType: `Executed ${asset}/USD trades and aggressor side; five-minute CVD`,
    symbol: market.kraken, cadence: 'realtime', realtimeEligible: true, maxAgeMs: 60_000,
  });
  add(2, 'okx-trades', {
    group: 'tradeflow', provider: 'OKX V5',
    url: `https://www.okx.com/api/v5/market/trades?instId=${market.okx}&limit=100`,
    dataType: `Executed ${asset}-USDT trades and aggressor side; five-minute CVD`,
    symbol: market.okx, cadence: 'realtime', realtimeEligible: true, maxAgeMs: 60_000,
  });
  add(2, 'bitstamp-transactions', {
    group: 'tradeflow', provider: 'Bitstamp',
    url: `https://www.bitstamp.net/api/v2/transactions/${market.bitstamp}/?time=hour`,
    dataType: `Executed ${asset}/USD transactions; aggressor side is not exposed and this source is not CVD-directional`,
    symbol: market.bitstamp, cadence: 'realtime', realtimeEligible: true, maxAgeMs: 60_000,
  });

  add(3, 'coinbase-level2', {
    group: 'orderbook', provider: 'Coinbase Exchange',
    url: `https://api.exchange.coinbase.com/products/${market.coinbase}/book?level=2`,
    dataType: `${asset}/USD level-2 order book`, symbol: market.coinbase,
    cadence: 'realtime', realtimeEligible: true, maxAgeMs: 5_000,
  });
  add(3, 'kraken-depth', {
    group: 'orderbook', provider: 'Kraken',
    url: `https://api.kraken.com/0/public/Depth?pair=${market.kraken}&count=10`,
    dataType: `${asset}/USD market depth`, symbol: market.kraken,
    cadence: 'realtime', realtimeEligible: true, maxAgeMs: 5_000,
  });
  add(3, 'okx-books', {
    group: 'orderbook', provider: 'OKX V5',
    url: `https://www.okx.com/api/v5/market/books?instId=${market.okx}&sz=20`,
    dataType: `${asset}-USDT order-book depth`, symbol: market.okx,
    cadence: 'realtime', realtimeEligible: true, maxAgeMs: 5_000,
  });
  add(3, 'bitstamp-order-book', {
    group: 'orderbook', provider: 'Bitstamp',
    url: `https://www.bitstamp.net/api/v2/order_book/${market.bitstamp}/`,
    dataType: `${asset}/USD order-book depth`, symbol: market.bitstamp,
    cadence: 'realtime', realtimeEligible: true, maxAgeMs: 5_000,
  });

  const derivativeSources = [
    {
      suffix: 'okx-derivatives',
      group: 'derivatives' as const,
      provider: 'OKX V5',
      url: `https://www.okx.com/api/v5/public/funding-rate?instId=${market.okx}-SWAP`,
      additionalHealthUrls: [`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${market.okx}-SWAP`],
      dataType: `${asset} perpetual funding rate and open interest`,
      symbol: `${market.okx}-SWAP`,
    },
    market.deribitPerpetual
      ? {
          suffix: 'deribit-perpetual',
          group: 'derivatives' as const,
          provider: 'Deribit',
          url: `https://www.deribit.com/api/v2/public/ticker?instrument_name=${market.deribitPerpetual}`,
          dataType: `${market.deribitPerpetual} funding and open interest`,
          symbol: market.deribitPerpetual,
        }
      : {
          suffix: 'bybit-funding',
          group: 'derivatives' as const,
          provider: 'Bybit V5',
          url: `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${market.bybitPerpetual}&limit=1`,
          additionalHealthUrls: [`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${market.bybitPerpetual}&intervalTime=5min`],
          dataType: `${asset} perpetual funding and open interest`,
          symbol: market.bybitPerpetual,
        },
    {
      suffix: 'hyperliquid',
      group: 'derivatives' as const,
      provider: 'Hyperliquid',
      url: 'https://api.hyperliquid.xyz/info',
      dataType: `${asset} perpetual context and open interest`,
      symbol: asset,
    },
    {
      suffix: 'binance-fapi',
      group: 'derivatives' as const,
      provider: 'Binance USD-M Futures',
      url: `https://fapi.binance.com/fapi/v1/openInterest?symbol=${market.binancePerpetual}`,
      additionalHealthUrls: [`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${market.binancePerpetual}`],
      dataType: `${asset} perpetual open interest and funding`,
      symbol: market.binancePerpetual,
    },
  ];
  derivativeSources.forEach(({ suffix, ...details }) => add(4, suffix, {
    ...details,
    cadence: 'realtime',
    realtimeEligible: true,
    maxAgeMs: 60_000,
  }));
  return sources;
}

const ASSET_SPECIFIC_MEMBER_SOURCES = (Object.keys(ASSET_MARKETS) as MarketAsset[])
  .flatMap(buildAssetMarketSources);

function buildAssetOptionsSources(): CouncilSourceDefinition[] {
  const providers: Readonly<Record<MarketAsset, readonly {
    suffix: 'deribit-options' | 'okx-opt-summary' | 'bybit-options' | 'binance-eapi';
    provider: string;
    url: string;
    dataType: string;
  }[]>> = {
    BTC: [
      { suffix: 'deribit-options', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option', dataType: 'BTC options open-interest and IV summary; timestamped contracts' },
      { suffix: 'okx-opt-summary', provider: 'OKX V5', url: 'https://www.okx.com/api/v5/public/opt-summary?uly=BTC-USD', dataType: 'BTC options put/call IV by contract; provider timestamped' },
      { suffix: 'bybit-options', provider: 'Bybit V5', url: 'https://api.bybit.com/v5/market/tickers?category=option&baseCoin=BTC', dataType: 'BTC options market tickers with mark IV and open interest' },
      { suffix: 'binance-eapi', provider: 'Binance European Options', url: 'https://eapi.binance.com/eapi/v1/mark', dataType: 'BTC option mark price and IV; timestamp is response-received time, not provider time' },
    ],
    SOL: [
      { suffix: 'okx-opt-summary', provider: 'OKX V5', url: 'https://www.okx.com/api/v5/public/opt-summary?uly=SOL-USD', dataType: 'SOL options put/call IV by contract; provider timestamped' },
      { suffix: 'bybit-options', provider: 'Bybit V5', url: 'https://api.bybit.com/v5/market/tickers?category=option&baseCoin=SOL', dataType: 'SOL options market tickers with mark IV and open interest' },
      { suffix: 'binance-eapi', provider: 'Binance European Options', url: 'https://eapi.binance.com/eapi/v1/mark', dataType: 'SOL option mark price and IV; timestamp is response-received time, not provider time' },
    ],
    XRP: [
      { suffix: 'bybit-options', provider: 'Bybit V5', url: 'https://api.bybit.com/v5/market/tickers?category=option&baseCoin=XRP', dataType: 'XRP options market tickers with mark IV and open interest' },
      { suffix: 'binance-eapi', provider: 'Binance European Options', url: 'https://eapi.binance.com/eapi/v1/mark', dataType: 'XRP option mark price and IV; timestamp is response-received time, not provider time' },
    ],
    BNB: [
      { suffix: 'binance-eapi', provider: 'Binance European Options', url: 'https://eapi.binance.com/eapi/v1/mark', dataType: 'BNB option mark price and IV; timestamp is response-received time, not provider time' },
    ],
  };
  return (Object.keys(providers) as MarketAsset[]).flatMap((asset) =>
    providers[asset].map((provider, index) => makeAssetSource(
      asset,
      5,
      index + 1,
      provider.suffix,
      {
        group: 'options',
        provider: provider.provider,
        url: provider.url,
        dataType: provider.dataType,
        symbol: asset,
        cadence: 'realtime',
        realtimeEligible: true,
        maxAgeMs: 60_000,
      },
    ))
  );
}

const ASSET_SPECIFIC_OPTIONS_SOURCES = buildAssetOptionsSources();

function buildAssetNewsSources(): CouncilSourceDefinition[] {
  const googleNewsQueries: Readonly<Record<MarketAsset, string>> = {
    BTC: 'Bitcoin',
    SOL: 'Solana',
    XRP: 'XRP',
    BNB: 'BNB',
  };
  return (Object.keys(googleNewsQueries) as MarketAsset[]).flatMap((asset) => {
    const providers = [
      { suffix: 'decrypt', provider: 'Decrypt', url: 'https://decrypt.co/feed', dataType: `${asset}-filtered Decrypt RSS; keyword match in title, description, or category` },
      { suffix: 'the-block', provider: 'The Block', url: 'https://www.theblock.co/rss.xml', dataType: `${asset}-filtered The Block RSS; keyword match in title, description, or category` },
      { suffix: 'coindesk', provider: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', dataType: `${asset}-filtered CoinDesk RSS; keyword match in title, description, or category` },
      {
        suffix: 'google-news',
        provider: 'Google News RSS aggregator (unofficial; publisher is read from each item)',
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(googleNewsQueries[asset])}&hl=en-US&gl=US&ceid=US:en`,
        dataType: `${asset}-filtered Google News RSS; aggregator, not an independent publisher`,
      },
    ] as const;
    return providers.map((provider, index) => makeAssetSource(
      asset,
      8,
      index + 1,
      provider.suffix,
      {
        group: 'news',
        provider: provider.provider,
        url: provider.url,
        dataType: provider.dataType,
        symbol: asset,
        cadence: 'event-driven',
        realtimeEligible: true,
        maxAgeMs: 24 * 60 * 60_000,
      },
    ));
  });
}

const ASSET_SPECIFIC_NEWS_SOURCES = buildAssetNewsSources();

export function getCouncilMemberSources(memberId: number, asset = 'ETH'): CouncilSourceDefinition[] {
  const selectedDefinitions = asset === 'ETH'
    ? COUNCIL_MEMBER_SOURCES
    : [
        ...ASSET_SPECIFIC_MEMBER_SOURCES,
        ...ASSET_SPECIFIC_OPTIONS_SOURCES,
        ...ASSET_SPECIFIC_NEWS_SOURCES,
        ...(memberId === 7
          ? COUNCIL_MEMBER_SOURCES
            .filter((source) => source.memberIds?.includes(7))
            .map((source) => ({
              ...source,
              dataType: `shared macro; not asset-specific. ${source.dataType}`,
              assets: [asset],
            }))
          : []),
        ...definitions.filter((source) =>
          source.group === 'onchain' &&
          source.memberIds?.includes(memberId) &&
          source.assets?.includes(asset)
        ),
      ].filter((source) => source.assets?.includes(asset));
  return selectedDefinitions
    .filter((source) => source.memberSource !== false && source.memberIds?.includes(memberId))
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
}

const definitions: readonly CouncilSourceDefinition[] = [
  { id: 'council.member7.stooq', group: 'macro', provider: 'Stooq', url: 'https://stooq.com/q/d/l/?s=usd_i&i=d', dataType: 'USD index daily CSV; live-tested HTTP 403; excluded from voting sources', symbol: 'usd_i', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 7 * 24 * 60 * 60_000, memberIds: [7], assets: ['ETH'], apiKeyRequired: false },
  { id: 'onchain.mempool-blocks', group: 'onchain', provider: 'mempool.space', url: 'https://mempool.space/api/v1/blocks', dataType: 'confirmed Bitcoin block sample', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 20 * 60_000, priority: 1, fallbackGroup: 'onchain.btc', memberIds: [6], assets: ['BTC'], apiKeyRequired: false },
  { id: 'onchain.mempool-transactions', group: 'onchain', provider: 'mempool.space', url: 'https://mempool.space/api/block/{hash}/txs', dataType: 'confirmed Bitcoin transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 20 * 60_000 },
  { id: 'onchain.blockstream-blocks', group: 'onchain', provider: 'Blockstream Esplora', url: 'https://blockstream.info/api/blocks', dataType: 'confirmed Bitcoin block sample', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 20 * 60_000, priority: 2, fallbackGroup: 'onchain.btc', memberIds: [6], assets: ['BTC'], apiKeyRequired: false },
  { id: 'onchain.blockstream-transactions', group: 'onchain', provider: 'Blockstream Esplora', url: 'https://blockstream.info/api/block/{hash}/txs', dataType: 'confirmed Bitcoin transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 20 * 60_000 },
  { id: 'onchain.mempool-ninja', group: 'onchain', provider: 'mempool.ninja', url: 'https://mempool.ninja/api/mempool/recent', dataType: 'recent Bitcoin mempool transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: mirror schema, freshness, and operational ownership have not been verified.' },
  { id: 'onchain.mempool-emzy', group: 'onchain', provider: 'mempool.emzy.de', url: 'https://mempool.emzy.de/api/mempool/recent', dataType: 'recent Bitcoin mempool transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: mirror schema, freshness, and operational ownership have not been verified.' },
  { id: 'onchain.blockchain-info-latest-block', group: 'onchain', provider: 'Blockchain.com', url: 'https://blockchain.info/latestblock', dataType: 'latest Bitcoin block', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: not used; published OpenAPI review did not verify a free compatible block/transaction route.' },
  { id: 'onchain.blockchain-info-unconfirmed', group: 'onchain', provider: 'Blockchain.com', url: 'https://blockchain.info/unconfirmed-transactions?format=json', dataType: 'unconfirmed Bitcoin transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint contract and transaction coverage have not been independently verified.' },
  { id: 'onchain.blockchain-info-stats', group: 'onchain', provider: 'Blockchain.com', url: 'https://api.blockchain.info/stats', dataType: 'Bitcoin network statistics', symbol: 'BTC', cadence: 'periodic', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint contract and timestamp semantics have not been independently verified.' },
  { id: 'onchain.blockchair-stats', group: 'onchain', provider: 'Blockchair', url: 'https://api.blockchair.com/bitcoin/stats', dataType: 'Bitcoin network statistics', symbol: 'BTC', cadence: 'periodic', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint schema, service limits, and timestamp semantics have not been verified.' },
  { id: 'onchain.blockchair-mempool', group: 'onchain', provider: 'Blockchair', url: 'https://api.blockchair.com/bitcoin/mempool', dataType: 'Bitcoin mempool statistics', symbol: 'BTC', cadence: 'periodic', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint schema, service limits, and timestamp semantics have not been verified.' },
  { id: 'onchain.btcscan-mempool', group: 'onchain', provider: 'BTCscan', url: 'https://btcscan.org/api/mempool/recent', dataType: 'recent Bitcoin mempool transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint schema and operational availability have not been verified.' },
  { id: 'onchain.coinmetrics-active-addresses', group: 'onchain', provider: 'Coin Metrics Community API', url: 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=AdrActCnt&limit_per_asset=1&pretty=false', dataType: 'daily active addresses; network activity, not whale flow', symbol: 'BTC', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 3 * 24 * 60 * 60_000 },
  { id: 'onchain.ethereum-public-rpc', group: 'onchain', provider: 'PublicNode Ethereum', url: 'https://ethereum-rpc.publicnode.com/', dataType: 'sampled confirmed native-ETH transfers to configured watchlist; no key', symbol: 'ETH/mainnet chainid=1', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 1, fallbackGroup: 'onchain.eth', memberIds: [6], assets: ['ETH'], apiKeyRequired: false },
  { id: 'onchain.ethereum-1rpc', group: 'onchain', provider: '1RPC Ethereum', url: 'https://1rpc.io/eth', dataType: 'sampled confirmed native-ETH transfers to configured watchlist; no key', symbol: 'ETH/mainnet chainid=1', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 2, fallbackGroup: 'onchain.eth', memberIds: [6], assets: ['ETH'], apiKeyRequired: false },
  { id: 'onchain.etherscan-transfers', group: 'onchain', provider: 'Etherscan V2 (optional)', url: 'https://api.etherscan.io/v2/api?chainid=1', dataType: 'configured-address native ETH and ERC-20 transfer watchlist; API key', symbol: 'ETH/mainnet', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, memberIds: [6], assets: ['ETH'], apiKeyRequired: true },
  { id: 'onchain.solana-public-rpc', group: 'onchain', provider: 'Solana mainnet-beta public RPC', url: 'https://api.mainnet-beta.solana.com/', dataType: 'sampled finalized native-SOL transfers to configured watchlist; no key, public RPC limits apply', symbol: 'SOL/mainnet', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 1, fallbackGroup: 'onchain.sol', memberIds: [6], assets: ['SOL'], apiKeyRequired: false },
  { id: 'onchain.solana-publicnode', group: 'onchain', provider: 'PublicNode Solana', url: 'https://solana-rpc.publicnode.com/', dataType: 'sampled finalized native-SOL transfers to configured watchlist; no key, public RPC limits apply', symbol: 'SOL/mainnet', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 2, fallbackGroup: 'onchain.sol', memberIds: [6], assets: ['SOL'], apiKeyRequired: false },
  { id: 'onchain.helius-solana', group: 'onchain', provider: 'Helius (optional)', url: 'https://mainnet.helius-rpc.com/', dataType: 'finalized native-SOL transfers to configured watchlist; API key', symbol: 'SOL/mainnet', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 3, fallbackGroup: 'onchain.sol', memberIds: [6], assets: ['SOL'], apiKeyRequired: true },
  { id: 'onchain.xrpscan-xrp', group: 'onchain', provider: 'XRPSCAN', url: 'https://api.xrpscan.com/api/v1/account/{address}/transactions', dataType: 'validated native-XRP payments to configured CEX wallets', symbol: 'XRP/XRPL', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 1, fallbackGroup: 'onchain.xrp', memberIds: [6], assets: ['XRP'], apiKeyRequired: false },
  { id: 'onchain.bsc-public-rpc', group: 'onchain', provider: 'Binance BSC public RPC', url: 'https://bsc-dataseed.binance.org/', dataType: 'sampled confirmed native-BNB transfers to configured watchlist; no key', symbol: 'BNB/BSC chainid=56', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 1, fallbackGroup: 'onchain.bnb', memberIds: [6], assets: ['BNB'], apiKeyRequired: false },
  { id: 'onchain.bsc-publicnode', group: 'onchain', provider: 'PublicNode BSC', url: 'https://bsc-rpc.publicnode.com/', dataType: 'sampled confirmed native-BNB transfers to configured watchlist; no key', symbol: 'BNB/BSC chainid=56', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 2, fallbackGroup: 'onchain.bnb', memberIds: [6], assets: ['BNB'], apiKeyRequired: false },
  { id: 'onchain.bscscan-bnb', group: 'onchain', provider: 'Etherscan V2 BSC (optional)', url: 'https://api.etherscan.io/v2/api?chainid=56', dataType: 'confirmed native-BNB transfers to configured CEX wallets; API key', symbol: 'BNB/BNB Smart Chain', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 3, fallbackGroup: 'onchain.bnb', memberIds: [6], assets: ['BNB'], apiKeyRequired: true },
  { id: 'onchain.whale-alert', group: 'onchain', provider: 'Whale Alert', url: 'https://api.whale-alert.io/v1/transactions', dataType: 'large crypto transfers', symbol: 'multi-asset', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000 },

  { id: 'macro.fred-sp500', group: 'macro', provider: 'FRED', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500', dataType: 'daily closing index value', symbol: 'SP500', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 14 * 24 * 60 * 60_000 },
  { id: 'macro.fred-broad-dollar', group: 'macro', provider: 'FRED', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS', dataType: 'broad-dollar-index (Federal Reserve trade-weighted dollar index; not ICE DXY)', symbol: 'DTWEXBGS', cadence: 'periodic', realtimeEligible: false, enabled: true, maxAgeMs: 14 * 24 * 60 * 60_000 },
  { id: 'macro.fred-effective-rate', group: 'macro', provider: 'FRED', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF', dataType: 'federal funds effective rate', symbol: 'DFF', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 14 * 24 * 60 * 60_000 },
  { id: 'macro.fred-target-upper', group: 'macro', provider: 'FRED', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU', dataType: 'federal funds target range upper bound', symbol: 'DFEDTARU', cadence: 'periodic', realtimeEligible: false, enabled: true, maxAgeMs: 14 * 24 * 60 * 60_000 },
  { id: 'macro.massive-dxy', group: 'macro', provider: 'Massive Indices Snapshot', url: 'https://api.massive.com/v3/snapshot/indices?ticker=I%3ADXY', dataType: 'ICE U.S. Dollar Index', symbol: 'I:DXY', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 2 * 60_000 },
  { id: 'macro.yahoo-dxy', group: 'macro', provider: 'Yahoo Finance chart', url: 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB', dataType: 'ICE U.S. Dollar Index reference quote (last close may be used when session is closed)', symbol: 'DX-Y.NYB', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 7 * 24 * 60 * 60_000 },
  { id: 'macro.tradingview-dxy-proxy', group: 'macro', provider: 'TradingView Scanner', url: 'https://scanner.tradingview.com/america/scan', dataType: 'CFD proxy; not official ICE DXY; retrieval timestamp only', symbol: 'TVC:DXY', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000 },
  { id: 'macro.yahoo-sp500', group: 'macro', provider: 'Yahoo Finance chart', url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC', dataType: 'S&P 500 index quote', symbol: '^GSPC', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 14 * 24 * 60 * 60_000 },
  { id: 'macro.nyfed-effr', group: 'macro', provider: 'Federal Reserve Bank of New York', url: 'https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json', dataType: 'effective federal funds rate', symbol: 'EFFR', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 14 * 24 * 60 * 60_000 },
  { id: 'macro.stooq-dxy', group: 'macro', provider: 'Stooq', url: 'https://stooq.com/q/l/?s=usd_i&f=sd2t2ohlcv&e=csv', dataType: 'unverified dollar index quote', symbol: 'usd_i', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 2 * 60_000, disabledReason: 'Disabled: observed anti-bot HTML instead of the expected CSV schema; not integrated.' },
  { id: 'macro.stooq-eurusd', group: 'macro', provider: 'Stooq', url: 'https://stooq.com/q/l/?s=eurusd&f=sd2t2ohlcv&e=csv', dataType: 'EUR/USD quote; not an official DXY value', symbol: 'EURUSD', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 2 * 60_000, disabledReason: 'Disabled: Stooq returned an anti-bot response; this correlated pair is not a substitute for DXY.' },
  { id: 'macro.stooq-xauusd', group: 'macro', provider: 'Stooq', url: 'https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&e=csv', dataType: 'gold reference quote', symbol: 'XAUUSD', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 2 * 60_000, disabledReason: 'Disabled: observed anti-bot response; schema and freshness have not been verified.' },
  { id: 'macro.stooq-sp500', group: 'macro', provider: 'Stooq', url: 'https://stooq.com/q/l/?s=%5Espx&f=sd2t2ohlcv&e=csv', dataType: 'S&P 500 quote', symbol: '^SPX', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 2 * 60_000, disabledReason: 'Disabled: observed anti-bot response; schema and freshness have not been verified.' },
  { id: 'macro.fred-us10y', group: 'macro', provider: 'FRED', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10', dataType: 'daily U.S. 10-year Treasury yield', symbol: 'DGS10', cadence: 'daily', realtimeEligible: false, enabled: false, maxAgeMs: 14 * 24 * 60 * 60_000, disabledReason: 'Disabled: daily macro context only; not connected to real-time voting.' },
  { id: 'macro.fred-m2', group: 'macro', provider: 'FRED', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=WM2NS', dataType: 'weekly U.S. M2 money stock', symbol: 'WM2NS', cadence: 'periodic', realtimeEligible: false, enabled: false, maxAgeMs: 14 * 24 * 60 * 60_000, disabledReason: 'Disabled: low-frequency macro context only; not connected to real-time voting.' },
  { id: 'macro.ecb-eur-reference', group: 'macro', provider: 'European Central Bank', url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', dataType: 'daily EUR reference rates; not DXY', symbol: 'EUR/USD', cadence: 'daily', realtimeEligible: false, enabled: false, maxAgeMs: 14 * 24 * 60 * 60_000, disabledReason: 'Disabled for real-time voting: daily reference rates are not intraday market quotes.' },
  { id: 'macro.tradingview-chart-websocket', group: 'macro', provider: 'TradingView chart websocket', url: 'wss://data.tradingview.com/socket.io/websocket', dataType: 'undocumented chart stream', symbol: 'TVC:DXY', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 5_000, disabledReason: 'Disabled: undocumented public websocket is not a supported data API.' },

  { id: 'news.coindesk', group: 'news', provider: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', dataType: 'RSS headlines', symbol: 'BTC/crypto', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.cointelegraph', group: 'news', provider: 'Cointelegraph', url: 'https://cointelegraph.com/rss', dataType: 'RSS headlines', symbol: 'BTC/crypto', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.cointelegraph-bitcoin', group: 'news', provider: 'Cointelegraph', url: 'https://cointelegraph.com/rss/tag/bitcoin', dataType: 'Bitcoin-tagged RSS headlines', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 6 * 60 * 60_000, disabledReason: 'Disabled: the general Cointelegraph RSS is already configured; this alternate feed is not independently verified.' },
  { id: 'news.federal-reserve', group: 'news', provider: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', dataType: 'RSS policy releases', symbol: 'macro', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.sec', group: 'news', provider: 'U.S. Securities and Exchange Commission', url: 'https://www.sec.gov/news/pressreleases.rss', dataType: 'RSS digital-asset releases', symbol: 'BTC/crypto', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.decrypt', group: 'news', provider: 'Decrypt', url: 'https://decrypt.co/feed', dataType: 'RSS headlines', symbol: 'BTC/crypto', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.the-block', group: 'news', provider: 'The Block', url: 'https://www.theblock.co/rss.xml', dataType: 'RSS headlines', symbol: 'BTC/crypto', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.bitcoin-magazine', group: 'news', provider: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/', dataType: 'RSS headlines', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.cnbc', group: 'news', provider: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', dataType: 'RSS market headlines', symbol: 'BTC/macro', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.wsj', group: 'news', provider: 'The Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', dataType: 'RSS market headlines', symbol: 'BTC/macro', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.guardian', group: 'news', provider: 'The Guardian', url: 'https://www.theguardian.com/uk/business/rss', dataType: 'RSS market headlines', symbol: 'BTC/macro', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.bitcoin-core', group: 'news', provider: 'Bitcoin Core', url: 'https://bitcoincore.org/en/rss.xml', dataType: 'official Bitcoin Core RSS', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.ethereum-foundation', group: 'news', provider: 'Ethereum Foundation', url: 'https://blog.ethereum.org/feed.xml', dataType: 'official Ethereum Foundation RSS', symbol: 'ETH', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.solana', group: 'news', provider: 'Solana', url: 'https://solana.com/news/rss.xml', dataType: 'official Solana RSS', symbol: 'SOL', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.solana-status', group: 'news', provider: 'Solana Status', url: 'https://status.solana.com/history.rss', dataType: 'official Solana operational incidents', symbol: 'SOL', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.u-today', group: 'news', provider: 'U.Today', url: 'https://u.today/rss', dataType: 'asset-keyword-filtered crypto RSS headlines', symbol: 'BTC/ETH/SOL/XRP/BNB', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.cryptonews', group: 'news', provider: 'Cryptonews', url: 'https://cryptonews.com/news/feed/', dataType: 'asset-keyword-filtered crypto RSS headlines', symbol: 'BTC/ETH/SOL/XRP/BNB', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 6 * 60 * 60_000 },
  { id: 'news.ripple-insights', group: 'news', provider: 'Ripple Insights', url: 'https://ripple.com/insights/feed/', dataType: 'proposed official Ripple Insights RSS', symbol: 'XRP', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 6 * 60 * 60_000, disabledReason: 'Disabled for voting: the requested endpoint returned HTTP 404; no substitute feed is assumed.' },
  { id: 'news.bnb-chain-blog', group: 'news', provider: 'BNB Chain Blog', url: 'https://www.bnbchain.org/en/blog/rss.xml', dataType: 'proposed official BNB Chain RSS', symbol: 'BNB', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 6 * 60 * 60_000, disabledReason: 'Disabled for voting: the requested endpoint returned HTML, not an RSS/XML feed.' },
  { id: 'news.cryptopanic', group: 'news', provider: 'CryptoPanic', url: 'https://cryptopanic.com/news/rss/', dataType: 'RSS headlines', symbol: 'BTC/crypto', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 6 * 60 * 60_000, disabledReason: 'Disabled: the endpoint returned HTTP 410 (Gone); excluded from fallback and voting.' },
  { id: 'news.cryptopanic-media', group: 'news', provider: 'CryptoPanic', url: 'https://cryptopanic.com/news/rss/media/', dataType: 'RSS media headlines', symbol: 'BTC/crypto', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 6 * 60 * 60_000, disabledReason: 'Disabled: CryptoPanic RSS is unavailable (HTTP 410 on the proposed feed); not included in fallback.' },
  { id: 'news.alternative-fng', group: 'news', provider: 'Alternative.me', url: 'https://api.alternative.me/fng/?limit=2', dataType: 'daily Fear & Greed vendor index', symbol: 'BTC sentiment', cadence: 'daily', realtimeEligible: false, enabled: false, maxAgeMs: 24 * 60 * 60_000, disabledReason: 'Disabled from real-time news voting: daily vendor index is not a live news feed.' },

  { id: 'derivatives.binance-funding', group: 'derivatives', provider: 'Binance USD-M Futures', url: 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', dataType: 'funding rate', symbol: 'BTCUSDT', cadence: 'periodic', realtimeEligible: true, enabled: true, maxAgeMs: 60_000 },
  { id: 'derivatives.binance-open-interest-history', group: 'derivatives', provider: 'Binance USD-M Futures', url: 'https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=2', dataType: 'open interest history', symbol: 'BTCUSDT', cadence: 'periodic', realtimeEligible: true, enabled: true, maxAgeMs: 10 * 60_000 },
  { id: 'derivatives.binance-open-interest-live', group: 'derivatives', provider: 'Binance USD-M Futures', url: 'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', dataType: 'current open interest', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 10_000 },
  { id: 'derivatives.bybit-funding', group: 'derivatives', provider: 'Bybit', url: 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', dataType: 'linear perpetual funding and ticker', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: response normalization and independent schema/freshness verification are not implemented.' },
  { id: 'derivatives.bybit-funding-history', group: 'derivatives', provider: 'Bybit', url: 'https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1', dataType: 'historical perpetual funding rate', symbol: 'BTCUSDT', cadence: 'periodic', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: response normalization and independent schema/freshness verification are not implemented.' },
  { id: 'derivatives.okx-funding', group: 'derivatives', provider: 'OKX', url: 'https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP', dataType: 'perpetual funding rate', symbol: 'BTC-USDT-SWAP', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: response normalization and independent schema/freshness verification are not implemented.' },
  { id: 'derivatives.okx-open-interest', group: 'derivatives', provider: 'OKX', url: 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP', dataType: 'perpetual open interest', symbol: 'BTC-USDT-SWAP', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 10 * 60_000, disabledReason: 'Disabled: response normalization and independent schema/freshness verification are not implemented.' },
  { id: 'derivatives.bitget-funding', group: 'derivatives', provider: 'Bitget', url: 'https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=BTCUSDT', dataType: 'futures ticker and funding', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: response normalization and independent schema/freshness verification are not implemented.' },
  { id: 'derivatives.deribit-perpetual', group: 'derivatives', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL', dataType: 'perpetual ticker and funding', symbol: 'BTC-PERPETUAL', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: response normalization and independent schema/freshness verification are not implemented.' },
  { id: 'derivatives.dydx-perpetual', group: 'derivatives', provider: 'dYdX', url: 'https://indexer.dydx.trade/v4/perpetualMarkets?ticker=BTC-USD', dataType: 'perpetual market metrics', symbol: 'BTC-USD', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: response normalization and independent schema/freshness verification are not implemented.' },

  { id: 'options.deribit-summary', group: 'options', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option', dataType: 'BTC/ETH options summary and implied volatility', symbol: 'BTC/ETH options', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 1, fallbackGroup: 'options.btc-eth', memberIds: [5], assets: ['BTC', 'ETH'], apiKeyRequired: false },
  { id: 'options.deribit-dvol', group: 'options', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC', dataType: 'DVOL index', symbol: 'BTC-DVOL', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: endpoint is not currently consumed or independently verified.' },
  { id: 'options.deribit-book-summary', group: 'options', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option', dataType: 'all BTC option book summaries', symbol: 'BTC options', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled duplicate registry candidate; the equivalent Deribit summary adapter is registered as options.deribit-summary.' },
  { id: 'options.okx', group: 'options', provider: 'OKX', url: 'https://www.okx.com/api/v5/market/tickers?instType=OPTION&uly=BTC-USD', dataType: 'options tickers', symbol: 'BTC-USD options', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: contract mapping, normalization, and independent schema/freshness verification are not implemented.' },
  { id: 'options.okx-v5', group: 'options', provider: 'OKX V5', url: 'https://www.okx.com/api/v5/public/instruments?instType=OPTION', dataType: 'pair-scoped active option contracts, IV, OI and two-sided quotes', symbol: 'SOL-USDT|XRP-USDT|BNB-USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 1, fallbackGroup: 'options.altcoins', memberIds: [5], assets: ['SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'options.binance-european', group: 'options', provider: 'Binance European Options', url: 'https://eapi.binance.com/eapi/v1/exchangeInfo', dataType: 'active pair-scoped options, mark IV, timestamped index and USD open interest; fallback only, not added to OKX totals', symbol: 'BTCUSDT|ETHUSDT|SOLUSDT|XRPUSDT|BNBUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 2, fallbackGroup: 'options.btc-eth', memberIds: [5], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'options.bybit', group: 'options', provider: 'Bybit V5', url: 'https://api.bybit.com/v5/market/tickers?category=option&baseCoin=BTC', dataType: 'active BTC/ETH option contracts, mark IV, OI and two-sided quote validation', symbol: 'BTC/ETH options', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000, priority: 3, fallbackGroup: 'options.btc-eth', memberIds: [5], assets: ['BTC', 'ETH'], apiKeyRequired: false },

  { id: 'market.freqtrade-snapshot', group: 'orderbook', provider: 'Freqtrade CCXT DataProvider', url: 'local authenticated market-snapshot bridge', dataType: 'primary per-pair closed 15m candles, ticker, book and trades', symbol: 'BTC/ETH/SOL/XRP/BNB USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 15_000, priority: 1, fallbackGroup: 'market.core', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'market.binance-public', group: 'orderbook', provider: 'Binance public market API', url: 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m', dataType: 'primary public REST candles in multi-provider candle path; book, trades and futures metrics remain Binance-only', symbol: 'BTC/ETH/SOL/XRP/BNB USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000, priority: 2, fallbackGroup: 'market.core', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'market.bybit-public', group: 'orderbook', provider: 'Bybit V5 public market API', url: 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', dataType: 'cross-venue normalized quotes and closed-candle, order-book and trade fallbacks', symbol: 'BTC/ETH/SOL/XRP/BNB USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 3, fallbackGroup: 'market.core', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'market.okx-public', group: 'orderbook', provider: 'OKX V5 public market API', url: 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP', dataType: 'cross-venue normalized quotes and closed-candle fallback; no order-book/trade fallback', symbol: 'BTC/ETH/SOL/XRP/BNB USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 4, fallbackGroup: 'market.core', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'market.candles-binance', group: 'orderbook', provider: 'Binance public market API', url: 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m', dataType: 'closed 15m OHLCV; primary in ordered single-provider-per-feed fallback', symbol: 'BTC/ETH/SOL/XRP/BNB USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 16 * 60_000, priority: 1, fallbackGroup: 'market.closed-15m', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'market.candles-bybit', group: 'orderbook', provider: 'Bybit V5 public market API', url: 'https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15', dataType: 'closed 15m OHLCV fallback with symbol, continuity and freshness validation', symbol: 'BTC/ETH/SOL/XRP/BNB USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 16 * 60_000, priority: 2, fallbackGroup: 'market.closed-15m', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'market.candles-okx', group: 'orderbook', provider: 'OKX V5 public market API', url: 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=15m', dataType: 'confirmed 15m OHLCV fallback with base-volume normalization and freshness validation', symbol: 'BTC/ETH/SOL/XRP/BNB USDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 16 * 60_000, priority: 3, fallbackGroup: 'market.closed-15m', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },

  { id: 'orderbook.binance-depth', group: 'orderbook', provider: 'Binance public market API', url: 'https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=20', dataType: 'primary order book depth; price in quote currency and size in base asset', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 1, fallbackGroup: 'market.depth', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'orderbook.bybit-depth', group: 'orderbook', provider: 'Bybit V5 public market API', url: 'https://api.bybit.com/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=20', dataType: 'fallback order book depth; base-asset size and exchange timestamp validated', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 2, fallbackGroup: 'market.depth', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'orderbook.binance-trades', group: 'orderbook', provider: 'Binance public market API', url: 'https://fapi.binance.com/fapi/v1/aggTrades?symbol=BTCUSDT', dataType: 'primary executed trades and aggressor side', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 1, fallbackGroup: 'market.trades', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'orderbook.bybit-trades', group: 'orderbook', provider: 'Bybit V5 public market API', url: 'https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=BTCUSDT&limit=100', dataType: 'fallback executed trades with execution IDs, aggressor side and freshness validation', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000, priority: 2, fallbackGroup: 'market.trades', memberIds: [1, 2, 3, 4], assets: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'], apiKeyRequired: false },
  { id: 'orderbook.exchange-binance-price', group: 'orderbook', provider: 'Binance public market API', url: 'https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT', dataType: 'cross-venue reference price in USDT per base asset', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000 },
  { id: 'orderbook.exchange-bybit-price', group: 'orderbook', provider: 'Bybit', url: 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', dataType: 'cross-venue reference price in USDT per base asset', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000 },
  { id: 'orderbook.exchange-okx-price', group: 'orderbook', provider: 'OKX', url: 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP', dataType: 'cross-venue reference price in USDT per base asset', symbol: 'BTC-USDT-SWAP', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000 },
  { id: 'orderbook.coinbase', group: 'orderbook', provider: 'Coinbase Exchange', url: 'https://api.exchange.coinbase.com/products/BTC-USD/book?level=2', dataType: 'order book depth', symbol: 'BTC-USD', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 5_000, disabledReason: 'Disabled: venue-specific units, timestamps, and order-book normalization are not implemented.' },
  { id: 'orderbook.coinbase-trades', group: 'orderbook', provider: 'Coinbase Exchange', url: 'https://api.exchange.coinbase.com/products/BTC-USD/trades', dataType: 'executed trades', symbol: 'BTC-USD', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 5_000, disabledReason: 'Disabled: venue-specific units, timestamps, aggressor-side, and normalization are not implemented.' },
  { id: 'orderbook.kraken', group: 'orderbook', provider: 'Kraken', url: 'https://api.kraken.com/0/public/Depth?pair=XBTUSD', dataType: 'order book depth', symbol: 'XBTUSD', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 5_000, disabledReason: 'Disabled: venue-specific units, timestamps, and order-book normalization are not implemented.' },
  { id: 'orderbook.bitfinex', group: 'orderbook', provider: 'Bitfinex', url: 'https://api-pub.bitfinex.com/v2/book/tBTCUSD/P0', dataType: 'order book depth', symbol: 'tBTCUSD', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 5_000, disabledReason: 'Disabled: venue-specific units, timestamps, and order-book normalization are not implemented.' },
  { id: 'orderbook.binance-spot-depth', group: 'orderbook', provider: 'Binance Spot', url: 'https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=100', dataType: 'order book depth; price in quote currency and size in base asset', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 5_000, disabledReason: 'Disabled when the configured market is futures; spot/futures feeds are not mixed.' },
  { id: 'orderbook.binance-spot-trades', group: 'orderbook', provider: 'Binance Spot', url: 'https://api.binance.com/api/v3/trades?symbol=BTCUSDT&limit=100', dataType: 'executed spot trades and aggressor side', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 5_000, disabledReason: 'Disabled when the configured market is futures; spot/futures feeds are not mixed.' },
] as const;

for (let memberId = 1; memberId <= 8; memberId += 1) {
  const sources = getCouncilMemberSources(memberId);
  if (sources.length !== 4 || sources.some((source, index) => source.priority !== index + 1)) {
    throw new Error(`Council member ${memberId} must have exactly four prioritized sources.`);
  }
}

export function buildCouncilSourceRegistry(
  observations: Readonly<Record<string, CouncilSourceObservation>> = {},
  nowMs = Date.now(),
): CouncilSourceRegistryEntry[] {
  const allDefinitions = [
    ...definitions,
    ...COUNCIL_MEMBER_SOURCES,
    ...ASSET_SPECIFIC_MEMBER_SOURCES,
    ...ASSET_SPECIFIC_OPTIONS_SOURCES,
    ...ASSET_SPECIFIC_NEWS_SOURCES,
  ];
  const unknownIds = Object.keys(observations).filter((id) =>
    !allDefinitions.some((definition) => definition.id === id)
  );
  if (unknownIds.length > 0) {
    throw new Error(`Unknown council source registry observation IDs: ${unknownIds.join(', ')}.`);
  }

  return allDefinitions.map((definition) => {
    const observation = observations[definition.id];
    if (!definition.enabled) {
      return {
        ...definition,
        url: observation?.url ?? definition.url,
        responseTimestampMs: null,
        receivedAtMs: null,
        health: 'DISABLED',
        reason: definition.disabledReason ?? 'Source is disabled.',
      };
    }
    if (!observation) {
      return {
        ...definition,
        responseTimestampMs: null,
        receivedAtMs: null,
        health: 'UNOBSERVED',
        reason: 'The current adapter does not expose endpoint-level telemetry for this source.',
      };
    }

    const timestamp = observation.responseTimestampMs;
    const receivedAt = observation.receivedAtMs;
    const freshnessTimestamp = timestamp ?? receivedAt;
    if (observation.status === 'UNAVAILABLE') {
      return {
        ...definition,
        url: observation.url ?? definition.url,
        symbol: observation.symbol ?? definition.symbol,
        responseTimestampMs: timestamp,
        receivedAtMs: receivedAt,
        health: 'UNAVAILABLE',
        reason: observation.error ?? 'The endpoint did not return usable data.',
      };
    }
    if (observation.status === 'REGION_RESTRICTED') {
      return {
        ...definition,
        url: observation.url ?? definition.url,
        symbol: observation.symbol ?? definition.symbol,
        responseTimestampMs: timestamp,
        receivedAtMs: receivedAt,
        health: 'REGION_RESTRICTED',
        reason: observation.error ?? 'The provider returned HTTP 403/451 due to an access or regional restriction.',
      };
    }
    if (
      timestamp !== null && timestamp > nowMs ||
      receivedAt !== null && receivedAt > nowMs
    ) {
      return {
        ...definition,
        url: observation.url ?? definition.url,
        symbol: observation.symbol ?? definition.symbol,
        responseTimestampMs: timestamp,
        receivedAtMs: receivedAt,
        health: 'UNAVAILABLE',
        reason: 'The source timestamp or response receipt time is future-dated.',
      };
    }
    if (observation.status === 'STALE' ||
        freshnessTimestamp === null ||
        nowMs - freshnessTimestamp > definition.maxAgeMs) {
      return {
        ...definition,
        url: observation.url ?? definition.url,
        symbol: observation.symbol ?? definition.symbol,
        responseTimestampMs: timestamp,
        receivedAtMs: receivedAt,
        health: 'STALE',
        reason: observation.error ?? `The latest observation exceeds the ${definition.maxAgeMs}ms freshness limit.`,
      };
    }
    return {
      ...definition,
      url: observation.url ?? definition.url,
      symbol: observation.symbol ?? definition.symbol,
      responseTimestampMs: timestamp,
      receivedAtMs: receivedAt,
      health: 'LIVE',
      reason: observation.error ?? null,
    };
  });
}
