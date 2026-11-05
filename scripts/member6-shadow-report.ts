import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

type HorizonKey = '15m' | '30m' | '60m';

interface ShadowOutcome {
  status: 'RESOLVED' | 'UNAVAILABLE';
  measuredAtMs?: number;
  price?: number;
  correct?: boolean;
  reason?: string;
}

interface ShadowVoteRecord {
  evaluatedAtMs: number;
  asset: 'BTC' | 'ETH';
  vote: 'LONG' | 'SHORT' | 'NEUTRAL' | 'ABSTAIN';
  confidencePct: number | null;
  totalVolume: number;
  netVolume: number;
  volumeUnit: 'BTC' | 'USD';
  transactionHashes: string[];
  exchanges: string[];
  priceAtVote: number | null;
  outcomes?: Partial<Record<HorizonKey, ShadowOutcome>>;
}

const HORIZONS: ReadonlyArray<{ key: HorizonKey; durationMs: number }> = [
  { key: '15m', durationMs: 15 * 60_000 },
  { key: '30m', durationMs: 30 * 60_000 },
  { key: '60m', durationMs: 60 * 60_000 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShadowVoteRecord(value: unknown): value is ShadowVoteRecord {
  return isRecord(value) &&
    Number.isSafeInteger(value.evaluatedAtMs) &&
    (value.asset === 'BTC' || value.asset === 'ETH') &&
    ['LONG', 'SHORT', 'NEUTRAL', 'ABSTAIN'].includes(String(value.vote)) &&
    typeof value.totalVolume === 'number' &&
    typeof value.netVolume === 'number' &&
    (value.priceAtVote === null || typeof value.priceAtVote === 'number') &&
    Array.isArray(value.transactionHashes) &&
    Array.isArray(value.exchanges);
}

async function fetchPriceAfter(asset: 'BTC' | 'ETH', targetMs: number): Promise<{
  measuredAtMs: number;
  price: number;
} | null> {
  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', `${asset}USDT`);
  url.searchParams.set('interval', '1m');
  url.searchParams.set('startTime', String(targetMs));
  url.searchParams.set('endTime', String(targetMs + 120_000));
  url.searchParams.set('limit', '2');
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Binance kline endpoint returned HTTP ${response.status}.`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Binance kline response is malformed.');
  const candle = payload.find((value) =>
    Array.isArray(value) &&
    Number.isSafeInteger(value[0]) &&
    (value[0] as number) >= targetMs &&
    (value[0] as number) <= targetMs + 60_000 &&
    Number.isSafeInteger(value[6]) &&
    (value[6] as number) <= Date.now() &&
    typeof value[4] === 'string',
  );
  if (!Array.isArray(candle)) return null;
  const price = Number(candle[4]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Binance kline close price is invalid.');
  return { measuredAtMs: Number(candle[6]), price };
}

async function main(): Promise<void> {
  const filePath = path.resolve(
    process.env.SBK1_MEMBER6_SHADOW_LOG_PATH?.trim() || '.cache/sbk1/member6-shadow-votes.jsonl',
  );
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    console.error('[Member6ShadowReport] Could not read shadow vote log:', error);
    process.exitCode = 1;
    return;
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  const records = lines.map((line, index) => {
    try {
      const value: unknown = JSON.parse(line);
      if (!isShadowVoteRecord(value)) throw new Error('Invalid shadow vote record shape.');
      return value;
    } catch (error) {
      throw new Error(`Invalid shadow vote log line ${index + 1}: ${String(error)}`);
    }
  });
  const nowMs = Date.now();
  for (const record of records) {
    if (record.vote !== 'LONG' && record.vote !== 'SHORT') continue;
    for (const horizon of HORIZONS) {
      if (record.outcomes?.[horizon.key]?.status === 'RESOLVED' ||
          nowMs < record.evaluatedAtMs + horizon.durationMs) continue;
      if (record.priceAtVote === null) {
        record.outcomes = {
          ...record.outcomes,
          [horizon.key]: { status: 'UNAVAILABLE', reason: 'No valid price was recorded at vote time.' },
        };
        continue;
      }
      try {
        const quote = await fetchPriceAfter(record.asset, record.evaluatedAtMs + horizon.durationMs);
        if (!quote) continue;
        const correct = record.vote === 'LONG'
          ? quote.price > record.priceAtVote
          : quote.price < record.priceAtVote;
        record.outcomes = {
          ...record.outcomes,
          [horizon.key]: {
            status: 'RESOLVED',
            measuredAtMs: quote.measuredAtMs,
            price: quote.price,
            correct,
          },
        };
      } catch (error) {
        record.outcomes = {
          ...record.outcomes,
          [horizon.key]: {
            status: 'UNAVAILABLE',
            reason: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
  }

  const serialized = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath);

  for (const horizon of HORIZONS) {
    const resolved = records.filter((record) =>
      (record.vote === 'LONG' || record.vote === 'SHORT') &&
      record.outcomes?.[horizon.key]?.status === 'RESOLVED');
    const correct = resolved.filter((record) => record.outcomes?.[horizon.key]?.correct).length;
    const pending = records.filter((record) =>
      (record.vote === 'LONG' || record.vote === 'SHORT') &&
      !record.outcomes?.[horizon.key]).length;
    const accuracy = resolved.length > 0 ? (correct / resolved.length) * 100 : null;
    console.info(
      `${horizon.key}: ${accuracy === null ? 'دادهٔ حل‌شده ندارد' : `${accuracy.toFixed(1)}% درست`}؛ نمونه=${resolved.length}؛ در انتظار=${pending}${resolved.length < 30 ? '؛ نمونه ناکافی (کمتر از ۳۰ رأی)' : ''}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error('[Member6ShadowReport] Report failed:', error);
  process.exitCode = 1;
});
