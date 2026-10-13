import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const python = process.env.SBK1_PYTHON?.trim() || (
  process.platform === 'win32'
    ? path.resolve('.venv', 'Scripts', 'python.exe')
    : path.resolve('.venv', 'bin', 'python')
);

if (!existsSync(python)) {
  console.error(`Python test interpreter not found at ${python}. Install Freqtrade into .venv first.`);
  process.exitCode = 1;
} else {
  const result = spawnSync(
    python,
    [
      '-m',
      'unittest',
      'scripts.test_market_models',
      'scripts.test_sbk_signal_strategy',
      'scripts.test_realistic_backtester',
      'scripts.test_historical_decision_replay',
      'scripts.test_init_sbk1_config',
      'scripts.test_prediction_archive',
    ],
    { stdio: 'inherit' },
  );
  if (result.error) {
    console.error(`Could not run Python tests: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
