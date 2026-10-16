import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd


def timeframe_delta(timeframe: str) -> pd.Timedelta:
    match = re.fullmatch(r"([1-9][0-9]*)([mhdw])", timeframe)
    if not match:
        raise ValueError("Timeframe must use a positive m, h, d, or w interval.")
    amount = int(match.group(1))
    unit = {"m": "minutes", "h": "hours", "d": "days", "w": "weeks"}[match.group(2)]
    return pd.Timedelta(**{unit: amount})


def audit_data(data_file: Path, timeframe: str) -> dict[str, object]:
    if not data_file.is_file():
        raise FileNotFoundError(f"Historical OHLCV file does not exist: {data_file}")

    frame = pd.read_feather(data_file)
    required_columns = {"date", "open", "high", "low", "close", "volume"}
    missing_columns = sorted(required_columns.difference(frame.columns))
    if missing_columns:
        raise ValueError(f"Historical OHLCV file is missing columns: {', '.join(missing_columns)}")

    interval = timeframe_delta(timeframe)
    timestamps = pd.to_datetime(frame["date"], utc=True, errors="coerce")
    numeric = frame[["open", "high", "low", "close", "volume"]].apply(pd.to_numeric, errors="coerce")
    values = numeric.to_numpy(dtype=float)
    invalid_value_rows = int((~np.isfinite(values).all(axis=1)).sum())
    duplicate_timestamps = int(timestamps.duplicated().sum())
    intervals = timestamps.diff().dropna()
    non_monotonic_steps = int((intervals <= pd.Timedelta(0)).sum())
    unexpected_interval_steps = int((intervals % interval != pd.Timedelta(0)).sum())
    missing_intervals = int(sum(max(0, int(delta / interval) - 1) for delta in intervals if delta > interval))
    invalid_ohlc_rows = int((
        (numeric["high"] < numeric[["open", "close"]].max(axis=1))
        | (numeric["low"] > numeric[["open", "close"]].min(axis=1))
        | (numeric["high"] < numeric["low"])
        | (numeric["volume"] < 0)
    ).sum())
    now = pd.Timestamp(datetime.now(timezone.utc))
    future_timestamps = int((timestamps > now).sum())
    incomplete_candles = int(((timestamps + interval) > now).sum())
    closed_candles = int(((timestamps + interval) <= now).sum())

    passed = (
        len(frame) > 0
        and timestamps.notna().all()
        and invalid_value_rows == 0
        and duplicate_timestamps == 0
        and non_monotonic_steps == 0
        and unexpected_interval_steps == 0
        and missing_intervals == 0
        and invalid_ohlc_rows == 0
        and future_timestamps == 0
        and closed_candles > 0
    )
    return {
        "passed": bool(passed),
        "data_file": str(data_file),
        "timeframe": timeframe,
        "rows": len(frame),
        "first_timestamp_utc": timestamps.min().isoformat() if len(frame) and timestamps.notna().any() else None,
        "last_timestamp_utc": timestamps.max().isoformat() if len(frame) and timestamps.notna().any() else None,
        "closed_candles": closed_candles,
        "incomplete_candles_excluded": incomplete_candles,
        "duplicate_timestamps": duplicate_timestamps,
        "non_monotonic_steps": non_monotonic_steps,
        "unexpected_interval_steps": unexpected_interval_steps,
        "missing_intervals": missing_intervals,
        "invalid_value_rows": invalid_value_rows,
        "invalid_ohlc_rows": invalid_ohlc_rows,
        "future_timestamps": future_timestamps,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit real Freqtrade Feather OHLCV data for backtesting integrity.")
    parser.add_argument("data_file", type=Path, help="Path to a Freqtrade OHLCV Feather file")
    parser.add_argument("--timeframe", default="15m", help="Candle timeframe (default: 15m)")
    args = parser.parse_args()
    try:
        report = audit_data(args.data_file, args.timeframe)
    except (OSError, ValueError, ImportError) as error:
        print(json.dumps({"passed": False, "error": str(error)}, indent=2))
        return 1
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())