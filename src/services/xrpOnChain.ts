import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import {
  fetchJson,
  isRecord,
  makeOnChainFlow,
  nativeThreshold,
  parseCexWallets,
  redactCredential,
  toPositiveNumber,
  unavailableOnChainFlow,
} from './onChainCexShared';
import { getOnChainMonitoringFeeds } from './onChainFeedRegistry';
import { fetchOnChainProvider, resetOnChainProviderHealthForTests } from './onChainProviderHealth';

const API_ROOT = 'https://api.xrpscan.com/api/v1';
const PROVIDER = 'XRPSCAN public XRPL API';
const RIPPLE_EPOCH_MS = 946_684_800_000;
const CACHE_TTL_MS = 4 * 60_000;
const MAX_AGE_MS = 5 * 60_000;
const MAX_WALLETS = 10;
const MAX_RECENT_LEDGERS = 10;
const MAX_TRANSACTIONS_PER_WALLET = 200;
const HISTORICAL_RPC_INTERVAL_MS = 100;
const RPC_FEEDS_BY_OPERATOR = getOnChainMonitoringFeeds('XRP')
  .filter((feed) => feed.dataType === 'json-rpc')
  .reduce((groups, feed) => {
    const operatorFeeds = groups.get(feed.operator) ?? [];
    operatorFeeds.push(feed);
    groups.set(feed.operator, operatorFeeds);
    return groups;
  }, new Map<string, ReturnType<typeof getOnChainMonitoringFeeds>[number][]>());
const RPC_FEED_GROUPS = [...RPC_FEEDS_BY_OPERATOR].map(([operator, feeds]) => ({
  operator,
  feeds,
}));
const XRPSCAN_SOURCE_ID = getOnChainMonitoringFeeds('XRP')
  .find((feed) => feed.dataType === 'transaction-feed')?.councilSourceId ??
  'onchain.xrpscan-xrp';
const cached = new Map<string, { cachedAtMs: number; value: Awaited<ReturnType<typeof fetchXrpOnChainData>> }>();
const providerRequestQueues = new Map<string, Promise<void>>();
const providerLastRequestAt = new Map<string, number>();
type ProviderParticipation = NonNullable<CouncilWhaleFlowData['providerParticipation']>[number];

function isProviderParticipation(value: unknown): value is ProviderParticipation {
  return isRecord(value) &&
    typeof value.sourceId === 'string' &&
    typeof value.provider === 'string' &&
    (value.status === 'VALID' || value.status === 'THROTTLED' || value.status === 'FAILED') &&
    (value.error === undefined || typeof value.error === 'string');
}

function validXrpAddress(address: string): boolean {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
}

function parseXrpAmount(value: unknown): number | null {
  if (
    isRecord(value) &&
    value.currency === 'XRP' &&
    (typeof value.value === 'string' || typeof value.value === 'number')
  ) {
    return toPositiveNumber(value.value);
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const drops = toPositiveNumber(value);
  return drops === null ? null : drops / 1_000_000;
}

async function fetchRpc(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  fetcher: typeof fetch,
  requestIntervalMs = 0,
): Promise<Record<string, unknown>> {
  if (requestIntervalMs > 0) {
    const previous = providerRequestQueues.get(endpoint) ?? Promise.resolve();
    const requestTurn = previous.then(async () => {
      const waitMs = Math.max(
        0,
        requestIntervalMs - (Date.now() - (providerLastRequestAt.get(endpoint) ?? 0)),
      );
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      providerLastRequestAt.set(endpoint, Date.now());
    });
    providerRequestQueues.set(endpoint, requestTurn.then(() => undefined, () => undefined));
    await requestTurn;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetchOnChainProvider(endpoint, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params: [params] }),
    }, fetcher);
    if (!response.ok) throw new Error(`XRPL RPC ${endpoint} returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      (payload.status !== undefined && payload.status !== 'success') ||
      !isRecord(payload.result) ||
      payload.error !== undefined
    ) {
      throw new Error(`XRPL RPC ${endpoint} returned an invalid ${method} response.`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

function parseRpcTransaction(
  entry: unknown,
  wallet: { address: string; exchange: string } | undefined,
  feedProvider: string,
  threshold: number,
  nowMs: number,
  priceUsd?: number | null,
  fallbackTimestampMs?: number,
  historicalBackfill = false,
): { transfer: CouncilWhaleTransfer; timestampMs: number } | null {
  if (!isRecord(entry) || entry.validated !== true) return null;
  const tx = isRecord(entry.tx) ? entry.tx : isRecord(entry.tx_json) ? entry.tx_json : null;
  const meta = isRecord(entry.meta) ? entry.meta : isRecord(entry.metaData) ? entry.metaData : null;
  if (
    !tx ||
    !meta ||
    tx.TransactionType !== 'Payment' ||
    (wallet !== undefined && tx.Destination !== wallet.address && tx.Account !== wallet.address) ||
    meta.TransactionResult !== 'tesSUCCESS' ||
    typeof (tx.hash ?? entry.hash) !== 'string'
  ) return null;
  const hash = tx.hash ?? entry.hash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  const ledgerIndex = entry.ledger_index ?? tx.ledger_index;
  if (typeof ledgerIndex !== 'number' || !Number.isSafeInteger(ledgerIndex) || ledgerIndex <= 0) return null;
  const date = tx.date ?? entry.date;
  const timestampMs = typeof date === 'number' && Number.isSafeInteger(date)
    ? RIPPLE_EPOCH_MS + date * 1_000
    : typeof entry.close_time_iso === 'string'
      ? Date.parse(entry.close_time_iso)
      : fallbackTimestampMs ?? Number.NaN;
  if (
    !Number.isFinite(timestampMs) ||
    timestampMs > nowMs + 1_000 ||
    (!historicalBackfill && nowMs - timestampMs >= MAX_AGE_MS)
  ) return null;
  const partialPayment = typeof tx.Flags === 'number' &&
    Number.isSafeInteger(tx.Flags) &&
    (tx.Flags & 0x0002_0000) !== 0;
  const amount = parseXrpAmount(meta.delivered_amount ?? meta.DeliveredAmount) ??
    (partialPayment ? null : parseXrpAmount(tx.Amount));
  if (amount === null || amount < threshold) return null;
  const transactionIndex = meta.TransactionIndex;
  if (typeof transactionIndex !== 'number' || !Number.isSafeInteger(transactionIndex)) return null;
  return {
    timestampMs,
    transfer: {
      transactionHash: hash,
      blockchain: 'xrp',
      blockHeight: ledgerIndex,
      timestampMs,
      sourceProvider: wallet
        ? `${feedProvider} (configured ${wallet.exchange} destination)`
        : `${feedProvider} (validated ledger scan; wallet ownership unknown)`,
      asset: 'XRP',
      amount,
      estimatedUsd: typeof priceUsd === 'number' && Number.isFinite(priceUsd) && priceUsd > 0
        ? amount * priceUsd
        : null,
      confirmationStatus: 'CONFIRMED',
      transferId: `payment:${transactionIndex}`,
      fromAddress: typeof tx.Account === 'string' ? tx.Account : undefined,
      toAddress: typeof tx.Destination === 'string' ? tx.Destination : undefined,
    },
  };
}

async function scanRpcFeed(options: {
  sourceId: string;
  endpoint: string;
  provider: string;
  operator: string;
  wallets: ReturnType<typeof parseCexWallets>['wallets'];
  threshold: number;
  nowMs: number;
  priceUsd?: number | null;
  fetcher: typeof fetch;
  historicalBackfill?: boolean;
}): Promise<{
  sourceId: string;
  provider: string;
  operator: string;
  timestampMs: number;
  transfers: CouncilWhaleTransfer[];
}> {
  const requestIntervalMs = options.historicalBackfill ? HISTORICAL_RPC_INTERVAL_MS : 0;
  const serverInfo = await fetchRpc(
    options.endpoint, 'server_info', {}, options.fetcher, requestIntervalMs,
  );
  const info = isRecord(serverInfo.info) ? serverInfo.info : null;
  const validatedLedger = info && isRecord(info.validated_ledger) ? info.validated_ledger : null;
  const latestLedger = validatedLedger?.seq;
  const ledgerAgeSeconds = validatedLedger?.age;
  if (
    typeof latestLedger !== 'number' ||
    !Number.isSafeInteger(latestLedger) ||
    typeof ledgerAgeSeconds !== 'number' ||
    !Number.isFinite(ledgerAgeSeconds) ||
    ledgerAgeSeconds < 0
  ) throw new Error(`${options.provider} returned invalid validated-ledger metadata.`);
  const timestampMs = options.nowMs - ledgerAgeSeconds * 1_000;
  if (timestampMs > options.nowMs + 1_000 || options.nowMs - timestampMs >= MAX_AGE_MS) {
    throw new Error(`${options.provider} validated ledger is stale or future-dated.`);
  }
  const minimumLedger = Math.max(0, latestLedger - MAX_RECENT_LEDGERS + 1);
  const transfers: CouncilWhaleTransfer[] = [];
  if (options.wallets.length === 0) {
    for (let ledgerIndex = minimumLedger; ledgerIndex <= latestLedger; ledgerIndex += 1) {
      const ledgerResult = await fetchRpc(options.endpoint, 'ledger', {
        ledger_index: ledgerIndex,
        transactions: true,
        expand: true,
      }, options.fetcher, requestIntervalMs);
      const ledger = isRecord(ledgerResult.ledger) ? ledgerResult.ledger : ledgerResult;
      if (!Array.isArray(ledger.transactions)) {
        throw new Error(`${options.provider} returned malformed transactions for ledger ${ledgerIndex}.`);
      }
      const ledgerTimestampMs = typeof ledger.close_time_iso === 'string'
        ? Date.parse(ledger.close_time_iso)
        : typeof ledger.close_time === 'number' && Number.isSafeInteger(ledger.close_time)
          ? RIPPLE_EPOCH_MS + ledger.close_time * 1_000
          : timestampMs;
      for (const entry of ledger.transactions) {
        const transaction = isRecord(entry)
          ? { ...entry, ledger_index: typeof entry.ledger_index === 'number' ? entry.ledger_index : ledgerIndex }
          : entry;
        const parsed = parseRpcTransaction(
          transaction,
          undefined,
          options.provider,
          options.threshold,
          options.nowMs,
          options.priceUsd,
          ledgerTimestampMs,
          options.historicalBackfill,
        );
        if (parsed) transfers.push(parsed.transfer);
      }
    }
  } else {
    for (const wallet of options.wallets) {
      const accountHistory = await fetchRpc(options.endpoint, 'account_tx', {
        account: wallet.address,
        ledger_index_min: minimumLedger,
        ledger_index_max: latestLedger,
        limit: MAX_TRANSACTIONS_PER_WALLET,
        forward: false,
      }, options.fetcher, requestIntervalMs);
      if (!Array.isArray(accountHistory.transactions)) {
        throw new Error(`${options.provider} returned malformed account transaction history.`);
      }
      for (const entry of accountHistory.transactions) {
        if (!isRecord(entry) || typeof entry.ledger_index !== 'number' ||
            entry.ledger_index < minimumLedger || entry.ledger_index > latestLedger) continue;
        const parsed = parseRpcTransaction(
          entry,
          wallet,
          options.provider,
          options.threshold,
          options.nowMs,
          options.priceUsd,
          undefined,
          options.historicalBackfill,
        );
        if (parsed) transfers.push(parsed.transfer);
      }
    }
  }
  return {
    sourceId: options.sourceId,
    provider: options.provider,
    operator: options.operator,
    timestampMs,
    transfers,
  };
}

async function scanXrpscan(options: {
  wallets: ReturnType<typeof parseCexWallets>['wallets'];
  threshold: number;
  nowMs: number;
  priceUsd?: number | null;
  fetcher: typeof fetch;
}): Promise<{ sourceId: string; provider: string; operator: string; timestampMs: number; transfers: CouncilWhaleTransfer[] }> {
  const transfers: CouncilWhaleTransfer[] = [];
  let latestObservedAtMs = 0;
  if (options.wallets.length === 0) {
    throw new Error('XRPSCAN account transaction feed requires configured addresses.');
  }
  for (const wallet of options.wallets) {
    const url = new URL(`${API_ROOT}/account/${encodeURIComponent(wallet.address)}/transactions`);
    url.searchParams.set('limit', String(MAX_TRANSACTIONS_PER_WALLET));
    const payload = await fetchJson(url, options.fetcher, PROVIDER);
    if (!isRecord(payload) || !Array.isArray(payload.transactions)) {
      throw new Error('XRPSCAN account transactions response is malformed.');
    }
    const validLedgerItems = payload.transactions.filter((item): item is Record<string, unknown> =>
      isRecord(item) &&
      typeof item.ledger_index === 'number' &&
      Number.isSafeInteger(item.ledger_index) &&
      item.ledger_index > 0
    );
    const latestLedger = Math.max(0, ...validLedgerItems.map((item) => item.ledger_index as number));
    const minimumLedger = Math.max(0, latestLedger - MAX_RECENT_LEDGERS + 1);
    for (const item of validLedgerItems) {
      const ledgerIndex = typeof item.ledger_index === 'number' ? item.ledger_index : null;
      if (
        ledgerIndex === null ||
        item.TransactionType !== 'Payment' ||
        item.Destination !== wallet.address && item.Account !== wallet.address ||
        item.validated !== true ||
        typeof item.hash !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(item.hash) ||
        ledgerIndex < minimumLedger ||
        typeof item.date !== 'string' ||
        !isRecord(item.meta) ||
        item.meta.TransactionResult !== 'tesSUCCESS'
      ) continue;
      const timestampMs = Date.parse(item.date);
      if (!Number.isFinite(timestampMs) || timestampMs > options.nowMs + 1_000 ||
          options.nowMs - timestampMs >= MAX_AGE_MS) continue;
      latestObservedAtMs = Math.max(latestObservedAtMs, timestampMs);
      const partialPayment = typeof item.Flags === 'number' &&
        Number.isSafeInteger(item.Flags) &&
        (item.Flags & 0x0002_0000) !== 0;
      const amount = parseXrpAmount(item.meta.delivered_amount) ??
        (partialPayment ? null : parseXrpAmount(item.Amount));
      if (amount === null || amount < options.threshold) continue;
      const transactionIndex = item.meta.TransactionIndex;
      if (typeof transactionIndex !== 'number' || !Number.isSafeInteger(transactionIndex)) continue;
      transfers.push({
        transactionHash: item.hash,
        blockchain: 'xrp',
        blockHeight: ledgerIndex,
        timestampMs,
        sourceProvider: `${PROVIDER} (configured ${wallet.exchange} destination)`,
        asset: 'XRP',
        amount,
        estimatedUsd: typeof options.priceUsd === 'number' && Number.isFinite(options.priceUsd) && options.priceUsd > 0
          ? amount * options.priceUsd
          : null,
        confirmationStatus: 'CONFIRMED',
        transferId: `payment:${transactionIndex}`,
        fromAddress: typeof item.Account === 'string' ? item.Account : undefined,
        toAddress: typeof item.Destination === 'string' ? item.Destination : undefined,
      });
    }
  }
  if (latestObservedAtMs === 0) throw new Error('XRPSCAN returned no recent timestamped validated payments.');
  return {
    sourceId: XRPSCAN_SOURCE_ID,
    provider: PROVIDER,
    operator: 'XRPSCAN',
    timestampMs: latestObservedAtMs,
    transfers,
  };
}

async function scanRpcOperator(options: {
  operator: string;
  feeds: readonly ReturnType<typeof getOnChainMonitoringFeeds>[number][];
  wallets: ReturnType<typeof parseCexWallets>['wallets'];
  threshold: number;
  nowMs: number;
  priceUsd?: number | null;
  fetcher: typeof fetch;
  historicalBackfill?: boolean;
}): Promise<{
  sourceId: string;
  provider: string;
  operator: string;
  timestampMs: number;
  transfers: CouncilWhaleTransfer[];
  participation: NonNullable<CouncilWhaleFlowData['providerParticipation']>;
}> {
  const attempts = await Promise.all(options.feeds.map(async (feed) => {
    try {
      const result = await scanRpcFeed({
          sourceId: feed.councilSourceId ?? feed.id,
          endpoint: feed.url,
          provider: feed.provider,
          operator: options.operator,
          wallets: options.wallets,
          threshold: options.threshold,
          nowMs: options.nowMs,
          priceUsd: options.priceUsd,
          fetcher: options.fetcher,
          historicalBackfill: options.historicalBackfill,
        });
      return { feed, result, error: null as string | null };
    } catch (error) {
      return {
        feed,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  const successful = attempts.flatMap(({ result }) => result ? [result] : []);
  const participation = attempts.map(({ feed, result, error }) => ({
    sourceId: feed.councilSourceId ?? feed.id,
    provider: feed.provider,
    status: result
      ? 'VALID' as const
      : /HTTP 429|HTTP 503|cooling down after HTTP (429|503)/i.test(error ?? '')
        ? 'THROTTLED' as const
        : 'FAILED' as const,
    ...(error ? { error } : {}),
  }));
  const best = successful.sort((left, right) => right.timestampMs - left.timestampMs)[0];
  if (!best) {
    const error = new Error(
      `All ${options.operator} XRPL endpoints failed: ${participation.map(({ error }) => error).filter(Boolean).join('; ')}`,
    );
    Object.assign(error, { participation });
    throw error;
  }
  return { ...best, participation };
}

export async function fetchXrpOnChainData(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
  historicalBackfill?: boolean;
}): Promise<Awaited<ReturnType<typeof unavailableOnChainFlow>>> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (asset !== 'XRP') {
    return unavailableOnChainFlow(options.pair, asset ?? 'UNKNOWN', PROVIDER, 'This provider only serves native XRP on XRPL mainnet.');
  }
  const watchlist = parseCexWallets('SBK1_XRP_WATCH_ADDRESSES', validXrpAddress);
  const threshold = nativeThreshold('SBK1_WHALE_MIN_XRP', 1_000);
  if (watchlist.wallets.length > MAX_WALLETS || threshold === null) {
    return unavailableOnChainFlow(
      options.pair,
      'XRP',
      PROVIDER,
      [
        watchlist.wallets.length > MAX_WALLETS
          ? `SBK1_XRP_WATCH_ADDRESSES may contain at most ${MAX_WALLETS} addresses.`
          : watchlist.error ?? '',
        threshold === null ? 'SBK1_WHALE_MIN_XRP must be a positive native-XRP threshold.' : '',
      ].filter(Boolean).join(' '),
    );
  }

  const nowMs = options.nowMs ?? Date.now();
  const cacheEntry = cached.get(options.pair);
  if (!options.historicalBackfill &&
      cacheEntry && nowMs >= cacheEntry.cachedAtMs && nowMs - cacheEntry.cachedAtMs < CACHE_TTL_MS) {
    return {
      ...cacheEntry.value,
      ageMs: cacheEntry.value.timestampMs === null ? null : nowMs - cacheEntry.value.timestampMs,
    };
  }
  const fetcher = options.fetcher ?? fetch;
  try {
    const scanTasks = [
      ...(!options.historicalBackfill ? [{
        sourceId: XRPSCAN_SOURCE_ID,
        provider: PROVIDER,
        run: () => scanXrpscan({
          wallets: watchlist.wallets,
          threshold,
          nowMs,
          priceUsd: options.priceUsd,
          fetcher,
        }),
      }] : []),
      ...RPC_FEED_GROUPS.map((group) => ({
        sourceId: group.feeds[0]?.councilSourceId ?? group.feeds[0]?.id ?? group.operator,
        provider: group.feeds[0]?.provider ?? group.operator,
        run: () => scanRpcOperator({
          ...group,
          wallets: watchlist.wallets,
          threshold,
          nowMs,
          priceUsd: options.priceUsd,
          fetcher,
          historicalBackfill: options.historicalBackfill,
        }),
      })),
    ];
    const feeds = await Promise.allSettled(scanTasks.map(({ run }) => run()));
    const successfulFeeds = feeds.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    );
    const errors = feeds.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : []
    );
    const providerParticipation = feeds.flatMap<ProviderParticipation>((result, index) => {
      const source = scanTasks[index];
      if (result.status === 'fulfilled') {
        const fulfilledValue: unknown = result.value;
        if (isRecord(fulfilledValue) && Array.isArray(fulfilledValue.participation)) {
          return fulfilledValue.participation.filter(isProviderParticipation);
        }
        return [{
          sourceId: source.sourceId,
          provider: source.provider,
          status: 'VALID' as const,
        }];
      }
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      if (isRecord(result.reason) && Array.isArray(result.reason.participation)) {
        return result.reason.participation.filter(isProviderParticipation);
      }
      return [{
        ...source,
        status: /HTTP 429|HTTP 503|cooling down after HTTP (429|503)/i.test(error)
          ? 'THROTTLED' as const
          : 'FAILED' as const,
        error,
      }];
    });
    const independentOperators = new Set(successfulFeeds.map(({ operator }) => operator));
    if (independentOperators.size < 2) {
      return {
        ...unavailableOnChainFlow(
          options.pair,
          'XRP',
          PROVIDER,
          `Independent confirmation requires two XRPL operators; ${independentOperators.size} succeeded. ${errors.join('; ')}`,
        ),
        providerParticipation,
      };
    }
    const votes = new Map<string, {
      operators: Set<string>;
      sourceIds: Set<string>;
      transfer: CouncilWhaleTransfer;
      conflicted: boolean;
    }>();
    for (const feed of successfulFeeds) {
      for (const transfer of feed.transfers) {
        const key = `${transfer.transactionHash.toLowerCase()}:${transfer.transferId ?? ''}`;
        const vote = votes.get(key);
        if (!vote) {
          votes.set(key, {
            operators: new Set([feed.operator]),
            sourceIds: new Set([feed.sourceId]),
            transfer,
            conflicted: false,
          });
        } else if (vote.transfer.amount !== transfer.amount) {
          vote.conflicted = true;
        } else {
          vote.operators.add(feed.operator);
          vote.sourceIds.add(feed.sourceId);
        }
      }
    }
    const transfers = [...votes.values()]
      .filter(({ operators, conflicted }) => !conflicted && operators.size >= 2)
      .map(({ transfer, operators, sourceIds }) => ({
        ...transfer,
        providerConfirmations: operators.size,
        confirmingSourceIds: [...sourceIds],
      }));
    const retrievedAtMs = Date.now();
    const observedAtMs = Math.min(...successfulFeeds.map(({ timestampMs }) => timestampMs));
    const result = makeOnChainFlow({
      pair: options.pair,
      asset: 'XRP',
      provider: `${independentOperators.size} independent XRPL transaction providers`,
      transfers,
      observedAtMs,
      retrievedAtMs,
    });
    result.independentProviderCount = independentOperators.size;
    result.independentSourceIds = [...new Set(successfulFeeds.map(({ sourceId }) => sourceId))];
    result.providerParticipation = providerParticipation;
    result.sourceId = 'onchain.xrpscan-xrp';
    result.unavailableReason = errors.length > 0
      ? `Some public XRPL feeds were unavailable: ${errors.join('; ')}`
      : undefined;
    if (!options.historicalBackfill) cached.set(options.pair, { cachedAtMs: nowMs, value: result });
    return result;
  } catch (error) {
    const reason = redactCredential(error, undefined);
    console.error('[XrpOnChain] XRPSCAN source unavailable:', reason);
    return unavailableOnChainFlow(options.pair, 'XRP', PROVIDER, reason);
  }
}

export function resetXrpOnChainCacheForTests(): void {
  cached.clear();
  providerRequestQueues.clear();
  providerLastRequestAt.clear();
  resetOnChainProviderHealthForTests();
}
