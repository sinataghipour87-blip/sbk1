import hashlib
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE_PATH = ROOT / "data" / "prediction-archive" / "archive.sqlite"
SIGNAL_ID_PATTERN = re.compile(r"^sbk1_[a-f0-9]{32}$")
DRY_RUN_COLLECTION_TAG_PREFIX = "DRY_RUN_COLLECTION:"
TIMESTAMP_KEYS = {
    "timestamp",
    "timestampms",
    "timestamputc",
    "observedatms",
    "receivedatms",
    "exchangetimestamp",
    "exchangetimestampms",
    "eventtimestampms",
    "sourcetimestampms",
    "generatedatms",
}


class ArchiveValidationError(ValueError):
    pass


def archive_path() -> Path:
    configured_path = os.environ.get("SBK1_PREDICTION_ARCHIVE_PATH", "").strip()
    return Path(configured_path) if configured_path else DEFAULT_ARCHIVE_PATH


def _nullify_missing_feature_values(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: None if key == "value" and nested == "UNKNOWN" else _nullify_missing_feature_values(nested)
            for key, nested in value.items()
        }
    if isinstance(value, list):
        return [_nullify_missing_feature_values(nested) for nested in value]
    return value


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _timestamp_ms(value: Any, path: str) -> int:
    if isinstance(value, bool):
        raise ArchiveValidationError(f"{path} must be a UTC timestamp in milliseconds.")
    if isinstance(value, (int, float)) and int(value) == value and value >= 0:
        return int(value)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ArchiveValidationError(f"{path} must be a valid timestamp.") from error
        if parsed.tzinfo is None:
            raise ArchiveValidationError(f"{path} must include a timezone.")
        return int(parsed.astimezone(timezone.utc).timestamp() * 1000)
    raise ArchiveValidationError(f"{path} must be a UTC timestamp in milliseconds.")


def _validate_temporal_data(value: Any, decision_ms: int, path: str) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized_key = re.sub(r"[^a-z]", "", key.lower())
            nested_path = f"{path}.{key}"
            is_timestamp = (
                normalized_key in TIMESTAMP_KEYS
                or "timestamp" in normalized_key and not normalized_key.endswith("source")
                or normalized_key.endswith("atms")
            )
            if is_timestamp and nested is not None:
                observed_ms = _timestamp_ms(nested, nested_path)
                if observed_ms > decision_ms:
                    raise ArchiveValidationError(
                        f"{nested_path} is later than the decision timestamp."
                    )
            _validate_temporal_data(nested, decision_ms, nested_path)


def _validate_feature_provenance(value: Any, path: str = "featureSnapshot") -> None:
    if isinstance(value, dict):
        if "value" in value and value["value"] is not None:
            timestamp = value.get("timestampMs")
            if timestamp is None:
                raise ArchiveValidationError(f"{path} has a feature value without a source timestamp.")
        for key, nested in value.items():
            _validate_feature_provenance(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _validate_feature_provenance(nested, f"{path}[{index}]")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _validate_temporal_data(nested, decision_ms, f"{path}[{index}]")


def _nullable_number(value: Any, field: str) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ArchiveValidationError(f"{field} must be a finite number or null.")
    if not (float("-inf") < float(value) < float("inf")):
        raise ArchiveValidationError(f"{field} must be a finite number or null.")
    return value


def normalize_record(record: Any) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise ArchiveValidationError("Archive record must be an object.")

    source = record.get("source")
    if source not in {"SBK1_DECISION", "UNVERIFIED_LOCAL"}:
        raise ArchiveValidationError("Archive record source is invalid.")
    collection_mode = record.get("collectionMode")
    if source == "SBK1_DECISION" and collection_mode not in (None, "DRY_RUN_COLLECTION"):
        raise ArchiveValidationError("collectionMode is invalid.")
    if source == "UNVERIFIED_LOCAL":
        collection_mode = None

    decision_ms = _timestamp_ms(record.get("decisionTimestampMs"), "decisionTimestampMs")
    pair = record.get("pair")
    timeframe = record.get("timeframe")
    direction = record.get("direction")
    if source == "SBK1_DECISION":
        if pair is not None and (not isinstance(pair, str) or not pair.strip()):
            raise ArchiveValidationError("pair must be a non-empty string or null.")
        if timeframe is not None and (not isinstance(timeframe, str) or not timeframe.strip()):
            raise ArchiveValidationError("timeframe must be a non-empty string or null.")
        if direction not in {"LONG", "SHORT", "NEUTRAL"}:
            raise ArchiveValidationError("direction is required for SBK1 decisions.")
    else:
        pair = pair if isinstance(pair, str) and pair.strip() else None
        timeframe = timeframe if isinstance(timeframe, str) and timeframe.strip() else None
        direction = direction if direction in {"LONG", "SHORT", "NEUTRAL"} else None

    features = record.get("featureSnapshot")
    quality = record.get("dataQualityReport")
    gate_result = record.get("gateResult")
    if source == "SBK1_DECISION":
        if not isinstance(features, (dict, list)):
            raise ArchiveValidationError("featureSnapshot must be an object or array.")
        if not isinstance(gate_result, dict) or not isinstance(gate_result.get("eligible"), bool):
            raise ArchiveValidationError("gateResult.eligible must be a boolean.")
        if not isinstance(gate_result.get("reasons"), list) or not all(
            isinstance(reason, str) for reason in gate_result["reasons"]
        ):
            raise ArchiveValidationError("gateResult.reasons must be an array of explanations.")
    else:
        dataset_record = record.get("datasetRecord")
        if not isinstance(gate_result, dict):
            gate_result = {
                "eligible": False,
                "reasons": ["UNVERIFIED_LOCAL_IMPORT_GATE_NOT_VERIFIED"],
                "originalGateResult": None,
            }
        gate_result["eligible"] = False
        gate_result["reasons"] = list(gate_result.get("reasons") or [])
        if "UNVERIFIED_LOCAL_IMPORT_GATE_NOT_VERIFIED" not in gate_result["reasons"]:
            gate_result["reasons"].append("UNVERIFIED_LOCAL_IMPORT_GATE_NOT_VERIFIED")
        if isinstance(dataset_record, dict):
            dataset_record = dict(dataset_record)
            dataset_record["outcomeSource"] = "UNVERIFIED_LOCAL"
            dataset_record["freqtradeTradeId"] = None
            dataset_record["outcome"] = None
            dataset_record["executionStatus"] = "PREDICTED_ONLY"
            dataset_record["timestamp"] = decision_ms
            dataset_record["timestampIso"] = datetime.fromtimestamp(
                decision_ms / 1000, timezone.utc
            ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            for key in (
                "PnL",
                "R",
                "MAE",
                "MFE",
                "timeInTrade",
                "slippage",
                "fees",
                "exitReason",
                "feedbackProcessedAtMs",
                "evaluatedAt",
                "entryTimestamp",
            ):
                dataset_record[key] = None
            if "features" in dataset_record:
                dataset_record["features"] = _nullify_missing_feature_values(dataset_record["features"])
            record["datasetRecord"] = dataset_record

    dataset_record = record.get("datasetRecord")
    if isinstance(dataset_record, dict):
        dataset_record = dict(dataset_record)
        dataset_record["outcomeSource"] = "UNVERIFIED_LOCAL"
        dataset_record["freqtradeTradeId"] = None
        dataset_record["outcome"] = None
        for key in (
            "PnL",
            "R",
            "MAE",
            "MFE",
            "timeInTrade",
            "slippage",
            "fees",
            "exitReason",
            "feedbackProcessedAtMs",
            "evaluatedAt",
            "entryTimestamp",
        ):
            dataset_record[key] = None
        record["datasetRecord"] = dataset_record

    features = _nullify_missing_feature_values(features)
    if source == "SBK1_DECISION":
        _validate_feature_provenance(features)
    _validate_temporal_data(features, decision_ms, "featureSnapshot")
    _validate_temporal_data(quality, decision_ms, "dataQualityReport")
    _validate_temporal_data(record.get("datasetRecord"), decision_ms, "datasetRecord")

    normalized = {
        "signalId": record.get("signalId"),
        "decisionTimestampMs": decision_ms,
        "pair": pair,
        "timeframe": timeframe,
        "direction": direction,
        "entry": _nullable_number(record.get("entry"), "entry"),
        "stop": _nullable_number(record.get("stop"), "stop"),
        "target": _nullable_number(record.get("target"), "target"),
        "featureSnapshot": features,
        "modelVersion": record.get("modelVersion") if isinstance(record.get("modelVersion"), str) else None,
        "predictorVersion": record.get("predictorVersion") if isinstance(record.get("predictorVersion"), str) else None,
        "dataQualityReport": quality,
        "gateResult": gate_result,
        "source": source,
        "datasetRecord": record.get("datasetRecord"),
    }
    if collection_mode is not None:
        normalized["collectionMode"] = collection_mode
    supplied_signal_id = normalized["signalId"]
    if supplied_signal_id is not None:
        valid_decision_id = (
            source == "SBK1_DECISION"
            and isinstance(supplied_signal_id, str)
            and SIGNAL_ID_PATTERN.fullmatch(supplied_signal_id)
        )
        valid_local_id = (
            source == "UNVERIFIED_LOCAL"
            and isinstance(supplied_signal_id, str)
            and re.fullmatch(r"sig_[a-f0-9]{64}", supplied_signal_id)
        )
        if not (valid_decision_id or valid_local_id):
            raise ArchiveValidationError("signalId must be a valid deterministic SBK1 decision ID.")
    else:
        id_payload = {key: value for key, value in normalized.items() if key != "signalId"}
        normalized["signalId"] = "sig_" + hashlib.sha256(_canonical_json(id_payload).encode("utf-8")).hexdigest()
    return normalized


def local_record_to_archive(record: Any) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise ArchiveValidationError("Each imported local record must be an object.")
    timestamp = record.get("timestamp")
    if timestamp is None:
        raise ArchiveValidationError("Imported local record has no timestamp; it cannot be archived.")

    levels = record.get("tpLevels") if isinstance(record.get("tpLevels"), dict) else {}
    return {
        "decisionTimestampMs": timestamp,
        "pair": record.get("market"),
        "timeframe": record.get("timeframe"),
        "direction": record.get("direction"),
        "entry": record.get("entryPrice"),
        "stop": record.get("stopPrice"),
        "target": levels.get("tp1"),
        "featureSnapshot": record.get("features"),
        "modelVersion": record.get("modelVersion"),
        "predictorVersion": record.get("featureVersion"),
        "dataQualityReport": None,
        "gateResult": {
            "eligible": False,
            "reasons": ["UNVERIFIED_LOCAL_IMPORT_GATE_NOT_VERIFIED"],
            "originalGateResult": None,
        },
        "source": "UNVERIFIED_LOCAL",
        "datasetRecord": record,
    }


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=DELETE")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS prediction_signals (
            signal_id TEXT PRIMARY KEY,
            decision_timestamp_ms INTEGER NOT NULL,
            pair TEXT,
            timeframe TEXT,
            direction TEXT,
            entry REAL,
            stop REAL,
            target REAL,
            feature_snapshot_json TEXT,
            model_version TEXT,
            predictor_version TEXT,
            data_quality_report_json TEXT,
            gate_result_json TEXT NOT NULL,
            source TEXT NOT NULL,
            collection_mode TEXT CHECK (collection_mode IS NULL OR collection_mode = 'DRY_RUN_COLLECTION'),
            dataset_record_json TEXT,
            archived_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS prediction_outcomes (
            freqtrade_trade_id INTEGER PRIMARY KEY CHECK (freqtrade_trade_id > 0),
            signal_id TEXT REFERENCES prediction_signals(signal_id),
            signal_tag TEXT,
            pair TEXT NOT NULL,
            is_short INTEGER NOT NULL CHECK (is_short IN (0, 1)),
            entry_price REAL NOT NULL,
            exit_price REAL,
            entry_timestamp_ms INTEGER,
            entry_fill_timestamp_ms INTEGER,
            exit_timestamp_ms INTEGER,
            fees_json TEXT NOT NULL,
            profit_abs REAL,
            profit_ratio REAL,
            profit_pct REAL,
            outcome TEXT CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN') OR outcome IS NULL),
            exit_reason TEXT,
            unmatched_reason TEXT,
            outcome_source TEXT NOT NULL CHECK (outcome_source = 'FREQTRADE_CONFIRMED'),
            execution_mode TEXT NOT NULL DEFAULT 'UNAVAILABLE'
                CHECK (execution_mode IN ('DRY_RUN_COLLECTION', 'DRY_RUN', 'LIVE', 'UNAVAILABLE')),
            archived_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS prediction_outcomes_signal_id_idx
            ON prediction_outcomes(signal_id);
        CREATE TRIGGER IF NOT EXISTS prediction_outcomes_immutable
        BEFORE UPDATE ON prediction_outcomes
        WHEN OLD.signal_id IS NOT NULL
            OR NEW.signal_id IS NULL
            OR OLD.freqtrade_trade_id IS NOT NEW.freqtrade_trade_id
            OR OLD.signal_tag IS NOT NEW.signal_tag
            OR OLD.pair IS NOT NEW.pair
            OR OLD.is_short IS NOT NEW.is_short
            OR OLD.entry_price IS NOT NEW.entry_price
            OR OLD.exit_price IS NOT NEW.exit_price
            OR OLD.entry_timestamp_ms IS NOT NEW.entry_timestamp_ms
            OR OLD.entry_fill_timestamp_ms IS NOT NEW.entry_fill_timestamp_ms
            OR OLD.exit_timestamp_ms IS NOT NEW.exit_timestamp_ms
            OR OLD.fees_json IS NOT NEW.fees_json
            OR OLD.profit_abs IS NOT NEW.profit_abs
            OR OLD.profit_ratio IS NOT NEW.profit_ratio
            OR OLD.profit_pct IS NOT NEW.profit_pct
            OR OLD.outcome IS NOT NEW.outcome
            OR OLD.exit_reason IS NOT NEW.exit_reason
            OR OLD.outcome_source IS NOT NEW.outcome_source
            OR OLD.archived_at_ms IS NOT NEW.archived_at_ms
        BEGIN
            SELECT RAISE(ABORT, 'confirmed Freqtrade outcome details are immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS prediction_outcomes_no_delete
        BEFORE DELETE ON prediction_outcomes
        BEGIN
            SELECT RAISE(ABORT, 'confirmed Freqtrade outcomes are append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS prediction_signals_no_update
        BEFORE UPDATE ON prediction_signals
        BEGIN
            SELECT RAISE(ABORT, 'prediction archive records are immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS prediction_signals_no_delete
        BEFORE DELETE ON prediction_signals
        BEGIN
            SELECT RAISE(ABORT, 'prediction archive records are append-only');
        END;
        """
    )
    for table, column, declaration in (
        ("prediction_signals", "collection_mode", "TEXT"),
        ("prediction_outcomes", "execution_mode", "TEXT NOT NULL DEFAULT 'UNAVAILABLE'"),
    ):
        existing_columns = {
            row["name"] for row in connection.execute(f"PRAGMA table_info({table})")
        }
        if column not in existing_columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
    connection.executescript(
        """
        CREATE TRIGGER IF NOT EXISTS prediction_outcomes_execution_mode_immutable
        BEFORE UPDATE OF execution_mode ON prediction_outcomes
        WHEN OLD.execution_mode IS NOT NEW.execution_mode
        BEGIN
            SELECT RAISE(ABORT, 'confirmed Freqtrade execution mode is immutable');
        END;
        """
    )
    return connection


def _create_daily_backup(path: Path) -> str:
    backup_dir = path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    backup_path = backup_dir / f"archive-{day}.sqlite"
    if not backup_path.exists():
        source = sqlite3.connect(path)
        try:
            with sqlite3.connect(backup_path) as target:
                source.backup(target)
        finally:
            source.close()
    return str(backup_path)


def append_record(record: Any, path: Path | None = None) -> dict[str, Any]:
    normalized = normalize_record(record)
    database_path = path or archive_path()
    connection = _connect(database_path)
    inserted = False
    try:
        with connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO prediction_signals (
                    signal_id, decision_timestamp_ms, pair, timeframe, direction,
                    entry, stop, target, feature_snapshot_json, model_version,
                    predictor_version, data_quality_report_json, gate_result_json,
                    source, collection_mode, dataset_record_json, archived_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized["signalId"],
                    normalized["decisionTimestampMs"],
                    normalized["pair"],
                    normalized["timeframe"],
                    normalized["direction"],
                    normalized["entry"],
                    normalized["stop"],
                    normalized["target"],
                    _canonical_json(normalized["featureSnapshot"]) if normalized["featureSnapshot"] is not None else None,
                    normalized["modelVersion"],
                    normalized["predictorVersion"],
                    _canonical_json(normalized["dataQualityReport"]) if normalized["dataQualityReport"] is not None else None,
                    _canonical_json(normalized["gateResult"]),
                    normalized["source"],
                    normalized.get("collectionMode"),
                    _canonical_json(normalized["datasetRecord"]) if normalized["datasetRecord"] is not None else None,
                    int(datetime.now(timezone.utc).timestamp() * 1000),
                ),
            )
            inserted = cursor.rowcount == 1
    finally:
        connection.close()

    backup = _create_daily_backup(database_path) if inserted else None
    return {"signalId": normalized["signalId"], "duplicate": not inserted, "backupPath": backup}


def _row_to_record(row: sqlite3.Row, connection: sqlite3.Connection) -> dict[str, Any]:
    record = {
        "signalId": row["signal_id"],
        "decisionTimestampMs": row["decision_timestamp_ms"],
        "pair": row["pair"],
        "timeframe": row["timeframe"],
        "direction": row["direction"],
        "entry": row["entry"],
        "stop": row["stop"],
        "target": row["target"],
        "featureSnapshot": json.loads(row["feature_snapshot_json"]) if row["feature_snapshot_json"] else None,
        "modelVersion": row["model_version"],
        "predictorVersion": row["predictor_version"],
        "dataQualityReport": json.loads(row["data_quality_report_json"]) if row["data_quality_report_json"] else None,
        "gateResult": json.loads(row["gate_result_json"]),
        "source": row["source"],
        "collectionMode": row["collection_mode"],
        "datasetRecord": json.loads(row["dataset_record_json"]) if row["dataset_record_json"] else None,
        "archivedAtMs": row["archived_at_ms"],
    }
    if row["source"] == "SBK1_DECISION":
        outcome_row = connection.execute(
            "SELECT * FROM prediction_outcomes WHERE signal_id = ?",
            (row["signal_id"],),
        ).fetchone()
        if outcome_row is not None:
            dataset_record = record["datasetRecord"]
            if isinstance(dataset_record, dict):
                dataset_record = dict(dataset_record)
                dataset_record.update({
                    "outcomeSource": outcome_row["outcome_source"],
                    "freqtradeTradeId": outcome_row["freqtrade_trade_id"],
                    "executionMode": outcome_row["execution_mode"],
                    "outcome": outcome_row["outcome"],
                    "executionStatus": "CLOSED_COMPLETED",
                    "PnL": outcome_row["profit_abs"],
                    "fees": _total_fees(json.loads(outcome_row["fees_json"])),
                    "exitReason": outcome_row["exit_reason"],
                    "entryTimestamp": outcome_row["entry_timestamp_ms"],
                })
                record["datasetRecord"] = dataset_record
            record["outcome"] = _row_to_outcome(outcome_row)
    return record


def _nullable_timestamp(value: Any, field: str) -> int | None:
    return None if value is None else _timestamp_ms(value, field)


def _total_fees(fees: dict[str, Any]) -> float | None:
    open_cost = fees.get("openCost")
    close_cost = fees.get("closeCost")
    if open_cost is None or close_cost is None:
        return None
    return open_cost + close_cost


def _row_to_outcome(row: sqlite3.Row) -> dict[str, Any]:
    fees = json.loads(row["fees_json"])
    return {
        "freqtradeTradeId": row["freqtrade_trade_id"],
        "signalId": row["signal_id"],
        "signalTag": row["signal_tag"],
        "pair": row["pair"],
        "isShort": bool(row["is_short"]),
        "entryPrice": row["entry_price"],
        "exitPrice": row["exit_price"],
        "entryTimestampMs": row["entry_timestamp_ms"],
        "entryFillTimestampMs": row["entry_fill_timestamp_ms"],
        "exitTimestampMs": row["exit_timestamp_ms"],
        "fees": fees,
        "totalFees": _total_fees(fees),
        "profitAbs": row["profit_abs"],
        "profitRatio": row["profit_ratio"],
        "profitPct": row["profit_pct"],
        "outcome": row["outcome"],
        "exitReason": row["exit_reason"],
        "outcomeSource": row["outcome_source"],
        "executionMode": row["execution_mode"],
        "unmatchedReason": row["unmatched_reason"],
        "archivedAtMs": row["archived_at_ms"],
    }


def _finite_number_or_none(value: Any, field: str) -> float | None:
    normalized = _nullable_number(value, field)
    return None if normalized is None else float(normalized)


def _validated_rpc_trade(trade: Any) -> dict[str, Any]:
    if not isinstance(trade, dict):
        raise ArchiveValidationError("Each RPC closed trade must be an object.")
    trade_id = trade.get("trade_id")
    if isinstance(trade_id, bool) or not isinstance(trade_id, int) or trade_id <= 0:
        raise ArchiveValidationError("RPC trade ID must be a positive integer.")
    if trade.get("is_open") is not False:
        raise ArchiveValidationError(f"RPC trade {trade_id} is not closed.")
    pair = trade.get("pair")
    if not isinstance(pair, str) or not pair.strip():
        raise ArchiveValidationError(f"RPC trade {trade_id} has no valid pair.")
    if not isinstance(trade.get("is_short"), bool):
        raise ArchiveValidationError(f"RPC trade {trade_id} has no valid direction.")

    entry_price = _finite_number_or_none(trade.get("open_rate"), "open_rate")
    if entry_price is None or entry_price <= 0:
        raise ArchiveValidationError(f"RPC trade {trade_id} has no valid entry price.")
    exit_price = _finite_number_or_none(trade.get("close_rate"), "close_rate")
    if exit_price is not None and exit_price <= 0:
        raise ArchiveValidationError(f"RPC trade {trade_id} has an invalid exit price.")

    fees = {
        "openRate": _finite_number_or_none(trade.get("fee_open"), "fee_open"),
        "openCost": _finite_number_or_none(trade.get("fee_open_cost"), "fee_open_cost"),
        "openCurrency": trade.get("fee_open_currency"),
        "closeRate": _finite_number_or_none(trade.get("fee_close"), "fee_close"),
        "closeCost": _finite_number_or_none(trade.get("fee_close_cost"), "fee_close_cost"),
        "closeCurrency": trade.get("fee_close_currency"),
        "fundingFees": _finite_number_or_none(trade.get("funding_fees"), "funding_fees"),
    }
    for field in ("openCurrency", "closeCurrency"):
        if fees[field] is not None and not isinstance(fees[field], str):
            raise ArchiveValidationError(f"RPC trade {trade_id} has an invalid {field}.")

    profit_abs = _finite_number_or_none(trade.get("close_profit_abs"), "close_profit_abs")
    outcome = "WIN" if profit_abs is not None and profit_abs > 0 else (
        "LOSS" if profit_abs is not None and profit_abs < 0 else (
            "BREAKEVEN" if profit_abs == 0 else None
        )
    )
    signal_tag = trade.get("enter_tag")
    if signal_tag is not None and not isinstance(signal_tag, str):
        raise ArchiveValidationError(f"RPC trade {trade_id} has an invalid entry tag.")
    exit_reason = trade.get("exit_reason")
    if exit_reason is not None and not isinstance(exit_reason, str):
        raise ArchiveValidationError(f"RPC trade {trade_id} has an invalid exit reason.")
    signal_id = trade.get("signalId")
    if signal_id is not None and (not isinstance(signal_id, str) or not signal_id):
        raise ArchiveValidationError(f"RPC trade {trade_id} has an invalid linked signal ID.")
    execution_mode = trade.get("executionMode", "UNAVAILABLE")
    if execution_mode not in {"DRY_RUN", "LIVE", "UNAVAILABLE"}:
        raise ArchiveValidationError(f"RPC trade {trade_id} has an invalid execution mode.")
    link_error = trade.get("linkError")
    if link_error is not None and not isinstance(link_error, str):
        raise ArchiveValidationError(f"RPC trade {trade_id} has an invalid link error.")
    if link_error:
        signal_id = None

    return {
        "tradeId": trade_id,
        "pair": pair.strip(),
        "isShort": trade["is_short"],
        "entryPrice": entry_price,
        "exitPrice": exit_price,
        "entryTimestampMs": _nullable_timestamp(trade.get("open_timestamp"), "open_timestamp"),
        "entryFillTimestampMs": _nullable_timestamp(trade.get("open_fill_timestamp"), "open_fill_timestamp"),
        "exitTimestampMs": _nullable_timestamp(trade.get("close_timestamp"), "close_timestamp"),
        "fees": fees,
        "profitAbs": profit_abs,
        "profitRatio": _finite_number_or_none(trade.get("close_profit"), "close_profit"),
        "profitPct": _finite_number_or_none(trade.get("close_profit_pct"), "close_profit_pct"),
        "outcome": outcome,
        "exitReason": exit_reason,
        "signalTag": signal_tag,
        "signalId": signal_id,
        "executionMode": execution_mode,
        "linkError": link_error,
    }


def _decision_signal_aliases(connection: sqlite3.Connection) -> dict[str, set[str]]:
    aliases: dict[str, set[str]] = {}
    rows = connection.execute(
        "SELECT signal_id, dataset_record_json FROM prediction_signals WHERE source = 'SBK1_DECISION'"
    ).fetchall()
    for row in rows:
        signal_ids = {row["signal_id"]}
        dataset_record = json.loads(row["dataset_record_json"]) if row["dataset_record_json"] else None
        if isinstance(dataset_record, dict):
            signal_ids.update(
                value for value in (
                    dataset_record.get("decisionId"),
                    dataset_record.get("signalId"),
                    dataset_record.get("freqtradeSignalId"),
                ) if isinstance(value, str) and value
            )
        for signal_id in signal_ids:
            aliases.setdefault(signal_id, set()).add(row["signal_id"])
    return aliases


def _find_decision_for_signal(
    aliases: dict[str, set[str]],
    external_signal_id: str,
) -> tuple[str | None, str | None]:
    matches = aliases.get(external_signal_id, set())
    if len(matches) > 1:
        return None, "AMBIGUOUS_SIGNAL_LINK"
    if not matches:
        return None, "SIGNAL_NOT_ARCHIVED"
    return next(iter(matches)), None


def archive_freqtrade_closed_trades(trades: Any, path: Path | None = None) -> dict[str, Any]:
    if not isinstance(trades, list):
        raise ArchiveValidationError("Authenticated Freqtrade closed trades must be an array.")
    normalized_trades = [_validated_rpc_trade(trade) for trade in trades]
    database_path = path or archive_path()
    connection = _connect(database_path)
    inserted_count = 0
    linked_count = 0
    unmatched: list[dict[str, Any]] = []
    link_conflicts: list[dict[str, Any]] = []
    changed = False
    try:
        with connection:
            signal_aliases = _decision_signal_aliases(connection)
            for trade in normalized_trades:
                signal_id = trade["signalId"]
                unmatched_reason = trade["linkError"] or "NO_EXACT_SIGNAL_LINK"
                execution_mode = trade["executionMode"]
                if signal_id:
                    resolved_signal_id, resolution_error = _find_decision_for_signal(signal_aliases, signal_id)
                    if resolution_error:
                        unmatched_reason = resolution_error
                        signal_id = None
                    else:
                        signal_id = resolved_signal_id
                        unmatched_reason = None
                        decision = connection.execute(
                            "SELECT collection_mode FROM prediction_signals WHERE signal_id = ?",
                            (signal_id,),
                        ).fetchone()
                        if (
                            decision
                            and decision["collection_mode"] == "DRY_RUN_COLLECTION"
                            and execution_mode == "DRY_RUN"
                        ):
                            execution_mode = "DRY_RUN_COLLECTION"
                fees_json = _canonical_json(trade["fees"])
                cursor = connection.execute(
                    """
                    INSERT OR IGNORE INTO prediction_outcomes (
                        freqtrade_trade_id, signal_id, signal_tag, pair, is_short,
                        entry_price, exit_price, entry_timestamp_ms, entry_fill_timestamp_ms,
                        exit_timestamp_ms, fees_json, profit_abs, profit_ratio, profit_pct,
                        outcome, exit_reason, unmatched_reason, outcome_source,
                        execution_mode, archived_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        trade["tradeId"],
                        signal_id,
                        trade["signalTag"],
                        trade["pair"],
                        int(trade["isShort"]),
                        trade["entryPrice"],
                        trade["exitPrice"],
                        trade["entryTimestampMs"],
                        trade["entryFillTimestampMs"],
                        trade["exitTimestampMs"],
                        fees_json,
                        trade["profitAbs"],
                        trade["profitRatio"],
                        trade["profitPct"],
                        trade["outcome"],
                        trade["exitReason"],
                        unmatched_reason if signal_id is None else None,
                        "FREQTRADE_CONFIRMED",
                        execution_mode,
                        int(datetime.now(timezone.utc).timestamp() * 1000),
                    ),
                )
                if cursor.rowcount == 1:
                    inserted_count += 1
                    changed = True
                else:
                    existing = connection.execute(
                        "SELECT signal_id, unmatched_reason FROM prediction_outcomes WHERE freqtrade_trade_id = ?",
                        (trade["tradeId"],),
                    ).fetchone()
                    if existing["signal_id"] is None and signal_id:
                        connection.execute(
                            """
                            UPDATE prediction_outcomes
                            SET signal_id = ?, unmatched_reason = NULL
                            WHERE freqtrade_trade_id = ? AND signal_id IS NULL
                            """,
                            (signal_id, trade["tradeId"]),
                        )
                        changed = True
                    elif existing["signal_id"] and signal_id and existing["signal_id"] != signal_id:
                        link_conflicts.append({
                            "freqtradeTradeId": trade["tradeId"],
                            "storedSignalId": existing["signal_id"],
                            "reportedSignalId": signal_id,
                            "reason": "SIGNAL_LINK_CONFLICT",
                        })
                final_link = connection.execute(
                    "SELECT signal_id, unmatched_reason FROM prediction_outcomes WHERE freqtrade_trade_id = ?",
                    (trade["tradeId"],),
                ).fetchone()
                if final_link["signal_id"] is None:
                    unmatched.append({
                        "freqtradeTradeId": trade["tradeId"],
                        "signalTag": trade["signalTag"],
                        "reason": final_link["unmatched_reason"] or unmatched_reason,
                    })
                else:
                    linked_count += 1
    finally:
        connection.close()

    backup = _create_daily_backup(database_path) if changed else None
    return {
        "processedCount": len(normalized_trades),
        "insertedCount": inserted_count,
        "linkedCount": linked_count,
        "unmatched": unmatched,
        "linkConflicts": link_conflicts,
        "backupPath": backup,
    }


def calibration_status(path: Path | None = None) -> dict[str, Any]:
    database_path = path or archive_path()
    if not database_path.exists():
        decisions = confirmed = wins = losses = 0
        matched = matched_wins = matched_losses = 0
        calibration_eligible_matched = calibration_eligible_wins = calibration_eligible_losses = 0
        execution_mode_counts = {
            "DRY_RUN_COLLECTION": 0,
            "DRY_RUN": 0,
            "LIVE": 0,
            "UNAVAILABLE": 0,
        }
        matched_execution_mode_counts = dict(execution_mode_counts)
        unmatched: list[dict[str, Any]] = []
    else:
        connection = _connect(database_path)
        try:
            decisions = connection.execute(
                "SELECT COUNT(*) FROM prediction_signals WHERE source = 'SBK1_DECISION'"
            ).fetchone()[0]
            confirmed = connection.execute(
                "SELECT COUNT(*) FROM prediction_outcomes WHERE outcome_source = 'FREQTRADE_CONFIRMED'"
            ).fetchone()[0]
            wins = connection.execute(
                "SELECT COUNT(*) FROM prediction_outcomes WHERE outcome_source = 'FREQTRADE_CONFIRMED' AND outcome = 'WIN'"
            ).fetchone()[0]
            losses = connection.execute(
                "SELECT COUNT(*) FROM prediction_outcomes WHERE outcome_source = 'FREQTRADE_CONFIRMED' AND outcome = 'LOSS'"
            ).fetchone()[0]
            matched = connection.execute(
                """
                SELECT COUNT(*) FROM prediction_outcomes
                WHERE outcome_source = 'FREQTRADE_CONFIRMED' AND signal_id IS NOT NULL
                """
            ).fetchone()[0]
            matched_wins = connection.execute(
                """
                SELECT COUNT(*) FROM prediction_outcomes
                WHERE outcome_source = 'FREQTRADE_CONFIRMED' AND signal_id IS NOT NULL AND outcome = 'WIN'
                """
            ).fetchone()[0]
            matched_losses = connection.execute(
                """
                SELECT COUNT(*) FROM prediction_outcomes
                WHERE outcome_source = 'FREQTRADE_CONFIRMED' AND signal_id IS NOT NULL AND outcome = 'LOSS'
                """
            ).fetchone()[0]
            calibration_eligible_matched = connection.execute(
                """
                SELECT COUNT(*) FROM prediction_outcomes
                WHERE outcome_source = 'FREQTRADE_CONFIRMED'
                    AND signal_id IS NOT NULL
                    AND execution_mode = 'LIVE'
                """
            ).fetchone()[0]
            calibration_eligible_wins = connection.execute(
                """
                SELECT COUNT(*) FROM prediction_outcomes
                WHERE outcome_source = 'FREQTRADE_CONFIRMED'
                    AND signal_id IS NOT NULL
                    AND execution_mode = 'LIVE'
                    AND outcome = 'WIN'
                """
            ).fetchone()[0]
            calibration_eligible_losses = connection.execute(
                """
                SELECT COUNT(*) FROM prediction_outcomes
                WHERE outcome_source = 'FREQTRADE_CONFIRMED'
                    AND signal_id IS NOT NULL
                    AND execution_mode = 'LIVE'
                    AND outcome = 'LOSS'
                """
            ).fetchone()[0]
            execution_mode_counts = {
                row["execution_mode"]: row["count"]
                for row in connection.execute(
                    """
                    SELECT execution_mode, COUNT(*) AS count
                    FROM prediction_outcomes
                    WHERE outcome_source = 'FREQTRADE_CONFIRMED'
                    GROUP BY execution_mode
                    """
                ).fetchall()
            }
            matched_execution_mode_counts = {
                row["execution_mode"]: row["count"]
                for row in connection.execute(
                    """
                    SELECT execution_mode, COUNT(*) AS count
                    FROM prediction_outcomes
                    WHERE outcome_source = 'FREQTRADE_CONFIRMED' AND signal_id IS NOT NULL
                    GROUP BY execution_mode
                    """
                ).fetchall()
            }
            for mode in ("DRY_RUN_COLLECTION", "DRY_RUN", "LIVE", "UNAVAILABLE"):
                execution_mode_counts.setdefault(mode, 0)
                matched_execution_mode_counts.setdefault(mode, 0)
            rows = connection.execute(
                """
                SELECT freqtrade_trade_id, signal_tag, unmatched_reason
                FROM prediction_outcomes
                WHERE signal_id IS NULL
                ORDER BY freqtrade_trade_id
                """
            ).fetchall()
            unmatched = [{
                "freqtradeTradeId": row["freqtrade_trade_id"],
                "signalTag": row["signal_tag"],
                "reason": row["unmatched_reason"],
            } for row in rows]
        finally:
            connection.close()

    minimums = {
        "training": 40,
        "validation": 20,
        "outOfSample": 200,
        "bothWinsAndLosses": True,
    }
    return {
        "decisions": decisions,
        "confirmedOutcomes": confirmed,
        "wins": wins,
        "losses": losses,
        "matchedOutcomes": matched,
        "matchedWins": matched_wins,
        "matchedLosses": matched_losses,
        "calibrationEligibleExecutionMode": "LIVE",
        "calibrationEligibleMatchedOutcomes": calibration_eligible_matched,
        "calibrationEligibleMatchedWins": calibration_eligible_wins,
        "calibrationEligibleMatchedLosses": calibration_eligible_losses,
        "confirmedOutcomesByExecutionMode": execution_mode_counts,
        "matchedOutcomesByExecutionMode": matched_execution_mode_counts,
        "minimums": minimums,
        "remaining": {
            "training": max(0, minimums["training"] - calibration_eligible_matched),
            "validation": max(0, minimums["validation"] - calibration_eligible_matched),
            "outOfSample": max(0, minimums["outOfSample"] - calibration_eligible_matched),
            "wins": 0 if calibration_eligible_wins else 1,
            "losses": 0 if calibration_eligible_losses else 1,
        },
        "bothWinsAndLossesPresent": calibration_eligible_wins > 0 and calibration_eligible_losses > 0,
        "unmatchedOutcomes": unmatched,
    }


def list_records(limit: int = 100, offset: int = 0, path: Path | None = None) -> dict[str, Any]:
    database_path = path or archive_path()
    if not database_path.exists():
        return {"records": [], "total": 0}
    connection = _connect(database_path)
    try:
        total = connection.execute("SELECT COUNT(*) FROM prediction_signals").fetchone()[0]
        rows = connection.execute(
            "SELECT * FROM prediction_signals ORDER BY decision_timestamp_ms DESC, signal_id LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return {"records": [_row_to_record(row, connection) for row in rows], "total": total}
    finally:
        connection.close()


def import_local_records(records: Any, path: Path | None = None) -> list[dict[str, Any]]:
    if not isinstance(records, list):
        raise ArchiveValidationError("records must be an array exported from localStorage.")
    converted = [local_record_to_archive(record) for record in records]
    normalized = [normalize_record(record) for record in converted]
    return [append_record(record, path) for record in normalized]


def main() -> None:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        action = request.get("action")
        if action == "append":
            response = append_record(request.get("record"))
        elif action == "list":
            limit = request.get("limit", 100)
            offset = request.get("offset", 0)
            if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
                raise ArchiveValidationError("limit must be an integer from 1 to 500.")
            if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
                raise ArchiveValidationError("offset must be a non-negative integer.")
            response = list_records(limit, offset)
        elif action == "import":
            response = {"results": import_local_records(request.get("records"))}
        elif action == "sync-outcomes":
            response = archive_freqtrade_closed_trades(request.get("trades"))
        elif action == "status":
            response = calibration_status()
        else:
            raise ArchiveValidationError("Unknown prediction archive action.")
        print(json.dumps(response, ensure_ascii=False, allow_nan=False))
    except (ArchiveValidationError, sqlite3.Error, OSError, TypeError, ValueError) as error:
        print(f"ARCHIVE_VALIDATION_ERROR: {error}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
