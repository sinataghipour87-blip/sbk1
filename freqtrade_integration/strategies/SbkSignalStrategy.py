import logging
import math
import os
from datetime import UTC, datetime
from typing import Any

import requests
from pandas import DataFrame

from freqtrade.persistence import Trade
from freqtrade.strategy import IStrategy, stoploss_from_absolute
from yash.contracts.models import YashDecisionEnvelope
from sbk_signal_contract import (
    is_signal_runtime,
    is_valid_sbk_exit_signal,
    is_valid_sbk_signal,
    unresolved_inflight_signal_ids,
    validate_bridge_url,
)
from yash_adapter import (
    build_request_from_freqtrade,
    evaluate_enforcing,
    format_audit_log,
)


logger = logging.getLogger(__name__)
INFORMATIVE_TIMEFRAMES = ("1m", "5m", "1h", "4h")
MARKET_SNAPSHOT_PUBLISH_INTERVAL_MS = 1_000
MARKET_SNAPSHOTS_PER_LOOP = 3


class SbkSignalStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "15m"
    startup_candle_count = 300
    can_short = True
    process_only_new_candles = False

    minimal_roi = {}
    stoploss = -0.05
    trailing_stop = True
    trailing_stop_positive = 0.01
    trailing_stop_positive_offset = 0.02
    trailing_only_offset_is_reached = True
    use_custom_stoploss = True
    use_exit_signal = True
    exit_profit_only = False

    def bot_start(self, **kwargs: Any) -> None:
        self._signals: dict[str, dict[str, Any]] = {}
        self._signal_statuses: dict[str, str] = {}
        self._signals_by_pair: dict[str, dict[str, Any]] = {}
        self._exit_signals: dict[str, dict[str, Any]] = {}
        self._consumed_exit_ids: set[str] = set()
        self._pairs = [
            pair.strip()
            for pair in os.getenv("SBK1_FREQTRADE_PAIRS", os.getenv("SBK1_FREQTRADE_PAIR", "")).split(",")
            if pair.strip()
        ]
        self._pair = self._pairs[0] if self._pairs else ""
        self._market_snapshot_last_publish_by_pair: dict[str, int] = {}
        self._market_snapshot_pair_cursor = 0
        try:
            self._bridge_url = validate_bridge_url(
                os.getenv("SBK1_BRIDGE_URL") or "http://127.0.0.1:3000"
            )
        except ValueError as exc:
            self._bridge_url = ""
            logger.error("SBK1 signal bridge is disabled: %s", exc)
        self._bridge_token = os.getenv("SBK1_FREQTRADE_BRIDGE_TOKEN", "")
        if len(self._bridge_token) < 32:
            logger.error("SBK1 signal bridge is disabled: SBK1_FREQTRADE_BRIDGE_TOKEN must contain at least 32 characters.")
        if not self._pairs:
            logger.error("SBK1 signal bridge is disabled: SBK1_FREQTRADE_PAIRS must configure at least one pair.")

    def informative_pairs(self) -> list[tuple[str, str]]:
        return [
            (pair, timeframe)
            for pair in self._pairs
            for timeframe in INFORMATIVE_TIMEFRAMES
            if timeframe != self.timeframe
        ]

    def bot_loop_start(self, current_time: datetime, **kwargs: Any) -> None:
        self._signals = {}
        self._signal_statuses = {}
        self._signals_by_pair = {}
        self._exit_signals = {}
        runmode = getattr(self.config.get("runmode"), "value", self.config.get("runmode"))
        if runmode == "dry_run":
            self._publish_market_snapshot(current_time)
        if not is_signal_runtime(runmode):
            return
        if len(self._bridge_token) < 32 or not self._pairs or not self._bridge_url:
            return

        try:
            logger.debug("Polling the SBK1 bridge for signals for pair %s.", self._pair)
            response = requests.get(
                f"{self._bridge_url}/api/freqtrade/signals",
                headers={"Authorization": f"Bearer {self._bridge_token}"},
                params={"pair": "*", "timeframe": self.timeframe},
                timeout=(1.0, 2.0),
                allow_redirects=False,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or payload.get("contractVersion") != "sbk1.freqtrade.signal.v3":
                logger.error("SBK1 signal bridge returned an unsupported contract response.")
                return
            records = payload.get("signals")
            if not isinstance(records, list):
                logger.error("SBK1 signal bridge returned an invalid signal list.")
                return
            exit_signals = payload.get("exitSignals", [])
            if not isinstance(exit_signals, list):
                logger.error("SBK1 signal bridge returned an invalid exit signal list.")
                return
            now_ms = int(current_time.timestamp() * 1000)
            self._exit_signals = {
                signal["exitId"]: signal
                for signal in exit_signals
                if (
                    isinstance(signal, dict)
                    and signal.get("pair") in self._pairs
                    and is_valid_sbk_exit_signal(signal, now_ms=now_ms, expected_pair=signal["pair"])
                )
            }
            logger.debug("SBK1 bridge returned %d signal record(s).", len(records))

            inflight_signal_records = [
                record for record in records
                if isinstance(record, dict)
                and record.get("status") in (
                    "STRATEGY_ACCEPTED",
                    "ORDER_SUBMITTED",
                    "PARTIALLY_FILLED",
                    "UNKNOWN_IN_FLIGHT",
                )
            ]
            unresolved_signal_ids: set[str] = set()
            trades_by_signal_id: dict[str, Any] = {}
            if inflight_signal_records:
                trades_by_signal_id = {
                    trade.enter_tag: trade
                    for trade in Trade.get_trades_proxy()
                    if isinstance(trade.enter_tag, str)
                }
                unresolved_signal_ids = set(
                    unresolved_inflight_signal_ids(
                        inflight_signal_records,
                        set(trades_by_signal_id),
                    )
                )
                for signal_id in unresolved_signal_ids:
                    record = next(
                        (
                            candidate for candidate in inflight_signal_records
                            if isinstance(candidate.get("signal"), dict)
                            and candidate["signal"].get("signalId") == signal_id
                        ),
                        None,
                    )
                    if record and record.get("status") != "UNKNOWN_IN_FLIGHT":
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
                    if (
                        trade.pair != signal["pair"]
                        or bool(trade.is_short) != (signal["direction"] == "SHORT")
                    ):
                        unresolved_signal_ids.add(signal_id)
                        if record.get("status") != "UNKNOWN_IN_FLIGHT":
                            self._post_status(
                                signal_id,
                                "UNKNOWN_IN_FLIGHT",
                                "A Freqtrade trade with this signal tag has a different pair or direction; the signal remains quarantined.",
                            )
                        logger.error(
                            "Freqtrade trade %s does not match signal %s pair/direction; keeping signal quarantined.",
                            getattr(trade, "id", "unknown"),
                            signal_id,
                        )
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
                        self._post_status(
                            signal_id,
                            reconciled_status,
                            "Reconciled signal lifecycle from the persisted Freqtrade trade and order records.",
                            trade_id=getattr(trade, "id", None),
                            filled_amount=float(getattr(trade, "amount", 0) or 0),
                            average_fill_price=float(getattr(trade, "open_rate", 0) or 0) or None,
                        )

            now_ms = int(current_time.timestamp() * 1000)
            configured_exchange = str(self.config.get("exchange", {}).get("name", "")).lower()
            configured_market = str(self.config.get("trading_mode", "spot")).lower()
            active_signals: dict[str, dict[str, Any]] = {}
            active_statuses: dict[str, str] = {}
            for record in records:
                signal = record.get("signal") if isinstance(record, dict) else None
                status = record.get("status") if isinstance(record, dict) else None
                if status not in (
                    "ACCEPTED",
                    "STRATEGY_ACCEPTED",
                    "ORDER_SUBMITTED",
                    "PARTIALLY_FILLED",
                    "FILLED",
                    "UNKNOWN_IN_FLIGHT",
                ):
                    continue
                if isinstance(signal, dict) and signal.get("signalId") in unresolved_signal_ids:
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
        except requests.HTTPError as exc:
            response = exc.response
            payload = None
            if response is not None:
                try:
                    payload = response.json()
                except ValueError:
                    payload = None
            if isinstance(payload, dict):
                logger.warning(
                    "SBK1 signal delivery blocked (HTTP %s, stage=%s, code=%s, correlation_id=%s): %s",
                    response.status_code if response is not None else "unknown",
                    payload.get("stage", "unknown"),
                    payload.get("code", "unknown"),
                    payload.get("correlationId", "unavailable"),
                    payload.get("error", str(exc)),
                )
            else:
                logger.error("SBK1 signal bridge poll failed: %s", exc)
        except (requests.RequestException, ValueError) as exc:
            logger.error("SBK1 signal bridge poll failed; this loop will not use cached signals: %s", exc)

    def _publish_market_snapshot(self, current_time: datetime) -> bool:
        bridge_token = getattr(self, "_bridge_token", "")
        bridge_url = getattr(self, "_bridge_url", "")
        pairs = getattr(self, "_pairs", [])
        data_provider = getattr(self, "dp", None)
        now_ms = int(current_time.timestamp() * 1000)
        if (
            len(bridge_token) < 32 or not bridge_url or not pairs or data_provider is None
        ):
            return False

        last_published_by_pair = getattr(self, "_market_snapshot_last_publish_by_pair", {})
        published = False
        for _ in range(min(MARKET_SNAPSHOTS_PER_LOOP, len(pairs))):
            pair_cursor = getattr(self, "_market_snapshot_pair_cursor", 0) % len(pairs)
            pair = pairs[pair_cursor]
            self._market_snapshot_pair_cursor = (pair_cursor + 1) % len(pairs)
            if now_ms - last_published_by_pair.get(pair, 0) < MARKET_SNAPSHOT_PUBLISH_INTERVAL_MS:
                continue
            if self._publish_market_snapshot_for_pair(pair, current_time, now_ms):
                last_published_by_pair[pair] = now_ms
                published = True
        self._market_snapshot_last_publish_by_pair = last_published_by_pair
        return published

    def _publish_market_snapshot_for_pair(
        self,
        pair: str,
        current_time: datetime,
        now_ms: int,
    ) -> bool:
        bridge_token = getattr(self, "_bridge_token", "")
        bridge_url = getattr(self, "_bridge_url", "")
        data_provider = getattr(self, "dp", None)
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
            open_interest = self._snapshot_open_interest(data_provider, pair, market, generated_at_ms)
            payload = {
                "contractVersion": "sbk1.freqtrade.market-snapshot.v5",
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
                "openInterest": open_interest,
                "tradeFlow": self._snapshot_trade_flow(data_provider, pair, generated_at_ms),
            }
            response = requests.post(
                f"{bridge_url}/api/freqtrade/market-snapshot",
                headers={"Authorization": f"Bearer {bridge_token}"},
                json=payload,
                timeout=(1.0, 2.0),
                allow_redirects=False,
            )
            response.raise_for_status()
            return True
        except requests.HTTPError as exc:
            response = exc.response
            code = "unknown"
            detail = str(exc)
            if response is not None:
                try:
                    error_payload = response.json()
                except ValueError:
                    error_payload = None
                if isinstance(error_payload, dict):
                    code = str(error_payload.get("code", code))
                    detail = str(error_payload.get("error", detail))
            logger.error(
                "Freqtrade market snapshot was rejected (HTTP %s, code=%s): %s",
                response.status_code if response is not None else "unknown",
                code,
                detail,
            )
            return False
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
        for row in dataframe.tail(1500).itertuples(index=False):
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

    def _snapshot_trade_flow(
        self,
        data_provider: Any,
        pair: str,
        now_ms: int,
    ) -> dict[str, Any] | None:
        exchange = getattr(data_provider, "_exchange", None)
        api = getattr(exchange, "_api", None)
        capabilities = getattr(api, "has", {}) if api is not None else {}
        fetch_trades = getattr(api, "fetch_trades", None) if isinstance(capabilities, dict) and capabilities.get("fetchTrades") else None
        if not callable(fetch_trades):
            logger.warning("Freqtrade CCXT adapter does not support recent public trades for %s.", pair)
            return None
        try:
            raw_trades = fetch_trades(pair, since=now_ms - 5_000, limit=200)
        except Exception as exc:
            logger.warning("Recent public trade flow is unavailable for %s: %s", pair, exc)
            return None
        if not isinstance(raw_trades, list):
            logger.warning("Freqtrade CCXT returned an invalid recent-trades response for %s.", pair)
            return None

        trades = []
        seen_ids = {}
        duplicate_count = 0
        venue = str(self.config.get("exchange", {}).get("name", "")).strip().lower()
        if not venue:
            logger.warning("Freqtrade exchange identity is unavailable for recent trades on %s.", pair)
            return None
        for trade in raw_trades:
            if not isinstance(trade, dict):
                logger.warning("Freqtrade CCXT returned a malformed trade for %s.", pair)
                return None
            trade_id = trade.get("id")
            timestamp_ms = trade.get("timestamp")
            side = trade.get("side")
            price = trade.get("price")
            amount = trade.get("amount")
            if (
                trade_id is None
                or not isinstance(timestamp_ms, (int, float))
                or isinstance(timestamp_ms, bool)
                or not math.isfinite(timestamp_ms)
                or side not in ("buy", "sell")
                or not isinstance(price, (int, float))
                or isinstance(price, bool)
                or not math.isfinite(price)
                or price <= 0
                or not isinstance(amount, (int, float))
                or isinstance(amount, bool)
                or not math.isfinite(amount)
                or amount <= 0
            ):
                logger.warning("Freqtrade CCXT returned trade data without valid ID, time, side, price, or amount for %s.", pair)
                return None
            trade_id = str(trade_id)
            timestamp_ms = int(timestamp_ms)
            if trade_id in seen_ids:
                previous = seen_ids[trade_id]
                if previous != (timestamp_ms, side, float(price), float(amount)):
                    logger.warning("Freqtrade CCXT returned conflicting records for trade id %s on %s.", trade_id, pair)
                    return None
                duplicate_count += 1
                continue
            seen_ids[trade_id] = (timestamp_ms, side, float(price), float(amount))
            if timestamp_ms <= now_ms and now_ms - timestamp_ms <= 5_000:
                trades.append({
                    "timestampMs": timestamp_ms,
                    "side": side,
                    "price": float(price),
                    "amount": float(amount),
                    "venue": venue,
                    "symbol": pair,
                    "tradeId": trade_id,
                })
        trades.sort(key=lambda item: item["timestampMs"])
        if not trades:
            logger.warning("No fresh identified trades are available for %s.", pair)
            return None
        return {
            "retrievedAtMs": int(datetime.now(UTC).timestamp() * 1000),
            "duplicateCount": duplicate_count,
            "trades": trades,
        }

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

    def _snapshot_open_interest(
        self,
        data_provider: Any,
        pair: str,
        market: str,
        now_ms: int,
    ) -> dict[str, Any] | None:
        if market != "futures":
            return None
        exchange = getattr(data_provider, "_exchange", None)
        api = getattr(exchange, "_api", None)
        capabilities = getattr(api, "has", {}) if api is not None else {}
        fetch_history = (
            getattr(api, "fetch_open_interest_history", None)
            if isinstance(capabilities, dict) and capabilities.get("fetchOpenInterestHistory")
            else None
        )
        if not callable(fetch_history):
            logger.warning("Freqtrade CCXT adapter does not support open-interest history for %s.", pair)
            return None
        try:
            history = fetch_history(pair, "5m", limit=2)
        except Exception as exc:
            logger.warning("Open-interest history is unavailable for %s: %s", pair, exc)
            return None
        if not isinstance(history, list) or len(history) < 2:
            logger.warning("Freqtrade CCXT returned fewer than two open-interest records for %s.", pair)
            return None

        points = []
        for record in history:
            if not isinstance(record, dict):
                logger.warning("Freqtrade CCXT returned malformed open-interest history for %s.", pair)
                return None
            timestamp_ms = record.get("timestamp")
            amount = record.get("openInterestAmount")
            if (
                not isinstance(timestamp_ms, (int, float))
                or isinstance(timestamp_ms, bool)
                or not math.isfinite(timestamp_ms)
                or not isinstance(amount, (int, float))
                or isinstance(amount, bool)
                or not math.isfinite(amount)
                or timestamp_ms <= 0
                or amount <= 0
            ):
                logger.warning("Open-interest history has no valid timestamp or amount for %s.", pair)
                return None
            points.append((int(timestamp_ms), float(amount)))
        points.sort(key=lambda point: point[0])
        previous, latest = points[-2:]
        if (
            latest[0] - previous[0] != 5 * 60_000
            or latest[0] > now_ms + 1_000
            or now_ms - latest[0] > 10 * 60_000
        ):
            logger.warning("Open-interest history is stale or does not contain adjacent five-minute records for %s.", pair)
            return None
        return {
            "retrievedAtMs": int(datetime.now(UTC).timestamp() * 1000),
            "latestTimestampMs": latest[0],
            "previousTimestampMs": previous[0],
            "latestAmount": latest[1],
            "previousAmount": previous[1],
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
        snapshot = {
            "timestampMs": timestamp_ms,
            "venue": str(self.config.get("exchange", {}).get("name", "")).strip().lower(),
            "symbol": pair,
            "bids": bid_levels,
            "asks": ask_levels,
        }
        sequence_id = order_book.get("nonce")
        if isinstance(sequence_id, int) and not isinstance(sequence_id, bool) and sequence_id >= 0:
            snapshot["sequenceId"] = sequence_id
        return snapshot

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
        if not is_signal_runtime(
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
            self._post_status(signal["signalId"], "REJECTED", "Freqtrade candle price exceeded the signal deviation limit.")
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
        if dataframe.empty or not is_signal_runtime(
            getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
        ):
            return dataframe
        pair = metadata.get("pair")
        latest = dataframe.iloc[-1]
        current_entry_tag = latest.get("enter_tag")
        if not isinstance(current_entry_tag, str):
            return dataframe
        for exit_id, signal in self._exit_signals.items():
            if (
                exit_id in self._consumed_exit_ids
                or signal["pair"] != pair
                or signal.get("entryTag") != current_entry_tag
                or int(datetime.now(UTC).timestamp() * 1000) >= signal["expiresAtMs"]
            ):
                continue
            last_index = dataframe.index[-1]
            if signal["direction"] == "LONG":
                dataframe.loc[last_index, "exit_long"] = 1
            else:
                dataframe.loc[last_index, "exit_short"] = 1
            dataframe.loc[last_index, "exit_tag"] = f"sbk_exit_{exit_id}"
            break
        return dataframe

    def custom_entry_price(
        self,
        pair: str,
        trade: Trade | None,
        current_time: datetime,
        proposed_rate: float,
        entry_tag: str | None,
        side: str,
        **kwargs: Any,
    ) -> float:
        signal = self._signals.get(entry_tag or "")
        if not signal or pair != signal["pair"] or side.lower() != signal["direction"].lower():
            return proposed_rate
        return float(signal["entryConditions"]["entryPrice"])

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
            not is_signal_runtime(
                getattr(self.config.get("runmode"), "value", self.config.get("runmode")),
            )
            or not signal
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
        signal = self._signals.get(entry_tag or "")
        if not signal or signal["market"] == "spot":
            return 1.0
        return min(float(signal["riskLimits"]["maxLeverage"]), float(max_leverage))

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
        if (
            not signal
            or not math.isfinite(current_rate)
            or current_rate <= 0
            or not math.isfinite(max_stake)
            or max_stake <= 0
            or not math.isfinite(proposed_stake)
            or proposed_stake <= 0
            or not math.isfinite(leverage)
            or leverage < 5
        ):
            return 0.0
        stop_fraction = abs(current_rate - signal["entryConditions"]["stopLoss"]) / current_rate
        if not math.isfinite(stop_fraction) or stop_fraction <= 0:
            return 0.0

        configured_stake = self.config.get("stake_amount")
        if isinstance(configured_stake, (int, float)):
            if isinstance(configured_stake, bool) or not math.isfinite(configured_stake) or configured_stake <= 0:
                return 0.0
            configured_stake_cap = float(configured_stake)
        else:
            configured_stake_cap = max_stake
        stake_cap = min(
            max_stake,
            configured_stake_cap,
            float(signal["riskLimits"]["maxStakeQuote"]),
            proposed_stake,
        )
        allocated_risk = signal["authorization"]["allocatedRiskUsd"]
        risk_limited_stake = allocated_risk / stop_fraction / leverage
        selected_stake = min(risk_limited_stake, stake_cap)
        if not math.isfinite(selected_stake):
            return 0.0
        if min_stake is not None and selected_stake < min_stake:
            return 0.0
        return max(0.0, selected_stake)

    def order_filled(self, pair: str, trade: Any, order: Any, current_time: datetime, **kwargs: Any) -> None:
        signal_id = getattr(trade, "enter_tag", None)
        signal = self._signals.get(signal_id or "")
        order_side = getattr(order, "ft_order_side", "").lower()
        if order_side == ("buy" if trade.is_short else "sell"):
            exit_id = trade.get_custom_data("sbk_exit_signal_id")
            if isinstance(exit_id, str) and not getattr(trade, "is_open", True):
                self._post_exit_status(exit_id, "CLOSED", "Freqtrade confirmed the SBK1-directed position close.")
                self._consumed_exit_ids.add(exit_id)
                self._exit_signals.pop(exit_id, None)
            return
        if not signal or order_side != ("sell" if trade.is_short else "buy"):
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
        try:
            envelope = self._evaluate_yash(trade, pair, current_rate, current_time)
            if (
                envelope is not None
                and envelope.expires_at_ms > int(current_time.timestamp() * 1000)
                and envelope.plan.executable
                and envelope.plan.decision.new_stoploss is not None
            ):
                decision = envelope.plan.decision
                logger.info(
                    "YASH_ENFORCING_APPLIED decision_id=%s reason_codes=%s action=stop",
                    envelope.decision_id,
                    ",".join(reason.value for reason in decision.reason_codes),
                )
                return stoploss_from_absolute(
                    decision.new_stoploss,
                    current_rate,
                    is_short=trade.is_short,
                    leverage=trade.leverage,
                )
        except Exception:
            logger.exception(
                "YASH_ENFORCING_SKIPPED reason_code=DATA_INCOMPLETE "
                "callback=custom_stoploss; existing stop behavior is unchanged."
            )

        signal = trade.get_custom_data("sbk_signal")
        if not isinstance(signal, dict):
            signal = self._signals.get(getattr(trade, "enter_tag", "") or "")
        if (
            not isinstance(signal, dict)
            or not isinstance(signal.get("entryConditions"), dict)
            or not isinstance(signal["entryConditions"].get("stopLoss"), (int, float))
            or isinstance(signal["entryConditions"].get("stopLoss"), bool)
            or not math.isfinite(signal["entryConditions"]["stopLoss"])
            or signal["entryConditions"]["stopLoss"] <= 0
            or not math.isfinite(current_rate)
            or current_rate <= 0
        ):
            return self.stoploss
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
        try:
            envelope = self._evaluate_yash(trade, pair, current_rate, current_time)
            if (
                envelope is not None
                and envelope.expires_at_ms > int(current_time.timestamp() * 1000)
                and envelope.plan.executable
                and envelope.plan.decision.custom_exit_reason is not None
            ):
                decision = envelope.plan.decision
                logger.info(
                    "YASH_ENFORCING_APPLIED decision_id=%s reason_codes=%s action=exit",
                    envelope.decision_id,
                    ",".join(reason.value for reason in decision.reason_codes),
                )
                return decision.custom_exit_reason
        except Exception:
            logger.exception(
                "YASH_ENFORCING_SKIPPED reason_code=DATA_INCOMPLETE "
                "callback=custom_exit; existing exit behavior is unchanged."
            )

        entry_tag = getattr(trade, "enter_tag", None)
        trade_id = getattr(trade, "id", None)
        direction = "SHORT" if getattr(trade, "is_short", False) else "LONG"
        now_ms = int(current_time.timestamp() * 1000)
        entry_signal = trade.get_custom_data("sbk_signal")
        if not isinstance(entry_signal, dict):
            entry_signal = self._signals.get(entry_tag or "")
        entry_conditions = entry_signal.get("entryConditions") if isinstance(entry_signal, dict) else None
        take_profit = entry_conditions.get("takeProfit") if isinstance(entry_conditions, dict) else None
        if (
            isinstance(take_profit, (int, float))
            and not isinstance(take_profit, bool)
            and math.isfinite(take_profit)
            and take_profit > 0
            and math.isfinite(current_rate)
            and current_rate > 0
            and ((direction == "LONG" and current_rate >= take_profit)
                 or (direction == "SHORT" and current_rate <= take_profit))
        ):
            return "sbk_take_profit"
        max_holding_minutes = entry_conditions.get("maxHoldingMinutes") if isinstance(entry_conditions, dict) else None
        opened_at = getattr(trade, "open_date_utc", None)
        if (
            isinstance(max_holding_minutes, int)
            and not isinstance(max_holding_minutes, bool)
            and 1 <= max_holding_minutes <= 60
            and isinstance(opened_at, datetime)
            and current_time.timestamp() - opened_at.timestamp() >= max_holding_minutes * 60
        ):
            return "sbk_time_horizon"
        for exit_id, signal in self._exit_signals.items():
            if (
                exit_id not in self._consumed_exit_ids
                and is_valid_sbk_exit_signal(signal, now_ms=now_ms, expected_pair=pair)
                and (signal.get("tradeId") is None or signal["tradeId"] == trade_id)
                and (signal.get("entryTag") is None or signal["entryTag"] == entry_tag)
                and signal["direction"] == direction
            ):
                trade.set_custom_data("sbk_exit_signal_id", exit_id)
                return f"sbk_exit_{exit_id}"
        return None

    def _evaluate_yash(
        self,
        trade: Any,
        pair: str,
        current_rate: float,
        current_time: datetime,
    ) -> YashDecisionEnvelope | None:
        data_provider = getattr(self, "dp", None)
        primary = data_provider.get_pair_dataframe(pair, self.timeframe) if data_provider else None
        context_1h = data_provider.get_pair_dataframe(pair, "1h") if data_provider else None
        context_4h = data_provider.get_pair_dataframe(pair, "4h") if data_provider else None
        fee_open = getattr(trade, "fee_open", None)
        fee_close = getattr(trade, "fee_close", None)
        fees = (
            {"entry_fee_rate": float(fee_open), "exit_fee_rate": float(fee_close)}
            if isinstance(fee_open, (int, float)) and isinstance(fee_close, (int, float))
            else None
        )
        request = build_request_from_freqtrade(
            trade,
            current_rate,
            current_time,
            primary,
            context_1h,
            context_4h,
            fees,
        )
        if request is None:
            return None
        envelope = evaluate_enforcing(request)
        logger.info("%s", format_audit_log(envelope))
        return envelope

    def confirm_trade_exit(
        self,
        pair: str,
        trade: Any,
        order_type: str,
        amount: float,
        rate: float,
        time_in_force: str,
        exit_reason: str,
        current_time: datetime,
        **kwargs: Any,
    ) -> bool:
        if exit_reason in ("stop_loss", "stoploss_on_exchange", "emergency_exit", "force_exit", "sbk_time_horizon"):
            return True
        if exit_reason in ("yash_time_horizon_elapsed", "yash_invalidation_confirmed"):
            try:
                envelope = self._evaluate_yash(trade, pair, rate, current_time)
                return bool(
                    envelope is not None
                    and envelope.expires_at_ms > int(current_time.timestamp() * 1000)
                    and envelope.plan.executable
                    and envelope.plan.decision.custom_exit_reason == exit_reason
                )
            except Exception:
                logger.exception(
                    "YASH_ENFORCING_SKIPPED reason_code=DATA_INCOMPLETE "
                    "callback=confirm_trade_exit; rejecting unverified Yash exit."
                )
                return False
        if exit_reason == "sbk_take_profit":
            entry_signal = trade.get_custom_data("sbk_signal")
            entry_conditions = entry_signal.get("entryConditions") if isinstance(entry_signal, dict) else None
            take_profit = entry_conditions.get("takeProfit") if isinstance(entry_conditions, dict) else None
            return (
                isinstance(take_profit, (int, float))
                and not isinstance(take_profit, bool)
                and math.isfinite(take_profit)
                and take_profit > 0
                and math.isfinite(rate)
                and rate > 0
                and (
                    (not trade.is_short and rate >= take_profit)
                    or (trade.is_short and rate <= take_profit)
                )
            )
        if not exit_reason.startswith("sbk_exit_") and exit_reason != "exit_signal":
            return False
        entry_tag = getattr(trade, "enter_tag", None)
        trade_id = getattr(trade, "id", None)
        direction = "SHORT" if getattr(trade, "is_short", False) else "LONG"
        requested_exit_id = exit_reason.removeprefix("sbk_exit_")
        for exit_id, signal in self._exit_signals.items():
            if (
                (exit_reason == "exit_signal" or exit_id == requested_exit_id)
                and signal["pair"] == pair
                and (signal.get("tradeId") is None or signal["tradeId"] == trade_id)
                and (signal.get("entryTag") is None or signal["entryTag"] == entry_tag)
                and signal["direction"] == direction
                and current_time.timestamp() * 1000 < signal["expiresAtMs"]
            ):
                self._post_exit_status(exit_id, "CONFIRMED", "Freqtrade accepted the SBK1-directed exit order.")
                self._consumed_exit_ids.add(exit_id)
                trade.set_custom_data("sbk_exit_signal_id", exit_id)
                return True
        return False

    def _is_valid_signal(
        self,
        signal: Any,
        now_ms: int,
        configured_exchange: str,
        configured_market: str,
        require_fresh: bool = True,
    ) -> bool:
        if not isinstance(signal, dict) or signal.get("pair") not in self._pairs:
            return False
        return is_valid_sbk_signal(
            signal,
            now_ms=now_ms,
            expected_exchange=configured_exchange,
            expected_market=configured_market,
            expected_pair=signal["pair"],
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

    def _post_exit_status(self, exit_id: str, status: str, reason: str) -> bool:
        if len(self._bridge_token) < 32 or not self._bridge_url:
            return False
        try:
            response = requests.post(
                f"{self._bridge_url}/api/freqtrade/exits/{exit_id}/status",
                headers={"Authorization": f"******"},
                json={"status": status, "reason": reason},
                timeout=(1.0, 2.0),
                allow_redirects=False,
            )
            response.raise_for_status()
            return True
        except (requests.RequestException, ValueError) as exc:
            logger.error("Could not persist SBK1 exit lifecycle status %s: %s", status, exc)
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
