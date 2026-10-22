import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const SBK_SIGNAL_CONTRACT_VERSION = 'sbk1.freqtrade.signal.v3';
export const SBK_ENTRY_AUTHORIZATION_VERSION = 'sbk1.entry.authorization.v2';
export const DRY_RUN_FIXTURE_SETUP_PREFIX = 'DRY_RUN_E2E_FIXTURE_';

export type SbkSignalDirection = 'LONG' | 'SHORT';
export type SbkExitSignalStatus = 'PENDING' | 'CONFIRMED' | 'CLOSED' | 'EXPIRED';
export type SbkSignalStatus =
  | 'ACCEPTED'
  | 'STRATEGY_ACCEPTED'
  | 'ORDER_SUBMITTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'ERROR'
  | 'UNKNOWN_IN_FLIGHT';

export interface SbkEntryAuthorization {
  contractVersion: typeof SBK_ENTRY_AUTHORIZATION_VERSION;
  decision: 'APPROVE_ENTRY' | 'DRY_RUN_TEST_ONLY';
  decisionId: string;
  snapshotId: string;
  snapshotTimestampMs: number;
  evaluatedAtMs: number;
  timeframe: string;
  direction: SbkSignalDirection;
  gates: Array<{
    id: string;
    status: 'PASSED' | 'FAILED' | 'UNAVAILABLE' | 'SKIPPED';
    reason: string;
  }>;
  models: Array<{
    id: string;
    status: 'HEALTHY' | 'DEGRADED' | 'SUSPENDED' | 'RETIRED' | 'UNAVAILABLE' | 'UNVALIDATED';
    calibrated: boolean;
    independenceValidated: boolean;
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    probabilityPct: number | null;
    sampleSize: number;
    oosPrecisionPct: number | null;
    effectiveWeight: number;
  }>;
  disagreementVeto: boolean;
  ensembleProbabilityPct: number | null;
  riskRewardRatio: number;
  allocatedRiskUsd: number;
  holdingHorizonMinutes: number;
}

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
  engineScore: number | null;
  authorization: SbkEntryAuthorization;
  dataQuality: {
    status: 'LIVE';
    source: string;
    observedAtMs: number;
    maxAgeMs: number;
  };
  entryConditions: {
    setupType: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    maxPriceDeviationBps: number;
    maxHoldingMinutes: number;
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
  receivedAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  lifecycleEvents: Array<{
    status: SbkSignalStatus;
    observedAtMs: number;
    source: 'SBK1' | 'FREQTRADE';
    reason?: string;
    tradeId?: number;
    filledAmount?: number;
    averageFillPrice?: number;
  }>;
  reason?: string;
  tradeId?: number;
  filledAmount?: number;
  averageFillPrice?: number;
  duplicate?: boolean;
}

export type SbkFreqtradeExitSignal = {
  contractVersion: typeof SBK_SIGNAL_CONTRACT_VERSION;
  signalType: 'EXIT';
  exitId: string;
  pair: string;
  direction: SbkSignalDirection;
  reason: string;
  generatedAtMs: number;
  expiresAtMs: number;
} & (
  | { tradeId: number; entryTag?: string }
  | { tradeId?: number; entryTag: string }
);

export interface SbkFreqtradeExitSignalRecord {
  signal: SbkFreqtradeExitSignal;
  status: SbkExitSignalStatus;
  createdAtMs: number;
  updatedAtMs: number;
  statusReason?: string;
}

interface SignalStore {
  version: 1;
  records: SbkFreqtradeSignalRecord[];
  exitRecords?: SbkFreqtradeExitSignalRecord[];
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
  STRATEGY_ACCEPTED: new Set(['ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'ERROR', 'UNKNOWN_IN_FLIGHT']),
  ORDER_SUBMITTED: new Set(['PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED', 'ERROR', 'UNKNOWN_IN_FLIGHT']),
  PARTIALLY_FILLED: new Set(['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'ERROR', 'UNKNOWN_IN_FLIGHT']),
  FILLED: new Set(),
  REJECTED: new Set(),
  EXPIRED: new Set(),
  CANCELLED: new Set(),
  ERROR: new Set(),
  UNKNOWN_IN_FLIGHT: new Set(['ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'FILLED']),
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

export function deriveSbkExitSignalId(input: {
  tradeId: number;
  entryTag: string;
  reason: string;
  generatedAtMs: number;
}): string {
  const digest = createHash('sha256')
    .update([input.tradeId, input.entryTag, input.reason, input.generatedAtMs].join('|'))
    .digest('hex')
    .slice(0, 32);
  return `sbk1_exit_${digest}`;
}

export function validateSbkFreqtradeExitSignal(
  value: unknown,
  nowMs = Date.now(),
): SbkFreqtradeExitSignal {
  if (!isRecord(value)) {
    throw new SbkSignalValidationError('Exit signal payload must be an object.', 'INVALID_EXIT_SIGNAL');
  }
  const signal = value as unknown as SbkFreqtradeExitSignal;
  if (
    signal.contractVersion !== SBK_SIGNAL_CONTRACT_VERSION ||
    signal.signalType !== 'EXIT' ||
    typeof signal.exitId !== 'string' ||
    !/^sbk1_exit_[a-f0-9]{32}$/.test(signal.exitId)
  ) {
    throw new SbkSignalValidationError('Exit signal type or identifier is invalid.', 'INVALID_EXIT_ID');
  }
  if (
    typeof signal.pair !== 'string' ||
    !/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}(?::[A-Z0-9]{2,20})?$/.test(signal.pair) ||
    (signal.direction !== 'LONG' && signal.direction !== 'SHORT') ||
    typeof signal.reason !== 'string' ||
    !signal.reason.trim() ||
    signal.reason.length > 240
  ) {
    throw new SbkSignalValidationError('Exit pair, direction, or reason is invalid.', 'INVALID_EXIT_DETAILS');
  }
  const hasTradeId = Number.isSafeInteger(signal.tradeId) && (signal.tradeId ?? 0) > 0;
  const hasEntryTag = typeof signal.entryTag === 'string' &&
    /^[A-Za-z0-9_.:-]{1,128}$/.test(signal.entryTag);
  if (
    (!hasTradeId && !hasEntryTag) ||
    (signal.tradeId !== undefined && !hasTradeId) ||
    (signal.entryTag !== undefined && !hasEntryTag)
  ) {
    throw new SbkSignalValidationError('Exit signal requires a valid Freqtrade trade ID or entry tag.', 'INVALID_EXIT_TARGET');
  }
  if (
    !Number.isSafeInteger(signal.generatedAtMs) ||
    signal.generatedAtMs > nowMs + 1_000 ||
    !Number.isSafeInteger(signal.expiresAtMs) ||
    signal.expiresAtMs <= nowMs ||
    signal.expiresAtMs <= signal.generatedAtMs ||
    signal.expiresAtMs - signal.generatedAtMs > 120_000
  ) {
    throw new SbkSignalValidationError('Exit signal is expired or has invalid timestamps.', 'EXIT_SIGNAL_EXPIRED');
  }
  return structuredClone(signal);
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
    signal.expiresAtMs <= signal.generatedAtMs ||
    signal.expiresAtMs - signal.generatedAtMs > 120_000
  ) {
    throw new SbkSignalValidationError('Signal is stale, future-dated, or has an invalid expiry.', 'SIGNAL_EXPIRED');
  }
  if (!finitePositive(signal.referencePrice)) {
    throw new SbkSignalValidationError('Reference price must be finite and positive.', 'INVALID_REFERENCE_PRICE');
  }
  const maximumDataAgeMs = isDryRunFixture ? 55_000 : 15_000;
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
    !finitePositive(signal.entryConditions.entryPrice) ||
    !finitePositive(signal.entryConditions.stopLoss) ||
    !finitePositive(signal.entryConditions.takeProfit) ||
    !finitePositive(signal.entryConditions.maxPriceDeviationBps) ||
    signal.entryConditions.maxPriceDeviationBps > 100 ||
    !Number.isSafeInteger(signal.entryConditions.maxHoldingMinutes) ||
    signal.entryConditions.maxHoldingMinutes < 1 ||
    signal.entryConditions.maxHoldingMinutes > 60
  ) {
    throw new SbkSignalValidationError('Entry, stop, target, or price-deviation condition is invalid.', 'INVALID_ENTRY_CONDITIONS');
  }
  if (
    signal.engineScore !== null &&
    (typeof signal.engineScore !== 'number' ||
      !Number.isFinite(signal.engineScore) ||
      signal.engineScore < 0 ||
      signal.engineScore > 100)
  ) {
    throw new SbkSignalValidationError('The analysis engine score must be null or between 0 and 100.', 'INVALID_ENGINE_SCORE');
  }
  const stopValid = signal.direction === 'LONG'
    ? signal.entryConditions.stopLoss < signal.entryConditions.entryPrice && signal.entryConditions.takeProfit > signal.entryConditions.entryPrice
    : signal.entryConditions.stopLoss > signal.entryConditions.entryPrice && signal.entryConditions.takeProfit < signal.entryConditions.entryPrice;
  const riskDistance = Math.abs(signal.entryConditions.entryPrice - signal.entryConditions.stopLoss);
  const rewardDistance = Math.abs(signal.entryConditions.takeProfit - signal.entryConditions.entryPrice);
  const entryDeviationBps = Math.abs(signal.entryConditions.entryPrice - signal.referencePrice) / signal.referencePrice * 10_000;
  if (!stopValid || rewardDistance < riskDistance || entryDeviationBps > signal.entryConditions.maxPriceDeviationBps) {
    throw new SbkSignalValidationError('Entry deviation, stop/target direction, or minimum 1:1 reward-to-risk is invalid.', 'INVALID_RISK_REWARD');
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
  const authorization = signal.authorization;
  if (
    !isRecord(authorization) ||
    authorization.contractVersion !== SBK_ENTRY_AUTHORIZATION_VERSION ||
    !['APPROVE_ENTRY', 'DRY_RUN_TEST_ONLY'].includes(String(authorization.decision)) ||
    authorization.decisionId !== signal.decisionId ||
    typeof authorization.snapshotId !== 'string' ||
    !/^SNP_[A-Za-z0-9:_-]{1,128}$/.test(authorization.snapshotId) ||
    !Number.isSafeInteger(authorization.snapshotTimestampMs) ||
    !Number.isSafeInteger(authorization.evaluatedAtMs) ||
    authorization.timeframe !== signal.timeframe ||
    authorization.direction !== signal.direction ||
    !Array.isArray(authorization.gates) ||
    !Array.isArray(authorization.models) ||
    typeof authorization.disagreementVeto !== 'boolean' ||
    !Number.isFinite(authorization.riskRewardRatio) ||
    !finitePositive(authorization.allocatedRiskUsd) ||
    !Number.isSafeInteger(authorization.holdingHorizonMinutes) ||
    authorization.holdingHorizonMinutes !== signal.entryConditions.maxHoldingMinutes ||
    authorization.holdingHorizonMinutes < 1 ||
    authorization.holdingHorizonMinutes > 60
  ) {
    throw new SbkSignalValidationError('A complete entry-decision authorization is required.', 'INVALID_AUTHORIZATION');
  }
  const maxAuthorizationAgeMs = isDryRunFixture ? 55_000 : 15_000;
  if (
    authorization.snapshotTimestampMs !== signal.dataQuality.observedAtMs ||
    authorization.snapshotTimestampMs > nowMs + 1_000 ||
    nowMs - authorization.snapshotTimestampMs < 0 ||
    nowMs - authorization.snapshotTimestampMs > maxAuthorizationAgeMs ||
    authorization.evaluatedAtMs < authorization.snapshotTimestampMs ||
    authorization.evaluatedAtMs > nowMs + 1_000 ||
    nowMs - authorization.evaluatedAtMs < 0 ||
    nowMs - authorization.evaluatedAtMs > maxAuthorizationAgeMs
  ) {
    throw new SbkSignalValidationError('Authorization snapshot or evaluation time is stale or inconsistent.', 'STALE_AUTHORIZATION');
  }

  const isTestOnly = authorization.decision === 'DRY_RUN_TEST_ONLY';
  if (isTestOnly) {
    if (!isDryRunFixture || authorization.models.length !== 0 || authorization.disagreementVeto) {
      throw new SbkSignalValidationError('Test-only authorization is restricted to isolated dry-run fixtures.', 'INVALID_TEST_AUTHORIZATION');
    }
  } else {
    const requiredGateIds = new Set([
      'COUNCIL_REPORT',
      'LIVE_DATA',
      'REFERENCE_PRICE',
      'VOLATILITY',
      'EXECUTION_SPREAD',
      'TRADE_LEVELS',
      'STOP_AND_TARGET',
      'PORTFOLIO_RISK',
      'DAILY_LOSS',
      'RISK_ALLOCATION',
      'HOLDING_HORIZON',
    ]);
    const seenGates = new Set<string>();
    for (const gate of authorization.gates) {
      if (
        !isRecord(gate) ||
        typeof gate.id !== 'string' ||
        !gate.id ||
        gate.status !== 'PASSED' ||
        typeof gate.reason !== 'string' ||
        !gate.reason.trim() ||
        seenGates.has(gate.id)
      ) {
        throw new SbkSignalValidationError('Every authorization gate must be uniquely identified and passed with a reason.', 'INVALID_AUTHORIZATION_GATES');
      }
      seenGates.add(gate.id);
    }
    if ([...requiredGateIds].some((id) => !seenGates.has(id))) {
      throw new SbkSignalValidationError('All central execution-control gates are required for entry.', 'INCOMPLETE_AUTHORIZATION_GATES');
    }
  }
  const calculatedRiskRewardRatio = rewardDistance / riskDistance;
  if (
    Math.abs(authorization.riskRewardRatio - calculatedRiskRewardRatio) > 0.01 ||
    authorization.riskRewardRatio < 1 ||
    authorization.allocatedRiskUsd >
      signal.riskLimits.maxStakeQuote *
        signal.riskLimits.maxLeverage *
        riskDistance / signal.entryConditions.entryPrice +
        0.01
  ) {
    throw new SbkSignalValidationError('Authorization risk, target, or risk/reward does not match the signal contract.', 'AUTHORIZATION_RISK_MISMATCH');
  }
  return {
    ...signal,
  };
}

export class FreqtradeSignalAdapter {
  private readonly recordsById = new Map<string, SbkFreqtradeSignalRecord>();
  private readonly exitRecordsById = new Map<string, SbkFreqtradeExitSignalRecord>();
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
        record.receivedAtMs = Number.isSafeInteger(record.receivedAtMs)
          ? record.receivedAtMs
          : record.createdAtMs;
        if (!Array.isArray(record.lifecycleEvents)) {
          record.lifecycleEvents = [{
            status: record.status,
            observedAtMs: record.updatedAtMs,
            source: record.status === 'ACCEPTED' ? 'SBK1' : 'FREQTRADE',
            reason: record.reason,
            tradeId: record.tradeId,
            filledAmount: record.filledAmount,
            averageFillPrice: record.averageFillPrice,
          }];
        }
        if (
          record.lifecycleEvents.length === 0 ||
          !record.lifecycleEvents.every((event) =>
            isRecord(event) &&
            allowedTransitions[event.status as SbkSignalStatus] !== undefined &&
            Number.isSafeInteger(event.observedAtMs) &&
            (event.source === 'SBK1' || event.source === 'FREQTRADE')
          ) ||
          record.lifecycleEvents[record.lifecycleEvents.length - 1]?.status !== record.status
        ) {
          throw new Error('Signal store contains an invalid lifecycle history.');
        }
        record.signal = validated;
        this.recordsById.set(validated.signalId, record);
      }
      const exitRecords = parsed.exitRecords;
      if (exitRecords !== undefined && !Array.isArray(exitRecords)) {
        throw new Error('Signal store contains an invalid exit-signal list.');
      }
      for (const value of Array.isArray(exitRecords) ? exitRecords : []) {
        if (
          !isRecord(value) ||
          !isRecord(value.signal) ||
          !['PENDING', 'CONFIRMED', 'CLOSED', 'EXPIRED'].includes(String(value.status))
        ) {
          throw new Error('Signal store contains an invalid exit-signal record.');
        }
        const record = value as unknown as SbkFreqtradeExitSignalRecord;
        record.signal = validateSbkFreqtradeExitSignal(
          record.signal,
          record.signal.generatedAtMs,
        );
        if (!Number.isSafeInteger(record.createdAtMs) || !Number.isSafeInteger(record.updatedAtMs)) {
          throw new Error('Signal store contains invalid exit-signal timestamps.');
        }
        this.exitRecordsById.set(record.signal.exitId, record);
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
    const allRecords = [...this.recordsById.values()];
    const activeRecords = allRecords.filter((record) =>
      record.signal.expiresAtMs > Date.now() ||
      ['STRATEGY_ACCEPTED', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'UNKNOWN_IN_FLIGHT'].includes(record.status)
    );
    const recentRecords = allRecords
      .filter((record) => record.signal.expiresAtMs <= Date.now())
      .slice(-5_000);
    const records = [...new Map([...recentRecords, ...activeRecords].map((record) => [
      record.signal.signalId,
      record,
    ])).values()];
    const exitRecords = [...this.exitRecordsById.values()]
      .filter((record) => record.status === 'PENDING' || record.status === 'CONFIRMED' || record.signal.expiresAtMs > Date.now())
      .slice(-5_000);
    await writeFile(temporaryPath, JSON.stringify({
      version: 1,
      records,
      exitRecords,
    } satisfies SignalStore), { mode: 0o600 });
    await rename(temporaryPath, filePath);
  }

  async submit(value: unknown, options?: Parameters<typeof validateSbkFreqtradeSignal>[1]): Promise<SbkFreqtradeSignalRecord> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const signal = validateSbkFreqtradeSignal(value, options);
      const existing = this.recordsById.get(signal.signalId);
      if (existing) {
        if (!isDeepStrictEqual(existing.signal, signal)) {
          throw new SbkSignalValidationError('Signal ID was already used for a different decision.', 'IDEMPOTENCY_CONFLICT');
        }
        return { ...structuredClone(existing), duplicate: true };
      }
      const nowMs = options?.nowMs ?? Date.now();
      const record: SbkFreqtradeSignalRecord = {
        signal,
        status: 'ACCEPTED',
        receivedAtMs: nowMs,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        lifecycleEvents: [{ status: 'ACCEPTED', observedAtMs: nowMs, source: 'SBK1' }],
      };
      this.recordsById.set(signal.signalId, record);
      await this.persist();
      return structuredClone(record);
    });
  }

  async submitExitSignal(value: unknown, nowMs = Date.now()): Promise<SbkFreqtradeExitSignalRecord & { duplicate?: boolean }> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const signal = validateSbkFreqtradeExitSignal(value, nowMs);
      const existing = this.exitRecordsById.get(signal.exitId);
      if (existing) {
        if (!isDeepStrictEqual(existing.signal, signal)) {
          throw new SbkSignalValidationError('Exit ID was already used for a different decision.', 'EXIT_IDEMPOTENCY_CONFLICT');
        }
        return { ...structuredClone(existing), duplicate: true };
      }
      const activeForTrade = [...this.exitRecordsById.values()].find((record) =>
        (record.status === 'PENDING' || record.status === 'CONFIRMED') &&
        ((signal.tradeId !== undefined && record.signal.tradeId === signal.tradeId) ||
          (signal.entryTag !== undefined && record.signal.entryTag === signal.entryTag))
      );
      if (activeForTrade) {
        return { ...structuredClone(activeForTrade), duplicate: true };
      }
      const record: SbkFreqtradeExitSignalRecord = {
        signal,
        status: 'PENDING',
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      };
      this.exitRecordsById.set(signal.exitId, record);
      await this.persist();
      return structuredClone(record);
    });
  }

  async getPendingExitSignals(pair: string): Promise<SbkFreqtradeExitSignal[]> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const nowMs = Date.now();
      let changed = false;
      for (const record of this.exitRecordsById.values()) {
        if (record.status === 'PENDING' && record.signal.expiresAtMs <= nowMs) {
          record.status = 'EXPIRED';
          record.statusReason = 'Exit signal expired before Freqtrade accepted it.';
          record.updatedAtMs = nowMs;
          changed = true;
        }
      }
      if (changed) await this.persist();
      return [...this.exitRecordsById.values()]
        .filter((record) =>
          (record.status === 'PENDING' || record.status === 'CONFIRMED') &&
          record.signal.pair === pair &&
          record.signal.expiresAtMs > nowMs
        )
        .map((record) => structuredClone(record.signal));
    });
  }

  async updateExitSignalStatus(
    exitId: string,
    status: SbkExitSignalStatus,
    reason?: string,
  ): Promise<SbkFreqtradeExitSignalRecord> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const record = this.exitRecordsById.get(exitId);
      if (!record) {
        throw new SbkSignalValidationError('Exit signal ID was not found.', 'EXIT_SIGNAL_NOT_FOUND');
      }
      const allowed: Record<SbkExitSignalStatus, ReadonlySet<SbkExitSignalStatus>> = {
        PENDING: new Set(['CONFIRMED', 'CLOSED', 'EXPIRED']),
        CONFIRMED: new Set(['CLOSED']),
        CLOSED: new Set(),
        EXPIRED: new Set(),
      };
      if (record.status !== status && !allowed[record.status].has(status)) {
        throw new SbkSignalValidationError(
          `Exit lifecycle transition ${record.status} -> ${status} is not allowed.`,
          'INVALID_EXIT_STATUS_TRANSITION',
        );
      }
      const normalizedReason = reason?.slice(0, 240) ?? record.statusReason;
      if (record.status === status && record.statusReason === normalizedReason) {
        return structuredClone(record);
      }
      record.status = status;
      record.statusReason = normalizedReason;
      record.updatedAtMs = Date.now();
      await this.persist();
      return structuredClone(record);
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
          record.lifecycleEvents.push({
            status: 'EXPIRED',
            observedAtMs: nowMs,
            source: 'SBK1',
            reason: record.reason,
          });
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
        .map((record) => structuredClone(record));
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
        'UNKNOWN_IN_FLIGHT',
      ]);
      return [...this.recordsById.values()]
        .filter((record) =>
          strategyVisibleStatuses.has(record.status) &&
          record.signal.pair === pair &&
          record.signal.timeframe === timeframe
        )
        .map((record) => structuredClone(record));
    });
  }

  async getDashboardRecords(pair: string, timeframe: string): Promise<SbkFreqtradeSignalRecord[]> {
    await this.getPending(pair, timeframe);
    return this.withExclusiveAccess(async () => {
      await this.load();
      return [...this.recordsById.values()]
        .filter((record) => record.signal.pair === pair && record.signal.timeframe === timeframe)
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
        .slice(0, 50)
        .map((record) => structuredClone(record));
    });
  }

  async updateStatus(signalId: string, update: SignalStatusUpdate): Promise<SbkFreqtradeSignalRecord> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const record = this.recordsById.get(signalId);
      if (!record) {
        throw new SbkSignalValidationError('Signal ID was not found.', 'SIGNAL_NOT_FOUND');
      }
      if (update.tradeId !== undefined && (!Number.isSafeInteger(update.tradeId) || update.tradeId <= 0)) {
        throw new SbkSignalValidationError('Freqtrade trade ID must be a positive integer.', 'INVALID_TRADE_ID');
      }
      if (record.tradeId !== undefined && update.tradeId !== undefined && record.tradeId !== update.tradeId) {
        throw new SbkSignalValidationError('A signal cannot be linked to more than one Freqtrade trade.', 'TRADE_ID_CONFLICT');
      }
      if (record.status !== update.status && !allowedTransitions[record.status].has(update.status)) {
        throw new SbkSignalValidationError(
          `Lifecycle transition ${record.status} -> ${update.status} is not allowed.`,
          'INVALID_STATUS_TRANSITION',
        );
      }
      if (update.filledAmount !== undefined && (!Number.isFinite(update.filledAmount) || update.filledAmount < 0)) {
        throw new SbkSignalValidationError('Filled amount must be a finite non-negative number.', 'INVALID_FILL_AMOUNT');
      }
      if (update.averageFillPrice !== undefined && (!finitePositive(update.averageFillPrice))) {
        throw new SbkSignalValidationError('Average fill price must be finite and positive.', 'INVALID_FILL_PRICE');
      }
      const reason = update.reason?.slice(0, 500) ?? record.reason;
      const tradeId = update.tradeId ?? record.tradeId;
      const filledAmount = update.filledAmount ?? record.filledAmount;
      const averageFillPrice = update.averageFillPrice ?? record.averageFillPrice;
      const statusChanged = record.status !== update.status;
      const lifecycleChanged = statusChanged ||
        record.reason !== reason ||
        record.tradeId !== tradeId ||
        record.filledAmount !== filledAmount ||
        record.averageFillPrice !== averageFillPrice;
      if (
        record.status === update.status &&
        record.reason === reason &&
        record.tradeId === tradeId &&
        record.filledAmount === filledAmount &&
        record.averageFillPrice === averageFillPrice
      ) {
        return { ...record };
      }
      record.status = update.status;
      record.reason = reason;
      record.tradeId = tradeId;
      record.filledAmount = filledAmount;
      record.averageFillPrice = averageFillPrice;
      const updatedAtMs = Date.now();
      if (lifecycleChanged) {
        record.lifecycleEvents.push({
          status: update.status,
          observedAtMs: updatedAtMs,
          source: 'FREQTRADE',
          reason,
          tradeId,
          filledAmount,
          averageFillPrice,
        });
      }
      record.updatedAtMs = updatedAtMs;
      await this.persist();
      return structuredClone(record);
    });
  }

  async get(signalId: string): Promise<SbkFreqtradeSignalRecord | null> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const record = this.recordsById.get(signalId);
      return record ? structuredClone(record) : null;
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
          record.lifecycleEvents.push({
            status: 'CANCELLED',
            observedAtMs: nowMs,
            source: 'SBK1',
            reason: record.reason,
          });
          cancelled++;
        }
      }
      if (cancelled > 0) await this.persist();
      return cancelled;
    });
  }
}

export const freqtradeSignalAdapter = new FreqtradeSignalAdapter();
