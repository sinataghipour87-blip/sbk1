import type { CouncilWhaleTransfer } from './eightMemberCouncil';

const ETHERSCAN_API = 'https://api.etherscan.io/v2/api';
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const REQUIRED_CONFIRMATIONS = 12;
const DEFAULT_MAX_TRANSFER_AGE_MS = 20 * 60_000;
const MIN_REQUEST_INTERVAL_MS = 350;
let lastRequestAtMs = 0;

interface EtherscanTransaction {
  hash: string;
  timeStamp: string;
  blockNumber: string;
  value: string;
  isError?: string;
}

interface EtherscanTokenTransaction extends EtherscanTransaction {
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
  logIndex: string;
}

let cachedAtMs = 0;
let cachedTransfers: CouncilWhaleTransfer[] = [];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTransaction(value: unknown): value is EtherscanTransaction {
  return record(value) &&
    typeof value.hash === 'string' && /^0x[0-9a-f]{64}$/i.test(value.hash) &&
    typeof value.timeStamp === 'string' && Number.isSafeInteger(Number(value.timeStamp)) &&
    typeof value.blockNumber === 'string' && Number.isSafeInteger(Number(value.blockNumber)) &&
    typeof value.value === 'string' && /^\d+$/.test(value.value) &&
    (value.isError === undefined || typeof value.isError === 'string');
}

function validTokenTransaction(value: unknown): value is EtherscanTokenTransaction {
  if (!record(value) || !validTransaction(value)) return false;
  const item: Record<string, unknown> = value;
  return typeof item.tokenName === 'string' &&
    item.tokenName.length > 0 &&
    typeof item.tokenSymbol === 'string' && item.tokenSymbol.length > 0 &&
    typeof item.tokenDecimal === 'string' && Number.isInteger(Number(item.tokenDecimal)) &&
    Number(item.tokenDecimal) >= 0 && Number(item.tokenDecimal) <= 36 &&
    typeof item.contractAddress === 'string' &&
    /^0x[a-f0-9]{40}$/i.test(item.contractAddress) &&
    typeof item.logIndex === 'string' && /^\d+$/.test(item.logIndex);
}

function unitsToAmount(value: string, decimals: number): number {
  const raw = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = raw % scale;
  const amount = Number(whole) + Number(fraction) / Number(scale);
  if (!Number.isFinite(amount)) throw new Error('Etherscan transaction amount exceeds numeric limits.');
  return amount;
}

async function requestJson(url: URL, fetcher: typeof fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await new Promise((resolve) => setTimeout(resolve,
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1_000, 5_000)
            : 250 * (2 ** attempt)));
        continue;
      }
      if (!response.ok) throw new Error(`Etherscan returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      if (attempt === 2 || (error instanceof Error && error.message.startsWith('Etherscan returned HTTP'))) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Etherscan retries were exhausted.');
}

async function query(
  fetcher: typeof fetch,
  apiKey: string,
  action: string,
  address?: string,
): Promise<unknown[]> {
  const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAtMs));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAtMs = Date.now();
  const url = new URL(ETHERSCAN_API);
  url.searchParams.set('chainid', '1');
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', action);
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '100');
  url.searchParams.set('apikey', apiKey);
  if (address) url.searchParams.set('address', address);
  const payload = await requestJson(url, fetcher);
  if (!record(payload) || !Array.isArray(payload.result)) {
    throw new Error(`Etherscan ${action} response is malformed or unavailable.`);
  }
  if (payload.status !== '1' && payload.message !== 'No transactions found') {
    throw new Error(`Etherscan ${action} query was not successful.`);
  }
  return payload.result;
}

async function queryLatestBlock(fetcher: typeof fetch, apiKey: string): Promise<number> {
  const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAtMs));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAtMs = Date.now();
  const url = new URL(ETHERSCAN_API);
  url.searchParams.set('chainid', '1');
  url.searchParams.set('module', 'proxy');
  url.searchParams.set('action', 'eth_blockNumber');
  url.searchParams.set('apikey', apiKey);
  const payload = await requestJson(url, fetcher);
  if (!record(payload) || typeof payload.result !== 'string' ||
      !/^0x[0-9a-f]+$/i.test(payload.result)) {
    throw new Error('Etherscan latest block response is malformed.');
  }
  const latestBlock = Number.parseInt(payload.result, 16);
  if (!Number.isSafeInteger(latestBlock) || latestBlock <= 0) {
    throw new Error('Etherscan latest block response is malformed.');
  }
  return latestBlock;
}

export function getConfiguredAddresses(): string[] {
  const raw = process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES ?? '';
  const addresses = raw.split(',').map((address) => address.trim().toLowerCase()).filter(Boolean);
  if (addresses.some((address) => !/^0x[a-f0-9]{40}$/.test(address))) {
    throw new Error('SBK1_ETHERSCAN_WATCH_ADDRESSES contains an invalid Ethereum address.');
  }
  if (new Set(addresses).size > 10) throw new Error('Etherscan supports at most 10 configured watch addresses.');
  return [...new Set(addresses)];
}

function getErc20Thresholds(): Map<string, number> {
  const result = new Map<string, number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(process.env.SBK1_WHALE_ERC20_THRESHOLDS ?? '{}');
  } catch {
    throw new Error('SBK1_WHALE_ERC20_THRESHOLDS must be a valid JSON object.');
  }
  if (!record(parsed)) throw new Error('SBK1_WHALE_ERC20_THRESHOLDS must be a JSON object.');
  for (const [contract, value] of Object.entries(parsed)) {
    const normalized = contract.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized) || typeof value !== 'number' ||
        !Number.isFinite(value) || value <= 0) {
      throw new Error('SBK1_WHALE_ERC20_THRESHOLDS must map valid token addresses to positive numeric thresholds.');
    }
    result.set(normalized, value);
  }
  return result;
}

export async function fetchEtherscanWhaleTransfers(options: {
  nowMs: number;
  ethPriceUsd?: number | null;
  fetcher?: typeof fetch;
}): Promise<CouncilWhaleTransfer[]> {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  const addresses = getConfiguredAddresses();
  if (!apiKey || addresses.length === 0) return [];
  const minimumEth = Number(process.env.SBK1_WHALE_MIN_ETH ?? '100');
  if (!Number.isFinite(minimumEth) || minimumEth <= 0) {
    throw new Error('SBK1_WHALE_MIN_ETH must be a positive number.');
  }
  const configuredMaxAge = Number(process.env.SBK1_WHALE_MAX_AGE_MS ?? DEFAULT_MAX_TRANSFER_AGE_MS);
  if (!Number.isFinite(configuredMaxAge) || configuredMaxAge <= 0 || configuredMaxAge > DEFAULT_MAX_TRANSFER_AGE_MS) {
    throw new Error('SBK1_WHALE_MAX_AGE_MS must be a positive number no greater than 1200000.');
  }
  const tokenThresholds = getErc20Thresholds();
  if (options.nowMs >= cachedAtMs && options.nowMs - cachedAtMs < CACHE_TTL_MS) {
    return cachedTransfers.map((transfer) => ({
      ...transfer,
      estimatedUsd: transfer.asset === 'ETH' &&
        typeof options.ethPriceUsd === 'number' && Number.isFinite(options.ethPriceUsd) &&
        options.ethPriceUsd > 0
        ? transfer.amount * options.ethPriceUsd
        : null,
    }));
  }

  const fetcher = options.fetcher ?? fetch;
  const latestBlock = await queryLatestBlock(fetcher, apiKey);
  const addressResponses: Array<[unknown[], unknown[]]> = [];
  for (const address of addresses) {
    const nativeTransactions = await query(fetcher, apiKey, 'txlist', address);
    const tokenTransactions = await query(fetcher, apiKey, 'tokentx', address);
    addressResponses.push([nativeTransactions, tokenTransactions]);
  }
  const ethThreshold = minimumEth;
  const transfers: CouncilWhaleTransfer[] = [];
  const seen = new Set<string>();
  const add = (
    transaction: EtherscanTransaction,
    asset: string,
    amount: number,
    transferId: string,
    estimatedUsd: number | null,
  ) => {
    const timestampSeconds = Number(transaction.timeStamp);
    const blockHeight = Number(transaction.blockNumber);
    if (transaction.isError === '1' || !Number.isFinite(timestampSeconds) ||
        !Number.isSafeInteger(blockHeight) || blockHeight <= 0 ||
        latestBlock - blockHeight < REQUIRED_CONFIRMATIONS ||
        timestampSeconds * 1_000 > options.nowMs ||
        options.nowMs - timestampSeconds * 1_000 > configuredMaxAge) return;
    const dedupeKey = `ethereum:${transaction.hash}:${transferId}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    transfers.push({
      transactionHash: transaction.hash,
      blockchain: 'ethereum',
      blockHeight,
      timestampMs: timestampSeconds * 1_000,
      sourceProvider: 'Etherscan API v2 (configured address watchlist)',
      asset,
      amount,
      estimatedUsd,
      confirmationStatus: 'CONFIRMED',
      transferId,
    });
  };

  for (const response of addressResponses) {
    const [nativeRows, tokenRows] = response;
    if (nativeRows.some((row) => !validTransaction(row)) ||
        tokenRows.some((row) => !validTokenTransaction(row))) {
      throw new Error('Etherscan transaction response contains malformed rows.');
    }
    for (const transaction of nativeRows as EtherscanTransaction[]) {
      const amount = unitsToAmount(transaction.value, 18);
      if (amount >= ethThreshold) {
        const ethPriceUsd = options.ethPriceUsd;
        add(transaction, 'ETH', amount, 'native:0', typeof ethPriceUsd === 'number' &&
          Number.isFinite(ethPriceUsd) && ethPriceUsd > 0 ? amount * ethPriceUsd : null);
      }
    }
    for (const transaction of tokenRows as EtherscanTokenTransaction[]) {
      const tokenContract = transaction.contractAddress.toLowerCase();
      const threshold = tokenThresholds.get(tokenContract);
      const amount = unitsToAmount(transaction.value, Number(transaction.tokenDecimal));
      if (threshold !== undefined && amount >= threshold) {
        add(transaction, transaction.tokenSymbol, amount, `erc20:${tokenContract}:log:${transaction.logIndex}`, null);
      }
    }
  }
  cachedTransfers = transfers;
  cachedAtMs = options.nowMs;
  return transfers.map((transfer) => ({ ...transfer }));
}

export function resetEtherscanWhaleDataCacheForTests(): void {
  cachedAtMs = 0;
  cachedTransfers = [];
  lastRequestAtMs = 0;
}
