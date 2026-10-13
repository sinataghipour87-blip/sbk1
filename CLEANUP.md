# Freqtrade integration cleanup

## Deleted

- `src/components/DistributedMemoryCacheWidget.tsx` and
  `src/services/distributedMemoryCache.ts`: the service seeded four hard-coded
  pattern win rates (88.0–94.5%), returned a fixed 0.35 ms lookup time and
  minimum 88% cache-hit ratio, and the widget fabricated cache traffic. Before
  removal, the service was referenced only by that widget and the widget was
  only mounted in `src/App.tsx`; it had no historical or Freqtrade data source.
- `src/components/WinRateOptimizer.tsx`: the component was imported in
  `src/App.tsx` but never rendered or otherwise called. Its unused UI claimed
  guaranteed win rates and displayed a fabricated minimum of seven avoided
  losses. The app's saved `minWinProbability` setting remains in place and
  continues to feed all three `evaluateSignalToExecution` calls.
- The UI controls for `BACKTEST`, `PAPER`, `TESTNET`, and `LIVE`, along with
  the unused live-capital ceiling and empty slippage-comparison placeholder.
  The execution panel now only offers Freqtrade `DRY_RUN`. The client-side
  `getExecutionSettings` helper was called only by the removed panel;
  `getExecutionMode` had no callsites (its unused `App.tsx` import was removed).
  The legacy server mode metadata endpoints remain untouched.
- Direct dependencies `ws` and `@types/ws`: no SBK1 source, script, or config
  imports the `ws` package or uses its types. `ws` remains available
  transitively through `@google/genai`; neither package is declared as a direct
  dependency.

## Kept

- `freqtrade/`, `freqtrade_integration/`, signal adapter/store, analysis and
  risk services, and the kill switch were not removed or modified by cleanup.
  The production signal gate, kill switch, dry-run requirements, and
  authentication checks are unchanged; no safety-gate tests were removed.
- Legacy exchange endpoints were kept where they reject execution (HTTP 410 /
  default-deny). `scripts/verify_legacy_exchange_routes.ts` remains included by
  `npm test` and tests those failures; those routes are not dead code.
- The active `src/services/websocket.ts` is an HTTP poller over
  `getFreqtradeMarketSnapshot`, is imported by `src/App.tsx`, and is not an
  exchange WebSocket connector. The periodic archive outcome sync in
  `server.ts` is also retained because it refreshes authenticated Freqtrade
  outcomes.
- JSON readers/writers, the kill-switch persistence file, the signal store,
  and SQLite/data files were not deleted. The existing modified
  `tradesv3.dryrun.sqlite` was excluded from all commits and left untouched.
- `scripts/realistic_backtester.py` and its tests remain because
  `scripts/run_python_tests.ts` invokes `scripts.test_realistic_backtester`,
  and that test imports the backtester. Its CLI and output mark it
  research-only and explicitly deny live-trading authorization; the README now
  labels the script's scope clearly.
- `AUDIT.md` remains because `FREQTRADE_ROADMAP.md` links to it and it contains
  historical audit evidence. The existing package dependencies other than the
  two proven-unused direct WebSocket entries remain.
- Bybit profile identifiers and Freqtrade connector references remain where
  they identify the configured/tested Freqtrade profile; they are not SBK1
  credential signing or private-order handlers.

## Uncertain

- The README had described `freqtrade/user_data/strategies/SbkExecutionStrategy.py`
  as a no-op. That path is absent from this checkout, and the file was not
  removed or changed because the owner explicitly protected the `freqtrade/`
  source tree. The README now records that it is absent; confirm separately
  whether that stale reference should be removed from other historical records.
- `server.ts` still reads and writes `database_dataset_store.json`. Those are
  active persistence calls, so this cleanup cannot prove the store is unused;
  its data semantics and any migration/retention plan need owner review.
- `IndexedDbBrainMemoryWidget` and other actively mounted research widgets draw
  on local history or analysis reports, but their relationship to authoritative
  Freqtrade outcomes is not uniformly established. They were left in place;
  decide separately whether to relabel or remove their unverified metrics.
- `AUDIT.md` is historical and overlaps some current README material, but the
  roadmap links to it. Consolidating or deleting it needs an owner decision.
- No other environment variable or npm dependency was removed; no additional
  safe deletion was established by the reference checks performed for this
  cleanup.
