import type {
  CouncilWhaleFlowData,
  CouncilWhaleTransfer,
} from './eightMemberCouncil';

export interface ConfiguredCexWallet {
  address: string;
  exchange: string;
}

export function parseCexWallets(
  envName: string,
  isValidAddress: (address: string) => boolean,
): { wallets: ConfiguredCexWallet[]; error: string | null } {
  const raw = process.env[envName]?.trim();
  if (!raw) return { wallets: [], error: `${envName} is not configured.` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { wallets: [], error: `${envName} must be a JSON object mapping addresses to exchange names.` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { wallets: [], error: `${envName} must be a JSON object mapping addresses to exchange names.` };
  }

  const wallets = Object.entries(parsed).map(([address, exchange]) => ({
    address: address.trim(),
    exchange: typeof exchange === 'string' ? exchange.trim() : '',
  }));
  if (wallets.some(({ address, exchange }) =>
    !isValidAddress(address) || exchange.length < 2 || exchange.length > 80
  )) {
    return {
      wallets: [],
      error: `${envName} contains an invalid address or exchange label; no wallet was used.`,
    };
  }
  if (new Set(wallets.map(({ address }) => address.toLowerCase())).size !== wallets.length) {
    return { wallets: [], error: `${envName} contains duplicate addresses.` };
  }
  return { wallets, error: null };
}

export function unavailableOnChainFlow(
  pair: string,
  asset: string,
  provider: string,
  reason: string,
): CouncilWhaleFlowData {
  return {
    pair,
    asset,
    status: 'UNAVAILABLE',
    provider,
    timestampMs: null,
    retrievedAtMs: null,
    ageMs: null,
    qualityPct: 0,
    coverageStatus: 'UNAVAILABLE',
    unavailableReason: reason,
    largeTransfers: [],
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 0,
    windowStartHeight: null,
    windowEndHeight: null,
  };
}

export function makeOnChainFlow(
  options: {
    pair: string;
    asset: string;
    provider: string;
    transfers: CouncilWhaleTransfer[];
    observedAtMs: number;
    retrievedAtMs: number;
  },
): CouncilWhaleFlowData {
  const ageMs = Math.max(0, options.retrievedAtMs - options.observedAtMs);
  const status = ageMs <= 5 * 60_000 ? 'LIVE' : 'STALE';
  return {
    pair: options.pair,
    asset: options.asset,
    status,
    provider: options.provider,
    timestampMs: options.observedAtMs,
    retrievedAtMs: options.retrievedAtMs,
    ageMs,
    qualityPct: status === 'LIVE' ? 90 : 0,
    coverageStatus: status === 'LIVE' ? 'SAMPLED' : 'UNAVAILABLE',
    unavailableReason: status === 'LIVE' ? undefined : 'Latest observed chain activity is older than five minutes.',
    largeTransfers: options.transfers,
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: options.transfers.length,
    windowStartHeight: null,
    windowEndHeight: null,
  };
}

export function redactCredential(error: unknown, credential: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  return credential ? message.replaceAll(credential, '[REDACTED]') : message;
}

export async function fetchJson(
  url: URL,
  fetcher: typeof fetch,
  provider: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...headers },
    });
    if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
