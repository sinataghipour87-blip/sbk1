import logging
import math
import os
from datetime import UTC, datetime
from typing import Any

import requests
from pandas import DataFrame

from freqtrade.persistence import Trade
from freqtrade.strategy import IStrategy, stoploss_from_absolute
from sbk_signal_contract import (
    is_dry_run_fixture_runtime,
    is_valid_sbk_signal,
    orphaned_submitted_signal_ids,
    validate_bridge_url,
)


logger = logging.getLogger(__name__)


class SbkSignalStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = os.getenv("SBK1_FREQTRADE_TIMEFRAME", "15m")
    can_short = True
    process_only_new_candles = False

    minimal_roi = {"0": 100.0}
    stoploss = -0.05
    trailing_stop = False
    use_custom_stoploss = True
    use_exit_signal = True
    exit_profit_only = False

    def bot_start(self, **kwargs: Any) -> None:
        self._signals: dict[str, dict[str, Any]] = {}
        self._signal_statuses: dict[str, str] = {}
        self._signals_by_pair: dict[str, dict[str, Any]] = {}
        self._pair = os.getenv("SBK1_FREQTRADE_PAIR", "")
        try:
            self._bridge_url = validate_bridge_url(
                os.getenv("SBK1_BRIDGE_URL", "http://127.0.0.1:3000")
            )
        except ValueError as exc:
            self._bridge_url = ""
            logger.error("SBK1 signal bridge is disabled: %s", exc)
        self._bridge_token = os.getenv("SBK1_FREQTRADE_BRIDGE_TOKEN", "")
        if len(self._bridge_token) < 32:
            logger.error("SBK1 signal bridge is disabled: SBK1_FREQTRADE_BRIDGE_TOKEN must contain at least 32 characters.")
        if not self._pair:
            logger.error("SBK1 signal bridge is disabled: SBK1_FREQTRADE_PAIR must match FREQTRADE_PAIR on the SBK1 server.")

    def bot_loop_start(self, current_time: datetime, **kwargs: Any) -> None:
        self._signals = {}
        self._signal_statuses = {}
        self._signals_by_pair = {}
        runmode = getattr(self.config.get("runmode"), "value", self.config.get("runmode"))
        if not is_dry_run_fixture_runtime(self.config, runmode):
            return
        if len(self._bridge_token) < 32 or not self._pair or not self._bridge_url:
            return

        try:
            logger.debug("Polling the SBK1 bridge for dry-run fixtures for pair %s.", self._pair)
            response = requests.get(
                f"{self._bridge_url}/api/freqtrade/signals",
                headers={"Authorization": f"Bearer {self._bridge_token}"},
                params={"pair": self._pair, "timeframe": self.timeframe},
                timeout=(1.0, 2.0),
                allow_redirects=False,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or payload.get("contractVersion") != "sbk1.freqtrade.signal.v1":
                logger.error("SBK1 signal bridge returned an unsupported contract response.")
                return
            records = payload.get("signals")
            if not isinstance(records, list):
                logger.error("SBK1 signal bridge returned an invalid signal list.")
                return
            logger.debug("SBK1 bridge returned %d signal record(s).", len(records))

            submitted_signal_records = [
                record for record in records
                if isinstance(record, dict) and record.get("status") == "ORDER_SUBMITTED"
            ]
            orphaned_signal_ids: set[str] = set()
            if submitted_signal_records:
                open_trade_signal_ids = {
                    trade.enter_tag
                    for trade in Trade.get_open_trades()
                    if isinstance(trade.enter_tag, str)
                }
                orphaned_signal_ids = set(
                    orphaned_submitted_signal_ids(
                        submitted_signal_records,
                        open_trade_signal_ids,
                    )
                )
                for signal_id in orphaned_signal_ids:
                    self._post_status(
                        signal_id,
                        "CANCELLED",
                        "Freqtrade no longer reports an open trade for this submitted signal; the unfilled entry was cancelled or removed.",
                    )

            now_ms = int(current_time.timestamp() * 1000)
            configured_exchange = str(self.config.get("exchange", {}).get("name", "")).lower()
            configured_market = str(self.config.get("trading_mode", "spot")).lower()
            active_signals: dict[str, dict[str, Any]] = {}
            active_statuses: dict[str, str] = {}
            for record in records:
                signal = record.get("signal") if isinstance(record, dict) else None
                status = record.get("status") if isinstance(record, dict) else None
                if status not in ("ACCEPTED", "STRATEGY_ACCEPTED", "ORDER_SUBMITTED", "PARTIALLY_FILLED", "FILLED"):
                    continue
                if isinstance(signal, dict) and signal.get("signalId") in orphaned_signal_ids:
                    continue
                if not self._is_valid_signal(
                    signal,
                    now_ms,
                    configured_exchange,
                    configured_market,
                    require_fresh=status == "ACCEPTED",
                ):
                    if status == "ACCEPTED" and isinstance(signal, dict):
                        self._post_status(
                            signal.get("signalId"),
                            "REJECTED",
                            "Signal failed Freqtrade freshness or configuration validation.",
                        )
                    continue
                active_signals[signal["signalId"]] = signal
                active_statuses[signal["signalId"]] = status
                if status == "ACCEPTED":
                    self._signals_by_pair[signal["pair"]] = signal
            self._signals = active_signals
            self._signal_statuses = active_statuses
        except (requests.RequestException, ValueError) as exc:
            logger.error("SBK1 signal bridge poll failed; this loop will not use cached signals: %s", exc)

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[:, "enter_long"] = 0
        dataframe.loc[:, "enter_short"] = 0
        dataframe.loc[:, "enter_tag"] = ""
        if dataframe.empty:
            return dataframe

        pair = metadata.get("pair")
        signal = self._signals_by_pair.get(pair)
        if not signal or signal["timeframe"] != self.timeframe:
            return dataframe
        if not is_dry_run_fixture_runtime(
            self.config,
            getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
        ):
            return dataframe
        latest = dataframe.iloc[-1]
        price = float(latest["close"])
        if not math.isfinite(price) or price <= 0:
            self._post_status(signal["signalId"], "REJECTED", "Freqtrade candle close is invalid.")
            return dataframe
        candle_time = latest["date"]
        if isinstance(candle_time, datetime):
            candle_ms = int(candle_time.timestamp() * 1000)
            if int(datetime.now(UTC).timestamp() * 1000) - candle_ms > self._timeframe_seconds() * 2_000:
                self._post_status(signal["signalId"], "REJECTED", "Freqtrade latest candle is stale.")
                return dataframe
        drift_bps = abs(price - signal["referencePrice"]) / signal["referencePrice"] * 10_000
        if drift_bps > signal["entryConditions"]["maxPriceDeviationBps"]:
            self._post_status(signal["signalId"], "REJECTED", "Freqtrade candle price exceeded the fixture deviation limit.")
            return dataframe

        last_index = dataframe.index[-1]
        if signal["direction"] == "LONG":
            dataframe.loc[last_index, "enter_long"] = 1
        else:
            dataframe.loc[last_index, "enter_short"] = 1
        dataframe.loc[last_index, "enter_tag"] = signal["signalId"]
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[:, "exit_long"] = 0
        dataframe.loc[:, "exit_short"] = 0
        dataframe.loc[:, "exit_tag"] = ""
        return dataframe

    def confirm_trade_entry(
        self,
        pair: str,
        order_type: str,
        amount: float,
        rate: float,
        time_in_force: str,
        current_time: datetime,
        entry_tag: str | None,
        side: str,
        **kwargs: Any,
    ) -> bool:
        signal = self._signals.get(entry_tag or "")
        if (
            not is_dry_run_fixture_runtime(
                self.config,
                getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
            )
            or
            not signal
            or self._signal_statuses.get(entry_tag or "") != "ACCEPTED"
            or not self._is_valid_signal(
                signal,
                int(current_time.timestamp() * 1000),
                str(self.config.get("exchange", {}).get("name", "")).lower(),
                str(self.config.get("trading_mode", "spot")).lower(),
            )
        ):
            self._post_status(entry_tag, "REJECTED", "Signal missing, stale, or incompatible at entry confirmation.")
            return False
        if pair != signal["pair"] or side.lower() != signal["direction"].lower():
            self._post_status(entry_tag, "REJECTED", "Pair or side changed between signal validation and entry.")
            return False
        if not math.isfinite(rate) or rate <= 0:
            self._post_status(entry_tag, "REJECTED", "Freqtrade supplied an invalid entry rate.")
            return False
        drift_bps = abs(rate - signal["referencePrice"]) / signal["referencePrice"] * 10_000
        if drift_bps > signal["entryConditions"]["maxPriceDeviationBps"]:
            self._post_status(entry_tag, "REJECTED", "Entry price exceeded the signal price-deviation limit.")
            return False
        if not self._post_status(entry_tag, "STRATEGY_ACCEPTED", "Validated by SbkSignalStrategy before order submission."):
            return False
        self._signal_statuses[entry_tag or ""] = "STRATEGY_ACCEPTED"
        return True

    def check_entry_timeout(
        self,
        pair: str,
        trade: Any,
        order: Any,
        current_time: datetime,
        **kwargs: Any,
    ) -> bool:
        signal_id = getattr(trade, "enter_tag", None)
        signal = self._signals.get(signal_id or "")
        if not signal or getattr(order, "ft_order_side", "").lower() != ("sell" if trade.is_short else "buy"):
            return False
        if int(current_time.timestamp() * 1000) >= signal["expiresAtMs"]:
            self._post_status(
                signal_id,
                "CANCELLED",
                "Signal expired; Freqtrade is cancelling the unfilled entry remainder. Any partial position remains managed by Freqtrade.",
                trade_id=getattr(trade, "id", None),
            )
            return True
        amount = float(getattr(order, "amount", 0) or 0)
        filled = float(getattr(order, "filled", 0) or 0)
        if filled > 0 and amount > filled:
            self._post_status(
                signal_id,
                "PARTIALLY_FILLED",
                "Freqtrade reports an open entry order with a partial fill.",
                trade_id=getattr(trade, "id", None),
                filled_amount=filled,
                average_fill_price=float(getattr(order, "safe_price", 0) or 0) or None,
            )
        elif filled <= 0:
            self._post_status(
                signal_id,
                "ORDER_SUBMITTED",
                "Freqtrade has an open entry order awaiting a fill.",
                trade_id=getattr(trade, "id", None),
            )
        return False

    def leverage(
        self,
        pair: str,
        current_time: datetime,
        current_rate: float,
        proposed_leverage: float,
        max_leverage: float,
        entry_tag: str | None,
        side: str,
        **kwargs: Any,
    ) -> float:
        signal = self._signals.get(entry_tag or "")
        if not signal or signal["market"] == "spot":
            return 1.0
        return min(float(signal["riskLimits"]["maxLeverage"]), float(max_leverage), float(proposed_leverage))

    def custom_stake_amount(
        self,
        pair: str,
        current_time: datetime,
        current_rate: float,
        proposed_stake: float,
        min_stake: float | None,
        max_stake: float,
        leverage: float,
        entry_tag: str | None,
        side: str,
        **kwargs: Any,
    ) -> float:
        signal = self._signals.get(entry_tag or "")
        if not signal or current_rate <= 0 or max_stake <= 0:
            return 0.0
        stop_fraction = abs(current_rate - signal["entryConditions"]["stopLoss"]) / current_rate
        if not math.isfinite(stop_fraction) or stop_fraction <= 0 or leverage <= 0:
            return 0.0
        risk_budget = max_stake * signal["riskLimits"]["riskBudgetPct"] / 100
        risk_limited_stake = risk_budget / stop_fraction / leverage
        selected_stake = min(
            risk_limited_stake,
            max_stake,
            signal["riskLimits"]["maxStakeQuote"],
            proposed_stake,
        )
        if min_stake is not None and selected_stake < min_stake:
            return 0.0
        return max(0.0, selected_stake)

    def order_filled(self, pair: str, trade: Any, order: Any, current_time: datetime, **kwargs: Any) -> None:
        signal_id = getattr(trade, "enter_tag", None)
        signal = self._signals.get(signal_id or "")
        if not signal or getattr(order, "ft_order_side", "").lower() != ("sell" if trade.is_short else "buy"):
            return
        average_fill_price = float(getattr(order, "safe_price", 0) or 0)
        trade.set_custom_data("sbk_signal", signal)
        self._post_status(
            signal_id,
            "FILLED",
            "Freqtrade confirmed an entry fill.",
            trade_id=getattr(trade, "id", None),
            filled_amount=float(getattr(order, "safe_filled", 0) or getattr(order, "filled", 0) or 0),
            average_fill_price=average_fill_price if average_fill_price > 0 else None,
        )
        self._signal_statuses[signal_id] = "FILLED"

    def custom_stoploss(
        self,
        pair: str,
        trade: Any,
        current_time: datetime,
        current_rate: float,
        current_profit: float,
        after_fill: bool,
        **kwargs: Any,
    ) -> float | None:
        signal = trade.get_custom_data("sbk_signal")
        if not isinstance(signal, dict):
            signal = self._signals.get(getattr(trade, "enter_tag", "") or "")
        if not signal or current_rate <= 0:
            return None
        return stoploss_from_absolute(
            float(signal["entryConditions"]["stopLoss"]),
            current_rate,
            is_short=trade.is_short,
            leverage=trade.leverage,
        )

    def custom_exit(
        self,
        pair: str,
        trade: Any,
        current_time: datetime,
        current_rate: float,
        current_profit: float,
        **kwargs: Any,
    ) -> str | None:
        signal = trade.get_custom_data("sbk_signal")
        if not isinstance(signal, dict):
            signal = self._signals.get(getattr(trade, "enter_tag", "") or "")
        if not signal:
            return None
        target = float(signal["entryConditions"]["takeProfit"])
        if (trade.is_short and current_rate <= target) or (not trade.is_short and current_rate >= target):
            return "sbk_take_profit"
        return None

    def _is_valid_signal(
        self,
        signal: Any,
        now_ms: int,
        configured_exchange: str,
        configured_market: str,
        require_fresh: bool = True,
    ) -> bool:
        return is_valid_sbk_signal(
            signal,
            now_ms=now_ms,
            expected_exchange=configured_exchange,
            expected_market=configured_market,
            expected_pair=self._pair,
            expected_timeframe=self.timeframe,
            require_fresh=require_fresh,
        )

    def _post_status(self, signal_id: str | None, status: str, reason: str, **details: Any) -> bool:
        if not signal_id or len(self._bridge_token) < 32 or not self._bridge_url:
            return False
        try:
            response = requests.post(
                f"{self._bridge_url}/api/freqtrade/signals/{signal_id}/status",
                headers={"Authorization": f"Bearer {self._bridge_token}"},
                json={
                    "status": status,
                    "reason": reason,
                    **{key: value for key, value in details.items() if value is not None},
                },
                timeout=(1.0, 2.0),
                allow_redirects=False,
            )
            response.raise_for_status()
            return True
        except (requests.RequestException, ValueError) as exc:
            logger.error("Could not persist Freqtrade signal lifecycle status %s: %s", status, exc)
            return False

    def _timeframe_seconds(self) -> int:
        unit = self.timeframe[-1]
        quantity = int(self.timeframe[:-1])
        return quantity * {"m": 60, "h": 3600, "d": 86400, "w": 604800}[unit]
