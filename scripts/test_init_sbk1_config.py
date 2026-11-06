import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from scripts.init_sbk1_config import initialize


ROOT = Path(__file__).resolve().parents[1]


class PrivateConfigInitializationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        shutil.copyfile(ROOT / ".env.example", self.root / ".env.example")
        config_directory = self.root / "freqtrade_integration"
        config_directory.mkdir()
        shutil.copyfile(
            ROOT / "freqtrade_integration" / "config.example.json",
            config_directory / "config.example.json",
        )

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_creates_matching_private_settings_with_restricted_permissions(self):
        env_path, config_path = initialize(self.root)
        env_values = dict(
            line.split("=", 1)
            for line in env_path.read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#") and "=" in line
        )
        config = json.loads(config_path.read_text(encoding="utf-8"))

        self.assertEqual(env_values["FREQTRADE_PAIR"], env_values["SBK1_FREQTRADE_PAIR"])
        self.assertEqual(
            env_values["SBK1_FREQTRADE_PAIRS"].split(","),
            config["exchange"]["pair_whitelist"],
        )
        self.assertEqual(env_values["FREQTRADE_USERNAME"], config["api_server"]["username"])
        self.assertEqual(env_values["FREQTRADE_PASSWORD"], config["api_server"]["password"])
        self.assertEqual(env_values["FREQTRADE_USERNAME"], env_values["FREQTRADE__API_SERVER__USERNAME"])
        self.assertEqual(env_values["FREQTRADE_PASSWORD"], env_values["FREQTRADE__API_SERVER__PASSWORD"])
        self.assertRegex(env_values["ADMIN_TOKEN"], r"^[a-f0-9]{64}$")
        self.assertRegex(env_values["SBK1_FREQTRADE_BRIDGE_TOKEN"], r"^[a-f0-9]{64}$")
        self.assertEqual(config["dry_run"], True)
        self.assertEqual(config["stake_amount"], "unlimited")
        self.assertEqual(config["max_open_trades"], 3)
        self.assertEqual(env_values["SBK1_SIGNAL_RISK_PCT"], "1")
        self.assertEqual(env_values["SBK1_SIGNAL_MAX_LEVERAGE"], "25")
        self.assertEqual(env_values["SBK1_SIGNAL_MAX_STAKE_QUOTE"], "1000000000")
        self.assertEqual(env_values["SBK1_SIGNAL_RISK_BUDGET_PCT"], "10")
        self.assertEqual(env_values["SBK1_SIGNAL_DAILY_LOSS_LIMIT_PCT"], "10")
        self.assertEqual(config["exchange"]["name"], env_values["SBK1_SIGNAL_EXCHANGE"])
        self.assertIn(env_values["FREQTRADE_PAIR"], config["exchange"]["pair_whitelist"])
        self.assertEqual(config["timeframe"], env_values["SBK1_FREQTRADE_TIMEFRAME"])
        if os.name != "nt":
            self.assertEqual(env_path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(config_path.stat().st_mode & 0o777, 0o600)

    def test_refuses_to_overwrite_existing_private_settings(self):
        env_path, config_path = initialize(self.root)
        original_env = env_path.read_text(encoding="utf-8")
        original_config = config_path.read_bytes()
        env_path.write_text(original_env + "# local change\n", encoding="utf-8")
        changed_env = env_path.read_text(encoding="utf-8")

        with self.assertRaises(FileExistsError):
            initialize(self.root)

        self.assertEqual(env_path.read_text(encoding="utf-8"), changed_env)
        self.assertEqual(config_path.read_bytes(), original_config)

    def test_rejects_pair_or_market_template_mismatch_before_writing(self):
        config_path = self.root / "freqtrade_integration" / "config.example.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["exchange"]["pair_whitelist"] = ["ETH/USDT:USDT"]
        config_path.write_text(json.dumps(config), encoding="utf-8")

        with self.assertRaises(ValueError):
            initialize(self.root)

        self.assertFalse((self.root / ".env").exists())
        self.assertFalse((self.root / "freqtrade" / "user_data" / "config.json").exists())


if __name__ == "__main__":
    unittest.main()
