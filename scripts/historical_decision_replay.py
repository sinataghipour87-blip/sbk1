#!/usr/bin/env python3
"""Research-only replay of archived SBK1 decisions against local Freqtrade candles."""

import json
import math
import os
import random
import re
import sqlite3
import sys
from bisect import bisect_right
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE_PATH = ROOT / "data" / "prediction-archive" / "archive.sqlite"
DEFAULT_DATA_DIR = ROOT / "freqtrade" / "user_data" / "data" / "bybit" / "futures"
MIN_REPLAY_TRADES = 30
DEFAULT_TAKER_FEE_RATE = 0.00055
DEFAULT_SLIPPAGE_BPS = 5.0
DEFAULT_MAX_HOLD_BARS = 40
DEFAULT_TRADE_NOTIONAL_QUOTE = 1_000.0
DEFAULT_INITIAL_CAPITAL_QUOTE = 10_000.0
BOOTSTRAP_SAMPLES = 10_000


def _timeframe_ms(timeframe: str) -> int:
    match = re.fullmatch(r"([1-9][0-9]*)([mhdw])", timeframe)
    if not match:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    multiplier = {"m": 60_000, "h": 3_600_000, "d": 86_400_000, "w": 604_800_000}
    return int(match.group(1)) * multiplier[match.group(2)]


def _nonnegative_env_number(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a finite non-negative number.") from error
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name} must be a finite non-negative number.")
    return value


def _read_archive_decisions(archive_path: Path) -> list[dict[str, Any]]:
    if not archive_path.is_file():
        return []
    uri = f"{archive_path.resolve().as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prediction_signals'"
        ).fetchone()
        if table is None:
            raise ValueError("Prediction archive exists but its decision table is unavailable.")
        rows = connection.execute(
            """
            SELECT signal_id, decision_timestamp_ms, pair, timeframe, direction, entry, stop, target
            FROM prediction_signals
            WHERE source = 'SBK1_DECISION'
            ORDER BY decision_timestamp_ms, signal_id
            """
        ).fetchall()
        return [{
            "signalId": row["signal_id"],
            "decisionTimestampMs": row["decision_timestamp_ms"],
            "pair": row["pair"],
            "timeframe": row["timeframe"],
            "direction": row["direction"],
            "entry": row["entry"],
            "stop": row["stop"],
            "target": row["target"],
        } for row in rows]
    finally:
        connection.close()


def _finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _safe_symbol(pair: str) -> str:
    symbol = re.sub(r"[^A-Za-z0-9]+", "_", pair).strip("_")
    if not symbol:
        raise ValueError("Archived decision pair cannot be mapped to a Freqtrade data file.")
    return symbol


def _load_feather(path: Path, timeframe: str, funding: bool = False) -> list[dict[str, Any]]:
    try:
        import pandas as pd
    except ImportError as error:
        raise RuntimeError("Historical replay requires pandas and pyarrow in the configured Python environment.") from error

    if not path.is_file():
        raise FileNotFoundError(str(path))
    frame = pd.read_feather(path)
    required = {"date", "funding_rate"} if funding else {"date", "open", "high", "low", "close", "volume"}
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise ValueError(f"{path.name} is missing required columns: {', '.join(missing)}")
    if frame.empty:
        raise ValueError(f"{path.name} contains no rows.")

    date_values = frame["date"]
    if pd.api.types.is_numeric_dtype(date_values):
        timestamps = pd.to_datetime(date_values, unit="ms", utc=True, errors="coerce")
    else:
        timestamps = pd.to_datetime(date_values, utc=True, errors="coerce")
    if timestamps.isna().any() or timestamps.duplicated().any() or not timestamps.is_monotonic_increasing:
        raise ValueError(f"{path.name} timestamps must be valid, unique, and strictly increasing.")
    if (timestamps > pd.Timestamp.now(tz="UTC")).any():
        raise ValueError(f"{path.name} contains future-dated timestamps.")

    if funding:
        rates = pd.to_numeric(frame["funding_rate"], errors="coerce")
        if rates.isna().any() or not all(math.isfinite(float(rate)) for rate in rates):
            raise ValueError(f"{path.name} contains missing or non-finite funding rates.")
        return [
            {"timestamp": int(timestamp.value // 1_000_000), "rate": float(rate)}
            for timestamp, rate in zip(timestamps, rates)
        ]

    interval_ms = _timeframe_ms(timeframe)
    numeric = frame[["open", "high", "low", "close", "volume"]].apply(pd.to_numeric, errors="coerce")
    values = numeric.to_numpy(dtype=float)
    if not all(math.isfinite(value) for row in values for value in row):
        raise ValueError(f"{path.name} contains non-finite OHLCV values.")
    if (
        (numeric["high"] < numeric[["open", "close"]].max(axis=1)).any()
        or (numeric["low"] > numeric[["open", "close"]].min(axis=1)).any()
        or (numeric["high"] < numeric["low"]).any()
        or (numeric[["open", "high", "low", "close"]] <= 0).any().any()
        or (numeric["volume"] < 0).any()
    ):
        raise ValueError(f"{path.name} contains invalid OHLCV geometry.")
    intervals = timestamps.diff().dropna()
    if (intervals != pd.Timedelta(milliseconds=interval_ms)).any():
        raise ValueError(f"{path.name} contains missing or irregular {timeframe} intervals.")

    now = pd.Timestamp.now(tz="UTC")
    closed = timestamps + pd.Timedelta(milliseconds=interval_ms) <= now
    return [
        {
            "timestamp": int(timestamp.value // 1_000_000),
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
        }
        for timestamp, row in zip(timestamps.loc[closed], numeric.loc[closed].itertuples(index=False))
    ]


def _validated_decision(decision: dict[str, Any]) -> bool:
    if (
        not _finite_number(decision.get("decisionTimestampMs"))
        or not isinstance(decision.get("pair"), str)
        or not decision["pair"].strip()
        or not isinstance(decision.get("timeframe"), str)
        or not isinstance(decision.get("direction"), str)
        or decision["direction"] not in {"LONG", "SHORT"}
        or not all(_finite_number(decision.get(field)) for field in ("entry", "stop", "target"))
    ):
        return False
    try:
        _timeframe_ms(decision["timeframe"])
        _safe_symbol(decision["pair"])
    except ValueError:
        return False
    entry, stop, target = (float(decision[field]) for field in ("entry", "stop", "target"))
    if min(entry, stop, target) <= 0:
        return False
    if decision["direction"] == "LONG":
        return stop < entry < target
    return target < entry < stop


def _simulate_decision(
    decision: dict[str, Any],
    candles: list[dict[str, Any]],
    funding: list[dict[str, Any]] | None,
    taker_fee_rate: float,
    slippage_bps: float,
    max_hold_bars: int,
    trade_notional_quote: float,
) -> tuple[dict[str, Any] | None, str | None]:
    interval_ms = _timeframe_ms(decision["timeframe"])
    decision_ms = int(decision["decisionTimestampMs"])
    candle_timestamps = [candle["timestamp"] for candle in candles]

    # Strictly later timestamps prevent using the decision candle, including its close.
    entry_index = bisect_right(candle_timestamps, decision_ms)
    if entry_index >= len(candles):
        return None, "no_price_after_decision"

    direction = decision["direction"]
    entry_candle = candles[entry_index]
    raw_entry = entry_candle["open"]
    stop = float(decision["stop"])
    target = float(decision["target"])
    if direction == "LONG" and not stop < raw_entry < target:
        return None, "entry_gap_outside_levels"
    if direction == "SHORT" and not target < raw_entry < stop:
        return None, "entry_gap_outside_levels"

    slip_rate = slippage_bps / 10_000.0
    actual_entry = raw_entry * (1 + slip_rate if direction == "LONG" else 1 - slip_rate)
    if direction == "LONG" and not stop < actual_entry < target:
        return None, "entry_gap_outside_levels"
    if direction == "SHORT" and not target < actual_entry < stop:
        return None, "entry_gap_outside_levels"
    quantity = trade_notional_quote / actual_entry
    entry_fee = quantity * actual_entry * taker_fee_rate
    exit_index: int | None = None
    raw_exit: float | None = None
    exit_reason: str | None = None
    last_index = min(entry_index + max_hold_bars - 1, len(candles) - 1)

    for index in range(entry_index, last_index + 1):
        candle = candles[index]
        if direction == "LONG":
            hit_stop = candle["low"] <= stop
            hit_target = candle["high"] >= target
            if hit_stop:
                raw_exit = min(candle["open"], stop)
                exit_reason = "STOP"
            elif hit_target:
                raw_exit = target
                exit_reason = "TARGET"
        else:
            hit_stop = candle["high"] >= stop
            hit_target = candle["low"] <= target
            if hit_stop:
                raw_exit = max(candle["open"], stop)
                exit_reason = "STOP"
            elif hit_target:
                raw_exit = target
                exit_reason = "TARGET"
        if raw_exit is not None:
            exit_index = index
            break

    if exit_index is None:
        if len(candles) - entry_index < max_hold_bars:
            return None, "insufficient_completed_exit_candles"
        exit_index = last_index
        raw_exit = candles[exit_index]["close"]
        exit_reason = "TIMEOUT"

    assert raw_exit is not None and exit_reason is not None
    actual_exit = raw_exit * (1 - slip_rate if direction == "LONG" else 1 + slip_rate)
    exit_fee = quantity * actual_exit * taker_fee_rate
    gross_pnl = quantity * (actual_exit - actual_entry if direction == "LONG" else actual_entry - actual_exit)
    funding_paid: float | None = None
    if funding is not None:
        funding_paid = 0.0
        funding_timestamps = [event["timestamp"] for event in funding]
        first_funding = bisect_right(funding_timestamps, entry_candle["timestamp"])
        last_funding = bisect_right(funding_timestamps, candles[exit_index]["timestamp"] + interval_ms)
        funding_direction = 1.0 if direction == "LONG" else -1.0
        for event in funding[first_funding:last_funding]:
            price_index = bisect_right(candle_timestamps, event["timestamp"]) - 1
            if price_index >= 0 and candle_timestamps[price_index] + interval_ms > event["timestamp"]:
                price_index -= 1
            if price_index >= 0:
                mark_price = candles[price_index]["close"]
                funding_paid += quantity * mark_price * event["rate"] * funding_direction

    fees_paid = entry_fee + exit_fee
    pnl_after_known_costs = gross_pnl - fees_paid
    if funding_paid is not None:
        pnl_after_known_costs -= funding_paid
    slippage_cost = quantity * (
        abs(actual_entry - raw_entry) + abs(actual_exit - raw_exit)
    )
    net_pnl = pnl_after_known_costs if funding_paid is not None else None
    return {
        "label": "REPLAY_SIMULATED",
        "signalId": decision.get("signalId"),
        "decisionTimestampMs": decision_ms,
        "entryTimestampMs": entry_candle["timestamp"],
        "exitTimestampMs": candles[exit_index]["timestamp"],
        "direction": direction,
        "entryPrice": actual_entry,
        "exitPrice": actual_exit,
        "exitReason": exit_reason,
        "barsHeld": exit_index - entry_index + 1,
        "notionalQuote": trade_notional_quote,
        "grossPnlQuote": gross_pnl,
        "feesPaidQuote": fees_paid,
        "fundingPaidQuote": funding_paid,
        "fundingDataStatus": "AVAILABLE" if funding_paid is not None else "UNAVAILABLE",
        "slippageCostQuote": slippage_cost,
        "netPnlQuote": net_pnl,
        "pnlAfterKnownCostsQuote": pnl_after_known_costs,
        "returnAfterKnownCostsPct": pnl_after_known_costs / trade_notional_quote * 100,
        "outcome": (
            "UNAVAILABLE_FUNDING_DATA" if net_pnl is None else
            "WIN" if net_pnl > 0 else "LOSS" if net_pnl < 0 else "BREAKEVEN"
        ),
        "outcomeAfterKnownCosts": (
            "WIN" if pnl_after_known_costs > 0 else
            "LOSS" if pnl_after_known_costs < 0 else "BREAKEVEN"
        ),
    }, None


def _percentile(sorted_values: list[float], fraction: float) -> float:
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (position - lower)


def _confidence_intervals(trades: list[dict[str, Any]]) -> dict[str, Any]:
    rng = random.Random(20261013)
    returns = [trade["returnAfterKnownCostsPct"] for trade in trades]
    count = len(returns)
    win_rate_samples: list[float] = []
    expectancy_samples: list[float] = []
    for _ in range(BOOTSTRAP_SAMPLES):
        sample = [returns[rng.randrange(count)] for _ in range(count)]
        win_rate_samples.append(sum(value > 0 for value in sample) / count * 100)
        expectancy_samples.append(sum(sample) / count)
    win_rate_samples.sort()
    expectancy_samples.sort()
    return {
        "confidenceLevelPct": 95,
        "method": "deterministic percentile bootstrap",
        "winRateAfterKnownCostsPct": {
            "lower": _percentile(win_rate_samples, 0.025),
            "upper": _percentile(win_rate_samples, 0.975),
        },
        "expectancyAfterKnownCostsPctOfNotional": {
            "lower": _percentile(expectancy_samples, 0.025),
            "upper": _percentile(expectancy_samples, 0.975),
        },
    }


def _max_drawdown(trades: list[dict[str, Any]], initial_capital_quote: float) -> tuple[float, float]:
    equity = initial_capital_quote
    peak = initial_capital_quote
    max_drawdown_quote = 0.0
    max_drawdown_pct = 0.0
    for trade in trades:
        equity += trade["pnlAfterKnownCostsQuote"]
        peak = max(peak, equity)
        drawdown = peak - equity
        max_drawdown_quote = max(max_drawdown_quote, drawdown)
        if peak > 0:
            max_drawdown_pct = max(max_drawdown_pct, drawdown / peak * 100)
    return max_drawdown_quote, max_drawdown_pct


def replay(
    archive_path: Path | None = None,
    data_dir: Path | None = None,
    decisions: list[dict[str, Any]] | None = None,
    min_replay_trades: int = MIN_REPLAY_TRADES,
    taker_fee_rate: float = DEFAULT_TAKER_FEE_RATE,
    slippage_bps: float = DEFAULT_SLIPPAGE_BPS,
    max_hold_bars: int = DEFAULT_MAX_HOLD_BARS,
    trade_notional_quote: float = DEFAULT_TRADE_NOTIONAL_QUOTE,
    initial_capital_quote: float = DEFAULT_INITIAL_CAPITAL_QUOTE,
) -> dict[str, Any]:
    archive_file = archive_path or Path(os.environ.get("SBK1_PREDICTION_ARCHIVE_PATH", DEFAULT_ARCHIVE_PATH))
    market_data_dir = data_dir or Path(os.environ.get("SBK1_FREQTRADE_DATA_DIR", DEFAULT_DATA_DIR))
    archived = decisions if decisions is not None else _read_archive_decisions(archive_file)
    counts = {
        "archivedDecisions": len(archived),
        "structurallyValidDecisions": 0,
        "replayableDecisions": 0,
        "missingMarketData": 0,
        "noCompletedMarketCandles": 0,
        "noPriceAfterDecision": 0,
        "entryGapOutsideLevels": 0,
        "insufficientCompletedExitCandles": 0,
    }
    rejected: dict[str, int] = {}
    market_cache: dict[tuple[str, str], list[dict[str, Any]] | None] = {}
    funding_cache: dict[tuple[str, str], list[dict[str, Any]] | None] = {}
    funding_pairs_available: set[str] = set()
    funding_pairs_unavailable: set[str] = set()
    trades: list[dict[str, Any]] = []

    for decision in archived:
        if not _validated_decision(decision):
            rejected["invalidDecision"] = rejected.get("invalidDecision", 0) + 1
            continue
        counts["structurallyValidDecisions"] += 1
        key = (decision["pair"], decision["timeframe"])
        symbol = _safe_symbol(decision["pair"])
        candle_path = market_data_dir / f"{symbol}-{decision['timeframe']}-futures.feather"
        if key not in market_cache:
            market_cache[key] = (
                _load_feather(candle_path, decision["timeframe"])
                if candle_path.is_file()
                else None
            )
        candles = market_cache[key]
        if candles is None:
            counts["missingMarketData"] += 1
            continue
        if not candles:
            counts["noCompletedMarketCandles"] += 1
            continue

        funding_path = market_data_dir / f"{symbol}-1h-funding_rate.feather"
        if key not in funding_cache:
            funding_cache[key] = _load_feather(funding_path, "1h", funding=True) if funding_path.is_file() else None
        funding = funding_cache[key]
        (funding_pairs_available if funding is not None else funding_pairs_unavailable).add(decision["pair"])

        trade, reason = _simulate_decision(
            decision,
            candles,
            funding,
            taker_fee_rate,
            slippage_bps,
            max_hold_bars,
            trade_notional_quote,
        )
        if reason == "no_price_after_decision":
            counts["noPriceAfterDecision"] += 1
        elif reason == "entry_gap_outside_levels":
            counts["entryGapOutsideLevels"] += 1
        elif reason == "insufficient_completed_exit_candles":
            counts["insufficientCompletedExitCandles"] += 1
        elif trade is not None:
            trades.append(trade)
            counts["replayableDecisions"] += 1

    required = max(1, int(min_replay_trades))
    response_counts = {
        **counts,
        "requiredReplayableDecisions": required,
        "additionalReplayableDecisionsNeeded": max(0, required - counts["replayableDecisions"]),
        "rejectedDecisions": rejected,
    }
    funding_coverage = {
        "availablePairs": sorted(funding_pairs_available),
        "unavailablePairs": sorted(funding_pairs_unavailable),
        "status": "AVAILABLE" if funding_pairs_available and not funding_pairs_unavailable else
            "PARTIAL" if funding_pairs_available else "UNAVAILABLE",
    }
    trades.sort(key=lambda trade: (trade["exitTimestampMs"], trade["decisionTimestampMs"]))
    assumptions = {
        "takerFeeRate": taker_fee_rate,
        "slippageBpsPerFill": slippage_bps,
        "maxHoldBars": max_hold_bars,
        "tradeNotionalQuote": trade_notional_quote,
        "initialCapitalQuote": initial_capital_quote,
        "fundingRateSource": "local Freqtrade funding-rate Feather when present; no assumed rate otherwise",
        "entryPriceSource": "open of the first completed candle whose timestamp is strictly after the decision timestamp",
        "ambiguousStopAndTarget": "stop is assumed first",
    }
    if len(trades) < required:
        return {
            "status": "HISTORICAL_SIGNALS_UNAVAILABLE",
            "code": "HISTORICAL_SIGNALS_UNAVAILABLE",
            "label": "REPLAY_SIMULATED",
            "message": "Not enough archived SBK1 decisions could be replayed against completed local market data.",
            "counts": response_counts,
            "fundingCoverage": funding_coverage,
            "assumptions": assumptions,
        }

    wins = sum(trade["pnlAfterKnownCostsQuote"] > 0 for trade in trades)
    total_pnl = sum(trade["pnlAfterKnownCostsQuote"] for trade in trades)
    max_drawdown_quote, max_drawdown_pct = _max_drawdown(trades, initial_capital_quote)
    return {
        "status": "SUCCESS",
        "label": "REPLAY_SIMULATED",
        "counts": response_counts,
        "trades": trades,
        "metrics": {
            "tradeCount": len(trades),
            "winRateAfterKnownCostsPct": wins / len(trades) * 100,
            "expectancyPerTradeAfterKnownCostsQuote": total_pnl / len(trades),
            "expectancyPerTradeAfterKnownCostsPctOfNotional": sum(
                trade["returnAfterKnownCostsPct"] for trade in trades
            ) / len(trades),
            "maxDrawdownAfterKnownCostsQuote": max_drawdown_quote,
            "maxDrawdownAfterKnownCostsPct": max_drawdown_pct,
            "costBasis": "taker fees, slippage, and observed funding; unavailable funding is not imputed",
            "confidenceIntervals": _confidence_intervals(trades),
        },
        "fundingCoverage": funding_coverage,
        "assumptions": assumptions,
    }


def main() -> int:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        if request.get("action") != "run":
            raise ValueError("Replay action must be 'run'.")
        slippage_bps = _nonnegative_env_number("SBK1_REPLAY_SLIPPAGE_BPS", DEFAULT_SLIPPAGE_BPS)
        result = replay(slippage_bps=slippage_bps)
        print(json.dumps(result, allow_nan=False))
        return 0
    except (OSError, sqlite3.Error, RuntimeError, TypeError, ValueError) as error:
        print(f"Historical replay failed: {error}", file=sys.stderr)
        print(json.dumps({
            "status": "ERROR",
            "code": "HISTORICAL_REPLAY_FAILED",
            "label": "REPLAY_SIMULATED",
            "error": str(error),
        }, allow_nan=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
