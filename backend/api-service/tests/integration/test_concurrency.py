"""Two people changing the same incident at the same moment.

Every route that changes an incident locks its row first, so concurrent requests
run one after the other and the second re-checks its rules against what the first
saved. These tests hold the first change open in one database session while the
second request runs in another thread, so the race happens every time.
"""

import threading
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.routes import engineers as eng_routes, incidents as routes
from app.core.errors import FieldError
from app.db.session import SessionLocal
from app.models import EngineerProfile, Incident, IncidentStatus as S, User
from app.schemas.admin import EngineerUpdate
from app.schemas.incident import AssignIn, NoteCreate, StatusChange
from app.services import incidents as svc
from tests.integration.conftest import DOCK, USERS

TOM, SOFIA = USERS["tom"][0], USERS["sofia"][0]  # DOCK: assigned to Tom, reported by Sofia


class Racer(threading.Thread):
    """Runs one route call in its own session; keeps the result or the exception."""

    def __init__(self, call):
        super().__init__(daemon=True)
        self.call, self.result, self.error = call, None, None

    def run(self):
        with SessionLocal() as db:
            try:
                self.result = self.call(db)
            except Exception as exc:  # noqa: BLE001 - asserted by the test
                self.error = exc


def hold_change(user_id, change):
    """Start a change to DOCK as `user_id`, lock held and NOT committed yet."""
    db = SessionLocal()
    user = db.get(User, user_id)
    inc = svc.get_incident_or_404(db, DOCK, user, for_update=True)
    change(inc)
    db.flush()
    return db


def status_of(incident_id):
    with SessionLocal() as db:
        return db.scalar(select(Incident.status).where(Incident.id == incident_id))


def race(first_user, first_change, second_call):
    """First change holds the lock; the second request must wait for it, then run."""
    first = hold_change(first_user, first_change)
    second = Racer(second_call)
    second.start()
    time.sleep(0.5)
    assert second.is_alive(), "the second request should be waiting for the row lock"
    first.commit()
    first.close()
    second.join(timeout=10)
    assert not second.is_alive()
    return second


def test_cancel_arriving_just_after_start_work_is_refused(seed_conn):
    """Tom starts work while Sofia cancels. Without the lock both would pass their
    check (both saw 'assigned') and the last write would win."""
    def start_work(inc):
        inc.status = S.IN_PROGRESS

    second = race(TOM, start_work, lambda db: routes.change_status(
        DOCK, StatusChange(status=S.CANCELLED), db, db.get(User, SOFIA)))

    assert isinstance(second.error, HTTPException) and second.error.status_code == 403
    assert second.error.detail == "You can't change this incident from in_progress to cancelled."
    assert status_of(DOCK) == S.IN_PROGRESS


def test_start_work_arriving_just_after_cancel_is_refused(seed_conn):
    """The other order: Sofia cancels first, then Tom's 'start work' is refused."""
    def cancel(inc):
        inc.status = S.CANCELLED

    second = race(SOFIA, cancel, lambda db: routes.change_status(
        DOCK, StatusChange(status=S.IN_PROGRESS), db, db.get(User, TOM)))

    assert isinstance(second.error, HTTPException) and second.error.status_code == 403
    assert status_of(DOCK) == S.CANCELLED


def test_a_note_waits_for_a_close_and_is_then_refused(seed_conn):
    """Notes stop once an incident is closed, even if the close lands a moment earlier."""
    def close(inc):
        inc.status = S.CANCELLED

    second = race(SOFIA, close, lambda db: routes.add_note(
        DOCK, NoteCreate(body="Any update?"), db, db.get(User, TOM)))

    assert isinstance(second.error, HTTPException) and second.error.status_code == 403


def test_different_fields_changed_at_once_are_both_kept(seed_conn):
    """Locking doesn't lose work: the second change still applies, after the first."""
    def rename(inc):
        inc.title = "Docking station dead"

    second = race(SOFIA, rename, lambda db: routes.change_status(
        DOCK, StatusChange(status=S.IN_PROGRESS), db, db.get(User, TOM)))

    assert second.error is None
    with SessionLocal() as db:
        inc = db.get(Incident, DOCK)
        assert (inc.title, inc.status) == ("Docking station dead", S.IN_PROGRESS)


# ---------------------------------------------------------------- stale edits

def test_an_edit_based_on_an_old_copy_is_refused(client, as_):
    loaded = client.get(f"/incidents/{DOCK}", headers=as_("alice")).json()
    # someone else changes it in the meantime
    client.post(f"/incidents/{DOCK}/status", headers=as_("tom"), json={"status": "in_progress"})

    r = client.patch(f"/incidents/{DOCK}", headers=as_("alice"),
                     json={"title": "New title", "expected_updated_at": loaded["updated_at"]})
    assert r.status_code == 409
    assert r.json()["message"] == (
        "Someone updated this incident while you were editing. Reload to see their changes, then edit again."
    )
    assert client.get(f"/incidents/{DOCK}", headers=as_("alice")).json()["title"] == loaded["title"]


def test_an_edit_based_on_the_current_copy_saves(client, as_):
    loaded = client.get(f"/incidents/{DOCK}", headers=as_("alice")).json()
    r = client.patch(f"/incidents/{DOCK}", headers=as_("alice"),
                     json={"title": "New title", "expected_updated_at": loaded["updated_at"]})
    assert r.status_code == 200 and r.json()["title"] == "New title"
    # ...and the next edit must use the new timestamp
    stale = client.patch(f"/incidents/{DOCK}", headers=as_("alice"),
                         json={"title": "Again", "expected_updated_at": loaded["updated_at"]})
    assert stale.status_code == 409


@pytest.mark.parametrize("body", [{"title": "No check"}, {"title": "No check", "expected_updated_at": None}])
def test_edits_without_the_check_still_work(client, as_, body):
    """API clients that don't send expected_updated_at keep the old behaviour."""
    assert client.patch(f"/incidents/{DOCK}", headers=as_("alice"), json=body).status_code == 200


# ---------------------------------------------------------------- engineer capacity and deactivation

HANA, ALICE, BEN = USERS["hana"][0], USERS["alice"][0], USERS["ben"][0]


def _open_incidents_not_hanas(n):
    with SessionLocal() as db:
        return db.scalars(
            select(Incident.id).where(Incident.status.in_([S.OPEN, S.ASSIGNED, S.IN_PROGRESS]),
                                      Incident.assigned_engineer_id.is_distinct_from(HANA))
            .order_by(Incident.id).limit(n)
        ).all()


def hold_assignment_to_hana(incident_id):
    """An admin's assignment of `incident_id` to Hana: her profile locked, NOT committed yet."""
    db = SessionLocal()
    db.get(EngineerProfile, HANA, with_for_update=True)
    inc = db.get(Incident, incident_id)
    inc.assigned_engineer_id, inc.assigned_by_id, inc.status = HANA, ALICE, S.ASSIGNED
    db.flush()
    return db


def wait_behind(first, call):
    """`first` holds Hana's profile lock; `call` must wait for it, then run."""
    second = Racer(call)
    second.start()
    time.sleep(0.5)
    waited = second.is_alive()
    first.commit()  # always release the lock, so a failure here can't block the next test
    first.close()
    second.join(timeout=10)
    assert waited, "the second request should have waited for the engineer's profile lock"
    assert not second.is_alive()
    return second


def test_two_admins_cannot_both_take_an_engineers_last_free_slot(seed_conn):
    """Hana has room for one more ticket. Alice and Ben each assign her one at the same moment:
    the second waits for the first, then sees she is full."""
    with SessionLocal() as db:
        db.get(EngineerProfile, HANA).max_active_tickets = 1
        db.commit()
    first_id, second_id = _open_incidents_not_hanas(2)

    second = wait_behind(hold_assignment_to_hana(first_id), lambda db: routes.assign_engineer(
        second_id, AssignIn(engineer_id=HANA), db, db.get(User, BEN)))

    assert isinstance(second.error, FieldError) and second.error.status_code == 409
    assert "full capacity (1/1" in second.error.detail
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Incident).where(Incident.assigned_engineer_id == HANA)) == 1


def test_deactivating_an_engineer_waits_for_an_assignment_and_is_then_refused(seed_conn):
    """Ben deactivates Hana while Alice is assigning her a ticket. Without the lock the
    deactivation counts no active tickets and goes through, leaving an inactive engineer
    holding a live ticket."""
    (incident_id,) = _open_incidents_not_hanas(1)

    second = wait_behind(hold_assignment_to_hana(incident_id), lambda db: eng_routes.update_engineer(
        HANA, EngineerUpdate(is_active=False), db, db.get(User, BEN)))

    assert isinstance(second.error, FieldError) and second.error.status_code == 409
    assert "Reassign them first" in second.error.detail
    with SessionLocal() as db:
        assert db.get(User, HANA).is_active is True


def test_assigning_an_engineer_who_was_just_deactivated_is_refused(seed_conn):
    """The other order: the deactivation lands first, so the assignment is refused."""
    (incident_id,) = _open_incidents_not_hanas(1)
    first = SessionLocal()
    first.get(EngineerProfile, HANA, with_for_update=True)
    first.get(User, HANA).is_active = False
    first.flush()

    second = wait_behind(first, lambda db: routes.assign_engineer(
        incident_id, AssignIn(engineer_id=HANA), db, db.get(User, ALICE)))

    assert isinstance(second.error, FieldError) and second.error.status_code == 400
    assert "doesn't exist or is inactive" in second.error.detail
