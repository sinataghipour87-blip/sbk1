# Baseline Check

Date: 2026-10-13

## Worktree

Before checks, `git status --short --untracked-files=all` reported one modified file: `.github/instructions/instructions.md`. No untracked files were reported. The baseline checks did not modify that file. `npm ci` and the build completed without adding any other visible worktree changes.

## SQLite Data

`freqtrade/tradesv3.dryrun.sqlite`, `freqtrade/tradesv3.dryrun.sqlite-wal`, and `freqtrade/tradesv3.dryrun.sqlite-shm` are all absent. Therefore no timestamped backup could be created in `backups/`; no database was deleted or changed. Git ignore rules cover the database and both sidecar patterns via `freqtrade/.gitignore`.

Recommendation: keep the database, WAL, and SHM files ignored. They are runtime/trade persistence data and should not be committed. If present in a future run, back them up before any operation that could change them.

## Environment and Freqtrade Config

- `.env` is absent. It is ignored by `.gitignore`.
- `freqtrade/user_data/config.json` is absent. It is ignored by `freqtrade/.gitignore`.
- Since `.env` is absent, these required runtime keys are missing and their values cannot be checked: `FREQTRADE_PAIR`, `SBK1_FREQTRADE_PAIR`, `SBK1_SIGNAL_EXCHANGE`, `SBK1_FREQTRADE_TIMEFRAME`, `SBK1_FREQTRADE_BRIDGE_TOKEN`, `ADMIN_TOKEN`, `FREQTRADE_USERNAME`, and `FREQTRADE_PASSWORD`.
- Since the Freqtrade config is absent, its required values and any blank or placeholder entries cannot be inspected. In particular, `dry_run: true` and `force_entry_enable: false` are unverified.
- `npm run sbk1:check` confirmed the blocking config issue: `Startup failed: Freqtrade config freqtrade/user_data/config.json file is missing.`

## Requested Commands

- `npm ci`: **PASS**. Installed 359 packages. npm reported 3 moderate audit vulnerabilities and dependency/install-script notices.
- `npm test`: **FAIL**. The TypeScript and contract verification stages passed, including the SBK1 runtime checks. The Python stage could not start because `.venv/bin/python` is missing (`Install Freqtrade into .venv first.`).
- `npm run lint`: **PASS**. `tsc --noEmit` completed without diagnostics.
- `npm run build`: **PASS**. Vite built successfully. It warned that some output chunks exceed 500 kB after minification.
- `npm run sbk1:check`: **FAIL**. Managed startup check stopped because `freqtrade/user_data/config.json` is missing.

## Problems Found

1. Required private `.env` and Freqtrade config files are absent; runtime values, config validity, and dry-run safety flags could not be verified.
2. The dry-run SQLite database and sidecars are absent, so no requested backup was possible.
3. Python tests cannot run without the repository `.venv`; the environment was not created or modified.
4. npm reported 3 moderate audit vulnerabilities; no audit fix was applied.
5. The successful build has a large-chunk warning.