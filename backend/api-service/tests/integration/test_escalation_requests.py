"""Reporting a problem that's already reported: find it, and ask for it to be escalated instead."""

import pytest

from tests.integration.conftest import AC, LIGHTS, USERS, WIFI, unread

LIAM = USERS["liam"][0]


def similar(client, headers, **params):
    r = client.get("/incidents/similar", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def ask(client, headers, incident_id, reason="Our whole team is affected."):
    return client.post(f"/incidents/{incident_id}/escalation-request", headers=headers, json={"reason": reason})


@pytest.fixture
def quiet(client, as_):
    """Empty inboxes, so tests only see the messages they cause."""
    for who in ("emma", "liam", "sofia", "ethan", "alice"):
        client.post("/notifications/read-all", headers=as_(who))


# ---------------------------------------------------------------- finding it

def test_finds_open_incidents_in_the_same_building_and_category(client, as_, facilities):
    hq, floor1, floor2 = facilities["hq"]["id"], facilities["hq_floor1"]["id"], facilities["hq_floor2"]["id"]
    [ac] = similar(client, as_("liam"), building_id=hq, category="hvac", floor_id=floor1)
    assert (ac["id"], ac["status"], ac["relation"]) == (AC, "in_progress", None)
    assert ac["building"] == "ACME Headquarters" and ac["floor"] and ac["seat"] == "1A-001"
    # deliberately brief: nothing about who reported it or what they wrote
    assert not {"reported_by", "description", "notes"} & ac.keys()

    assert similar(client, as_("liam"), building_id=hq, category="hvac")[0]["id"] == AC  # no floor given
    assert similar(client, as_("liam"), building_id=hq, category="hvac", floor_id=floor2) == []
    assert similar(client, as_("liam"), building_id=hq, category="plumbing", floor_id=floor1) == []


def test_says_when_it_is_already_yours(client, as_, facilities):
    hq = facilities["hq"]["id"]
    assert similar(client, as_("emma"), building_id=hq, category="hvac")[0]["relation"] == "reporter"
    ask(client, as_("liam"), AC)
    assert similar(client, as_("liam"), building_id=hq, category="hvac")[0]["relation"] == "follower"


def test_ignores_resolved_closed_and_merged_incidents(client, as_, facilities, new_incident):
    hq, floor1 = facilities["hq"]["id"], facilities["hq_floor1"]["id"]
    # LIGHTS is resolved (electrical, HQ floor 1): fixed as far as the engineer knows
    assert similar(client, as_("liam"), building_id=hq, category="electrical", floor_id=floor1) == []
    a = new_incident("emma")
    b = new_incident("sofia")
    client.post(f"/incidents/{b['id']}/merge", headers=as_("alice"), json={"target_id": a["id"]})
    found = similar(client, as_("liam"), building_id=hq, category="audio_visual", floor_id=floor1)
    assert [i["id"] for i in found] == [a["id"]]


def test_similar_needs_a_building_and_category(client, as_):
    assert client.get("/incidents/similar", headers=as_("liam")).status_code == 400
    assert client.get("/incidents/similar", params={"building_id": 1, "category": "x"}, headers=as_("liam")).status_code == 400
    assert client.get("/incidents/similar", params={"building_id": 1, "category": "hvac"}).status_code == 401


# ---------------------------------------------------------------- asking to escalate

def test_request_escalates_and_makes_the_employee_a_follower(client, as_, quiet):
    r = ask(client, as_("liam"), AC)
    assert r.status_code == 200, r.text
    inc = r.json()
    assert inc["is_escalated"] is True
    assert inc["escalation_reason"] == (
        "Liam Lee has the same problem and asked for it to be escalated. Their reason: Our whole team is affected."
    )
    [follower] = inc["followers"]
    assert (follower["id"], follower["name"]) == (LIAM, "Liam Lee") and follower["escalation_requested_at"]
    assert inc["notes"][-1]["body"] == (
        "I have the same problem and asked for this to be escalated. Their reason: Our whole team is affected."
    )
    assert inc["notes"][-1]["author_name"] == "Liam Lee"
    assert inc["history"][-1]["event_type"] == "escalation"
    assert inc["history"][-1]["changed_by"] == "Liam Lee"
    # a follower can't escalate again or confirm the fix; it's still Emma's incident
    assert inc["permissions"]["can_escalate"] is False
    assert inc["permissions"]["status_transitions"] == []

    # Liam now sees it, in his list too
    assert client.get(f"/incidents/{AC}", headers=as_("liam")).status_code == 200
    assert AC in [i["id"] for i in client.get("/incidents", headers=as_("liam")).json()["items"]]


def test_request_tells_the_reporter_engineer_and_admins(client, as_, quiet):
    ask(client, as_("liam"), AC, reason=None)
    messages = lambda who: [n["message"] for n in unread(client, as_(who))]  # noqa: E731
    assert messages("emma") == ["Liam Lee reported the same problem and asked to escalate your incident INC-000004"]
    assert messages("ethan") == ["Liam Lee has the same problem and asked to escalate INC-000004"]
    assert messages("alice") == ["Liam Lee has the same problem and asked to escalate INC-000004"]
    assert messages("liam") == []  # never the actor


def test_an_already_escalated_incident_keeps_its_reason_but_gets_the_note(client, as_):
    before = client.get(f"/incidents/{WIFI}", headers=as_("alice")).json()
    inc = ask(client, as_("liam"), WIFI, reason="Lab is blocked for us too").json()
    assert inc["escalation_reason"] == before["escalation_reason"]
    assert inc["notes"][-1]["body"].endswith("Their reason: Lab is blocked for us too")


def test_only_once_per_employee(client, as_):
    assert ask(client, as_("liam"), AC).status_code == 200
    r = ask(client, as_("liam"), AC)
    assert r.status_code == 409
    assert r.json()["message"] == "You've already asked for this incident to be escalated."


def test_a_follower_from_a_merge_can_still_ask_once(client, as_, new_incident):
    a = new_incident("emma")
    b = new_incident("liam")
    client.post(f"/incidents/{b['id']}/merge", headers=as_("alice"), json={"target_id": a["id"]})
    inc = ask(client, as_("liam"), a["id"]).json()
    assert [f["id"] for f in inc["followers"]] == [LIAM] and inc["followers"][0]["escalation_requested_at"]
    assert ask(client, as_("liam"), a["id"]).status_code == 409


@pytest.mark.parametrize("who, incident, code", [
    ("emma", AC, 400),      # her own: use Escalate
    ("liam", LIGHTS, 400),  # resolved
    ("alice", AC, 403),     # admins escalate directly
    ("ethan", AC, 403),     # engineers can't
    ("liam", 999, 404),
])
def test_refusals(client, as_, who, incident, code):
    assert ask(client, as_(who), incident).status_code == code


def test_a_merged_duplicate_cannot_be_escalated(client, as_, new_incident):
    a = new_incident("emma")
    b = new_incident("sofia")
    client.post(f"/incidents/{b['id']}/merge", headers=as_("alice"), json={"target_id": a["id"]})
    assert ask(client, as_("liam"), b["id"]).status_code == 404


def test_reason_is_optional_but_limited(client, as_):
    assert ask(client, as_("liam"), AC, reason="x" * 2001).status_code == 400
    r = client.post(f"/incidents/{AC}/escalation-request", headers=as_("liam"), json={})
    assert r.status_code == 200
    assert r.json()["notes"][-1]["body"] == "I have the same problem and asked for this to be escalated."
