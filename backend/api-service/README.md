# api-service — ACME Facility Desk API

FastAPI + SQLAlchemy 2.0 (psycopg 3) backend, deployed as a single AWS Lambda
via [Mangum](https://mangum.fastapiexpert.com/). The database schema lives in
[`backend/db/schema.sql`](../db/schema.sql); the ORM models map onto it.

## Structure

```
api-service/
├── function.py            # Lambda entry point (Mangum wraps the FastAPI app)
├── requirements.txt
└── app/
    ├── main.py            # FastAPI app, error handlers, path-prefix middleware
    ├── core/
    │   ├── config.py      # settings from env (POSTGRES_*, JWT_SECRET, CORS_ORIGINS)
    │   └── security.py    # bcrypt password hashing, JWT tokens
    ├── db/session.py      # SQLAlchemy engine, SessionLocal, Base, get_db()
    ├── models/            # ORM models: User, Building/Floor/Seat, EngineerProfile,
    │                      #   Incident, IncidentNote, IncidentHistory + enums
    ├── schemas/           # Pydantic request/response models
    ├── services/
    │   ├── permissions.py   # role-based rules (single source of truth)
    │   ├── notifications.py # who is notified for each event
    │   └── incidents.py     # query helpers, response builders
    └── api/
        ├── deps.py        # get_current_user, require_roles(), AdminUser
        └── routes/        # auth, incidents, dashboard, facilities, engineers, notifications
```

## Endpoints

All routes except `/auth/register`, `/auth/login` and `/health` need
`Authorization: Bearer <token>`.
- Errors come back as `{"message": "..."}`.
- Invalid input returns **400** with an `errors: [{loc, msg}]` list, one entry per field.
- Rule errors about one field (raised as `FieldError`, `app/core/errors.py`) carry the same list with that field, e.g. `409` duplicate email → `email`, a full engineer → `engineer_id`, a floor from another building → `floor_id`. The UI shows the message above that field.
- `PUT` is accepted as an alias of every `PATCH` route.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Employee sign-up (`@acme.inc` only) |
| POST | `/auth/login` | public | Returns `{token, user}` (8h token) |
| GET | `/auth/me` | any | Current user |
| GET | `/incidents` | any | List (scoped by role); filters `status`, `priority`, `escalated`, `unassigned`, `q`, `limit`, `offset` |
| POST | `/incidents` | any | Report an incident |
| GET | `/incidents/{id}` | can view | Detail + notes + history + `permissions` |
| PATCH / PUT | `/incidents/{id}` | reporter (while open) / admin | Edit details; admin also `priority`, `is_escalated: false` |
| DELETE | `/incidents/{id}` | admin | Delete |
| POST | `/incidents/{id}/status` | role-dependent | Change status (+ optional comment) |
| POST | `/incidents/{id}/assign` | admin | Assign / reassign; refuses on-leave, offline, inactive (400) or full (409) engineers |
| POST | `/incidents/{id}/escalate` | reporter | Escalate, optionally request higher priority |
| POST | `/incidents/{id}/notes` | can view, not closed | Add note (`is_internal` for engineers/admins) |
| POST | `/incidents/{id}/review` | reporter / follower, closed | `{rating 1-5, comment?}`: rate the engineer (one each) |
| PUT / PATCH, DELETE | `/incidents/{id}/review` | the reviewer | Change or withdraw your review |
| GET | `/incidents/similar?building_id&category&floor_id` | any | Open incidents (open → on hold, not merged) that may already report this problem; brief: no reporter or description, plus `relation` (`reporter` / `follower`) |
| POST | `/incidents/{id}/escalation-request` | employee, not the reporter | `{reason?}`: follow the incident, escalate it if not already, add a note, notify; once per employee (409 after) |
| GET | `/incidents/{id}/merge-candidates` | admin | Open incidents to merge into, same building + category first |
| POST | `/incidents/{id}/merge` | admin | `{target_id}`: merge this duplicate into another open incident; its reporter follows the target |
| GET | `/dashboard` | any | Role-specific summary |
| GET | `/facilities` | any | Buildings → floors → seats (`include_inactive` for admins) |
| POST, PATCH / PUT, DELETE | `/buildings`, `/floors`, `/seats` (`/{id}`) | admin | Manage locations; delete refused (409) while in use |
| GET, POST | `/engineers` | admin | List with workload / create engineer account |
| GET, PATCH / PUT | `/engineers/{id}` | admin | View / update profile, capacity, availability, active flag |
| GET | `/engineers/{id}/reviews` | admin | Every review of the engineer, newest first (`GET /engineers` also returns `avg_rating`, `review_count`) |
| PATCH / PUT | `/engineers/me/availability` | engineer | Set own availability |
| GET | `/notifications` | any | Own notifications, newest first, + unread count |
| GET | `/notifications/unread-count` | any | Cheap badge count (polled every 30 s) |
| POST | `/notifications/{id}/read`, `/notifications/read-all` | any | Mark read (optionally for one incident) |

### Role rules (see `app/services/permissions.py`)

- **Employee** sees own incidents; edits while `open`; escalates; cancels before
  work starts; closes (confirms) or reopens a `resolved` incident.
- **Engineer** sees assigned incidents; `assigned → in_progress ⇄ on_hold → resolved`
  (and can reopen `resolved`); can add internal notes.
- **Facility Admin** sees and manages everything, including merging duplicates.
- **Follower** (reporter of a duplicate merged into the incident) can view it, add
  notes and gets every update the reporter gets, but can't confirm, reopen or cancel.
- **Reviews**: once an incident is closed, its reporter and followers may each rate
  the engineer. Admins see every review, an employee sees their own, and engineers
  see none (`visible_reviews()`).

Status, assignment, priority and escalation changes are written to
`incident_history` by a database trigger; the API sets `app.user_id` per request
so the acting user is recorded.

## Running

Through the workshop tooling (Lambda in LocalStack, behind the dev proxy):

```sh
./bin/start-dev.sh
curl http://localhost:3001/api/api-service/health
```

Directly with uvicorn, for interactive docs at http://localhost:8000/docs:

```sh
cd backend/api-service
python3.13 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt uvicorn
CORS_ORIGINS=http://localhost:3000 uvicorn app.main:app --reload --port 8000
```

## Database tasks on AWS

`function.handler` also accepts a direct invocation `{"action": "status" | "init_db" | "migrate"}`
(see `app/admin_tasks.py`). These run the SQL in `sql/`, which is a copy of `backend/db` kept in
sync by `./bin/sync-db-sql.sh` (`tests/unit/test_packaged_sql.py` fails if it drifts). Requests
through the Function URL always reach the web API, never these tasks.
