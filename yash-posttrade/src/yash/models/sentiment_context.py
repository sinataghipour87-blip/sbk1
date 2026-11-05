"""Optional plugin interface for text sentiment context models."""

from __future__ import annotations

from typing import Protocol

from yash.contracts.models import ModelEvidence


class SentimentContextModel(Protocol):
    """Return sentiment evidence; implementations may wrap a lightweight FinBERT model."""

    def analyze(self, text: str, observed_at_ms: int) -> ModelEvidence: ...
