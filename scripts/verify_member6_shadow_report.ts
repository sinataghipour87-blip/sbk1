import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  hasSupportedShadowPriceMarket,
  makeUnavailableOutcome,
  shouldRetryUnavailableOutcome,
} from './member6-shadow-report';
import {
  member6ShadowSegmentPath,
  pruneExpiredMember6ShadowLogs,
} from '../src/services/member6ShadowLog';

const firstAttempt = makeUnavailableOutcome('Temporary provider error.', 0, 1_000);
assert.equal(firstAttempt.attempts, 1);
assert.equal(firstAttempt.retryAfterMs, 61_000);
assert.equal(shouldRetryUnavailableOutcome(firstAttempt, 60_999), false);
assert.equal(shouldRetryUnavailableOutcome(firstAttempt, 61_000), true);

const secondAttempt = makeUnavailableOutcome('Still unavailable.', firstAttempt.attempts ?? 0, 61_000);
assert.equal(secondAttempt.attempts, 2);
assert.equal(secondAttempt.retryAfterMs, 361_000);
assert.equal(shouldRetryUnavailableOutcome(secondAttempt, 360_999), false);
assert.equal(shouldRetryUnavailableOutcome(secondAttempt, 361_000), true);

const finalAttempt = makeUnavailableOutcome('Provider remains unavailable.', secondAttempt.attempts ?? 0, 361_000);
assert.equal(finalAttempt.attempts, 3);
assert.equal(finalAttempt.terminal, true);
assert.equal(shouldRetryUnavailableOutcome(finalAttempt, Number.MAX_SAFE_INTEGER), false);
assert.equal(
  shouldRetryUnavailableOutcome({
    status: 'UNAVAILABLE',
    reason: 'Permanent missing vote-time price.',
    attempts: 1,
    terminal: true,
  }, Number.MAX_SAFE_INTEGER),
  false,
);
assert.equal(hasSupportedShadowPriceMarket({
  asset: 'BTC',
  marketPair: 'BTC/USDT',
  marketExchange: 'Binance',
  marketType: 'spot',
}), true);
assert.equal(hasSupportedShadowPriceMarket({
  asset: 'ETH',
  marketPair: 'ETH/BTC',
  marketExchange: 'binance',
  marketType: 'spot',
}), false, 'non-USDT pairs cannot be scored against an ETH/USDT benchmark');
assert.equal(hasSupportedShadowPriceMarket({
  asset: 'SOL',
  marketPair: 'SOL/USDT',
  marketExchange: 'bybit',
  marketType: 'spot',
}), false, 'other exchanges cannot be scored against Binance candles');
assert.equal(hasSupportedShadowPriceMarket({
  asset: 'XRP',
  marketPair: 'XRP/USDT',
  marketExchange: 'binance',
  marketType: 'futures',
}), false, 'futures votes cannot be scored against spot candles');

const directory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-member6-retention-'));
try {
  const basePath = path.join(directory, 'votes.jsonl');
  const nowMs = Date.UTC(2026, 10, 5, 12);
  const expiredVotes = member6ShadowSegmentPath(basePath, nowMs - 91 * 24 * 60 * 60_000, 'votes');
  const expiredOutcomes = member6ShadowSegmentPath(basePath, nowMs - 91 * 24 * 60 * 60_000, 'outcomes');
  const recentVotes = member6ShadowSegmentPath(basePath, nowMs - 30 * 24 * 60 * 60_000, 'votes');
  await Promise.all([
    writeFile(expiredVotes, ''),
    writeFile(expiredOutcomes, ''),
    writeFile(recentVotes, ''),
  ]);
  const removed = await pruneExpiredMember6ShadowLogs(basePath, nowMs);
  assert.deepEqual(new Set(removed), new Set([expiredVotes, expiredOutcomes]));
  await assert.rejects(access(expiredVotes));
  await assert.rejects(access(expiredOutcomes));
  await access(recentVotes);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.info('Member 6 shadow-report bounded retry checks passed.');
