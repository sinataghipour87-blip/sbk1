const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_MAX_MS = 15 * 60_000;
const HEALTH_ENTRY_TTL_MS = 60 * 60_000;
const MAX_HEALTH_ENTRIES = 128;
const RATE_LIMIT_STATUSES = new Set([429, 503]);

interface ProviderHealth {
  score: number;
  consecutiveFailures: number;
  cooldownUntilMs: number;
  lastStatus: number | null;
  lastSeenAtMs: number;
}

const providerHealth = new Map<string, ProviderHealth>();

function providerKey(input: RequestInfo | URL): string {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return url.origin;
}

function pruneProviderHealth(nowMs: number): void {
  for (const [key, health] of providerHealth) {
    if (nowMs - health.lastSeenAtMs >= HEALTH_ENTRY_TTL_MS) providerHealth.delete(key);
  }
  while (providerHealth.size >= MAX_HEALTH_ENTRIES) {
    const oldestKey = providerHealth.keys().next().value as string | undefined;
    if (!oldestKey) break;
    providerHealth.delete(oldestKey);
  }
}

function recordProviderResult(key: string, response: Response, nowMs: number): void {
  const previous = providerHealth.get(key);
  if (RATE_LIMIT_STATUSES.has(response.status)) {
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
    const retryAfter = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    const retryAfterDateMs = retryAfter === null ? Number.NaN : Date.parse(retryAfter);
    const requestedCooldownMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1_000
      : Number.isFinite(retryAfterDateMs) && retryAfterDateMs > nowMs
        ? retryAfterDateMs - nowMs
        : COOLDOWN_BASE_MS * (2 ** Math.min(consecutiveFailures - 1, 5));
    providerHealth.set(key, {
      score: Math.max(0, (previous?.score ?? 100) - 25),
      consecutiveFailures,
      cooldownUntilMs: nowMs + Math.min(requestedCooldownMs, COOLDOWN_MAX_MS),
      lastStatus: response.status,
      lastSeenAtMs: nowMs,
    });
    return;
  }
  if (response.ok) {
    providerHealth.set(key, {
      score: Math.min(100, (previous?.score ?? 75) + 10),
      consecutiveFailures: 0,
      cooldownUntilMs: 0,
      lastStatus: response.status,
      lastSeenAtMs: nowMs,
    });
  }
}

export async function fetchOnChainProvider(
  input: RequestInfo | URL,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<Response> {
  if (fetcher !== globalThis.fetch) return fetcher(input, init);
  const key = providerKey(input);
  pruneProviderHealth(nowMs);
  const health = providerHealth.get(key);
  if (health && health.cooldownUntilMs > nowMs) {
    throw new Error(
      `On-chain provider ${key} is cooling down after HTTP ${health.lastStatus}; retry after ${new Date(health.cooldownUntilMs).toISOString()}.`,
    );
  }
  const response = await fetcher(input, init);
  recordProviderResult(key, response, nowMs);
  return response;
}

export function getOnChainProviderHealth(nowMs = Date.now()): readonly {
  provider: string;
  score: number;
  consecutiveFailures: number;
  cooldownUntilMs: number;
  lastStatus: number | null;
}[] {
  pruneProviderHealth(nowMs);
  return [...providerHealth].map(([provider, health]) => ({
    provider,
    score: health.score,
    consecutiveFailures: health.consecutiveFailures,
    cooldownUntilMs: health.cooldownUntilMs,
    lastStatus: health.lastStatus,
  }));
}

export function resetOnChainProviderHealthForTests(): void {
  providerHealth.clear();
}
