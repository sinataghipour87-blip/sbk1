# Yash Post-Trade Policy Engine

Yash is a deterministic, in-process post-trade decision package. It does not
place orders, authorize entries, or make network requests. Phase 1 supports
breakeven, time-stop, and confirmed invalidation decisions. The core engine is
observation-only by default; an explicitly enforcing adapter may act on valid
Phase 1 decisions after applying the stop ratchet and evidence guards.

## Safety boundaries

- Primary evidence is the latest closed `15m` candle. `1h` and `4h` candles
  are optional context only.
- Primary evidence freshness defaults to 15 seconds and can be set to the
  host's existing freshness limit. The caller must not use a more permissive
  value than its own gate.
- Invalid, incomplete, stale, unsupported, or future-dated evidence cannot
  produce an actionable decision.
- `new_stoploss` is an absolute price in quote units. It is not a percentage
  or Freqtrade stoploss ratio.
- Stop proposals pass a direction-aware ratchet guard. LONG stops can only
  move up; SHORT stops can only move down.
- Yash does not alter entry gates, timeframe policy, position limits, or
  Freqtrade's existing trailing settings (2% activation offset / 1% trail).
- An invalidation object is treated as an affirmative, externally verified
  invalidation fact and must reference the same fresh, closed 15m candle.
- Optional analytical model plugins live under `yash.models`. Their output is
  validated as `ModelEvidence`, attached to `MarketEvidence`, and retained in
  the decision evidence snapshot. Future-dated observations are rejected.
  Model scores and regimes are context only: they do not trigger or veto exits
  or stop changes. The plugin interfaces use only the standard library and
  core contracts; optional model runtimes such as Transformers, LightGBM,
  XGBoost, or GARCH packages are not installed by the base package.
- Built-in, dependency-free candle analyzers provide ATR/Bollinger volatility
  regimes, momentum exhaustion, volume-climax context, and trend-confirmed
  15m reversal patterns. They require consecutive, closed 15m evidence and
  return `ModelEvidence`; only the Yash engine and its existing guards produce
  policy decisions.

## Local install and tests

From this directory:

```sh
python -m pip install -e ".[test]"
python -m pytest
```

The unit tests use deterministic values and do not contact exchanges.
Integration tests verify the Freqtrade adapter. Historical out-of-sample
results have not been established by this package's test suite.
