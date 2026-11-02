import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import {
  isRecord,
  makeOnChainFlow,
  parseCexWallets,
  toPositiveNumber,
  unavailableOnChainFlow,
} from './onChainCexShared';

const PROVIDER = 'Solana mainnet on-chain provider';
const PUBLIC_RPC_PROVIDERS = [
  { name: 'Solana mainnet-beta public RPC', endpoint: 'https://api.mainnet-beta.solana.com/' },
  { name: 'PublicNode Solana RPC', endpoint: 'https://solana-rpc.publicnode.com/' },
] as const;
const CACHE_TTL_MS = 60_000;
const MAX_AGE_MS = 5 * 60_000;
const MAX_WALLETS = 10;
const MAX_RECENT_TRANSACTIONS_PER_WALLET = 10;
const RPC_TRANSACTION_CONCURRENCY = 5;
const cached = new Map<string, { cachedAtMs: number; value: CouncilWhaleFlowData }>();

function validSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function positiveThreshold(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function publicRpc(
  fetcher: typeof fetch,
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
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
  destination: string,
): Array<{ amount: number; transferIndex: number }> {
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
        candidate.parsed.type !== 'transfer' || !isRecord(candidate.parsed.info) ||
        candidate.parsed.info.destination !== destination) return [];
    const lamports = toPositiveNumber(candidate.parsed.info.lamports);
    return lamports === null ? [] : [{ amount: lamports / 1_000_000_000, transferIndex }];
  });
}

async function fetchWithoutApiKey(options: {
  pair: string;
  wallets: ReturnType<typeof parseCexWallets>['wallets'];
  threshold: number;
  priceUsd?: number | null;
  nowMs: number;
  fetcher: typeof fetch;
}): Promise<CouncilWhaleFlowData> {
  const providerErrors: string[] = [];
  for (const provider of PUBLIC_RPC_PROVIDERS) {
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
        checkedAtMs - observedAtMs > MAX_AGE_MS
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
          checkedAtMs - item.blockTime * 1_000 <= MAX_AGE_MS
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
              maxSupportedTransactionVersion: 0,
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
      const sourceId = provider.endpoint === PUBLIC_RPC_PROVIDERS[0].endpoint
        ? 'onchain.solana-public-rpc'
        : 'onchain.solana-publicnode';
      const resultWithSource: CouncilWhaleFlowData = {
        ...result,
        sourceId,
        fallbackSourceId: sourceId === 'onchain.solana-publicnode'
          ? 'onchain.solana-public-rpc'
          : undefined,
      };
      cached.set(options.pair, { cachedAtMs: checkedAtMs, value: resultWithSource });
      return resultWithSource;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${provider.name}: ${reason}`);
      if (provider !== PUBLIC_RPC_PROVIDERS.at(-1)) {
        console.warn(`[SolanaOnChain] Public RPC unavailable; trying next endpoint: ${reason}`);
      }
    }
  }
  return unavailableOnChainFlow(
    options.pair,
    'SOL',
    'Solana keyless public JSON-RPC',
    `All public Solana RPC providers failed: ${providerErrors.join('; ')}`,
  );
}

export async function fetchSolanaOnChainData(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<Awaited<ReturnType<typeof unavailableOnChainFlow>>> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (asset !== 'SOL') {
    return unavailableOnChainFlow(options.pair, asset ?? 'UNKNOWN', PROVIDER, 'This provider only serves native SOL on Solana mainnet.');
  }
  const watchlist = parseCexWallets('SBK1_SOL_WATCH_ADDRESSES', validSolanaAddress);
  const threshold = positiveThreshold('SBK1_WHALE_MIN_SOL');
  if (watchlist.wallets.length === 0) {
    return unavailableOnChainFlow(options.pair, 'SOL', PROVIDER, 'Verified Solana CEX watchlist is not configured.');
  }
  if (watchlist.wallets.length > MAX_WALLETS || threshold === null) {
    return unavailableOnChainFlow(
      options.pair,
      'SOL',
      PROVIDER,
      [
        watchlist.wallets.length > MAX_WALLETS
          ? `SBK1_SOL_WATCH_ADDRESSES may contain at most ${MAX_WALLETS} addresses.`
          : watchlist.error ?? '',
        threshold === null ? 'SBK1_WHALE_MIN_SOL must be configured as a positive native-SOL threshold.' : '',
      ].filter(Boolean).join(' '),
    );
  }
  const nowMs = options.nowMs ?? Date.now();
  const cacheEntry = cached.get(options.pair);
  if (cacheEntry && nowMs >= cacheEntry.cachedAtMs && nowMs - cacheEntry.cachedAtMs < CACHE_TTL_MS) {
    const ageMs = cacheEntry.value.timestampMs === null
      ? null
      : Math.max(0, nowMs - cacheEntry.value.timestampMs);
    const status = ageMs !== null && ageMs <= MAX_AGE_MS ? 'LIVE' : 'STALE';
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
  return fetchWithoutApiKey({
    pair: options.pair,
    wallets: watchlist.wallets,
    threshold,
    priceUsd: options.priceUsd,
    nowMs,
    fetcher,
  });
}

export function resetSolanaOnChainCacheForTests(): void {
  cached.clear();
}
