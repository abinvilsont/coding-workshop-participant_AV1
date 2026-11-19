"""
Role-based rules for incidents - the single source of truth used both to
enforce access in the API and to tell the UI which actions to offer.

Employee  : sees own incidents; edits details while 'open'; escalates /
            requests priority; cancels before work starts; confirms
            (closes) or reopens a resolved incident; adds notes.
Engineer  : sees incidents assigned to them; moves them through
            assigned -> in_progress <-> on_hold -> resolved; adds notes
            (incl. internal notes).
Admin     : sees and manages everything: edit, priority, assignment,
            any status change, merging duplicates, delete.
Follower  : an employee whose duplicate report was merged into this
            incident. Can view it, add notes and is kept informed, but
            only the original reporter confirms, reopens or cancels.
"""

from sqlalchemy import or_, select

from app.models import FINAL_STATUSES, Incident, IncidentStatus as S, User, incident_followers

# Transitions an assigned engineer may make
ENGINEER_TRANSITIONS = {
    S.ASSIGNED: {S.IN_PROGRESS},
    S.IN_PROGRESS: {S.ON_HOLD, S.RESOLVED},
    S.ON_HOLD: {S.IN_PROGRESS, S.RESOLVED},
    S.RESOLVED: {S.IN_PROGRESS},
}

# Transitions the employee who reported the incident may make
REPORTER_TRANSITIONS = {
    S.OPEN: {S.CANCELLED},
    S.ASSIGNED: {S.CANCELLED},
    S.RESOLVED: {S.CLOSED, S.IN_PROGRESS},  # confirm fix, or reopen
}

ESCALATABLE = {S.OPEN, S.ASSIGNED, S.IN_PROGRESS, S.ON_HOLD}


def is_reporter(user: User, inc: Incident) -> bool:
    return inc.reported_by_id == user.id


def is_assignee(user: User, inc: Incident) -> bool:
    return inc.assigned_engineer_id == user.id


def is_follower(user: User, inc: Incident) -> bool:
    return any(f.id == user.id for f in inc.followers)


def can_view(user: User, inc: Incident) -> bool:
    return user.is_admin or is_reporter(user, inc) or is_assignee(user, inc) or is_follower(user, inc)


def visibility_filter(user: User):
    """SQL WHERE clause restricting incidents to those the user may see."""
    if user.is_admin:
        return True
    followed = select(incident_followers.c.incident_id).where(incident_followers.c.user_id == user.id)
    return or_(
        Incident.reported_by_id == user.id,
        Incident.assigned_engineer_id == user.id,
        Incident.id.in_(followed),
    )


def can_merge(user: User, inc: Incident) -> bool:
    """Admins merge a duplicate into another incident while both are still open for work."""
    return user.is_admin and inc.status not in FINAL_STATUSES and inc.merged_into_id is None


def allowed_transitions(user: User, inc: Incident) -> set[S]:
    current = inc.status
    allowed: set[S] = set()
    if user.is_admin:
        # Anything except moving past 'open' without an engineer (DB enforces it too)
        allowed = set(S) - {current}
        if inc.assigned_engineer_id is None:
            allowed &= {S.OPEN, S.CANCELLED}
        return allowed
    if is_assignee(user, inc):
        allowed |= ENGINEER_TRANSITIONS.get(current, set())
    if is_reporter(user, inc):
        allowed |= REPORTER_TRANSITIONS.get(current, set())
    return allowed


def can_edit(user: User, inc: Incident) -> bool:
    if user.is_admin:
        return inc.status not in FINAL_STATUSES
    return is_reporter(user, inc) and inc.status == S.OPEN


def can_escalate(user: User, inc: Incident) -> bool:
    return is_reporter(user, inc) and inc.status in ESCALATABLE and not inc.is_escalated


def can_add_note(user: User, inc: Incident) -> bool:
    return can_view(user, inc) and inc.status not in FINAL_STATUSES


def can_add_internal_note(user: User, inc: Incident) -> bool:
    return can_add_note(user, inc) and (user.is_admin or user.is_engineer)


def can_see_internal_notes(user: User) -> bool:
    return user.is_admin or user.is_engineer


def permissions(user: User, inc: Incident) -> dict:
    order = list(S)
    return {
        "can_edit": can_edit(user, inc),
        "can_set_priority": user.is_admin and inc.status not in FINAL_STATUSES,
        "can_assign": user.is_admin and inc.status not in FINAL_STATUSES,
        "can_escalate": can_escalate(user, inc),
        "can_add_note": can_add_note(user, inc),
        "can_add_internal_note": can_add_internal_note(user, inc),
        "can_delete": user.is_admin,
        "can_merge": can_merge(user, inc),
        "status_transitions": sorted(allowed_transitions(user, inc), key=order.index),
    }
