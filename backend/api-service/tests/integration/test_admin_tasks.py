"""The Lambda's one-off database tasks (init_db / migrate / status) and the stored JWT key."""

import psycopg
import pytest
from sqlalchemy import create_engine, text

import function
from app import admin_tasks
from app.core import config, security
from app.core.security import verify_password
from tests.integration.conftest import _conninfo

FRESH = "facility_desk_init_test"
ADMIN = {"name": "Ada Admin", "email": "Ada.Admin@acme.inc", "password": "a-long-password"}


@pytest.fixture
def empty_db(seed_conn):
    """A brand-new, empty database and an engine for it."""
    admin = psycopg.connect(**_conninfo("postgres"), autocommit=True)
    admin.execute(f'DROP DATABASE IF EXISTS "{FRESH}" WITH (FORCE)')
    admin.execute(f'CREATE DATABASE "{FRESH}"')
    info = _conninfo(FRESH)
    engine = create_engine(
        f"postgresql+psycopg://{info['user']}:{info['password']}@{info['host']}:{info['port']}/{FRESH}",
        pool_size=1, max_overflow=0,
    )
    yield engine
    engine.dispose()
    admin.execute(f'DROP DATABASE IF EXISTS "{FRESH}" WITH (FORCE)')
    admin.close()


def scalar(engine, sql):
    with engine.connect() as conn:
        return conn.execute(text(sql)).scalar()


def test_init_db_creates_everything_with_one_admin(empty_db):
    assert admin_tasks.status(empty_db) == {"ok": True, "tables": False, "message": "The database is empty. Run init_db."}

    result = admin_tasks.init_db(admin=ADMIN, engine=empty_db)
    assert result["ok"] is True
    assert result["message"] == "Database created. Admin ada.admin@acme.inc can sign in."
    assert (result["users"], result["admins"], result["incidents"], result["jwt_secret"]) == (1, 1, 0, True)

    row_hash = scalar(empty_db, "SELECT password_hash FROM users WHERE email = 'ada.admin@acme.inc'")
    assert verify_password(ADMIN["password"], row_hash)
    secret = scalar(empty_db, "SELECT value FROM app_secrets WHERE name = 'jwt_secret'")
    assert len(secret) == 64 and int(secret, 16)  # 256 random bits, hex
    # the pooled connection is back to normal transactions afterwards
    with empty_db.connect() as conn:
        assert conn.connection.driver_connection.autocommit is False


def test_init_db_refuses_a_database_that_has_tables(empty_db):
    admin_tasks.init_db(admin=ADMIN, engine=empty_db)
    again = admin_tasks.init_db(admin={**ADMIN, "email": "eve@acme.inc"}, engine=empty_db)
    assert again["ok"] is False and "nothing was changed" in again["message"]
    assert scalar(empty_db, "SELECT count(*) FROM users") == 1


def test_init_db_with_sample_data_warns_about_the_passwords(empty_db):
    result = admin_tasks.init_db(seed=True, engine=empty_db)
    assert result["ok"] and "Password123!" in result["message"]
    assert result["users"] == 17 and result["incidents"] == 7 and result["jwt_secret"]


@pytest.mark.parametrize("kwargs, problem", [
    ({}, "otherwise nobody could sign in"),
    ({"admin": {**ADMIN, "email": "ada@gmail.com"}}, "@acme.inc"),
    ({"admin": {**ADMIN, "password": "short"}}, "8 to 72 characters"),
    ({"admin": {**ADMIN, "name": " "}}, "admin.name is required"),
])
def test_init_db_checks_its_input_before_touching_anything(empty_db, kwargs, problem):
    with pytest.raises(ValueError, match=problem):
        admin_tasks.init_db(engine=empty_db, **kwargs)
    assert admin_tasks.status(empty_db)["tables"] is False


def test_migrate_is_safe_to_repeat_and_restores_a_missing_key(empty_db):
    assert admin_tasks.migrate(empty_db)["ok"] is False  # empty: init first
    admin_tasks.init_db(admin=ADMIN, engine=empty_db)
    with empty_db.begin() as conn:
        conn.execute(text("DELETE FROM app_secrets"))
    first = admin_tasks.migrate(empty_db)
    assert first["ok"] and first["jwt_secret_created"] is True
    assert first["migrations"] == [
        "001_notifications.sql", "002_incident_merge.sql", "003_engineer_reviews.sql",
        "004_escalation_requests.sql", "005_app_secrets.sql", "006_user_home_building.sql", "007_open_means_unassigned.sql",
    ]
    second = admin_tasks.migrate(empty_db)
    assert second["ok"] and second["jwt_secret_created"] is False and second["users"] == 1


def test_status_works_on_a_database_from_before_the_secrets_table(empty_db):
    admin_tasks.init_db(admin=ADMIN, engine=empty_db)
    with empty_db.begin() as conn:
        conn.execute(text("DROP TABLE app_secrets"))  # as an existing database before migration 005
    assert admin_tasks.status(empty_db)["jwt_secret"] is False
    assert admin_tasks.migrate(empty_db)["jwt_secret"] is True


def test_lambda_runs_tasks_only_for_direct_invocations(seed_conn):
    # direct invoke -> task (against the test database the app is configured for)
    assert function.handler({"action": "status"}, None)["tables"] is True
    assert function.handler({"action": "drop_everything"}, None) == {
        "ok": False, "message": "Unknown action 'drop_everything'. Use one of: init_db, migrate, status.",
    }
    assert function.handler({"action": "init_db"}, None)["ok"] is False  # bad input is reported, not raised
    # anything with an HTTP request context still goes to the web API, even with an "action" key
    from tests.integration.test_api_contract import url_event
    event = url_event("GET", "/api/api-service/health")
    event["action"] = "init_db"
    assert function.handler(event, None)["statusCode"] == 200


def test_tokens_use_the_stored_key_when_no_secret_is_configured(seed_conn, monkeypatch):
    seed_conn.execute("INSERT INTO app_secrets (name, value) VALUES ('jwt_secret', 'stored-key') "
                      "ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value")
    monkeypatch.setattr(config, "JWT_SECRET", None)
    monkeypatch.setattr(security, "_stored_secret", None)
    token = security.create_access_token(1, "facility_admin")
    import jwt
    assert jwt.decode(token, "stored-key", algorithms=["HS256"])["sub"] == "1"
    assert security.decode_access_token(token)["role"] == "facility_admin"

    seed_conn.execute("DELETE FROM app_secrets")
    monkeypatch.setattr(security, "_stored_secret", None)
    with pytest.raises(RuntimeError, match="Run the Lambda's init_db"):
        security.create_access_token(1, "facility_admin")
