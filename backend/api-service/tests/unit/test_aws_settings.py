"""On AWS (IS_LOCAL=false) the app requires TLS, waits for a paused Aurora, and has
no derived JWT key - it uses the random one stored by init_db."""

import json
import os
import subprocess
import sys
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[2]


def settings(**env):
    code = ("import json; from app.core import config; print(json.dumps({"
            "'local': config.IS_LOCAL, 'ssl': config.DB_SSLMODE, 'timeout': config.DB_CONNECT_TIMEOUT, "
            "'jwt': config.JWT_SECRET}))")
    clean = {k: v for k, v in os.environ.items() if k not in ("IS_LOCAL", "JWT_SECRET", "DB_SSLMODE")}
    out = subprocess.run([sys.executable, "-c", code], cwd=SERVICE, env={**clean, **env},
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_aws_requires_tls_waits_longer_and_has_no_derived_key():
    s = settings(IS_LOCAL="false")
    assert (s["local"], s["ssl"], s["timeout"], s["jwt"]) == (False, "require", 10, None)


def test_local_keeps_the_relaxed_defaults():
    s = settings(IS_LOCAL="true")
    assert (s["local"], s["ssl"], s["timeout"]) == (True, "prefer", 15)
    assert s["jwt"] and len(s["jwt"]) == 64  # derived locally


def test_an_explicit_secret_always_wins():
    assert settings(IS_LOCAL="false", JWT_SECRET="from-env")["jwt"] == "from-env"
