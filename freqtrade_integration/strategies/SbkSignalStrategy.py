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
    DRY_RUN_COLLECTION_MODE,
    is_dry_run_collection_runtime,
    is_dry_run_fixture_runtime,
    is_valid_sbk_signal,
    format_entry_tag,
    signal_id_from_entry_tag,
    unresolved_inflight_signal_ids,
    validate_bridge_url,
)


logger = logging.getLogger(__name__)
INFORMATIVE_TIMEFRAMES = ("1m", "5m", "1h", "4h")


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
        self._last_queue_poll_signature: tuple[Any, ...] | None = None
        self._last_queue_poll_logged_at_ms: int | None = None
        self._market_snapshot_last_publish_ms = 0
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

    def informative_pairs(self) -> list[tuple[str, str]]:
        pair = os.getenv("SBK1_FREQTRADE_PAIR", "").strip()
        if not pair:
            return []
        return [
            (pair, timeframe)
            for timeframe in INFORMATIVE_TIMEFRAMES
            if timeframe != self.timeframe
        ]

    def _log_queue_poll(
        self,
        current_time: datetime,
        http_status: int | str,
        signals_returned: int,
        signature: tuple[Any, ...],
    ) -> bool:
        timestamp_ms = int(current_time.timestamp() * 1000)
        previous_signature = getattr(self, "_last_queue_poll_signature", None)
        previous_log_ms = getattr(self, "_last_queue_poll_logged_at_ms", None)
        if (
            signature == previous_signature
            and previous_log_ms is not None
            and timestamp_ms - previous_log_ms < 30_000
        ):
            return False
        logger.info(
            "SBK1 queue poll timestamp=%s http_status=%s signals_returned=%d",
            current_time.astimezone(UTC).isoformat(timespec="milliseconds"),
            http_status,
            signals_returned,
        )
        self._last_queue_poll_signature = signature
        self._last_queue_poll_logged_at_ms = timestamp_ms
        return True

    def bot_loop_start(self, current_time: datetime, **kwargs: Any) -> None:
        self._signals = {}
        self._signal_statuses = {}
        self._signals_by_pair = {}
        runmode = getattr(self.config.get("runmode"), "value", self.config.get("runmode"))
        if runmode in ("dry_run", "live"):
            self._publish_market_snapshot(current_time)
        if not is_dry_run_fixture_runtime(self.config, runmode):
            return
        if len(self._bridge_token) < 32 or not self._pair or not self._bridge_url:
            return

        response = None
        poll_logged = False
        try:
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
                response_status = getattr(response, "status_code", "unknown")
                poll_logged = self._log_queue_poll(
                    current_time,
                    response_status if isinstance(response_status, int) else "unknown",
                    0,
                    (response_status, "unsupported_contract"),
                )
                if poll_logged:
                    logger.error("SBK1 signal bridge returned an unsupported contract response.")
                return
            records = payload.get("signals")
            if not isinstance(records, list):
                response_status = getattr(response, "status_code", "unknown")
                poll_logged = self._log_queue_poll(
                    current_time,
                    response_status if isinstance(response_status, int) else "unknown",
                    0,
                    (response_status, "invalid_signal_list"),
                )
                if poll_logged:
                    logger.error("SBK1 signal bridge returned an invalid signal list.")
                return
            response_status = getattr(response, "status_code", "unknown")
            poll_signature = []
            for record in records:
                if not isinstance(record, dict):
                    poll_signature.append((None, type(record).__name__))
                    continue
                signal = record.get("signal")
                signal_id = signal.get("signalId") if isinstance(signal, dict) else None
                poll_signature.append((signal_id, record.get("status")))
            poll_logged = self._log_queue_poll(
                current_time,
                response_status if isinstance(response_status, int) else "unknown",
                len(records),
                (response_status, tuple(poll_signature)),
            )

            inflight_signal_records = [
                record for record in records
                if isinstance(record, dict)
                and record.get("status") in ("STRATEGY_ACCEPTED", "ORDER_SUBMITTED", "PARTIALLY_FILLED")
            ]
            unresolved_signal_ids: set[str] = set()
            trades_by_signal_id: dict[str, Any] = {}
            if inflight_signal_records:
                trades_by_signal_id = {
                    signal_id_from_entry_tag(trade.enter_tag): trade
                    for trade in Trade.get_trades_proxy()
                    if signal_id_from_entry_tag(trade.enter_tag)
                }
                unresolved_signal_ids = set(
                    unresolved_inflight_signal_ids(
                        inflight_signal_records,
                        set(trades_by_signal_id),
                    )
                )
                for signal_id in unresolved_signal_ids:
                    logger.info(
                        "SBK1 signal decision=skip signal_id=%s reason=unmatched_inflight persisted_signal_ids=%s",
                        signal_id,
                        sorted(trades_by_signal_id),
                    )
                    self._post_status(
                        signal_id,
                        "UNKNOWN_IN_FLIGHT",
                        "The signal was accepted for order submission but no matching Freqtrade trade is persisted. It is quarantined and will not be submitted again.",
                    )
                for record in inflight_signal_records:
                    signal = record.get("signal")
                    signal_id = signal.get("signalId") if isinstance(signal, dict) else None
                    trade = trades_by_signal_id.get(signal_id)
                    if not isinstance(signal_id, str) or not trade:
                        continue
                    open_entry_orders = [
                        order for order in trade.open_orders
                        if order.ft_order_side == trade.entry_side
                    ]
                    has_filled_entry = bool(trade.select_filled_orders(trade.entry_side))
                    partial_open_fill = any(float(order.safe_filled or 0) > 0 for order in open_entry_orders)
                    if open_entry_orders:
                        reconciled_status = "PARTIALLY_FILLED" if partial_open_fill else "ORDER_SUBMITTED"
                    elif has_filled_entry or float(getattr(trade, "amount", 0) or 0) > 0:
                        reconciled_status = "FILLED"
                    else:
                        reconciled_status = "UNKNOWN_IN_FLIGHT"
                    if reconciled_status == "UNKNOWN_IN_FLIGHT":
                        unresolved_signal_ids.add(signal_id)
                    if reconciled_status != record.get("status"):
                        status_updated = self._post_status(
                            signal_id,
                            reconciled_status,
                            "Reconciled signal lifecycle from the persisted Freqtrade trade and order records.",
                            trade_id=getattr(trade, "id", None),
                            filled_amount=float(getattr(trade, "amount", 0) or 0),
                            average_fill_price=float(getattr(trade, "open_rate", 0) or 0) or None,
                        )
                        if status_updated:
                            record["status"] = reconciled_status

            now_ms = int(current_time.timestamp() * 1000)
            configured_exchange = str(self.config.get("exchange", {}).get("name", "")).lower()
            configured_market = str(self.config.get("trading_mode", "spot")).lower()
            active_signals: dict[str, dict[str, Any]] = {}
            active_statuses: dict[str, str] = {}
            for record in records:
                signal = record.get("signal") if isinstance(record, dict) else None
                status = record.get("status") if isinstance(record, dict) else None
                signal_id = signal.get("signalId") if isinstance(signal, dict) else None
                if status not in ("ACCEPTED", "STRATEGY_ACCEPTED", "ORDER_SUBMITTED", "PARTIALLY_FILLED", "FILLED"):
                    logger.info(
                        "SBK1 signal decision=skip signal_id=%s status=%s accepted_statuses=%s",
                        signal_id,
                        status,
                        "ACCEPTED,STRATEGY_ACCEPTED,ORDER_SUBMITTED,PARTIALLY_FILLED,FILLED",
                    )
                    continue
                if signal_id in unresolved_signal_ids:
                    logger.info(
                        "SBK1 signal decision=skip signal_id=%s status=%s unresolved_inflight=true persisted_signal_ids=%s",
                        signal_id,
                        status,
                        sorted(trades_by_signal_id),
                    )
                    continue
                signal_valid = self._is_valid_signal(
                    signal,
                    now_ms,
                    configured_exchange,
                    configured_market,
                    require_fresh=status == "ACCEPTED",
                )
                if not signal_valid:
                    logger.info(
                        "SBK1 signal decision=%s signal_id=%s status=%s valid=%s "
                        "pair=%s expected_pair=%s exchange=%s expected_exchange=%s "
                        "market=%s expected_market=%s timeframe=%s expected_timeframe=%s "
                        "now_ms=%s generated_at_ms=%s expires_at_ms=%s require_fresh=%s",
                        "reject" if status == "ACCEPTED" else "skip",
                        signal_id,
                        status,
                        signal_valid,
                        signal.get("pair") if isinstance(signal, dict) else None,
                        self._pair,
                        signal.get("exchange") if isinstance(signal, dict) else None,
                        configured_exchange,
                        signal.get("market") if isinstance(signal, dict) else None,
                        configured_market,
                        signal.get("timeframe") if isinstance(signal, dict) else None,
                        self.timeframe,
                        now_ms,
                        signal.get("generatedAtMs") if isinstance(signal, dict) else None,
                        signal.get("expiresAtMs") if isinstance(signal, dict) else None,
                        status == "ACCEPTED",
                    )
                    if status == "ACCEPTED" and isinstance(signal, dict):
                        self._post_status(
                            signal.get("signalId"),
                            "REJECTED",
                            "Signal failed Freqtrade freshness or configuration validation.",
                        )
                    continue
                logger.info(
                    "SBK1 signal decision=%s signal_id=%s status=%s pair=%s expected_pair=%s "
                    "exchange=%s expected_exchange=%s market=%s expected_market=%s "
                    "timeframe=%s expected_timeframe=%s now_ms=%s generated_at_ms=%s "
                    "expires_at_ms=%s require_fresh=%s",
                    "claim" if status == "ACCEPTED" else "retain",
                    signal_id,
                    status,
                    signal["pair"],
                    self._pair,
                    signal["exchange"],
                    configured_exchange,
                    signal["market"],
                    configured_market,
                    signal["timeframe"],
                    self.timeframe,
                    now_ms,
                    signal["generatedAtMs"],
                    signal["expiresAtMs"],
                    status == "ACCEPTED",
                )
                active_signals[signal["signalId"]] = signal
                active_statuses[signal["signalId"]] = status
                if status == "ACCEPTED":
                    self._signals_by_pair[signal["pair"]] = signal
            self._signals = active_signals
            self._signal_statuses = active_statuses
        except requests.HTTPError as exc:
            response = exc.response
            payload = None
            if response is not None:
                try:
                    payload = response.json()
                except ValueError:
                    payload = None
            response_status = response.status_code if response is not None else "unavailable"
            poll_logged = self._log_queue_poll(
                current_time,
                response_status if isinstance(response_status, int) else "unavailable",
                0,
                (response_status, "http_error"),
            )
            if isinstance(payload, dict) and poll_logged:
                logger.warning(
                    "SBK1 signal delivery blocked (HTTP %s, stage=%s, code=%s, correlation_id=%s): %s",
                    response.status_code if response is not None else "unknown",
                    payload.get("stage", "unknown"),
                    payload.get("code", "unknown"),
                    payload.get("correlationId", "unavailable"),
                    payload.get("error", str(exc)),
                )
            elif poll_logged:
                logger.error("SBK1 signal bridge poll failed: %s", exc)
        except (requests.RequestException, ValueError) as exc:
            if not poll_logged:
                response_status = getattr(response, "status_code", "unavailable")
                poll_logged = self._log_queue_poll(
                    current_time,
                    response_status if isinstance(response_status, int) else "unavailable",
                    0,
                    (response_status, type(exc).__name__),
                )
            if poll_logged:
                logger.error("SBK1 signal bridge poll failed; this loop will not use cached signals: %s", exc)

    def _publish_market_snapshot(self, current_time: datetime) -> bool:
        bridge_token = getattr(self, "_bridge_token", "")
        bridge_url = getattr(self, "_bridge_url", "")
        pair = getattr(self, "_pair", "")
        data_provider = getattr(self, "dp", None)
        now_ms = int(current_time.timestamp() * 1000)
        if (
            len(bridge_token) < 32 or not bridge_url or not pair or data_provider is None
            or now_ms - getattr(self, "_market_snapshot_last_publish_ms", 0) < 10_000
        ):
            return False

        configured_exchange = str(self.config.get("exchange", {}).get("name", "")).lower()
        market = str(self.config.get("trading_mode", "spot")).lower()
        if not configured_exchange or market not in ("spot", "futures"):
            logger.error("Freqtrade market snapshot was not published: exchange or market configuration is invalid.")
            return False

        try:
            candles = self._snapshot_candles(data_provider, pair, self.timeframe, now_ms)
            if not candles:
                raise ValueError("DataProvider returned no completed candles for the configured pair and timeframe.")
            additional_candles = {
                timeframe: self._snapshot_candles(data_provider, pair, timeframe, now_ms)
                for timeframe in INFORMATIVE_TIMEFRAMES
                if timeframe != self.timeframe
            }
            ticker = self._snapshot_ticker(data_provider, pair)
            order_book = self._snapshot_order_book(data_provider, pair, now_ms)
            funding_rate = self._snapshot_funding_rate(data_provider, pair, market, now_ms)
            generated_at_ms = int(datetime.now(UTC).timestamp() * 1000)
            payload = {
                "contractVersion": "sbk1.freqtrade.market-snapshot.v3",
                "source": "freqtrade.dataprovider",
                "exchange": configured_exchange,
                "market": market,
                "pair": pair,
                "timeframe": self.timeframe,
                "generatedAtMs": generated_at_ms,
                "candles": candles,
                "additionalCandles": additional_candles,
                "ticker": ticker,
                "orderBook": order_book,
                "fundingRate": funding_rate,
            }
            response = requests.post(
                f"{bridge_url}/api/freqtrade/market-snapshot",
                headers={"Authorization": f"Bearer {bridge_token}"},
                json=payload,
                timeout=(1.0, 2.0),
                allow_redirects=False,
            )
            response.raise_for_status()
            self._market_snapshot_last_publish_ms = generated_at_ms
            return True
        except (requests.RequestException, ValueError, TypeError, AttributeError) as exc:
            logger.error("Freqtrade market snapshot push failed; no market data was cached by this strategy: %s", exc)
            return False
        except Exception:
            logger.exception("Unexpected failure while building the Freqtrade market snapshot.")
            return False

    def _snapshot_candles(
        self,
        data_provider: Any,
        pair: str,
        timeframe: str,
        now_ms: int,
    ) -> list[dict[str, Any]] | None:
        try:
            dataframe = data_provider.get_pair_dataframe(pair, timeframe)
        except Exception as exc:
            logger.warning("Freqtrade DataProvider candles are unavailable for %s/%s: %s", pair, timeframe, exc)
            return None
        if dataframe is None or dataframe.empty:
            logger.warning("Freqtrade DataProvider returned no candles for %s/%s.", pair, timeframe)
            return None

        timeframe_ms = self._timeframe_seconds_for(timeframe) * 1000
        candles = []
        for row in dataframe.tail(500).itertuples(index=False):
            candle_time = getattr(row, "date", None)
            if not isinstance(candle_time, datetime):
                logger.warning("Freqtrade DataProvider returned a candle without a datetime for %s/%s.", pair, timeframe)
                return None
            timestamp_ms = int(candle_time.timestamp() * 1000)
            if timestamp_ms + timeframe_ms > now_ms:
                continue
            candle = {
                "timestampMs": timestamp_ms,
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": float(row.volume),
            }
            if (
                not all(math.isfinite(candle[key]) for key in ("open", "high", "low", "close", "volume"))
                or min(candle["open"], candle["high"], candle["low"], candle["close"]) <= 0
                or candle["volume"] < 0
                or candle["high"] < max(candle["open"], candle["close"], candle["low"])
                or candle["low"] > min(candle["open"], candle["close"], candle["high"])
            ):
                logger.warning("Freqtrade DataProvider returned invalid OHLCV for %s/%s.", pair, timeframe)
                return None
            candles.append(candle)
        if not candles:
            logger.warning("Freqtrade DataProvider has no completed candles for %s/%s.", pair, timeframe)
            return None
        return candles

    def _snapshot_ticker(self, data_provider: Any, pair: str) -> dict[str, Any] | None:
        try:
            ticker = data_provider.ticker(pair)
        except Exception as exc:
            logger.warning("Freqtrade DataProvider ticker is unavailable for %s: %s", pair, exc)
            return None
        if not isinstance(ticker, dict):
            logger.warning("Freqtrade DataProvider returned an invalid ticker for %s.", pair)
            return None
        exchange_timestamp_ms = ticker.get("timestamp")
        if (
            not isinstance(exchange_timestamp_ms, (int, float))
            or isinstance(exchange_timestamp_ms, bool)
            or not math.isfinite(exchange_timestamp_ms)
        ):
            raw_datetime = ticker.get("datetime")
            if isinstance(raw_datetime, str):
                try:
                    parsed_datetime = datetime.fromisoformat(raw_datetime.replace("Z", "+00:00"))
                    if parsed_datetime.tzinfo is not None:
                        exchange_timestamp_ms = int(parsed_datetime.timestamp() * 1000)
                except ValueError:
                    pass
        last = ticker.get("last")
        valid_last = (
            isinstance(last, (int, float))
            and not isinstance(last, bool)
            and math.isfinite(last)
            and last > 0
        )
        if not valid_last:
            logger.warning(
                "Freqtrade DataProvider ticker has no valid last price for %s; ticker remains unavailable.",
                pair,
            )
            return None
        if (
            not isinstance(exchange_timestamp_ms, (int, float))
            or isinstance(exchange_timestamp_ms, bool)
            or not math.isfinite(exchange_timestamp_ms)
        ):
            exchange_timestamp_ms = None
            logger.warning(
                "Freqtrade DataProvider ticker has no exchange timestamp for %s; "
                "freshness is based on local retrieval time only.",
                pair,
            )
        else:
            exchange_timestamp_ms = int(exchange_timestamp_ms)
        retrieved_at_ms = int(datetime.now(UTC).timestamp() * 1000)
        if (
            exchange_timestamp_ms is not None
            and (
                exchange_timestamp_ms > retrieved_at_ms + 1_000
                or retrieved_at_ms - exchange_timestamp_ms > 5_000
            )
        ):
            logger.warning("Freqtrade DataProvider ticker is stale for %s.", pair)
            return None
        bid = ticker.get("bid")
        ask = ticker.get("ask")
        return {
            "exchangeTimestampMs": exchange_timestamp_ms,
            "retrievedAtMs": retrieved_at_ms,
            "last": float(last),
            "bid": float(bid) if isinstance(bid, (int, float)) and not isinstance(bid, bool) and math.isfinite(bid) and bid > 0 else None,
            "ask": float(ask) if isinstance(ask, (int, float)) and not isinstance(ask, bool) and math.isfinite(ask) and ask > 0 else None,
            "markPrice": self._first_positive(ticker, ("mark", "markPrice")),
            "indexPrice": self._first_positive(ticker, ("indexPrice", "index")),
        }

    def _snapshot_funding_rate(
        self,
        data_provider: Any,
        pair: str,
        market: str,
        now_ms: int,
    ) -> dict[str, Any] | None:
        if market != "futures":
            return None
        try:
            funding = data_provider.funding_rate(pair)
        except Exception as exc:
            logger.warning("Freqtrade DataProvider funding rate is unavailable for %s: %s", pair, exc)
            return None
        if not isinstance(funding, dict):
            logger.warning("Freqtrade DataProvider returned an invalid funding rate for %s.", pair)
            return None
        rate = funding.get("fundingRate")
        if not isinstance(rate, (int, float)) or isinstance(rate, bool) or not math.isfinite(rate):
            logger.warning("Freqtrade DataProvider funding rate has no finite value for %s.", pair)
            return None
        next_funding_at = funding.get("fundingTimestamp")
        return {
            "retrievedAtMs": now_ms,
            "rate": float(rate),
            "nextFundingAtMs": int(next_funding_at)
            if isinstance(next_funding_at, (int, float)) and not isinstance(next_funding_at, bool)
            and math.isfinite(next_funding_at) and next_funding_at > 0
            else None,
        }

    def _snapshot_order_book(self, data_provider: Any, pair: str, now_ms: int) -> dict[str, Any] | None:
        try:
            order_book = data_provider.orderbook(pair, 20)
        except Exception as exc:
            logger.warning("Freqtrade DataProvider order book is unavailable for %s: %s", pair, exc)
            return None
        if not isinstance(order_book, dict):
            logger.warning("Freqtrade DataProvider returned an invalid order book for %s.", pair)
            return None
        timestamp_ms = order_book.get("timestamp")
        bids = order_book.get("bids")
        asks = order_book.get("asks")
        if (
            not isinstance(timestamp_ms, (int, float)) or isinstance(timestamp_ms, bool)
            or not math.isfinite(timestamp_ms) or not isinstance(bids, list) or not isinstance(asks, list)
        ):
            logger.warning("Freqtrade DataProvider order book has no valid timestamp or levels for %s.", pair)
            return None
        timestamp_ms = int(timestamp_ms)
        if timestamp_ms > now_ms + 1_000 or now_ms - timestamp_ms > 15_000:
            logger.warning("Freqtrade DataProvider order book is stale for %s.", pair)
            return None

        def levels(values: list[Any]) -> list[dict[str, float]]:
            result = []
            for value in values[:20]:
                if not isinstance(value, (list, tuple)) or len(value) < 2:
                    raise ValueError("DataProvider returned an invalid order book level.")
                price, amount = value[0], value[1]
                if (
                    not isinstance(price, (int, float)) or isinstance(price, bool)
                    or not math.isfinite(price) or price <= 0
                    or not isinstance(amount, (int, float)) or isinstance(amount, bool)
                    or not math.isfinite(amount) or amount <= 0
                ):
                    raise ValueError("DataProvider returned a non-positive or non-finite order book level.")
                result.append({"price": float(price), "amount": float(amount)})
            return result

        try:
            bid_levels = levels(bids)
            ask_levels = levels(asks)
        except ValueError as exc:
            logger.warning("Freqtrade DataProvider order book is invalid for %s: %s", pair, exc)
            return None
        if not bid_levels or not ask_levels or bid_levels[0]["price"] >= ask_levels[0]["price"]:
            logger.warning("Freqtrade DataProvider order book is empty or crossed for %s.", pair)
            return None
        return {"timestampMs": timestamp_ms, "bids": bid_levels, "asks": ask_levels}

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
        if not signal:
            return dataframe
        if signal["timeframe"] != self.timeframe:
            logger.info(
                "SBK1 signal decision=skip signal_id=%s timeframe=%s expected_timeframe=%s",
                signal.get("signalId"),
                signal["timeframe"],
                self.timeframe,
            )
            return dataframe
        if not is_dry_run_fixture_runtime(
            self.config,
            getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
        ):
            logger.info(
                "SBK1 signal decision=skip signal_id=%s reason=runtime_not_dry_run dry_run=%s "
                "demo_trading=%s force_entry_enable=%s runmode=%s",
                signal["signalId"],
                self.config.get("dry_run"),
                self.config.get("demo_trading"),
                self.config.get("force_entry_enable"),
                getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
            )
            return dataframe
        if signal.get("collectionMode") == DRY_RUN_COLLECTION_MODE and not is_dry_run_collection_runtime(
            self.config,
            getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
        ):
            logger.info(
                "SBK1 signal decision=reject signal_id=%s reason=unsafe_collection_runtime "
                "dry_run=%s demo_trading=%s force_entry_enable=%s",
                signal["signalId"],
                self.config.get("dry_run"),
                self.config.get("demo_trading"),
                self.config.get("force_entry_enable"),
            )
            self._post_status(
                signal["signalId"],
                "REJECTED",
                "Dry-run collection requires dry_run=true, demo_trading=false, and force_entry_enable=false.",
            )
            return dataframe
        latest = dataframe.iloc[-1]
        price = float(latest["close"])
        if not math.isfinite(price) or price <= 0:
            logger.info(
                "SBK1 signal decision=reject signal_id=%s reason=invalid_candle_price price=%s finite=%s positive=%s",
                signal["signalId"],
                price,
                math.isfinite(price),
                price > 0,
            )
            self._post_status(signal["signalId"], "REJECTED", "Freqtrade candle close is invalid.")
            return dataframe
        candle_time = latest["date"]
        if isinstance(candle_time, datetime):
            candle_ms = int(candle_time.timestamp() * 1000)
            now_ms = int(datetime.now(UTC).timestamp() * 1000)
            candle_age_ms = now_ms - candle_ms
            max_candle_age_ms = self._timeframe_seconds() * 2_000
            if candle_age_ms > max_candle_age_ms:
                logger.info(
                    "SBK1 signal decision=reject signal_id=%s reason=stale_candle now_ms=%s "
                    "candle_ms=%s candle_age_ms=%s max_candle_age_ms=%s",
                    signal["signalId"],
                    now_ms,
                    candle_ms,
                    candle_age_ms,
                    max_candle_age_ms,
                )
                self._post_status(signal["signalId"], "REJECTED", "Freqtrade latest candle is stale.")
                return dataframe
        drift_bps = abs(price - signal["referencePrice"]) / signal["referencePrice"] * 10_000
        max_deviation_bps = signal["entryConditions"]["maxPriceDeviationBps"]
        if drift_bps > max_deviation_bps:
            logger.info(
                "SBK1 signal decision=reject signal_id=%s reason=candle_price_deviation "
                "price=%s reference_price=%s drift_bps=%.6f max_deviation_bps=%s",
                signal["signalId"],
                price,
                signal["referencePrice"],
                drift_bps,
                max_deviation_bps,
            )
            self._post_status(signal["signalId"], "REJECTED", "Freqtrade candle price exceeded the fixture deviation limit.")
            return dataframe

        logger.info(
            "SBK1 signal decision=claim signal_id=%s pair=%s expected_pair=%s timeframe=%s "
            "expected_timeframe=%s price=%s reference_price=%s drift_bps=%.6f max_deviation_bps=%s",
            signal["signalId"],
            pair,
            signal["pair"],
            self.timeframe,
            signal["timeframe"],
            price,
            signal["referencePrice"],
            drift_bps,
            max_deviation_bps,
        )
        last_index = dataframe.index[-1]
        if signal["direction"] == "LONG":
            dataframe.loc[last_index, "enter_long"] = 1
        else:
            dataframe.loc[last_index, "enter_short"] = 1
        dataframe.loc[last_index, "enter_tag"] = format_entry_tag(signal)
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
        signal_id = signal_id_from_entry_tag(entry_tag)
        signal = self._signals.get(signal_id or "")
        if (
            not is_dry_run_fixture_runtime(
                self.config,
                getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
            )
            or (
                signal
                and signal.get("collectionMode") == DRY_RUN_COLLECTION_MODE
                and not is_dry_run_collection_runtime(
                    self.config,
                    getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
                )
            )
            or
            not signal
            or self._signal_statuses.get(signal_id or "") != "ACCEPTED"
            or not self._is_valid_signal(
                signal,
                int(current_time.timestamp() * 1000),
                str(self.config.get("exchange", {}).get("name", "")).lower(),
                str(self.config.get("trading_mode", "spot")).lower(),
            )
        ):
            logger.info(
                "SBK1 signal decision=reject signal_id=%s reason=entry_validation "
                "dry_run=%s demo_trading=%s force_entry_enable=%s runmode=%s "
                "signal_found=%s status=%s expected_status=ACCEPTED pair=%s expected_pair=%s "
                "exchange=%s market=%s timeframe=%s current_time=%s generated_at_ms=%s expires_at_ms=%s",
                signal_id,
                self.config.get("dry_run"),
                self.config.get("demo_trading"),
                self.config.get("force_entry_enable"),
                getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
                bool(signal),
                self._signal_statuses.get(signal_id or ""),
                pair,
                signal.get("pair") if signal else None,
                signal.get("exchange") if signal else None,
                signal.get("market") if signal else None,
                signal.get("timeframe") if signal else None,
                current_time.astimezone(UTC).isoformat(timespec="milliseconds"),
                signal.get("generatedAtMs") if signal else None,
                signal.get("expiresAtMs") if signal else None,
            )
            self._post_status(signal_id, "REJECTED", "Signal missing, stale, or incompatible at entry confirmation.")
            return False
        if pair != signal["pair"] or side.lower() != signal["direction"].lower():
            logger.info(
                "SBK1 signal decision=reject signal_id=%s reason=pair_or_side_mismatch "
                "pair=%s expected_pair=%s side=%s expected_side=%s",
                signal_id,
                pair,
                signal["pair"],
                side.lower(),
                signal["direction"].lower(),
            )
            self._post_status(signal_id, "REJECTED", "Pair or side changed between signal validation and entry.")
            return False
        if not math.isfinite(rate) or rate <= 0:
            logger.info(
                "SBK1 signal decision=reject signal_id=%s reason=invalid_entry_rate rate=%s finite=%s positive=%s",
                signal_id,
                rate,
                math.isfinite(rate),
                rate > 0,
            )
            self._post_status(signal_id, "REJECTED", "Freqtrade supplied an invalid entry rate.")
            return False
        drift_bps = abs(rate - signal["referencePrice"]) / signal["referencePrice"] * 10_000
        if drift_bps > signal["entryConditions"]["maxPriceDeviationBps"]:
            logger.info(
                "SBK1 signal decision=reject signal_id=%s reason=entry_price_deviation "
                "rate=%s reference_price=%s drift_bps=%.6f max_deviation_bps=%s",
                signal_id,
                rate,
                signal["referencePrice"],
                drift_bps,
                signal["entryConditions"]["maxPriceDeviationBps"],
            )
            self._post_status(signal_id, "REJECTED", "Entry price exceeded the signal price-deviation limit.")
            return False
        if signal.get("collectionMode") == DRY_RUN_COLLECTION_MODE:
            open_trade_count = Trade.get_open_trade_count()
            if open_trade_count != 0:
                logger.info(
                    "SBK1 signal decision=reject signal_id=%s reason=open_trade_limit "
                    "open_trade_count=%s max_open_trades=1 expected_open_trade_count=0",
                    signal_id,
                    open_trade_count,
                )
                self._post_status(
                    signal_id,
                    "REJECTED",
                    "Dry-run collection permits at most one open Freqtrade trade.",
                )
                return False
        if not self._post_status(signal_id, "STRATEGY_ACCEPTED", "Validated by SbkSignalStrategy before order submission."):
            logger.info(
                "SBK1 signal decision=reject signal_id=%s reason=status_persist_failed requested_status=STRATEGY_ACCEPTED",
                signal_id,
            )
            return False
        logger.info(
            "SBK1 signal decision=claim signal_id=%s status=STRATEGY_ACCEPTED order_type=%s "
            "amount=%s rate=%s side=%s time_in_force=%s",
            signal_id,
            order_type,
            amount,
            rate,
            side,
            time_in_force,
        )
        self._signal_statuses[signal_id or ""] = "STRATEGY_ACCEPTED"
        return True

    def check_entry_timeout(
        self,
        pair: str,
        trade: Any,
        order: Any,
        current_time: datetime,
        **kwargs: Any,
    ) -> bool:
        signal_id = signal_id_from_entry_tag(getattr(trade, "enter_tag", None))
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
            trade.set_custom_data("sbk_signal", signal)
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
        signal = self._signals.get(signal_id_from_entry_tag(entry_tag) or "")
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
        signal_id = signal_id_from_entry_tag(entry_tag)
        signal = self._signals.get(signal_id or "")
        if not signal or current_rate <= 0 or max_stake <= 0:
            logger.info(
                "SBK1 signal decision=stake-zero signal_id=%s reason=missing_signal_or_nonpositive_input "
                "signal_found=%s pair=%s current_rate=%s current_rate_positive=%s "
                "max_stake=%s max_stake_positive=%s min_stake=%s proposed_stake=%s",
                signal_id,
                bool(signal),
                pair,
                current_rate,
                current_rate > 0,
                max_stake,
                max_stake > 0,
                min_stake,
                proposed_stake,
            )
            return 0.0
        stop_fraction = abs(current_rate - signal["entryConditions"]["stopLoss"]) / current_rate
        if not math.isfinite(stop_fraction) or stop_fraction <= 0 or leverage <= 0:
            logger.info(
                "SBK1 signal decision=stake-zero signal_id=%s reason=invalid_risk_inputs "
                "current_rate=%s stop_loss=%s stop_fraction=%.9f finite=%s positive=%s "
                "leverage=%s leverage_positive=%s",
                signal_id,
                current_rate,
                signal["entryConditions"]["stopLoss"],
                stop_fraction,
                math.isfinite(stop_fraction),
                stop_fraction > 0,
                leverage,
                leverage > 0,
            )
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
            logger.info(
                "SBK1 signal decision=stake-zero signal_id=%s reason=minimum_stake_exceeds_selected "
                "minimum_stake=%.9f selected_stake=%.9f proposed_stake=%.9f max_stake=%.9f "
                "signal_stake_cap=%.9f risk_budget=%.9f risk_limited_stake=%.9f "
                "stop_fraction=%.9f leverage=%.9f",
                signal_id,
                min_stake,
                selected_stake,
                proposed_stake,
                max_stake,
                signal["riskLimits"]["maxStakeQuote"],
                risk_budget,
                risk_limited_stake,
                stop_fraction,
                leverage,
            )
            self._post_status(
                signal["signalId"],
                "REJECTED",
                f"Freqtrade minimum stake {min_stake:g} exceeds the risk-bounded signal stake {selected_stake:g}.",
            )
            return 0.0
        if selected_stake <= 0:
            logger.info(
                "SBK1 signal decision=stake-zero signal_id=%s reason=nonpositive_selected_stake "
                "selected_stake=%s min_stake=%s proposed_stake=%s max_stake=%s "
                "signal_stake_cap=%s risk_budget=%s risk_limited_stake=%s",
                signal_id,
                selected_stake,
                min_stake,
                proposed_stake,
                max_stake,
                signal["riskLimits"]["maxStakeQuote"],
                risk_budget,
                risk_limited_stake,
            )
            return max(0.0, selected_stake)
        logger.info(
            "SBK1 signal decision=stake signal_id=%s selected_stake=%.9f min_stake=%s "
            "proposed_stake=%.9f max_stake=%.9f signal_stake_cap=%.9f "
            "risk_budget=%.9f risk_limited_stake=%.9f stop_fraction=%.9f leverage=%.9f",
            signal_id,
            selected_stake,
            min_stake,
            proposed_stake,
            max_stake,
            signal["riskLimits"]["maxStakeQuote"],
            risk_budget,
            risk_limited_stake,
            stop_fraction,
            leverage,
        )
        return max(0.0, selected_stake)

    def order_filled(self, pair: str, trade: Any, order: Any, current_time: datetime, **kwargs: Any) -> None:
        signal_id = signal_id_from_entry_tag(getattr(trade, "enter_tag", None))
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
            signal = self._signals.get(signal_id_from_entry_tag(getattr(trade, "enter_tag", None)) or "")
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
            signal = self._signals.get(signal_id_from_entry_tag(getattr(trade, "enter_tag", None)) or "")
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
        status_details = {
            target: details[source]
            for source, target in (
                ("trade_id", "tradeId"),
                ("filled_amount", "filledAmount"),
                ("average_fill_price", "averageFillPrice"),
            )
            if source in details and details[source] is not None
        }
        try:
            response = requests.post(
                f"{self._bridge_url}/api/freqtrade/signals/{signal_id}/status",
                headers={"Authorization": f"Bearer {self._bridge_token}"},
                json={
                    "status": status,
                    "reason": reason,
                    **status_details,
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
        return self._timeframe_seconds_for(self.timeframe)

    def _timeframe_seconds_for(self, timeframe: str) -> int:
        unit = timeframe[-1]
        quantity = int(timeframe[:-1])
        return quantity * {"m": 60, "h": 3600, "d": 86400, "w": 604800}[unit]

    @staticmethod
    def _first_positive(values: dict[str, Any], keys: tuple[str, ...]) -> float | None:
        info = values.get("info")
        for key in keys:
            value = values.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
                return float(value)
            if isinstance(info, dict):
                raw_value = info.get(key)
                if isinstance(raw_value, (int, float, str)) and not isinstance(raw_value, bool):
                    try:
                        number = float(raw_value)
                    except ValueError:
                        continue
                    if math.isfinite(number) and number > 0:
                        return number
        return None
