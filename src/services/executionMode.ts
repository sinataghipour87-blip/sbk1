import { ExecutionMode } from '../types/trading';

const EXECUTION_MODE_STORAGE_KEY = 'quantum_execution_mode';
const EXECUTION_MODE_CACHE_TTL_MS = 45_000;

export interface ExecutionSettings {
  mode: ExecutionMode;
  liveCapitalCeilingPct?: number;
}

let cachedExecutionSettings: { value: ExecutionSettings; expiresAt: number } | null = null;
let executionSettingsRequest: Promise<ExecutionSettings> | null = null;

function isExecutionMode(value: unknown): value is ExecutionMode {
  return value === 'BACKTEST' || value === 'TESTNET' || value === 'PAPER' || value === 'LIVE';
}

export function getSelectedExecutionMode(): ExecutionMode {
  const savedMode = localStorage.getItem(EXECUTION_MODE_STORAGE_KEY);
  return isExecutionMode(savedMode) ? savedMode : 'BACKTEST';
}

export function saveSelectedExecutionMode(mode: ExecutionMode): void {
  if (getSelectedExecutionMode() !== mode) {
    cachedExecutionSettings = null;
  }
  localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, mode);
}

export async function getExecutionSettings(): Promise<ExecutionSettings> {
  const selectedMode = getSelectedExecutionMode();
  if (selectedMode !== 'LIVE') {
    return { mode: selectedMode };
  }

  if (cachedExecutionSettings && Date.now() < cachedExecutionSettings.expiresAt) {
    return cachedExecutionSettings.value;
  }

  if (executionSettingsRequest) {
    return executionSettingsRequest;
  }

  const request = (async (): Promise<ExecutionSettings> => {
    const response = await fetch('/api/execution/settings');
    if (!response.ok) {
      if (response.status === 429 && cachedExecutionSettings && cachedExecutionSettings.value.mode !== 'LIVE') {
        return cachedExecutionSettings.value;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('mode' in data)) {
      throw new Error('پاسخ حالت اجرا معتبر نیست.');
    }

    const mode = data.mode;
    if (!isExecutionMode(mode)) {
      throw new Error('حالت اجرای پشتیبانی‌نشده از سرور دریافت شد.');
    }

    const settings: ExecutionSettings = { mode };
    if ('liveCapitalCeilingPct' in data && typeof data.liveCapitalCeilingPct === 'number') {
      settings.liveCapitalCeilingPct = data.liveCapitalCeilingPct;
    }

    cachedExecutionSettings = {
      value: settings,
      expiresAt: Date.now() + EXECUTION_MODE_CACHE_TTL_MS,
    };
    return settings;
  })();

  const trackedRequest = request.finally(() => {
    if (executionSettingsRequest === trackedRequest) {
      executionSettingsRequest = null;
    }
  });
  executionSettingsRequest = trackedRequest;
  return trackedRequest;
}

export async function getExecutionMode(): Promise<ExecutionMode> {
  return (await getExecutionSettings()).mode;
}
