import assert from 'node:assert/strict';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

const { getSelectedExecutionMode, saveSelectedExecutionMode } = await import('../src/services/executionMode');
for (const legacyMode of ['LIVE', 'TESTNET']) {
  values.set('quantum_execution_mode', legacyMode);
  assert.equal(getSelectedExecutionMode(), 'DRY_RUN');
  assert.equal(values.get('quantum_execution_mode'), legacyMode);
}

values.delete('quantum_execution_mode');
assert.equal(getSelectedExecutionMode(), 'DRY_RUN');
saveSelectedExecutionMode('DRY_RUN');
assert.equal(values.has('quantum_execution_mode'), false, 'execution profile must not be controlled by localStorage');
assert.throws(() => saveSelectedExecutionMode('LIVE'), /controlled by the SBK1 server/);
console.log('Execution profile is server-controlled; localStorage cannot select LIVE.');
