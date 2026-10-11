import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "freqtrade_integration" / "strategies"))

from sbk_signal_contract import orphaned_submitted_signal_ids


class OrphanedSubmittedSignalTests(unittest.TestCase):
    def test_only_submitted_signals_without_open_freqtrade_trades_are_orphaned(self):
        records = [
            {"status": "ORDER_SUBMITTED", "signal": {"signalId": "cancelled"}},
            {"status": "ORDER_SUBMITTED", "signal": {"signalId": "open"}},
            {"status": "ACCEPTED", "signal": {"signalId": "not-submitted"}},
            {"status": "FILLED", "signal": {"signalId": "filled"}},
            {"status": "ORDER_SUBMITTED", "signal": {}},
            None,
        ]

        self.assertEqual(
            orphaned_submitted_signal_ids(records, {"open", "filled"}),
            ["cancelled"],
        )


if __name__ == "__main__":
    unittest.main()
