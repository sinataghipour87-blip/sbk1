import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.prediction_archive import (
    ArchiveValidationError,
    append_record,
    archive_freqtrade_closed_trades,
    calibration_status,
    import_local_records,
    list_records,
)


def candidate_record():
    return {
        "decisionTimestampMs": 1_700_000_000_000,
        "pair": "BTC/USDT",
        "timeframe": "15m",
        "direction": "LONG",
        "entry": 50_000.0,
        "stop": 49_500.0,
        "target": 51_000.0,
        "featureSnapshot": {
            "features": {
                "ticker": {
                    "value": 50_000.0,
                    "timestampMs": 1_699_999_999_000,
                },
                "missingFeature": {"value": None, "timestampMs": None},
            },
        },
        "modelVersion": "test-model",
        "predictorVersion": "test-predictor",
        "dataQualityReport": {"status": "LIVE", "timestampMs": 1_699_999_999_500},
        "gateResult": {"eligible": False, "reasons": ["CALIBRATED_CONFIDENCE_UNAVAILABLE"]},
        "source": "SBK1_DECISION",
    }


def closed_rpc_trade(trade_id, signal_id=None, **overrides):
    trade = {
        "trade_id": trade_id,
        "pair": "BTC/USDT:USDT",
        "is_open": False,
        "is_short": False,
        "open_rate": 50_010.0,
        "open_timestamp": 1_700_000_001_000,
        "open_fill_timestamp": 1_700_000_002_000,
        "close_rate": 50_100.0,
        "close_timestamp": 1_700_000_003_000,
        "fee_open": 0.001,
        "fee_open_cost": 0.05,
        "fee_open_currency": "USDT",
        "fee_close": 0.001,
        "fee_close_cost": 0.05,
        "fee_close_currency": "USDT",
        "close_profit": 0.001,
        "close_profit_pct": 0.1,
        "close_profit_abs": 5.0,
        "exit_reason": "roi",
        "enter_tag": signal_id,
        "signalId": signal_id,
    }
    trade.update(overrides)
    return trade


class PredictionArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary_directory.name) / "archive.sqlite"

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_feature_snapshot_cannot_be_modified_after_write(self):
        append_record(candidate_record(), self.database)
        with sqlite3.connect(self.database) as connection:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                connection.execute(
                    "UPDATE prediction_signals SET feature_snapshot_json = ?",
                    (json.dumps({"features": {"ticker": {"value": -1}}}),),
                )
            with self.assertRaisesRegex(sqlite3.IntegrityError, "append-only"):
                connection.execute("DELETE FROM prediction_signals")

        stored = list_records(path=self.database)["records"][0]
        self.assertEqual(stored["featureSnapshot"]["features"]["ticker"]["value"], 50_000.0)
        self.assertIsNone(stored["featureSnapshot"]["features"]["missingFeature"]["value"])

    def test_lookahead_features_are_rejected(self):
        record = candidate_record()
        record["featureSnapshot"]["features"]["future"] = {
            "value": 1,
            "timestampMs": record["decisionTimestampMs"] + 1,
        }
        with self.assertRaisesRegex(ArchiveValidationError, "later than the decision timestamp"):
            append_record(record, self.database)

    def test_feature_values_without_provenance_timestamps_are_rejected(self):
        record = candidate_record()
        record["featureSnapshot"]["features"]["untimed"] = {"value": 1}
        with self.assertRaisesRegex(ArchiveValidationError, "without a source timestamp"):
            append_record(record, self.database)

    def test_signal_ids_are_stable_for_identical_records(self):
        record = candidate_record()
        first = append_record(record, self.database)
        second = append_record(record, self.database)
        self.assertEqual(first["signalId"], second["signalId"])
        self.assertFalse(first["duplicate"])
        self.assertTrue(second["duplicate"])

        record = candidate_record()
        record["dataQualityReport"]["receivedAtMs"] = record["decisionTimestampMs"] + 1
        with self.assertRaisesRegex(ArchiveValidationError, "later than the decision timestamp"):
            append_record(record, self.database)

        record = candidate_record()
        record["datasetRecord"] = {"timestampMs": record["decisionTimestampMs"] + 1}
        with self.assertRaisesRegex(ArchiveValidationError, "later than the decision timestamp"):
            append_record(record, self.database)

    def test_imported_records_are_always_unverified_and_ineligible(self):
        record = candidate_record()
        record.update({
            "source": "UNVERIFIED_LOCAL",
            "gateResult": {"eligible": True, "reasons": []},
            "datasetRecord": {
                "predictionId": "legacy-prediction",
                "outcomeSource": "FREQTRADE_CONFIRMED",
                "freqtradeTradeId": 7,
                "outcome": "WIN",
                "executionStatus": "CLOSED_COMPLETED",
                "PnL": 25,
            },
        })
        append_record(record, self.database)
        stored = list_records(path=self.database)["records"][0]
        self.assertEqual(stored["source"], "UNVERIFIED_LOCAL")
        self.assertFalse(stored["gateResult"]["eligible"])
        self.assertIn(
            "UNVERIFIED_LOCAL_IMPORT_GATE_NOT_VERIFIED",
            stored["gateResult"]["reasons"],
        )
        self.assertEqual(stored["datasetRecord"]["outcomeSource"], "UNVERIFIED_LOCAL")
        self.assertIsNone(stored["datasetRecord"]["freqtradeTradeId"])
        self.assertIsNone(stored["datasetRecord"]["outcome"])

    def test_decision_append_cannot_claim_a_freqtrade_confirmed_outcome(self):
        record = candidate_record()
        record["datasetRecord"] = {
            "decisionId": "sbk1_" + "b" * 32,
            "outcomeSource": "FREQTRADE_CONFIRMED",
            "freqtradeTradeId": 91,
            "outcome": "WIN",
            "executionStatus": "CLOSED_COMPLETED",
            "PnL": 1000,
        }
        append_record(record, self.database)
        stored = list_records(path=self.database)["records"][0]
        self.assertEqual(stored["datasetRecord"]["outcomeSource"], "UNVERIFIED_LOCAL")
        self.assertIsNone(stored["datasetRecord"]["freqtradeTradeId"])
        self.assertIsNone(stored["datasetRecord"]["outcome"])
        self.assertIsNone(stored["datasetRecord"]["PnL"])
        self.assertIsNone(stored.get("outcome"))

    def test_local_storage_export_import_is_marked_unverified(self):
        legacy_record = {
            "predictionId": "legacy-id",
            "timestamp": 1_700_000_000_000,
            "market": "BTC/USDT",
            "timeframe": "15m",
            "direction": "LONG",
            "entryPrice": 50_000,
            "stopPrice": 49_500,
            "tpLevels": {"tp1": 51_000},
            "features": {"rsi": None},
            "modelVersion": "legacy-model",
            "featureVersion": "legacy-features",
            "outcomeSource": "FREQTRADE_CONFIRMED",
            "freqtradeTradeId": 9,
            "outcome": "WIN",
        }
        result = import_local_records([legacy_record], self.database)
        stored = list_records(path=self.database)["records"][0]
        self.assertEqual(len(result), 1)
        self.assertEqual(stored["source"], "UNVERIFIED_LOCAL")
        self.assertFalse(stored["gateResult"]["eligible"])
        self.assertEqual(stored["datasetRecord"]["outcomeSource"], "UNVERIFIED_LOCAL")
        self.assertIsNone(stored["datasetRecord"]["outcome"])

    def test_authenticated_closed_trade_is_joined_exactly_and_idempotently(self):
        decision = candidate_record()
        freqtrade_signal_id = "sbk1_" + "a" * 32
        decision["datasetRecord"] = {"decisionId": freqtrade_signal_id}
        append_record(decision, self.database)
        trade = closed_rpc_trade(41, freqtrade_signal_id)

        first = archive_freqtrade_closed_trades([trade], self.database)
        second = archive_freqtrade_closed_trades([trade], self.database)

        self.assertEqual(first["insertedCount"], 1)
        self.assertEqual(first["linkedCount"], 1)
        self.assertEqual(first["unmatched"], [])
        self.assertEqual(second["insertedCount"], 0)
        self.assertEqual(second["linkedCount"], 1)
        stored = list_records(path=self.database)["records"][0]
        self.assertEqual(stored["outcome"]["outcomeSource"], "FREQTRADE_CONFIRMED")
        self.assertEqual(stored["outcome"]["freqtradeTradeId"], 41)
        self.assertEqual(stored["outcome"]["entryPrice"], 50_010.0)
        self.assertEqual(stored["outcome"]["exitPrice"], 50_100.0)
        self.assertEqual(stored["outcome"]["fees"]["openCost"], 0.05)
        self.assertEqual(stored["outcome"]["totalFees"], 0.1)
        self.assertEqual(stored["datasetRecord"]["outcome"], "WIN")
        self.assertEqual(stored["datasetRecord"]["freqtradeTradeId"], 41)
        self.assertEqual(stored["datasetRecord"]["executionStatus"], "CLOSED_COMPLETED")
        with sqlite3.connect(self.database) as connection:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                connection.execute(
                    "UPDATE prediction_outcomes SET profit_abs = ? WHERE freqtrade_trade_id = ?",
                    (999.0, 41),
                )
            with self.assertRaisesRegex(sqlite3.IntegrityError, "append-only"):
                connection.execute(
                    "DELETE FROM prediction_outcomes WHERE freqtrade_trade_id = ?",
                    (41,),
                )

    def test_collection_decision_id_and_outcome_mode_are_preserved(self):
        signal_id = "sbk1_" + "c" * 32
        decision = candidate_record()
        decision.update({
            "signalId": signal_id,
            "collectionMode": "DRY_RUN_COLLECTION",
            "datasetRecord": {
                "decisionId": signal_id,
                "signalId": signal_id,
                "collectionMode": "DRY_RUN_COLLECTION",
            },
        })
        append_record(decision, self.database)
        trade = closed_rpc_trade(
            53,
            signal_id,
            enter_tag=f"DRY_RUN_COLLECTION:{signal_id}",
            executionMode="DRY_RUN",
        )
        archive_freqtrade_closed_trades([trade], self.database)

        record = list_records(path=self.database)["records"][0]
        status = calibration_status(self.database)
        self.assertEqual(record["signalId"], signal_id)
        self.assertEqual(record["collectionMode"], "DRY_RUN_COLLECTION")
        self.assertEqual(record["outcome"]["executionMode"], "DRY_RUN_COLLECTION")
        self.assertEqual(status["confirmedOutcomesByExecutionMode"]["DRY_RUN_COLLECTION"], 1)
        self.assertEqual(status["matchedOutcomesByExecutionMode"]["DRY_RUN_COLLECTION"], 1)
        self.assertEqual(status["calibrationEligibleMatchedOutcomes"], 0)
        self.assertEqual(status["remaining"]["training"], 40)

    def test_live_and_dry_run_outcome_counts_are_separate(self):
        signal_id = "sbk1_" + "e" * 32
        decision = candidate_record()
        decision["signalId"] = signal_id
        append_record(decision, self.database)
        archive_freqtrade_closed_trades([
            closed_rpc_trade(61, signal_id, executionMode="LIVE"),
            closed_rpc_trade(62, executionMode="DRY_RUN"),
        ], self.database)
        status = calibration_status(self.database)
        self.assertEqual(status["confirmedOutcomesByExecutionMode"]["LIVE"], 1)
        self.assertEqual(status["confirmedOutcomesByExecutionMode"]["DRY_RUN"], 1)
        self.assertEqual(status["confirmedOutcomesByExecutionMode"]["DRY_RUN_COLLECTION"], 0)
        self.assertEqual(status["calibrationEligibleExecutionMode"], "LIVE")
        self.assertEqual(status["calibrationEligibleMatchedOutcomes"], 1)
        self.assertEqual(status["remaining"]["training"], 39)

    def test_live_rpc_mode_cannot_authorize_collection_decision_for_calibration(self):
        signal_id = "sbk1_" + "d" * 32
        decision = candidate_record()
        decision.update({
            "signalId": signal_id,
            "collectionMode": "DRY_RUN_COLLECTION",
        })
        append_record(decision, self.database)
        archive_freqtrade_closed_trades([
            closed_rpc_trade(63, signal_id, executionMode="LIVE"),
        ], self.database)

        stored = list_records(path=self.database)["records"][0]
        self.assertEqual(stored["outcome"]["executionMode"], "UNAVAILABLE")
        status = calibration_status(self.database)
        self.assertEqual(status["confirmedOutcomesByExecutionMode"]["LIVE"], 0)
        self.assertEqual(status["confirmedOutcomesByExecutionMode"]["DRY_RUN_COLLECTION"], 0)
        self.assertEqual(status["confirmedOutcomesByExecutionMode"]["UNAVAILABLE"], 1)
        self.assertEqual(status["calibrationEligibleMatchedOutcomes"], 0)
        self.assertEqual(status["remaining"]["training"], 40)

    def test_unmatched_outcomes_are_reported_without_guessing_and_can_be_linked_later(self):
        decision = candidate_record()
        signal_id = append_record(decision, self.database)["signalId"]
        trade = closed_rpc_trade(42, "unknown-signal", close_profit_abs=-2.0)

        unmatched_result = archive_freqtrade_closed_trades([trade], self.database)
        self.assertEqual(unmatched_result["unmatched"][0]["reason"], "SIGNAL_NOT_ARCHIVED")
        before_link = calibration_status(self.database)
        self.assertEqual(before_link["confirmedOutcomes"], 1)
        self.assertEqual(before_link["matchedOutcomes"], 0)
        self.assertEqual(before_link["unmatchedOutcomes"][0]["freqtradeTradeId"], 42)

        trade["signalId"] = signal_id
        trade["enter_tag"] = signal_id
        linked_result = archive_freqtrade_closed_trades([trade], self.database)
        self.assertEqual(linked_result["linkedCount"], 1)
        self.assertEqual(linked_result["unmatched"], [])
        status = calibration_status(self.database)
        self.assertEqual(status["matchedOutcomes"], 1)
        self.assertEqual(status["matchedLosses"], 1)
        self.assertEqual(status["remaining"]["training"], 40)
        self.assertEqual(status["remaining"]["validation"], 20)
        self.assertEqual(status["remaining"]["outOfSample"], 200)
        self.assertEqual(status["remaining"]["wins"], 1)
        self.assertEqual(status["remaining"]["losses"], 1)

    def test_non_positive_or_open_rpc_trade_cannot_be_confirmed(self):
        with self.assertRaisesRegex(ArchiveValidationError, "positive integer"):
            archive_freqtrade_closed_trades([closed_rpc_trade(0)], self.database)
        with self.assertRaisesRegex(ArchiveValidationError, "not closed"):
            archive_freqtrade_closed_trades([closed_rpc_trade(43, is_open=True)], self.database)
        self.assertEqual(calibration_status(self.database)["confirmedOutcomes"], 0)


if __name__ == "__main__":
    unittest.main()
