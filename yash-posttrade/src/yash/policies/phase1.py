"""Deterministic Phase 1 policies; policies never execute orders."""

from dataclasses import dataclass

from yash.contracts.models import (
    DecisionType,
    ReasonCode,
    TradeState,
    YashEvaluationRequest,
)


@dataclass(frozen=True)
class PolicyAction:
    decision_type: DecisionType
    reason_code: ReasonCode
    new_stoploss: float | None = None
    custom_exit_reason: str | None = None


class CutFastPolicy:
    def evaluate(self, request: YashEvaluationRequest) -> PolicyAction | None:
        evidence = request.market.invalidation
        if evidence is None:
            return None
        return PolicyAction(
            decision_type=DecisionType.EXIT,
            reason_code=ReasonCode.INVALIDATION_CONFIRMED,
            custom_exit_reason="yash_invalidation_confirmed",
        )


class TimeStopPolicy:
    def evaluate(self, trade: TradeState, evaluated_at_ms: int) -> PolicyAction | None:
        horizon_ms = trade.holding_horizon_minutes * 60_000
        if evaluated_at_ms - trade.opened_at_ms < horizon_ms:
            return None
        return PolicyAction(
            decision_type=DecisionType.EXIT,
            reason_code=ReasonCode.TIME_HORIZON_ELAPSED,
            custom_exit_reason="yash_time_horizon_elapsed",
        )


class BreakevenPolicy:
    def __init__(self, trigger_profit_rate: float = 0.02) -> None:
        if not 0 < trigger_profit_rate < 1:
            raise ValueError("trigger_profit_rate must be greater than 0 and less than 1.")
        self.trigger_profit_rate = trigger_profit_rate

    def evaluate(self, trade: TradeState) -> PolicyAction | None:
        if trade.direction == "LONG":
            profit_rate = (trade.current_price - trade.entry_price) / trade.entry_price
            target = trade.entry_price * (
                1 + trade.entry_fee_rate + trade.exit_fee_rate + trade.breakeven_buffer_rate
            )
        else:
            profit_rate = (trade.entry_price - trade.current_price) / trade.entry_price
            target = trade.entry_price * (
                1 - trade.entry_fee_rate - trade.exit_fee_rate - trade.breakeven_buffer_rate
            )
        if profit_rate < self.trigger_profit_rate:
            return None
        return PolicyAction(
            decision_type=DecisionType.ARM_BREAKEVEN,
            reason_code=ReasonCode.BREAKEVEN_THRESHOLD_REACHED,
            new_stoploss=target,
        )

