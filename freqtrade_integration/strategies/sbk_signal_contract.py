import ipaddress
import math
import os
import re
from typing import Any
from urllib.parse import urlsplit


SIGNAL_CONTRACT_VERSION = "sbk1.freqtrade.signal.v3"
ENTRY_AUTHORIZATION_VERSION = "sbk1.entry.authorization.v2"
DRY_RUN_FIXTURE_SETUP_PREFIX = "DRY_RUN_E2E_FIXTURE_"
_SIGNAL_ID_PATTERN = re.compile(r"^sbk1_[a-f0-9]{32}$")
_EXIT_SIGNAL_ID_PATTERN = re.compile(r"^sbk1_exit_[a-f0-9]{32}$")
_EXIT_ENTRY_TAG_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_PAIR_PATTERN = re.compile(r"^[A-Z0-9]{2,20}/[A-Z0-9]{2,20}(?::[A-Z0-9]{2,20})?$")
_TIMEFRAME_PATTERN = re.compile(r"^\d+[mhdw]$")


def _finite_number(value: Any) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _positive_number(value: Any) -> bool:
    return _finite_number(value) and value > 0


def validate_bridge_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        _ = parsed.port
        hostname = parsed.hostname
        is_loopback = hostname == "localhost"
        if hostname and not is_loopback:
            try:
                is_loopback = ipaddress.ip_address(hostname).is_loopback
            except ValueError:
                is_loopback = False
    except ValueError as error:
        raise ValueError("SBK1_BRIDGE_URL must be a valid HTTP(S) URL.") from error

    if (
        parsed.scheme not in ("http", "https")
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (parsed.scheme == "http" and not is_loopback)
    ):
        raise ValueError("SBK1_BRIDGE_URL must use HTTPS unless it targets loopback and must not contain credentials or query data.")

    return value.rstrip("/")


def is_signal_runtime(runmode: str) -> bool:
    return runmode == "dry_run"


def is_valid_sbk_exit_signal(
    signal: Any,
    *,
    now_ms: int,
    expected_pair: str,
) -> bool:
    if not isinstance(signal, dict):
        return False
    trade_id = signal.get("tradeId")
    entry_tag = signal.get("entryTag")
    has_trade_id = isinstance(trade_id, int) and not isinstance(trade_id, bool) and trade_id > 0
    has_entry_tag = isinstance(entry_tag, str) and bool(_EXIT_ENTRY_TAG_PATTERN.fullmatch(entry_tag))
    generated_at_ms = signal.get("generatedAtMs")
    expires_at_ms = signal.get("expiresAtMs")
    reason = signal.get("reason")
    return (
        signal.get("contractVersion") == SIGNAL_CONTRACT_VERSION
        and signal.get("signalType") == "EXIT"
        and isinstance(signal.get("exitId"), str)
        and bool(_EXIT_SIGNAL_ID_PATTERN.fullmatch(signal["exitId"]))
        and signal.get("pair") == expected_pair
        and isinstance(signal.get("pair"), str)
        and bool(_PAIR_PATTERN.fullmatch(signal["pair"]))
        and signal.get("direction") in ("LONG", "SHORT")
        and (has_trade_id or has_entry_tag)
        and (trade_id is None or has_trade_id)
        and (entry_tag is None or has_entry_tag)
        and isinstance(reason, str)
        and bool(reason.strip())
        and len(reason) <= 240
        and isinstance(generated_at_ms, int)
        and not isinstance(generated_at_ms, bool)
        and generated_at_ms <= now_ms + 1_000
        and isinstance(expires_at_ms, int)
        and not isinstance(expires_at_ms, bool)
        and expires_at_ms > now_ms
        and expires_at_ms > generated_at_ms
        and expires_at_ms - generated_at_ms <= 120_000
    )


def unresolved_inflight_signal_ids(
    records: list[Any],
    freqtrade_trade_signal_ids: set[str],
) -> list[str]:
    unresolved_ids = []
    for record in records:
        if not isinstance(record, dict) or record.get("status") not in (
            "STRATEGY_ACCEPTED",
            "ORDER_SUBMITTED",
            "PARTIALLY_FILLED",
            "UNKNOWN_IN_FLIGHT",
        ):
            continue
        signal = record.get("signal")
        signal_id = signal.get("signalId") if isinstance(signal, dict) else None
        if isinstance(signal_id, str) and signal_id not in freqtrade_trade_signal_ids:
            unresolved_ids.append(signal_id)
    return unresolved_ids


def is_valid_sbk_signal(
    signal: Any,
    *,
    now_ms: int,
    expected_exchange: str,
    expected_market: str,
    expected_pair: str,
    expected_timeframe: str,
    require_fresh: bool = True,
) -> bool:
    if not isinstance(signal, dict):
        return False

    data_quality = signal.get("dataQuality")
    entry_conditions = signal.get("entryConditions")
    risk_limits = signal.get("riskLimits")
    authorization = signal.get("authorization")
    if not all(isinstance(section, dict) for section in (data_quality, entry_conditions, risk_limits, authorization)):
        return False
    is_dry_run_fixture = (
        isinstance(entry_conditions.get("setupType"), str)
        and entry_conditions["setupType"].startswith(DRY_RUN_FIXTURE_SETUP_PREFIX)
    )
    maximum_signal_age_ms = 55_000 if is_dry_run_fixture else 15_000
    maximum_data_age_ms = 55_000 if is_dry_run_fixture else 15_000

    decision_id = signal.get("decisionId")
    signal_id = signal.get("signalId")
    if (
        not isinstance(decision_id, str)
        or not isinstance(signal_id, str)
        or not _SIGNAL_ID_PATTERN.fullmatch(decision_id)
        or signal_id != decision_id
    ):
        return False

    generated_at_ms = signal.get("generatedAtMs")
    expires_at_ms = signal.get("expiresAtMs")
    observed_at_ms = data_quality.get("observedAtMs")
    max_age_ms = data_quality.get("maxAgeMs")
    snapshot_timestamp_ms = authorization.get("snapshotTimestampMs")
    evaluated_at_ms = authorization.get("evaluatedAtMs")
    if any(
        not isinstance(value, int) or isinstance(value, bool)
        for value in (
            generated_at_ms,
            expires_at_ms,
            observed_at_ms,
            max_age_ms,
            snapshot_timestamp_ms,
            evaluated_at_ms,
        )
    ):
        return False

    if (
        signal.get("contractVersion") != SIGNAL_CONTRACT_VERSION
        or authorization.get("contractVersion") != ENTRY_AUTHORIZATION_VERSION
        or authorization.get("decisionId") != decision_id
        or authorization.get("holdingHorizonMinutes") != entry_conditions.get("maxHoldingMinutes")
        or not isinstance(authorization.get("holdingHorizonMinutes"), int)
        or isinstance(authorization.get("holdingHorizonMinutes"), bool)
        or not 1 <= authorization["holdingHorizonMinutes"] <= 60
        or authorization.get("timeframe") != signal.get("timeframe")
        or authorization.get("direction") != signal.get("direction")
        or authorization.get("snapshotTimestampMs") != observed_at_ms
        or snapshot_timestamp_ms > now_ms + 1_000
        or (require_fresh and now_ms - snapshot_timestamp_ms > maximum_data_age_ms)
        or evaluated_at_ms < snapshot_timestamp_ms
        or evaluated_at_ms > now_ms + 1_000
        or (require_fresh and now_ms - evaluated_at_ms > maximum_signal_age_ms)
        or not isinstance(authorization.get("snapshotId"), str)
        or not re.fullmatch(r"SNP_[A-Za-z0-9:_-]{1,128}", authorization["snapshotId"])
        or not isinstance(signal.get("exchange"), str)
        or signal["exchange"].lower() != expected_exchange.lower()
        or signal.get("market") != expected_market
        or signal.get("pair") != expected_pair
        or not isinstance(signal.get("pair"), str)
        or not _PAIR_PATTERN.fullmatch(signal["pair"])
        or signal.get("timeframe") != expected_timeframe
        or not isinstance(signal.get("timeframe"), str)
        or not _TIMEFRAME_PATTERN.fullmatch(signal["timeframe"])
        or signal.get("direction") not in ("LONG", "SHORT")
        or (signal["direction"] == "SHORT" and signal["market"] == "spot")
        or generated_at_ms > now_ms + 1_000
        or (require_fresh and now_ms - generated_at_ms > maximum_signal_age_ms)
        or (require_fresh and expires_at_ms <= now_ms)
        or expires_at_ms <= generated_at_ms
        or expires_at_ms - generated_at_ms > 120_000
        or data_quality.get("status") != "LIVE"
        or not isinstance(data_quality.get("source"), str)
        or not data_quality["source"].strip()
        or observed_at_ms > now_ms + 1_000
        or (require_fresh and now_ms - observed_at_ms > maximum_data_age_ms)
        or not 0 < max_age_ms <= maximum_data_age_ms
        or (require_fresh and now_ms - observed_at_ms > max_age_ms)
    ):
        return False

    reference_price = signal.get("referencePrice")
    engine_score = signal.get("engineScore")
    evidence_level = signal.get("evidenceLevel", "UNCALIBRATED_HEURISTIC")
    entry_price = entry_conditions.get("entryPrice")
    stop_loss = entry_conditions.get("stopLoss")
    take_profit = entry_conditions.get("takeProfit")
    max_price_deviation_bps = entry_conditions.get("maxPriceDeviationBps")
    max_holding_minutes = entry_conditions.get("maxHoldingMinutes")
    setup_type = entry_conditions.get("setupType")
    if (
        not _positive_number(reference_price)
        or "engineScore" not in signal
        or (engine_score is not None and (not _finite_number(engine_score) or not 0 <= engine_score <= 100))
        or evidence_level != "UNCALIBRATED_HEURISTIC"
        or not _positive_number(entry_price)
        or not _positive_number(stop_loss)
        or not _positive_number(take_profit)
        or not _positive_number(max_price_deviation_bps)
        or max_price_deviation_bps > 100
        or not isinstance(max_holding_minutes, int)
        or isinstance(max_holding_minutes, bool)
        or not 1 <= max_holding_minutes <= 60
        or not isinstance(setup_type, str)
        or not setup_type.strip()
    ):
        return False

    risk_budget_pct = risk_limits.get("riskBudgetPct")
    max_stake_quote = risk_limits.get("maxStakeQuote")
    max_leverage = risk_limits.get("maxLeverage")
    if (
        not _positive_number(risk_budget_pct)
        or risk_budget_pct > 10
        or not _positive_number(max_stake_quote)
        or not _finite_number(max_leverage)
        or not 1 <= max_leverage <= 25
    ):
        return False

    if signal["direction"] == "LONG":
        if not stop_loss < entry_price < take_profit:
            return False
    elif not take_profit < entry_price < stop_loss:
        return False

    risk_distance = abs(entry_price - stop_loss)
    reward_distance = abs(take_profit - entry_price)
    entry_deviation_bps = abs(entry_price - reference_price) / reference_price * 10_000
    if reward_distance < risk_distance or entry_deviation_bps > max_price_deviation_bps:
        return False

    calculated_risk_reward = reward_distance / risk_distance
    allocated_risk = authorization.get("allocatedRiskUsd")
    if (
        not _positive_number(authorization.get("riskRewardRatio"))
        or abs(authorization["riskRewardRatio"] - calculated_risk_reward) > 0.01
        or authorization["riskRewardRatio"] < 1
        or not _positive_number(allocated_risk)
        or allocated_risk > max_stake_quote * max_leverage * risk_distance / entry_price + 0.01
    ):
        return False

    authorization_decision = authorization.get("decision")
    models = authorization.get("models")
    gates = authorization.get("gates")
    if not isinstance(models, list) or not isinstance(gates, list):
        return False
    if authorization_decision == "DRY_RUN_TEST_ONLY":
        return (
            is_dry_run_fixture
            and os.getenv("SBK1_DRY_RUN_FIXTURE_ENABLED") == "true"
            and models == []
            and authorization.get("disagreementVeto") is False
            and authorization.get("ensembleProbabilityPct") is None
        )
    if authorization_decision != "APPROVE_ENTRY" or is_dry_run_fixture:
        return False

    required_gate_ids = {
        "COUNCIL_REPORT",
        "LIVE_DATA",
        "REFERENCE_PRICE",
        "VOLATILITY",
        "EXECUTION_SPREAD",
        "TRADE_LEVELS",
        "STOP_AND_TARGET",
        "PORTFOLIO_RISK",
        "DAILY_LOSS",
        "RISK_ALLOCATION",
        "HOLDING_HORIZON",
    }
    gate_ids = []
    for gate in gates:
        if (
            not isinstance(gate, dict)
            or not isinstance(gate.get("id"), str)
            or not gate["id"]
            or gate.get("status") != "PASSED"
            or not isinstance(gate.get("reason"), str)
            or not gate["reason"].strip()
        ):
            return False
        gate_ids.append(gate["id"])
    if len(gate_ids) != len(set(gate_ids)) or not required_gate_ids.issubset(set(gate_ids)):
        return False

    if authorization.get("direction") != signal["direction"]:
        return False

    return True
