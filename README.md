# ACME Facility Desk

An incident desk for ACME's offices. Employees report facility and workplace-tech
problems (a broken chair, no Wi-Fi, a leaking tap). Facility Admins triage and assign
them, and Engineers fix them. Everyone involved is kept informed in the app.

Built for the coding workshop. The workshop brief and evaluation guides are in
[`docs/`](docs/README.md); the original brief is in
[`docs/WORKSHOP-BRIEF.md`](docs/WORKSHOP-BRIEF.md). How the app works, step by step and with
diagrams, is in [`docs/work_explanation/`](docs/work_explanation/README.md).

**View in your browser:** [How ACME Facility Desk Works](https://claude.ai/artifact/4zg4HwDhZH7Agf9TZVPy6h)
· [Architecture page](https://claude.ai/artifact/5K5Hw9Gkc1Lg2SGG9JziYM)

## What it does

| Role | Can do |
|---|---|
| **Employee** (self-registers with an `@acme.inc` email) | Report incidents with building / floor / seat (and are told if it's already reported, so they can request escalation instead), follow progress, add notes, escalate and request a higher priority, cancel before work starts, confirm the fix or reopen, rate the engineer once the incident is closed |
| **Engineer** (created by an admin) | See only tickets assigned to them, move them `assigned → in progress ⇄ on hold → resolved`, add public or internal notes, set their own availability |
| **Facility Admin** | See everything, set priority, assign engineers (on-leave, offline or full engineers are refused), merge duplicate reports, read engineer reviews and ratings, manage buildings / floors / seats and engineer accounts, manage **People** (make an employee an admin or back, deactivate or reactivate accounts), delete incidents |

An incident's journey: **Open → Assigned → In progress → Resolved → Closed**. The
reporter, not the engineer, confirms the fix. Every change is written to the
incident's history, and the people involved are notified through the bell
(it polls every 30 s).

**Already reported?** Before a new report is saved, the app looks for open incidents
in the same building and category (and floor, when both have one). If it finds any,
the employee sees **"This may already be reported"** and can:
- **Request escalation** on the existing incident (with an optional reason). They
  become a follower, the incident is escalated if it wasn't already, a note names
  them for the engineer, and the admins, engineer and original reporter are told.
  Each employee can request this once per incident.
- **Report it anyway** if it's a different problem, or go back to the form.

**Duplicates.** If two employees still report the same problem, an admin merges one
report into the other:
- The duplicate is closed and labelled "Merged", with a link to the main incident.
- The duplicate's details are added to the main incident as a note.
- Its reporter becomes a **follower** of the main incident: they see it, can comment,
  and get every update.
- Only the original reporter confirms the fix.

**Engineer reviews.** Once an incident is closed, the employees who reported it
(the reporter and any followers) can each rate the engineer from 1 to 5 stars, with
an optional comment, and edit or delete that review later.
- The reviewer sees their own review on the incident.
- Admins see every review on the incident, plus each engineer's average rating on
  the Engineers page.
- **Engineers never see reviews.** The API leaves reviews out of every response an
  engineer receives, and doesn't notify them.

## Architecture

```
 Browser ──► CloudFront ──► S3                    (React app)
                   │
                   └── /api/api-service/* ──► Lambda (FastAPI + Mangum) ──► PostgreSQL (Aurora)
```

- **Frontend:** React 19, Material UI 7, React Responsive, Vite. Hash routing, so it
  works on S3 without rewrite rules. Light and dark mode: the sun/moon button in
  the top bar (and on the sign-in page) switches, and the choice is remembered on
  that device. Until someone picks, the app follows the device's own setting.
- **Backend:** one FastAPI service (`backend/api-service`) running on Lambda through
  Mangum. It uses SQLAlchemy 2, Pydantic 2, JWT auth and bcrypt hashing.
- **Database:** PostgreSQL. The schema is in [`backend/db/schema.sql`](backend/db/schema.sql),
  with constraints and a trigger that records incident history.
- **Locally:** LocalStack runs the Lambda, and `bin/proxy-server.js` (`:3001`) stands
  in for CloudFront. Vite serves the app on `:3000`, and PostgreSQL runs on the host.

Every request follows the same steps:
1. Check the JWT.
2. Load the user.
3. Check the role rules in `app/services/permissions.py`.
4. Make the change and write the notifications in **one transaction**.
5. Return the updated record plus the actions the user may take next. The UI shows
   buttons from that list, so the API and the UI never disagree.

## Getting started (local)

Prerequisites: run the workshop's `./bin/setup-environment.sh` once. It installs
Node, Python 3.13, PostgreSQL, Terraform and LocalStack.

```sh
# 1. Create the tables and load sample data (WARNING: both wipe existing rows)
psql -h localhost -U postgres -d postgres -f backend/db/schema.sql
psql -h localhost -U postgres -d postgres -f backend/db/seed.sql
#    Already have data? Apply only the additive migrations instead:
#    psql -h localhost -U postgres -d postgres -f backend/db/migrations/<file>.sql

# 2. Start everything: LocalStack + Lambda, proxy, React dev server
./bin/start-dev.sh

# 3. Open the app
open http://localhost:3000
```

Sample accounts (password `Password123!` for all):

| Role | Email |
|---|---|
| Facility Admin | `alice.admin@acme.inc` |
| Engineer | `ethan.eng@acme.inc`, `priya.eng@acme.inc`, `tom.eng@acme.inc`, `omar.eng@acme.inc` (on leave) |
| Employee | `emma@acme.inc`, `liam.lee@acme.inc`, `sofia.santos@acme.inc`, `noah.patel@acme.inc` |

**To redeploy backend changes to LocalStack**, run `./bin/start-dev.sh` again. If you
call `./bin/deploy-backend.sh` yourself:
- Pass `local`. Without it, the script deploys to **AWS**.
- Load `ENVIRONMENT.config` first, as `start-dev.sh` does.

**To run the API without LocalStack**, with interactive docs at `/docs`, see
[`backend/api-service/README.md`](backend/api-service/README.md).

## Project layout

```
backend/
  api-service/        FastAPI app (routes, schemas, models, permissions, notifications) + tests
  db/                 schema.sql, seed.sql, migrations/
frontend/
  src/pages/          Login, Dashboard, IncidentList, IncidentDetail, NewIncident, admin/
  src/components/     AppLayout, IncidentTable, IncidentForm, NotificationBell, Badges
  src/hooks/          useAction, useFieldErrors, useResponsive (breakpoints)
  src/services/       API client + one module per resource
  src/theme.js        Material UI theme
  e2e/                Playwright journeys
infra/                Terraform (S3, CloudFront, Lambda, Aurora, IAM)
bin/                  setup, start, deploy and test scripts
```

## API

REST + JSON under `/api/api-service`. The full endpoint table is in
[`backend/api-service/README.md`](backend/api-service/README.md).

- **Methods and status codes:** `POST` creates (201), `GET` reads (200),
  `PUT`/`PATCH` update (200; `PUT` is an alias of `PATCH`), `DELETE` removes (204).
  Workflow actions are `POST /incidents/{id}/status|assign|escalate|notes`.
- **Errors** always come back as `{"message": "..."}`. When the problem is about one
  field, the response also carries `errors: [{loc, msg}]` naming it: invalid input, and
  rule errors such as a duplicate email, a floor from another building or a full
  engineer.
  - The page shows each message directly **above** that field and moves the cursor to
    the first one.
  - An error that names no field (for example the server can't be reached) appears just
    above the button that was clicked. Nothing is shown in a banner at the top of the page.

  | Code | Meaning |
  |---|---|
  | 400 | Invalid input |
  | 401 | Not signed in or session expired |
  | 403 | Not allowed for your role |
  | 404 | Not found, or not yours to see |
  | 409 | Conflict, e.g. a duplicate, or an item still in use |
  | 503 | Database busy or down, with `Retry-After` |
  | 500 | Unexpected error, never with a stack trace |

## Testing

```sh
./bin/run-tests.sh          # backend + frontend with coverage
./bin/run-tests.sh --e2e    # plus Playwright journeys (needs ./bin/start-dev.sh running)
cd frontend && npm run lint
```

| Suite | Count | Coverage |
|---|---|---|
| Backend: pytest, unit + integration on a throwaway database | 295 | 99 % |
| Frontend: Vitest + React Testing Library | 126 | 99 % lines |
| End-to-end: Playwright on desktop Chrome and a Pixel 7 phone | 15 | every critical journey |
| Load: Artillery | 1 scenario | 0 / 510 users failed, p95 228 ms |

Details, known gaps and the load-test story (it found a real connection-pool bug)
are in [`TESTING.md`](TESTING.md).

## Deploying to AWS

The infrastructure is defined in `infra/` and deployed by the workshop scripts:

```sh
./bin/sync-db-sql.sh            # only if backend/db changed (a test fails if the copies drift)
./bin/deploy-backend.sh aws     # Terraform: Lambda, Aurora, CloudFront, S3 (renews AWS credentials)
./bin/deploy-frontend.sh aws    # build React with the CloudFront URL, upload to S3
```

**First deploy: create the database.** Aurora has no public address, so its tables
are created by the Lambda itself. Invoke it directly; this needs AWS credentials, and
web requests can't trigger it:

```sh
FN=$(cd infra && terraform output -json lambda_urls | jq -r 'keys[0]')
aws lambda invoke --function-name "$FN" --cli-binary-format raw-in-base64-out \
  --payload '{"action":"init_db","admin":{"name":"Your Name","email":"you@acme.inc","password":"a-strong-password"}}' out.json
cat out.json
```

| Payload | What it does |
|---|---|
| `{"action":"status"}` | Tables present? Counts of users, incidents and admins; is the signing key set? |
| `{"action":"init_db", "admin": {...}}` | **Empty database only.** Creates the tables, your admin account and a random JWT signing key. Add `"seed": true` for the sample data; every sample password is `Password123!`. |
| `{"action":"migrate"}` | Runs every migration in `backend/db/migrations/` (each is additive and safe to repeat). Run it after deploying a version that adds tables or columns. |

On AWS (`IS_LOCAL=false`) the API:
- connects to Aurora over TLS (`sslmode=require`);
- waits up to 45 s for a paused Aurora to wake;
- signs tokens with the random key that `init_db` stored in the `app_secrets` table.

Set `JWT_SECRET` in the Lambda environment to override that key.

Aurora Serverless v2 pauses after 5 idle minutes. While it wakes, the API retries
the connection for up to 25 seconds (`DB_WAKE_SECONDS`), so the first request after
a quiet spell is slow rather than failing. That limit stays under CloudFront's
30-second origin timeout.

**Status:** deployed on 19 Nov 2026 at **https://d3lb2j5ijpzy26.cloudfront.net**, with the sample data, so every
sample password is `Password123!`.

## Design decisions and trade-offs

- **One API service, not several.** It's one codebase and one deploy, and the domain
  is small enough. Routes are split by feature inside it.
- **JWT instead of server sessions.** Lambda instances share no memory. Tokens last
  8 hours and live in `sessionStorage`, so closing the tab signs you out, which suits
  shared office PCs.
  - When less than an hour is left, the app quietly swaps the token for a fresh one
    (`POST /auth/refresh`). An open tab therefore stays signed in, because the bell
    calls the API every 30 s.
  - A session still ends 24 hours after signing in, which limits how long a stolen
    token is useful.
  - Every renewal re-reads the user's role and whether the account is active.
- **An installable app (PWA), without a plugin.** A hand-written service worker
  (`public/sw.js`) caches the app's files, so the app opens instantly and loads offline.
  It never caches `/api/` responses, so incident data is always live and private.
- **Notifications are polled every 30 s, not pushed.** Lambda can't hold WebSockets
  open, and the polling query only counts rows.
- **History is written by a database trigger.** No code path can forget to log a
  change.
- **Deactivate rather than delete** buildings, floors, seats and engineers that are
  in use, so old incidents stay valid.
- **The connection pool depends on where the API runs:** 1+1 connections on Lambda,
  10+30 under uvicorn. This was found by the load test.
- **Native `<select>` styled by Material UI** so phones show their own pickers.
- **Dark mode uses Material UI's colour schemes as CSS variables.** Both palettes
  live in `src/theme.js`, and switching only changes a class on `<html>`, so nothing
  re-renders. A small script in `index.html` applies the saved choice before React
  loads, so the page doesn't flash white.
- **Engineer capacity is enforced on the server** with a row lock, so two admins
  can't both fill an engineer's last slot.
- **Merging a duplicate cancels it rather than adding a new status.**
  - The database already requires an engineer for any status other than
    Open or Cancelled, and a duplicate often has none.
  - The duplicate is stored as cancelled with a link (`merged_into_id`), and the UI
    labels it "Merged".
  - Followers live in their own table, so the original reporter keeps sole control
    of confirming the fix.
- **Reviews are filtered on the server, not hidden in the UI.**
  - `visible_reviews()` in `permissions.py` returns every review to admins, the
    caller's own review to an employee, and nothing to engineers.
  - The engineer's own profile response has the rating fields removed.
  - Each review stores the engineer at the time it's written, so a later
    reassignment doesn't move the rating to someone else.

## Assumptions

- Only `@acme.inc` staff use the app. Employees self-register; admins create
  Engineer accounts. Admin accounts are seeded, and there is no admin-creation
  screen yet.
- One incident has one engineer at a time. Reassignment is allowed.
- Critical priority is only set by admins. Employees ask for it by escalating.
- "Active tickets" means assigned, in progress or on hold. Resolved tickets don't
  count against capacity.
- A merge isn't undone automatically. If an admin merges by mistake, the follower
  can still comment on the main incident, and the admin can ask them to report
  it again.
- Employees see only their own review, not other reporters'. Reviews are feedback
  for admins, not a public score.
- Only closed incidents can be reviewed. A cancelled or merged report has no fix
  to rate; its reporter rates the main incident instead.

## Known gaps

- No password change or password reset.
- No push notifications: the bell polls every 30 s. Offline, the app opens but can't
  load data.
- Engineers can't change role from the People page; they're managed on the Engineers page.
