"""Rule errors that belong to one field name it, so the form can show the message above that field."""

from tests.integration.conftest import USERS, WIFI

TOM = USERS["tom"][0]


def field_of(r):
    """The single field a 4xx response points at (None when it isn't about a field)."""
    errors = r.json().get("errors") or []
    assert len(errors) <= 1, errors
    if not errors:
        return None
    assert errors[0]["msg"] == r.json()["message"]  # same words as the top-level message
    return errors[0]["loc"][-1]


def test_location_errors_point_at_the_wrong_part(client, as_, facilities):
    base = {"title": "x", "description": "y", "category": "plumbing", "building_id": facilities["hq"]["id"]}
    r = client.post("/incidents", headers=as_("emma"), json={**base, "floor_id": facilities["inn_floor1"]["id"]})
    assert (r.status_code, field_of(r)) == (400, "floor_id")
    r = client.post("/incidents", headers=as_("emma"), json={**base, "seat_id": 1})
    assert (r.status_code, field_of(r)) == (400, "floor_id")  # "Choose a floor when choosing a seat."
    r = client.post("/incidents", headers=as_("emma"), json={**base, "building_id": 999})
    assert (r.status_code, field_of(r)) == (400, "building_id")
    other_seat = facilities["inn_floor1"]["seats"][0]["id"]
    r = client.post("/incidents", headers=as_("emma"),
                    json={**base, "floor_id": facilities["hq_floor1"]["id"], "seat_id": other_seat})
    assert (r.status_code, field_of(r)) == (400, "seat_id")


def test_critical_priority_points_at_priority(client, as_, facilities):
    r = client.post("/incidents", headers=as_("emma"), json={
        "title": "x", "description": "y", "category": "plumbing",
        "building_id": facilities["hq"]["id"], "priority": "critical",
    })
    assert (r.status_code, field_of(r)) == (400, "priority")


def test_assignment_errors_point_at_the_engineer(client, as_):
    omar = USERS["omar"][0]  # on leave
    r = client.post(f"/incidents/{WIFI}/assign", headers=as_("alice"), json={"engineer_id": omar})
    assert (r.status_code, field_of(r)) == (400, "engineer_id")
    r = client.post(f"/incidents/{WIFI}/assign", headers=as_("alice"), json={"engineer_id": 999})
    assert (r.status_code, field_of(r)) == (400, "engineer_id")
    # Tom already has one active ticket; a limit of 1 makes him full
    client.patch(f"/engineers/{TOM}", headers=as_("alice"), json={"max_active_tickets": 1})
    r = client.post(f"/incidents/{WIFI}/assign", headers=as_("alice"), json={"engineer_id": TOM})
    assert (r.status_code, field_of(r)) == (409, "engineer_id")


def test_escalation_and_merge_errors_point_at_their_field(client, as_, new_incident):
    inc = new_incident("emma", priority="high")
    r = client.post(f"/incidents/{inc['id']}/escalate", headers=as_("emma"),
                    json={"reason": "urgent", "requested_priority": "low"})
    assert (r.status_code, field_of(r)) == (400, "requested_priority")
    r = client.post(f"/incidents/{inc['id']}/merge", headers=as_("alice"), json={"target_id": inc["id"]})
    assert (r.status_code, field_of(r)) == (400, "target_id")


def test_duplicate_accounts_and_facilities_point_at_the_clashing_field(client, as_, facilities):
    r = client.post("/engineers", headers=as_("alice"), json={
        "name": "Dup", "email": "tom.eng@acme.inc", "password": "Password123!",
    })
    assert (r.status_code, field_of(r)) == (409, "email")

    hq = facilities["hq"]
    r = client.post("/buildings", headers=as_("alice"), json={"code": hq["code"], "name": "Fresh name"})
    assert (r.status_code, field_of(r)) == (409, "code")
    r = client.post("/buildings", headers=as_("alice"), json={"code": "NEW1", "name": hq["name"]})
    assert (r.status_code, field_of(r)) == (409, "name")
    r = client.post("/floors", headers=as_("alice"), json={"building_id": hq["id"], "floor_number": 1})
    assert (r.status_code, field_of(r)) == (409, "floor_number")
    seat = facilities["hq_floor1"]["seats"][0]
    r = client.post("/seats", headers=as_("alice"), json={"floor_id": seat["floor_id"], "seat_code": seat["seat_code"]})
    assert (r.status_code, field_of(r)) == (409, "seat_code")


def test_engineer_deactivation_points_at_the_active_switch(client, as_):
    r = client.patch(f"/engineers/{TOM}", headers=as_("alice"), json={"is_active": False})
    assert (r.status_code, field_of(r)) == (409, "is_active")
    r = client.patch(f"/engineers/{TOM}", headers=as_("alice"), json={"name": None})
    assert (r.status_code, field_of(r)) == (400, "name")


def test_errors_about_the_whole_request_name_no_field(client, as_):
    r = client.get("/incidents/999", headers=as_("emma"))
    assert (r.status_code, field_of(r)) == (404, None)
    r = client.post(f"/incidents/{WIFI}/status", headers=as_("sofia"), json={"status": "closed"})  # her own, but not resolved
    assert (r.status_code, field_of(r)) == (403, None)
