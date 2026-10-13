import { ExecutionMode } from '../types/trading';

const EXECUTION_MODE_STORAGE_KEY = 'quantum_execution_mode';

function isExecutionMode(value: unknown): value is ExecutionMode {
  return value === 'BACKTEST' || value === 'DRY_RUN' || value === 'TESTNET' || value === 'PAPER' || value === 'LIVE';
}

export function getSelectedExecutionMode(): ExecutionMode {
  const savedMode = localStorage.getItem(EXECUTION_MODE_STORAGE_KEY);
  if (savedMode === 'LIVE' || savedMode === 'TESTNET') {
    localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, 'DRY_RUN');
    return 'DRY_RUN';
  }
  return isExecutionMode(savedMode) ? savedMode : 'DRY_RUN';
}

export function saveSelectedExecutionMode(mode: ExecutionMode): void {
  localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, mode);
}
