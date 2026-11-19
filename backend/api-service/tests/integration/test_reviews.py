"""Engineer reviews: who may write them, and who may see them (never the engineer)."""

import pytest

from tests.integration.conftest import AC, CHAIR, USERS

TOM = USERS["tom"][0]
PRIYA = USERS["priya"][0]


def review(client, headers, incident_id, rating=4, comment="Fixed it fast.", method="post"):
    return getattr(client, method)(
        f"/incidents/{incident_id}/review", headers=headers, json={"rating": rating, "comment": comment}
    )


@pytest.fixture
def fixed(client, as_, new_incident):
    """A fresh incident reported by Emma, fixed by Tom and closed by Emma."""
    def go(status_after="closed"):
        inc = new_incident("emma")
        client.post(f"/incidents/{inc['id']}/assign", headers=as_("alice"), json={"engineer_id": TOM})
        for s in ("in_progress", "resolved"):
            assert client.post(f"/incidents/{inc['id']}/status", headers=as_("tom"), json={"status": s}).status_code == 200
        if status_after == "closed":
            assert client.post(f"/incidents/{inc['id']}/status", headers=as_("emma"), json={"status": "closed"}).status_code == 200
        return inc
    return go


def test_reporter_reviews_the_engineer_once_closed(client, as_, fixed):
    inc = fixed()
    before = client.get(f"/incidents/{inc['id']}", headers=as_("emma")).json()
    assert before["permissions"]["can_review"] is True
    assert before["reviews"] == []

    r = review(client, as_("emma"), inc["id"], 5, "  Sorted in an hour, thanks!  ")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["permissions"]["can_review"] is False  # one each
    [mine] = body["reviews"]
    assert mine["rating"] == 5
    assert mine["comment"] == "Sorted in an hour, thanks!"
    assert (mine["engineer_id"], mine["engineer_name"]) == (TOM, "Tom Tech")
    assert mine["reviewer_name"] == "Emma Employee"


def test_engineer_never_sees_reviews(client, as_, fixed):
    inc = fixed()
    review(client, as_("emma"), inc["id"], 2, "Took three days.")
    as_tom = client.get(f"/incidents/{inc['id']}", headers=as_("tom")).json()
    assert as_tom["reviews"] == []
    assert as_tom["permissions"]["can_review"] is False
    # nor through the engineer endpoints
    assert client.get(f"/engineers/{TOM}/reviews", headers=as_("tom")).status_code == 403
    assert client.get("/engineers", headers=as_("tom")).status_code == 403
    assert client.get(f"/engineers/{TOM}", headers=as_("tom")).status_code == 403
    # the incident list carries no review data at all
    listed = client.get("/incidents", headers=as_("tom"), params={"q": inc["reference"]}).json()["items"]
    [row] = [i for i in listed if i["id"] == inc["id"]]
    assert not any("review" in k or "rating" in k for k in row)
    me = client.patch("/engineers/me/availability", headers=as_("tom"), json={"availability": "available"}).json()
    assert "avg_rating" not in me and "review_count" not in me
    # ...and no notification mentions it
    items = client.get("/notifications", headers=as_("tom")).json()["items"]
    assert not any("review" in n["message"].lower() for n in items)


def test_admin_sees_every_review_and_the_average(client, as_, fixed):
    inc = fixed()
    review(client, as_("emma"), inc["id"], 3, "OK")
    detail = client.get(f"/incidents/{inc['id']}", headers=as_("alice")).json()
    assert [r["rating"] for r in detail["reviews"]] == [3]
    assert detail["permissions"]["can_review"] is False

    tom = next(e for e in client.get("/engineers", headers=as_("alice")).json() if e["id"] == TOM)
    assert (tom["avg_rating"], tom["review_count"]) == (3.0, 1)
    listed = client.get(f"/engineers/{TOM}/reviews", headers=as_("alice")).json()
    assert listed[0]["incident_reference"] == inc["reference"]
    assert listed[0]["incident_title"] == inc["title"]
    assert listed[0]["comment"] == "OK"


def test_seeded_review_and_unrated_engineer(client, as_):
    engineers = {e["id"]: e for e in client.get("/engineers", headers=as_("alice")).json()}
    assert (engineers[PRIYA]["avg_rating"], engineers[PRIYA]["review_count"]) == (5.0, 1)
    assert (engineers[TOM]["avg_rating"], engineers[TOM]["review_count"]) == (None, 0)
    assert client.get(f"/engineers/{TOM}/reviews", headers=as_("alice")).json() == []
    assert client.get("/engineers/999/reviews", headers=as_("alice")).status_code == 404


def test_average_is_rounded_to_one_decimal(client, as_, fixed):
    for rating in (5, 4, 4):
        review(client, as_("emma"), fixed()["id"], rating)
    tom = next(e for e in client.get("/engineers", headers=as_("alice")).json() if e["id"] == TOM)
    assert (tom["avg_rating"], tom["review_count"]) == (4.3, 3)


def test_edit_and_delete_own_review(client, as_):
    # Emma's seeded review of Priya on the closed chair ticket
    r = review(client, as_("emma"), CHAIR, 3, "", method="put")
    assert r.status_code == 200, r.text
    [mine] = r.json()["reviews"]
    assert (mine["rating"], mine["comment"]) == (3, None)  # blank comment is stored as none
    assert review(client, as_("emma"), CHAIR, 4, method="patch").json()["reviews"][0]["rating"] == 4

    assert client.delete(f"/incidents/{CHAIR}/review", headers=as_("emma")).status_code == 204
    after = client.get(f"/incidents/{CHAIR}", headers=as_("emma")).json()
    assert after["reviews"] == []
    assert after["permissions"]["can_review"] is True  # may review again
    assert client.delete(f"/incidents/{CHAIR}/review", headers=as_("emma")).status_code == 404


def test_second_review_is_a_conflict(client, as_):
    r = review(client, as_("emma"), CHAIR)
    assert r.status_code == 409
    assert "already reviewed" in r.json()["message"]


@pytest.mark.parametrize("who, expected", [("alice", 403), ("priya", 403), ("liam", 404)])
def test_only_the_reporters_may_review(client, as_, who, expected):
    assert review(client, as_(who), CHAIR).status_code == expected


def test_not_before_the_incident_is_closed(client, as_, fixed):
    resolved = fixed(status_after="resolved")
    detail = client.get(f"/incidents/{resolved['id']}", headers=as_("emma")).json()
    assert detail["permissions"]["can_review"] is False
    r = review(client, as_("emma"), resolved["id"])
    assert r.status_code == 400
    assert r.json()["message"] == "You can review the engineer once the incident is closed."
    assert review(client, as_("emma"), AC).status_code == 400  # in progress


def test_editing_someone_elses_review_is_impossible(client, as_):
    assert review(client, as_("alice"), CHAIR, method="put").status_code == 404
    assert client.delete(f"/incidents/{CHAIR}/review", headers=as_("alice")).status_code == 404
    assert client.get(f"/incidents/{CHAIR}", headers=as_("alice")).json()["reviews"][0]["rating"] == 5


@pytest.mark.parametrize("payload", [
    {"rating": 0}, {"rating": 6}, {"rating": "great"}, {}, {"rating": 3, "comment": "x" * 2001},
])
def test_rating_is_validated(client, as_, payload):
    r = client.put(f"/incidents/{CHAIR}/review", headers=as_("emma"), json=payload)
    assert r.status_code == 400
    assert r.json()["errors"]


def test_follower_reviews_separately_and_reporters_see_only_their_own(client, as_, new_incident):
    target = new_incident("emma")
    dup = new_incident("liam", title="Same projector")
    assert client.post(f"/incidents/{dup['id']}/merge", headers=as_("alice"),
                       json={"target_id": target["id"]}).status_code == 200
    client.post(f"/incidents/{target['id']}/assign", headers=as_("alice"), json={"engineer_id": TOM})
    for s in ("in_progress", "resolved"):
        client.post(f"/incidents/{target['id']}/status", headers=as_("tom"), json={"status": s})
    client.post(f"/incidents/{target['id']}/status", headers=as_("emma"), json={"status": "closed"})

    assert review(client, as_("emma"), target["id"], 5, "Great").status_code == 201
    as_liam = client.get(f"/incidents/{target['id']}", headers=as_("liam")).json()
    assert as_liam["permissions"]["can_review"] is True
    assert as_liam["reviews"] == []  # can't see Emma's
    assert review(client, as_("liam"), target["id"], 2, "Slow").status_code == 201
    assert [r["rating"] for r in client.get(f"/incidents/{target['id']}", headers=as_("emma")).json()["reviews"]] == [5]
    assert sorted(r["rating"] for r in client.get(f"/incidents/{target['id']}", headers=as_("alice")).json()["reviews"]) == [2, 5]


def test_deleting_the_incident_removes_its_reviews(client, as_):
    assert client.delete(f"/incidents/{CHAIR}", headers=as_("alice")).status_code == 204
    assert client.get(f"/engineers/{PRIYA}/reviews", headers=as_("alice")).json() == []
