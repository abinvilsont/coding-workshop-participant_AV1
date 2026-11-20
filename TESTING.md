# Testing — ACME Facility Desk

How the app is tested, how to run the tests, the latest results, and what is
not covered yet.

## Quick start

```sh
./bin/run-tests.sh          # backend + frontend, with coverage (≈1 min)
./bin/run-tests.sh --e2e    # ...plus browser end-to-end tests (app must be running)
```

| Suite | Tool | Command | Needs |
|---|---|---|---|
| Backend unit + integration | pytest, FastAPI TestClient | `cd backend/api-service && .venv/bin/pytest --cov=app` | local PostgreSQL |
| Frontend components, services, pages | Vitest + React Testing Library (jsdom) | `cd frontend && npm run test:coverage` | nothing |
| End-to-end user journeys | Playwright (system Chrome) | `cd frontend && npm run test:e2e` | `./bin/start-dev.sh` running |
| API load | Artillery | see [Load testing](#load-testing) | API running |

First-time setup for the backend tests:

```sh
cd backend/api-service
python3.13 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

## Latest results (19 Nov 2026, local)

| Suite | Tests | Result | Coverage |
|---|---|---|---|
| Backend (pytest) | 336 | all pass, ~26 s | **99 %** of `app/` (1691 statements, 14 missed) |
| Frontend (Vitest 4) | 161 | all pass, ~20 s | **96 %** lines, 88 % branches, 93 % functions (Vitest 4 measures more precisely than 3, so the figures dropped without any test being lost) |
| End-to-end (Playwright) | 27 | all pass, ~3.5 min | every critical user path (below) |
| Load (Artillery) | 1 scenario | see below | — |

Both coverage runs enforce a minimum of 80 % and fail below it.

## Security checks on GitHub

Every push and pull request runs three checks (`.github/workflows/`):

| Check | What it runs | Status |
|---|---|---|
| Python | `bandit -r ./backend` | passes. `backend/.bandit` leaves out `tests/`, where pytest's `assert` and fake passwords are expected; the app code is scanned in full and has no findings |
| React | `npm audit --audit-level=high` on the frontend | passes. Vitest was upgraded to 4.1.12 (3.x pulled in a critical `tinypool` advisory); the packages users download never had any |
| Terraform | Checkov on `infra/` | report only (`soft_fail`) |

To repeat them locally: `pip install bandit && bandit -r ./backend`, and `npm audit --prefix ./frontend --audit-level=high`.
CI installs from `package.json` (the lockfile isn't committed) with Node 24 and npm 11; npm 10 has a bug installing Vitest 4's optional peers, so use `npx npm@11 install` if `npm install` fails with `edgesOut`.

## What is tested

### Backend — `backend/api-service/tests/`

**Unit tests** (`tests/unit/`, no database):

- `test_permissions.py`: every role rule in `app/services/permissions.py`.
  - Who can view an incident.
  - Each role's allowed status transitions.
  - Editing, escalation, and note / internal-note rights.
  - The `permissions` object the UI renders from.
- `test_security.py`
  - bcrypt hashing and verification.
  - JWT round trip, plus rejection of tampered or expired tokens.
  - Connection-pool sizing per runtime.
- `test_aws_settings.py`: on AWS (`IS_LOCAL=false`) the database connection requires TLS, uses a 10 s connect timeout and has no derived JWT key; an explicit `JWT_SECRET` always wins.
- `test_db_wake.py`: connection retries while a paused Aurora wakes, gives up after `DB_WAKE_SECONDS`, and doesn't retry locally.
- `test_packaged_sql.py`: the Lambda's copy of `backend/db` (`sql/`) matches the original; run `./bin/sync-db-sql.sh` if it fails.
- `test_schemas.py`: request validation.
  - Only acme.inc emails are accepted.
  - Password length limits.
  - Trimming, and required / blank fields.
  - Enum and range checks.

**Integration tests** (`tests/integration/`) run against a real PostgreSQL database:
- The run creates a throwaway `facility_desk_test` database from `backend/db/schema.sql`.
- `seed.sql` is reloaded before every test, so each test starts from the same 17 users (2 admins, 5 engineers, 10 employees), 5 buildings (21 floors, 115 seats) and 7 incidents.
- The database is dropped at the end. Your `postgres` database is never touched.

| File | Covers |
|---|---|
| `test_auth.py` | register (incl. ignoring a forged `role`), duplicates, login, generic login errors, disabled accounts, missing/invalid/expired tokens, deactivated users; token refresh keeps the session start, stops after 24 h, needs a valid token and active account, picks up a changed role, accepts older tokens |
| `test_incidents.py` | CRUD per role, visibility, filters, search, pagination, location validation, inactive buildings, edit rules, priority rules, delete with cascade |
| `test_workflow.py` | full lifecycle, every forbidden transition, assignment (busy / on-leave / non-engineer / at full capacity, last slot, freed slot), escalation rules, notes and internal-note visibility; moving back to Open (or reopening a cancelled incident) takes the engineer off, tells them, and the database refuses an Open incident with an engineer |
| `test_admin.py` | buildings / floors / seats CRUD, duplicates (409), delete-while-in-use (409), engineer create/update/deactivate, availability, admin-only endpoints |
| `test_notifications.py` | who is notified for each event, never the actor, internal notes never reach employees, read / read-all, ownership |
| `test_dashboard.py` | each role's dashboard numbers against the seed |
| `test_admin_tasks.py` | the Lambda's database tasks: `init_db` on an empty database (tables, admin, random JWT key, pooled connection left in normal mode), refuses a database with tables, sample data warns about passwords, input checks before touching anything, `migrate` repeatable and restores a missing key, `status` on a database from before `app_secrets`, direct invocations vs Function URL requests, tokens signed with the stored key |
| `test_concurrency.py` | two changes to one incident at the same moment, made deterministic by holding the first transaction open: a cancel arriving just after "start work" is refused (and vice versa), a note waits for a close and is refused, changes to different fields are both kept; stale edits (`expected_updated_at`) get 409, current ones save, clients that don't send it still work. Engineers: two admins taking an engineer's last free slot (the second gets 409 "full capacity"), deactivating an engineer while an assignment lands (refused, "Reassign them first") and the reverse order (the assignment is refused). The race tests fail if the row lock is removed |
| `test_users.py` | People admin: list and filter, make admin and back (takes effect on the next request, the person is notified), deactivate signs out and blocks sign-in, reactivate, not yourself, engineers refused, two admins demoting each other at once leave one admin (409), usual building: shown in the list, set and cleared (and returned by `/auth/me`), admins may set their own, must be an active building, not for engineers, admins only, bad input |
| `test_escalation_requests.py` | finding open incidents like a new report (same building + category + floor; resolved, closed and merged ignored; nothing about the reporter), `relation` for your own / followed ones; requesting escalation: follower, escalated with reason, note, history under the requester, notifications to reporter / engineer / admins, an already-escalated incident keeps its reason, once per employee, merged followers can ask once, refusals (own incident, resolved, admin, engineer, unknown, merged), reason length |
| `test_reviews.py` | engineer reviews: reporter and follower each review once a closed incident, engineers never see reviews (incident detail, engineer endpoints, own profile, notifications), admins see all plus the average (rounded to 1 dp), edit / delete / re-review, 409 on a second review, refused for admins, engineers, other employees and unclosed incidents, rating and comment validation, deleted with the incident |
| `test_merge.py` | merging duplicates: links both ways, the duplicate's reporter (and its own followers) follow the main incident, who is notified, followers get every update but not internal notes and can't confirm/cancel, chained merges, freed engineer capacity, candidates ordered by building + category, refusals (self, closed, already merged, non-admin), delete keeps the duplicate |
| `test_field_errors.py` | rule errors name the field they're about (location parts, critical priority, assignment, escalation, merge target, duplicate email / building code / name / floor / seat, engineer deactivation); errors about the whole request name none |
| `test_api_contract.py` | `{"message": ...}` error shape (400/404/405/500/503), malformed JSON and bad query values return 400, `PUT` works as an alias of every `PATCH` route, CloudFront path prefix, the Lambda handler with a real Function-URL event |

### Frontend: `frontend/src/**/*.test.{js,jsx}`

These tests mock `fetch` with a small fake backend (`src/test/mockApi.js`), so they run offline. Phone layouts are tested by wrapping a component in React Responsive's `Context` with a 390 px width.

| Area | Covers |
|---|---|
| `services/` | auth header, query strings, 204, error messages, validation errors mapped onto fields, network failure, auto sign-out on expired session (not on wrong password), email normalisation |
| `Login` | sign in, client-side validation with messages above each field and focus on the first, server field errors, loading state, registration, show password |
| `People` | list with role, department and last sign-in, "You" and engineer rows, make admin after confirming, cancelled confirm does nothing, deactivate hides unless inactive shown, refusal above that row's buttons, usual-building picker saves straight away (and clears), its refusal shown above it, a deactivated building stays visible, search and role filter, load error, empty, phone cards |
| `pwa` (static) | manifest fields and icons browsers need to install, icon files really have their stated sizes, page links, the service worker never caches `/api/` and only precaches files that exist |
| `NewIncident` | the "already reported" prompt: straight through when nothing matches, request escalation instead of a duplicate, refusal shown above the reason, report it anyway, back to the form, your own incident links instead, a failed check never blocks reporting, admins skip it, save errors inside the prompt; starts on the usual building from `/auth/me`, and still works if that check fails |
| `IncidentForm` | required fields with per-field messages that clear as you type, server field errors, building → floor → seat cascade, numeric payload, critical priority for admins only, server errors, starts on the usual building (with a hint) unless it's been deactivated, a soft note (never a block) when another building is picked, and that report still sends |
| `IncidentDetail` | role-based actions shown/hidden, merge duplicate (candidates, confirm, navigate), merged banner, also-reported-by and follower notice, rate / edit / delete a review, admin review list, no reviews for engineers, full engineers disabled in the picker, status change with comment, confirm before cancel, internal notes, escalation, assign + approve priority, edit, delete, errors, closed notes; edits send the version they started from, a stale edit closes the form on the latest version with a warning, a refused action reloads the incident and keeps its message visible even when its box disappears; an action refused with 404 (e.g. the ticket was reassigned while the page was open) reloads and says it may have been reassigned or deleted |
| `NotificationBell` | unread badge, list, open → mark read + navigate, mark all read, empty state, Escape, 30 s polling |
| `Dashboard` | employee / engineer / admin views, availability switch, empty and error states, refresh |
| `IncidentList` | filters and search sent to the API, role headings, paging, errors |
| `admin/Facilities`, `admin/Engineers` | create / edit / deactivate / delete, validation with per-field messages (incl. server field errors), conflict messages, inactive toggle, engineer ratings and reviews panel |
| `App` | sign in/out, tab title shows the user, admin nav and route guard, expired session |
| `apiClient` | JSON and token headers, query strings, error shapes and field errors, network failure, 401 sign-out; quiet token renewal under an hour left, one renewal shared by concurrent requests, carries on with the old token if renewal is refused or offline; an HTML page in reply to an API call (CloudFront's stand-in for a 404) is raised as a 404 |
| `AppLayout`, `IncidentTable` | desktop top bar vs phone menu drawer (React Responsive); at 1024 px admins get the drawer (six links) while employees keep the top bar, admins get it back at 1200 px; incident table vs cards on phones and tablets (768 px) |
| `ThemeToggle` | light ⇄ dark switch, choice saved and restored, `<html>` class, hidden outside the theme provider; with other tabs open, late storage events change nothing (fails with MUI's default storage) and a real change in another tab is followed |

### End-to-end: `frontend/e2e/`

These tests drive the real stack in Chrome: React → proxy → Lambda (LocalStack) → PostgreSQL.

| Spec | Journey |
|---|---|
| `incident-lifecycle.spec.js` | the full flow below, with each hand-off reached through the notification bell |
| `access.spec.js` | registration (domain check, duplicate), wrong password, employee blocked from admin pages, engineer sees only own tickets, "cannot reach the server" message |
| `admin.spec.js` | admin builds a building/floor/seat, the employee can pick it, then it is deleted; building in use cannot be deleted; admin creates an engineer who signs in and sets availability |
| `reviews.spec.js` | the employee closes a fixed incident and rates the engineer; the engineer sees no trace of it; the admin sees it on the incident and in the engineer's reviews |
| `parallel-updates.spec.js` | Emma cancels from a page still showing "Assigned" just after Tom started work: refused with a clear message and her page catches up; the admin saves an edit after Tom put the ticket on hold: warned, nothing overwritten, editing again saves |
| `people.spec.js` | the admin makes a newly registered employee a Facility Admin (they get the admin pages), then deactivates them (their next page load signs them out); the admin sets a new employee's usual building and their report form starts on it without signing in again, and picking another building shows the soft note |
| `already-reported.spec.js` | Emma reports a jammed printer; Liam starts reporting it too, is told it's already reported and requests escalation; he lands on Emma's incident as a follower, it's escalated, Emma and the admin are told, and a second attempt shows he's already following |
| `merge.spec.js` | two employees report the same leak, the admin merges and assigns it, the engineer resolves it, both employees are notified and only the original reporter can close it |
| `responsive.spec.js` | every role's pages (dashboard, incident list, report form, an incident, and the three admin pages) at 320 px, a Pixel 7, an iPad Mini portrait (768) and landscape (1024): no page or table scrolls sideways (lists switch to cards; admins get the menu drawer below 1200 px) |

The full lifecycle in `incident-lifecycle.spec.js`:
1. The employee reports an incident and escalates it.
2. The admin approves the priority and assigns an engineer.
3. The engineer works the ticket, adds a public note and an internal note, and resolves it.
4. The employee confirms the fix and the incident closes.

The E2E tests use the seeded accounts and tag everything they create:
- incidents titled `[e2e] …`
- users with `e2e.…@acme.inc` emails
- buildings with codes starting `E2E…`

Those records are deleted before and after every run. Failure screenshots and traces go to `frontend/test-results/`, and the HTML report to `frontend/playwright-report/`.

## Load testing

`backend/api-service/tests/load/api-load.yml` is an Artillery scenario that only reads data:
- Each simulated user logs in, loads the dashboard and the incident list, then polls the notification count three times.
- The run lasts 75 s and ramps up to 10 new users per second, about 14 requests per second.
- The run passes when the p95 response time is under 1.5 s and fewer than 1 % of users fail.

```sh
cd backend/api-service && .venv/bin/uvicorn app.main:app --port 8000   # terminal 1
npx --yes artillery@2.0.32 run backend/api-service/tests/load/api-load.yml   # terminal 2
# in AWS: add  --target https://<cloudfront-domain>/api/api-service
```

**What the first run found, and the fix.** The first run failed: 434 of 510 users timed out, and the
server log showed 207 errors reading `QueuePool limit of size 2 overflow 2 reached`.
- **Cause:** the database pool was fixed at 4 connections. FastAPI serves up to 40 requests at once,
  each on its own thread, so most requests waited for a connection and gave up after 30 s.
- **Why it doesn't matter on Lambda:** each instance serves one request at a time, so 4 was plenty there.
- **Fix:** the pool is now sized for how the API runs (`app/core/config.py`).
  - On Lambda: 1 connection plus 1 extra.
  - As a long-running server: 10 plus 30 extra.
  - Both can be overridden with `DB_POOL_SIZE` and `DB_MAX_OVERFLOW`.
- **Fail fast:** a request that still can't get a connection gives up after 10 s and receives
  `503 "The service is busy right now..."` with a `Retry-After` header instead of hanging.
  A database outage also returns a clear 503.

| Run (local, 2-core machine) | Users failed | Requests/s | Median | p95 | p99 |
|---|---|---|---|---|---|
| Before the fix | 434 / 510 | 12 | 147 ms | 1,620 ms | 2,019 ms |
| **After the fix** | **0 / 510** | **37** | **14 ms** | **228 ms** | **596 ms** |

The same scenario through LocalStack (`:3001`) is limited by LocalStack, not by the app:
- Even `/health` takes 3–4 s when 20 requests arrive together.
- LocalStack started more than 100 Lambda containers during the test.

On real AWS, Lambda scales by adding instances.

## Known gaps

- **Load test only run locally.** It hasn't been run against AWS yet; the numbers above come from a 2-core development machine.
- **No tests for the dev scripts.** The shell and Terraform scripts in `bin/` and `infra/` have no automated tests. They were checked by deploying to LocalStack.
- **E2E tests need the full stack.** They need the local stack running and the seeded accounts with their default passwords, and they don't run in CI.
- **Desktop E2E is Chrome only.** Only the responsive checks use the phone profile.
- **Accessibility is only partly covered.** It is exercised through role- and label-based queries; there is no automated audit such as axe.
