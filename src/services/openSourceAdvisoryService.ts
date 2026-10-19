import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FreqtradeMarketCandle } from './freqtradeMarketDataBridge';
import type { DirectNewsHeadline } from './directNewsFeeds';

export interface AdvisoryModuleResult {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  sourceTimestampMs: number | null;
  reason?: string;
  [key: string]: unknown;
}

export interface OpenSourceAdvisoryReport {
  requestId: string;
  contractVersion: 'sbk1.open-source-advisories.v1';
  generatedAtMs: number;
  sourceTimestampMs: number;
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  decisionInfluence: 'ADVISORY_ONLY';
  modules: {
    candlestickPatterns: AdvisoryModuleResult;
    marketRegime: AdvisoryModuleResult;
    marketAnomaly: AdvisoryModuleResult;
    lightgbmForecast: AdvisoryModuleResult;
    xgboostForecast: AdvisoryModuleResult;
    newsSentiment: AdvisoryModuleResult;
  };
}

interface PendingRequest {
  resolve: (report: OpenSourceAdvisoryReport) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModuleResult(value: unknown): value is AdvisoryModuleResult {
  return isObject(value) &&
    (value.status === 'AVAILABLE' || value.status === 'UNAVAILABLE') &&
    (value.sourceTimestampMs === null ||
      (typeof value.sourceTimestampMs === 'number' && Number.isSafeInteger(value.sourceTimestampMs)));
}

function isAdvisoryReport(value: unknown, requestId: string): value is OpenSourceAdvisoryReport {
  if (!isObject(value) ||
    value.requestId !== requestId ||
    value.contractVersion !== 'sbk1.open-source-advisories.v1' ||
    !Number.isSafeInteger(value.generatedAtMs) ||
    !Number.isSafeInteger(value.sourceTimestampMs) ||
    value.decisionInfluence !== 'ADVISORY_ONLY' ||
    !['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'].includes(String(value.status)) ||
    !isObject(value.modules)) return false;
  return [
    'candlestickPatterns',
    'marketRegime',
    'marketAnomaly',
    'lightgbmForecast',
    'xgboostForecast',
    'newsSentiment',
  ].every((name) => isModuleResult(value.modules[name]));
}

class OpenSourceAdvisoryService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private output: ReadLineInterface | null = null;
  private pending = new Map<string, PendingRequest>();
  private latest: OpenSourceAdvisoryReport | null = null;
  private stopped = false;

  getLatest(): OpenSourceAdvisoryReport | null {
    return this.latest;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  publishUnavailable(reason: string, sourceTimestampMs: number, generatedAtMs: number): OpenSourceAdvisoryReport {
    const unavailableModule = (): AdvisoryModuleResult => ({
      status: 'UNAVAILABLE',
      sourceTimestampMs,
      reason,
    });
    this.latest = {
      requestId: `unavailable-${sourceTimestampMs}-${generatedAtMs}`,
      contractVersion: 'sbk1.open-source-advisories.v1',
      generatedAtMs,
      sourceTimestampMs,
      status: 'UNAVAILABLE',
      decisionInfluence: 'ADVISORY_ONLY',
      modules: {
        candlestickPatterns: unavailableModule(),
        marketRegime: unavailableModule(),
        marketAnomaly: unavailableModule(),
        lightgbmForecast: unavailableModule(),
        xgboostForecast: unavailableModule(),
        newsSentiment: unavailableModule(),
      },
    };
    return this.latest;
  }

  async analyze(
    candles: FreqtradeMarketCandle[],
    headlines: DirectNewsHeadline[],
  ): Promise<OpenSourceAdvisoryReport> {
    if (this.stopped) throw new Error('Local advisory worker is stopping and cannot accept new requests.');
    const child = this.ensureWorker();
    const requestId = randomUUID();
    const payload = JSON.stringify({ requestId, candles, headlines });
    return new Promise<OpenSourceAdvisoryReport>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        const error = new Error('Open-source advisory worker exceeded its 120-second request timeout.');
        this.stopWorker(error);
        reject(error);
      }, 120_000);
      this.pending.set(requestId, {
        resolve: (report) => {
          this.latest = report;
          resolve(report);
        },
        reject,
        timeout,
      });
      child.stdin.write(`${payload}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        reject(new Error(`Could not send advisory request to the local worker: ${error.message}`));
      });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    if (!child) return;
    this.rejectPending(new Error('Local advisory worker stopped during server shutdown.'));
    this.output?.close();
    this.output = null;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 3_000);
      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.stdin.end();
    });
    if (this.child === child) this.child = null;
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.stopped) throw new Error('Local advisory worker is stopping and cannot start.');
    if (this.child && !this.child.killed) return this.child;

    const python = process.env.SBK1_PYTHON?.trim() || (
      process.platform === 'win32'
        ? path.resolve('.venv', 'Scripts', 'python.exe')
        : path.resolve('.venv', 'bin', 'python')
    );
    const workerPath = path.resolve('freqtrade_integration/advisory/open_source_advisory_worker.py');
    const child = spawn(python, ['-u', workerPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SBK1_MODEL_CACHE_DIR: process.env.SBK1_MODEL_CACHE_DIR?.trim() ||
          path.resolve('.cache/sbk1/open-source-models'),
        HF_HUB_DISABLE_TELEMETRY: '1',
        OMP_NUM_THREADS: '1',
        OPENBLAS_NUM_THREADS: '1',
        MKL_NUM_THREADS: '1',
        NUMEXPR_NUM_THREADS: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.output = createInterface({ input: child.stdout });
    this.output.on('line', (line) => this.handleResponse(line));
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim();
      if (message) console.error('[SBK1_ADVISORY_WORKER]', message);
    });
    child.on('error', (error) => {
      this.stopWorker(new Error(`Could not start local advisory worker: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.output?.close();
      this.output = null;
      this.rejectPending(new Error(
        `Local advisory worker exited (code=${code ?? 'none'}, signal=${signal ?? 'none'}).`,
      ));
    });
    return child;
  }

  private handleResponse(line: string): void {
    let response: unknown;
    try {
      response = JSON.parse(line);
    } catch (error) {
      console.error('[SBK1_ADVISORY_WORKER] Worker emitted invalid JSON:', error);
      this.stopWorker(new Error('Local advisory worker emitted invalid JSON.'));
      return;
    }
    const requestId = isObject(response) && typeof response.requestId === 'string'
      ? response.requestId
      : null;
    if (!requestId) {
      const message = isObject(response) && typeof response.error === 'string'
        ? response.error
        : 'Local advisory worker returned a response without a request ID.';
      this.stopWorker(new Error(message));
      return;
    }
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    if (!isAdvisoryReport(response, requestId)) {
      pending.reject(new Error('Local advisory worker returned an incompatible advisory contract.'));
      return;
    }
    pending.resolve(response);
  }

  private stopWorker(error: Error): void {
    this.rejectPending(error);
    const child = this.child;
    this.child = null;
    this.output?.close();
    this.output = null;
    child?.kill();
  }

  private rejectPending(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }
}

export const openSourceAdvisoryService = new OpenSourceAdvisoryService();
