import json
import os
import re
import secrets
from pathlib import Path


def _set_env_value(contents: str, name: str, value: str) -> str:
    pattern = re.compile(rf"(?m)^{re.escape(name)}=.*$")
    updated, replacements = pattern.subn(f"{name}={value}", contents)
    if replacements != 1:
        raise ValueError(f"Expected one {name} entry in .env.example.")
    return updated


def _create_private_file(path: Path, contents: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as private_file:
        private_file.write(contents)
        private_file.flush()
        os.fsync(private_file.fileno())
    if os.name != "nt":
        os.chmod(path, 0o600)


def initialize(root: Path) -> tuple[Path, Path]:
    env_path = root / ".env"
    config_path = root / "freqtrade" / "user_data" / "config.json"
    if env_path.exists() or config_path.exists():
        existing = [str(path.relative_to(root)) for path in (env_path, config_path) if path.exists()]
        raise FileExistsError(
            f"Refusing to overwrite existing private settings: {', '.join(existing)}. "
            "Back them up and reconcile them manually."
        )

    env_template = (root / ".env.example").read_text(encoding="utf-8")
    config_template = json.loads(
        (root / "freqtrade_integration" / "config.example.json").read_text(encoding="utf-8")
    )
    pair_match = re.search(r"(?m)^SBK1_FREQTRADE_PAIR=(.+)$", env_template)
    exchange_match = re.search(r"(?m)^SBK1_SIGNAL_EXCHANGE=(.+)$", env_template)
    timeframe_match = re.search(r"(?m)^SBK1_FREQTRADE_TIMEFRAME=(.+)$", env_template)
    if not pair_match or not exchange_match or not timeframe_match:
        raise ValueError("The environment template is missing the SBK1 market settings.")

    pair = pair_match.group(1).strip()
    exchange = exchange_match.group(1).strip().lower()
    timeframe = timeframe_match.group(1).strip()
    api = config_template.get("api_server", {})
    config_pair = config_template.get("exchange", {}).get("pair_whitelist", [])
    if (
        config_template.get("dry_run") is not True
        or config_template.get("strategy") != "SbkSignalStrategy"
        or config_template.get("trading_mode") not in ("spot", "futures")
        or config_template.get("timeframe") != timeframe
        or str(config_template.get("exchange", {}).get("name", "")).lower() != exchange
        or pair not in config_pair
        or api.get("enabled") is not True
        or api.get("listen_ip_address") not in ("127.0.0.1", "::1", "localhost")
    ):
        raise ValueError("The private config template does not match the SBK1 exchange, pair, timeframe, or dry-run requirements.")

    admin_token = secrets.token_hex(32)
    bridge_token = secrets.token_hex(32)
    rpc_username = f"sbk1_{secrets.token_hex(8)}"
    rpc_password = secrets.token_hex(32)
    config_template["api_server"]["username"] = rpc_username
    config_template["api_server"]["password"] = rpc_password
    config_template["api_server"]["jwt_secret_key"] = secrets.token_urlsafe(48)

    for name, value in (
        ("ADMIN_TOKEN", admin_token),
        ("FREQTRADE_USERNAME", rpc_username),
        ("FREQTRADE_PASSWORD", rpc_password),
        ("FREQTRADE__API_SERVER__USERNAME", rpc_username),
        ("FREQTRADE__API_SERVER__PASSWORD", rpc_password),
        ("FREQTRADE_PAIR", pair),
        ("SBK1_FREQTRADE_BRIDGE_TOKEN", bridge_token),
    ):
        env_template = _set_env_value(env_template, name, value)

    config_path.parent.mkdir(parents=True, exist_ok=True)
    _create_private_file(config_path, json.dumps(config_template, indent=2) + "\n")
    _create_private_file(env_path, env_template)
    return env_path, config_path


if __name__ == "__main__":
    repository_root = Path(__file__).resolve().parents[1]
    try:
        created_env, created_config = initialize(repository_root)
    except (FileExistsError, ValueError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"SBK1 private configuration setup failed: {error}") from error
    print(f"Created private settings: {created_env.name} and {created_config.relative_to(repository_root)}")
    print("Generated credentials and tokens were not printed. Review the private files before startup.")
