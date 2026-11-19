"""People admin: list accounts, change employee/admin roles, (de)activate - with safeguards."""

import pytest

from tests.integration.conftest import USERS, login_as, unread

EMMA, LIAM, TOM, ALICE, BEN = (USERS[n][0] for n in ("emma", "liam", "tom", "alice", "ben"))


def patch(client, headers, user_id, **body):
    return client.patch(f"/users/{user_id}", headers=headers, json=body)


def test_admin_lists_everyone_admins_first(client, as_):
    body = client.get("/users", headers=as_("alice")).json()
    assert body["total"] == 17  # 2 admins, 5 engineers, 10 employees
    assert body["items"][0]["role"] == "facility_admin"
    emma = next(u for u in body["items"] if u["id"] == EMMA)
    assert (emma["name"], emma["email"], emma["role"], emma["is_active"]) == ("Emma Employee", "emma@acme.inc", "employee", True)
    assert "password_hash" not in emma


def test_list_filters(client, as_):
    get = lambda **p: client.get("/users", headers=as_("alice"), params=p).json()  # noqa: E731
    assert {u["role"] for u in get(role="engineer")["items"]} == {"engineer"}
    assert [u["email"] for u in get(q="liam")["items"]] == ["liam.lee@acme.inc"]
    patch(client, as_("alice"), LIAM, is_active=False)
    assert LIAM not in [u["id"] for u in get()["items"]]
    assert LIAM in [u["id"] for u in get(include_inactive=True)["items"]]


def test_promote_an_employee_to_admin_and_back(client, as_):
    r = patch(client, as_("alice"), EMMA, role="facility_admin")
    assert r.status_code == 200 and r.json()["role"] == "facility_admin"
    # takes effect on her very next request: admin pages open
    assert client.get("/engineers", headers=as_("emma")).status_code == 200
    assert [n["message"] for n in unread(client, as_("emma"))][-1:] == [
        "Alice Admin made you a Facility Admin. Sign in again to see the change."
    ]
    assert patch(client, as_("alice"), EMMA, role="employee").json()["role"] == "employee"
    assert client.get("/engineers", headers=as_("emma")).status_code == 403


def test_deactivating_signs_the_person_out_and_reactivating_lets_them_back(client, as_):
    token_headers = {"Authorization": f"Bearer {login_as(client, 'liam.lee@acme.inc')}"}
    assert patch(client, as_("alice"), LIAM, is_active=False).json()["is_active"] is False
    assert client.get("/incidents", headers=token_headers).status_code == 401
    assert client.post("/auth/login", json={"email": "liam.lee@acme.inc", "password": "Password123!"}).status_code == 403
    patch(client, as_("alice"), LIAM, is_active=True)
    assert client.get("/incidents", headers=token_headers).status_code == 200


def test_you_cannot_change_yourself(client, as_):
    r = patch(client, as_("alice"), ALICE, role="employee")
    assert r.status_code == 400 and r.json()["errors"][0]["loc"][-1] == "role"
    assert patch(client, as_("alice"), ALICE, is_active=False).status_code == 400


def test_an_admin_can_demote_another_admin(client, as_):
    patch(client, as_("alice"), EMMA, role="facility_admin")
    assert patch(client, as_("emma"), ALICE, role="employee").status_code == 200
    # Alice is an employee from her next request on; Emma remains the admin
    assert patch(client, as_("alice"), EMMA, role="employee").status_code == 403


def test_two_admins_demoting_each_other_at_once_leave_one_admin(client, as_):
    """The race the last-admin check exists for: Emma and Alice (both admins) each
    demote the other. Emma's request passed the admin check, then Alice's change
    landed first. Emma's update must then be refused, not leave zero admins."""
    from app.api.routes.users import UserUpdate, update_user
    from app.core.errors import FieldError
    from app.db.session import SessionLocal
    from app.models import User

    patch(client, as_("alice"), BEN, role="employee")  # so Alice and Emma are the only admins
    patch(client, as_("alice"), EMMA, role="facility_admin")
    with SessionLocal() as db:
        emma_as_authenticated = db.get(User, EMMA)  # still an admin when her request started
        db.expunge(emma_as_authenticated)
    assert patch(client, as_("alice"), EMMA, role="employee").status_code == 200  # Alice wins the race

    with SessionLocal() as db, pytest.raises(FieldError) as refused:
        update_user(ALICE, UserUpdate(role="employee"), db, emma_as_authenticated)
    assert refused.value.status_code == 409
    assert refused.value.detail == "There must always be at least one active Facility Admin."
    with SessionLocal() as db:
        assert db.get(User, ALICE).role == "facility_admin"


@pytest.mark.parametrize("target, body", [
    (TOM, {"role": "employee"}),
    (TOM, {"is_active": False}),
    (EMMA, {"role": "engineer"}),
])
def test_engineers_are_managed_on_the_engineers_page(client, as_, target, body):
    r = patch(client, as_("alice"), target, **body)
    assert r.status_code == 400
    assert r.json()["message"] == "Engineers are managed on the Engineers page."


@pytest.mark.parametrize("who, code", [("emma", 403), ("tom", 403)])
def test_only_admins_manage_people(client, as_, who, code):
    assert client.get("/users", headers=as_(who)).status_code == code
    assert patch(client, as_(who), LIAM, is_active=False).status_code == code


def test_bad_requests(client, as_):
    assert patch(client, as_("alice"), 999, is_active=False).status_code == 404
    assert patch(client, as_("alice"), EMMA, role="king").status_code == 400
    assert patch(client, as_("alice"), EMMA, role=None).status_code == 400
    assert client.put(f"/users/{EMMA}", headers=as_("alice"), json={"is_active": True}).status_code == 200


# ------------------------------------------------------------ usual building

def test_the_list_shows_each_persons_usual_building(client, as_):
    items = {u["id"]: u for u in client.get("/users", headers=as_("alice")).json()["items"]}
    assert items[EMMA]["home_building"] == "ACME Headquarters"
    assert items[USERS["noah"][0]]["home_building"] is None


def test_an_admin_sets_and_clears_someones_usual_building(client, as_, facilities):
    inn = facilities["inn"]["id"]
    r = patch(client, as_("alice"), EMMA, home_building_id=inn)
    assert r.status_code == 200
    assert (r.json()["home_building_id"], r.json()["home_building"]) == (inn, "ACME Innovation Hub")
    # Emma's own account says so, which is what the report form starts on
    assert client.get("/auth/me", headers=as_("emma")).json()["home_building_id"] == inn
    r = patch(client, as_("alice"), EMMA, home_building_id=None)
    assert r.status_code == 200 and r.json()["home_building"] is None
    assert client.get("/auth/me", headers=as_("emma")).json()["home_building_id"] is None


def test_admins_can_set_their_own_usual_building(client, as_, facilities):
    r = patch(client, as_("alice"), ALICE, home_building_id=facilities["inn"]["id"])
    assert r.status_code == 200 and r.json()["home_building"] == "ACME Innovation Hub"


@pytest.mark.parametrize("building", ["missing", "inactive"])
def test_the_building_must_exist_and_be_active(client, as_, facilities, building):
    bid = 999999
    if building == "inactive":
        bid = facilities["inn"]["id"]
        assert client.patch(f"/buildings/{bid}", headers=as_("alice"), json={"is_active": False}).status_code == 200
    r = patch(client, as_("alice"), EMMA, home_building_id=bid)
    assert r.status_code == 400
    assert r.json()["errors"] == [{"loc": ["body", "home_building_id"], "msg": "Choose an active building."}]


def test_engineers_buildings_are_set_on_the_engineers_page(client, as_, facilities):
    r = patch(client, as_("alice"), TOM, home_building_id=facilities["inn"]["id"])
    assert r.status_code == 400 and r.json()["errors"][0]["loc"][-1] == "home_building_id"


def test_only_admins_can_set_a_building(client, as_, facilities):
    assert patch(client, as_("emma"), EMMA, home_building_id=facilities["inn"]["id"]).status_code == 403
