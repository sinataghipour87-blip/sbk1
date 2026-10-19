from __future__ import annotations

import json
import os
from pathlib import Path

from transformers import AutoModelForSequenceClassification, AutoTokenizer

from freqtrade_integration.advisory.open_source_advisory_worker import (
    NEWS_MODEL,
    NEWS_MODEL_REVISION,
)


def main() -> None:
    cache_dir = Path(
        os.environ.get("SBK1_MODEL_CACHE_DIR", ".cache/sbk1/open-source-models")
    ).expanduser().resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    AutoTokenizer.from_pretrained(
        NEWS_MODEL,
        revision=NEWS_MODEL_REVISION,
        cache_dir=str(cache_dir),
        use_fast=True,
    )
    model = AutoModelForSequenceClassification.from_pretrained(
        NEWS_MODEL,
        revision=NEWS_MODEL_REVISION,
        cache_dir=str(cache_dir),
        use_safetensors=True,
    )
    labels = {int(index): str(label).lower() for index, label in model.config.id2label.items()}
    if (
        not any("positive" in label for label in labels.values())
        or not any("negative" in label for label in labels.values())
    ):
        raise RuntimeError("Pinned sentiment model does not expose positive and negative labels.")
    print(json.dumps({
        "model": NEWS_MODEL,
        "revision": NEWS_MODEL_REVISION,
        "cacheDir": str(cache_dir),
        "labels": labels,
        "weightsFormat": "safetensors",
    }, sort_keys=True))


if __name__ == "__main__":
    main()
