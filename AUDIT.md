# SBK1 Repository Audit

**Audit date:** 2026-10-11  
**Repository:** `sinataghipour87-blip/sbk1`  
**Scope:** Tracked-tree inventory, first-party entrypoints, startup/configuration, API health, market-data and signal flow, Freqtrade strategy/RPC, execution ownership, UI wiring, runtime artifacts, and all package tests. This is a source-path audit; it is not a line-by-line review of every upstream Freqtrade module.

## Executive summary

The immediate startup failure in the observed workspace is reproducible and is not caused by missing Node/Python dependencies or a missing private Freqtrade config:

1. `npm run sbk1:check` succeeds, including discovery of `SbkSignalStrategy`.
2. The current Freqtrade RPC responds to ping, authenticates, and reports a running dry-run bot with the expected strategy/configuration.
3. The managed `npm run sbk1` refuses to start because unmanaged processes already hold ports 3000 and 8080.
4. Independently, `npm run sbk1:status` reports Freqtrade ready but rejects the SBK1 health endpoint because it returns the Vite HTML shell (`200 text/html`) rather than the JSON response implemented by the current `server.ts`.
5. The listener processes were started at 10:27 UTC; the checked-out `server.ts` was updated at 11:01 UTC and the current commit is dated 11:27 UTC. The server process therefore predates the current source. Its stale route table does not have the current health route, and Vite's SPA fallback serves `index.html` for `/api/health`.

The initial failure of the official start command in this workspace was a stale, separately launched development stack occupying both service ports. After confirming Freqtrade was in dry-run with zero open trades, the owner authorized a graceful stop. The managed start then succeeded and the stale server's HTML response was replaced by the expected JSON health response.

The checked-in design already has a managed supervisor and a versioned fail-closed signal adapter. Production SBK1 signals are disabled because calibrated-probability evidence is unavailable. The explicitly enabled fixture is dry-run-only. During the initial audit no fixture was submitted. During the later, explicitly requested end-to-end validation, one fixture created a simulated Freqtrade entry order; it was cancelled by the configured timeout without a fill or open position. Mock tests did not call any order endpoint.

## Current architecture and execution graph

```text
Browser
  └─ index.html → src/main.tsx → src/App.tsx
       ├─ React dashboard components
       ├─ active analysis / market / provenance services
       └─ same-origin HTTP requests to SBK1 only

npm run sbk1
  └─ scripts/run_sbk1.ts (configuration, prerequisites, ports, lock, health, shutdown)
       ├─ server.ts (Express API + Vite middleware + public market-data feed)
       │    ├─ marketData / analysisEngine
       │    ├─ freqtradeBridge (authenticated read-only RPC)
       │    ├─ freqtradeSignalAdapter (versioned, expiring, idempotent JSON outbox)
       │    └─ legacy Bybit code (mutation routes rejected; old daemon has no caller)
       └─ .venv/bin/freqtrade trade
            └─ freqtrade_integration/strategies/SbkSignalStrategy.py
                 ├─ polls authenticated SBK1 signal queue
                 ├─ validates Python contract and freshness
                 └─ Freqtrade owns orders, fills, positions, stop-losses and trade DB
```

The static import walk covered the browser and server entrypoints. The large `TfjsReinforcementLearningWidget` and engine are dynamically imported by `App.tsx`; a static-only walk initially missed them, but the dynamic import and production build confirm that they are intentional. `src/scripts/verify_full_execution_truth_chain.ts` is not referenced by the package scripts. The service and component directories are not interchangeable with the runtime graph: many files are imported transitively by the dashboard or the Node server.

## Runtime findings and command evidence

Commands and observed outcomes (secrets intentionally omitted):

| Command / probe | Result |
|---|---|
| `npm run sbk1:check` | **PASS** — private runtime settings accepted; Freqtrade discovered `SbkSignalStrategy`; no service started. |
| `npm run sbk1:status` (initial) | **FAIL (stale service)** — SBK1 returned `200 text/html` for `/api/health`; Freqtrade RPC was reported ready. |
| `curl http://127.0.0.1:3000/api/health` (initial) | **FAIL (contract)** — returned the current Persian Vite `index.html` shell, not JSON. |
| `npm run sbk1` (initial) | **FAIL (safely refused)** — ports 3000 and 8080 already had listeners; duplicate services were not started. |
| `npm run verify:freqtrade` | **RPC PASS / live readiness FAIL (expected)** — ping and authentication succeeded; bot running, `dry_run=true`, `force_entry_enable=false`, correct strategy/market/pair, zero open trades; live readiness is false. No orders placed. |
| `npm run verify:freqtrade:dry-run` | **PASS (read-only readiness)** — fixture configuration, bridge token and RPC gates ready; the command itself does not submit a fixture. |
| `npm run verify:freqtrade:contract` | **PASS** — authenticated local RPC mock; no order endpoint called. |
| `npm test` | **PASS** — all included SBK1 checks, 18 fail-closed scenarios, signal contract/adapter and fixture tests, mock RPC contract, runtime validation, and 12 Python unit tests. |
| `npm run lint` | **PASS** — `tsc --noEmit`. An earlier parallel invocation was terminated under load; the isolated rerun passed. |
| `npm run build` | **PASS** — Vite built successfully; it warned about JavaScript chunks around 1.59 MB after minification. |
| `.venv/bin/python -m pip check` | **PASS** — no broken installed requirements. |
| `.venv/bin/freqtrade --version` | **PASS** — `freqtrade 2026.10-dev-f17c36f`, Python 3.14.2, CCXT 4.5.85. The vendored project's `pyproject.toml` declares Python >=3.12 and lists 3.14. |
| Python `py_compile` on integration and research scripts | **PASS**. |
| `npm run sbk1` (after authorized stop) | **PASS** — strategy discovered; both services started and reported ready. |
| `npm run sbk1:status` (managed stack) | **PASS** — both SBK1 API and Freqtrade RPC healthy. |
| `curl http://127.0.0.1:3000/api/health` (managed stack) | **PASS** — `200 application/json`, `{"status":"ok","service":"sbk1"}`. |
| Authenticated `POST /api/freqtrade/dry-run-test-signal` | **PASS — test-only** — HTTP 201, accepted one fixture; no live exchange order request was made. |
| Freqtrade fixture lifecycle | **PASS, no fill** — Freqtrade created a simulated limit entry, its configured 15-second timeout cancelled it, it was removed from open trades, and no position/fill remained. Initially SBK1 stayed at `ORDER_SUBMITTED`; following the reconciliation fix and restart, it became `CANCELLED` because Freqtrade reported no open trade for it. |
| Managed Ctrl+C / SIGINT shutdown | **PASS** — both services stopped, ports were released, and `.sbk1-run.lock` was removed. |

### Prerequisites and configuration

- Node.js 24.21.0/npm 11.19.0 and Python 3.14.2 are available. `node_modules` and `.venv` are present.
- `freqtrade/user_data/config.json` exists, is ignored/private, and is the config used by the manager. The expected strategy file and executable exist.
- The active private config is dry-run, API-enabled, and its RPC username/password match the server-side `FREQTRADE_USERNAME`/`FREQTRADE_PASSWORD` without exposing values.
- The original `.env.example` omitted `FREQTRADE__API_SERVER__USERNAME` and `FREQTRADE__API_SERVER__PASSWORD`; both keys are now present and documented as matching server-side `FREQTRADE_USERNAME` and `FREQTRADE_PASSWORD`. The active private config's populated credentials matched during the checks.
- `.env.example` also describes `FREQTRADE_PAIR`, while the private config and `SBK1_FREQTRADE_PAIR` separately declare the pair. The manager validates exact agreement. This is an intentional guard but should be documented as one shared value.
- `config.json` at repository root is also ignored and is not the manager's configured Freqtrade config. Keep it private and do not assume it is authoritative.
- The Freqtrade API uses loopback port 8080; SBK1 is fixed at port 3000 in the manager, Vite config and server. Both ports were occupied by the stale stack initially, then safely freed by the owner-authorized SIGINT. The managed stack was subsequently launched and stopped. A dry-run fixture changed the tracked `tradesv3.dryrun.sqlite`; normal shutdown checkpointed and removed its transient WAL/SHM files. The database was not reverted or deleted.
- The private Freqtrade config and `.env` exist, but a clean dependency installation (`npm ci` and Python reinstall) was not attempted. The active environment passing `pip check` does not prove clean-room reproducibility.

## Implemented versus illustrative dashboard behavior

- The core web UI, Express endpoints, Bybit linear-futures market-data readers, signal validation, authenticated Freqtrade RPC reads, and Freqtrade strategy are executable code paths.
- The dashboard contains calculators, research widgets, simulations and heuristic metrics. In particular, `server.ts`'s `/api/backtest/run` invokes `scripts/realistic_backtester.py --synthetic`; its output is synthetic/research output, not an exchange-backed or historical Freqtrade result.
- `DemoTestingSandbox`, local calculation widgets and the Python research/backtest scripts must not be interpreted as live execution evidence. A displayed status/score does not establish an order, fill or position.
- `HunterOrderFlowDashboardWidget` can request an analysis candidate, but `/api/hunter/execute` fails closed while calibrated probability evidence is unavailable.
- Existing `App.tsx` controls still call legacy `/api/exchange/*` and `/api/live/toggle-auto-trade` routes. Server middleware rejects the direct-execution routes before their handlers; the auto-trade toggle reports the legacy feature disabled. These controls can appear interactive while being intentionally non-operative and should be aligned with the backend contract.
- Public feed fallback values are marked unavailable/zero rather than permitted as a signal. Live market-data reachability and freshness were not asserted by the read-only RPC tests.

## Execution ownership and legacy paths

Freqtrade is the sole order/fill/position authority in the active integration. The TypeScript RPC bridge uses authentication and reads status, trades, balances and whitelist. The TypeScript signal adapter and Python strategy share `sbk1.freqtrade.signal.v1`; both enforce pair/exchange/timeframe, freshness/expiry and risk fields. The adapter persists signal lifecycle metadata and prevents duplicate IDs; it is not the official trade database.

`server.ts` still contains substantial older Bybit mutation/recovery code. Static reference checks show:

- `/api/exchange/*` mutation handlers are registered behind `rejectLegacyExchangeExecution`, so their handler bodies are not reached.
- `evaluateStrategyCheck`, `recoverPositionsOnStartup`, and `reconcileWithBybit` have definitions but no callsites in the current server entrypoint.
- `runServerSidePositionTicks` is called by the public WebSocket but immediately returns.
- `liveAutoTradeEnabled` initializes false, and the current toggle route does not enable it.

This establishes that the old execution daemon is not an active order owner in the current startup path, but retaining large dormant order/recovery bodies is unnecessary risk and confusion. Do not delete them until all UI callers, route compatibility, persisted legacy data and tests are accounted for. The SBK1 kill switch blocks SBK1 signal delivery; it does not represent Freqtrade's live order/position state.

## Prioritized problems

| Priority | Finding | Evidence / impact | Proposed disposition |
|---|---|---|---|
| P0 — operational (resolved for this run) | Stale unmanaged services initially occupied the official ports; SBK1's health route served HTML. | Manager correctly refused duplicate listeners; after authorized SIGINT, managed start, JSON health and RPC all passed. | Keep manager-only launch policy; if ports are occupied, identify their owners and coordinate before stopping. |
| P1 — setup (remediated) | Sample credentials were inconsistent for a clean private Freqtrade config. | The previous `.env.example` omitted nested Freqtrade API username/password overrides; config example leaves those fields blank. | Matching names are now explicit in `.env.example` and setup instructions; keep actual secrets private. |
| P1 — UX/ownership | Dashboard still exposes calls to blocked legacy order routes. | `App.tsx` calls `/api/exchange/order`, close and stop-loss routes; backend rejects them. | Keep server gates; make UI explicitly read-only/disabled until it submits the supported signal contract. |
| P1 — maintenance | Dormant direct-Bybit and local position lifecycle code remains in `server.ts`. | Unreferenced daemon/recovery routines and middleware-rejected order bodies coexist with Freqtrade. | Inventory all remaining callers and data dependencies, then replace/remove in a separate tested change; no blind deletion. |
| P2 — truthfulness | The dashboard's backtest endpoint uses synthetic input. | `/api/backtest/run` passes `--synthetic`. | Label clearly as synthetic or wire actual historical data/Freqtrade backtesting; do not treat it as production evidence. |
| P2 — reproducibility | Clean installs remain unverified, although managed process lifecycle is now tested. | Existing installed dependencies pass checks; a clean dependency install was not performed. | Test clean Node/Python installation in an isolated environment. |
| P2 — maintainability | One execution-truth verification script is outside the package test command; build bundle is large. | `src/scripts/verify_full_execution_truth_chain.ts` is not referenced by package scripts; Vite emitted ~1.59 MB chunks. | Decide whether to move/integrate the test; optimize lazy-loaded bundles separately without removing capabilities. |

## File disposition register

| File / area | Decision | Reason and dependency evidence |
|---|---|---|
| `scripts/run_sbk1.ts` | **Keep** | Official supervisor; validates private config, Python strategy discovery, ports, lock, API/RPC readiness and child shutdown. |
| `scripts/run_freqtrade.ts` | **Keep disabled** | Explicitly refuses standalone startup and directs users to the manager; retain as a guard against a second unmanaged bot. |
| `server.ts` | **Keep; migrate then simplify** | Active API, Vite and public market-data feed; legacy execution code is dormant/rejected but has not yet been fully removed. |
| `src/services/freqtradeBridge.ts` | **Keep** | Authenticated RPC reader used by API and runtime checks. |
| `src/services/freqtradeSignalAdapter.ts` | **Keep** | Active versioned, validated, idempotent signal outbox and lifecycle metadata. |
| `src/services/freqtradeDryRunFixture.ts` | **Keep** | Used by server dry-run fixture routes and tests; not a production signal generator. |
| `freqtrade_integration/strategies/SbkSignalStrategy.py` and `sbk_signal_contract.py` | **Keep** | Strategy discovery succeeds; Python consumer validates the shared contract, delegates execution/trade state to Freqtrade, and reconciles cancelled submitted-signal records against Freqtrade open trades. |
| `freqtrade/` (768 tracked files) | **Keep** | Vendored Freqtrade source is the actual execution engine; version and license are present (2026.10-dev, GPLv3), and Python 3.14 is explicitly listed as supported. No replacement engine was evaluated. |
| `freqtrade_integration/config.example.json` | **Keep; align setup docs** | Needed to provision the private user config; currently leaves credentials blank by design. |
| `.env.example` | **Update template** | Added the two nested RPC credential override names needed when the config template's credential fields are blank. |
| `freqtrade/user_data/config.json`, root `config.json`, `.env` | **Keep outside delivery** | Private runtime settings; the manager uses only `freqtrade/user_data/config.json`. Root config is duplicate/unused in the inspected manager path; do not delete without owner review. |
| `tradesv3.dryrun.sqlite*` | **Keep runtime-only; review tracking and back up before maintenance** | The main SQLite file was tracked and open in the original worktree. The authorized dry-run fixture changed it; normal Freqtrade shutdown checkpointed and removed transient WAL/SHM sidecars. The main file remains and was not reverted or deleted. Exclude it from future delivery only after review and backup. |
| `database_kill_switch.json`, `trading_audit.log`, `database_*.json` | **Keep outside delivery** | Runtime state/audit artifacts, ignored by Git; not source modules. |
| `.venv/`, `node_modules/`, `dist/` | **Keep local; exclude from source package** | Installed runtime/build artifacts; regenerate using documented install/build commands. |
| `src/scripts/verify_full_execution_truth_chain.ts` | **Move or wire into tests after review** | No package-script caller was found; preserve until its test coverage and intended use are decided. |
| `src/components/TfjsReinforcementLearningWidget.tsx` and `tfjsReinforcementLearningEngine.ts` | **Keep** | Dynamic imports from `App.tsx`; static import-only graph would incorrectly classify them as dead. |
| `src/App.tsx`, `src/main.tsx`, `index.html` | **Keep user changes** | These three files were already modified in the worktree before this audit. Their local changes were preserved. |
| `scripts/realistic_backtester.py` and market-model scripts | **Keep as research/test tools** | Invoked for synthetic/research output and Python unit tests; not Freqtrade's official execution database. |

No source file was changed and no runtime file was removed during the initial evidence-gathering phase.

## Target architecture and staged remediation plan

1. **Configuration and launch contract:** document one pair/timeframe/exchange and both RPC credential names; keep private values outside Git. Retain the manager as the only full-stack start command (`npm run sbk1`); keep `dev`, `build`, `check`, `status`, and `test` distinct.
2. **Health/readiness:** require an explicit SBK1 JSON health identity, keep Freqtrade ping/authenticated status checks, and report stale/foreign listeners without killing them.
3. **Signal lifecycle:** retain the versioned TypeScript/Python schema, fail-closed live signal policy, expiry, data-age, bridge authentication and idempotency. Only use Freqtrade for orders and official trade state.
4. **UI alignment:** preserve analysis/monitoring components; clearly mark synthetic/research widgets and disable legacy execution controls instead of presenting rejected actions as live operations.
5. **Legacy cleanup:** after enumerating route consumers, JSON data dependencies and regression tests, move/delete obsolete direct order, recovery and duplicate position ownership code. Keep Freqtrade upstream source and SQLite state.
6. **Verification gate:** after safely freeing the current ports, run the managed stack, test `/api/health`, authenticated RPC, then (with user authorization and dry-run prerequisites) exercise the fixture and verify no live mode. Test Ctrl+C/restart and inspect artifacts before declaring any readiness.

## Explicitly unverified

- A clean `npm ci` and clean Python environment install.
- Live public-market-data freshness from the running SBK1 service.
- Fill, partial-fill, open-position lifecycle, exchange/testnet behavior, and recovery of an active Freqtrade position after restart. The verified fixture timed out and cancelled without a fill or open position.
- Any live trading readiness. No trading-real readiness claim is made.

## Remediation performed after the audit

Remediation remained targeted to configuration clarity, startup health identity, and an observed dry-run signal-lifecycle defect:

- Added `FREQTRADE__API_SERVER__USERNAME` and `FREQTRADE__API_SERVER__PASSWORD` to `.env.example`, with an explicit matching-value note.
- Updated setup instructions to state that both RPC credential pairs must match, `FREQTRADE_PAIR` must match `SBK1_FREQTRADE_PAIR`, and `npm run dev` is not the full-stack command.
- Made the manager validate both `status: "ok"` and `service: "sbk1"` from the health JSON instead of accepting an unrelated service's health response.
- Added tests for accepted SBK1 health identity, wrong/missing identity and an HTML SPA fallback; added a test rejecting conflicting nested RPC credentials.
- An end-to-end fixture revealed that SBK1 could leave a signal stuck in `ORDER_SUBMITTED` after Freqtrade timed out and removed its simulated order. Added reconciliation against Freqtrade's authoritative open trades, with a regression test; on restart the orphaned signal correctly transitioned to `CANCELLED`.
- The dry-run fixture necessarily changed the tracked runtime SQLite database. Freqtrade's normal shutdown checkpointed it and removed transient WAL/SHM sidecars. The main database remains modified; it was not reverted or deleted.
- Added this audit report. No credentials or private config were changed, and pre-existing user edits were preserved.

Post-remediation validation:

| Command | Result |
|---|---|
| `npm test` | **PASS** — all included tests (18 fail-closed scenarios, contract/adapter/fixture/RPC checks, runtime checks, and 12 Python tests). |
| `npm run lint` | **PASS** — TypeScript check. |
| `npm run build` | **PASS** — Vite production build; large-chunk warning remains. |
| `npm run sbk1:check` | **PASS** — current settings and strategy discovery. |
| `npm run sbk1:status` (before graceful stop) | **EXPECTED FAIL** — stale listener returned non-JSON HTML; authenticated Freqtrade RPC remained ready. |
| `npm run sbk1:status` (managed stack) | **PASS** — SBK1 API and Freqtrade RPC healthy. |
| `GET /api/health` (managed stack) | **PASS** — `200 application/json`, `{"status":"ok","service":"sbk1"}`. |
| `npm run sbk1` (after authorized graceful stop) | **PASS** — both services launched, readiness checks passed; SIGINT stopped services, released ports and removed the lock. |
| Dry-run fixture / restart reconciliation | **PASS, no fill** — simulated limit order timed out/cancelled; after restart the SBK1 signal reconciled to `CANCELLED`; no open position remained. |

No process remains running from this validation. The tracked `tradesv3.dryrun.sqlite` is modified by the authorized fixture test and requires owner review before any commit or delivery; do not restore/delete it without explicit approval and a verified backup.
