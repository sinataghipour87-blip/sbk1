import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_LOG_PATH = path.resolve(process.cwd(), '.cache/sbk1/member6-shadow-votes.jsonl');
export const MEMBER6_SHADOW_RETENTION_MS = 90 * 24 * 60 * 60_000;

export type Member6ShadowLogKind = 'votes' | 'outcomes';

export function member6ShadowLogBasePath(): string {
  return path.resolve(process.env.SBK1_MEMBER6_SHADOW_LOG_PATH?.trim() || DEFAULT_LOG_PATH);
}

function logStem(basePath: string): string {
  return basePath.endsWith('.jsonl') ? basePath.slice(0, -'.jsonl'.length) : basePath;
}

function dayStamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

export function member6ShadowSegmentPath(
  basePath: string,
  timestampMs: number,
  kind: Member6ShadowLogKind,
): string {
  const stem = logStem(basePath);
  const suffix = kind === 'outcomes' ? '.outcomes' : '';
  return `${stem}.${dayStamp(timestampMs)}${suffix}.jsonl`;
}

export async function listMember6ShadowLogPaths(
  basePath: string,
  kind: Member6ShadowLogKind,
): Promise<string[]> {
  const directory = path.dirname(basePath);
  const stem = path.basename(logStem(basePath));
  const legacyPath = kind === 'votes' ? basePath : `${basePath}.outcomes.jsonl`;
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const segmentPattern = kind === 'votes'
    ? new RegExp(`^${escapeRegExp(stem)}\\.\\d{4}-\\d{2}-\\d{2}\\.jsonl$`)
    : new RegExp(`^${escapeRegExp(stem)}\\.\\d{4}-\\d{2}-\\d{2}\\.outcomes\\.jsonl$`);
  const paths = entries
    .filter((entry) => segmentPattern.test(entry))
    .map((entry) => path.join(directory, entry));
  if (entries.includes(path.basename(legacyPath))) paths.push(legacyPath);
  return [...new Set(paths)].sort();
}

export async function pruneExpiredMember6ShadowLogs(
  basePath: string,
  nowMs = Date.now(),
): Promise<string[]> {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error('Member 6 shadow log retention timestamp is invalid.');
  }
  const directory = path.dirname(basePath);
  const stem = path.basename(logStem(basePath));
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const datedSegment = new RegExp(
    `^${escapeRegExp(stem)}\\.(\\d{4}-\\d{2}-\\d{2})(?:\\.outcomes)?\\.jsonl$`,
  );
  const cutoffDate = dayStamp(nowMs - MEMBER6_SHADOW_RETENTION_MS);
  const expiredPaths = entries.flatMap((entry) => {
    const match = datedSegment.exec(entry);
    return match && match[1] < cutoffDate ? [path.join(directory, entry)] : [];
  });
  await Promise.all(expiredPaths.map((filePath) => rm(filePath)));
  return expiredPaths;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
