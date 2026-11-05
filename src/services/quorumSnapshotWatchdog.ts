import { stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_AGE_MINUTES = 10;
const MAX_AGE_MINUTES = 24 * 60;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;

export interface QuorumSnapshotWatchdogOptions {
  filePath?: string;
  now?: () => number;
  startedAtMs?: number;
  checkIntervalMs?: number;
  onStale: (reason: string) => void;
}

export function quorumSnapshotMaxAgeMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SBK1_QUORUM_SNAPSHOT_MAX_AGE_MINUTES?.trim();
  const minutes = raw ? Number(raw) : DEFAULT_MAX_AGE_MINUTES;
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > MAX_AGE_MINUTES) {
    throw new Error(
      `SBK1_QUORUM_SNAPSHOT_MAX_AGE_MINUTES must be an integer from 1 to ${MAX_AGE_MINUTES}.`,
    );
  }
  return minutes * 60_000;
}

export async function quorumSnapshotStaleReason(options: {
  filePath?: string;
  nowMs?: number;
  startedAtMs?: number;
  maxAgeMs?: number;
} = {}): Promise<string | null> {
  const filePath = path.resolve(
    options.filePath ??
      process.env.SBK1_QUORUM_CANDIDATES_PATH ??
      '.cache/sbk1/quorum-candidates.json',
  );
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? quorumSnapshotMaxAgeMs();
  try {
    const snapshot = await stat(filePath);
    const ageMs = nowMs - snapshot.mtimeMs;
    if (
      ageMs > maxAgeMs &&
      options.startedAtMs !== undefined &&
      nowMs - options.startedAtMs <= maxAgeMs
    ) return null;
    return ageMs > maxAgeMs
      ? `snapshot age ${Math.floor(ageMs / 60_000)} minutes exceeds ${Math.floor(maxAgeMs / 60_000)} minute limit`
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const startupAgeMs = nowMs - (options.startedAtMs ?? nowMs);
    return startupAgeMs > maxAgeMs
      ? `snapshot is missing after ${Math.floor(startupAgeMs / 60_000)} minutes of startup`
      : null;
  }
}

export function startQuorumSnapshotWatchdog(
  options: QuorumSnapshotWatchdogOptions,
): () => void {
  const now = options.now ?? Date.now;
  const startedAtMs = options.startedAtMs ?? now();
  const maxAgeMs = quorumSnapshotMaxAgeMs();
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  if (!Number.isSafeInteger(checkIntervalMs) || checkIntervalMs <= 0) {
    throw new Error('Quorum snapshot watchdog interval must be a positive integer.');
  }
  let stopped = false;
  let reportedStale = false;
  const check = async () => {
    if (stopped || reportedStale) return;
    const reason = await quorumSnapshotStaleReason({
      filePath: options.filePath,
      nowMs: now(),
      startedAtMs,
      maxAgeMs,
    });
    if (!reason || stopped) return;
    reportedStale = true;
    console.error(`[QuorumSnapshotWatchdog] ${reason}; terminating runner for supervisor restart.`);
    options.onStale(reason);
  };
  void check().catch((error: unknown) => {
    console.error('[QuorumSnapshotWatchdog] Snapshot check failed:', error);
  });
  const timer = setInterval(() => {
    void check().catch((error: unknown) => {
      console.error('[QuorumSnapshotWatchdog] Snapshot check failed:', error);
    });
  }, checkIntervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
