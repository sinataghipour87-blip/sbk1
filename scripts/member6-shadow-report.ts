import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  listMember6ShadowLogPaths,
  member6ShadowLogBasePath,
  member6ShadowSegmentPath,
  pruneExpiredMember6ShadowLogs,
} from '../src/services/member6ShadowLog';

type HorizonKey = '15m' | '30m' | '60m';
type ShadowAsset = 'BTC' | 'ETH' | 'BNB' | 'SOL' | 'XRP';

export interface ShadowOutcome {
  status: 'RESOLVED' | 'UNAVAILABLE';
  measuredAtMs?: number;
  price?: number;
  correct?: boolean;
  reason?: string;
  attempts?: number;
  retryAfterMs?: number;
  terminal?: boolean;
}

interface ShadowVoteRecord {
  recordId?: string;
  evaluatedAtMs: number;
  asset: ShadowAsset;
  vote: 'LONG' | 'SHORT' | 'NEUTRAL' | 'ABSTAIN';
  confidencePct: number | null;
  totalVolume: number;
  netVolume: number;
  volumeUnit: 'BTC' | 'USD';
  transactionHashes: string[];
  exchanges: string[];
  priceAtVote: number | null;
  marketPair?: string | null;
  marketExchange?: string | null;
  marketType?: 'spot' | 'futures' | null;
  outcomes?: Partial<Record<HorizonKey, ShadowOutcome>>;
}

interface ShadowOutcomeRecord {
  recordId: string;
  horizon: HorizonKey;
  evaluatedAtMs?: number;
  outcome: ShadowOutcome;
}

interface HorizonStats {
  resolved: number;
  correct: number;
  pending: number;
  unavailable: number;
}

const ASSETS: readonly ShadowAsset[] = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'];
const HORIZONS: ReadonlyArray<{ key: HorizonKey; durationMs: number }> = [
  { key: '15m', durationMs: 15 * 60_000 },
  { key: '30m', durationMs: 30 * 60_000 },
  { key: '60m', durationMs: 60 * 60_000 },
];
const OUTCOME_BATCH_SIZE = 100;
const MAX_CONCURRENT_RECORDS = 4;
const MAX_PRICE_LOOKUP_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShadowOutcome(value: unknown): value is ShadowOutcome {
  if (!isRecord(value)) return false;
  if (value.status === 'RESOLVED') {
    return Number.isSafeInteger(value.measuredAtMs) &&
      typeof value.price === 'number' && Number.isFinite(value.price) && value.price > 0 &&
      typeof value.correct === 'boolean';
  }
  return value.status === 'UNAVAILABLE' &&
    typeof value.reason === 'string' &&
    (value.measuredAtMs === undefined || Number.isSafeInteger(value.measuredAtMs)) &&
    (value.price === undefined || (typeof value.price === 'number' && Number.isFinite(value.price))) &&
    (value.correct === undefined || typeof value.correct === 'boolean') &&
    (value.attempts === undefined ||
      (typeof value.attempts === 'number' &&
        Number.isSafeInteger(value.attempts) && value.attempts >= 1)) &&
    (value.retryAfterMs === undefined ||
      (typeof value.retryAfterMs === 'number' && Number.isSafeInteger(value.retryAfterMs))) &&
    (value.terminal === undefined || typeof value.terminal === 'boolean');
}

export function shouldRetryUnavailableOutcome(
  outcome: ShadowOutcome | undefined,
  nowMs: number,
): boolean {
  const attempts = outcome?.attempts;
  const retryAfterMs = outcome?.retryAfterMs;
  return outcome?.status === 'UNAVAILABLE' &&
    outcome.terminal !== true &&
    typeof attempts === 'number' &&
    Number.isSafeInteger(attempts) &&
    attempts < MAX_PRICE_LOOKUP_ATTEMPTS &&
    typeof retryAfterMs === 'number' &&
    Number.isSafeInteger(retryAfterMs) &&
    nowMs >= retryAfterMs;
}

export function makeUnavailableOutcome(
  reason: string,
  previousAttempts: number,
  nowMs: number,
): ShadowOutcome {
  const attempts = Math.min(previousAttempts + 1, MAX_PRICE_LOOKUP_ATTEMPTS);
  const retryDelay = RETRY_DELAYS_MS[attempts - 1];
  return {
    status: 'UNAVAILABLE',
    reason,
    attempts,
    ...(attempts < MAX_PRICE_LOOKUP_ATTEMPTS && retryDelay !== undefined
      ? { retryAfterMs: nowMs + retryDelay }
      : { terminal: true }),
  };
}

function isShadowVoteRecord(value: unknown): value is ShadowVoteRecord {
  return isRecord(value) &&
    Number.isSafeInteger(value.evaluatedAtMs) &&
    ASSETS.includes(value.asset as ShadowAsset) &&
    ['LONG', 'SHORT', 'NEUTRAL', 'ABSTAIN'].includes(String(value.vote)) &&
    (value.confidencePct === null ||
      (typeof value.confidencePct === 'number' && Number.isFinite(value.confidencePct))) &&
    typeof value.totalVolume === 'number' && Number.isFinite(value.totalVolume) &&
    typeof value.netVolume === 'number' && Number.isFinite(value.netVolume) &&
    (value.volumeUnit === 'BTC' || value.volumeUnit === 'USD') &&
    (value.priceAtVote === null ||
      (typeof value.priceAtVote === 'number' && Number.isFinite(value.priceAtVote))) &&
    Array.isArray(value.transactionHashes) &&
    value.transactionHashes.every((hash) => typeof hash === 'string') &&
    Array.isArray(value.exchanges) &&
    value.exchanges.every((exchange) => typeof exchange === 'string') &&
    (value.recordId === undefined || typeof value.recordId === 'string') &&
    (value.marketPair === undefined || value.marketPair === null || typeof value.marketPair === 'string') &&
    (value.marketExchange === undefined || value.marketExchange === null || typeof value.marketExchange === 'string') &&
    (value.marketType === undefined || value.marketType === null ||
      value.marketType === 'spot' || value.marketType === 'futures') &&
    (value.outcomes === undefined ||
      (isRecord(value.outcomes) &&
        Object.values(value.outcomes).every(isShadowOutcome)));
}

export function hasSupportedShadowPriceMarket(record: Pick<
  ShadowVoteRecord,
  'asset' | 'marketPair' | 'marketExchange' | 'marketType'
>): boolean {
  return record.marketPair?.trim().toUpperCase() === `${record.asset}/USDT` &&
    record.marketExchange?.trim().toLowerCase() === 'binance' &&
    record.marketType === 'spot';
}

function isShadowOutcomeRecord(value: unknown): value is ShadowOutcomeRecord {
  return isRecord(value) &&
    typeof value.recordId === 'string' &&
    (value.horizon === '15m' || value.horizon === '30m' || value.horizon === '60m') &&
    (value.evaluatedAtMs === undefined ||
      (typeof value.evaluatedAtMs === 'number' && Number.isSafeInteger(value.evaluatedAtMs))) &&
    isShadowOutcome(value.outcome);
}

function getRecordId(record: ShadowVoteRecord): string {
  if (record.recordId) return record.recordId;
  return `legacy-${createHash('sha256').update(JSON.stringify(record)).digest('hex')}`;
}

function outcomeKey(recordId: string, horizon: HorizonKey): string {
  return `${recordId}:${horizon}`;
}

async function* readJsonLines<T>(
  filePath: string,
  validate: (value: unknown) => value is T,
  label: string,
): AsyncGenerator<T> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of reader) {
    if (!line.trim()) continue;
    lineNumber += 1;
    try {
      const value: unknown = JSON.parse(line);
      if (!validate(value)) throw new Error('Invalid record shape.');
      yield value;
    } catch (error) {
      throw new Error(`Invalid ${label} line ${lineNumber}: ${String(error)}`);
    }
  }
}

async function compactLegacyLog(
  filePath: string,
  keep: (value: Record<string, unknown>) => boolean,
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input, crlfDelay: Infinity });
  const output = createWriteStream(temporaryPath, { encoding: 'utf8', flags: 'wx', mode: 0o600 });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const value: unknown = JSON.parse(line);
      if (!isRecord(value)) throw new Error('Legacy shadow log contains a non-object record.');
      if (keep(value) && !output.write(`${line}\n`)) {
        await new Promise<void>((resolve) => output.once('drain', resolve));
      }
    }
    output.end();
    await finished(output);
    await rename(temporaryPath, filePath);
  } catch (error) {
    output.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function fetchPriceAfter(asset: ShadowAsset, targetMs: number): Promise<{
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

function emptyStats(): Record<ShadowAsset, Record<HorizonKey, HorizonStats>> {
  return Object.fromEntries(ASSETS.map((asset) => [
    asset,
    Object.fromEntries(HORIZONS.map(({ key }) => [
      key,
      { resolved: 0, correct: 0, pending: 0, unavailable: 0 },
    ])),
  ])) as Record<ShadowAsset, Record<HorizonKey, HorizonStats>>;
}

async function main(): Promise<void> {
  const filePath = member6ShadowLogBasePath();
  const nowMs = Date.now();
  await pruneExpiredMember6ShadowLogs(filePath, nowMs);
  const voteLogPaths = await listMember6ShadowLogPaths(filePath, 'votes');
  if (voteLogPaths.length === 0) {
    console.error('[Member6ShadowReport] Could not read shadow vote log: no vote log exists.');
    process.exitCode = 1;
    return;
  }
  const outcomeLogPaths = await listMember6ShadowLogPaths(filePath, 'outcomes');

  const resolvedOutcomes = new Map<string, ShadowOutcome>();
  try {
    for (const outcomeLogPath of outcomeLogPaths) {
      for await (const value of readJsonLines(
        outcomeLogPath,
        isShadowOutcomeRecord,
        'shadow outcome log',
      )) {
        resolvedOutcomes.set(outcomeKey(value.recordId, value.horizon), value.outcome);
      }
    }
  } catch (error) {
    console.error('[Member6ShadowReport] Could not process shadow outcome log:', error);
    process.exitCode = 1;
    return;
  }

  const stats = emptyStats();
  let pendingWrites: ShadowOutcomeRecord[] = [];
  let flushingOutcomes: Promise<void> | null = null;
  const flushOutcomes = async (): Promise<void> => {
    if (flushingOutcomes) {
      await flushingOutcomes;
      if (pendingWrites.length >= OUTCOME_BATCH_SIZE) await flushOutcomes();
      return;
    }
    if (pendingWrites.length === 0) return;
    const batch = pendingWrites;
    pendingWrites = [];
    flushingOutcomes = (async () => {
      const byPath = new Map<string, ShadowOutcomeRecord[]>();
      for (const record of batch) {
        if (record.evaluatedAtMs === undefined) {
          throw new Error('Shadow outcome is missing the vote timestamp required for retention.');
        }
        const outputPath = member6ShadowSegmentPath(filePath, record.evaluatedAtMs, 'outcomes');
        byPath.set(outputPath, [...(byPath.get(outputPath) ?? []), record]);
      }
      await Promise.all([...byPath].map(async ([outputPath, records]) => {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await appendFile(
          outputPath,
          `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
          { encoding: 'utf8', mode: 0o600 },
        );
      }));
    })();
    try {
      await flushingOutcomes;
    } catch (error) {
      pendingWrites = [...batch, ...pendingWrites];
      throw error;
    } finally {
      flushingOutcomes = null;
    }
    if (pendingWrites.length >= OUTCOME_BATCH_SIZE) await flushOutcomes();
  };

  const processRecord = async (record: ShadowVoteRecord): Promise<void> => {
    if (record.vote !== 'LONG' && record.vote !== 'SHORT') return;
    const recordId = getRecordId(record);
    for (const horizon of HORIZONS) {
      const key = outcomeKey(recordId, horizon.key);
      const storedOutcome = resolvedOutcomes.get(key) ?? record.outcomes?.[horizon.key];
      let outcome = storedOutcome;
      const reachedHorizon = nowMs >= record.evaluatedAtMs + horizon.durationMs;
      const shouldFetchPrice = reachedHorizon && (
        outcome === undefined ||
        (outcome.status === 'UNAVAILABLE' && shouldRetryUnavailableOutcome(outcome, nowMs))
      );
      if (shouldFetchPrice) {
        if (!hasSupportedShadowPriceMarket(record)) {
          outcome = {
            status: 'UNAVAILABLE',
            reason: 'Vote-time price market does not match the Binance spot USDT benchmark.',
            attempts: 1,
            terminal: true,
          };
        } else if (record.priceAtVote === null) {
          outcome = {
            status: 'UNAVAILABLE',
            reason: 'No valid price was recorded at vote time.',
            attempts: 1,
            terminal: true,
          };
        } else {
          try {
            const quote = await fetchPriceAfter(record.asset, record.evaluatedAtMs + horizon.durationMs);
            outcome = quote
              ? {
                status: 'RESOLVED',
                measuredAtMs: quote.measuredAtMs,
                price: quote.price,
                correct: record.vote === 'LONG'
                  ? quote.price > record.priceAtVote
                  : quote.price < record.priceAtVote,
              }
              : makeUnavailableOutcome(
                'No completed candle was available at the requested horizon.',
                storedOutcome?.attempts ?? 0,
                nowMs,
              );
          } catch (error) {
            outcome = makeUnavailableOutcome(
              error instanceof Error ? error.message : String(error),
              storedOutcome?.attempts ?? 0,
              nowMs,
            );
          }
        }
        if (outcome !== storedOutcome) {
          resolvedOutcomes.set(key, outcome);
          pendingWrites.push({
            recordId,
            horizon: horizon.key,
            evaluatedAtMs: record.evaluatedAtMs,
            outcome,
          });
          if (pendingWrites.length >= OUTCOME_BATCH_SIZE) await flushOutcomes();
        }
      }

      const summary = stats[record.asset][horizon.key];
      if (outcome?.status === 'RESOLVED') {
        summary.resolved += 1;
        if (outcome.correct) summary.correct += 1;
      } else if (outcome?.status === 'UNAVAILABLE') {
        summary.unavailable += 1;
      } else {
        summary.pending += 1;
      }
    }
  };

  let voteCount = 0;
  const recentVoteIds = new Set<string>();
  let batch: ShadowVoteRecord[] = [];
  try {
    for (const voteLogPath of voteLogPaths) {
      for await (const record of readJsonLines(
        voteLogPath,
        isShadowVoteRecord,
        'shadow vote log',
      )) {
        if (record.evaluatedAtMs < nowMs - 90 * 24 * 60 * 60_000) continue;
        voteCount += 1;
        recentVoteIds.add(getRecordId(record));
        batch.push(record);
        if (batch.length >= MAX_CONCURRENT_RECORDS) {
          await Promise.all(batch.map(processRecord));
          batch = [];
        }
      }
    }
    if (batch.length > 0) await Promise.all(batch.map(processRecord));
  } catch (error) {
    console.error('[Member6ShadowReport] Could not process shadow vote log:', error);
    process.exitCode = 1;
    return;
  }
  await flushOutcomes();
  if (voteLogPaths.includes(filePath)) {
    await compactLegacyLog(filePath, (value) =>
      typeof value.evaluatedAtMs === 'number' &&
      Number.isSafeInteger(value.evaluatedAtMs) &&
      value.evaluatedAtMs >= nowMs - 90 * 24 * 60 * 60_000);
  }
  const legacyOutcomePath = `${filePath}.outcomes.jsonl`;
  if (outcomeLogPaths.includes(legacyOutcomePath)) {
    await compactLegacyLog(legacyOutcomePath, (value) =>
      typeof value.recordId === 'string' && recentVoteIds.has(value.recordId));
  }

  console.info(`Member 6 Shadow: ${voteCount} رکورد؛ گزارش به تفکیک دارایی`);
  for (const asset of ASSETS) {
    for (const horizon of HORIZONS) {
      const summary = stats[asset][horizon.key];
      const accuracy = summary.resolved > 0
        ? `${((summary.correct / summary.resolved) * 100).toFixed(1)}% درست`
        : 'دادهٔ حل‌شده ندارد';
      console.info(
        `${asset} ${horizon.key}: ${accuracy}؛ نمونه=${summary.resolved}؛ در انتظار=${summary.pending}؛ ناموجود=${summary.unavailable}${summary.resolved < 30 ? '؛ نمونه ناکافی (کمتر از ۳۰ رأی)' : ''}`,
      );
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error('[Member6ShadowReport] Report failed:', error);
    process.exitCode = 1;
  });
}
