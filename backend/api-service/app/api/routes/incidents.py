"""Incident CRUD plus workflow actions, with role-based authorization."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import case, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from app.core.errors import FieldError
from app.api.deps import AdminUser, CurrentUser, DbSession
from app.models import (
    FINAL_STATUSES, IncidentCategory, EngineerAvailability, EngineerProfile, EngineerReview, Incident, IncidentNote,
    IncidentPriority, IncidentStatus as S, User, incident_followers,
)
from app.schemas.incident import (
    AssignIn, EscalateIn, EscalationRequestIn, IncidentCreate, IncidentDetail, IncidentList, IncidentSummary,
    IncidentUpdate, MergeIn, NoteCreate, ReviewIn, SimilarIncident, StatusChange,
)
from app.services import incidents as svc
from app.services import notifications as notify
from app.services import permissions as perms

router = APIRouter(prefix="/incidents", tags=["incidents"])

# Engineers who can't receive new assignments ('busy' is allowed - admin's call)
UNASSIGNABLE = {EngineerAvailability.ON_LEAVE, EngineerAvailability.OFFLINE}


def _now():
    return datetime.now(timezone.utc)


def _commit(db):
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That change isn't valid for this incident.") from exc


def _reload(db, incident_id, user) -> dict:
    db.expire_all()
    return svc.detail(db, svc.get_incident_or_404(db, incident_id, user), user)


# ------------------------------------------------------------------ CRUD

@router.get("", response_model=IncidentList)
def list_incidents(
    db: DbSession,
    user: CurrentUser,
    status_: list[S] | None = Query(default=None, alias="status"),
    priority: list[IncidentPriority] | None = Query(default=None),
    escalated: bool | None = None,
    unassigned: bool | None = None,
    q: str | None = Query(default=None, max_length=100, description="Search title / reference"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Incidents visible to the caller: own (employee), assigned (engineer) or all (admin)."""
    where = [perms.visibility_filter(user)]
    if status_:
        where.append(Incident.status.in_(status_))
    if priority:
        where.append(Incident.priority.in_(priority))
    if escalated is not None:
        where.append(Incident.is_escalated.is_(escalated))
    if unassigned:
        where.append(Incident.assigned_engineer_id.is_(None))
    if q:
        like = f"%{q.strip()}%"
        where.append(Incident.title.ilike(like) | Incident.reference.ilike(like))

    total = db.scalar(select(func.count()).select_from(Incident).where(*where))
    rows = db.scalars(
        select(Incident)
        .options(*svc.SUMMARY_OPTIONS)
        .where(*where)
        .order_by(Incident.updated_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return {"items": [svc.summary(i) for i in rows], "total": total}


@router.get("/similar", response_model=list[SimilarIncident])
def similar_incidents(
    db: DbSession,
    user: CurrentUser,
    building_id: int,
    category: IncidentCategory,
    floor_id: int | None = None,
):
    """Open incidents that may already report the problem the caller is about to report:
    same building and category, and the same floor when both have one. Shown before a new
    report is saved, so the employee can ask for the existing one to be escalated instead."""
    where = [
        Incident.building_id == building_id,
        Incident.category == category,
        Incident.status.in_(perms.ESCALATABLE),  # still being worked on
        Incident.merged_into_id.is_(None),
    ]
    if floor_id is not None:
        where.append((Incident.floor_id == floor_id) | Incident.floor_id.is_(None))
    rows = db.scalars(
        select(Incident)
        .options(*svc.SUMMARY_OPTIONS)
        .where(*where)
        .order_by(case((Incident.floor_id == floor_id, 0), else_=1), Incident.created_at.desc())
        .limit(5)
    ).all()
    followed = set(db.scalars(
        select(incident_followers.c.incident_id).where(
            incident_followers.c.user_id == user.id,
            incident_followers.c.incident_id.in_([i.id for i in rows]),
        )
    ).all()) if rows else set()

    def relation(inc):
        if inc.reported_by_id == user.id:
            return "reporter"
        return "follower" if inc.id in followed else None

    return [
        {
            "id": i.id, "reference": i.reference, "title": i.title, "category": i.category, "status": i.status,
            "building": i.building.name, "floor": i.floor.name if i.floor else None,
            "seat": i.seat.seat_code if i.seat else None, "is_escalated": i.is_escalated,
            "created_at": i.created_at, "relation": relation(i),
        }
        for i in rows
    ]


@router.post("", response_model=IncidentDetail, status_code=status.HTTP_201_CREATED)
def create_incident(body: IncidentCreate, db: DbSession, user: CurrentUser):
    """Report a new incident. Only admins may open one as 'critical'."""
    if body.priority == IncidentPriority.CRITICAL and not user.is_admin:
        raise FieldError(
            status.HTTP_400_BAD_REQUEST, "priority",
            "Choose low, medium or high. Use escalation to request critical priority.",
        )
    svc.validate_location(db, body.building_id, body.floor_id, body.seat_id)
    inc = Incident(**body.model_dump(), reported_by_id=user.id)
    db.add(inc)
    db.flush()  # assigns id and INC- reference
    notify.incident_created(db, inc, user)
    _commit(db)
    return _reload(db, inc.id, user)


@router.get("/{incident_id}", response_model=IncidentDetail)
def get_incident(incident_id: int, db: DbSession, user: CurrentUser):
    """Full incident with notes, history and the caller's allowed actions."""
    inc = svc.get_incident_or_404(db, incident_id, user)
    return svc.detail(db, inc, user)


@router.put("/{incident_id}", response_model=IncidentDetail)  # PUT is accepted as an alias of PATCH
@router.patch("/{incident_id}", response_model=IncidentDetail)
def update_incident(incident_id: int, body: IncidentUpdate, db: DbSession, user: CurrentUser):
    """Edit details. Reporter: while 'open'. Admin: any time, incl. priority / de-escalation."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    changes = body.model_dump(exclude_unset=True)
    expected = changes.pop("expected_updated_at", None)
    if expected is not None and expected != inc.updated_at:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Someone updated this incident while you were editing. Reload to see their changes, then edit again.",
        )

    admin_only = {"priority", "is_escalated"} & changes.keys()
    if admin_only and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Only a Facility Admin can change: {', '.join(sorted(admin_only))}.")
    if not perms.can_edit(user, inc):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This incident can no longer be edited.")
    if changes.get("is_escalated") is True:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Use the escalate action to escalate.")
    if any(changes.get(k) is None and k in changes for k in ("title", "description", "category", "building_id", "priority", "is_escalated")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Required fields cannot be cleared.")

    if {"building_id", "floor_id", "seat_id"} & changes.keys():
        building_id = changes.get("building_id", inc.building_id)
        floor_id = changes["floor_id"] if "floor_id" in changes else inc.floor_id
        seat_id = changes["seat_id"] if "seat_id" in changes else inc.seat_id
        svc.validate_location(db, building_id, floor_id, seat_id)

    old_priority = inc.priority
    was_escalated = inc.is_escalated
    changed = [f for f, v in changes.items() if getattr(inc, f) != v]
    for field, value in changes.items():
        setattr(inc, field, value)
    if changes.get("is_escalated") is False:
        inc.escalated_at = None

    if "priority" in changed:
        notify.priority_changed(db, inc, user, old_priority.value, inc.priority.value)
    if "is_escalated" in changed and was_escalated:
        notify.escalation_cleared(db, inc, user)
    details = [f for f in changed if f not in ("priority", "is_escalated")]
    if details:
        notify.details_updated(db, inc, user, details)
    _commit(db)
    return _reload(db, incident_id, user)


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_incident(incident_id: int, db: DbSession, user: AdminUser):
    """Permanently delete an incident with its notes and history (admin only)."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    notify.incident_deleted(db, inc, user)
    db.delete(inc)
    _commit(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ workflow

@router.post("/{incident_id}/status", response_model=IncidentDetail)
def change_status(incident_id: int, body: StatusChange, db: DbSession, user: CurrentUser):
    """Move the incident through its lifecycle (allowed moves depend on role)."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    if body.status not in perms.allowed_transitions(user, inc):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"You can't change this incident from {inc.status.value} to {body.status.value}.",
        )

    old_status = inc.status
    inc.status = body.status
    if body.status == S.RESOLVED:
        inc.resolved_at = _now()
    elif body.status == S.CLOSED:
        inc.closed_at = _now()
    elif body.status in (S.IN_PROGRESS, S.ASSIGNED, S.OPEN, S.ON_HOLD):
        inc.resolved_at = None
        inc.closed_at = None

    if body.comment and body.comment.strip():
        db.add(IncidentNote(incident_id=inc.id, author_id=user.id, body=body.comment.strip()))
    notify.status_changed(db, inc, user, old_status.value, inc.status.value)
    _commit(db)
    return _reload(db, incident_id, user)


@router.post("/{incident_id}/assign", response_model=IncidentDetail)
def assign_engineer(incident_id: int, body: AssignIn, db: DbSession, user: AdminUser):
    """Assign or reassign an engineer (admin only)."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    if inc.status in (S.CLOSED, S.CANCELLED):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Closed or cancelled incidents can't be assigned.")
    # Lock the engineer's profile row until commit, so two admins assigning at
    # the same moment can't both take the engineer's last free slot.
    profile = db.get(EngineerProfile, body.engineer_id, with_for_update=True)
    engineer = db.get(User, body.engineer_id)
    if profile is None or engineer is None or not engineer.is_active:
        raise FieldError(status.HTTP_400_BAD_REQUEST, "engineer_id", "That engineer doesn't exist or is inactive.")
    if profile.availability in UNASSIGNABLE:
        raise FieldError(
            status.HTTP_400_BAD_REQUEST, "engineer_id",
            f"{engineer.full_name} is {profile.availability.value.replace('_', ' ')} and can't take new tickets.",
        )

    if inc.assigned_engineer_id != engineer.id:
        _check_capacity(db, engineer)

    previous_id = inc.assigned_engineer_id
    inc.assigned_engineer_id = profile.user_id
    inc.assigned_by_id = user.id
    inc.assigned_at = _now()
    if inc.status == S.OPEN:
        inc.status = S.ASSIGNED
    if previous_id != engineer.id:
        notify.assigned(db, inc, user, engineer, previous_id)
    _commit(db)
    return _reload(db, incident_id, user)


def _check_capacity(db, engineer: User) -> None:
    """Refuse a new ticket for an engineer already at max_active_tickets."""
    load = db.execute(
        text("SELECT active_tickets, max_active_tickets FROM engineer_workload WHERE engineer_id = :id"),
        {"id": engineer.id},
    ).one()
    if load.active_tickets >= load.max_active_tickets:
        raise FieldError(
            status.HTTP_409_CONFLICT, "engineer_id",
            f"{engineer.full_name} is at full capacity ({load.active_tickets}/{load.max_active_tickets} active tickets). "
            "Choose another engineer, or raise their limit on the Engineers page.",
        )


@router.post("/{incident_id}/escalate", response_model=IncidentDetail)
def escalate(incident_id: int, body: EscalateIn, db: DbSession, user: CurrentUser):
    """Reporter escalates the incident and may request a higher priority."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    if not perms.can_escalate(user, inc):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This incident can't be escalated.")
    if body.requested_priority and body.requested_priority.rank <= inc.priority.rank:
        raise FieldError(status.HTTP_400_BAD_REQUEST, "requested_priority", "Requested priority must be higher than the current one.")

    inc.is_escalated = True
    inc.escalated_at = _now()
    inc.escalation_reason = body.reason
    if body.requested_priority:
        inc.requested_priority = body.requested_priority
    notify.escalated(db, inc, user, body.requested_priority.value if body.requested_priority else None)
    _commit(db)
    return _reload(db, incident_id, user)


@router.post("/{incident_id}/notes", response_model=IncidentDetail, status_code=status.HTTP_201_CREATED)
def add_note(incident_id: int, body: NoteCreate, db: DbSession, user: CurrentUser):
    """Add a note. Internal notes (hidden from employees) are for engineers and admins."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    if not perms.can_add_note(user, inc):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Notes can only be added to open incidents.")
    if body.is_internal and not perms.can_add_internal_note(user, inc):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only engineers and admins can add internal notes.")
    db.add(IncidentNote(incident_id=inc.id, author_id=user.id, body=body.body, is_internal=body.is_internal))
    notify.note_added(db, inc, user, body.body, body.is_internal)
    _commit(db)
    return _reload(db, incident_id, user)


# ------------------------------------------------------------------ duplicates

@router.get("/{incident_id}/merge-candidates", response_model=list[IncidentSummary])
def merge_candidates(incident_id: int, db: DbSession, user: AdminUser):
    """Open incidents this one could be merged into, likeliest duplicates first
    (same building and category, then same building, then newest)."""
    source = svc.get_incident_or_404(db, incident_id, user)
    same_building = Incident.building_id == source.building_id
    rows = db.scalars(
        select(Incident)
        .options(*svc.SUMMARY_OPTIONS)
        .where(
            Incident.id != source.id,
            Incident.status.not_in(FINAL_STATUSES),
            Incident.merged_into_id.is_(None),
        )
        .order_by(
            case((same_building & (Incident.category == source.category), 0), (same_building, 1), else_=2),
            Incident.created_at.desc(),
        )
        .limit(50)
    ).all()
    return [svc.summary(i) for i in rows]


@router.post("/{incident_id}/merge", response_model=IncidentDetail)
def merge(incident_id: int, body: MergeIn, db: DbSession, user: AdminUser):
    """Merge a duplicate into another incident (admin only).

    The duplicate is cancelled and linked to the target; its reporter (and anyone
    already following it) follows the target from now on, so they get every update.
    """
    if body.target_id == incident_id:
        raise FieldError(status.HTTP_400_BAD_REQUEST, "target_id", "An incident can't be merged into itself.")
    # Lock both rows (in id order, so two opposite merges can't deadlock)
    db.execute(
        select(Incident.id).where(Incident.id.in_([incident_id, body.target_id])).order_by(Incident.id).with_for_update()
    )
    source = svc.get_incident_or_404(db, incident_id, user)
    target = svc.get_incident_or_404(db, body.target_id, user)

    if source.merged_into_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{source.reference} has already been merged into another incident."
        )
    if source.status in FINAL_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Closed or cancelled incidents can't be merged.")
    if target.status in FINAL_STATUSES or target.merged_into_id:
        raise FieldError(
            status.HTTP_400_BAD_REQUEST, "target_id", f"{target.reference} is closed or cancelled. Merge into an open incident."
        )

    source_reporters = notify.reporters(source)
    new_followers = source_reporters - {target.reported_by_id}
    if new_followers:
        db.execute(
            insert(incident_followers)
            .values([{"incident_id": target.id, "user_id": uid, "added_by": user.id} for uid in new_followers])
            .on_conflict_do_nothing()
        )
    # Duplicates previously merged into the source now point at the target
    db.execute(update(Incident).where(Incident.merged_into_id == source.id).values(merged_into_id=target.id))

    source.status = S.CANCELLED
    source.merged_into_id = target.id
    source.closed_at = _now()

    summary = f"{source.title}: {source.description}"
    if len(summary) > 1500:
        summary = summary[:1499] + "…"
    db.add(IncidentNote(
        incident_id=target.id, author_id=user.id,
        body=f"Merged {source.reference}, reported by {source.reporter.full_name}. {summary}",
    ))
    db.add(IncidentNote(
        incident_id=source.id, author_id=user.id,
        body=f"Merged into {target.reference}, which reports the same problem. Updates continue there.",
    ))
    notify.merged(db, source, target, user, source_reporters)
    _commit(db)
    return _reload(db, target.id, user)


# ------------------------------------------------------------------ reviews
# The employees who reported a closed incident rate its engineer. Reviews are
# returned to the reviewer and to admins only; engineers never receive them.

def _check_can_review(user: User, inc: Incident) -> None:
    if user.is_admin or user.is_engineer:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the employees who reported an incident can review its engineer.")
    if inc.status != S.CLOSED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can review the engineer once the incident is closed.")
    if inc.assigned_engineer_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No engineer worked on this incident.")


def _own_review_or_404(user: User, inc: Incident) -> EngineerReview:
    review = perms.own_review(user, inc)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You haven't reviewed this incident's engineer yet.")
    return review


@router.post("/{incident_id}/review", response_model=IncidentDetail, status_code=status.HTTP_201_CREATED)
def create_review(incident_id: int, body: ReviewIn, db: DbSession, user: CurrentUser):
    """Rate the engineer who fixed your closed incident (reporter or follower, once each)."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    _check_can_review(user, inc)
    if perms.own_review(user, inc):
        raise FieldError(status.HTTP_409_CONFLICT, "rating", "You've already reviewed this engineer. Edit your review instead.")
    db.add(EngineerReview(
        incident_id=inc.id, engineer_id=inc.assigned_engineer_id, reviewer_id=user.id,
        rating=body.rating, comment=body.comment,
    ))
    try:
        db.commit()
    except IntegrityError as exc:  # a double-click raced the check above
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already reviewed this engineer.") from exc
    return _reload(db, incident_id, user)


@router.put("/{incident_id}/review", response_model=IncidentDetail)
@router.patch("/{incident_id}/review", response_model=IncidentDetail)
def update_review(incident_id: int, body: ReviewIn, db: DbSession, user: CurrentUser):
    """Change your rating or comment."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    review = _own_review_or_404(user, inc)
    review.rating = body.rating
    review.comment = body.comment
    _commit(db)
    return _reload(db, incident_id, user)


@router.delete("/{incident_id}/review", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(incident_id: int, db: DbSession, user: CurrentUser):
    """Withdraw your review."""
    inc = svc.get_incident_or_404(db, incident_id, user, for_update=True)
    db.delete(_own_review_or_404(user, inc))
    _commit(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ escalation requests

@router.post("/{incident_id}/escalation-request", response_model=IncidentDetail)
def request_escalation(incident_id: int, body: EscalationRequestIn, db: DbSession, user: CurrentUser):
    """An employee with the same problem asks for an existing incident to be escalated
    instead of reporting it again. They follow it from now on (once per incident)."""
    if not user.is_employee:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only employees can ask for an incident to be escalated.")
    # Lock the incident so two people asking at once both get recorded cleanly
    inc = db.scalar(
        select(Incident).options(*svc.SUMMARY_OPTIONS).where(Incident.id == incident_id).with_for_update(of=Incident)
    )
    if inc is None or inc.merged_into_id is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Incident not found.")
    if inc.reported_by_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This is your own incident. Use Escalate on it instead.")
    if inc.status not in perms.ESCALATABLE:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{inc.reference} is {inc.status.value.replace('_', ' ')}, so it can't be escalated. Report your problem instead.",
        )
    already = db.scalar(
        select(incident_followers.c.escalation_requested_at).where(
            incident_followers.c.incident_id == inc.id, incident_followers.c.user_id == user.id
        )
    )
    if already is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already asked for this incident to be escalated.")

    now = _now()
    db.execute(
        insert(incident_followers)
        .values(incident_id=inc.id, user_id=user.id, added_by=user.id, escalation_requested_at=now)
        .on_conflict_do_update(  # a follower from a merge asks too
            index_elements=["incident_id", "user_id"], set_={"escalation_requested_at": now}
        )
    )
    because = f" Their reason: {body.reason}" if body.reason else ""
    if not inc.is_escalated:
        # The history trigger records the escalation under the requester's name
        inc.is_escalated = True
        inc.escalated_at = now
        inc.escalation_reason = f"{user.full_name} has the same problem and asked for it to be escalated.{because}"
    db.add(IncidentNote(
        incident_id=inc.id, author_id=user.id,
        body=f"I have the same problem and asked for this to be escalated.{because}",
    ))
    notify.escalation_requested(db, inc, user, body.reason)
    _commit(db)
    return _reload(db, inc.id, user)
