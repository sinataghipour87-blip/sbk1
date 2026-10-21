import type { CouncilWhaleFlowData } from './eightMemberCouncil';

const API_BASE = 'https://leviathan.whale-alert.io';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;
const MAX_SOURCE_AGE_MS = 10 * 60_000;
const BLOCK_WINDOW = 12;
const PAGE_LIMIT = 100;
const MIN_TRANSFER_BTC = 10;

interface WhaleAlertAddress {
  amount: string;
  owner_type?: string;
  owner?: string;
}

interface WhaleAlertSubTransaction {
  symbol: string;
  transaction_type: string;
  inputs: WhaleAlertAddress[];
  outputs: WhaleAlertAddress[];
}

interface WhaleAlertTransaction {
  timestamp: number;
  sub_transactions: WhaleAlertSubTransaction[];
}

let cachedAtMs = 0;
let cachedResult: CouncilWhaleFlowData | null = null;

function unavailable(status: CouncilWhaleFlowData['status'] = 'UNAVAILABLE'): CouncilWhaleFlowData {
  return {
    status,
    provider: 'Whale Alert attributed Bitcoin transaction API',
    timestampMs: null,
    ageMs: null,
    qualityPct: 0,
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 0,
    windowStartHeight: null,
    windowEndHeight: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAddress(value: unknown): value is WhaleAlertAddress {
  if (!isRecord(value) || typeof value.amount !== 'string') return false;
  return Number.isFinite(Number(value.amount)) &&
    (value.owner_type === undefined || typeof value.owner_type === 'string') &&
    (value.owner === undefined || typeof value.owner === 'string');
}

function isSubTransaction(value: unknown): value is WhaleAlertSubTransaction {
  return isRecord(value) &&
    typeof value.symbol === 'string' &&
    typeof value.transaction_type === 'string' &&
    Array.isArray(value.inputs) &&
    value.inputs.every(isAddress) &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isAddress);
}

function isTransaction(value: unknown): value is WhaleAlertTransaction {
  return isRecord(value) &&
    isFiniteNumber(value.timestamp) &&
    Array.isArray(value.sub_transactions) &&
    value.sub_transactions.every(isSubTransaction);
}

function isExchange(address: WhaleAlertAddress): boolean {
  return address.owner_type?.toLowerCase().includes('exchange') === true;
}

async function fetchJson(url: URL, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Whale Alert API returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchWhaleAlertFlow(options: {
  apiKey?: string;
  nowMs?: number;
  fetcher?: typeof fetch;
} = {}): Promise<CouncilWhaleFlowData> {
  const nowMs = options.nowMs ?? Date.now();
  if (cachedResult && nowMs >= cachedAtMs && nowMs - cachedAtMs <= CACHE_TTL_MS) {
    return {
      ...cachedResult,
      ageMs: cachedResult.timestampMs === null ? null : nowMs - cachedResult.timestampMs,
    };
  }
  const apiKey = (options.apiKey ?? process.env.WHALE_ALERT_API_KEY)?.trim();
  if (!apiKey) {
    cachedAtMs = nowMs;
    cachedResult = unavailable();
    return cachedResult;
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const statusUrl = new URL('/bitcoin/status', API_BASE);
    statusUrl.searchParams.set('api_key', apiKey);
    const statusPayload = await fetchJson(statusUrl, fetcher);
    if (!isRecord(statusPayload) || !isFiniteNumber(statusPayload.end_height) ||
        !Number.isSafeInteger(statusPayload.end_height) || statusPayload.end_height < 1) {
      throw new Error('Whale Alert Bitcoin status response is malformed.');
    }
    const windowEndHeight = statusPayload.end_height;
    const windowStartHeight = Math.max(0, windowEndHeight - BLOCK_WINDOW + 1);
    const transactionsUrl = new URL('/bitcoin/transactions', API_BASE);
    transactionsUrl.searchParams.set('api_key', apiKey);
    transactionsUrl.searchParams.set('start_height', String(windowStartHeight));
    transactionsUrl.searchParams.set('end_height', String(windowEndHeight));
    transactionsUrl.searchParams.set('limit', String(PAGE_LIMIT));
    transactionsUrl.searchParams.set('order', 'desc');
    transactionsUrl.searchParams.set('symbol', 'btc');
    transactionsUrl.searchParams.set('min_amount', String(MIN_TRANSFER_BTC));
    transactionsUrl.searchParams.set('transaction_type', 'transfer');
    const transactionPayload = await fetchJson(transactionsUrl, fetcher);
    if (!isRecord(transactionPayload)) {
      throw new Error('Whale Alert transaction response is malformed.');
    }
    const rawTransactions = Array.isArray(transactionPayload.transactions)
      ? transactionPayload.transactions
      : Array.isArray(transactionPayload.result)
        ? transactionPayload.result
        : null;
    if (!rawTransactions || rawTransactions.some((transaction) => !isTransaction(transaction))) {
      throw new Error('Whale Alert transaction list is missing or malformed.');
    }
    if (typeof transactionPayload.next === 'string' && transactionPayload.next.length > 0) {
      throw new Error('Whale Alert transaction page is incomplete; pagination is required.');
    }

    let exchangeInflowsBtc = 0;
    let exchangeOutflowsBtc = 0;
    let latestTransactionTimestampMs: number | null = null;
    let transactionCount = 0;
    for (const transaction of rawTransactions as WhaleAlertTransaction[]) {
      const timestampMs = transaction.timestamp * 1_000;
      if (
        timestampMs > nowMs ||
        nowMs - timestampMs > MAX_SOURCE_AGE_MS
      ) continue;
      let transactionInflow = 0;
      let transactionOutflow = 0;
      for (const subTransaction of transaction.sub_transactions) {
        if (subTransaction.symbol.toUpperCase() !== 'BTC' ||
            subTransaction.transaction_type !== 'transfer') continue;
        const exchangeInputs = subTransaction.inputs.filter(isExchange);
        const exchangeOutputs = subTransaction.outputs.filter(isExchange);
        if (exchangeInputs.length > 0 && exchangeOutputs.length > 0) continue;
        if (exchangeInputs.length === 0 && exchangeOutputs.length === 0) continue;
        const inputAmount = exchangeInputs.reduce((sum, address) => sum + Number(address.amount), 0);
        const outputAmount = exchangeOutputs.reduce((sum, address) => sum + Number(address.amount), 0);
        transactionOutflow += inputAmount;
        transactionInflow += outputAmount;
      }
      if (transactionInflow + transactionOutflow < MIN_TRANSFER_BTC) continue;
      exchangeInflowsBtc += transactionInflow;
      exchangeOutflowsBtc += transactionOutflow;
      latestTransactionTimestampMs = Math.max(latestTransactionTimestampMs ?? 0, timestampMs);
      transactionCount += 1;
    }

    if (transactionCount === 0 || latestTransactionTimestampMs === null) {
      cachedAtMs = nowMs;
      cachedResult = unavailable();
      return cachedResult;
    }
    cachedAtMs = nowMs;
    cachedResult = {
      status: 'LIVE',
      provider: 'Whale Alert attributed Bitcoin transaction API',
      timestampMs: latestTransactionTimestampMs,
      ageMs: nowMs - latestTransactionTimestampMs,
      qualityPct: 100,
      exchangeInflowsBtc,
      exchangeOutflowsBtc,
      netExchangeFlowBtc: exchangeInflowsBtc - exchangeOutflowsBtc,
      transactionCount,
      windowStartHeight,
      windowEndHeight,
    };
    return { ...cachedResult };
  } catch (error) {
    console.error('[WhaleAlertFlow] On-chain source unavailable:', error);
    cachedAtMs = nowMs;
    cachedResult = unavailable();
    return cachedResult;
  }
}

export function resetWhaleAlertFlowCacheForTests(): void {
  cachedAtMs = 0;
  cachedResult = null;
}
