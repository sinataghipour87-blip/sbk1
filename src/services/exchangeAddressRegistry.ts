import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getWhaleSourceOperator, type QuorumCandidateRecord, type QuorumObservedTransfer } from './whaleConsensusCandidateRegistry';

export type ExchangeAddressChain = 'BTC' | 'ETH' | 'BNB' | 'SOL' | 'XRP';
export type ExchangeAddressConfidence = 'HIGH' | 'MEDIUM';
export const EXCHANGE_ADDRESS_MAX_AGE_MS = 365 * 24 * 60 * 60_000;

export interface ExchangeAddressRecord {
  chain: ExchangeAddressChain;
  address: string;
  exchange: string;
  label: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
  confidence: ExchangeAddressConfidence;
  note: string;
}

export type ExchangeTransferAttribution =
  | { direction: 'EXCHANGE_INFLOW' | 'EXCHANGE_OUTFLOW'; exchange: ExchangeAddressRecord }
  | { direction: 'UNKNOWN'; exchange: null };

export interface ExchangeTransferAttributionSummary {
  direction: 'INFLOW' | 'OUTFLOW' | 'UNKNOWN';
  exchange: string | null;
}

interface ExchangeAddressFile {
  version: 1;
  addresses: ExchangeAddressRecord[];
}

const DEFAULT_ADDRESS_DIRECTORY = path.resolve(process.cwd(), 'data/whale-addresses');
const ADDRESS_CHAINS: readonly ExchangeAddressChain[] = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeAddress(chain: ExchangeAddressChain, address: string): string {
  if (chain === 'ETH' || chain === 'BNB') return address.toLowerCase();
  return chain === 'BTC' && address.toLowerCase().startsWith('bc1') ? address.toLowerCase() : address;
}

function validAddress(chain: ExchangeAddressChain, address: string): boolean {
  if (chain === 'ETH' || chain === 'BNB') return /^0x[0-9a-f]{40}$/i.test(address);
  if (chain === 'SOL') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (chain === 'XRP') return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
  return /^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{11,71})$/i.test(address);
}

function parseAddressRecord(value: unknown, nowMs: number): ExchangeAddressRecord | null {
  const retrievedAtMs = isRecord(value) && typeof value.retrievedAt === 'string'
    ? Date.parse(value.retrievedAt)
    : Number.NaN;
  if (
    !isRecord(value) ||
    !['BTC', 'ETH', 'BNB', 'SOL', 'XRP'].includes(String(value.chain)) ||
    !nonEmptyString(value.address) ||
    !validAddress(value.chain as ExchangeAddressChain, value.address) ||
    !nonEmptyString(value.exchange) ||
    !nonEmptyString(value.label) ||
    !nonEmptyString(value.sourceName) ||
    !nonEmptyString(value.sourceUrl) ||
    !nonEmptyString(value.retrievedAt) ||
    !Number.isFinite(retrievedAtMs) ||
    retrievedAtMs > nowMs ||
    nowMs - retrievedAtMs > EXCHANGE_ADDRESS_MAX_AGE_MS ||
    (value.confidence !== 'HIGH' && value.confidence !== 'MEDIUM') ||
    typeof value.note !== 'string'
  ) return null;

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(value.sourceUrl);
  } catch {
    return null;
  }
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) return null;

  return {
    chain: value.chain as ExchangeAddressChain,
    address: normalizeAddress(value.chain as ExchangeAddressChain, value.address),
    exchange: value.exchange.trim(),
    label: value.label.trim(),
    sourceName: value.sourceName.trim(),
    sourceUrl: sourceUrl.toString(),
    retrievedAt: new Date(Date.parse(value.retrievedAt)).toISOString(),
    confidence: value.confidence,
    note: value.note.trim(),
  };
}

export function parseExchangeAddressFile(
  value: unknown,
  onIssue: (message: string) => void = (message) => console.error(`[ExchangeAddressRegistry] ${message}`),
  nowMs = Date.now(),
): ExchangeAddressFile {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error('Exchange address registry validation time is invalid.');
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.addresses)) {
    throw new Error('Exchange address file must contain version 1 and an addresses array.');
  }

  const parsed = value.addresses.map((record) => parseAddressRecord(record, nowMs));
  if (parsed.some((record) => record === null)) {
    throw new Error('Exchange address file contains an invalid address record.');
  }

  const byAddress = new Map<string, ExchangeAddressRecord[]>();
  for (const record of parsed as ExchangeAddressRecord[]) {
    const key = `${record.chain}:${record.address}`;
    byAddress.set(key, [...(byAddress.get(key) ?? []), record]);
  }
  const addresses: ExchangeAddressRecord[] = [];
  for (const [key, records] of byAddress) {
    if (records.length > 1) {
      const exchanges = new Set(records.map(({ exchange }) => exchange.toLowerCase()));
      onIssue(exchanges.size > 1
        ? `Ambiguous exchange address removed: ${key}.`
        : `Duplicate exchange address removed: ${key}.`);
      continue;
    }
    addresses.push(records[0]);
  }
  return { version: 1, addresses };
}

export async function loadExchangeAddressRegistry(options: {
  filePath?: string;
  onIssue?: (message: string) => void;
} = {}): Promise<ExchangeAddressRecord[]> {
  const onIssue = options.onIssue ?? ((message: string) =>
    console.error(`[ExchangeAddressRegistry] ${message}`));
  const configuredFilePath = options.filePath ?? process.env.SBK1_EXCHANGE_ADDRESS_FILE;
  if (configuredFilePath) {
    try {
      const content = await readFile(configuredFilePath, 'utf8');
      return parseExchangeAddressFile(JSON.parse(content) as unknown, onIssue).addresses;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      onIssue(`Exchange address registry ${configuredFilePath} unavailable: ${reason}`);
      return [];
    }
  }

  const addresses: ExchangeAddressRecord[] = [];
  for (const chain of ADDRESS_CHAINS) {
    const filePath = path.join(DEFAULT_ADDRESS_DIRECTORY, `${chain}.json`);
    try {
      const content = await readFile(filePath, 'utf8');
      const records = parseExchangeAddressFile(JSON.parse(content) as unknown, onIssue).addresses;
      if (records.some((record) => record.chain !== chain)) {
        throw new Error(`Registry contains an address outside its ${chain} file.`);
      }
      addresses.push(...records);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      onIssue(`${chain} address registry ${filePath} unavailable: ${reason}`);
    }
  }
  const deduplicated = parseExchangeAddressFile({ version: 1, addresses }, onIssue);
  return deduplicated.addresses;
}

export function findHighConfidenceExchangeAddress(
  addresses: readonly ExchangeAddressRecord[],
  chain: ExchangeAddressChain,
  address: string,
): ExchangeAddressRecord | null {
  const normalized = normalizeAddress(chain, address);
  const matches = addresses.filter((record) =>
    record.chain === chain &&
    record.address === normalized &&
    record.confidence === 'HIGH'
  );
  return matches.length === 1 ? matches[0] : null;
}

export function classifyExchangeTransfer(
  addresses: readonly ExchangeAddressRecord[],
  input: {
    chain: ExchangeAddressChain;
    fromAddresses: readonly string[];
    toAddresses: readonly string[];
  },
): ExchangeTransferAttribution {
  if (
    input.fromAddresses.length === 0 ||
    input.toAddresses.length === 0 ||
    input.fromAddresses.some((address) => !address.trim()) ||
    input.toAddresses.some((address) => !address.trim()) ||
    new Set(input.fromAddresses).size !== input.fromAddresses.length ||
    new Set(input.toAddresses).size !== input.toAddresses.length
  ) return { direction: 'UNKNOWN', exchange: null };

  const resolveAddresses = (values: readonly string[]): ExchangeAddressRecord[] | null => {
    const result: ExchangeAddressRecord[] = [];
    for (const address of values) {
      const matching = addresses.filter((record) =>
        record.chain === input.chain &&
        record.address === normalizeAddress(input.chain, address));
      if (matching.length > 1 || matching.some(({ confidence }) => confidence !== 'HIGH')) return null;
      if (matching[0]) result.push(matching[0]);
    }
    return result;
  };
  const fromMatches = resolveAddresses(input.fromAddresses);
  const toMatches = resolveAddresses(input.toAddresses);
  if (!fromMatches || !toMatches) return { direction: 'UNKNOWN', exchange: null };
  const fromExchanges = new Set(fromMatches.flatMap((record) => record ? [record.exchange.toLowerCase()] : []));
  const toExchanges = new Set(toMatches.flatMap((record) => record ? [record.exchange.toLowerCase()] : []));
  if (fromExchanges.size > 1 || toExchanges.size > 1) return { direction: 'UNKNOWN', exchange: null };
  if (fromExchanges.size === 1 && toExchanges.size === 1) return { direction: 'UNKNOWN', exchange: null };

  if (toExchanges.size === 1 && fromExchanges.size === 0) {
    const exchange = toMatches.find((record): record is ExchangeAddressRecord => record !== null)!;
    return { direction: 'EXCHANGE_INFLOW', exchange };
  }
  if (fromExchanges.size === 1 && toExchanges.size === 0) {
    const exchange = fromMatches.find((record): record is ExchangeAddressRecord => record !== null)!;
    return { direction: 'EXCHANGE_OUTFLOW', exchange };
  }
  return { direction: 'UNKNOWN', exchange: null };
}

export function attributeExchangeTransfer(
  addresses: readonly ExchangeAddressRecord[],
  input: {
    chain: ExchangeAddressChain;
    fromAddress: string;
    toAddress: string;
  },
): ExchangeTransferAttributionSummary {
  const result = classifyExchangeTransfer(addresses, {
    chain: input.chain,
    fromAddresses: [input.fromAddress],
    toAddresses: [input.toAddress],
  });
  if (result.direction === 'UNKNOWN') return { direction: 'UNKNOWN', exchange: null };
  return {
    direction: result.direction === 'EXCHANGE_INFLOW' ? 'INFLOW' : 'OUTFLOW',
    exchange: result.exchange.exchange,
  };
}

export function createAttributedQuorumCandidate(
  transfer: QuorumObservedTransfer,
  addresses: readonly ExchangeAddressRecord[],
  priceUsd: { value: number; sourceTimestampMs: number; retrievedAtMs: number },
  nowMs: number,
): QuorumCandidateRecord | null {
  if (
    !['BTC', 'ETH', 'BNB', 'SOL', 'XRP'].includes(transfer.assetSymbol) ||
    transfer.confirmationStatus !== 'CONFIRMED' ||
    !Number.isSafeInteger(transfer.timestampMs) ||
    transfer.timestampMs > nowMs ||
    nowMs - transfer.timestampMs > 5 * 60_000 ||
    !Number.isSafeInteger(priceUsd.retrievedAtMs) ||
    priceUsd.retrievedAtMs > nowMs ||
    nowMs - priceUsd.retrievedAtMs > 5 * 60_000 ||
    !Number.isSafeInteger(priceUsd.sourceTimestampMs) ||
    priceUsd.sourceTimestampMs > nowMs ||
    nowMs - priceUsd.sourceTimestampMs > 5 * 60_000 ||
    !Number.isFinite(priceUsd.value) ||
    priceUsd.value <= 0 ||
    !Number.isFinite(transfer.amount) ||
    transfer.amount <= 0
  ) return null;

  const classification = classifyExchangeTransfer(addresses, {
    chain: transfer.assetSymbol,
    fromAddresses: transfer.fromAddresses ?? [],
    toAddresses: transfer.toAddresses ?? [],
  });
  if (classification.direction === 'UNKNOWN') return null;

  const transferOperators = new Set(transfer.sourceIds.flatMap((sourceId) => {
    const operator = getWhaleSourceOperator(transfer.assetSymbol, sourceId);
    return operator ? [operator] : [];
  }));
  if (transferOperators.size < 2) return null;

  const estimatedUsd = transfer.amount * priceUsd.value;
  if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) return null;
  const observations: QuorumCandidateRecord['observations'] = transfer.sourceIds.map((sourceId) => ({
    sourceId,
    evidenceType: 'TRANSFER' as const,
    blockchain: transfer.blockchain,
    transactionHash: transfer.transactionHash,
    transferId: transfer.transferId,
    amount: transfer.amount,
    timestampMs: transfer.timestampMs,
    confirmationStatus: 'CONFIRMED' as const,
  }));
  observations.push({
    sourceId: 'local-exchange-address-list',
    evidenceType: 'ATTRIBUTION',
    blockchain: transfer.blockchain,
    transactionHash: transfer.transactionHash,
    transferId: transfer.transferId,
    direction: classification.direction,
    amount: transfer.amount,
    timestampMs: transfer.timestampMs,
    confirmationStatus: 'CONFIRMED',
    exchangeName: classification.exchange.exchange,
    exchangeAddress: classification.exchange.address,
  });
  return {
    assetSymbol: transfer.assetSymbol,
    blockchain: transfer.blockchain,
    transactionHash: transfer.transactionHash,
    transferId: transfer.transferId,
    timestampMs: transfer.timestampMs,
    amount: transfer.amount,
    estimatedUsd,
    direction: classification.direction,
    confirmationStatus: 'CONFIRMED',
    observations,
    blockHeight: transfer.blockHeight,
  };
}
