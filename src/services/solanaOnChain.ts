import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import {
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

const PROVIDER = 'Solana mainnet on-chain provider';
const HELIUS_PROVIDER = 'Helius Solana mainnet RPC';
const HELIUS_RPC = 'https://mainnet.helius-rpc.com/';
const PUBLIC_RPC_PROVIDERS = getOnChainMonitoringFeeds('SOL')
  .filter((feed) => feed.feedType === 'full-transaction-blocks')
  .map(({ id, councilSourceId, provider, operator, url }) => ({
    name: provider,
    operator,
    endpoint: url,
    sourceId: councilSourceId ?? id,
  }))
  .filter((provider, index, providers) =>
    providers.findIndex((candidate) => candidate.operator === provider.operator) === index
  );
const CACHE_TTL_MS = 60_000;
const MAX_AGE_MS = 5 * 60_000;
const MAX_WALLETS = 10;
const MAX_RECENT_TRANSACTIONS_PER_WALLET = 10;
const RPC_TRANSACTION_CONCURRENCY = 5;
const HISTORICAL_SEED_SLOTS = 200;
const HISTORICAL_RPC_INTERVAL_MS = 100;
const cached = new Map<string, { cachedAtMs: number; value: CouncilWhaleFlowData }>();
const providerRequestQueues = new Map<string, Promise<void>>();
const providerLastRequestAt = new Map<string, number>();

function validSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

async function rpc(
  fetcher: typeof fetch,
  apiKey: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const url = new URL(HELIUS_RPC);
  url.searchParams.set('api-key', apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetchOnChainProvider(url, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    }, fetcher);
    if (!response.ok) throw new Error(`${HELIUS_PROVIDER} returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function publicRpc(
  fetcher: typeof fetch,
  endpoint: string,
  method: string,
  params: unknown[],
  requestIntervalMs = 0,
): Promise<unknown> {
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
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }, fetcher);
    if (!response.ok) throw new Error(`Solana public RPC returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.error || !Object.hasOwn(payload, 'result')) {
      throw new Error(`Solana public RPC returned an invalid ${method} response.`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseSystemTransfers(
  transaction: unknown,
  walletAddress?: string,
): Array<{ amount: number; transferIndex: number; fromAddress?: string; toAddress?: string }> {
  if (!isRecord(transaction) || !isRecord(transaction.transaction) ||
      !isRecord(transaction.transaction.message)) return [];
  const message = transaction.transaction.message;
  const meta = isRecord(transaction.meta) ? transaction.meta : null;
  if (!meta || meta.err !== null) return [];
  const instructions: unknown[] = Array.isArray(message.instructions) ? [...message.instructions] : [];
  if (Array.isArray(meta.innerInstructions)) {
    for (const inner of meta.innerInstructions) {
      if (isRecord(inner) && Array.isArray(inner.instructions)) instructions.push(...inner.instructions);
    }
  }
  return instructions.flatMap((candidate, transferIndex) => {
    if (!isRecord(candidate) || candidate.program !== 'system' || !isRecord(candidate.parsed) ||
        candidate.parsed.type !== 'transfer' || !isRecord(candidate.parsed.info)) return [];
    const info = candidate.parsed.info;
    const fromAddress = typeof info.source === 'string' ? info.source : undefined;
    const toAddress = typeof info.destination === 'string' ? info.destination : undefined;
    if (walletAddress !== undefined &&
        fromAddress !== walletAddress && toAddress !== walletAddress) return [];
    const lamports = toPositiveNumber(info.lamports);
    return lamports === null
      ? []
      : [{ amount: lamports / 1_000_000_000, transferIndex, fromAddress, toAddress }];
  });
}

async function fetchWithoutWalletList(options: {
  pair: string;
  threshold: number;
  priceUsd?: number | null;
  nowMs: number;
  fetcher: typeof fetch;
  historicalBackfill?: boolean;
}): Promise<CouncilWhaleFlowData> {
  const scans = await Promise.all(PUBLIC_RPC_PROVIDERS.map(async (provider) => {
    try {
      const finalizedSlot = await publicRpc(
        options.fetcher,
        provider.endpoint,
        'getSlot',
        [{ commitment: 'finalized' }],
        options.historicalBackfill ? HISTORICAL_RPC_INTERVAL_MS : 0,
      );
      if (typeof finalizedSlot !== 'number' || !Number.isSafeInteger(finalizedSlot) || finalizedSlot <= 0) {
        throw new Error(`${provider.name} returned an invalid finalized slot.`);
      }
      const slotDepth = options.historicalBackfill ? HISTORICAL_SEED_SLOTS : 8;
      const firstSlot = Math.max(1, finalizedSlot - slotDepth + 1);
      const slots = await publicRpc(
        options.fetcher,
        provider.endpoint,
        'getBlocks',
        [firstSlot, finalizedSlot, { commitment: 'finalized' }],
        options.historicalBackfill ? HISTORICAL_RPC_INTERVAL_MS : 0,
      );
      if (!Array.isArray(slots) || slots.some((slot) => typeof slot !== 'number' || !Number.isSafeInteger(slot))) {
        throw new Error(`${provider.name} returned malformed finalized slots.`);
      }
      const slotBlocks = await mapConcurrent(slots, RPC_TRANSACTION_CONCURRENCY, async (slot) => {
        const block = await publicRpc(
          options.fetcher,
          provider.endpoint,
          'getBlock',
          [slot, {
            commitment: 'finalized',
            encoding: 'jsonParsed',
            transactionDetails: 'full',
            maxSupportedTransactionVersion: 1,
          }],
          options.historicalBackfill ? HISTORICAL_RPC_INTERVAL_MS : 0,
        );
        if (!isRecord(block) || typeof block.blockTime !== 'number' ||
            !Number.isSafeInteger(block.blockTime) || !Array.isArray(block.transactions)) {
          throw new Error(`${provider.name} returned an invalid finalized block ${slot}.`);
        }
        return { slot, blockTime: block.blockTime, transactions: block.transactions };
      });
      const retrievedAtMs = Math.max(options.nowMs, Date.now());
      const newestBlock = slotBlocks.at(-1);
      if (!newestBlock) throw new Error(`${provider.name} returned no finalized blocks in the sample.`);
      const observedAtMs = newestBlock.blockTime * 1_000;
      if (observedAtMs > retrievedAtMs + 1_000 || retrievedAtMs - observedAtMs >= MAX_AGE_MS) {
        throw new Error(`${provider.name} finalized block sample is stale or future-dated.`);
      }
      const transfers: CouncilWhaleTransfer[] = [];
      for (const { slot, blockTime, transactions } of slotBlocks) {
        const timestampMs = blockTime * 1_000;
        if (timestampMs > retrievedAtMs + 1_000 ||
            (!options.historicalBackfill && retrievedAtMs - timestampMs >= MAX_AGE_MS)) continue;
        for (const transaction of transactions) {
          if (!isRecord(transaction) || !isRecord(transaction.transaction) ||
              !Array.isArray(transaction.transaction.signatures) ||
              typeof transaction.transaction.signatures[0] !== 'string' ||
              !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(transaction.transaction.signatures[0]) ||
              !isRecord(transaction.meta) || transaction.meta.err !== null) continue;
          const signature = transaction.transaction.signatures[0];
          for (const transfer of parseSystemTransfers(transaction)) {
            if (transfer.amount < options.threshold) continue;
            transfers.push({
              transactionHash: signature,
              blockchain: 'solana',
              blockHeight: slot,
              timestampMs,
              sourceProvider: `${provider.name} (finalized native-SOL block scan; wallet ownership unknown)`,
              asset: 'SOL',
              amount: transfer.amount,
              estimatedUsd: typeof options.priceUsd === 'number' &&
                Number.isFinite(options.priceUsd) &&
                options.priceUsd > 0
                ? transfer.amount * options.priceUsd
                : null,
              confirmationStatus: 'CONFIRMED',
              transferId: `native-transfer:${transfer.transferIndex}`,
              fromAddress: transfer.fromAddress,
              toAddress: transfer.toAddress,
            });
          }
        }
      }
      return { provider, observedAtMs, retrievedAtMs, transfers, error: null };
    } catch (error) {
      return {
        provider,
        observedAtMs: null,
        retrievedAtMs: null,
        transfers: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  const providerParticipation = scans.map(({ provider, error }) => ({
    sourceId: provider.sourceId,
    provider: provider.name,
    status: error === null
      ? 'VALID' as const
      : /HTTP 429|HTTP 503|cooling down after HTTP (429|503)/i.test(error)
        ? 'THROTTLED' as const
        : 'FAILED' as const,
    ...(error === null ? {} : { error }),
  }));
  const successfulScans = scans.filter((scan) => scan.error === null);
  if (successfulScans.length < 2) {
    return {
      ...unavailableOnChainFlow(
      options.pair,
      'SOL',
      'Solana finalized public RPC block scans',
      `Independent confirmation requires two live providers; ${successfulScans.length} succeeded. ${scans.flatMap(({ error }) => error ? [error] : []).join('; ')}`,
      ),
      providerParticipation,
    };
  }
  const transferVotes = new Map<string, {
    count: number;
    transfer: CouncilWhaleTransfer;
    sourceIds: Set<string>;
  }>();
  const conflictingTransfers = new Set<string>();
  for (const scan of successfulScans) {
    for (const transfer of scan.transfers) {
      const key = `${transfer.transactionHash}:${transfer.transferId ?? ''}`;
      const vote = transferVotes.get(key);
      if (!vote) {
        transferVotes.set(key, {
          count: 1,
          transfer,
          sourceIds: new Set([scan.provider.sourceId]),
        });
      }
      else if (vote.transfer.amount !== transfer.amount) conflictingTransfers.add(key);
      else {
        vote.count += 1;
        vote.sourceIds.add(scan.provider.sourceId);
      }
    }
  }
  const confirmedTransfers = [...transferVotes.entries()]
    .filter(([key, { count }]) => count >= 2 && !conflictingTransfers.has(key))
    .map(([, { transfer, count, sourceIds }]) => ({
      ...transfer,
      providerConfirmations: count,
      confirmingSourceIds: [...sourceIds],
    }));
  const result = makeOnChainFlow({
    pair: options.pair,
    asset: 'SOL',
    provider: `${successfulScans.length} independent public Solana RPC block scans`,
    transfers: confirmedTransfers,
    observedAtMs: Math.min(...successfulScans.map(({ observedAtMs }) => observedAtMs!)),
    retrievedAtMs: Math.max(...successfulScans.map(({ retrievedAtMs }) => retrievedAtMs!)),
  });
  result.independentProviderCount = successfulScans.length;
  result.independentSourceIds = [...new Set(successfulScans.map(({ provider }) => provider.sourceId))];
  result.sourceId = 'onchain.solana-public-rpc';
  result.providerParticipation = providerParticipation;
  return result;
}

async function fetchWithoutApiKey(options: {
  pair: string;
  wallets: ReturnType<typeof parseCexWallets>['wallets'];
  threshold: number;
  priceUsd?: number | null;
  nowMs: number;
  fetcher: typeof fetch;
  historicalBackfill?: boolean;
}): Promise<CouncilWhaleFlowData> {
  const providerErrors: string[] = [];
  const scans = await Promise.all(PUBLIC_RPC_PROVIDERS.map(async (provider) => {
    try {
      const finalizedSlot = await publicRpc(
        options.fetcher,
        provider.endpoint,
        'getSlot',
        [{ commitment: 'finalized' }],
      );
      if (typeof finalizedSlot !== 'number' || !Number.isSafeInteger(finalizedSlot)) {
        throw new Error(`${provider.name} returned an invalid finalized slot.`);
      }
      const observedTime = await publicRpc(
        options.fetcher,
        provider.endpoint,
        'getBlockTime',
        [finalizedSlot],
      );
      if (typeof observedTime !== 'number' || !Number.isSafeInteger(observedTime)) {
        throw new Error(`${provider.name} returned an invalid finalized block time.`);
      }
      const observedAtMs = observedTime * 1_000;
      const checkedAtMs = Math.max(options.nowMs, Date.now());
      if (
        observedAtMs > checkedAtMs + 1_000 ||
        checkedAtMs - observedAtMs >= MAX_AGE_MS
      ) {
        throw new Error(`${provider.name} finalized block time is stale or future-dated.`);
      }

      const transfers: CouncilWhaleTransfer[] = [];
      for (const wallet of options.wallets) {
        const signatures = await publicRpc(
          options.fetcher,
          provider.endpoint,
          'getSignaturesForAddress',
          [wallet.address, { commitment: 'finalized', limit: 100 }],
        );
        if (!Array.isArray(signatures)) {
          throw new Error(`${provider.name} returned malformed address signatures.`);
        }
        const recentSignatures = signatures.flatMap((item) =>
          isRecord(item) &&
          typeof item.signature === 'string' &&
          /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(item.signature) &&
          typeof item.slot === 'number' &&
          Number.isSafeInteger(item.slot) &&
          typeof item.blockTime === 'number' &&
          Number.isSafeInteger(item.blockTime) &&
          item.err === null &&
          item.confirmationStatus === 'finalized' &&
          item.blockTime * 1_000 <= checkedAtMs + 1_000 &&
          checkedAtMs - item.blockTime * 1_000 < MAX_AGE_MS
            ? [{ signature: item.signature, slot: item.slot, timestampMs: item.blockTime * 1_000 }]
            : []
        ).slice(0, MAX_RECENT_TRANSACTIONS_PER_WALLET);
        const transactions = await mapConcurrent(recentSignatures, RPC_TRANSACTION_CONCURRENCY, async (signature) => ({
          signature,
          transaction: await publicRpc(
            options.fetcher,
            provider.endpoint,
            'getTransaction',
            [signature.signature, {
              commitment: 'finalized',
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 1,
            }],
          ),
        }));
        for (const { signature, transaction } of transactions) {
          if (!transaction) continue;
          for (const transfer of parseSystemTransfers(transaction, wallet.address)) {
            if (transfer.amount < options.threshold) continue;
            transfers.push({
              transactionHash: signature.signature,
              blockchain: 'solana',
              blockHeight: signature.slot,
              timestampMs: signature.timestampMs,
              sourceProvider: `${provider.name} (configured ${wallet.exchange} destination)`,
              asset: 'SOL',
              amount: transfer.amount,
              estimatedUsd: typeof options.priceUsd === 'number' &&
                Number.isFinite(options.priceUsd) &&
                options.priceUsd > 0
                ? transfer.amount * options.priceUsd
                : null,
              confirmationStatus: 'CONFIRMED',
              transferId: `native-transfer:${transfer.transferIndex}`,
              fromAddress: transfer.fromAddress,
              toAddress: transfer.toAddress,
            });
          }
        }
      }
      const result = makeOnChainFlow({
        pair: options.pair,
        asset: 'SOL',
        provider: `${provider.name} (keyless standard Solana JSON-RPC; finalized native SOL transfers)`,
        transfers,
        observedAtMs,
        retrievedAtMs: checkedAtMs,
      });
      return { provider, result, error: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${provider.name}: ${reason}`);
      return { provider, result: null, error: reason };
    }
  }));
  const providerParticipation = scans.map(({ provider, error }) => ({
    sourceId: provider.sourceId,
    provider: provider.name,
    status: error === null
      ? 'VALID' as const
      : /HTTP 429|HTTP 503|cooling down after HTTP (429|503)/i.test(error)
        ? 'THROTTLED' as const
        : 'FAILED' as const,
    ...(error === null ? {} : { error }),
  }));
  const successfulScans = scans.filter((scan) => scan.result !== null);
  if (successfulScans.length < 2) {
    return {
      ...unavailableOnChainFlow(
      options.pair,
      'SOL',
      'Solana keyless public JSON-RPC',
      `Independent confirmation requires two live providers; ${successfulScans.length} succeeded. ${providerErrors.join('; ')}`,
      ),
      providerParticipation,
    };
  }
  const transferVotes = new Map<string, {
    count: number;
    transfer: CouncilWhaleTransfer;
    sourceIds: Set<string>;
  }>();
  for (const { provider, result } of successfulScans) {
    for (const transfer of result!.largeTransfers ?? []) {
      const key = `${transfer.transactionHash}:${transfer.transferId ?? ''}`;
      const vote = transferVotes.get(key);
      if (vote && vote.transfer.amount === transfer.amount) {
        vote.count += 1;
        vote.sourceIds.add(provider.sourceId);
      } else if (!vote) {
        transferVotes.set(key, {
          count: 1,
          transfer,
          sourceIds: new Set([provider.sourceId]),
        });
      }
    }
  }
  const confirmedTransfers = [...transferVotes.values()]
    .filter(({ count }) => count >= 2)
    .map(({ transfer, count, sourceIds }) => ({
      ...transfer,
      providerConfirmations: count,
      confirmingSourceIds: [...sourceIds],
    }));
  const observedAtMs = Math.min(...successfulScans.map(({ result }) => result!.timestampMs ?? 0));
  const retrievedAtMs = Math.max(...successfulScans.map(({ result }) => result!.retrievedAtMs ?? 0));
  const result = makeOnChainFlow({
    pair: options.pair,
    asset: 'SOL',
    provider: `${successfulScans.length} independent public Solana RPC providers`,
    transfers: confirmedTransfers,
    observedAtMs,
    retrievedAtMs,
  });
  result.independentProviderCount = successfulScans.length;
  result.independentSourceIds = [...new Set(successfulScans.map(({ provider }) => provider.sourceId))];
  result.sourceId = 'onchain.solana-public-rpc';
  result.providerParticipation = providerParticipation;
  result.unavailableReason = providerErrors.length > 0
    ? `Some independent providers were unavailable: ${providerErrors.join('; ')}`
    : undefined;
  if (!options.historicalBackfill) cached.set(options.pair, { cachedAtMs: retrievedAtMs, value: result });
  return result;
}

export async function fetchSolanaOnChainData(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
  historicalBackfill?: boolean;
}): Promise<Awaited<ReturnType<typeof unavailableOnChainFlow>>> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (asset !== 'SOL') {
    return unavailableOnChainFlow(options.pair, asset ?? 'UNKNOWN', PROVIDER, 'This provider only serves native SOL on Solana mainnet.');
  }
  const watchlist = parseCexWallets('SBK1_SOL_WATCH_ADDRESSES', validSolanaAddress);
  const threshold = nativeThreshold('SBK1_WHALE_MIN_SOL', 10);
  if (watchlist.wallets.length > MAX_WALLETS || threshold === null) {
    return unavailableOnChainFlow(
      options.pair,
      'SOL',
      PROVIDER,
      [
        watchlist.wallets.length > MAX_WALLETS
          ? `SBK1_SOL_WATCH_ADDRESSES may contain at most ${MAX_WALLETS} addresses.`
          : watchlist.error ?? '',
        threshold === null ? 'SBK1_WHALE_MIN_SOL must be a positive native-SOL threshold.' : '',
      ].filter(Boolean).join(' '),
    );
  }
  const nowMs = options.nowMs ?? Date.now();
  const cacheEntry = cached.get(options.pair);
  if (!options.historicalBackfill &&
      cacheEntry && nowMs >= cacheEntry.cachedAtMs && nowMs - cacheEntry.cachedAtMs < CACHE_TTL_MS) {
    const ageMs = cacheEntry.value.timestampMs === null
      ? null
      : Math.max(0, nowMs - cacheEntry.value.timestampMs);
    const status = ageMs !== null && ageMs < MAX_AGE_MS ? 'LIVE' : 'STALE';
    return {
      ...cacheEntry.value,
      status,
      ageMs,
      qualityPct: status === 'LIVE' ? cacheEntry.value.qualityPct : 0,
      coverageStatus: status === 'LIVE' ? cacheEntry.value.coverageStatus : 'UNAVAILABLE',
      unavailableReason: status === 'LIVE'
        ? undefined
        : 'Latest observed finalized Solana slot is older than five minutes.',
    };
  }
  const fetcher = options.fetcher ?? fetch;
  if (watchlist.wallets.length === 0) {
    return fetchWithoutWalletList({
      pair: options.pair,
      threshold,
      priceUsd: options.priceUsd,
      nowMs,
      fetcher,
      historicalBackfill: options.historicalBackfill,
    });
  }
  const apiKey = process.env.HELIUS_API_KEY?.trim();
  if (!apiKey) {
    return fetchWithoutApiKey({
      pair: options.pair,
      wallets: watchlist.wallets,
      threshold,
      priceUsd: options.priceUsd,
      nowMs,
      fetcher,
      historicalBackfill: options.historicalBackfill,
    });
  }
  try {
    const transfers: CouncilWhaleTransfer[] = [];
    let latestObservedAtMs = 0;
    for (const wallet of watchlist.wallets) {
      const transactionsResponse = await rpc(fetcher, apiKey, 'getTransactionsForAddress', [
        wallet.address,
        {
          transactionDetails: 'full',
          sortOrder: 'desc',
          limit: 100,
          filters: {
            blockTime: { gte: Math.floor((nowMs - MAX_AGE_MS) / 1_000) },
            status: 'succeeded',
          },
        },
      ]);
      if (!isRecord(transactionsResponse) || transactionsResponse.error) {
        throw new Error('Helius getTransactionsForAddress request failed.');
      }
      const transactions: unknown[] = Array.isArray(transactionsResponse.result)
        ? transactionsResponse.result
        : [];
      if (transactions.length > 0) {
        const latestForWallet = transactions.flatMap((item) =>
          isRecord(item) && typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
            ? [item.timestamp * 1_000]
            : []
        );
        latestObservedAtMs = Math.max(latestObservedAtMs, ...latestForWallet);
      }
      const candidates = transactions.flatMap((item) => {
        if (
          !isRecord(item) ||
          typeof item.signature !== 'string' ||
          !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(item.signature) ||
          typeof item.slot !== 'number' ||
          !Number.isSafeInteger(item.slot) ||
          typeof item.timestamp !== 'number' ||
          !Number.isFinite(item.timestamp) ||
          !Array.isArray(item.nativeTransfers)
        ) return [];
        return item.nativeTransfers.flatMap((transfer, transferIndex) => {
          if (!isRecord(transfer) || transfer.toUserAccount !== wallet.address) return [];
          const lamports = toPositiveNumber(transfer.amount);
          if (lamports === null) return [];
          const amount = lamports / 1_000_000_000;
          if (amount < threshold) return [];
          return [{
            signature: item.signature as string,
            slot: item.slot as number,
            timestampMs: (item.timestamp as number) * 1_000,
            amount,
            transferIndex,
          }];
        });
      });
      if (candidates.length === 0) continue;
      const signatures = [...new Set(candidates.map(({ signature }) => signature))];
      const statusResponse = await rpc(fetcher, apiKey, 'getSignatureStatuses', [
        signatures,
        { searchTransactionHistory: true },
      ]);
      if (
        !isRecord(statusResponse) ||
        statusResponse.error ||
        !isRecord(statusResponse.result) ||
        !Array.isArray(statusResponse.result.value)
      ) {
        throw new Error('Helius signature confirmation response is malformed.');
      }
      const statuses = statusResponse.result.value;
      const statusBySignature = new Map(signatures.map((signature, index) =>
        [signature, statuses[index]]
      ));
      for (const candidate of candidates) {
        const status = statusBySignature.get(candidate.signature);
        if (!isRecord(status) || status.confirmationStatus !== 'finalized' || status.err !== null) continue;
        const observedAtMs = candidate.timestampMs;
        if (observedAtMs > nowMs + 1_000 || nowMs - observedAtMs >= MAX_AGE_MS) continue;
        transfers.push({
          transactionHash: candidate.signature,
          blockchain: 'solana',
          blockHeight: candidate.slot,
          timestampMs: observedAtMs,
          sourceProvider: `${HELIUS_PROVIDER} (configured ${wallet.exchange} destination)`,
          asset: 'SOL',
          amount: candidate.amount,
          estimatedUsd: typeof options.priceUsd === 'number' &&
            Number.isFinite(options.priceUsd) &&
            options.priceUsd > 0
            ? candidate.amount * options.priceUsd
            : null,
          confirmationStatus: 'CONFIRMED',
          transferId: `native-transfer:${candidate.transferIndex}`,
        });
      }
    }
    const retrievedAtMs = Date.now();
    if (latestObservedAtMs === 0) {
      return unavailableOnChainFlow(
        options.pair,
        'SOL',
        HELIUS_PROVIDER,
        'Helius returned no timestamped transaction observations for the configured CEX wallets.',
      );
    }
    const result = makeOnChainFlow({
      pair: options.pair,
      asset: 'SOL',
      provider: HELIUS_PROVIDER,
      transfers,
      observedAtMs: latestObservedAtMs,
      retrievedAtMs,
    });
    result.sourceId = 'onchain.helius-solana';
    if (!options.historicalBackfill) cached.set(options.pair, { cachedAtMs: nowMs, value: result });
    return { ...result };
  } catch (error) {
    const reason = redactCredential(error, apiKey);
    console.error('[SolanaOnChain] Helius source unavailable:', reason);
    return unavailableOnChainFlow(options.pair, 'SOL', HELIUS_PROVIDER, reason);
  }
}

export function resetSolanaOnChainCacheForTests(): void {
  cached.clear();
  providerRequestQueues.clear();
  providerLastRequestAt.clear();
  resetOnChainProviderHealthForTests();
}
