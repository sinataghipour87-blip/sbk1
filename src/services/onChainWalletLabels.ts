import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnChainAsset } from './onChainFeedRegistry';

export type ExchangeWalletRole = 'deposit' | 'hot' | 'cold';

export interface VerifiedOnChainWalletLabel {
  asset: OnChainAsset;
  address: string;
  exchange: string;
  walletRole: ExchangeWalletRole;
  labelStatus: 'verified';
  sourceUrl: string;
  verifiedAt: string;
  reviewBy: string;
}

interface WalletLabelFile {
  schemaVersion: 1;
  labels: VerifiedOnChainWalletLabel[];
}

const LABEL_FILE_PATH = process.env.SBK1_ONCHAIN_WALLET_LABELS_FILE?.trim() ||
  path.join(process.cwd(), 'config', 'onchain-wallet-labels.json');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalAddress(asset: OnChainAsset, address: string): string {
  return asset === 'ETH' || asset === 'BNB' ? address.toLowerCase() : address;
}

export function isValidOnChainWalletAddress(asset: OnChainAsset, address: string): boolean {
  if (asset === 'BTC') {
    return /^(bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/i.test(address);
  }
  if (asset === 'ETH' || asset === 'BNB') return /^0x[0-9a-f]{40}$/i.test(address);
  if (asset === 'SOL') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
}

function parseWalletLabelFile(value: unknown, nowMs: number): WalletLabelFile {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.labels)) {
    throw new Error('On-chain wallet label file must use schemaVersion 1 and contain a labels array.');
  }
  const labels = value.labels.map((candidate): VerifiedOnChainWalletLabel => {
    if (!isRecord(candidate) ||
        !['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].includes(String(candidate.asset)) ||
        typeof candidate.address !== 'string' ||
        !isValidOnChainWalletAddress(candidate.asset as OnChainAsset, candidate.address.trim()) ||
        typeof candidate.exchange !== 'string' ||
        candidate.exchange.trim().length < 2 ||
        !['deposit', 'hot', 'cold'].includes(String(candidate.walletRole)) ||
        candidate.labelStatus !== 'verified' ||
        typeof candidate.sourceUrl !== 'string' ||
        typeof candidate.verifiedAt !== 'string' ||
        typeof candidate.reviewBy !== 'string') {
      throw new Error('On-chain wallet labels require asset, address, exchange, walletRole, verified status, sourceUrl, verifiedAt, and reviewBy.');
    }
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(candidate.sourceUrl);
    } catch {
      throw new Error(`Wallet label source URL is invalid for ${candidate.address}.`);
    }
    const verifiedAtMs = Date.parse(candidate.verifiedAt);
    const reviewByMs = Date.parse(candidate.reviewBy);
    if (
      sourceUrl.protocol !== 'https:' ||
      !Number.isFinite(verifiedAtMs) ||
      !Number.isFinite(reviewByMs) ||
      verifiedAtMs > nowMs ||
      reviewByMs < nowMs ||
      reviewByMs < verifiedAtMs
    ) {
      throw new Error(`Wallet label source or review dates are invalid/expired for ${candidate.address}.`);
    }
    return {
      asset: candidate.asset as OnChainAsset,
      address: candidate.address.trim(),
      exchange: candidate.exchange.trim(),
      walletRole: candidate.walletRole as ExchangeWalletRole,
      labelStatus: 'verified',
      sourceUrl: sourceUrl.toString(),
      verifiedAt: candidate.verifiedAt,
      reviewBy: candidate.reviewBy,
    };
  });
  const keys = labels.map(({ asset, address }) => `${asset}:${canonicalAddress(asset, address)}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error('On-chain wallet label file contains duplicate asset/address entries.');
  }
  return { schemaVersion: 1, labels };
}

export async function loadVerifiedOnChainWalletLabels(
  nowMs = Date.now(),
): Promise<{ labels: readonly VerifiedOnChainWalletLabel[]; fingerprint: string }> {
  let contents: Buffer;
  try {
    contents = await readFile(LABEL_FILE_PATH);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      throw new Error(`Verified on-chain wallet label file is missing: ${LABEL_FILE_PATH}`);
    }
    throw error;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(contents.toString('utf8'));
  } catch (error) {
    throw new Error(`Verified on-chain wallet label file is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const file = parseWalletLabelFile(decoded, nowMs);
  return {
    labels: file.labels,
    fingerprint: createHash('sha256').update(contents).digest('hex'),
  };
}

export function findVerifiedOnChainWalletLabel(
  labels: readonly VerifiedOnChainWalletLabel[],
  asset: OnChainAsset,
  address: string | undefined,
): VerifiedOnChainWalletLabel | null {
  if (!address) return null;
  const key = canonicalAddress(asset, address);
  return labels.find((label) =>
    label.asset === asset && canonicalAddress(asset, label.address) === key
  ) ?? null;
}
