"""Strict, versioned Pydantic contracts used at the Yash boundary."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, model_validator

CONTRACT_VERSION = "yash.posttrade.v1"

RequestId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.:-]{1,128}$")]
TradeId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.:-]{1,128}$")]
NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
PositivePrice = Annotated[FiniteFloat, Field(gt=0)]
NonNegativeRate = Annotated[FiniteFloat, Field(ge=0, lt=0.1)]


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
        validate_assignment=True,
    )


class DecisionType(StrEnum):
    HOLD = "HOLD"
    EXIT = "EXIT"
    ADJUST_STOP = "ADJUST_STOP"
    ARM_BREAKEVEN = "ARM_BREAKEVEN"
    TIGHTEN_TRAIL = "TIGHTEN_TRAIL"


class ReasonCode(StrEnum):
    POLICY_NO_CHANGE = "POLICY_NO_CHANGE"
    BREAKEVEN_THRESHOLD_REACHED = "BREAKEVEN_THRESHOLD_REACHED"
    TIME_HORIZON_ELAPSED = "TIME_HORIZON_ELAPSED"
    INVALIDATION_CONFIRMED = "INVALIDATION_CONFIRMED"
    DATA_STALE = "DATA_STALE"
    DATA_INCOMPLETE = "DATA_INCOMPLETE"
    CLOSED_CANDLE_REQUIRED = "CLOSED_CANDLE_REQUIRED"
    CONTRACT_UNSUPPORTED = "CONTRACT_UNSUPPORTED"
    STOP_NOT_TIGHTER = "STOP_NOT_TIGHTER"
    OBSERVATION_ONLY = "OBSERVATION_ONLY"
    POLICY_ERROR = "POLICY_ERROR"


class TradeState(StrictModel):
    trade_id: TradeId
    pair: Annotated[str, StringConstraints(pattern=r"^[A-Z0-9]{2,20}/[A-Z0-9]{2,20}(?::[A-Z0-9]{2,20})?$")]
    direction: Literal["LONG", "SHORT"]
    opened_at_ms: Annotated[int, Field(ge=0)]
    entry_price: PositivePrice
    current_price: PositivePrice
    current_stop_price: PositivePrice
    holding_horizon_minutes: Annotated[int, Field(ge=1, le=60)]
    entry_fee_rate: NonNegativeRate
    exit_fee_rate: NonNegativeRate
    breakeven_buffer_rate: NonNegativeRate = 0.0002

    @model_validator(mode="after")
    def stop_is_on_protective_side(self) -> TradeState:
        if self.direction == "LONG" and self.current_stop_price >= self.current_price:
            raise ValueError("A LONG stop must remain below current market price.")
        if self.direction == "SHORT" and self.current_stop_price <= self.current_price:
            raise ValueError("A SHORT stop must remain above current market price.")
        return self


class CandleEvidence(StrictModel):
    timeframe: Literal["15m", "1h", "4h"]
    open_time_ms: Annotated[int, Field(ge=0)]
    close_time_ms: Annotated[int, Field(ge=0)]
    observed_at_ms: Annotated[int, Field(ge=0)]
    source: NonEmptyText
    open: PositivePrice
    high: PositivePrice
    low: PositivePrice
    close: PositivePrice
    volume: Annotated[FiniteFloat, Field(ge=0)]

    @model_validator(mode="after")
    def validate_candle_shape(self) -> CandleEvidence:
        timeframe_ms = {"15m": 15, "1h": 60, "4h": 240}[self.timeframe] * 60_000
        if self.close_time_ms - self.open_time_ms != timeframe_ms:
            raise ValueError("Candle duration does not match its declared timeframe.")
        if self.low > min(self.open, self.close) or self.high < max(self.open, self.close):
            raise ValueError("Candle OHLC values are inconsistent.")
        if self.low > self.high:
            raise ValueError("Candle low cannot exceed candle high.")
        if self.observed_at_ms < self.close_time_ms:
            raise ValueError("Candle must be observed at or after its close time.")
        return self


class ModelEvidenceType(StrEnum):
    TREND_REVERSAL = "trend_reversal"
    MOMENTUM_WEAKNESS = "momentum_weakness"
    VOLATILITY_REGIME = "volatility_regime"
    STOP_DISTANCE = "stop_distance"
    CANDLE_PATTERN = "candle_pattern"
    SUSPICIOUS_VOLUME = "suspicious_volume"
    SENTIMENT = "sentiment"


class ModelEvidence(StrictModel):
    source: NonEmptyText
    evidence_type: ModelEvidenceType
    observed_at_ms: Annotated[int, Field(ge=0)]
    timeframe: Literal["15m", "1h", "4h"] | None = None
    candle_close_time_ms: Annotated[int, Field(ge=0)] | None = None
    probability: Annotated[FiniteFloat, Field(ge=0, le=1)] | None = None
    label: NonEmptyText | None = None
    value: FiniteFloat | None = None

    @model_validator(mode="after")
    def validate_model_observation(self) -> ModelEvidence:
        if self.probability is None and self.label is None and self.value is None:
            raise ValueError("Model evidence must include a probability, label, or value.")
        if self.candle_close_time_ms is not None:
            if self.timeframe is None:
                raise ValueError("Candle-based model evidence must declare its timeframe.")
            if self.observed_at_ms < self.candle_close_time_ms:
                raise ValueError("Model evidence cannot be observed before its candle closes.")
        return self


class InvalidationEvidence(StrictModel):
    source: NonEmptyText
    reason: NonEmptyText
    candle_close_time_ms: Annotated[int, Field(ge=0)]
    observed_at_ms: Annotated[int, Field(ge=0)]


class MarketEvidence(StrictModel):
    primary_candle: CandleEvidence
    context_candles: Annotated[tuple[CandleEvidence, ...], Field(strict=False)] = ()
    invalidation: InvalidationEvidence | None = None
    model_evidence: Annotated[tuple[ModelEvidence, ...], Field(strict=False)] = ()

    @model_validator(mode="after")
    def enforce_primary_and_context_roles(self) -> MarketEvidence:
        if self.primary_candle.timeframe != "15m":
            raise ValueError("The primary evaluation candle must be 15m.")
        seen: set[str] = set()
        for candle in self.context_candles:
            if candle.timeframe not in ("1h", "4h"):
                raise ValueError("Only 1h and 4h candles are allowed as context.")
            if candle.timeframe in seen:
                raise ValueError("Context timeframes must be unique.")
            seen.add(candle.timeframe)
        if self.invalidation and self.invalidation.candle_close_time_ms != self.primary_candle.close_time_ms:
            raise ValueError("Invalidation evidence must reference the primary closed 15m candle.")
        return self


class YashEvaluationRequest(StrictModel):
    contract_version: Literal[CONTRACT_VERSION]
    request_id: RequestId
    evaluated_at_ms: Annotated[int, Field(ge=0)]
    trade: TradeState
    market: MarketEvidence

    @model_validator(mode="after")
    def evidence_must_not_be_future_dated(self) -> YashEvaluationRequest:
        candles = (self.market.primary_candle, *self.market.context_candles)
        for candle in candles:
            if candle.close_time_ms > self.evaluated_at_ms:
                raise ValueError("Closed candle required: candle close is after evaluation time.")
            if candle.observed_at_ms > self.evaluated_at_ms:
                raise ValueError("Candle observation cannot be in the future.")
        invalidation = self.market.invalidation
        if invalidation:
            if invalidation.candle_close_time_ms > self.evaluated_at_ms:
                raise ValueError("Invalidation evidence cannot be future-dated.")
            if invalidation.observed_at_ms > self.evaluated_at_ms:
                raise ValueError("Invalidation observation cannot be in the future.")
        for evidence in self.market.model_evidence:
            if evidence.observed_at_ms > self.evaluated_at_ms:
                raise ValueError("Model evidence observation cannot be in the future.")
            if (
                evidence.candle_close_time_ms is not None
                and evidence.candle_close_time_ms > self.evaluated_at_ms
            ):
                raise ValueError("Model evidence candle cannot be future-dated.")
        if self.trade.opened_at_ms > self.evaluated_at_ms:
            raise ValueError("Trade open time cannot be in the future.")
        return self


class EvidenceSnapshot(StrictModel):
    trade_id: TradeId | None = None
    direction: Literal["LONG", "SHORT"] | None = None
    entry_price: PositivePrice | None = None
    current_price: PositivePrice | None = None
    current_stop_price: PositivePrice | None = None
    primary_timeframe: Literal["15m"] | None = None
    candle_open_time_ms: Annotated[int, Field(ge=0)] | None = None
    candle_close_time_ms: Annotated[int, Field(ge=0)] | None = None
    candle_observed_at_ms: Annotated[int, Field(ge=0)] | None = None
    context_timeframes: tuple[Literal["1h", "4h"], ...] = ()
    invalidation_source: NonEmptyText | None = None
    model_evidence: tuple[ModelEvidence, ...] = ()


class Decision(StrictModel):
    decision_type: DecisionType
    new_stoploss: PositivePrice | None = Field(
        default=None,
        description="Absolute stop price in market quote units, not a loss percentage.",
    )
    custom_exit_reason: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")] | None = None
    reason_codes: tuple[ReasonCode, ...] = Field(min_length=1)
    confidence: Annotated[
        FiniteFloat,
        Field(ge=0, le=1, description="Deterministic policy-match confidence, not a probability of profit."),
    ]
    evidence_snapshot: EvidenceSnapshot

    @model_validator(mode="after")
    def validate_action_payload(self) -> Decision:
        if self.decision_type in (DecisionType.ADJUST_STOP, DecisionType.ARM_BREAKEVEN, DecisionType.TIGHTEN_TRAIL):
            if self.new_stoploss is None or self.custom_exit_reason is not None:
                raise ValueError("Stop decisions require new_stoploss and cannot include an exit reason.")
        elif self.decision_type == DecisionType.EXIT:
            if self.custom_exit_reason is None or self.new_stoploss is not None:
                raise ValueError("EXIT requires custom_exit_reason and cannot include a new stop.")
        elif self.new_stoploss is not None or self.custom_exit_reason is not None:
            raise ValueError("HOLD cannot include an executable action.")
        return self


class ExecutionPlan(StrictModel):
    executable: bool = False
    observation_only: bool = True
    decision: Decision

    @model_validator(mode="after")
    def execution_mode_matches_decision(self) -> ExecutionPlan:
        if self.executable and self.observation_only:
            raise ValueError("An executable plan cannot be observation-only.")
        if self.executable and self.decision.decision_type == DecisionType.HOLD:
            raise ValueError("HOLD decisions cannot be executable.")
        return self


class YashDecisionEnvelope(StrictModel):
    contract_version: Literal[CONTRACT_VERSION]
    request_id: RequestId
    decision_id: RequestId
    generated_at_ms: Annotated[int, Field(ge=0)]
    expires_at_ms: Annotated[int, Field(ge=0)]
    plan: ExecutionPlan

    @model_validator(mode="after")
    def expiry_follows_generation(self) -> YashDecisionEnvelope:
        if self.expires_at_ms <= self.generated_at_ms:
            raise ValueError("Decision expiry must follow its generation time.")
        return self
