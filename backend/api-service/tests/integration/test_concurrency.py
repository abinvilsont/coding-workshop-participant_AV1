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
from sqlalchemy import select

from app.api.routes import incidents as routes
from app.db.session import SessionLocal
from app.models import Incident, IncidentStatus as S, User
from app.schemas.incident import NoteCreate, StatusChange
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
