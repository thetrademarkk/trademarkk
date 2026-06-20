"""Shared Groww auth — mint ONCE, cache the daily access token, reuse everywhere.

Why this exists: the approval/"secret" flow (get_access_token(api_key, secret=...))
is rate-limited to roughly ONE mint and then returns
"Authorisation failed … does not have the required permissions" on re-mint until a
cooldown. The TOTP flow — get_access_token(api_key=GROWW_TOTP_TOKEN, totp=<pyotp>)
— mints reliably. Groww access tokens are valid for the trading day, so every ETL
script should reuse one cached token rather than minting per run/cron.

Cache: market-data/_etl_staging/.groww_token.json  (gitignored; never printed).
Resolved relative to THIS file so cwd doesn't matter.

READ-ONLY use only: this never imports or calls any order/position endpoint.
"""
from __future__ import annotations

import json
import os
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.normpath(os.path.join(_HERE, "..", ".."))
CACHE = os.path.join(_REPO, "market-data", "_etl_staging", ".groww_token.json")
ENV_PATH = os.path.join(_REPO, ".env.local")
MAX_AGE = 6 * 3600  # re-mint at most every 6h (token is valid for the trading day)


def load_env(path: str = ENV_PATH) -> dict[str, str]:
    env: dict[str, str] = {}
    if not os.path.exists(path):
        return env
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("'").strip('"')
    return env


def _mint(env: dict[str, str]) -> str:
    """Mint a fresh access token via the TOTP flow (the reliable path)."""
    import pyotp
    from growwapi import GrowwAPI

    seed = env["GROWW_TOTP_SECRET"]
    # The TOTP flow expects the TOTP api key (the JWT in GROWW_TOTP_TOKEN). Fall
    # back to GROWW_API_KEY only if the dedicated TOTP token isn't present.
    key = env.get("GROWW_TOTP_TOKEN") or env["GROWW_API_KEY"]
    code = pyotp.TOTP(seed).now()
    tok = GrowwAPI.get_access_token(api_key=key, totp=code)
    return tok.get("token") if isinstance(tok, dict) else tok


def get_token(env: dict[str, str] | None = None, *, cache: str = CACHE,
              max_age: float = MAX_AGE, force: bool = False) -> str:
    """Return a usable access token: cached if fresh, else mint + cache."""
    env = env or load_env()
    if not force and os.path.exists(cache):
        try:
            rec = json.load(open(cache, encoding="utf-8"))
            if rec.get("token") and (time.time() - rec.get("ts", 0)) < max_age:
                return rec["token"]
        except Exception:
            pass
    tok = _mint(env)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as fh:
        json.dump({"token": tok, "ts": time.time(), "via": "totp"}, fh)
    return tok


def get_client(env: dict[str, str] | None = None):
    """Construct a ready GrowwAPI client from a cached/fresh token."""
    from growwapi import GrowwAPI

    return GrowwAPI(get_token(env))


if __name__ == "__main__":
    # Self-test: prove the cached token actually authorizes a data call.
    g = get_client()
    instr = g.get_all_instruments()
    n = len(instr) if hasattr(instr, "__len__") else "?"
    print(f"groww_auth OK — instruments={n}")
