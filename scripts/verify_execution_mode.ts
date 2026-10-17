import assert from 'node:assert/strict';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

let serverSettings: { mode: string; selectedProfile: string } = {
  mode: 'DRY_RUN',
  selectedProfile: 'DEMO',
};
let liveModeEnabledMock = false;
async function executionSettingsFetchMock(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (requestUrl === '/api/execution/mode' && init?.method === 'POST') {
    const requested = JSON.parse(String(init.body)) as { mode?: string };
    if (requested.mode === 'LIVE' && !liveModeEnabledMock) {
      return new Response(JSON.stringify({ error: 'حالت LIVE پذیرفته نشد؛ SBK1_LIVE_ENABLED=true لازم است.' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    serverSettings = {
      mode: requested.mode ?? 'DRY_RUN',
      selectedProfile: requested.mode === 'LIVE' ? 'LIVE' : 'DEMO',
    };
    return new Response(JSON.stringify({ success: true, settings: serverSettings }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(serverSettings), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
globalThis.fetch = executionSettingsFetchMock;

const {
  getExecutionSettings,
  getSelectedExecutionMode,
  requestExecutionMode,
  saveSelectedExecutionMode,
} = await import('../src/services/executionMode');
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
assert.deepEqual(await getExecutionSettings(), { mode: 'DRY_RUN', selectedProfile: 'DEMO' });
await assert.rejects(requestExecutionMode('LIVE', 'named-admin-token'), /SBK1_LIVE_ENABLED=true/);
liveModeEnabledMock = true;
assert.deepEqual(await requestExecutionMode('LIVE', 'named-admin-token'), {
  mode: 'LIVE',
  selectedProfile: 'LIVE',
});
assert.deepEqual(await getExecutionSettings(), { mode: 'LIVE', selectedProfile: 'LIVE' });
serverSettings = { mode: 'LIVE', selectedProfile: 'DEMO' };
await assert.rejects(getExecutionSettings(), /پروفایل اجرایی اعلام‌شده از سرور/);
console.log('Execution profiles are server-controlled; named fetch mock verifies DEMO/LIVE server responses and mismatch rejection.');
