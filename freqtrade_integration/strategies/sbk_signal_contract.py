import ipaddress
import math
import re
from typing import Any
from urllib.parse import urlsplit


SIGNAL_CONTRACT_VERSION = "sbk1.freqtrade.signal.v1"
DRY_RUN_FIXTURE_SETUP_PREFIX = "DRY_RUN_E2E_FIXTURE_"
_SIGNAL_ID_PATTERN = re.compile(r"^sbk1_[a-f0-9]{32}$")
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


def is_dry_run_fixture_runtime(config: dict[str, Any], runmode: str) -> bool:
    return config.get("dry_run") is True and runmode == "dry_run"


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
    if not all(isinstance(section, dict) for section in (data_quality, entry_conditions, risk_limits)):
        return False
    is_dry_run_fixture = (
        isinstance(entry_conditions.get("setupType"), str)
        and entry_conditions["setupType"].startswith(DRY_RUN_FIXTURE_SETUP_PREFIX)
    )
    maximum_signal_age_ms = 55_000 if is_dry_run_fixture else 15_000
    maximum_data_age_ms = 55_000 if is_dry_run_fixture else 5_000

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
    if any(
        not isinstance(value, int) or isinstance(value, bool)
        for value in (generated_at_ms, expires_at_ms, observed_at_ms, max_age_ms)
    ):
        return False

    if (
        signal.get("contractVersion") != SIGNAL_CONTRACT_VERSION
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
        or expires_at_ms - generated_at_ms > 60_000
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
    stop_loss = entry_conditions.get("stopLoss")
    take_profit = entry_conditions.get("takeProfit")
    max_price_deviation_bps = entry_conditions.get("maxPriceDeviationBps")
    setup_type = entry_conditions.get("setupType")
    if (
        not _positive_number(reference_price)
        or not _positive_number(stop_loss)
        or not _positive_number(take_profit)
        or not _positive_number(max_price_deviation_bps)
        or max_price_deviation_bps > 100
        or not isinstance(setup_type, str)
        or not setup_type.strip()
    ):
        return False

    risk_budget_pct = risk_limits.get("riskBudgetPct")
    max_stake_quote = risk_limits.get("maxStakeQuote")
    max_leverage = risk_limits.get("maxLeverage")
    if (
        not _positive_number(risk_budget_pct)
        or risk_budget_pct > 1.5
        or not _positive_number(max_stake_quote)
        or not _finite_number(max_leverage)
        or not 1 <= max_leverage <= 20
    ):
        return False

    if signal["direction"] == "LONG":
        if not stop_loss < reference_price < take_profit:
            return False
    elif not take_profit < reference_price < stop_loss:
        return False

    risk_distance = abs(reference_price - stop_loss)
    reward_distance = abs(take_profit - reference_price)
    if reward_distance < risk_distance:
        return False

    return True
