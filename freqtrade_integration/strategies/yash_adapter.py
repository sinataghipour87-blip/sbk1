"""In-process enforcing adapter between Freqtrade and Yash."""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime
from typing import Any, Mapping

from pydantic import ValidationError

from yash.contracts.models import (
    CONTRACT_VERSION,
    CandleEvidence,
    YashDecisionEnvelope,
    YashEvaluationRequest,
)
from yash.engine import EngineConfig, YashEngine

logger = logging.getLogger("SbkSignalStrategy")
_ENGINE = YashEngine(EngineConfig(enforcing=True))
_TIMEFRAME_MS = {"15m": 15 * 60_000, "1h": 60 * 60_000, "4h": 4 * 60 * 60_000}
_FRESHNESS_LIMIT_MS = _ENGINE.config.freshness_limit_ms


def build_request_from_freqtrade(
    trade: Any,
    current_rate: float,
    current_time: datetime,
    dataframe_15m_closed: Any,
    df_1h: Any,
    df_4h: Any,
    fees_if_available: Mapping[str, float] | None,
) -> YashEvaluationRequest | None:
    now_ms = _datetime_ms(current_time)
    if now_ms is None:
        _log_skip("DATA_INCOMPLETE", "evaluation time is invalid")
        return None

    try:
        if not _valid_positive(current_rate):
            _log_skip("DATA_INCOMPLETE", "current rate is invalid")
            return None

        primary = _latest_closed_candle(dataframe_15m_closed, "15m", now_ms)
        if primary is None:
            return None
        context_candles = []
        for timeframe, frame in (("1h", df_1h), ("4h", df_4h)):
            context_candle = _latest_closed_candle(
                frame,
                timeframe,
                now_ms,
                optional=not _frame_is_present(frame),
            )
            if _frame_is_present(frame) and context_candle is None:
                return None
            if context_candle is not None:
                context_candles.append(context_candle)
        context = tuple(context_candles)

        open_date = getattr(trade, "open_date_utc", None)
        opened_at_ms = _datetime_ms(open_date)
        open_rate = getattr(trade, "open_rate", None)
        current_stop = getattr(trade, "stop_loss", None)
        trade_id = getattr(trade, "id", None)
        pair = getattr(trade, "pair", None)
        direction = "SHORT" if getattr(trade, "is_short", False) else "LONG"
        signal = trade.get_custom_data("sbk_signal")
        entry_conditions = signal.get("entryConditions") if isinstance(signal, dict) else None
        horizon = entry_conditions.get("maxHoldingMinutes") if isinstance(entry_conditions, dict) else None

        if (
            opened_at_ms is None
            or not isinstance(trade_id, int)
            or isinstance(trade_id, bool)
            or trade_id <= 0
            or not isinstance(pair, str)
            or not isinstance(horizon, int)
            or isinstance(horizon, bool)
            or not 1 <= horizon <= 60
            or not _valid_positive(open_rate)
            or not _valid_positive(current_stop)
        ):
            _log_skip("DATA_INCOMPLETE", "trade snapshot or holding horizon is unavailable")
            return None

        if fees_if_available is None:
            _log_skip("DATA_INCOMPLETE", "fee rates are unavailable")
            return None
        entry_fee_rate = fees_if_available.get("entry_fee_rate")
        exit_fee_rate = fees_if_available.get("exit_fee_rate")
        if not _valid_fee(entry_fee_rate) or not _valid_fee(exit_fee_rate):
            _log_skip("DATA_INCOMPLETE", "fee rates are invalid")
            return None

        return YashEvaluationRequest(
            contract_version=CONTRACT_VERSION,
            request_id=f"freqtrade:{trade_id}:{primary.close_time_ms}",
            evaluated_at_ms=now_ms,
            trade={
                "trade_id": str(trade_id),
                "pair": pair,
                "direction": direction,
                "opened_at_ms": opened_at_ms,
                "entry_price": float(open_rate),
                "current_price": float(current_rate),
                "current_stop_price": float(current_stop),
                "holding_horizon_minutes": horizon,
                "entry_fee_rate": float(entry_fee_rate),
                "exit_fee_rate": float(exit_fee_rate),
            },
            market={
                "primary_candle": primary,
                "context_candles": context,
            },
        )
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError, ValidationError) as exc:
        _log_skip("DATA_INCOMPLETE", f"could not build a validated request: {exc}")
        return None


def evaluate_enforcing(request: YashEvaluationRequest) -> YashDecisionEnvelope:
    """Evaluate locally and mark only validated Phase 1 actions executable."""
    return _ENGINE.evaluate(request)


def format_audit_log(envelope: YashDecisionEnvelope) -> str:
    decision = envelope.plan.decision
    evidence = decision.evidence_snapshot
    return "YASH_ENFORCING " + json.dumps(
        {
            "request_id": envelope.request_id,
            "decision_id": envelope.decision_id,
            "decision_type": decision.decision_type.value,
            "reason_codes": [reason.value for reason in decision.reason_codes],
            "evidence_timestamps": {
                "candle_open_time_ms": evidence.candle_open_time_ms,
                "candle_close_time_ms": evidence.candle_close_time_ms,
                "candle_observed_at_ms": evidence.candle_observed_at_ms,
            },
            "executable": envelope.plan.executable,
            "observation_only": envelope.plan.observation_only,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _latest_closed_candle(
    dataframe: Any,
    timeframe: str,
    now_ms: int,
    *,
    optional: bool = False,
) -> CandleEvidence | None:
    if dataframe is None or getattr(dataframe, "empty", True):
        if not optional:
            _log_skip("DATA_INCOMPLETE", f"{timeframe} candle dataframe is empty")
        return None

    duration_ms = _TIMEFRAME_MS[timeframe]
    closed_rows: list[tuple[int, Any]] = []
    try:
        for row in dataframe.itertuples(index=False):
            candle_time = getattr(row, "date", None)
            start_ms = _datetime_ms(candle_time)
            if start_ms is None:
                continue
            close_ms = start_ms + duration_ms
            if close_ms <= now_ms:
                closed_rows.append((close_ms, row))
    except (AttributeError, TypeError, ValueError, OverflowError) as exc:
        if not optional:
            _log_skip("DATA_INCOMPLETE", f"{timeframe} candle dataframe is invalid: {exc}")
        return None

    if not closed_rows:
        if optional:
            _log_skip("DATA_INCOMPLETE", f"no completed {timeframe} context candle is available")
        else:
            _log_skip("CLOSED_CANDLE_REQUIRED", "no completed 15m candle is available")
        return None

    close_ms, row = max(closed_rows, key=lambda item: item[0])
    if now_ms - close_ms > duration_ms + _FRESHNESS_LIMIT_MS:
        _log_skip("DATA_STALE", f"latest completed {timeframe} candle is stale")
        return None

    try:
        values = {
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
        }
        if not all(math.isfinite(value) for value in values.values()):
            raise ValueError("OHLCV contains a non-finite value")
        return CandleEvidence(
            timeframe=timeframe,
            open_time_ms=close_ms - duration_ms,
            close_time_ms=close_ms,
            observed_at_ms=now_ms,
            source="freqtrade-dataprovider",
            **values,
        )
    except (AttributeError, TypeError, ValueError, OverflowError) as exc:
        _log_skip("DATA_INCOMPLETE", f"{timeframe} OHLCV is invalid: {exc}")
        return None


def _frame_is_present(dataframe: Any) -> bool:
    return dataframe is not None and not getattr(dataframe, "empty", True)


def _datetime_ms(value: Any) -> int | None:
    if not isinstance(value, datetime):
        return None
    try:
        if value.tzinfo is None or value.utcoffset() is None:
            return None
        timestamp = value.timestamp()
    except (OverflowError, OSError, ValueError):
        return None
    if not math.isfinite(timestamp):
        return None
    return int(timestamp * 1000)


def _valid_positive(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value > 0
    )


def _valid_fee(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0 <= value < 0.1
    )


def _log_skip(reason_code: str, detail: str) -> None:
    logger.info("YASH_ENFORCING_SKIPPED reason_code=%s detail=%s", reason_code, detail)
