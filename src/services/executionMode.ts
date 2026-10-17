import type { ExecutionMode } from '../types/trading';

export interface ExecutionSettings {
  mode: ExecutionMode;
  selectedProfile?: 'DEMO' | 'LIVE';
}

let executionSettingsRequest: Promise<ExecutionSettings> | null = null;

function isExecutionMode(value: unknown): value is ExecutionMode {
  return value === 'BACKTEST' || value === 'DRY_RUN' || value === 'TESTNET' || value === 'PAPER' || value === 'LIVE';
}

function parseExecutionSettings(value: unknown): ExecutionSettings {
  if (typeof value !== 'object' || value === null || !('mode' in value)) {
    throw new Error('پاسخ حالت اجرا معتبر نیست.');
  }
  const mode = value.mode;
  if (!isExecutionMode(mode)) {
    throw new Error('حالت اجرای پشتیبانی‌نشده از سرور دریافت شد.');
  }
  const selectedProfile = 'selectedProfile' in value ? value.selectedProfile : undefined;
  if (
    (mode === 'LIVE' && selectedProfile !== 'LIVE') ||
    (mode === 'DRY_RUN' && selectedProfile !== 'DEMO') ||
    (selectedProfile !== undefined && selectedProfile !== 'DEMO' && selectedProfile !== 'LIVE')
  ) {
    throw new Error('پروفایل اجرایی اعلام‌شده از سرور با حالت انتخاب‌شده سازگار نیست.');
  }
  return {
    mode,
    ...(selectedProfile === 'DEMO' || selectedProfile === 'LIVE' ? { selectedProfile } : {}),
  };
}

export function getSelectedExecutionMode(): ExecutionMode {
  return 'DRY_RUN';
}

export function saveSelectedExecutionMode(mode: ExecutionMode): void {
  if (mode !== 'DRY_RUN') {
    throw new Error('Execution profiles are controlled by the SBK1 server, not browser storage.');
  }
}

export async function getExecutionSettings(): Promise<ExecutionSettings> {
  if (executionSettingsRequest) {
    return executionSettingsRequest;
  }

  const request = (async (): Promise<ExecutionSettings> => {
    const response = await fetch('/api/execution/settings');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return parseExecutionSettings(await response.json());
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

export async function requestExecutionMode(mode: ExecutionMode, adminToken: string): Promise<ExecutionSettings> {
  if (!adminToken.trim()) throw new Error('برای انتخاب حالت اجرا، توکن ادمین لازم است.');
  const response = await fetch('/api/execution/mode', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': adminToken,
    },
    body: JSON.stringify({ mode }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'string'
      ? payload.error
      : `HTTP ${response.status}`;
    throw new Error(error);
  }
  if (typeof payload !== 'object' || payload === null || !('settings' in payload)) {
    throw new Error('پاسخ تنظیم حالت اجرا از سرور معتبر نیست.');
  }
  const settings = parseExecutionSettings(payload.settings);
  if (settings.mode !== mode) throw new Error('سرور حالت اجرایی درخواستی را اعمال نکرد.');
  return settings;
}
