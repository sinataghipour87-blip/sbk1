import assert from 'node:assert/strict';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

const { getSelectedExecutionMode } = await import('../src/services/executionMode');
for (const legacyMode of ['LIVE', 'TESTNET']) {
  values.set('quantum_execution_mode', legacyMode);
  assert.equal(getSelectedExecutionMode(), 'DRY_RUN');
  assert.equal(values.get('quantum_execution_mode'), 'DRY_RUN');
}

values.delete('quantum_execution_mode');
assert.equal(getSelectedExecutionMode(), 'DRY_RUN');
console.log('Legacy LIVE/TESTNET execution modes migrate to Freqtrade DRY_RUN.');
