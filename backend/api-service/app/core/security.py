"""Password hashing (bcrypt) and access tokens (JWT)."""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from sqlalchemy import text

from app.core import config

# Compared against when an email is unknown, so login timing doesn't reveal it
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt(10))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    stored = password_hash.encode() if password_hash else _DUMMY_HASH
    ok = bcrypt.checkpw(password.encode()[:72], stored)
    return ok and password_hash is not None


_stored_secret: str | None = None  # cached for the life of the Lambda instance


def jwt_secret() -> str:
    """The token-signing key: JWT_SECRET / the local fallback (config), else the
    random secret stored in the database by the init_db task (AWS)."""
    global _stored_secret
    if config.JWT_SECRET:
        return config.JWT_SECRET
    if _stored_secret is None:
        from app.db.session import engine  # imported late: config must load first
        with engine.connect() as conn:
            value = conn.execute(text("SELECT value FROM app_secrets WHERE name = 'jwt_secret'")).scalar()
        if not value:
            raise RuntimeError("No JWT secret in app_secrets. Run the Lambda's init_db (or migrate) task first.")
        _stored_secret = value
    return _stored_secret


def create_access_token(user_id: int, role: str, auth_time: int | None = None) -> str:
    """`auth_time` = when the user originally signed in (kept across refreshes)."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=config.TOKEN_TTL_HOURS),
        "auth_time": auth_time if auth_time is not None else int(now.timestamp()),
    }
    return jwt.encode(payload, jwt_secret(), algorithm=config.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises jwt.InvalidTokenError (incl. ExpiredSignatureError) on failure."""
    return jwt.decode(token, jwt_secret(), algorithms=[config.JWT_ALGORITHM])
