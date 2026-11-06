import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { QUORUM_ASSETS, type QuorumAsset } from './whaleConsensusCandidateRegistry';

const DEFAULT_CURSOR_PATH = path.resolve(process.cwd(), '.cache/sbk1/member6-block-cursors.json');

export interface Member6BlockCursorStore {
  version: 1;
  nextBlockByAsset: Partial<Record<QuorumAsset, number>>;
}

export interface Member6BlockRange {
  fromBlock: number;
  throughBlock: number;
  nextBlock: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function emptyMember6BlockCursorStore(): Member6BlockCursorStore {
  return { version: 1, nextBlockByAsset: {} };
}

export function parseMember6BlockCursorStore(value: unknown): Member6BlockCursorStore {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.nextBlockByAsset)) {
    throw new Error('Member 6 block cursor file has an unsupported or malformed structure.');
  }
  const nextBlockByAsset: Partial<Record<QuorumAsset, number>> = {};
  for (const [asset, nextBlock] of Object.entries(value.nextBlockByAsset)) {
    if (!QUORUM_ASSETS.includes(asset as QuorumAsset) ||
        !Number.isSafeInteger(nextBlock) || (nextBlock as number) < 1) {
      throw new Error('Member 6 block cursor file contains an invalid asset cursor.');
    }
    nextBlockByAsset[asset as QuorumAsset] = nextBlock as number;
  }
  return { version: 1, nextBlockByAsset };
}

export function getMember6BlockRange(
  finalizedHead: number,
  nextBlock: number | undefined,
  maxBlocks: number,
): Member6BlockRange | null {
  if (!Number.isSafeInteger(finalizedHead) || finalizedHead < 1 ||
      (nextBlock !== undefined && (!Number.isSafeInteger(nextBlock) || nextBlock < 1)) ||
      !Number.isSafeInteger(maxBlocks) || maxBlocks < 1) {
    throw new Error('Member 6 block cursor range settings are invalid.');
  }
  const fromBlock = nextBlock ?? Math.max(1, finalizedHead - maxBlocks + 1);
  if (fromBlock > finalizedHead) return null;
  const throughBlock = Math.min(finalizedHead, fromBlock + maxBlocks - 1);
  return { fromBlock, throughBlock, nextBlock: throughBlock + 1 };
}

export async function loadMember6BlockCursorStore(
  filePath = process.env.SBK1_MEMBER6_BLOCK_CURSORS_PATH ?? DEFAULT_CURSOR_PATH,
): Promise<Member6BlockCursorStore> {
  try {
    return parseMember6BlockCursorStore(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return emptyMember6BlockCursorStore();
    throw error;
  }
}

export async function writeMember6BlockCursorStore(
  store: Member6BlockCursorStore,
  filePath = process.env.SBK1_MEMBER6_BLOCK_CURSORS_PATH ?? DEFAULT_CURSOR_PATH,
): Promise<void> {
  const validatedStore = parseMember6BlockCursorStore(store);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(validatedStore, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
