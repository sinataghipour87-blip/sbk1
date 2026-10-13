# Acceptance check

Date: 2026-10-13
Repository HEAD: `0502c72a8b2371c9eef1c60fda52a5418768b295`
Real-stack environment: isolated clean clone at `/tmp/sbk1-acceptance-clean-20261013T2152`. The source worktree already had user changes; the real-stack clone was created from HEAD and those uncommitted code changes were not overlaid.

The 24-hour run was not completed. The real Freqtrade dry-run stack ran for approximately 8 minutes 10 seconds of active time across two process windows (about 8 minutes 30 seconds including the controlled restart gap). This is a short smoke test, not a stability or endurance certification.

| Requirement | Evidence (command/output) | Real vs mock | Result |
|---|---|---|---|
| Follow clean setup from a clean checkout | The documented `python3.12 -m venv .venv` failed: `ensurepip is not available`; `python3.12-venv` was not installed and had no candidate in this host's apt indexes. | Real clean clone / host prerequisite | **FAIL** — the documented command cannot proceed on this host without the OS venv package. README now documents the Debian/Ubuntu prerequisite; it was unavailable here, so the corrected exact sequence could not be rerun. |
| Complete clean-clone dependency install and config setup | After that blocker, used `python3.12 -m venv --without-pip .venv`, bootstrapped pip with `python3.12 -m pip --python .venv/bin/python install --upgrade pip`, then ran `.venv/bin/python -m pip install -e ./freqtrade`, `npm ci`, `.venv/bin/python scripts/init_sbk1_config.py`, and `npm run sbk1:check`; all completed successfully. The initializer reported that credentials were not printed. | Real clean clone | **PASS** with workaround; corrected OS-package path remains unverified |
| Validate private file permissions and dry-run-only settings | `stat`: both generated private files mode `600`; config check showed `dry_run: true`, `force_entry_enable: false`, and no exchange key or secret configured. | Real clean clone | **PASS** |
| `npm test` | Passed: 18 mandatory fail-closed scenarios; Python output `Ran 58 tests ... OK`; RPC/lifecycle and stale-data scenarios use local mocks. No orders were submitted to the real Freqtrade instance by this command. | Mock/local | **PASS** |
| `npm run lint` | First concurrent invocation was terminated with exit 143; serial retry completed successfully (`tsc --noEmit`). | Local/static | **PASS** on serial retry |
| `npm run build` | `vite build` exited successfully; large-chunk warning reported bundles of approximately 1.4 MB and 1.6 MB. | Local build | **PASS** with warning |
| `npm run sbk1:check` | Passed in both the current worktree and clean clone: `Freqtrade discovered SbkSignalStrategy successfully` and `Startup configuration checks passed; no services were started.` | Local config/strategy discovery | **PASS** |
| Documented Node.js version | This host used Node.js `v24.21.0`; npm install, tests, lint, and build passed on it. The README recommends Node.js 22 LTS, which was not available here. | Local toolchain | **NOT RUN** on Node.js 22 |
| Run for at least 24 hours | The stack was observed from approximately 21:57 to 22:05 UTC across two windows, with one controlled restart. | Real dry-run, clean HEAD clone | **NOT RUN** — no 24-hour endurance result is claimed. |
| Startup, crashes, and restart behavior | Both services reached healthy state and authenticated Freqtrade RPC was ready. One SIGINT shutdown completed; both ports closed and the next managed launch returned both services to healthy state. The restarted instance retained the engaged kill switch and zero open trades. No process crash or unexpected supervisor restart was observed. | Real dry-run, clean HEAD clone | **PASS** for this short smoke test |
| Freqtrade API errors during runtime | Two `uvicorn.error` ASGI exceptions reported missing `freqtrade/freqtrade/rpc/api_server/ui/fallback_file.html` and `favicon.ico`; the Freqtrade process and RPC remained healthy. These were non-fatal but are runtime errors and remain unresolved. | Real dry-run, clean HEAD clone | **FAIL** — two observed API/UI request errors |
| Prediction archive growth | `data/prediction-archive/archive.sqlite` was 28,672 bytes and retained that size through the restart and final check. It contained zero decisions and no outcomes; no archive-row growth occurred. | Real dry-run, clean HEAD clone | **PASS** — no growth with no candidate decisions or closed trades |
| Real outcome synchronization and unmatched outcomes | Startup sync log: `processedCount: 0, insertedCount: 0, unmatchedCount: 0`. Authenticated manual sync returned HTTP 200 with `processedCount=0`, `insertedCount=0`, `linkedCount=0`, empty `unmatched` and `linkConflicts`; archive status reported zero decisions/outcomes and empty `unmatchedOutcomes`. | Real Freqtrade RPC; empty dataset | **PASS** for empty-state sync only; joining an actual closed trade to a decision was **NOT RUN** because neither existed. |
| Stale-data fail-closed behavior on the real stack | No stale-data rejection was observed or deliberately induced. Freqtrade warned that Bybit ticker data had no exchange timestamp and stated freshness was based on local retrieval time. `npm test` covers stale inputs against mocks. | Real observation plus mock test | **NOT RUN** for a real stale-data event; mock coverage **PASS** |
| Production signal gate | Authenticated real signal poll returned HTTP 503 with `CALIBRATED_CONFIDENCE_UNAVAILABLE`, stage `CALIBRATION`. The current worktree diff does not change this production gate; no gate was relaxed. | Real dry-run poll; source diff | **PASS** |
| Live trading remains disabled | Real status after restart: `dryRun=true`, `demoTrading=false`, `forceEntryEnabled=false`, kill switch engaged, and `openTrades=0`. No fixture was enabled; no orders or fills occurred. | Real dry-run, clean HEAD clone | **PASS** |
| No secrets tracked in git | `.env` and `freqtrade/user_data/config.json` are not tracked. Targeted high-confidence token/private-key patterns found no usable credentials; the sole private-key marker match was an intentionally incomplete Freqtrade documentation example containing `<...>`. The tracked dry-run SQLite file also had no high-confidence credential-pattern match. | Git worktree/source scan | **PASS** for checked paths and patterns; not a third-party exhaustive secret audit |
| Real-stack verification of the current uncommitted source changes | Real stack used a clean clone of HEAD; dirty worktree changes were not overlaid. Tests and checks above that ran in the current worktree did include its current changes. | Real vs local | **NOT RUN** for current uncommitted code on the real stack |

## README corrections

- Documented the Debian/Ubuntu Python `venv`/`ensurepip` package prerequisite, which was missing from the original clean setup instructions.
- Made the Node.js/npm prerequisite explicit and clarified that Python 3.12 is the command baseline, with substitutions needed for newer supported interpreters.
- Changed the config initializer command to use the newly created virtual environment interpreter.
- Added `npm run sbk1:check` to the post-setup validation list.
- Corrected Windows setup ordering so pip is upgraded before installing Freqtrade.
- Repointed the separate one-command startup section to the safe clean-setup procedure instead of instructions that assumed an activated venv and manually copied private config templates.

The original clean-setup sequence was attempted in the isolated clone. Because the host lacked the required OS venv package and its apt indexes had no candidate, the complete sequence was continued with the explicit `--without-pip`/pip `--python` workaround above; the corrected OS-package path itself remains unverified on this host.
