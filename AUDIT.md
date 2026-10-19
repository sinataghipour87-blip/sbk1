# SBK1 Repository Audit

**Audit date:** 2026-10-11  
**Repository:** `sinataghipour87-blip/sbk1`  
**Scope:** Tracked-tree inventory, first-party entrypoints, startup/configuration, API health, market-data and signal flow, Freqtrade strategy/RPC, execution ownership, UI wiring, runtime artifacts, and all package tests. This is a source-path audit; it is not a line-by-line review of every upstream Freqtrade module.

## Executive summary

### Revalidation of the delivered revision

The named `sbk1-main.zip` and `freqtrade-develop.zip` are not present. The reproducible comparison is therefore Git commit `7fc2f21` (`HEAD`) against parent `f17c36f`, not a comparison of those two archives. `freqtrade/` is a regular checked-in source tree (768 tracked paths), not a submodule; its present revision identifies as `freqtrade 2026.10-dev-7fc2f21`.

The previous-to-current commit changed these paths:

| Change | Paths | Executable effect |
|---|---|---|
| Modified | `.env.example`, `package.json`, `scripts/run_sbk1.ts`, `scripts/verify_sbk1_runtime.ts`, `freqtrade_integration/strategies/SbkSignalStrategy.py`, `freqtrade_integration/strategies/sbk_signal_contract.py` | Credential template, launcher, runtime tests, signal consumer and Python contract behavior changed. |
| Added | `scripts/test_sbk_signal_strategy.py` | New Python regression tests. |
| Modified | `src/App.tsx`, `src/main.tsx` | Runtime/UI logic changed; these are not documentation-only changes. |
| Modified | `index.html` | Browser page metadata/presentation changed; no execution authority is added here. |
| Modified | `README.md`; added `AUDIT.md` | Documentation and audit evidence. |
| Modified/deleted | `tradesv3.dryrun.sqlite`, `tradesv3.dryrun.sqlite-shm`, `tradesv3.dryrun.sqlite-wal` | The SQLite database was changed and the transient WAL/SHM sidecars were removed in the commit. The main database is source-tracked in this revision and is not source code. |

At the start of this revalidation, the worktree was clean. No ZIP archive was found; `.env`, `config.json`, `freqtrade/user_data/config.json`, local signal data, `.venv`, `node_modules`, logs, and `dist/` are local/ignored artifacts and are not evidence included in the tracked source delivery.

### Findings that require follow-up

- The adapter and Python validator share the named contract and matching principal fields, but the adapter did not require `expiresAtMs > generatedAtMs` explicitly. Its idempotency comparison also omitted risk/configuration fields, so a reused identifier could be treated as an identical duplicate despite a changed payload.
- `UNKNOWN_IN_FLIGHT` was present only in an older SBK1 execution-engine test, not in the Freqtrade signal lifecycle. The Freqtrade strategy reconciled only `ORDER_SUBMITTED` against open trades; a `STRATEGY_ACCEPTED` record left behind by a restart/network interruption was neither recovered from Freqtrade trade history nor made explicitly non-retryable.
- The Python strategy regression test covered only an orphan-ID helper. It did not exercise the strategy's mocked RPC error, cancellation/fill callbacks, or the post-restart no-duplicate decision.
- Direct Bybit handlers and client calls remained in the tree. The server rejected several of them before their handler bodies, but the UI continued to present them and a separate production-gate module still contained a direct `/api/exchange/order` fetch. Dormant code is not equivalent to a maintained integration contract.
- The repository lacked a repeatable clean-environment setup flow and generated matching private credentials automatically. Previous installed-environment success did not establish this.
- The SQLite file is ignored by `.gitignore` but already tracked, so the ignore rule did not keep it out of source delivery.

The prior command table below is historical evidence from the earlier audit session, not a result of this revalidation. Current commands, results, and limitations are recorded at the end of this report; do not infer current runtime health from the historical table.

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
       ├─ server.ts (Express API + Vite middleware + authenticated Freqtrade market-data bridge)
       │    ├─ marketData / analysisEngine
       │    ├─ freqtradeBridge (authenticated read-only RPC)
       │    ├─ freqtradeSignalAdapter (versioned, expiring, idempotent JSON outbox)
       │    └─ default-deny exchange API (only Freqtrade-backed status and safe live-control routes)
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

- The core web UI, Express endpoints, Freqtrade market-data bridge, signal validation, authenticated Freqtrade RPC reads, and Freqtrade strategy are executable code paths.
- The dashboard contains calculators, research widgets, simulations and heuristic metrics. `/api/backtest/run` now returns `HISTORICAL_SIGNALS_UNAVAILABLE`; the standalone `scripts/realistic_backtester.py` reads local OHLCV files or explicit test-only synthetic data, makes no exchange calls, and never authorizes trading.
- `DemoTestingSandbox`, local calculation widgets and the Python research/backtest scripts must not be interpreted as live execution evidence. A displayed status/score does not establish an order, fill or position.
- `HunterOrderFlowDashboardWidget` can request an analysis candidate, but `/api/hunter/execute` fails closed while calibrated probability evidence is unavailable.
- `App.tsx` and `autoTradeGuard.ts` use `/api/exchange/status` only; no browser code calls legacy private order/credential routes. The server returns an explicit Freqtrade-owner rejection for unsupported exchange routes, and the old auto-trade toggle cannot enable a second executor.
- Public feed fallback values are marked unavailable/zero rather than permitted as a signal. Live market-data reachability and freshness were not asserted by the read-only RPC tests.

## Execution ownership and legacy paths

Freqtrade is the sole order/fill/position authority in the active integration. The TypeScript RPC bridge uses authentication and reads status, trades, balances and whitelist. The TypeScript signal adapter and Python strategy share `sbk1.freqtrade.signal.v2`, including versioned entry authorization, freshness/expiry and risk fields. The server runner uses the full decision pipeline; the raw UI entry endpoint is disabled, and the automatic bridge/launcher require `dry_run=true`. The adapter persists signal lifecycle metadata and prevents duplicate IDs; it is not the official trade database.

`server.ts` no longer contains direct Bybit REST/signing/credential-vault code, private order/position handlers, the old execution daemon, or the parallel exchange WebSocket. A default-deny API middleware allows only `GET /api/exchange/status` and an explicit safe `/api/live` allowlist. The HTTP integration test blocks non-loopback fetches while exercising legacy paths. Old local JSON position/history files are preserved but are no longer read or written by the server. The SBK1 kill switch blocks SBK1 signal delivery; it does not represent Freqtrade's live order/position state.

## Prioritized problems

| Priority | Finding | Evidence / impact | Proposed disposition |
|---|---|---|---|
| P0 — operational (resolved for this run) | Stale unmanaged services initially occupied the official ports; SBK1's health route served HTML. | Manager correctly refused duplicate listeners; after authorized SIGINT, managed start, JSON health and RPC all passed. | Keep manager-only launch policy; if ports are occupied, identify their owners and coordinate before stopping. |
| P1 — setup (remediated) | Sample credentials were inconsistent for a clean private Freqtrade config. | The previous `.env.example` omitted nested Freqtrade API username/password overrides; config example leaves those fields blank. | Matching names are now explicit in `.env.example` and setup instructions; keep actual secrets private. |
| P1 — UX/ownership (resolved) | Dashboard previously exposed calls to blocked legacy order routes. | The current browser callsites use Freqtrade-backed status and the supported signal/exit routes; direct exchange mutation callsites were removed. | Keep UI execution feedback tied to Freqtrade lifecycle and preserve the server-side default-deny boundary. |
| P1 — maintenance (resolved) | The server previously retained dormant direct-Bybit and local position lifecycle code. | Legacy handlers, vault/signing, daemon, recovery, reconciliation and backend WebSocket were removed; the route test verifies default-deny behavior without external calls. | Keep the default-deny boundary; do not reintroduce parallel connectors or position ownership. |
| P2 — truthfulness (resolved) | The dashboard previously exposed synthetic backtest output as a generic backtest. | `/api/backtest/run` now fails closed until historical SBK1 decision/features exist; the standalone researcher cannot grant live permission. | Keep the historical-data gate; do not treat local OHLCV alone as calibration evidence. |
| P2 — reproducibility | Clean installs remain unverified, although managed process lifecycle is now tested. | Existing installed dependencies pass checks; a clean dependency install was not performed. | Test clean Node/Python installation in an isolated environment. |
| P2 — maintainability | One execution-truth verification script is outside the package test command; build bundle is large. | `src/scripts/verify_full_execution_truth_chain.ts` is not referenced by package scripts; Vite emitted ~1.59 MB chunks. | Decide whether to move/integrate the test; optimize lazy-loaded bundles separately without removing capabilities. |

## File disposition register

| File / area | Decision | Reason and dependency evidence |
|---|---|---|
| `scripts/run_sbk1.ts` | **Keep** | Official supervisor; validates private config, Python strategy discovery, ports, lock, API/RPC readiness and child shutdown. |
| `scripts/run_freqtrade.ts` | **Keep disabled** | Explicitly refuses standalone startup and directs users to the manager; retain as a guard against a second unmanaged bot. |
| `server.ts` | **Keep** | Active API, Vite middleware and Freqtrade snapshot/RPC boundary; no direct exchange connector or legacy order/position owner remains. |
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
| `scripts/realistic_backtester.py` and market-model scripts | **Keep as research/test tools** | Reads local Freqtrade Feather OHLCV, unverified JSON, or explicitly synthetic input; no direct exchange requests and no live authorization. |

No source file was changed and no runtime file was removed during the initial evidence-gathering phase.

## Follow-up implementation after the audited revision

The work completed after the baseline audit above supersedes its legacy-backend and backtest-path findings:

- Removed the direct Bybit REST/signing/credential-vault implementation, private exchange handlers, server-side order/recovery/reconciliation daemon, and backend exchange WebSocket from `server.ts`. The exchange API now defaults to rejecting every route except `GET /api/exchange/status`, which reads Freqtrade RPC; a small explicit `/api/live` allowlist remains.
- Added an HTTP integration test that starts the real server, blocks all non-loopback `fetch` calls, checks the legacy mutation/credential routes and mixed-case paths fail closed, confirms the Freqtrade-backed status route is not masked, and verifies the legacy auto-trade toggle cannot enable itself.
- Changed `scripts/realistic_backtester.py` to read local Freqtrade Feather files or explicit unverified JSON/synthetic inputs rather than contacting Bybit/Binance. It validates completed OHLCV shape/cadence and always reports that it cannot authorize live trading.
- The production signal gate is still closed: no verified historical archive currently joins contemporaneous SBK1 decision/features with authoritative Freqtrade outcomes. Passing software checks or a local OHLCV backtest does not supply this evidence or justify a trade.

## Target architecture and staged remediation plan

1. **Configuration and launch contract:** document one pair/timeframe/exchange and both RPC credential names; keep private values outside Git. Retain the manager as the only full-stack start command (`npm run sbk1`); keep `dev`, `build`, `check`, `status`, and `test` distinct.
2. **Health/readiness:** require an explicit SBK1 JSON health identity, keep Freqtrade ping/authenticated status checks, and report stale/foreign listeners without killing them.
3. **Signal lifecycle:** retain the versioned TypeScript/Python schema, fail-closed live signal policy, expiry, data-age, bridge authentication and idempotency. Only use Freqtrade for orders and official trade state.
4. **UI alignment:** preserve analysis/monitoring components; clearly mark synthetic/research widgets and disable legacy execution controls instead of presenting rejected actions as live operations.
5. **Legacy cleanup (implemented):** removed obsolete direct order, credential, recovery, WebSocket and duplicate position ownership code after tracing callers and covering route compatibility; keep old user JSON/SQLite data untouched.
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
| `npm test` | **PASS** — 18 fail-closed scenarios, signal/adapter/archive/RPC/runtime checks, and 32 Python tests. |
| `npm run lint` | **PASS** — TypeScript check. |
| `npm run sbk1:check` | **PASS** — configuration validation and discovery of `SbkSignalStrategy`. |
| `npm run build` | **NOT PASS** — three Vite attempts terminated with exit 143 during transformation, including isolated and heap-limited runs. No cgroup OOM was recorded; cause remains undetermined. |
| Clean Node/Python install | **PASS** — `npm ci` in a temporary copy; Freqtrade installed in a clean Python 3.12 environment, strategy discovery and 32 Python tests passed. Python dependencies are not hash-locked. |
| Managed stack health | **PASS in temporary isolated project** — supervisor readiness succeeded; `/api/health` returned JSON; authenticated Freqtrade RPC and loopback binds were confirmed. |
| Fixture fill, restart and exit | **PASS, Dry-run only** — Freqtrade filled fixture trade 1, recovered it as open after restart, then closed it through authenticated local Dry-run RPC; final open-trade count was zero. No exchange credentials or LIVE order were used. |
| Final `npm run sbk1:status` in workspace | **EXPECTED UNAVAILABLE** — both services were stopped after isolated validation and reported unavailable. |
| `git diff --check` | **PASS** — no whitespace errors. |

No managed process or temporary validation copy remains. The local `tradesv3.dryrun.sqlite` remains on disk, but it is staged for removal from the Git index; review and back it up before any commit or delivery. The fixture's decision-to-archive route returned 404 in an earlier probe, so end-to-end archive linkage remains unverified.

## Phase-four ownership and dependency register

This register is based on the current working tree, including the pre-existing uncommitted changes. "Owner" means the only component allowed to perform the operational responsibility; similarly named SBK1 analysis or presentation code does not acquire that authority.

| Responsibility | Owner paths | Callers and data flow | Relevant checks | Disposition |
|---|---|---|---|---|
| Direct exchange connectivity, order submission/cancel, fills, positions, stop-losses and trade DB | `freqtrade/freqtrade/exchange/`, Freqtrade bot/RPC/persistence modules, and `freqtrade_integration/strategies/SbkSignalStrategy.py` | `scripts/run_sbk1.ts` launches the strategy; it consumes the Node queue and returns lifecycle updates. `scripts/run_freqtrade.ts` is a guard against standalone startup. | `scripts/test_sbk_signal_strategy.py`, `scripts/verify_freqtrade_rpc_contract.ts`, fixture and lifecycle checks in `npm test` | Sole execution owner. No SBK1 exchange key/signing/order implementation is authorized. |
| Market data | Freqtrade DataProvider in `SbkSignalStrategy.py`; `src/services/freqtradeMarketDataBridge.ts`; browser reader `src/services/marketData.ts`; bridge routes in `server.ts` | Strategy publishes an authenticated snapshot; the server validates/caches it; React/analysis services read it through `/api/market/freqtrade-snapshot`. `marketData.fetchBybit` is a compatibility name for this reader and does not call Bybit. | `scripts/verify_freqtrade_market_snapshot.ts`, `scripts/verify_freqtrade_market_data_adapters.ts`; latter asserts no venue fallback request | Freqtrade is the only exchange market-data connector; unavailable/stale fields stay unavailable. |
| Analysis and signal decision | `src/services/analysisEngine.ts`, `src/services/decisionPipeline.ts`, analysis/risk services under `src/services/`, and signal presentation in `src/App.tsx` | React gathers validated Freqtrade snapshots, computes a candidate decision, and calls the SBK1 API adapter only when execution gates permit. | Fail-closed scenarios, market-data adapter checks, and `scripts/verify_freqtrade_signal_adapter.ts` | Preserve decision logic; it is not proof of calibrated edge or an order/fill. Production signal delivery remains gated. |
| Signal transport and bridge authentication | `src/services/freqtradeSignalAdapter.ts`, `freqtrade_integration/strategies/sbk_signal_contract.py`, `/api/freqtrade/signals*` in `server.ts` | UI/server submits a versioned, expiring signal; strategy polls using the bridge bearer token and posts lifecycle status. | `scripts/verify_freqtrade_signal_adapter.ts`, Python contract tests, and RPC/legacy-route checks | JSON outbox is a signal queue, not an execution ledger; fail closed on contract, auth, freshness or persistence errors. |
| Order lifecycle and position/fill display | Freqtrade database/RPC via `src/services/freqtradeBridge.ts`; UI `src/components/ExecutionGovernorDashboard.tsx`; reconciliation callbacks in `SbkSignalStrategy.py` | Dashboard reads Freqtrade trades/orders/fills. Authenticated lifecycle updates correlate signal ID and positive trade ID. | RPC contract, dry-run fixture, archive persistence and strategy recovery tests | SBK1 must not synthesize authoritative positions or claim a fill from a queued/submitted status. `signalToExecution.ts` and `orderExecutionLifecycleEngine.ts` contain decision/presentation/research models, not an exchange client. |
| Decision/trade history | Freqtrade DB is authoritative for trades; `src/services/operationalTradeArchive.ts` stores SBK1 decision/signal provenance, lifecycle-reported trade/fill references, and Freqtrade-linked snapshots explicitly tagged `DRY_RUN` or `LIVE`. Browser `src/services/history.ts` is legacy local UI history. | `server.ts` records lifecycle and authenticated RPC trade snapshots; dashboard reads linked archive records and blocks refresh across execution-mode changes. | `scripts/verify_operational_trade_archive.ts` | Archive supplements, never replaces, the Freqtrade DB. Dry-run RPC snapshots are simulated, not exchange fills. Existing browser history/user data is retained and is not verified execution evidence. |
| Restart and single-instance lifecycle | `scripts/run_sbk1.ts`; Freqtrade persistence/recovery; signal adapter and strategy reconciliation | Launcher validates, acquires `.sbk1-run.lock`, starts its own Node child then Freqtrade, health-checks both, and stops only those child processes. Strategy reconciles persisted queue records against Freqtrade trades. | `scripts/verify_sbk1_runtime.ts`, Python strategy tests, archive/adapter persistence tests, isolated fixture restart/exit run | Keep one manager; never auto-kill an unrelated port listener. Managed Dry-run open-trade restart recovery was observed; partial-fill and LIVE recovery remain unverified. |
| Authentication and shared configuration | `scripts/init_sbk1_config.py`, `.env.example`, `freqtrade_integration/config.example.json`, `scripts/run_sbk1.ts`, auth middleware and bridge routes in `server.ts` | Private `.env`/Freqtrade config supplies matching exchange, pair, timeframe, RPC credentials and independent admin/bridge/JWT secrets. UI has no site-wide login; privileged controls send an admin token. | Init/config tests, runtime validation, bridge/RPC mock tests | Keep credentials out of tracked templates. Local APIs bind to loopback; remote hosting is not supported by this launcher. |
| Startup, readiness, health and UI | `scripts/run_sbk1.ts`, `server.ts`, `vite.config.ts`, `src/App.tsx`, `src/components/ExecutionGovernorDashboard.tsx` | `npm run sbk1` owns both services; health is `GET /api/health` JSON, status independently verifies authenticated Freqtrade RPC; Vite/dev is UI/API only. | `npm run sbk1:check`, `npm run sbk1:status`, HTTP route and health identity checks | Express and Vite defaults bind to loopback; Vite no longer allows arbitrary Host headers. `npm run dev` is not full-stack startup. Do not expose the loopback server directly to a public network. |

### Phase-four file and artifact decisions

- Kept active source, tests, strategy, vendored Freqtrade code/licenses, research backtester, and user-facing analysis/history modules; no source deletion was justified by dependency evidence.
- Kept the pre-existing edits in the worktree. `tradesv3.dryrun.sqlite` is ignored and was removed from the Git index with `git rm --cached`; the local database file remains on disk and was not read, reset, or deleted by that operation.
- Added ignore coverage for `.env.*` (except `.env.example`), the runtime dataset store, and Freqtrade user-data databases/logs. Existing Freqtrade `.gitignore` already excludes private `user_data/` settings.
- Changed `server.ts` and `vite.config.ts` to bind `127.0.0.1` rather than `0.0.0.0`, and removed Vite's permissive `allowedHosts` setting. This keeps local use login-free for public UI surfaces while admin and bridge APIs remain authenticated; remote hosting needs a separate reviewed proxy/network boundary.
- Updated the README to use the private-config initializer as the canonical setup and to avoid recommending an unsupported Node 20 deployment.
