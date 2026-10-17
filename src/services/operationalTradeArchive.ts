import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { FreqtradeTrade } from './freqtradeBridge';
import type { SbkFreqtradeSignalRecord } from './freqtradeSignalAdapter';

export interface OperationalTradeArchiveMetadata {
  featureSnapshot: Record<string, number | string | boolean | null>;
  featureVersion: string;
  modelVersion: string;
  codeVersion: string;
}

export interface OperationalTradeOutcome {
  source: 'FREQTRADE_RPC';
  tradeId: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  pnlUsd: number;
  feesUsd: number;
  exitReason: string;
  closedAtMs: number;
}

export interface OperationalTradeArchiveRecord {
  decisionId: string;
  signalId: string;
  decision: SbkFreqtradeSignalRecord['signal'];
  featureSnapshot: OperationalTradeArchiveMetadata['featureSnapshot'] | null;
  featureVersion: string | null;
  modelVersion: string | null;
  codeVersion: string | null;
  outcome?: OperationalTradeOutcome;
  provenance: SbkFreqtradeSignalRecord['signal']['dataQuality'];
  lifecycleEvents: Array<{
    status: SbkFreqtradeSignalRecord['status'];
    observedAtMs: number;
    source: SbkFreqtradeSignalRecord['lifecycleEvents'][number]['source'];
    reason?: string;
    tradeId?: number;
    filledAmount?: number;
    averageFillPrice?: number;
  }>;
  freqtradeTrades: Array<{
    observedAtMs: number;
    source: 'FREQTRADE_RPC';
    executionMode?: 'DRY_RUN' | 'LIVE';
    trade: FreqtradeTrade;
  }>;
}

interface OperationalTradeArchiveStore {
  version: 1;
  records: OperationalTradeArchiveRecord[];
}

export class OperationalTradeArchive {
  private readonly recordsBySignalId = new Map<string, OperationalTradeArchiveRecord>();
  private loaded = false;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storePath = process.env.SBK1_TRADE_ARCHIVE_PATH?.trim() ||
    path.resolve('data/sbk1-operational-trade-archive.json')) {}

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
    try {
      const raw = await readFile(this.storePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as OperationalTradeArchiveStore).version !== 1 ||
        !Array.isArray((parsed as OperationalTradeArchiveStore).records)
      ) {
        throw new Error('Operational trade archive has an unsupported or invalid structure.');
      }
      const decisionIds = new Set<string>();
      const tradeIds = new Map<number, string>();
      for (const record of (parsed as OperationalTradeArchiveStore).records) {
        if (
          !record ||
          typeof record.signalId !== 'string' ||
          typeof record.decisionId !== 'string' ||
          !Array.isArray(record.lifecycleEvents) ||
          !Array.isArray(record.freqtradeTrades) ||
          this.recordsBySignalId.has(record.signalId) ||
          decisionIds.has(record.decisionId)
        ) {
          throw new Error('Operational trade archive contains an invalid or duplicate record.');
        }
        for (const snapshot of record.freqtradeTrades) {
          const linkedSignal = tradeIds.get(snapshot.trade.trade_id);
          if (linkedSignal && linkedSignal !== record.signalId) {
            throw new Error(`Operational trade archive links Freqtrade trade ${snapshot.trade.trade_id} more than once.`);
          }
          tradeIds.set(snapshot.trade.trade_id, record.signalId);
        }
        decisionIds.add(record.decisionId);
        this.recordsBySignalId.set(record.signalId, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Could not load the operational trade archive: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const temporaryPath = `${this.storePath}.${process.pid}.tmp`;
    const store: OperationalTradeArchiveStore = {
      version: 1,
      records: [...this.recordsBySignalId.values()],
    };
    await writeFile(temporaryPath, JSON.stringify(store), { mode: 0o600 });
    await rename(temporaryPath, this.storePath);
  }

  async recordSignalLifecycle(
    signalRecord: SbkFreqtradeSignalRecord,
    metadata?: OperationalTradeArchiveMetadata,
  ): Promise<void> {
    if (signalRecord.signal.entryConditions.setupType.startsWith('DRY_RUN_E2E_FIXTURE_')) return;
    await this.withExclusiveAccess(async () => {
      await this.load();
      const existing = this.recordsBySignalId.get(signalRecord.signal.signalId);
      if (existing && !isDeepStrictEqual(existing.decision, signalRecord.signal)) {
        throw new Error(`Operational archive signal ID conflict: ${signalRecord.signal.signalId}`);
      }
      const decisionConflict = [...this.recordsBySignalId.values()].find((record) =>
        record.signalId !== signalRecord.signal.signalId &&
        record.decisionId === signalRecord.signal.decisionId
      );
      if (decisionConflict) {
        throw new Error(`Operational archive decision ID is already linked to signal ${decisionConflict.signalId}.`);
      }
      const record: OperationalTradeArchiveRecord = existing ?? {
        decisionId: signalRecord.signal.decisionId,
        signalId: signalRecord.signal.signalId,
        decision: signalRecord.signal,
        featureSnapshot: null,
        featureVersion: null,
        modelVersion: null,
        codeVersion: null,
        provenance: signalRecord.signal.dataQuality,
        lifecycleEvents: [],
        freqtradeTrades: [],
      };
      if (metadata) {
        record.featureSnapshot = structuredClone(metadata.featureSnapshot);
        record.featureVersion = metadata.featureVersion;
        record.modelVersion = metadata.modelVersion;
        record.codeVersion = metadata.codeVersion;
      }
      const lifecycleEvents = signalRecord.lifecycleEvents.length > 0
        ? signalRecord.lifecycleEvents
        : [{
            status: signalRecord.status,
            observedAtMs: signalRecord.updatedAtMs,
            source: 'SBK1' as const,
            reason: signalRecord.reason,
            tradeId: signalRecord.tradeId,
            filledAmount: signalRecord.filledAmount,
            averageFillPrice: signalRecord.averageFillPrice,
          }];
      for (const event of lifecycleEvents) {
        const archivedEvent = {
          status: event.status,
          observedAtMs: event.observedAtMs,
          source: event.source,
          ...(event.reason === undefined ? {} : { reason: event.reason }),
          ...(event.tradeId === undefined ? {} : { tradeId: event.tradeId }),
          ...(event.filledAmount === undefined ? {} : { filledAmount: event.filledAmount }),
          ...(event.averageFillPrice === undefined ? {} : { averageFillPrice: event.averageFillPrice }),
        };
        if (!record.lifecycleEvents.some((existing) => isDeepStrictEqual(existing, archivedEvent))) {
          record.lifecycleEvents.push(archivedEvent);
        }
      }
      this.recordsBySignalId.set(record.signalId, record);
      await this.persist();
    });
  }

  async recordFreqtradeTrade(
    signalId: string,
    trade: FreqtradeTrade,
    executionMode: 'DRY_RUN' | 'LIVE',
    observedAtMs = Date.now(),
  ): Promise<void> {
    await this.withExclusiveAccess(async () => {
      await this.load();
      const record = this.recordsBySignalId.get(signalId);
      if (!record) throw new Error(`Operational archive has no decision for signal ${signalId}.`);
      if (!Number.isSafeInteger(trade.trade_id) || trade.trade_id <= 0 || !Number.isSafeInteger(observedAtMs)) {
        throw new Error('Operational archive requires a valid Freqtrade trade ID and observation timestamp.');
      }
      if (
        trade.pair !== record.decision.pair ||
        trade.is_short !== (record.decision.direction === 'SHORT') ||
        trade.enter_tag !== signalId
      ) {
        throw new Error(`Freqtrade trade ${trade.trade_id} does not match signal ${signalId}.`);
      }
      const pnlUsd = trade.realized_profit ?? trade.close_profit_abs;
      if (
        !trade.is_open &&
        (
          typeof pnlUsd !== 'number' ||
          !Number.isFinite(pnlUsd) ||
          typeof trade.fee_open_cost !== 'number' ||
          !Number.isFinite(trade.fee_open_cost) ||
          typeof trade.fee_close_cost !== 'number' ||
          !Number.isFinite(trade.fee_close_cost) ||
          trade.fee_open_cost < 0 ||
          trade.fee_close_cost < 0 ||
          !Number.isSafeInteger(trade.close_timestamp) ||
          (trade.close_timestamp ?? 0) <= 0 ||
          typeof trade.exit_reason !== 'string' ||
          trade.exit_reason.trim().length === 0
        )
      ) {
        throw new Error(`Closed Freqtrade trade ${trade.trade_id} is missing a verified PnL, fee, close-time, or exit-reason field.`);
      }
      const alreadyLinked = [...this.recordsBySignalId.values()].find((candidate) =>
        candidate.signalId !== signalId &&
        candidate.freqtradeTrades.some((snapshot) => snapshot.trade.trade_id === trade.trade_id)
      );
      if (alreadyLinked) {
        throw new Error(`Freqtrade trade ${trade.trade_id} is already linked to signal ${alreadyLinked.signalId}.`);
      }
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ executionMode, trade }))
        .digest('hex');
      const existingFingerprints = new Set(record.freqtradeTrades.map((snapshot) =>
        createHash('sha256')
          .update(JSON.stringify({ executionMode: snapshot.executionMode ?? 'LIVE', trade: snapshot.trade }))
          .digest('hex')
      ));
      if (!existingFingerprints.has(fingerprint)) {
        record.freqtradeTrades.push({
          observedAtMs,
          source: 'FREQTRADE_RPC',
          executionMode,
          trade,
        });
      }
      if (
        !trade.is_open &&
        pnlUsd !== undefined &&
        pnlUsd !== null &&
        trade.fee_open_cost !== null &&
        trade.fee_close_cost !== null &&
        trade.close_timestamp !== null &&
        trade.exit_reason !== undefined &&
        trade.exit_reason !== null
      ) {
        const feesUsd = trade.fee_open_cost + trade.fee_close_cost;
        record.outcome = {
          source: 'FREQTRADE_RPC',
          tradeId: trade.trade_id,
          outcome: pnlUsd > 0 ? 'WIN' : pnlUsd < 0 ? 'LOSS' : 'BREAKEVEN',
          pnlUsd,
          feesUsd,
          exitReason: trade.exit_reason,
          closedAtMs: trade.close_timestamp!,
        };
      }
      if (!existingFingerprints.has(fingerprint) || record.outcome) await this.persist();
    });
  }

  async getPendingOutcomeTrades(): Promise<Array<{ signalId: string; tradeId: number }>> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      return [...this.recordsBySignalId.values()].flatMap((record) => {
        if (record.outcome) return [];
        const tradeId = [...record.lifecycleEvents]
          .reverse()
          .find((event) => event.source === 'FREQTRADE' && Number.isSafeInteger(event.tradeId) && (event.tradeId ?? 0) > 0)
          ?.tradeId;
        return tradeId === undefined ? [] : [{ signalId: record.signalId, tradeId }];
      });
    });
  }

  async getAll(): Promise<OperationalTradeArchiveRecord[]> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      return structuredClone([...this.recordsBySignalId.values()]);
    });
  }

  async getBySignalId(signalId: string): Promise<OperationalTradeArchiveRecord | null> {
    return this.withExclusiveAccess(async () => {
      await this.load();
      const record = this.recordsBySignalId.get(signalId);
      return record ? structuredClone(record) : null;
    });
  }
}

export const operationalTradeArchive = new OperationalTradeArchive();
