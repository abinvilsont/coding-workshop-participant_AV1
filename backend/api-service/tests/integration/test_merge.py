"""Merging duplicate incidents: links, followers, notifications and permissions."""

import pytest

from tests.integration.conftest import CHAIR, USERS, unread


def merge(client, headers, source_id, target_id):
    return client.post(f"/incidents/{source_id}/merge", headers=headers, json={"target_id": target_id})


def messages(client, headers) -> list[str]:
    return [n["message"] for n in unread(client, headers)]


@pytest.fixture
def pair(client, as_, new_incident):
    """Emma and Liam report the same broken projector; returns (emma's, liam's)."""
    a = new_incident("emma")
    b = new_incident("liam", title="Projector in 1A not working", description="Screen stays blue.")
    # start every test with empty inboxes so assertions only see merge-related messages
    for who in ("emma", "liam", "tom", "alice"):
        client.post("/notifications/read-all", headers=as_(who))
    return a, b


def test_merge_links_the_duplicate_and_makes_its_reporter_a_follower(client, as_, pair):
    a, b = pair
    r = merge(client, as_("alice"), b["id"], a["id"])
    assert r.status_code == 200, r.text
    target = r.json()
    assert target["id"] == a["id"]
    assert target["followers"] == [{"id": USERS["liam"][0], "name": "Liam Lee"}]
    assert target["merged_from"] == [
        {"id": b["id"], "reference": b["reference"], "title": b["title"], "reported_by": "Liam Lee"}
    ]
    # the engineer gets the duplicate's details as a note on the main incident
    assert any(
        n["body"].startswith(f"Merged {b['reference']}, reported by Liam Lee.") and "Screen stays blue." in n["body"]
        for n in target["notes"]
    )

    dup = client.get(f"/incidents/{b['id']}", headers=as_("liam")).json()
    assert dup["status"] == "cancelled"
    assert dup["merged_into"] == {"id": a["id"], "reference": a["reference"], "title": a["title"], "reported_by": None}
    assert dup["notes"][-1]["body"].startswith(f"Merged into {a['reference']}")
    assert dup["permissions"]["can_merge"] is False


def test_merge_tells_everyone_involved(client, as_, pair):
    a, b = pair
    client.post(f"/incidents/{a['id']}/assign", headers=as_("alice"), json={"engineer_id": USERS["tom"][0]})
    for who in ("emma", "tom"):
        client.post("/notifications/read-all", headers=as_(who))

    merge(client, as_("alice"), b["id"], a["id"])
    assert messages(client, as_("liam")) == [
        f"Alice Admin merged your incident {b['reference']} into {a['reference']}, which reports the same problem. "
        "You'll get its updates from now on."
    ]
    assert messages(client, as_("emma")) == [
        f"Liam Lee reported the same problem; Alice Admin merged {b['reference']} into your incident {a['reference']}."
    ]
    assert messages(client, as_("tom")) == [
        f"Alice Admin merged {b['reference']} (Liam Lee) into your ticket {a['reference']}."
    ]
    assert messages(client, as_("alice")) == []  # never the actor
    # the follower's notification opens the main incident
    assert unread(client, as_("liam"))[0]["incident_id"] == a["id"]


def test_both_reporters_follow_the_main_incident_to_closure(client, as_, pair):
    a, b = pair
    merge(client, as_("alice"), b["id"], a["id"])
    client.post("/notifications/read-all", headers=as_("liam"))

    # the follower sees it in their list and on their dashboard
    listed = client.get("/incidents", headers=as_("liam")).json()["items"]
    assert {i["id"] for i in listed} >= {a["id"], b["id"]}
    dashboard = client.get("/dashboard", headers=as_("liam")).json()
    assert a["id"] in {i["id"] for i in dashboard["incidents"]}

    client.post(f"/incidents/{a['id']}/assign", headers=as_("alice"), json={"engineer_id": USERS["tom"][0]})
    client.post(f"/incidents/{a['id']}/status", headers=as_("tom"), json={"status": "in_progress"})
    client.post(f"/incidents/{a['id']}/notes", headers=as_("tom"), json={"body": "Ordered a new cable.", "is_internal": True})
    client.post(f"/incidents/{a['id']}/status", headers=as_("tom"), json={"status": "resolved"})

    for who in ("emma", "liam"):
        got = messages(client, as_(who))
        assert any("Tom Tech is now working on your incident" in m for m in got), who
        assert any(m.endswith("Please confirm the fix or reopen it") for m in got), who
        assert not any("internal note" in m for m in got), who

    # followers can read and comment, but internal notes stay hidden and only the reporter confirms
    seen = client.get(f"/incidents/{a['id']}", headers=as_("liam")).json()
    assert not any(n["is_internal"] for n in seen["notes"])
    assert seen["permissions"]["status_transitions"] == []
    assert seen["permissions"]["can_add_note"] is True
    assert seen["permissions"]["can_escalate"] is False
    assert client.post(f"/incidents/{a['id']}/status", headers=as_("liam"), json={"status": "closed"}).status_code == 403

    r = client.post(f"/incidents/{a['id']}/notes", headers=as_("liam"), json={"body": "Still blue for me."})
    assert r.status_code == 201
    assert any("Liam Lee added a note" in m for m in messages(client, as_("emma")))

    assert client.post(f"/incidents/{a['id']}/status", headers=as_("emma"), json={"status": "closed"}).status_code == 200
    assert any("to Closed" in m for m in messages(client, as_("liam")))


def test_chained_duplicates_end_up_on_the_main_incident(client, as_, new_incident):
    a = new_incident("emma")
    b = new_incident("liam")
    c = new_incident("noah")
    admin = as_("alice")
    assert merge(client, admin, c["id"], b["id"]).status_code == 200
    target = merge(client, admin, b["id"], a["id"]).json()
    assert {f["name"] for f in target["followers"]} == {"Liam Lee", "Noah Patel"}
    assert {m["id"] for m in target["merged_from"]} == {b["id"], c["id"]}
    assert client.get(f"/incidents/{c['id']}", headers=as_("noah")).json()["merged_into"]["id"] == a["id"]
    assert client.get(f"/incidents/{a['id']}", headers=as_("noah")).status_code == 200


def test_merging_frees_the_duplicates_engineer(client, as_, pair):
    a, b = pair
    admin, tom = as_("alice"), as_("tom")
    tom_id = USERS["tom"][0]
    before = client.get(f"/engineers/{tom_id}", headers=admin).json()["active_tickets"]
    client.post(f"/incidents/{b['id']}/assign", headers=admin, json={"engineer_id": tom_id})
    assert client.get(f"/engineers/{tom_id}", headers=admin).json()["active_tickets"] == before + 1
    client.post("/notifications/read-all", headers=tom)

    merge(client, admin, b["id"], a["id"])
    assert client.get(f"/engineers/{tom_id}", headers=admin).json()["active_tickets"] == before
    assert messages(client, tom) == [f"Alice Admin merged {b['reference']} into {a['reference']}; it is no longer on your list."]


def test_a_reporter_who_reports_twice_does_not_follow_their_own_incident(client, as_, new_incident):
    a = new_incident("emma")
    b = new_incident("emma")
    target = merge(client, as_("alice"), b["id"], a["id"]).json()
    assert target["followers"] == []


@pytest.mark.parametrize("case, status, message", [
    ("self", 400, "An incident can't be merged into itself."),
    ("target_final", 400, "is closed or cancelled. Merge into an open incident."),
    ("source_merged", 400, "has already been merged into another incident."),
    ("missing", 404, "Incident not found."),
])
def test_merge_is_refused_when_it_makes_no_sense(client, as_, pair, new_incident, case, status, message):
    a, b = pair
    admin = as_("alice")
    if case == "self":
        r = merge(client, admin, a["id"], a["id"])
    elif case == "target_final":
        r = merge(client, admin, b["id"], CHAIR)  # CHAIR is closed in the seed
    elif case == "source_merged":
        merge(client, admin, b["id"], a["id"])
        r = merge(client, admin, b["id"], new_incident("noah")["id"])
    else:
        r = merge(client, admin, b["id"], 99999)
    assert r.status_code == status
    assert message in r.json()["message"]


def test_cancelled_incidents_cannot_be_merged(client, as_, pair):
    a, b = pair
    client.post(f"/incidents/{b['id']}/status", headers=as_("liam"), json={"status": "cancelled"})
    r = merge(client, as_("alice"), b["id"], a["id"])
    assert r.status_code == 400 and r.json()["message"] == "Closed or cancelled incidents can't be merged."


@pytest.mark.parametrize("who", ["emma", "liam", "tom"])
def test_only_admins_merge(client, as_, pair, who):
    a, b = pair
    assert merge(client, as_(who), b["id"], a["id"]).status_code == 403
    assert client.get(f"/incidents/{b['id']}/merge-candidates", headers=as_(who)).status_code == 403


def test_merge_candidates_list_likely_duplicates_first(client, as_, facilities, new_incident):
    source = new_incident("liam")
    same = new_incident("emma")                                        # same building + category
    same_building = new_incident("noah", category="electrical")        # same building only
    other = new_incident(
        "sofia", building_id=facilities["inn"]["id"],
        floor_id=facilities["inn_floor1"]["id"], seat_id=None,
    )
    r = client.get(f"/incidents/{source['id']}/merge-candidates", headers=as_("alice"))
    assert r.status_code == 200
    ids = [i["id"] for i in r.json()]
    assert source["id"] not in ids and CHAIR not in ids          # never itself or a closed one
    assert ids.index(same["id"]) < ids.index(same_building["id"]) < ids.index(other["id"])

    merge(client, as_("alice"), same["id"], other["id"])
    ids = [i["id"] for i in client.get(f"/incidents/{source['id']}/merge-candidates", headers=as_("alice")).json()]
    assert same["id"] not in ids                                  # merged ones are gone


def test_list_marks_merged_duplicates(client, as_, pair):
    a, b = pair
    merge(client, as_("alice"), b["id"], a["id"])
    items = {i["id"]: i for i in client.get("/incidents", headers=as_("liam")).json()["items"]}
    assert items[b["id"]]["merged_into_id"] == a["id"]
    assert items[a["id"]]["merged_into_id"] is None


def test_deleting_the_main_incident_keeps_the_duplicate(client, as_, pair):
    a, b = pair
    merge(client, as_("alice"), b["id"], a["id"])
    client.post("/notifications/read-all", headers=as_("liam"))
    assert client.delete(f"/incidents/{a['id']}", headers=as_("alice")).status_code == 204
    dup = client.get(f"/incidents/{b['id']}", headers=as_("liam")).json()
    assert dup["status"] == "cancelled" and dup["merged_into"] is None
    assert any("deleted" in m for m in messages(client, as_("liam")))  # followers hear about the deletion


def test_long_duplicate_descriptions_are_trimmed_in_the_note(client, as_, new_incident):
    a = new_incident("emma")
    b = new_incident("liam", description="x" * 3000)
    target = merge(client, as_("alice"), b["id"], a["id"]).json()
    note = target["notes"][-1]["body"]
    assert note.endswith("…") and len(note) < 1600
