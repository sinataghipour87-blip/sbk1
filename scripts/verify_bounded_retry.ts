import assert from 'node:assert/strict';
import { retryWithBackoff } from '../src/services/boundedRetry';

let attempts = 0;
const retryNumbers: number[] = [];
const value = await retryWithBackoff(
  async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary RPC failure');
    return 'synced';
  },
  {
    attempts: 3,
    initialDelayMs: 1,
    onRetry: (_error, nextAttempt) => retryNumbers.push(nextAttempt),
  },
);
assert.equal(value, 'synced');
assert.equal(attempts, 3);
assert.deepEqual(retryNumbers, [2, 3]);

const terminalError = new Error('RPC remained unavailable');
attempts = 0;
await assert.rejects(
  retryWithBackoff(
    async () => {
      attempts += 1;
      throw terminalError;
    },
    { attempts: 3, initialDelayMs: 1 },
  ),
  (error: unknown) => error === terminalError,
);
assert.equal(attempts, 3, 'retry count must stay within the configured bound');

console.log('Bounded exponential-backoff retry checks passed.');
