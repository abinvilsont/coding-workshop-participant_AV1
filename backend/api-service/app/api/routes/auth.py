from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import FieldError
from app.api.deps import CurrentUser, DbSession, bearer
from app.core import config
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.models import User, UserRole
from app.schemas.auth import LoginIn, LoginOut, RegisterIn, RegisterOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=RegisterOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: DbSession):
    """Employee self-registration (acme.inc emails only). Other roles are admin-managed."""
    user = User(
        full_name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role=UserRole.EMPLOYEE,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise FieldError(status.HTTP_409_CONFLICT, "email", "An account with this email already exists.") from exc
    return {"user": UserOut.from_user(user)}


@router.post("/login", response_model=LoginOut)
def login(body: LoginIn, db: DbSession):
    """Sign in any persona; returns a bearer token valid for 8 hours."""
    user = db.scalar(select(User).where(User.email == body.email))
    if not verify_password(body.password, user.password_hash if user else None) or user is None:
        raise FieldError(status.HTTP_401_UNAUTHORIZED, "password", "Invalid email or password.")
    if not user.is_active:
        raise FieldError(status.HTTP_403_FORBIDDEN, "email", "Your account is disabled. Contact your Facility Admin.")

    db.execute(update(User).where(User.id == user.id).values(last_login_at=func.now()))
    db.commit()
    token = create_access_token(user.id, user.role)
    return {"token": token, "user": UserOut.from_user(user), "session_expires_at": _session_end(token)}


def _session_end(token: str) -> datetime:
    auth_time = decode_access_token(token)["auth_time"]
    return datetime.fromtimestamp(auth_time + config.MAX_SESSION_HOURS * 3600, timezone.utc)


@router.post("/refresh", response_model=LoginOut)
def refresh(user: CurrentUser, creds: HTTPAuthorizationCredentials = Depends(bearer)):
    """Swap a still-valid token for a fresh one (another 8 hours), up to 24 hours after
    the original sign-in. The role and active status come from the database, so a
    changed role or a deactivated account takes effect here too."""
    claims = decode_access_token(creds.credentials)  # already verified by CurrentUser
    auth_time = int(claims.get("auth_time") or claims["iat"])
    now = datetime.now(timezone.utc).timestamp()
    if now - auth_time >= config.MAX_SESSION_HOURS * 3600:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has reached its 24-hour limit. Please sign in again.")
    token = create_access_token(user.id, user.role, auth_time=auth_time)
    return {"token": token, "user": UserOut.from_user(user), "session_expires_at": _session_end(token)}


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    """The signed-in user (useful to validate a stored token)."""
    return UserOut.from_user(user)
