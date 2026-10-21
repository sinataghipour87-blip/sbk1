import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const virtualEnvPython = (directory: string) => process.platform === 'win32'
  ? path.resolve(directory, 'Scripts', 'python.exe')
  : path.resolve(directory, 'bin', 'python');
const isolatedPython = virtualEnvPython(path.resolve('.cache', 'sbk1', 'open-source-analysis-venv'));
const projectPython = virtualEnvPython('.venv');
const python = process.env.SBK1_PYTHON?.trim() ||
  (existsSync(isolatedPython) ? isolatedPython : projectPython);

if (!existsSync(python)) {
  console.error(`Open-source advisory verification interpreter not found at ${python}.`);
  process.exitCode = 1;
} else {
  const result = spawnSync(
    python,
    ['scripts/verify_open_source_advisories.py'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        SBK1_MODEL_CACHE_DIR: process.env.SBK1_MODEL_CACHE_DIR?.trim() ||
          path.resolve('.cache/sbk1/open-source-models'),
      },
    },
  );
  if (result.error) {
    console.error(`Could not run offline advisory verification: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
