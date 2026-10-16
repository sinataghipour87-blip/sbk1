import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from scripts.realistic_backtester import (
    generate_synthetic_btc_ohlcv,
    load_freqtrade_feather,
    run_comprehensive_institutional_backtest,
)


class FreqtradeFeatherLoaderTests(unittest.TestCase):
    def setUp(self):
        now = pd.Timestamp.now(tz="UTC").floor("15min")
        dates = pd.date_range(end=now, periods=203, freq="15min")
        self.frame = pd.DataFrame({
            "date": dates,
            "open": [100.0] * len(dates),
            "high": [101.0] * len(dates),
            "low": [99.0] * len(dates),
            "close": [100.0] * len(dates),
            "volume": [10.0] * len(dates),
        })

    def load_frame(self, frame):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_file = Path(temp_dir) / "BTC_USDT_USDT-15m-futures.feather"
            data_file.touch()
            with patch("pandas.read_feather", return_value=frame):
                return load_freqtrade_feather(data_file)

    def test_reads_completed_freqtrade_candles_and_omits_open_candle(self):
        candles = self.load_frame(self.frame)

        self.assertEqual(len(candles), 202)
        self.assertEqual(candles[0]["open"], 100.0)
        self.assertLess(candles[-1]["timestamp"], int(self.frame.iloc[-1]["date"].timestamp() * 1000))

    def test_rejects_missing_intervals(self):
        frame_with_gap = self.frame.drop(index=50).reset_index(drop=True)

        with self.assertRaisesRegex(ValueError, "missing or irregular"):
            self.load_frame(frame_with_gap)

    def test_rejects_invalid_ohlc_geometry(self):
        invalid_frame = self.frame.copy()
        invalid_frame.loc[0, "high"] = 99.5

        with self.assertRaisesRegex(ValueError, "invalid OHLCV geometry"):
            self.load_frame(invalid_frame)


class ResearchBacktestAuthorizationTests(unittest.TestCase):
    def test_research_metrics_never_authorize_live_trading(self):
        candles = generate_synthetic_btc_ohlcv(300)
        result = run_comprehensive_institutional_backtest(
            candles,
            is_synthetic=True,
            data_source="SYNTHETIC_TEST",
        )

        self.assertFalse(result["is_live_trading_permitted"])
        self.assertFalse(result["metadata"]["is_real_historical_data"])
        self.assertFalse(result["metadata"]["historical_source_verified"])


if __name__ == "__main__":
    unittest.main()
