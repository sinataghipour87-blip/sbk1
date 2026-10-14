import type { ExecutionMode } from '../types/trading';

export interface ExecutionSettings {
  mode: ExecutionMode;
  selectedProfile?: 'DEMO' | 'LIVE';
}

let executionSettingsRequest: Promise<ExecutionSettings> | null = null;

function isExecutionMode(value: unknown): value is ExecutionMode {
  return value === 'BACKTEST' || value === 'DRY_RUN' || value === 'TESTNET' || value === 'PAPER' || value === 'LIVE';
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

    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('mode' in data)) {
      throw new Error('پاسخ حالت اجرا معتبر نیست.');
    }

    const mode = data.mode;
    if (!isExecutionMode(mode)) {
      throw new Error('حالت اجرای پشتیبانی‌نشده از سرور دریافت شد.');
    }

    if (mode !== 'DRY_RUN' || ('selectedProfile' in data && data.selectedProfile !== 'DEMO')) {
      throw new Error('سرور پروفایل DEMO مورد انتظار را تأیید نکرد.');
    }

    return { mode, selectedProfile: 'DEMO' };
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
