import type { CouncilWhaleTransfer } from './eightMemberCouncil';

export interface IdentifiedTrade {
  venue?: string;
  symbol?: string;
  tradeId?: string | number;
  exchangeEventId?: string | number;
  timestampMs?: number;
  side?: string;
  price?: number;
  amount?: number;
}

export interface IdentifiedQuote {
  exchange: string;
  symbol: string;
  sourceTimestampMs: number;
  price?: number;
  priceUnit?: string;
  market?: string;
}

export interface IdentifiedOrderBookSnapshot {
  venue: string;
  symbol: string;
  timestampMs: number;
  sequenceId?: string | number;
  bids?: Array<{ price: number; amount: number }>;
  asks?: Array<{ price: number; amount: number }>;
}

export interface IdentifiedDerivativeObservation {
  venue: string;
  symbol: string;
  timestampMs: number;
  dataType: 'funding' | 'open-interest';
  value?: unknown;
}

export interface IdentifiedMacroObservation {
  provider: string;
  metric: string;
  timestampMs: number;
  value?: unknown;
  direction?: number;
}

export interface IdentifiedOptionContract {
  venue: string;
  instrumentName: string;
  expiryTimestampMs: number;
  strikePrice: number;
  side: 'call' | 'put';
  contractData?: unknown;
}

export interface Deduplicated<T> {
  values: T[];
  duplicateCount: number;
  conflictingIdentity: boolean;
}

export function deduplicateCandles<T extends readonly unknown[]>(
  candles: readonly T[],
): Deduplicated<T> {
  return deduplicate(
    candles.filter((candle) => typeof candle[0] === 'number' && Number.isFinite(candle[0])),
    (candle) => String(candle[0]),
  );
}

function normalizeIdentityPart(value: string | number): string {
  return String(value).trim().toLowerCase();
}

function deduplicate<T>(
  values: readonly T[],
  identity: (value: T) => string | null,
  isSameObservation: (left: T, right: T) => boolean = (left, right) =>
    JSON.stringify(left) === JSON.stringify(right),
): Deduplicated<T> {
  const unique = new Map<string, T>();
  let duplicateCount = 0;
  let conflictingIdentity = false;
  for (const value of values) {
    const key = identity(value);
    if (key === null) {
      unique.set(`unidentified:${unique.size}`, value);
      continue;
    }
    const previous = unique.get(key);
    if (previous === undefined) {
      unique.set(key, value);
      continue;
    }
    duplicateCount += 1;
    if (!isSameObservation(previous, value)) conflictingIdentity = true;
  }
  return { values: [...unique.values()], duplicateCount, conflictingIdentity };
}

export function canonicalizeNewsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeNewsTitle(value: string): string {
  return value.normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const NEWS_TITLE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'after', 'as', 'at', 'by', 'for', 'from', 'in',
  'is', 'of', 'on', 'the', 'to', 'with', 'following', 'amid', 'report',
]);

const NEWS_TITLE_ALIASES = new Map<string, string>([
  ['btc', 'bitcoin'],
  ['cryptocurrency', 'crypto'],
  ['cryptocurrencies', 'crypto'],
  ['etfs', 'etf'],
  ['funds', 'fund'],
  ['surge', 'rise'],
  ['surges', 'rise'],
  ['rally', 'rise'],
  ['rallies', 'rise'],
  ['jump', 'rise'],
  ['jumps', 'rise'],
  ['climb', 'rise'],
  ['climbs', 'rise'],
  ['rises', 'rise'],
  ['soar', 'rise'],
  ['soars', 'rise'],
  ['plunge', 'fall'],
  ['plunges', 'fall'],
  ['drop', 'fall'],
  ['drops', 'fall'],
  ['tumble', 'fall'],
  ['tumbles', 'fall'],
  ['slump', 'fall'],
  ['slumps', 'fall'],
  ['inflows', 'inflow'],
  ['outflows', 'outflow'],
  ['capital', 'inflow'],
  ['unprecedented', 'record'],
  ['records', 'record'],
  ['reaches', 'reach'],
  ['reached', 'reach'],
  ['draws', 'attract'],
  ['drew', 'attract'],
  ['attracts', 'attract'],
  ['attracted', 'attract'],
  ['approves', 'approve'],
  ['approved', 'approve'],
  ['announces', 'announce'],
  ['announced', 'announce'],
]);

function normalizedNewsTokens(value: string): string[] {
  const normalized = normalizeNewsTitle(value)
    .replace(/\bexchange traded funds?\b/g, ' etf ')
    .replace(/\bbullish\b/g, ' positive ')
    .replace(/\bbearish\b/g, ' negative ');
  return normalized.split(' ')
    .map((token) => NEWS_TITLE_ALIASES.get(token) ?? token)
    .filter((token) =>
      (token.length > 1 || /^\d+$/.test(token)) && !NEWS_TITLE_STOP_WORDS.has(token),
    );
}

export function deduplicateNews<T extends {
  url: string;
  headline: string;
  publishedAt: string;
  content?: string;
}>(items: readonly T[]): Deduplicated<T> {
  const clusters: T[] = [];
  let duplicateCount = 0;
  const sameStory = (item: T, candidate: T): boolean => {
    const url = canonicalizeNewsUrl(item.url);
    const candidateUrl = canonicalizeNewsUrl(candidate.url);
    const title = normalizeNewsTitle(item.headline);
    const candidateTitle = normalizeNewsTitle(candidate.headline);
    const content = normalizeNewsTitle(item.content ?? '');
    const candidateContent = normalizeNewsTitle(candidate.content ?? '');
    const publishedAtMs = Date.parse(item.publishedAt);
    const candidateTimeMs = Date.parse(candidate.publishedAt);
    const samePublicationWindow = Number.isFinite(publishedAtMs) &&
      Number.isFinite(candidateTimeMs) &&
      Math.abs(publishedAtMs - candidateTimeMs) <= 12 * 60 * 60_000;
    if (url && candidateUrl && url === candidateUrl) return true;
    if (content && candidateContent && content === candidateContent) return true;
    if (
      title &&
      candidateTitle &&
      title === candidateTitle &&
      samePublicationWindow
    ) return true;
    const tokens = new Set(normalizedNewsTokens(item.headline));
    const candidateTokens = new Set(normalizedNewsTokens(candidate.headline));
    if (tokens.size < 5 || candidateTokens.size < 5) return false;
    const numbers = [...tokens].filter((token) => /^\d+$/.test(token)).sort();
    const candidateNumbers = [...candidateTokens].filter((token) => /^\d+$/.test(token)).sort();
    if (
      (numbers.length > 0 || candidateNumbers.length > 0) &&
      JSON.stringify(numbers) !== JSON.stringify(candidateNumbers)
    ) return false;
    const intersectionCount = [...tokens].filter((token) => candidateTokens.has(token)).length;
    const similarity = intersectionCount / new Set([...tokens, ...candidateTokens]).size;
    return intersectionCount >= 5 &&
      similarity >= 0.55 &&
      samePublicationWindow;
  };
  for (const item of items) {
    if (clusters.some((candidate) => sameStory(item, candidate))) {
      duplicateCount += 1;
    } else {
      clusters.push(item);
    }
  }
  return {
    values: clusters,
    duplicateCount,
    conflictingIdentity: false,
  };
}

export function deduplicateOnChainTransfers<T extends CouncilWhaleTransfer>(
  transfers: readonly T[],
): Deduplicated<T> {
  return deduplicate(
    transfers,
    (transfer) => {
      if (!transfer.transferId?.trim()) return null;
      return [
        normalizeIdentityPart(transfer.blockchain),
        normalizeIdentityPart(transfer.transactionHash),
        normalizeIdentityPart(transfer.transferId),
      ].join(':');
    },
    (left, right) =>
      normalizeIdentityPart(left.blockchain) === normalizeIdentityPart(right.blockchain) &&
      normalizeIdentityPart(left.transactionHash) === normalizeIdentityPart(right.transactionHash) &&
      normalizeIdentityPart(left.transferId ?? '') === normalizeIdentityPart(right.transferId ?? '') &&
      normalizeIdentityPart(left.asset) === normalizeIdentityPart(right.asset) &&
      left.timestampMs === right.timestampMs &&
      left.blockHeight === right.blockHeight &&
      left.amount === right.amount &&
      left.confirmationStatus === right.confirmationStatus,
  );
}

export function deduplicateTrades<T extends IdentifiedTrade>(
  trades: readonly T[],
): Deduplicated<T> {
  return deduplicate(trades, (trade) => {
    const eventId = trade.tradeId ?? trade.exchangeEventId;
    if (!trade.venue?.trim() || !trade.symbol?.trim() || eventId === undefined || String(eventId).trim() === '') {
      return null;
    }
    return [
      normalizeIdentityPart(trade.venue),
      normalizeIdentityPart(trade.symbol),
      normalizeIdentityPart(eventId),
    ].join(':');
  }, (left, right) =>
    left.timestampMs === right.timestampMs &&
    left.side === right.side &&
    left.price === right.price &&
    left.amount === right.amount,
  );
}

export function deduplicateQuotes<T extends IdentifiedQuote>(quotes: readonly T[]): Deduplicated<T> {
  return deduplicate(
    quotes,
    (quote) => [
      normalizeIdentityPart(quote.exchange),
      normalizeIdentityPart(quote.symbol),
      normalizeIdentityPart(quote.market ?? ''),
      String(quote.sourceTimestampMs),
    ].join(':'),
    (left, right) => left.price === right.price &&
      left.priceUnit === right.priceUnit &&
      left.market === right.market,
  );
}

export function deduplicateOrderBookSnapshots<T extends IdentifiedOrderBookSnapshot>(
  snapshots: readonly T[],
): Deduplicated<T> {
  return deduplicate(
    snapshots,
    (snapshot) => [
      normalizeIdentityPart(snapshot.venue),
      normalizeIdentityPart(snapshot.symbol),
      snapshot.sequenceId === undefined
        ? String(snapshot.timestampMs)
        : normalizeIdentityPart(snapshot.sequenceId),
    ].join(':'),
    (left, right) =>
      JSON.stringify(left.bids) === JSON.stringify(right.bids) &&
      JSON.stringify(left.asks) === JSON.stringify(right.asks),
  );
}

export function deduplicateDerivativeObservations<T extends IdentifiedDerivativeObservation>(
  observations: readonly T[],
): Deduplicated<T> {
  return deduplicate(observations, (observation) => [
    normalizeIdentityPart(observation.dataType),
    normalizeIdentityPart(observation.venue),
    normalizeIdentityPart(observation.symbol),
    String(observation.timestampMs),
  ].join(':'), (left, right) => JSON.stringify(left.value) === JSON.stringify(right.value));
}

export function deduplicateMacroObservations<T extends IdentifiedMacroObservation>(
  observations: readonly T[],
): Deduplicated<T> {
  return deduplicate(observations, (observation) => [
    normalizeIdentityPart(observation.provider),
    normalizeIdentityPart(observation.metric),
    String(observation.timestampMs),
  ].join(':'), (left, right) => left.direction === right.direction &&
    JSON.stringify(left.value) === JSON.stringify(right.value));
}

export function deduplicateOptionContracts<T extends IdentifiedOptionContract>(
  contracts: readonly T[],
): Deduplicated<T> {
  return deduplicate(contracts, (contract) => [
    normalizeIdentityPart(contract.venue),
    normalizeIdentityPart(contract.instrumentName),
    String(contract.expiryTimestampMs),
    String(contract.strikePrice),
    normalizeIdentityPart(contract.side),
  ].join(':'), (left, right) => JSON.stringify(left.contractData) === JSON.stringify(right.contractData));
}
