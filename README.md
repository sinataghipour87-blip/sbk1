# SBK1 + Freqtrade

## Quick start

- Install Node.js dependencies with `npm ci`; set up private Freqtrade config and `.env` as described below.
- Keep Freqtrade configured with `dry_run: true` and `force_entry_enable: false`.
- Validate local configuration and strategy discovery with `npm run sbk1:check`.
- Start the managed SBK1 and Freqtrade dry-run services with `npm run sbk1`.
- Run the automated checks with `npm test`, `npm run lint`, and `npm run build`.

## Current status

**Dry-run only. Production signals are blocked. This integration is not production-ready.**

## Server-side prediction archive

SBK1 candidate decisions are appended to `data/prediction-archive/archive.sqlite`.
The directory is git-ignored. The SQLite store rejects row updates and deletes,
validates feature and data-quality timestamps against the decision timestamp,
and creates an online SQLite backup at
`data/prediction-archive/backups/archive-YYYYMMDD.sqlite` on the first new
record of each UTC day. Copy the database and its backup directory together
when taking a manual backup; avoid copying the database while SQLite is actively
writing.

The following admin-authenticated endpoints use the existing `ADMIN_TOKEN`
(`x-admin-token` header):

- `GET /api/prediction-archive?limit=100&offset=0` lists records as JSON.
- `GET /api/prediction-archive?limit=500&offset=0&format=csv` exports one
  page as CSV. Increase `offset` by the page size to export subsequent pages.
- `POST /api/prediction-archive/records` appends a candidate decision.
- `POST /api/prediction-archive/import-local` imports an explicitly exported
  localStorage array in `{ "records": [...] }`. Imported rows are always marked
  `UNVERIFIED_LOCAL`, their gate is forced ineligible, and prior outcome
  verification fields are cleared. The server cannot read a browser's
  localStorage directly, so no local records are migrated unless they are
  explicitly exported and submitted.
- `GET /api/prediction-archive/status` reports decision and authenticated
  Freqtrade outcome counts, calibration minimum gaps, and outcomes without an
  exact decision link.
- `POST /api/prediction-archive/sync-freqtrade` triggers an authenticated RPC
  refresh of closed trades. The same refresh runs at server startup and every
  60 seconds. Outcomes are joined only by the exact signal tag or an exact
  Freqtrade trade-ID lifecycle update; unmatched outcomes remain visible and
  are never attached by pair, time, or price similarity.

Only a positive trade ID from the authenticated Freqtrade RPC history can
create a `FREQTRADE_CONFIRMED` outcome. The feature snapshot remains immutable;
outcomes are stored separately and projected onto an exact linked decision when
the archive is read. Calibration readiness counts only joined outcomes and
does not change the production signal gate.

Archive errors are surfaced to the caller; failed writes do not change decision
or production-gate behavior. Archive storage does not authorize signal
delivery, which remains blocked by the existing calibration and kill-switch
gates.

## Dry-run collection path

The optional `SBK1_DRY_RUN_COLLECTION_ENABLED` feature flag defaults to
`false`. When enabled, it exposes a separate, explicitly tagged data-collection
path; it does not enable or relax the production signal route. Production
submissions continue to fail closed with `CALIBRATED_CONFIDENCE_UNAVAILABLE`
while calibrated probability evidence is missing.

Collection delivery is allowed only while authenticated Freqtrade RPC
confirms **on every signal poll** that `dry_run=true`, `demo_trading=false`,
and `force_entry_enable=false`. An unavailable or mismatched RPC response
delivers no collection signals. There must be no open Freqtrade trade, no
earlier collection signal still active, and the SBK1 kill switch must be
disarmed. Both the managed launcher and authenticated Freqtrade RPC must
confirm `max_open_trades=1`, and the strategy rejects collection entries while
any Freqtrade trade is open. The collection decision must pass the normal fresh-LIVE-data,
data-quality, order-book-imbalance, funding, ATR, calibrated-regime,
no-trade-veto, and remaining unified decision/risk gates. Only the calibration-
dependent probability/expected-value stage is exempted, and only when the
pipeline's independent historical-expectancy and trade-quality evidence passes.
This is still a real SBK1 decision, not a fixture.

Every accepted decision is archived with `collectionMode=DRY_RUN_COLLECTION`
and its deterministic signal ID is reused by the Freqtrade signal contract.
Freqtrade entry tags carry the `DRY_RUN_COLLECTION:` prefix; exact linked
outcomes are separately classified as `DRY_RUN_COLLECTION`. The calibration
status response reports confirmed and matched counts by execution mode. Dry-run
and collection outcomes do not reduce calibration minimum gaps; only separately
classified `LIVE` outcomes count toward the existing 40/20/200 minimums, and
the production signal route remains disabled. Limits are one open trade at a time,
one active collection signal, at least five minutes between signals, at most
10 accepted signals per UTC day by default
(`SBK1_DRY_RUN_COLLECTION_MAX_SIGNALS_PER_DAY`), 1x leverage, a 60-second
signal expiry, and the required `SBK1_SIGNAL_MAX_STAKE_QUOTE` cap (positive
and no greater than 100 quote units).

Freqtrade dry-run orders and fills are **simulated**; their fill behavior can
be materially more optimistic than live execution. Outcomes collected here
must not be treated as sufficient calibration or as authorization for live
trading by themselves. Live trading remains disabled and the dry-run,
authentication, and kill-switch gates must not be weakened.

SBK1 remains the TypeScript/React analysis and monitoring application. Freqtrade is the sole owner of exchange credentials, order placement, fills, open positions, stop-losses, exits, and trade persistence. The Node service validates a narrow, versioned SBK1 signal contract and provides an authenticated pull queue to a Freqtrade strategy. Production SBK1 signals remain blocked pending calibrated-probability evidence; an explicitly enabled, tightly gated dry-run fixture is available only for integration testing. The browser never calls the Freqtrade API.

This integration is **not declared production-ready**. The checked-in Freqtrade configuration is a dry-run template; no live exchange order, fill, restart recovery, or end-to-end deployment was executed in this workspace.

## Review and capability decisions

The requested `sbk1-main.zip` and `freqtrade-develop.zip` were not present in the workspace. The review below is based on the checked-out SBK1 source and the `freqtrade/` source tree that is present. It is an implementation-oriented audit of the execution, analysis, API, persistence, strategy, backtest, and test surfaces, not a claim that every file in either upstream project was exhaustively reviewed.

| Capability | Evidence and runtime status | Inputs / outputs and dependencies | Overlap and decision |
|---|---|---|---|
| SBK1 React UI | Real React components in `src/components/`; signal/order-flow widgets call the Node service. UI status labels alone do not prove a fill. | `AnalysisResult`, order-flow snapshots; renders opportunities and submissions. | **Preserve** analysis and monitoring UI; execution feedback now says “queued” until Freqtrade reports lifecycle updates. |
| SBK1 analysis and data services | `analysisEngine.ts`, `marketData.ts`, `orderFlowEngine.ts`, and decision/risk services contain executable calculations. Data may be LIVE, stale, unavailable, or heuristic depending on the source and quality report. | Candles, derivatives, order-book/trade-flow feeds; returns analysis, levels, and candidate signals. Depends on feed status, timestamps, and data-quality gates. | **Preserve** analysis and monitoring. The order-flow sweep is heuristic and has no calibrated probability; it cannot authorize live execution. |
| SBK1 legacy exchange code and order lifecycle | Direct Bybit REST, signing, credential-vault, background strategy/recovery/reconciliation, backend WebSocket, and legacy private-order handlers have been removed from `server.ts`. A default-deny API policy permits only `GET /api/exchange/status` and an explicit allowlist of safe `/api/live` routes. `/api/exchange/status` reads Freqtrade RPC. `hunterExecutionEngine.ts` no longer makes private Bybit REST calls; `orderExecutionLifecycleEngine.ts` reads Freqtrade lifecycle state. An HTTP integration test starts the server with all non-loopback `fetch` blocked and verifies legacy paths fail closed. | Local legacy JSON position/history files are no longer read or written by the runtime and are left untouched on disk. | **Freqtrade is the only exchange/data feed and execution authority** in the SBK1 runtime. All exchange-profile and live-trading scope remains gated separately; the current managed integration is dry-run-only. |
| SBK1 auto-trade and local position state | The previous background strategy loop submitted Bybit orders and persisted positions/history in JSON. Several readiness checks were static assertions, not exchange tests. | Local analysis, JSON state and Bybit responses; had a separate lifecycle from Freqtrade. | **Disable** live auto-trade and recovery/reconciliation timers. Kill switch blocks new SBK1 signals and cancels queued, unclaimed signals; it does not falsely claim to cancel Freqtrade orders or close positions. |
| Freqtrade strategy and order engine | Present under `freqtrade/freqtrade/strategy`, `freqtrade/freqtrade/rpc`, `freqtrade/freqtrade/persistence`, and `freqtrade/freqtrade/exchange`; `pyproject.toml` specifies Python 3.12+ and the exchange/database/API dependencies. The included `user_data/strategies/SbkExecutionStrategy.py` was a no-op strategy. | Strategy candle signals enter the Freqtrade bot loop; exchange interfaces, order callbacks, trade DB and RPC manage execution and state. | **Use as the only execution authority**. `freqtrade_integration/strategies/SbkSignalStrategy.py` implements a strategy-native external signal consumer; manual `/forceenter` injection is disabled. |
| Signal transport and lifecycle | New Node adapter validates and persists `sbk1.freqtrade.signal.v1` records in an atomic JSON file. Freqtrade polls the authenticated Node endpoint and posts lifecycle updates. | Decision/signal IDs, exchange, market, pair, timeframe, timestamps/expiry, price provenance, entry invalidation/target, and risk limits; statuses include accepted, strategy-accepted, submitted, partial/full fill, rejection, expiry, cancellation, and error. | **Add as the adapter**. Idempotency is keyed by a deterministic signal ID; conflicting payload reuse is rejected. Node records decision/lifecycle metadata only; Freqtrade remains authoritative for trade/position state. |
| Freqtrade dry-run, backtesting, hyperopt, FreqAI, API and tests | These are actual Freqtrade source and documented/tested subsystems, backed by the Python package dependencies and `freqtrade/tests/`. The SBK1 queue strategy intentionally does not fetch live signals during backtesting/hyperopt. | Freqtrade strategy/data/configuration and historical OHLCV; outputs simulated/backtested trades, reports, or model results. | **Preserve**. Run normal Freqtrade backtests with historical strategies/data; this live signal queue is not a substitute for a historical signal archive. |
| Existing SBK1 Python backtester | `scripts/realistic_backtester.py` is a research-only calculator; it reads local Freqtrade Feather OHLCV, or explicitly unverified JSON/synthetic inputs, and makes no exchange API calls. It never grants live trading permission. | OHLCV structure alone does not verify exchange provenance or replay historical SBK1 decisions/features. | **Do not use its output as SBK1 strategy, calibration, or live-readiness evidence.** The dashboard backtest endpoint remains disabled until historical SBK1 decisions and their features can be replayed. |

## Historical data and calibration status

- Audit real downloaded Freqtrade Feather OHLCV before backtesting with `.venv/bin/python scripts/audit_freqtrade_market_data.py freqtrade/user_data/data/bybit/futures/BTC_USDT_USDT-15m-futures.feather --timeframe 15m`. It checks timestamp order and cadence, missing intervals, finite values, OHLC geometry, future timestamps, and counts incomplete candles separately. It does not establish that historical order-flow features or SBK1 decisions are available.
- In the 2026-10-11 workspace audit, Bybit returned 35,109 BTC/USDT:USDT 15m candles from 2025-10-11 through 2026-10-11; the OHLCV audit found no gaps or malformed rows. Freqtrade's SbkSignalStrategy backtest on that history produced zero trades because the live external-signal queue is intentionally not consumed in backtesting. Zero trades is not a performance result.
- The server-side prediction archive is implemented and periodically synchronizes authenticated Freqtrade closed-trade history. It writes a `FREQTRADE_CONFIRMED` outcome only for a positive Freqtrade trade ID joined to an exact archived decision by signal tag or trade-ID lifecycle update; unmatched outcomes remain unlinked. Browser/local outcomes remain `UNVERIFIED_LOCAL`. Calibration still requires labeled feature snapshots: at least 40 training samples, 20 validation samples, and a dynamically sized out-of-sample set (at least 200), including both win and loss outcomes. The archived decisions and verified outcomes currently do not establish those requirements, so no calibrated probability or eligible production signal is available.
- Until timestamped historical SBK1 decisions, their contemporaneous features, and authoritative Freqtrade outcomes can be joined and validated, `/api/backtest/run` returns `HISTORICAL_SIGNALS_UNAVAILABLE`, the dashboard does not display synthetic metrics, and production signal delivery remains fail-closed.

## Signal and state ownership

1. SBK1 analysis can create heuristic, time-bounded monitoring candidates. The order-flow sweep does not establish CVD divergence or calibrated probability.
2. `POST /api/hunter/execute` currently fails closed with `CALIBRATED_CONFIDENCE_UNAVAILABLE`; this heuristic path cannot enqueue a live signal or authorize an order. Enablement requires an independently validated calibration source and corresponding execution tests.
3. Production signal delivery is disabled. Authenticated polls to `GET /api/freqtrade/signals` cancel unclaimed production candidates and return `CALIBRATED_CONFIDENCE_UNAVAILABLE`. For integration testing only, `POST /api/freqtrade/dry-run-test-signal` can enqueue a real-price, low-stake fixture when the explicit fixture flag is enabled and authenticated Freqtrade RPC confirms the running `SbkSignalStrategy` is in `dry_run=true`. The poll endpoint rechecks this state on every request and serves fixture records only. This fixture bypasses model calibration by design and is not evidence for production eligibility.
4. Freqtrade strategy callbacks send status updates to `POST /api/freqtrade/signals/:signalId/status`; the admin-only `GET /api/hunter/signals/:signalId` is a signal audit view. Freqtrade RPC `/status`, `/trade`, and `/balance` are used for trading-state reads.
5. Freqtrade's database is the source of truth for trades, orders, balances and positions. The SBK1 JSON signal store is an outbox/audit record, not a parallel trade database.

## Market-data and model truth policy

- Live OHLCV uses completed candles only. The Bybit and KuCoin readers validate finite OHLCV geometry, monotonic interval timestamps, and remove the still-forming candle; a missing interval or invalid timestamp rejects the feed. Candle event/close time, response receipt time, measured request latency, symbol, market type, and timeframe remain distinct.
- Bybit linear-futures `BTCUSDT` is primary. KuCoin `XBTUSDTM` can be used only after base asset, settlement, contract type, and timeframe compatibility checks pass. Spot, synthetic candles, and stale cache entries are never substitutes for live futures data. Failed or unproven provenance is unavailable, not zero or neutral.
- Price roles are not interchangeable: Last is the execution reference, Mark is the risk/stop/liquidation reference, and Index is the underlying benchmark. A missing required price is returned as unavailable; another price type is never substituted. Divergence cannot be considered safe unless both Last and Mark are fresh and valid.
- Order-book imbalance, Funding, Open Interest, and trade flow are valid only when the supporting live feed provides them with provenance. Unsupported or missing metrics remain unknown. Backtests must use only information available at or before each simulated event; use completed historical bars and do not forward-fill future values.
- `scripts/predictor.py` is a heuristic moving-average/price-change/order-imbalance analysis, not a trained or calibrated probability model. `scripts/garch_volatility.py` is a fixed-parameter, unfitted volatility approximation, not a validated forecast. Both explicitly return `tradeEligible: false`; missing input and process failures do not produce directional, confidence, regime, or target fallbacks. Their definitions are analysis-only and must not differ between backtest, dry-run, and live signal eligibility.
- SBK1's pre-trade data gate requires a fresh LIVE/VERIFIED_REALTIME snapshot, an allowed quality report, valid OBI, supported Funding and Open Interest, ATR, a classified regime, and verified calibrated probability evidence. If any evidence is missing, stale, simulated, or uncalibrated, it returns NO TRADE. Static pattern-library win rates and fabricated out-of-sample metrics are not used.

## Safety controls and order lifecycle

- SBK1 starts with its server-side kill switch engaged unless a valid persisted state says otherwise. Engaging it blocks new SBK1 signals, stops SBK1 auto-trade, and cancels unclaimed queued signals. It does **not** cancel exchange orders already submitted by Freqtrade or close/modify open positions; the API reports those as unaffected. Reconciliation and position management remain Freqtrade's responsibility. State is persisted in the ignored runtime file `database_kill_switch.json`.
- The execution-mode control offers only Freqtrade `DRY_RUN`; older saved `LIVE`/`TESTNET` values are migrated to `DRY_RUN`, while saved `BACKTEST`/`PAPER` selections remain non-executable and are not offered in the UI. Execution-mode selection is not authorization to execute trades. The legacy server mode endpoint remains for compatibility and does not control Freqtrade or authorize execution. The managed integration and optional admin-only fixture remain dry-run-only: the fixture requires authenticated RPC confirmation of `dry_run=true` and never turns off Freqtrade's force-entry guard. The order-flow execution route and production Freqtrade signal delivery fail closed because calibrated probability evidence is unavailable. Freqtrade's example config listens on loopback with authentication enabled and force-entry disabled. Never expose the Freqtrade management API publicly; configure credentials and permissions (withdrawal disabled and IP-restricted keys) only in the private Freqtrade deployment.
- Cross-origin browser access is denied unless the request is same-origin or its exact origin is listed in `SBK1_ALLOWED_ORIGINS`. Admin and bridge routes require server-side authentication. Keep `.env`, Freqtrade configuration, bridge tokens, and API credentials private.
- Order states are `CREATED → SUBMITTED → ACKNOWLEDGED → PARTIALLY_FILLED → FILLED`, with explicit `REJECTED`, `CANCELLED`, and `UNKNOWN_IN_FLIGHT` branches. Unknown submissions must be reconciled with Freqtrade/exchange before retry; repeated signal IDs are idempotent. Actual fill prices, fees, protective orders, orders, and positions are only confirmed from Freqtrade/exchange state, never from a local estimate.

The Node signal store is single-process and file-backed. Run one SBK1 writer, place the store on durable storage, and use a private network for the Node-to-Freqtrade bridge. Multi-instance deployments require a transactional shared store/queue before enabling this integration.

## Configuration and dry-run

1. Supply runtime-only configuration through your secret manager/service environment; do not commit `.env`, Freqtrade configs, passwords, JWT keys, bridge tokens, or exchange keys. Node needs `FREQTRADE_BASE_URL`, `FREQTRADE_USERNAME`, `FREQTRADE_PASSWORD`, `FREQTRADE_PAIR`, `ADMIN_TOKEN`, `SBK1_SIGNAL_EXCHANGE`, and `SBK1_FREQTRADE_TIMEFRAME`. Set `FREQTRADE__API_SERVER__USERNAME` and `FREQTRADE__API_SERVER__PASSWORD` to the **same values** as `FREQTRADE_USERNAME` and `FREQTRADE_PASSWORD`; the first pair configures Freqtrade's RPC server, while the second pair authenticates SBK1's RPC client. The `.env.example` lists both pairs. Freqtrade also supports `FREQTRADE__API_SERVER__JWT_SECRET_KEY`, `FREQTRADE__EXCHANGE__KEY`, and `FREQTRADE__EXCHANGE__SECRET` as environment overrides. Generate a random bridge token outside the repository and set the same value in `SBK1_FREQTRADE_BRIDGE_TOKEN` for Node and Freqtrade. `ADMIN_TOKEN` and the bridge token must each contain at least 32 characters. Never expose credentials to browser code. Do not configure exchange keys in SBK1; its guarded legacy exchange mutation routes return HTTP 410.
2. Copy `freqtrade_integration/config.example.json` to `freqtrade/user_data/config.json`; its RPC credential fields are intentionally blank and must be supplied through the matching `FREQTRADE__API_SERVER__USERNAME` and `FREQTRADE__API_SERVER__PASSWORD` overrides. Set `FREQTRADE_PAIR` and `SBK1_FREQTRADE_PAIR` to the same pair. The managed SBK1 launcher deliberately refuses to start unless `dry_run: true` and `force_entry_enable: false`. It does not support launching a live-trading configuration.
3. Export `SBK1_FREQTRADE_PAIR`, `SBK1_FREQTRADE_TIMEFRAME`, `SBK1_FREQTRADE_BRIDGE_TOKEN`, and `SBK1_BRIDGE_URL` into the Freqtrade process environment. These must agree with Node settings and the Freqtrade config. The strategy rejects remote HTTP bridge URLs and does not follow redirects while sending its token.
4. The managed launcher requires both APIs on loopback and the bridge/RPC credentials to match the private Freqtrade config. For a remote deployment, use a separately reviewed private-network/TLS deployment; the local launcher intentionally rejects remote cleartext URLs and non-loopback service bindings.
5. Validate in Freqtrade dry-run first. `npm run verify:freqtrade` is a read-only readiness probe and places no orders. SBK1's readiness diagnostic does not authorize live execution: calibrated probability evidence and real dry-run/exchange lifecycle verification remain unavailable.

In live/dry-run Freqtrade runmodes, the strategy pushes a versioned market snapshot to the private `POST /api/freqtrade/market-snapshot` endpoint at most every 10 seconds. The v3 contract carries completed DataProvider candles plus ticker, order-book, and funding data when available. Ticker exchange-event time is distinct from the local time Freqtrade retrieved it; absent exchange time remains explicitly `null`, and only the retrieval time is used for short-lived freshness checks. Node authenticates the bridge token and cross-checks the running Freqtrade RPC exchange, market, pair whitelist, and timeframe before accepting a snapshot. Browser analysis consumes the snapshot through the SBK1 API and fails closed when data is absent or stale. A managed Dry-run check confirmed RPC and 500 completed 15m candles, plus order book and funding. A separate read-only probe through Freqtrade's Bybit connector (CCXT 4.5.85) confirmed a positive ticker `last`, but both normalized `timestamp`/`datetime` and the raw Bybit ticker's top-level time were absent; Last/Mark/Index can therefore be marked as recently retrieved but have no exchange event timestamp. They must not be represented as exchange-timestamped data. Open interest, recent trades/CVD, and multi-exchange aggregation are not covered by this v3 contract.

The snapshot bridge does not enable production signal delivery or change the calibration gate. `DRY_RUN` is the UI's sole selectable mode; previously saved `LIVE`/`TESTNET` selections are migrated to `DRY_RUN`, while saved `BACKTEST`/`PAPER` selections remain non-executable until the user selects Freqtrade dry-run. Status is accepted only when RPC confirms `dry_run=true`, `demo_trading=false`, and `force_entry_enable=false`. The managed launcher remains dry-run-only. The orderflow snapshot and guarded dry-run fixture read the Freqtrade snapshot cache and fail closed when it is missing or stale. The server contains no direct Bybit connector or legacy private-order code. `npm test` includes an HTTP integration test that blocks all non-loopback fetches while proving the remaining legacy paths fail closed.

For a controlled integration exercise, set `SBK1_DRY_RUN_FIXTURE_ENABLED=true` only in the private Node environment, keep the Freqtrade config at `dry_run: true`, and verify `force_entry_enable: false`. Wait until a fresh authenticated DataProvider snapshot is accepted, disarm the SBK1 kill switch, then call the admin-only `POST /api/freqtrade/dry-run-test-signal`; this creates a 60-second LONG fixture from the configured Bybit futures ticker with 1x leverage, a 0.1% stop-risk budget, and a 100 USDT maximum stake. The larger notional cap accommodates Bybit's BTC futures minimum order size; actual stake is further bounded by the risk budget and Freqtrade's exchange minimums. Freqtrade RPC is checked when accepting snapshots, creating the fixture, and on each strategy poll. Disable the fixture flag after testing. This verifies the bridge path only; it does not validate SBK1 model quality, live trading, or an exchange fill.

## One-command local startup

Install Node dependencies with `npm ci`; install Freqtrade into the repository virtual environment with `python -m pip install -e ./freqtrade`, then create the private config once with `cp freqtrade_integration/config.example.json freqtrade/user_data/config.json`. Copy `.env.example` to `.env`, set the matching RPC credentials and other required private values, and keep `dry_run: true`. Run `npm run sbk1` from the repository root; one supervisor validates settings, confirms the strategy loads, starts the SBK1 API and then Freqtrade, and waits for authenticated RPC health before reporting readiness. Startup refuses mismatched settings, active listeners, a missing strategy, an unsafe configuration, or a second managed instance. Use `npm run sbk1:check` for non-starting configuration/strategy validation and `npm run sbk1:status` for independent health reports. `npm run dev` starts only the SBK1 Node/Vite service; it does not start Freqtrade and is not the full-stack command. If either managed child exits, the supervisor shuts down its other child; `Ctrl+C` gracefully stops both. SBK1 also exposes `GET /api/health` with a JSON service identity for health checks.

The example targets Bybit USDT futures and `BTC/USDT:USDT`, because SBK1's current signal feed is a Bybit linear-futures feed. A different venue/pair requires matching SBK1 market data and Freqtrade configuration; mismatches fail closed. Spot shorts are rejected. The sample config cancels unfilled orders after 15 seconds; SBK1 signals expire after 45 seconds. The strategy also defines a 5% hard stop-loss ceiling as a fallback if its signal-specific stop cannot be recovered.

## Operating commands

- Start both services in dry-run mode: `npm run sbk1` from the repository root. The launcher refuses non-dry-run config, mismatched settings, or occupied ports.
- Stop the managed stack with `Ctrl+C` in that terminal; the supervisor sends termination to both child processes. Do not kill a separately running process without identifying and coordinating with its owner.
- Check configuration/strategy discovery without starting services: `npm run sbk1:check`. Check live process health read-only with `npm run sbk1:status`.
- SBK1 logs are written to the startup terminal. Follow the Freqtrade log with `tail -n 100 -f freqtrade/user_data/logs/freqtrade.log`.
- Run tests with `npm test`; attempt production frontend build with `npm run build`; run the repository TypeScript check with `npm run lint`.

## Validation

- `npm test` runs the SBK1 fail-closed checks, TypeScript/Python signal-contract checks, dry-run fixture guard tests, authenticated local mock RPC checks, and Python model/contract tests. The mock never calls a real Freqtrade instance or order endpoint.
- `npm run verify:freqtrade:contract` runs the same local authenticated mock RPC contract check independently.
- `npm run sbk1:check` validates private config, environment agreement, and Freqtrade strategy discovery without starting services.
- `npm run sbk1:status` reports SBK1 HTTP and authenticated Freqtrade RPC health independently.
- `npm run lint` runs the repository-wide TypeScript check; TypeScript errors are not suppressed.
- `python3 -m py_compile freqtrade_integration/strategies/SbkSignalStrategy.py` checks strategy syntax only. Standard-library tests exercise the same versioned signal contract used by the strategy. Full Freqtrade strategy loading and exchange behavior require the Freqtrade Python dependencies and a running instance.

## Audit scope, change record, and license

- No input ZIPs were present. The audited source is this checked-out repository at `d289ee5` (`Add freqtrade as pure project folder`), branch `main`. Freqtrade is a checked-in project directory in the same Git repository, not a submodule; it has no separately pinned submodule commit.
- The worktree had pre-existing user changes in `index.html`, `src/App.tsx`, and `src/main.tsx`; these were preserved. Audit/remediation also changed the manager, runtime tests, signal strategy/contract tests, configuration template, package test command, this README, and added `AUDIT.md`. The authorized dry-run integration exercise modified the tracked `tradesv3.dryrun.sqlite`; normal Freqtrade shutdown checkpointed and removed transient `-wal`/`-shm` sidecars. The database was not reverted or deleted, and must be reviewed/backed up before commit or delivery.
- The Freqtrade user configuration at `freqtrade/user_data/config.json` is ignored/private. Its non-secret settings were checked: `SbkSignalStrategy`, Bybit futures, `BTC/USDT:USDT`, `15m`, `dry_run: true`, one maximum open trade, loopback RPC, and `force_entry_enable: false`. Do not distribute the private config or runtime credentials.
- Freqtrade's GPLv3 license and upstream legal notices are retained under `freqtrade/`; no root project license/NOTICE was found. Preserve those files, source modifications, and applicable GPLv3 source/notice obligations when redistributing the combined tree or binaries. This audit does not determine whether the first-party SBK1 portions form a combined/derivative work; obtain legal review before distributing a combined product.
- Node dependencies are recorded in `package-lock.json`. Freqtrade's Python dependencies are declared in its project metadata, but a clean dependency install and hash-locked Python environment were not verified.
- No files were removed because no safe deletion was demonstrated. Freqtrade engine/database, strategy, analysis, audit, recovery, tests, and dry-run artifacts have distinct active uses. SBK1 JSON records remain signal/audit records, not authoritative trade state.

## Validation evidence

- **Validation commands:** `npm test` passed (18 mandatory fail-closed scenarios and 48 Python tests, including authenticated mock-RPC lifecycle tests and the bounded-retry test); `npm run lint`, `npm run build`, and `npm run sbk1:check` passed. The production build emits its existing large-chunk warning. `npm run sbk1:status` passed while the real managed stack was running.
- **Real managed stack and safety:** Authenticated Freqtrade RPC reported `dry_run=true`, `demo_trading=false`, `force_entry_enable=false`, and `state=running` on Bybit futures with `max_open_trades=1`. SBK1 used the real DataProvider snapshot (HTTP 200; BTC/USDT:USDT, 15m, 500 candles and a ticker). No live mode, force-entry, direct exchange order, or exchange credential was used. The dry-run database backup `backups/tradesv3.dryrun.before-lifecycle-20261013T204243Z.sqlite` is git-ignored and passed `PRAGMA quick_check`.
- **Real fixture outcomes:** A first request at 20:45:41 UTC was rejected with `FREQTRADE_TICKER_UNAVAILABLE` and created no signal. Four fixtures were subsequently accepted by the authenticated endpoint (HTTP 201), each capped at 10 quote units:
  - `sbk1_c57bf3672d1ae7cb18d06b25ed10b817`: `ACCEPTED` was observed at 20:46:16.784 and 20:46:31.318 UTC. SBK1 received SIGINT while it was queued; after restart, the same signal ID was still readable and was observed `REJECTED` at 20:47:22.881 with reason `Signal failed Freqtrade freshness or configuration validation.` The unchanged `ACCEPTED` state was not confirmed immediately after restart.
  - `sbk1_8bfe4babc877d35414a4bbbf1ff790a7`: `ACCEPTED` at 20:48:46.793 and 20:49:05.273 UTC; `REJECTED` at 20:49:46.685 with reason `Signal failed Freqtrade freshness or configuration validation.`
  - `sbk1_56eeca5e61d4a4aa294ea5a8c38d5100`: `ACCEPTED` at 20:55:49.778 UTC. The authenticated kill-switch endpoint was engaged at 20:55:49.787, reported `cancelledSignals=1`, and the same signal was `CANCELLED` at 20:55:49.816 with reason `SBK1 kill switch cancelled this queued signal.`
  - `sbk1_57b2750f14d18d1cd256ecc28386fc78`: `ACCEPTED` at 20:56:34.715 and 20:56:53.634 UTC; `REJECTED` at 20:57:34.771 with reason `Signal failed Freqtrade freshness or configuration validation.`
- **Real trade, order, exit, and recovery evidence:** Freqtrade reported zero open trades and `/api/live/closed-trades` returned zero records. No fixture produced a Freqtrade trade or order; no fill or exit was observed. The queued-signal restart preserved the same signal ID, but unchanged-status recovery was not demonstrated because its terminal rejection occurred before the post-restart observation. `STRATEGY_ACCEPTED`, `ORDER_SUBMITTED`, `PARTIALLY_FILLED`, and `FILLED` were not observed on the real stack, and no real open-position kill-switch case was available. The kill-switch response reported `existingPositionsAffected=false`; the separate open-position case is mock-only.
- **Real prediction archive and production gate:** Startup outcome sync completed after retry with `processedCount=0`, `insertedCount=0`, and `unmatchedCount=0`. `/api/prediction-archive/status` returned HTTP 200 with zero decisions, confirmed outcomes, and matched outcomes; `unmatchedOutcomes` was empty. With no closed fixture trade, no `FREQTRADE_CONFIRMED` outcome or exact decision link was available to verify. After cleanup, authenticated production polling of `/api/freqtrade/signals` returned HTTP 503, `CALIBRATED_CONFIDENCE_UNAVAILABLE`, stage `CALIBRATION`. Final settings were `SBK1_DRY_RUN_FIXTURE_ENABLED=false` and an empty `SBK1_SIGNAL_MAX_STAKE_QUOTE`; the authenticated admin endpoint re-engaged the kill switch, and final live status showed zero open trades.
- **Startup-sync fix:** The server now begins listening before the startup archive sync, avoiding a startup-order deadlock with the managed launcher, which starts Freqtrade after the API health check. Startup sync retries four times with exponential delays (5, 10, and 20 seconds), logs retries, and continues if RPC remains unavailable. On the real run it retried while Freqtrade was starting, then completed successfully with zero trades to process. The retry bound and terminal error behavior are covered by `scripts/verify_bounded_retry.ts`.
- **Mock-only evidence:** Automated tests cover complete/partial fills, rejected orders, expiry, queued kill-switch cancellation, open-position preservation on kill-switch engagement, stop-loss/exit reconciliation, and signal-store/strategy restart recovery for queued, claimed, submitted, partial-fill, and filled cases. These scenarios were not observed against real Freqtrade in this run.
- **Other not verified:** Clean dependency installation; Freqtrade's full core test suite; fee/slippage backtest, look-ahead audit, and out-of-sample evaluation.

## Remaining blockers

- Build a sufficient, timestamped corpus of SBK1 feature snapshots and exact-linked Freqtrade-confirmed outcomes to meet the training, validation, and out-of-sample minimums, including both wins and losses. Current archive status does not establish calibration readiness.
- Validate the resulting probability model with leakage/look-ahead review, fee- and slippage-aware backtests, and out-of-sample evaluation. Current heuristic and fixture results do not establish model performance.
- Exercise the complete lifecycle against a real Freqtrade dry-run instance, including fixture acceptance, fills/exits, timeout/cancellation, and restart recovery. Current lifecycle evidence is from mock RPC tests; the documented fixture attempt was rejected while the kill switch was engaged.
- Complete a clean dependency installation and run Freqtrade's full core test suite; neither was verified in the recorded integration run.
- Before any production deployment, review and implement the required durable, transactional shared queue/store and private-network/TLS deployment controls; the current signal store is single-process and the managed launcher is loopback-only.

### Repeatable dry-run lifecycle procedure

Run the following automated procedure from the repository root. It uses loopback-only HTTP servers, temporary signal/kill-switch stores, a local mock Freqtrade RPC, and a test-only admin token; it does not contact an exchange or a live Freqtrade service:

```sh
npm test
```

`npm test` includes `verify_freqtrade_order_lifecycle.ts` for fill, partial-fill, rejection, expiry, queued kill-switch, stop/exit reconciliation, and idempotent adapter restart checks; `verify_freqtrade_dashboard_endpoints.ts` starts a local SBK1 server against the mock RPC to verify admin-authenticated status/history reads and that an open position is unaffected by the kill switch. The Python strategy tests use mocked Freqtrade trade records to restart the strategy in queued, claimed, submitted, partial, and filled states. None of these tests sends an RPC order command except the force-exit request to the local mock, and the mock is configured as `dry_run=true`.

For a separate, real Freqtrade **dry-run only** exercise, first provide private configuration and run `npm run sbk1:check`; do not proceed unless it confirms `dry_run=true`, `force_entry_enable=false`, loopback RPC, and the expected strategy/pair. Keep exchange credentials absent for this exercise, confirm the configured Freqtrade trade database is backed up, and begin with no open trades. Enable `SBK1_DRY_RUN_FIXTURE_ENABLED=true` and a deliberately reviewed positive `SBK1_SIGNAL_MAX_STAKE_QUOTE` only for the fixture session. Start with `npm run sbk1`, verify `npm run sbk1:status`, and submit a fixture only through the authenticated `/api/freqtrade/dry-run-test-signal` endpoint. Observe the returned signal ID in `/api/hunter/signals/:signalId` and correlate it with Freqtrade's status/trade history. To test the queued kill switch, engage it before Freqtrade claims the fixture; for the open-position case, wait for an actual Freqtrade dry-run fill and confirm `/api/live/status` still reports the position after engaging the switch. Exercise natural Freqtrade stop-loss/exit behavior and inspect the same trade's persisted orders/history. Never call SBK1 direct exchange routes or use `force-entry`.

For restart recovery, create and observe one fixture at a time in `ACCEPTED` (queued), `STRATEGY_ACCEPTED` (claimed), `ORDER_SUBMITTED`, then `FILLED`. At each observed state, stop the managed stack with Ctrl+C, preserve both stores, restart with `npm run sbk1`, and verify the same signal ID/status and Freqtrade trade/order record through the protected endpoints and authenticated Freqtrade RPC. Do not resubmit a signal in `UNKNOWN_IN_FLIGHT`; investigate the Freqtrade database first. Disable the fixture flag and clear the stake override after the session. Deterministic full/partial fills and rejection are not guaranteed by this fixture mechanism; use the mock suite for repeatable outcome coverage. These real-runtime steps are a procedure, **not evidence that the scenarios have been run**.

## Clean setup, backup, and upgrade notes

- Use Node.js 22 LTS (Node.js 20 or 22 is supported by the web toolchain) and Python 3.12 or newer (Freqtrade declares `requires-python >=3.12`; Python 3.12 is the recommended reproducible baseline). From a clean checkout on Linux/macOS:

  ```sh
  python3.12 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -e ./freqtrade
  npm ci
  python scripts/init_sbk1_config.py
  npm run sbk1:check
  npm run sbk1
  ```

- The initializer reads `.env.example` and `freqtrade_integration/config.example.json`, checks that the exchange (`bybit`), futures market, pair (`BTC/USDT:USDT`), timeframe (`15m`), strategy (`SbkSignalStrategy`), and dry-run settings agree, then creates `.env` and `freqtrade/user_data/config.json` with mode `0600` on POSIX. It generates independent cryptographically random admin, bridge, RPC, and JWT credentials without printing them. It refuses to overwrite either private file; back up and reconcile existing settings manually. Review both private files, keep `dry_run: true`, and do not add exchange API keys for this local integration test. On Windows, use `py -3.12 -m venv .venv` and `.venv\Scripts\python.exe` / `.venv\Scripts\pip.exe`; restrict the private files' ACLs to the service account.
- The sample's `SBK1_SIGNAL_MAX_STAKE_QUOTE` is intentionally empty. Keep it empty for ordinary startup; set it to a deliberately reviewed positive amount only when running the optional dry-run fixture. Set `SBK1_DRY_RUN_FIXTURE_ENABLED=true` only for that exercise and turn it off afterward. Production SBK1 signals remain disabled until calibrated-probability evidence is implemented.
- `npm run sbk1` starts the complete managed stack: it validates private settings and strategy discovery, detects occupied ports, acquires a single-instance lock, starts SBK1 and Freqtrade, and waits for authenticated RPC health. `npm run sbk1:check` validates without starting services; `npm run sbk1:status` reports SBK1 API and authenticated Freqtrade RPC health separately. `npm run dev` starts only the SBK1 service. Ctrl+C requests graceful shutdown of both managed services. If either child exits unexpectedly, the supervisor stops the other and exits nonzero. Existing listeners are detected and never killed automatically; identify and authorize any stop yourself.
- After setup, validate with `npm test`, `npm run lint`, and `npm run build`. Python tests in `npm test` use `.venv` (or the explicitly supplied `SBK1_PYTHON`). `GET /api/health` is SBK1's unauthenticated JSON health endpoint; an unauthenticated Freqtrade ping alone is not considered RPC health.
- Before upgrades, stop both services and back up the Freqtrade database configured by `db_url`, the private Freqtrade config, Freqtrade `user_data/`, the SBK1 signal outbox (default `data/freqtrade-signals.json`), and `database_kill_switch.json`. Verify a restore against copies before resuming. Keep the checked-in Freqtrade source at a reviewed upstream release; do not replace it with `develop` without compatibility tests.
- On an RPC failure, check the Freqtrade API is listening only on loopback, credentials match `FREQTRADE_USERNAME` / `FREQTRADE_PASSWORD`, and pair/timeframe/exchange configuration agrees across both processes. On a bridge failure, verify the same private token is set in both processes. The local supervisor requires loopback and the bridge fails closed on mismatches.
- If SBK1's signal JSON is invalid, do not delete or edit it to resume trading. Stop the services, preserve a copy for diagnosis, and restore from a verified backup or repair the record under review. The JSON store is single-process and is not safe as a multi-instance queue.
