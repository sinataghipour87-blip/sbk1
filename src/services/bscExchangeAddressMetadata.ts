import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const METADATA_API = 'https://api-metadata.etherscan.io/v2/api';
const EXPORT_HOST = 'metadata-export.etherscan.io';
const CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_EXPORT_BYTES = 24 * 1024 * 1024;
const DEFAULT_CACHE_PATH = path.resolve(process.cwd(), '.cache/sbk1/bsc-exchange-addresses.json');

export interface BscExchangeAddress {
  address: string;
  entityName: string;
  labels: string[];
  sourceUpdatedAtMs: number | null;
}

export interface BscExchangeAddressRegistry {
  status: 'LIVE' | 'UNAVAILABLE';
  provider: 'Etherscan Metadata Enterprise';
  retrievedAtMs: number | null;
  addresses: BscExchangeAddress[];
  reason?: string;
}

interface CachedRegistry {
  version: 1;
  retrievedAtMs: number;
  addresses: BscExchangeAddress[];
}

let inMemoryCache: CachedRegistry | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function unavailable(reason: string): BscExchangeAddressRegistry {
  return {
    status: 'UNAVAILABLE',
    provider: 'Etherscan Metadata Enterprise',
    retrievedAtMs: null,
    addresses: [],
    reason,
  };
}

async function fetchText(
  url: string,
  fetcher: typeof fetch,
  maxBytes = 256 * 1024,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json, text/csv' },
    });
    if (!response.ok) throw new Error(`Metadata provider returned HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error('Metadata response exceeded the configured size limit.');
    }
    return await readLimitedText(response, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new Error('Metadata response body is unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('Metadata export exceeded the configured size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
    ? ';'
    : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('Metadata CSV contains an unterminated quoted field.');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function parseExchangeAddresses(csv: string): BscExchangeAddress[] {
  const rows = parseCsv(csv);
  const header = rows.shift()?.map((value) => value.trim().toLowerCase());
  if (!header) throw new Error('Metadata CSV is empty.');
  const columns = new Map(header.map((value, index) => [value, index]));
  const indexOf = (...names: string[]) => names
    .map((name) => columns.get(name))
    .find((index) => index !== undefined);
  const addressIndex = indexOf('address');
  const nameIndex = indexOf('nametag', 'name');
  const labelsIndex = indexOf('labels_slug', 'labels');
  const updatedAtIndex = indexOf('lastupdatedtimestamp');
  if (addressIndex === undefined || nameIndex === undefined || labelsIndex === undefined) {
    throw new Error('Metadata CSV is missing address, nametag, or labels columns.');
  }

  const addresses = new Map<string, BscExchangeAddress>();
  for (const row of rows) {
    const address = row[addressIndex]?.trim().toLowerCase();
    const entityName = row[nameIndex]?.trim();
    const rawLabels = row[labelsIndex]?.trim() ?? '';
    const labels = rawLabels.split(/[|,]/).map((label) => label.trim()).filter(Boolean);
    if (
      !address ||
      !/^0x[a-f0-9]{40}$/.test(address) ||
      !entityName ||
      !labels.some((label) => /^(exchange|cex)$/i.test(label))
    ) continue;
    const updatedAtSeconds = updatedAtIndex === undefined ? Number.NaN : Number(row[updatedAtIndex]);
    addresses.set(address, {
      address,
      entityName,
      labels,
      sourceUpdatedAtMs: Number.isSafeInteger(updatedAtSeconds) && updatedAtSeconds > 0
        ? updatedAtSeconds * 1_000
        : null,
    });
  }
  if (addresses.size === 0) {
    throw new Error('Metadata export contained no BSC addresses with an explicit Exchange label.');
  }
  return [...addresses.values()];
}

function validCachedRegistry(value: unknown): value is CachedRegistry {
  if (!isRecord(value) ||
      value.version !== 1 ||
      !isSafeTimestamp(value.retrievedAtMs) ||
      !Array.isArray(value.addresses)) return false;
  return value.addresses.every((address) =>
    isRecord(address) &&
    typeof address.address === 'string' &&
    /^0x[a-f0-9]{40}$/.test(address.address) &&
    typeof address.entityName === 'string' &&
    Array.isArray(address.labels) &&
    address.labels.some((label) => typeof label === 'string' && /^(exchange|cex)$/i.test(label)) &&
    (address.sourceUpdatedAtMs === null || isSafeTimestamp(address.sourceUpdatedAtMs))
  );
}

async function readDiskCache(filePath: string): Promise<CachedRegistry | null> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    return validCachedRegistry(value) ? value : null;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeDiskCache(filePath: string, value: CachedRegistry): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function downloadExchangeAddressExport(
  apiKey: string,
  fetcher: typeof fetch,
): Promise<BscExchangeAddress[]> {
  const url = new URL(METADATA_API);
  url.searchParams.set('chainid', '56');
  url.searchParams.set('module', 'nametag');
  url.searchParams.set('action', 'exportaddresstags');
  url.searchParams.set('label', 'exchange');
  url.searchParams.set('format', 'csv');
  url.searchParams.set('apikey', apiKey);

  const apiPayload = await fetchText(url.toString(), fetcher);
  let payload: unknown;
  try {
    payload = JSON.parse(apiPayload) as unknown;
  } catch {
    throw new Error('Metadata export response was not valid JSON.');
  }
  if (!isRecord(payload) || payload.status !== '1' || typeof payload.result !== 'string') {
    throw new Error('Metadata export request did not return a download URL.');
  }
  const exportUrl = new URL(payload.result);
  if (exportUrl.protocol !== 'https:' || exportUrl.hostname !== EXPORT_HOST) {
    throw new Error('Metadata export returned an untrusted download host.');
  }
  const exportCsv = await fetchText(exportUrl.toString(), fetcher, MAX_EXPORT_BYTES);
  return parseExchangeAddresses(exportCsv);
}

export async function fetchBscExchangeAddressRegistry(options: {
  nowMs?: number;
  fetcher?: typeof fetch;
  cachePath?: string;
  forceRefresh?: boolean;
} = {}): Promise<BscExchangeAddressRegistry> {
  const nowMs = options.nowMs ?? Date.now();
  const filePath = options.cachePath ??
    process.env.SBK1_BSC_EXCHANGE_ADDRESSES_PATH ??
    DEFAULT_CACHE_PATH;
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    return unavailable('Metadata cache evaluation timestamp is invalid.');
  }

  let cache = inMemoryCache;
  if (!cache) {
    try {
      cache = await readDiskCache(filePath);
      if (cache) inMemoryCache = cache;
    } catch (error) {
      console.error('[BscExchangeAddressMetadata] Cached metadata is unreadable:', error);
      return unavailable('Cached BSC exchange metadata is malformed or unreadable.');
    }
  }
  if (
    !options.forceRefresh &&
    cache &&
    nowMs >= cache.retrievedAtMs &&
    nowMs - cache.retrievedAtMs <= CACHE_TTL_MS
  ) {
    return {
      status: 'LIVE',
      provider: 'Etherscan Metadata Enterprise',
      retrievedAtMs: cache.retrievedAtMs,
      addresses: cache.addresses,
    };
  }

  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    return cache && nowMs >= cache.retrievedAtMs && nowMs - cache.retrievedAtMs <= CACHE_TTL_MS
      ? {
        status: 'LIVE',
        provider: 'Etherscan Metadata Enterprise',
        retrievedAtMs: cache.retrievedAtMs,
        addresses: cache.addresses,
      }
      : unavailable('ETHERSCAN_API_KEY is required for the BSC Metadata Enterprise export.');
  }

  try {
    const addresses = await downloadExchangeAddressExport(apiKey, options.fetcher ?? fetch);
    const updatedCache: CachedRegistry = { version: 1, retrievedAtMs: nowMs, addresses };
    await writeDiskCache(filePath, updatedCache);
    inMemoryCache = updatedCache;
    return {
      status: 'LIVE',
      provider: 'Etherscan Metadata Enterprise',
      retrievedAtMs: nowMs,
      addresses,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Metadata export failed.';
    console.error('[BscExchangeAddressMetadata] Metadata refresh failed:', reason);
    if (cache && nowMs >= cache.retrievedAtMs && nowMs - cache.retrievedAtMs <= CACHE_TTL_MS) {
      return {
        status: 'LIVE',
        provider: 'Etherscan Metadata Enterprise',
        retrievedAtMs: cache.retrievedAtMs,
        addresses: cache.addresses,
        reason: `Metadata refresh failed; a fresh local copy is being used (${reason}).`,
      };
    }
    return unavailable(reason);
  }
}

export function resetBscExchangeAddressMetadataCacheForTests(): void {
  inMemoryCache = null;
}
