# How ACME Facility Desk Is Tested

The app is tested at four levels, from fast checks of single functions up to a real browser clicking through the running app. Full details, latest results and known gaps are in [TESTING.md](../../TESTING.md).

## The four kinds of tests

| Kind | Tool | Where | What it checks | Needs |
| --- | --- | --- | --- | --- |
| Backend unit | pytest | `backend/api-service/tests/unit/` | Single pieces of logic with no database: role rules (`permissions.py`), password hashing and sign-in tokens (`security.py`), and request validation (`schemas`). | Nothing |
| Backend integration | pytest + FastAPI TestClient | `backend/api-service/tests/integration/` | Real API calls against a real PostgreSQL database: sign-in, incidents, the workflow, admin screens, notifications, dashboard, reviews, merging, and the API's error format. | Local PostgreSQL |
| Frontend | Vitest + React Testing Library (jsdom) | `frontend/src/**/*.test.{js,jsx}` | Pages, components, services and helpers, rendered in a simulated browser. `fetch` is answered by a small fake backend (`src/test/mockApi.js`), so these run offline. Phone layouts are tested at a 390 px width. | Nothing |
| End-to-end | Playwright (system Chrome) | `frontend/e2e/` | Whole user journeys in a real browser against the running app: access per role, admin setup, the incident life cycle, merging, reviews, and responsive layouts. | `./bin/start-dev.sh` running |

There is also a **load test** with Artillery (`backend/api-service/tests/load/api-load.yml`). Simulated users from `users.csv` sign in and use the API at the same time. It's how the database connection-pool sizes were chosen (see "Why it's built this way" in [how-it-works.md](how-it-works.md)).

## How the integration tests keep data clean

1. The run creates a throwaway `facility_desk_test` database from `backend/db/schema.sql`.
2. `seed.sql` is reloaded before every test, so each test starts from the same 17 users (2 admins, 5 engineers, 10 employees), 5 buildings (21 floors, 115 seats) and 7 incidents.
3. The database is dropped at the end. Your normal `postgres` database is never touched.

## Running them

```sh
./bin/run-tests.sh          # backend + frontend, with coverage (about 1 min)
./bin/run-tests.sh --e2e    # ...plus the browser end-to-end tests (app must be running)
```

## Latest results (19 Nov 2026, local)

| Suite | Tests | Result | Coverage |
| --- | --- | --- | --- |
| Backend (pytest) | 336 | all pass, ~26 s | 99 % of `app/` |
| Frontend (Vitest 4) | 159 | all pass, ~20 s | 96 % lines, 88 % branches, 93 % functions |
| End-to-end (Playwright) | 27 | all pass, ~3.5 min | every critical user path |

Both coverage runs fail if coverage drops below 80 %.

## Security checks on GitHub

Every push and pull request also runs three security scans. **Bandit** checks the Python code (the tests folder is left out, because tests use `assert` and fake passwords on purpose). **npm audit** checks the frontend packages for known vulnerabilities. **Checkov** reviews the Terraform and only reports. Bandit and npm audit both pass; see `TESTING.md` for how to run them locally.
