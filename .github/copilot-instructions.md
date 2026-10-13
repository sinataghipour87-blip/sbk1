1. Freqtrade is the ONLY owner of exchange credentials, orders, fills, positions, stop-losses and trade persistence. Never add direct exchange calls or API keys to the SBK1 Node server.
2. Never enable live trading. The managed launcher must keep requiring dry_run=true and force_entry_enable=false. Never weaken any fail-closed gate (CALIBRATED_CONFIDENCE_UNAVAILABLE, kill switch, dry-run checks, auth checks) to make a test pass.
3. Never fabricate data, metrics, win rates, or calibration results. Missing data must be "unavailable", never zero or a default.
4. Never commit secrets (.env, freqtrade/user_data/config.json, tokens). Never delete or overwrite data files (JSON stores, sqlite) without backing them up first.
5. Before finishing any task: run `npm test`, `npm run lint`, `npm run build`, and `npm run sbk1:check`. Report each result honestly, including failures. Do not claim something works unless it was actually run.
6. At the end of every task, give a short report: what changed (files), what was run, what passed or failed, what was NOT verified.
7. Make small, focused changes. If a task is unclear or risky, stop and ask instead of guessing.
