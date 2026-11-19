"""
People (Facility Admin only): see every account, promote an employee to Facility
Admin or back, and deactivate or reactivate accounts.

Engineers are managed on /engineers instead: their profile, capacity and the
"no active tickets" rule for deactivation live there.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from app.api.deps import AdminUser, DbSession
from app.core.errors import FieldError
from app.models import User, UserRole
from app.services import notifications as notify

router = APIRouter(prefix="/users", tags=["users"])

MANAGED_HERE = {UserRole.EMPLOYEE, UserRole.FACILITY_ADMIN}
ROLE_TEXT = {UserRole.EMPLOYEE: "an Employee", UserRole.FACILITY_ADMIN: "a Facility Admin"}


class UserRow(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    department: str | None
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class UserList(BaseModel):
    items: list[UserRow]
    total: int


class UserUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None


def _row(u: User) -> dict:
    return {
        "id": u.id, "name": u.full_name, "email": u.email, "role": u.role, "department": u.department,
        "is_active": u.is_active, "created_at": u.created_at, "last_login_at": u.last_login_at,
    }


@router.get("", response_model=UserList)
def list_users(
    db: DbSession,
    _admin: AdminUser,
    role: UserRole | None = None,
    include_inactive: bool = False,
    q: str | None = Query(default=None, max_length=100, description="Search name or email"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """Every account, admins first, then by name."""
    where = []
    if role:
        where.append(User.role == role)
    if not include_inactive:
        where.append(User.is_active)
    if q:
        like = f"%{q.strip()}%"
        where.append(or_(User.full_name.ilike(like), User.email.ilike(like)))
    total = db.scalar(select(func.count()).select_from(User).where(*where))
    rows = db.scalars(
        select(User).where(*where)
        .order_by((User.role == UserRole.FACILITY_ADMIN).desc(), User.full_name)
        .limit(limit).offset(offset)
    ).all()
    return {"items": [_row(u) for u in rows], "total": total}


@router.put("/{user_id}", response_model=UserRow)  # PUT is accepted as an alias of PATCH
@router.patch("/{user_id}", response_model=UserRow)
def update_user(user_id: int, body: UserUpdate, db: DbSession, admin: AdminUser):
    """Change an employee's or admin's role, or (de)activate their account.
    A deactivated account is signed out on its next request."""
    changes = body.model_dump(exclude_unset=True)
    if any(v is None for v in changes.values()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "role and is_active cannot be cleared.")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    if user.id == admin.id:
        field = "role" if "role" in changes else "is_active"
        raise FieldError(status.HTTP_400_BAD_REQUEST, field, "You can't change your own role or deactivate yourself.")
    if user.is_engineer or changes.get("role") == UserRole.ENGINEER:
        raise FieldError(status.HTTP_400_BAD_REQUEST, "role" if "role" in changes else "is_active",
                         "Engineers are managed on the Engineers page.")

    new_role = changes.get("role", user.role)
    new_active = changes.get("is_active", user.is_active)
    loses_admin = user.role == UserRole.FACILITY_ADMIN and user.is_active and (
        new_role != UserRole.FACILITY_ADMIN or not new_active
    )
    if loses_admin:
        # Lock the admin rows so two admins can't demote each other at the same moment
        admins = db.scalars(
            select(User.id).where(User.role == UserRole.FACILITY_ADMIN, User.is_active).with_for_update()
        ).all()
        if set(admins) <= {user.id}:
            raise FieldError(status.HTTP_409_CONFLICT, "role" if "role" in changes else "is_active",
                             "There must always be at least one active Facility Admin.")

    old_role = user.role
    user.role = new_role
    user.is_active = new_active
    if new_role != old_role and new_active:
        notify.notify(db, {user.id}, actor=admin, kind="role_changed", incident=None,
                      message=f"{admin.full_name} made you {ROLE_TEXT[new_role]}. Sign in again to see the change.")
    db.commit()
    return _row(user)
