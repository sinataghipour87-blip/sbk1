export type CouncilSourceGroup =
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
  | 'DISABLED'
  | 'UNOBSERVED';

export interface CouncilSourceObservation {
  responseTimestampMs: number | null;
  receivedAtMs: number | null;
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
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
}

interface CouncilSourceDefinition extends Omit<
  CouncilSourceRegistryEntry,
  'responseTimestampMs' | 'receivedAtMs' | 'health' | 'reason'
> {
  disabledReason?: string;
}

const definitions: readonly CouncilSourceDefinition[] = [
  { id: 'onchain.mempool-blocks', group: 'onchain', provider: 'mempool.space', url: 'https://mempool.space/api/v1/blocks', dataType: 'confirmed Bitcoin block sample', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000 },
  { id: 'onchain.mempool-transactions', group: 'onchain', provider: 'mempool.space', url: 'https://mempool.space/api/block/{hash}/txs', dataType: 'confirmed Bitcoin transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000 },
  { id: 'onchain.blockstream-blocks', group: 'onchain', provider: 'Blockstream Esplora', url: 'https://blockstream.info/api/blocks', dataType: 'confirmed Bitcoin block sample', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000 },
  { id: 'onchain.blockstream-transactions', group: 'onchain', provider: 'Blockstream Esplora', url: 'https://blockstream.info/api/block/{hash}/txs', dataType: 'confirmed Bitcoin transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000 },
  { id: 'onchain.mempool-ninja', group: 'onchain', provider: 'mempool.ninja', url: 'https://mempool.ninja/api/mempool/recent', dataType: 'recent Bitcoin mempool transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: mirror schema, freshness, and operational ownership have not been verified.' },
  { id: 'onchain.mempool-emzy', group: 'onchain', provider: 'mempool.emzy.de', url: 'https://mempool.emzy.de/api/mempool/recent', dataType: 'recent Bitcoin mempool transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: mirror schema, freshness, and operational ownership have not been verified.' },
  { id: 'onchain.blockchain-info-latest-block', group: 'onchain', provider: 'Blockchain.com', url: 'https://blockchain.info/latestblock', dataType: 'latest Bitcoin block', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: not used; published OpenAPI review did not verify a free compatible block/transaction route.' },
  { id: 'onchain.blockchain-info-unconfirmed', group: 'onchain', provider: 'Blockchain.com', url: 'https://blockchain.info/unconfirmed-transactions?format=json', dataType: 'unconfirmed Bitcoin transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint contract and transaction coverage have not been independently verified.' },
  { id: 'onchain.blockchain-info-stats', group: 'onchain', provider: 'Blockchain.com', url: 'https://api.blockchain.info/stats', dataType: 'Bitcoin network statistics', symbol: 'BTC', cadence: 'periodic', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint contract and timestamp semantics have not been independently verified.' },
  { id: 'onchain.blockchair-stats', group: 'onchain', provider: 'Blockchair', url: 'https://api.blockchair.com/bitcoin/stats', dataType: 'Bitcoin network statistics', symbol: 'BTC', cadence: 'periodic', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint schema, service limits, and timestamp semantics have not been verified.' },
  { id: 'onchain.blockchair-mempool', group: 'onchain', provider: 'Blockchair', url: 'https://api.blockchair.com/bitcoin/mempool', dataType: 'Bitcoin mempool statistics', symbol: 'BTC', cadence: 'periodic', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint schema, service limits, and timestamp semantics have not been verified.' },
  { id: 'onchain.btcscan-mempool', group: 'onchain', provider: 'BTCscan', url: 'https://btcscan.org/api/mempool/recent', dataType: 'recent Bitcoin mempool transactions', symbol: 'BTC', cadence: 'event-driven', realtimeEligible: false, enabled: false, maxAgeMs: 5 * 60_000, disabledReason: 'Disabled: endpoint schema and operational availability have not been verified.' },
  { id: 'onchain.coinmetrics-active-addresses', group: 'onchain', provider: 'Coin Metrics Community API', url: 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=AdrActCnt&limit_per_asset=1&pretty=false', dataType: 'daily active addresses; network activity, not whale flow', symbol: 'BTC', cadence: 'daily', realtimeEligible: false, enabled: true, maxAgeMs: 3 * 24 * 60 * 60_000 },
  { id: 'onchain.etherscan-transfers', group: 'onchain', provider: 'Etherscan', url: 'https://api.etherscan.io/api', dataType: 'configured-address transfer watchlist', symbol: 'ETH', cadence: 'event-driven', realtimeEligible: true, enabled: true, maxAgeMs: 5 * 60_000 },
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

  { id: 'options.deribit-summary', group: 'options', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option', dataType: 'BTC options summary and implied volatility', symbol: 'BTC options', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 60_000 },
  { id: 'options.deribit-dvol', group: 'options', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC', dataType: 'DVOL index', symbol: 'BTC-DVOL', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: endpoint is not currently consumed or independently verified.' },
  { id: 'options.deribit-book-summary', group: 'options', provider: 'Deribit', url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option', dataType: 'all BTC option book summaries', symbol: 'BTC options', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled duplicate registry candidate; the equivalent Deribit summary adapter is registered as options.deribit-summary.' },
  { id: 'options.okx', group: 'options', provider: 'OKX', url: 'https://www.okx.com/api/v5/market/tickers?instType=OPTION&uly=BTC-USD', dataType: 'options tickers', symbol: 'BTC-USD options', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: contract mapping, normalization, and independent schema/freshness verification are not implemented.' },
  { id: 'options.bybit', group: 'options', provider: 'Bybit', url: 'https://api.bybit.com/v5/market/tickers?category=option&baseCoin=BTC', dataType: 'options tickers', symbol: 'BTC options', cadence: 'realtime', realtimeEligible: false, enabled: false, maxAgeMs: 60_000, disabledReason: 'Disabled: contract mapping, normalization, and independent schema/freshness verification are not implemented.' },

  { id: 'orderbook.binance-depth', group: 'orderbook', provider: 'Binance public market API', url: 'https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=20', dataType: 'order book depth; price in quote currency and size in base asset', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000 },
  { id: 'orderbook.binance-trades', group: 'orderbook', provider: 'Binance public market API', url: 'https://fapi.binance.com/fapi/v1/aggTrades?symbol=BTCUSDT', dataType: 'executed trades and aggressor side', symbol: 'BTCUSDT', cadence: 'realtime', realtimeEligible: true, enabled: true, maxAgeMs: 5_000 },
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

export function buildCouncilSourceRegistry(
  observations: Readonly<Record<string, CouncilSourceObservation>> = {},
  nowMs = Date.now(),
): CouncilSourceRegistryEntry[] {
  const unknownIds = Object.keys(observations).filter((id) =>
    !definitions.some((definition) => definition.id === id)
  );
  if (unknownIds.length > 0) {
    throw new Error(`Unknown council source registry observation IDs: ${unknownIds.join(', ')}.`);
  }

  return definitions.map((definition) => {
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
