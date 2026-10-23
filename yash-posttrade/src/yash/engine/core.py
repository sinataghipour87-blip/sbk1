"""Phase 1 engine with mandatory observation-only output."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from yash.contracts.models import (
    CONTRACT_VERSION,
    Decision,
    DecisionType,
    EvidenceSnapshot,
    ExecutionPlan,
    ReasonCode,
    YashDecisionEnvelope,
    YashEvaluationRequest,
)
from yash.guards.candles import validate_closed_candles
from yash.guards.ratchet import validate_tighter_stop
from yash.policies.phase1 import (
    BreakevenPolicy,
    CutFastPolicy,
    PolicyAction,
    TimeStopPolicy,
)

DEFAULT_FRESHNESS_LIMIT_MS = 15_000
DEFAULT_DECISION_TTL_MS = 15_000


@dataclass(frozen=True)
class EngineConfig:
    freshness_limit_ms: int = DEFAULT_FRESHNESS_LIMIT_MS
    decision_ttl_ms: int = DEFAULT_DECISION_TTL_MS
    breakeven_trigger_rate: float = 0.02

    def __post_init__(self) -> None:
        if self.freshness_limit_ms <= 0 or self.decision_ttl_ms <= 0:
            raise ValueError("Freshness and decision TTL must be positive.")
        if self.freshness_limit_ms > DEFAULT_FRESHNESS_LIMIT_MS:
            raise ValueError("Yash cannot configure a freshness limit looser than 15 seconds.")


class YashEngine:
    """Evaluate Phase 1 policies; all plans are permanently observation-only."""

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        self._cut_fast = CutFastPolicy()
        self._time_stop = TimeStopPolicy()
        self._breakeven = BreakevenPolicy(self.config.breakeven_trigger_rate)

    def evaluate(self, request: YashEvaluationRequest) -> YashDecisionEnvelope:
        candle_guard = validate_closed_candles(request)
        if not candle_guard.valid:
            code = ReasonCode.CLOSED_CANDLE_REQUIRED if candle_guard.reason == "CLOSED_CANDLE_REQUIRED" else ReasonCode.DATA_INCOMPLETE
            return self._envelope(request, self._hold(request, (code,), confidence=0.0))

        stale = self._has_stale_evidence(request)
        if stale:
            return self._envelope(request, self._hold(request, (ReasonCode.DATA_STALE,), confidence=0.0))

        action = self._cut_fast.evaluate(request)
        if action is None:
            action = self._time_stop.evaluate(request.trade, request.evaluated_at_ms)
        if action is None:
            action = self._breakeven.evaluate(request.trade)

        if action is None:
            decision = self._hold(
                request,
                (ReasonCode.POLICY_NO_CHANGE,),
                confidence=1.0,
            )
        elif action.new_stoploss is not None and not validate_tighter_stop(request.trade, action.new_stoploss):
            decision = self._hold(
                request,
                (ReasonCode.STOP_NOT_TIGHTER,),
                confidence=1.0,
            )
        else:
            decision = self._decision_from_action(request, action)
        return self._envelope(request, decision)

    def evaluate_payload(self, payload: Any) -> YashDecisionEnvelope:
        """Parse untrusted input and return a non-executable safe result on validation failure."""
        if (
            isinstance(payload, dict)
            and payload.get("contract_version") is not None
            and payload.get("contract_version") != CONTRACT_VERSION
        ):
            now_ms = _safe_int(payload.get("evaluated_at_ms"))
            return self._failure_envelope(
                payload.get("request_id"),
                now_ms,
                ReasonCode.CONTRACT_UNSUPPORTED,
            )
        try:
            request = YashEvaluationRequest.model_validate(payload)
        except ValidationError as error:
            now_ms = _safe_int(payload.get("evaluated_at_ms")) if isinstance(payload, dict) else 0
            reason = _classify_validation_error(error, payload)
            return self._failure_envelope(
                payload.get("request_id") if isinstance(payload, dict) else None,
                now_ms,
                reason,
            )
        return self.evaluate(request)

    def _has_stale_evidence(self, request: YashEvaluationRequest) -> bool:
        candles = (
            request.market.primary_candle,
            *request.market.context_candles,
        )
        if any(
            request.evaluated_at_ms - candle.observed_at_ms > self.config.freshness_limit_ms
            for candle in candles
        ):
            return True
        invalidation = request.market.invalidation
        return bool(
            invalidation
            and request.evaluated_at_ms - invalidation.observed_at_ms > self.config.freshness_limit_ms
        )

    def _decision_from_action(self, request: YashEvaluationRequest, action: PolicyAction) -> Decision:
        return Decision(
            decision_type=action.decision_type,
            new_stoploss=action.new_stoploss,
            custom_exit_reason=action.custom_exit_reason,
            reason_codes=(action.reason_code, ReasonCode.OBSERVATION_ONLY),
            confidence=1.0,
            evidence_snapshot=self._snapshot(request),
        )

    def _hold(
        self,
        request: YashEvaluationRequest,
        reason_codes: tuple[ReasonCode, ...],
        confidence: float,
    ) -> Decision:
        return Decision(
            decision_type=DecisionType.HOLD,
            reason_codes=reason_codes + (ReasonCode.OBSERVATION_ONLY,),
            confidence=confidence,
            evidence_snapshot=self._snapshot(request),
        )

    def _snapshot(self, request: YashEvaluationRequest) -> EvidenceSnapshot:
        candle = request.market.primary_candle
        invalidation = request.market.invalidation
        return EvidenceSnapshot(
            trade_id=request.trade.trade_id,
            direction=request.trade.direction,
            entry_price=request.trade.entry_price,
            current_price=request.trade.current_price,
            current_stop_price=request.trade.current_stop_price,
            primary_timeframe="15m",
            candle_open_time_ms=candle.open_time_ms,
            candle_close_time_ms=candle.close_time_ms,
            candle_observed_at_ms=candle.observed_at_ms,
            context_timeframes=tuple(c.timeframe for c in request.market.context_candles),
            invalidation_source=invalidation.source if invalidation else None,
            model_evidence=request.market.model_evidence,
        )

    def _envelope(self, request: YashEvaluationRequest, decision: Decision) -> YashDecisionEnvelope:
        decision_id = _decision_id(request.request_id, decision)
        return YashDecisionEnvelope(
            contract_version=CONTRACT_VERSION,
            request_id=request.request_id,
            decision_id=decision_id,
            generated_at_ms=request.evaluated_at_ms,
            expires_at_ms=request.evaluated_at_ms + self.config.decision_ttl_ms,
            plan=ExecutionPlan(decision=decision),
        )

    def _failure_envelope(
        self,
        request_id: Any,
        generated_at_ms: int,
        reason: ReasonCode,
    ) -> YashDecisionEnvelope:
        safe_request_id = (
            request_id
            if isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", request_id)
            else "invalid-request"
        )
        safe_time = max(0, generated_at_ms)
        decision = Decision(
            decision_type=DecisionType.HOLD,
            reason_codes=(reason, ReasonCode.OBSERVATION_ONLY),
            confidence=0.0,
            evidence_snapshot=EvidenceSnapshot(),
        )
        return YashDecisionEnvelope(
            contract_version=CONTRACT_VERSION,
            request_id=safe_request_id,
            decision_id=_decision_id(safe_request_id, decision),
            generated_at_ms=safe_time,
            expires_at_ms=safe_time + self.config.decision_ttl_ms,
            plan=ExecutionPlan(decision=decision),
        )


def _safe_int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _classify_validation_error(error: ValidationError, payload: Any) -> ReasonCode:
    if isinstance(payload, dict):
        market = payload.get("market")
        candle = market.get("primary_candle") if isinstance(market, dict) else None
        evaluated_at = _safe_int(payload.get("evaluated_at_ms"))
        close_time = _safe_int(candle.get("close_time_ms")) if isinstance(candle, dict) else 0
        if close_time and evaluated_at and close_time > evaluated_at:
            return ReasonCode.CLOSED_CANDLE_REQUIRED
    if any("contract_version" in str(item.get("loc", "")) for item in error.errors()):
        return ReasonCode.CONTRACT_UNSUPPORTED
    return ReasonCode.DATA_INCOMPLETE


def _decision_id(request_id: str, decision: Decision) -> str:
    payload = json.dumps(
        {
            "request_id": request_id,
            "decision_type": decision.decision_type.value,
            "reason_codes": [code.value for code in decision.reason_codes],
            "new_stoploss": decision.new_stoploss,
            "custom_exit_reason": decision.custom_exit_reason,
            "evidence_snapshot": decision.evidence_snapshot.model_dump(mode="json"),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:24]
    return f"yash:{digest}"
