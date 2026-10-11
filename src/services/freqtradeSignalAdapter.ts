import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SBK_SIGNAL_CONTRACT_VERSION = 'sbk1.freqtrade.signal.v1';
export const DRY_RUN_FIXTURE_SETUP_PREFIX = 'DRY_RUN_E2E_FIXTURE_';

export type SbkSignalDirection = 'LONG' | 'SHORT';
export type SbkSignalStatus =
  | 'ACCEPTED'
  | 'STRATEGY_ACCEPTED'
  | 'ORDER_SUBMITTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'ERROR';

export interface SbkFreqtradeSignal {
  contractVersion: typeof SBK_SIGNAL_CONTRACT_VERSION;
  decisionId: string;
  signalId: string;
  exchange: string;
  market: 'spot' | 'futures';
  pair: string;
  direction: SbkSignalDirection;
  timeframe: string;
  generatedAtMs: number;
  expiresAtMs: number;
  referencePrice: number;
  dataQuality: {
    status: 'LIVE';
    source: string;
    observedAtMs: number;
    maxAgeMs: number;
  };
  entryConditions: {
    setupType: string;
    stopLoss: number;
    takeProfit: number;
    maxPriceDeviationBps: number;
  };
  riskLimits: {
    riskBudgetPct: number;
    maxStakeQuote: number;
    maxLeverage: number;
  };
}

export interface SbkFreqtradeSignalRecord {
  signal: SbkFreqtradeSignal;
  status: SbkSignalStatus;
  createdAtMs: number;
  updatedAtMs: number;
  reason?: string;
  tradeId?: number;
  filledAmount?: number;
  averageFillPrice?: number;
  duplicate?: boolean;
}

interface SignalStore {
  version: 1;
  records: SbkFreqtradeSignalRecord[];
}

export interface SignalStatusUpdate {
  status: SbkSignalStatus;
  reason?: string;
  tradeId?: number;
  filledAmount?: number;
  averageFillPrice?: number;
}

export class SbkSignalValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SbkSignalValidationError';
  }
}

const allowedTransitions: Record<SbkSignalStatus, ReadonlySet<SbkSignalStatus>> = {
  ACCEPTED: new Set(['STRATEGY_ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'ERROR']),
  STRATEGY_ACCEPTED: new Set(['ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'ERROR']),
  ORDER_SUBMITTED: new Set(['PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED', 'ERROR']),
  PARTIALLY_FILLED: new Set(['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'ERROR']),
  FILLED: new Set(),
  REJECTED: new Set(),
  EXPIRED: new Set(),
  CANCELLED: new Set(),
  ERROR: new Set(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function safeIdEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function isValidBridgeToken(candidate: string | undefined, configured: string | undefined): boolean {
  if (!candidate || !configured || configured.length < 32) return false;
  return safeIdEqual(candidate, configured);
}

export function deriveSbkSignalIds(input: {
  pair: string;
  direction: SbkSignalDirection;
  setupType: string;
  generatedAtMs: number;
  sweptLevelPrice: number;
  referencePrice: number;
  stopLoss: number;
  takeProfit: number;
}): { decisionId: string; signalId: string } {
  const digest = createHash('sha256')
    .update([
      input.pair,
      input.direction,
      input.setupType,
      Math.floor(input.generatedAtMs / 300_000),
      input.sweptLevelPrice.toFixed(2),
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
  return { decisionId: `sbk1_${digest}`, signalId: `sbk1_${digest}` };
}

export function validateSbkFreqtradeSignal(
  value: unknown,
  options: { nowMs?: number; expectedPair?: string; expectedExchange?: string; expectedTimeframe?: string } = {},
): SbkFreqtradeSignal {
  const nowMs = options.nowMs ?? Date.now();
  if (!isRecord(value)) {
    throw new SbkSignalValidationError('Signal payload must be an object.', 'INVALID_SIGNAL');
  }

  const signal = value as unknown as SbkFreqtradeSignal;
  const isDryRunFixture =
    isRecord(signal.entryConditions) &&
    typeof signal.entryConditions.setupType === 'string' &&
    signal.entryConditions.setupType.startsWith(DRY_RUN_FIXTURE_SETUP_PREFIX);
  const maximumSignalAgeMs = isDryRunFixture ? 55_000 : 15_000;
  if (signal.contractVersion !== SBK_SIGNAL_CONTRACT_VERSION) {
    throw new SbkSignalValidationError('Unsupported signal contract version.', 'UNSUPPORTED_CONTRACT_VERSION');
  }
  if (!/^sbk1_[a-f0-9]{32}$/.test(signal.decisionId) || !/^sbk1_[a-f0-9]{32}$/.test(signal.signalId)) {
    throw new SbkSignalValidationError('Decision and signal identifiers are invalid.', 'INVALID_SIGNAL_ID');
  }
  if (signal.decisionId !== signal.signalId) {
    throw new SbkSignalValidationError('Decision and signal identifiers must refer to the same immutable decision.', 'ID_MISMATCH');
  }
  if (
    typeof signal.exchange !== 'string' ||
    !/^[a-z0-9_-]{2,32}$/i.test(signal.exchange) ||
    (options.expectedExchange && signal.exchange.toLowerCase() !== options.expectedExchange.toLowerCase())
  ) {
    throw new SbkSignalValidationError('Signal exchange does not match the configured execution venue.', 'EXCHANGE_MISMATCH');
  }
  if (signal.market !== 'spot' && signal.market !== 'futures') {
    throw new SbkSignalValidationError('Signal market must be spot or futures.', 'INVALID_MARKET');
  }
  if (
    typeof signal.pair !== 'string' ||
    !/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}(?::[A-Z0-9]{2,20})?$/.test(signal.pair) ||
    (options.expectedPair && signal.pair !== options.expectedPair)
  ) {
    throw new SbkSignalValidationError('Signal pair does not match the configured execution pair.', 'PAIR_MISMATCH');
  }
  if (signal.direction !== 'LONG' && signal.direction !== 'SHORT') {
    throw new SbkSignalValidationError('Signal direction must be LONG or SHORT.', 'INVALID_DIRECTION');
  }
  if (signal.direction === 'SHORT' && signal.market === 'spot') {
    throw new SbkSignalValidationError('Short entries are not supported for spot markets.', 'SHORT_SPOT_UNSUPPORTED');
  }
  if (typeof signal.timeframe !== 'string' || !/^\d+[mhdw]$/.test(signal.timeframe)) {
    throw new SbkSignalValidationError('Signal timeframe is invalid.', 'INVALID_TIMEFRAME');
  }
  if (options.expectedTimeframe && signal.timeframe !== options.expectedTimeframe) {
    throw new SbkSignalValidationError('Signal timeframe does not match the configured strategy timeframe.', 'TIMEFRAME_MISMATCH');
  }
  if (
    !Number.isSafeInteger(signal.generatedAtMs) ||
    signal.generatedAtMs > nowMs + 1_000 ||
    nowMs - signal.generatedAtMs > maximumSignalAgeMs ||
    !Number.isSafeInteger(signal.expiresAtMs) ||
    signal.expiresAtMs <= nowMs ||
    signal.expiresAtMs - signal.generatedAtMs > 60_000
  ) {
    throw new SbkSignalValidationError('Signal is stale, future-dated, or has an invalid expiry.', 'SIGNAL_EXPIRED');
  }
  if (!finitePositive(signal.referencePrice)) {
    throw new SbkSignalValidationError('Reference price must be finite and positive.', 'INVALID_REFERENCE_PRICE');
  }
  const maximumDataAgeMs = isDryRunFixture ? 55_000 : 5_000;
  if (
    !isRecord(signal.dataQuality) ||
    signal.dataQuality.status !== 'LIVE' ||
    typeof signal.dataQuality.source !== 'string' ||
    !signal.dataQuality.source.trim() ||
    !Number.isSafeInteger(signal.dataQuality.observedAtMs) ||
    signal.dataQuality.observedAtMs > nowMs + 1_000 ||
    nowMs - signal.dataQuality.observedAtMs > maximumDataAgeMs ||
    !Number.isSafeInteger(signal.dataQuality.maxAgeMs) ||
    signal.dataQuality.maxAgeMs <= 0 ||
    signal.dataQuality.maxAgeMs > maximumDataAgeMs ||
    nowMs - signal.dataQuality.observedAtMs > signal.dataQuality.maxAgeMs
  ) {
    throw new SbkSignalValidationError('Live data quality evidence is missing or stale.', 'INVALID_DATA_QUALITY');
  }
  if (
    !isRecord(signal.entryConditions) ||
    typeof signal.entryConditions.setupType !== 'string' ||
    !signal.entryConditions.setupType.trim() ||
    !finitePositive(signal.entryConditions.stopLoss) ||
    !finitePositive(signal.entryConditions.takeProfit) ||
    !finitePositive(signal.entryConditions.maxPriceDeviationBps) ||
    signal.entryConditions.maxPriceDeviationBps > 100
  ) {
    throw new SbkSignalValidationError('Entry, stop, target, or price-deviation condition is invalid.', 'INVALID_ENTRY_CONDITIONS');
  }
  const stopValid = signal.direction === 'LONG'
    ? signal.entryConditions.stopLoss < signal.referencePrice && signal.entryConditions.takeProfit > signal.referencePrice
    : signal.entryConditions.stopLoss > signal.referencePrice && signal.entryConditions.takeProfit < signal.referencePrice;
  const riskDistance = Math.abs(signal.referencePrice - signal.entryConditions.stopLoss);
  const rewardDistance = Math.abs(signal.entryConditions.takeProfit - signal.referencePrice);
  if (!stopValid || rewardDistance < riskDistance) {
    throw new SbkSignalValidationError('Stop/target direction or minimum 1:1 reward-to-risk is invalid.', 'INVALID_RISK_REWARD');
  }
  if (
    !isRecord(signal.riskLimits) ||
    typeof signal.riskLimits.riskBudgetPct !== 'number' ||
    !Number.isFinite(signal.riskLimits.riskBudgetPct) ||
    signal.riskLimits.riskBudgetPct <= 0 ||
    signal.riskLimits.riskBudgetPct > 1.5 ||
    !finitePositive(signal.riskLimits.maxStakeQuote) ||
    !Number.isFinite(signal.riskLimits.maxLeverage) ||
    signal.riskLimits.maxLeverage < 1 ||
    signal.riskLimits.maxLeverage > 20
  ) {
    throw new SbkSignalValidationError('Position sizing exceeds configured risk limits.', 'INVALID_RISK_LIMITS');
  }
  return signal;
}

export class FreqtradeSignalAdapter {
  private readonly recordsById = new Map<string, SbkFreqtradeSignalRecord>();
  private loaded = false;
  private operationQueue: Promise<void> = Promise.resolve();

  private get storePath(): string {
    return process.env.SBK1_SIGNAL_STORE_PATH?.trim() || path.resolve('data/freqtrade-signals.json');
  }

  private async withExclusiveAccess<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.operationQueue;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const filePath = this.storePath;
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error('Signal store has an unsupported or invalid structure.');
      }
      for (const value of parsed.records) {
        if (!isRecord(value) || !isRecord(value.signal) || typeof value.status !== 'string') {
          throw new Error('Signal store contains an invalid record.');
        }
        const record = value as unknown as SbkFreqtradeSignalRecord;
        const validated = validateSbkFreqtradeSignal(record.signal, {
          nowMs: Math.max(record.signal.generatedAtMs, record.signal.dataQuality.observedAtMs),
        });
        if (
          !allowedTransitions[record.status] ||
          !Number.isSafeInteger(record.createdAtMs) ||
          !Number.isSafeInteger(record.updatedAtMs)
        ) {
          throw new Error('Signal store contains an invalid lifecycle record.');
        }
        record.signal = validated;
        this.recordsById.set(validated.signalId, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Could not load the Freqtrade signal store: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const filePath = this.storePath;
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    const records = [...this.recordsById.values()].slice(-5_000);
    await writeFile(temporaryPath, JSON.stringify({ version: 1, records } satisfies SignalStore), { mode: 0o600 });
    await rename(temporaryPath, filePath);
  }

  async submit(value: unknown, options?: Parameters<typeof validateSbkFreqtradeSignal>[1]): Promise<SbkFreqtradeSignalRecord> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const signal = validateSbkFreqtradeSignal(value, options);
      const existing = this.recordsById.get(signal.signalId);
      if (existing) {
        const oldSignal = existing.signal;
        const sameDecision =
          oldSignal.decisionId === signal.decisionId &&
          oldSignal.pair === signal.pair &&
          oldSignal.direction === signal.direction &&
          oldSignal.timeframe === signal.timeframe &&
          oldSignal.referencePrice === signal.referencePrice &&
          oldSignal.entryConditions.stopLoss === signal.entryConditions.stopLoss &&
          oldSignal.entryConditions.takeProfit === signal.entryConditions.takeProfit;
        if (!sameDecision) {
          throw new SbkSignalValidationError('Signal ID was already used for a different decision.', 'IDEMPOTENCY_CONFLICT');
        }
        return { ...existing, duplicate: true };
      }
      const nowMs = Date.now();
      const record: SbkFreqtradeSignalRecord = {
        signal,
        status: 'ACCEPTED',
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      };
      this.recordsById.set(signal.signalId, record);
      await this.persist();
      return { ...record };
    });
  }

  async getPending(pair: string, timeframe: string): Promise<SbkFreqtradeSignalRecord[]> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const nowMs = Date.now();
      let changed = false;
      for (const record of this.recordsById.values()) {
        if (record.status === 'ACCEPTED' && record.signal.expiresAtMs <= nowMs) {
          record.status = 'EXPIRED';
          record.reason = 'Signal expired before the Freqtrade strategy accepted it.';
          record.updatedAtMs = nowMs;
          changed = true;
        }
      }
      if (changed) await this.persist();
      return [...this.recordsById.values()]
        .filter((record) =>
          record.status === 'ACCEPTED' &&
          record.signal.pair === pair &&
          record.signal.timeframe === timeframe
        )
        .map((record) => ({ ...record }));
    });
  }

  async getForStrategy(pair: string, timeframe: string): Promise<SbkFreqtradeSignalRecord[]> {
    await this.getPending(pair, timeframe);
    return this.withExclusiveAccess(async () => {
      await this.load();
      const strategyVisibleStatuses = new Set<SbkSignalStatus>([
        'ACCEPTED',
        'STRATEGY_ACCEPTED',
        'ORDER_SUBMITTED',
        'PARTIALLY_FILLED',
        'FILLED',
      ]);
      return [...this.recordsById.values()]
        .filter((record) =>
          strategyVisibleStatuses.has(record.status) &&
          record.signal.pair === pair &&
          record.signal.timeframe === timeframe
        )
        .slice(-100)
        .map((record) => ({ ...record }));
    });
  }

  async updateStatus(signalId: string, update: SignalStatusUpdate): Promise<SbkFreqtradeSignalRecord> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const record = this.recordsById.get(signalId);
      if (!record) {
        throw new SbkSignalValidationError('Signal ID was not found.', 'SIGNAL_NOT_FOUND');
      }
      if (!allowedTransitions[record.status].has(update.status)) {
        if (record.status === update.status) return { ...record };
        throw new SbkSignalValidationError(
          `Lifecycle transition ${record.status} -> ${update.status} is not allowed.`,
          'INVALID_STATUS_TRANSITION',
        );
      }
      if (update.tradeId !== undefined && (!Number.isSafeInteger(update.tradeId) || update.tradeId <= 0)) {
        throw new SbkSignalValidationError('Freqtrade trade ID must be a positive integer.', 'INVALID_TRADE_ID');
      }
      if (update.filledAmount !== undefined && (!Number.isFinite(update.filledAmount) || update.filledAmount < 0)) {
        throw new SbkSignalValidationError('Filled amount must be a finite non-negative number.', 'INVALID_FILL_AMOUNT');
      }
      if (update.averageFillPrice !== undefined && (!finitePositive(update.averageFillPrice))) {
        throw new SbkSignalValidationError('Average fill price must be finite and positive.', 'INVALID_FILL_PRICE');
      }
      record.status = update.status;
      record.reason = update.reason?.slice(0, 500);
      record.tradeId = update.tradeId ?? record.tradeId;
      record.filledAmount = update.filledAmount ?? record.filledAmount;
      record.averageFillPrice = update.averageFillPrice ?? record.averageFillPrice;
      record.updatedAtMs = Date.now();
      await this.persist();
      return { ...record };
    });
  }

  async get(signalId: string): Promise<SbkFreqtradeSignalRecord | null> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const record = this.recordsById.get(signalId);
      return record ? { ...record } : null;
    });
  }

  async cancelPending(reason: string): Promise<number> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const nowMs = Date.now();
      let cancelled = 0;
      for (const record of this.recordsById.values()) {
        if (record.status === 'ACCEPTED') {
          record.status = 'CANCELLED';
          record.reason = reason.slice(0, 500);
          record.updatedAtMs = nowMs;
          cancelled++;
        }
      }
      if (cancelled > 0) await this.persist();
      return cancelled;
    });
  }
}

export const freqtradeSignalAdapter = new FreqtradeSignalAdapter();
