import type { CouncilWhaleTransfer } from './eightMemberCouncil';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import {
  fetchJson,
  isRecord,
  makeOnChainFlow,
  parseCexWallets,
  redactCredential,
  toPositiveNumber,
  unavailableOnChainFlow,
} from './onChainCexShared';

const API_ROOT = 'https://api.xrpscan.com/api/v1';
const PROVIDER = 'XRPSCAN public XRPL API';
const CACHE_TTL_MS = 4 * 60_000;
const MAX_AGE_MS = 5 * 60_000;
const MAX_WALLETS = 10;
const cached = new Map<string, { cachedAtMs: number; value: Awaited<ReturnType<typeof fetchXrpOnChainData>> }>();

function validXrpAddress(address: string): boolean {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
}

function positiveThreshold(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseXrpAmount(value: unknown): number | null {
  if (
    isRecord(value) &&
    value.currency === 'XRP' &&
    (typeof value.value === 'string' || typeof value.value === 'number')
  ) {
    const rawValue = String(value.value);
    if (!/^\d+$/.test(rawValue)) return null;
    const drops = toPositiveNumber(rawValue);
    return drops === null ? null : drops / 1_000_000;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const drops = toPositiveNumber(value);
  return drops === null ? null : drops / 1_000_000;
}

export async function fetchXrpOnChainData(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<Awaited<ReturnType<typeof unavailableOnChainFlow>>> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (asset !== 'XRP') {
    return unavailableOnChainFlow(options.pair, asset ?? 'UNKNOWN', PROVIDER, 'This provider only serves native XRP on XRPL mainnet.');
  }
  const watchlist = parseCexWallets('SBK1_XRP_WATCH_ADDRESSES', validXrpAddress);
  const threshold = positiveThreshold('SBK1_WHALE_MIN_XRP');
  if (watchlist.wallets.length === 0) {
    return unavailableOnChainFlow(options.pair, 'XRP', PROVIDER, 'Verified XRPL CEX watchlist is not configured.');
  }
  if (watchlist.wallets.length > MAX_WALLETS || threshold === null) {
    return unavailableOnChainFlow(
      options.pair,
      'XRP',
      PROVIDER,
      [
        watchlist.wallets.length > MAX_WALLETS
          ? `SBK1_XRP_WATCH_ADDRESSES may contain at most ${MAX_WALLETS} addresses.`
          : watchlist.error ?? '',
        threshold === null ? 'SBK1_WHALE_MIN_XRP must be configured as a positive native-XRP threshold.' : '',
      ].filter(Boolean).join(' '),
    );
  }

  const nowMs = options.nowMs ?? Date.now();
  const cacheEntry = cached.get(options.pair);
  if (cacheEntry && nowMs >= cacheEntry.cachedAtMs && nowMs - cacheEntry.cachedAtMs < CACHE_TTL_MS) {
    return {
      ...cacheEntry.value,
      ageMs: cacheEntry.value.timestampMs === null ? null : nowMs - cacheEntry.value.timestampMs,
    };
  }
  const fetcher = options.fetcher ?? fetch;
  try {
    const transfers: CouncilWhaleTransfer[] = [];
    let latestObservedAtMs = 0;
    for (const wallet of watchlist.wallets) {
      const url = new URL(`${API_ROOT}/account/${encodeURIComponent(wallet.address)}/transactions`);
      const payload = await fetchJson(url, fetcher, PROVIDER);
      if (!isRecord(payload) || !Array.isArray(payload.transactions)) {
        throw new Error('XRPSCAN account transactions response is malformed.');
      }
      for (const item of payload.transactions) {
        if (
          !isRecord(item) ||
          item.TransactionType !== 'Payment' ||
          item.Destination !== wallet.address ||
          item.validated !== true ||
          typeof item.hash !== 'string' ||
          !/^[0-9a-f]{64}$/i.test(item.hash) ||
          typeof item.ledger_index !== 'number' ||
          !Number.isSafeInteger(item.ledger_index) ||
          typeof item.date !== 'string' ||
          !isRecord(item.meta) ||
          item.meta.TransactionResult !== 'tesSUCCESS'
        ) continue;
        const observedAtMs = Date.parse(item.date);
        if (!Number.isFinite(observedAtMs) || observedAtMs > nowMs + 1_000) continue;
        latestObservedAtMs = Math.max(latestObservedAtMs, observedAtMs);
        const isPartialPayment = typeof item.Flags === 'number' &&
          Number.isSafeInteger(item.Flags) &&
          (item.Flags & 0x0002_0000) !== 0;
        const deliveredAmount = parseXrpAmount(item.meta.delivered_amount);
        const amount = deliveredAmount ?? (isPartialPayment ? null : parseXrpAmount(item.Amount));
        if (amount === null || amount < threshold) continue;
        if (
          !Number.isFinite(observedAtMs) ||
          observedAtMs > nowMs + 1_000 ||
          nowMs - observedAtMs > MAX_AGE_MS
        ) continue;
        const transactionIndex = isRecord(item.meta) &&
          typeof item.meta.TransactionIndex === 'number' &&
          Number.isSafeInteger(item.meta.TransactionIndex)
          ? item.meta.TransactionIndex
          : 0;
        transfers.push({
          transactionHash: item.hash,
          blockchain: 'xrp',
          blockHeight: item.ledger_index,
          timestampMs: observedAtMs,
          sourceProvider: `${PROVIDER} (configured ${wallet.exchange} destination)`,
          asset: 'XRP',
          amount,
          estimatedUsd: typeof options.priceUsd === 'number' &&
            Number.isFinite(options.priceUsd) &&
            options.priceUsd > 0
            ? amount * options.priceUsd
            : null,
          confirmationStatus: 'CONFIRMED',
          transferId: `payment:${transactionIndex}`,
        });
      }
    }
    const retrievedAtMs = Date.now();
    if (latestObservedAtMs === 0) {
      return unavailableOnChainFlow(
        options.pair,
        'XRP',
        PROVIDER,
        'XRPSCAN returned no timestamped validated payments for the configured CEX wallets.',
      );
    }
    const result = {
      ...makeOnChainFlow({
        pair: options.pair,
        asset: 'XRP',
        provider: PROVIDER,
        transfers,
        observedAtMs: latestObservedAtMs,
        retrievedAtMs,
      }),
      sourceId: 'onchain.xrpscan-xrp',
    };
    cached.set(options.pair, { cachedAtMs: nowMs, value: result });
    return { ...result };
  } catch (error) {
    const reason = redactCredential(error, undefined);
    console.error('[XrpOnChain] XRPSCAN source unavailable:', reason);
    return unavailableOnChainFlow(options.pair, 'XRP', PROVIDER, reason);
  }
}

export function resetXrpOnChainCacheForTests(): void {
  cached.clear();
}
