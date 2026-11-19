"""
One-off database tasks, run by invoking the Lambda directly (never over HTTP):

    aws lambda invoke --function-name <api-service function> \\
        --cli-binary-format raw-in-base64-out \\
        --payload '{"action": "init_db", "admin": {"name": "...", "email": "...@acme.inc", "password": "..."}}' out.json

Direct invocation needs AWS credentials with lambda:InvokeFunction; the public
Function URL only ever reaches the web API (see function.py). On AWS the Aurora
database has no public address, so this is how its tables get created.

Actions
-------
status    tables present? how many users and incidents? is the JWT secret set?
init_db   EMPTY database only: create the tables (sql/schema.sql), optionally the
          sample data (seed: true), an admin account (admin: {...}), and a random
          JWT signing key. Refuses if tables already exist.
migrate   run every additive migration in sql/migrations (safe to repeat) and make
          sure the JWT signing key exists. Use after deploying a new version.
"""

import re
import secrets
from pathlib import Path

from sqlalchemy import Engine, text

from app.core import config
from app.core.security import hash_password

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"
EMAIL_RE = re.compile(rf"^[^@\s]+@{re.escape(config.ACME_EMAIL_DOMAIN)}$", re.IGNORECASE)


def _engine() -> Engine:
    from app.db.session import engine
    return engine


def _run_script(engine: Engine, path: Path) -> None:
    """Run a .sql file as-is (it manages its own BEGIN/COMMIT)."""
    raw = engine.raw_connection()
    try:
        raw.driver_connection.autocommit = True
        raw.driver_connection.execute(path.read_text())
    finally:
        # Back to normal before the connection returns to the pool, or later
        # requests would silently lose their transactions
        raw.driver_connection.autocommit = False
        raw.close()


def _has_tables(conn) -> bool:
    return conn.execute(text("SELECT to_regclass('public.users') IS NOT NULL")).scalar()


def _ensure_jwt_secret(conn) -> bool:
    """Store a random 256-bit signing key unless one exists. True if it created one."""
    created = conn.execute(
        text("INSERT INTO app_secrets (name, value) VALUES ('jwt_secret', :v) ON CONFLICT (name) DO NOTHING"),
        {"v": secrets.token_hex(32)},
    ).rowcount
    return bool(created)


def _check_admin(admin: dict | None) -> dict | None:
    if admin is None:
        return None
    name = str(admin.get("name", "")).strip()
    email = str(admin.get("email", "")).strip().lower()
    password = str(admin.get("password", ""))
    problems = []
    if not name:
        problems.append("admin.name is required")
    if not EMAIL_RE.match(email):
        problems.append(f"admin.email must be an @{config.ACME_EMAIL_DOMAIN} address")
    if not config.MIN_PASSWORD_LENGTH <= len(password) <= 72:
        problems.append(f"admin.password must be {config.MIN_PASSWORD_LENGTH} to 72 characters")
    if problems:
        raise ValueError("; ".join(problems))
    return {"name": name, "email": email, "password": password}


def status(engine: Engine | None = None) -> dict:
    engine = engine or _engine()
    with engine.connect() as conn:
        if not _has_tables(conn):
            return {"ok": True, "tables": False, "message": "The database is empty. Run init_db."}
        counts = conn.execute(text(
            "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM incidents), "
            "(SELECT count(*) FROM users WHERE role = 'facility_admin' AND is_active)"
        )).one()
        # Two queries: PostgreSQL checks every table a query names before running it,
        # so a database from before migration 005 would fail a combined check
        has_secret = conn.execute(text("SELECT to_regclass('public.app_secrets') IS NOT NULL")).scalar() and \
            conn.execute(text("SELECT EXISTS (SELECT 1 FROM app_secrets WHERE name = 'jwt_secret')")).scalar()
    return {
        "ok": True, "tables": True, "users": counts[0], "incidents": counts[1], "admins": counts[2],
        "jwt_secret": bool(has_secret),
    }


def init_db(seed: bool = False, admin: dict | None = None, engine: Engine | None = None) -> dict:
    engine = engine or _engine()
    admin = _check_admin(admin)
    if not seed and admin is None:
        raise ValueError("Give an admin account (admin: {name, email, password}) or seed: true, "
                         "otherwise nobody could sign in.")
    with engine.connect() as conn:
        if _has_tables(conn):
            return {"ok": False, "message": "Tables already exist, so nothing was changed. "
                                            "To add new tables or columns, run the migrate action."}

    _run_script(engine, SQL_DIR / "schema.sql")
    if seed:
        _run_script(engine, SQL_DIR / "seed.sql")
    with engine.begin() as conn:
        if admin:
            conn.execute(
                text("INSERT INTO users (full_name, email, password_hash, role, department) "
                     "VALUES (:name, :email, :hash, 'facility_admin', 'Facilities') "
                     "ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, "
                     "role = 'facility_admin', is_active = TRUE"),
                {"name": admin["name"], "email": admin["email"], "hash": hash_password(admin["password"])},
            )
        _ensure_jwt_secret(conn)

    message = "Database created."
    if seed:
        message += " Sample data loaded: every sample account's password is Password123!, change or remove them."
    if admin:
        message += f" Admin {admin['email']} can sign in."
    return {"ok": True, "message": message, **status(engine)}


def migrate(engine: Engine | None = None) -> dict:
    engine = engine or _engine()
    with engine.connect() as conn:
        if not _has_tables(conn):
            return {"ok": False, "message": "The database is empty. Run init_db first."}
    ran = []
    for path in sorted((SQL_DIR / "migrations").glob("*.sql")):
        _run_script(engine, path)
        ran.append(path.name)
    with engine.begin() as conn:
        created = _ensure_jwt_secret(conn)
    return {"ok": True, "migrations": ran, "jwt_secret_created": created, **status(engine)}


ACTIONS = {"status", "init_db", "migrate"}


def run(event: dict) -> dict:
    """Entry point from function.handler for a direct (non-HTTP) invocation."""
    action = event.get("action")
    if action not in ACTIONS:
        return {"ok": False, "message": f"Unknown action {action!r}. Use one of: {', '.join(sorted(ACTIONS))}."}
    try:
        if action == "status":
            return status()
        if action == "init_db":
            return init_db(seed=bool(event.get("seed")), admin=event.get("admin"))
        return migrate()
    except ValueError as exc:
        return {"ok": False, "message": str(exc)}
