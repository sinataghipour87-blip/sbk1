import { readFile } from 'node:fs/promises';

export interface VerifiedExchangeLabel {
  address: string;
  exchange: string;
  source: string;
  checkedAt: string;
}

const CACHE_TTL_MS = 60_000;
let cachedAtMs = 0;
let cachedLabels: readonly VerifiedExchangeLabel[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLabelFile(value: unknown): readonly VerifiedExchangeLabel[] {
  if (!isRecord(value) || !Array.isArray(value.labels)) {
    throw new Error('Ethereum exchange label file must contain a labels array.');
  }
  if (value.labels.length === 0) return [];
  const uniqueAddresses = new Set<string>();
  return value.labels.map((label): VerifiedExchangeLabel => {
    if (
      !isRecord(label) ||
      typeof label.address !== 'string' ||
      !/^0x[a-f0-9]{40}$/i.test(label.address) ||
      typeof label.exchange !== 'string' ||
      label.exchange.trim().length === 0 ||
      typeof label.source !== 'string' ||
      typeof label.checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(label.checkedAt))
    ) {
      throw new Error('Ethereum exchange label entry is malformed or does not cite the registry source.');
    }
    const source = new URL(label.source);
    if (source.protocol !== 'https:') {
      throw new Error('Ethereum exchange label source must use HTTPS.');
    }
    const address = label.address.toLowerCase();
    if (uniqueAddresses.has(address)) {
      throw new Error(`Duplicate Ethereum exchange label address ${address}.`);
    }
    uniqueAddresses.add(address);
    return {
      address,
      exchange: label.exchange.trim(),
      source: label.source,
      checkedAt: label.checkedAt,
    };
  });
}

export async function loadVerifiedEthereumExchangeLabels(
  nowMs = Date.now(),
): Promise<readonly VerifiedExchangeLabel[]> {
  if (nowMs >= cachedAtMs && nowMs - cachedAtMs < CACHE_TTL_MS) return cachedLabels;
  const content = await readFile(new URL('./exchangeLabels.json', import.meta.url), 'utf8');
  const labels = parseLabelFile(JSON.parse(content) as unknown);
  cachedLabels = labels;
  cachedAtMs = nowMs;
  return labels;
}

export function resetEthereumExchangeLabelsCacheForTests(): void {
  cachedAtMs = 0;
  cachedLabels = [];
}
