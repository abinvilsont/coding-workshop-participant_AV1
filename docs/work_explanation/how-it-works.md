# How ACME Facility Desk Works

> **View in your browser:** [How ACME Facility Desk Works](https://claude.ai/artifact/4zg4HwDhZH7Agf9TZVPy6h) (live doc) · [Architecture page](https://claude.ai/artifact/5K5Hw9Gkc1Lg2SGG9JziYM)
>
> This file is a copy exported on 19 Nov 2026.

## The big picture

Every click in the app turns into one API call that runs the same five steps. The React page sends the request. The API checks who you are and what you may do, then makes the change in PostgreSQL. In the same transaction it writes notifications for the other people involved, then sends the updated record back.

![One click is one API call, checked twice and saved in one transaction](images/request-path.png)

When you run it locally, the dev proxy on port 3001 does CloudFront's job and LocalStack runs the Lambda.

**The parts**

| Part | What it does | Where it runs (AWS / local) |
| --- | --- | --- |
| React app (Vite, Material UI, React Responsive) | Screens, forms, the notification bell. On phones the menu folds into a drawer and tables become cards | S3 behind CloudFront / Vite on :3000 |
| API (FastAPI) | Sign-in, role rules, the incident workflow, notifications | Lambda behind CloudFront at /api/api-service / LocalStack Lambda via the dev proxy |
| PostgreSQL | Users, buildings, incidents, notes, history, notifications | Aurora / local Postgres |

**Every request, in order**

1. The page calls the API with your sign-in token in the `Authorization` header.
2. The API strips the `/api/api-service` prefix that CloudFront adds.
3. It reads the token, loads your user, and stops with **401** if the token is missing, expired, or your account is disabled.
4. It checks the role rules in `permissions.py`. If the action isn't allowed, you get **403** and nothing changes.
5. It makes the change, adds notifications, and commits everything together. If one part fails, none of it is saved.
6. A database trigger writes a history row for every incident change, recording who made it.
7. The API returns the updated incident, including the list of actions you can take next. The page uses that list to decide which buttons to show.

## Signing up and signing in

Anyone with an `@acme.inc` email can register, and they always become an **Employee**. An admin has to create every Engineer account.

**Register** (`POST /auth/register`)

1. The form checks the email domain, a password of at least 8 characters, and that both passwords match.
2. The API runs the same checks again and lowercases the email. It ignores any `role` field the request sends.
3. It hashes the password with bcrypt before saving. The real password is never stored.
4. If the email already has an account, you get **409** with "An account with this email already exists."

**Sign in** (`POST /auth/login`)

1. The API finds your account and checks the password against its hash.
2. A wrong email and a wrong password both give the same message, "Invalid email or password.", so nobody can find out which emails are registered.
3. A disabled account gets **403**.
4. On success the API records the login time and returns a signed token (JWT) that lasts **8 hours**. The token carries your user id and role.
5. The browser keeps the token in `sessionStorage`, so closing the tab signs you out. The tab title changes to "\<your name> · ACME Facility Desk".
6. The page sends that token with every later request (see step 3 of the big picture).

**Staying signed in** (`POST /auth/refresh`)

1. Before each API call, the page checks how long the token has left. Under an hour, it first swaps the token for a fresh 8-hour one, without the user noticing. Concurrent calls share one renewal.
2. The API checks the token, reloads the user (so a changed role or a deactivated account takes effect), and issues the new token with the **same** sign-in time.
3. A session ends 24 hours after signing in, whatever happens: renewal is refused, and the next expired token sends the user to sign-in. That limits how long a stolen token is useful.
4. Because the bell calls the API every 30 seconds, an open tab stays signed in up to that limit.

### How secure is signing in?

The passwords, tokens and role checks are sound, and nothing is known to be exploitable. The open gaps are around the edges: a limit on login attempts first, then a stricter browser policy against script injection.

**What protects a sign-in**

| Protection | What it stops | Where |
| --- | --- | --- |
| bcrypt hash with a per-user salt (cost 10) | A leaked database revealing passwords | `app/core/security.py` |
| Unknown emails are checked against a dummy hash | Timing the response to learn which emails have accounts | `verify_password` |
| Token signed with a random 256-bit key, made at deploy time | Forging a token; the key is not in the code or the repo | `admin_tasks.py`, `app_secrets` table |
| Only HS256 accepted when checking a token | Tokens that claim another algorithm, or none | `decode_access_token` |
| User, role and active flag reloaded from the database on every request | A token outliving a role change or a deactivation | `app/api/deps.py` |
| 8-hour token, 24-hour cap from sign-in | A stolen token staying useful for long | `config.py` |
| HTTPS only (CloudFront redirects) | Reading the password or token on the network | `infra/cloudfront.tf` |

**Known gaps, most important first**

1. **No limit on login attempts.** Nothing slows down guessing passwords for one account, and the minimum is 8 characters. The Lambda URL is also public (`authorization_type = "NONE"`), so a rate limit placed only on CloudFront could be bypassed. Fix: a WAF rate rule on `/auth/login`, and let only CloudFront call the Lambda.
2. **The token can be read by page scripts.** It sits in `sessionStorage`, and there is no Content-Security-Policy. An injected script could copy it. React escapes output, which lowers the risk. Fix: a CSP header, or an httpOnly cookie. The upside today: bearer tokens are not open to cross-site request forgery.
3. **Signing out only clears the browser.** The server can't cancel a token, so a copied one works until it expires (up to 24 hours with renewals). Today the only cut-off is deactivating the account.
4. **Smaller items:** bcrypt cost 10 (12 is the usual advice now), no check against common or breached passwords, and no second sign-in factor.

## Reporting an incident

A new incident starts as **Open**, is unassigned, and gets a reference like `INC-000012`. Every Facility Admin is notified.

1. **The form loads.** The page calls `GET /auth/me` for your usual building, then `GET /facilities` to fill the Building, Floor and Seat lists. If a Facility Admin has set a usual building for you and it's still active, the form starts on it, with a note saying you can change it. Picking a building limits the floors to that building, and picking a floor limits the seats.
2. **You submit.** The form checks the required fields first: title, description, category, building. Then it sends `POST /incidents`.
3. **The API checks the request:**
   - Priority must be Low, Medium or High. Only admins can choose Critical; an employee gets **400** and is told to escalate instead.
   - The floor must belong to the building and the seat must be on that floor. None of them can be deactivated.
4. **The database saves it.** It creates the row with status `open` and builds the `INC-` reference from the id. A trigger logs a "created" history entry.
5. **Notifications are added** for every active admin, in the same transaction: "Alice reported INC-000012: Broken chair".
6. **The page opens the new incident** at `/incidents/12`.

## Already reported? Request escalation

Before a new report is saved, the app checks whether the same problem is already open. If it is, the employee can ask for that incident to be escalated instead of reporting it twice.

![A report that is already open becomes an escalation request, not a duplicate](images/already-reported.png)

**What the employee sees:** after clicking Submit, a **This may already be reported** box lists the open incidents at that place. Each has a **Request escalation** button with an optional "Why is it urgent?" box. They can also pick **It's a different problem, report it**, or go back to the form.

**What happens behind the scenes**

1. **The check** (`GET /incidents/similar`) looks for incidents in the same building and category that are still being worked on (open, assigned, in progress or on hold) and not merged. When both have a floor, it must match. It returns at most 5, with no reporter name or description, and marks any that are already the caller's own or followed.
2. **The request** (`POST /incidents/{id}/escalation-request`) runs in one transaction:
   - It refuses admins and engineers (403), the incident's own reporter (400, use Escalate instead), incidents no longer being worked on (400), and a second request from the same person (409).
   - It locks the incident, then adds the employee as a **follower** with the time they asked.
   - If the incident isn't escalated yet, it is now, with the reason "Liam Lee has the same problem and asked for it to be escalated". The history trigger records it under Liam's name.
   - It adds a note from Liam with his reason, so the engineer sees it.
   - It notifies the admins and the engineer ("has the same problem and asked to escalate") and the original reporter.
3. **The page opens the existing incident.** Liam sees "You're following this incident because you have the same problem and asked for it to be escalated". The details panel lists him under **Asked to escalate**.

The original reporter still owns the incident: only they confirm the fix, reopen or cancel it. A failed check never blocks reporting; the form simply saves as usual.

## The incident life cycle

An incident goes **Open → Assigned → In progress → Resolved → Closed**. The reporter confirms the last step. Each move is one API call, checked against your role, and it notifies everyone involved except you.

![Incident lifecycle: the engineer resolves, only the reporter closes](images/incident-lifecycle.png)

A reopened incident goes back to the engineer as In progress. Cancelled and Closed are final, so nothing changes after them.

| Step | Who | API call | What happens behind the scenes | Who is notified |
| --- | --- | --- | --- | --- |
| Escalate | Reporting employee | `POST /incidents/{id}/escalate` | Marks the incident escalated, stores the reason and time, and can record a requested higher priority. Allowed once, while the incident isn't resolved. | All admins, plus the engineer if assigned |
| Set priority / clear escalation | Admin | `PATCH /incidents/{id}` | Changes the priority or clears the escalation flag. The trigger logs a history entry. | Reporter and engineer (or the admins if no engineer yet) |
| Assign engineer | Admin | `POST /incidents/{id}/assign` | Rejects engineers who are inactive, on leave or offline (400), or already at their maximum active tickets (409). It locks the engineer's row while checking, so two admins can't fill the same last slot. Saves who assigned it and when. Open becomes **Assigned** automatically. | The engineer ("assigned to you"), the reporter ("is now working on"), and the previous engineer on a reassignment |
| Start work | Engineer | `POST /incidents/{id}/status` | Assigned becomes **In progress**. Any comment typed with the change is saved as a note. | Reporter |
| Put on hold / resume | Engineer | same | In progress and On hold swap. | Reporter |
| Resolve | Engineer | same | Sets `resolved_at`. | Reporter, asked to "confirm the fix or reopen it" |
| Confirm fix | Reporting employee | same | Resolved becomes **Closed** and `closed_at` is set. The incident is now read-only. | Engineer |
| Reopen | Reporting employee | same | Resolved goes back to **In progress** and the resolved time is cleared. | Engineer |
| Cancel | Reporting employee | same | Allowed while Open or Assigned. The page asks you to confirm first. | Engineer, or the admins if unassigned |
| Edit details | Employee while Open; admin any time before closing | `PATCH /incidents/{id}` | Re-checks the location and saves only the fields that changed. | Reporter and engineer, listing the changed fields |
| Delete | Admin | `DELETE /incidents/{id}` | Removes the incident with its notes and history. | Reporter and engineer (the alert has no link) |

Admins can make any status move, except that an incident with no engineer can only stay Open or be Cancelled. The database enforces that rule too. Any other move returns **403** with "You can't change this incident from X to Y."

## Two people acting at once

When an engineer and an employee act on the same incident at the same moment, nobody's change is silently overwritten. The second request waits for the first, then checks its rules again against what the first one saved.

![The second request waits for the first, then re-checks against what it saved](images/parallel-updates.png)

**What happens behind the scenes**

1. **Every change locks the incident first.** Status changes, edits, assignment, escalation, notes, reviews and deletion all load the incident with a row lock (`get_incident_or_404(..., for_update=True)`). A second request on the same incident waits until the first commits, usually a few milliseconds.
2. **The rules are re-checked after the wait.** The waiting request then sees what the first one saved. A cancel that arrives just after "Start work" is refused with **403** ("You can't change this incident from in\_progress to cancelled") instead of quietly winning.
3. **Edits carry the version they started from.** The edit form sends `expected_updated_at`. If someone saved the incident in between, the API answers **409** and nothing is saved. The page closes the form, shows the latest version and says "Your changes weren't saved: someone updated this incident while you were editing."
4. **A refused action refreshes the page.** After a 403 or 409, the incident is reloaded so the buttons match its real state, and the message stays visible even if the box it came from has gone.

| At the same moment | Result |
| --- | --- |
| Two notes | Both are saved |
| Edits to different fields (e.g. title and status) | Both are kept |
| Two status changes, or a status change and a cancel | The first wins; the second is re-checked and refused if no longer allowed |
| An edit saved after someone else's change | Refused with 409; the editor sees the new version |
| Two admins assigning an engineer's last slot | One succeeds, the other gets 409 "at full capacity" |

## Merging duplicate reports

When two employees report the same problem, an admin merges one report into the other. From then on there is one incident, one engineer and one fix, and both employees get every update.

![Two reports become one incident, and both reporters get its updates](images/merging-duplicates.png)

**What the admin does:** open the duplicate, choose an incident under **Merge duplicate**, and confirm. The list shows open incidents in the same building and category first. After the merge, the admin is taken to the main incident.

**What happens behind the scenes** (`POST /incidents/{id}/merge`, one transaction):

1. The API locks both incidents so two admins can't merge them at the same time. It refuses to merge an incident into itself, or to merge a closed, cancelled or already merged incident.
2. The duplicate's reporter becomes a **follower** of the main incident (a row in `incident_followers`). So does anyone already following the duplicate.
3. Duplicates that were merged into this one earlier are pointed at the main incident too, so chains collapse.
4. The duplicate is closed as cancelled and linked with `merged_into_id`. The app labels it **Merged** with a link to the main incident.
5. Two notes are added. The main incident gets the duplicate's title and description, so the engineer has the full picture. The duplicate gets "Merged into INC-…".
6. Notifications go to:
   - the duplicate's reporter, with a link to the main incident;
   - the main incident's reporter ("Liam reported the same problem");
   - its engineer, if one is assigned;
   - the duplicate's engineer, who no longer has the ticket on their list.

**What a follower can do**

|  | Original reporter | Follower |
| --- | --- | --- |
| See the incident in their list and dashboard | Yes | Yes |
| Get every update (assignment, status, public notes) | Yes | Yes |
| See internal notes | No | No |
| Add notes | Yes | Yes |
| Escalate, cancel, confirm the fix or reopen | Yes | No |

The follower sees a notice explaining why they can see the incident, and the main incident lists them under **Also reported by**.

## Rating the engineer

Once an incident is **Closed**, the employees who reported it can rate the engineer who fixed it: 1 to 5 stars and an optional comment. Admins use the ratings to see how engineers are doing. Engineers never see them.

![A review reaches the reviewer and admins, never the engineer](images/engineer-reviews.png)

**What the employee does:** after confirming the fix, a **Rate Tom Tech** box appears on the incident. They pick the stars, add a comment if they like, and submit. Later they can edit or delete their review.

**What happens behind the scenes** (`POST /incidents/{id}/review`):

1. The API checks that the caller is the reporter or a follower, that the incident is closed, and that an engineer worked on it. Admins and engineers get a 403.
2. It saves one row in `engineer_reviews` with the rating, the comment, the reviewer and the engineer at that moment. The database allows one review per person per incident; a second try gets a 409.
3. It returns the incident. The incident's reviews are filtered on the server by `visible_reviews()`: admins get every review, an employee gets their own, and an engineer gets an empty list.
4. No notification is sent, so nothing reaches the engineer that way either.

**Where admins see ratings:** on the incident (every review), and on the **Engineers** page, which shows each engineer's average and count. Clicking the average opens all their reviews, each linked to its incident (`GET /engineers/{id}/reviews`, admin only).

|  | Reviewer | Other reporters | Facility Admin | Engineer |
| --- | --- | --- | --- | --- |
| Write a review (closed incident) | Yes | Yes, their own | No | No |
| See this review | Yes | No | Yes | No |
| See the average rating | No | No | Yes | No |
| Edit or delete it | Yes | No | No | No |

### What an engineer's browser receives

The hiding happens on the server, so an engineer who opens the browser's network tab finds no reviews or ratings in any response. Each endpoint that could carry them returns this to an engineer:

| Endpoint | What an engineer gets |
| --- | --- |
| `GET /incidents/{id}` | `"reviews": []` |
| `GET /incidents` (list) | Nothing to hide: the list summary has no reviews field |
| `GET /engineers`, `GET /engineers/{id}`, `GET /engineers/{id}/reviews` | 403, admin only |
| `PATCH /engineers/me/availability` | Their own profile with `avg_rating` and `review_count` removed (`RATING_FIELDS`) |
| `GET /notifications` | No review notification is ever created |

An employee's response carries only the review they wrote; an admin's carries all of them. The test `test_engineer_never_sees_reviews` signs in as an engineer and checks every row above.

**Keep it that way:** the filter is applied by hand. A new endpoint that returns incidents or engineer stats must go through `visible_reviews()` or drop `RATING_FIELDS`, and should get a line in that test.

## Notes, notifications and the dashboard

Notifications are rows in the database, not pushed messages. The bell asks the API for new ones every 30 seconds.

**Adding a note** (`POST /incidents/{id}/notes`)

1. Anyone who can see the incident can add a note until it is Closed or Cancelled.
2. Engineers and admins can tick **Internal**. The API leaves internal notes out of the incident whenever an employee loads it, so employees never see them.
3. A public note notifies the reporter and the engineer. An internal note notifies only the admins and the engineer.

**The notification bell**

1. Each notification is written in the same transaction as the change it describes, so you never get an alert for a change that failed.
2. You are never notified about your own actions.
3. Every 30 seconds the bell calls `GET /notifications/unread-count`, which only counts rows, and updates the red badge.
4. Opening the bell loads your latest 20 (`GET /notifications`). Clicking one marks it read and opens the incident.
5. **Mark all read** (`POST /notifications/read-all`) clears the badge. You can only read or mark your own notifications.

**The dashboard** (`GET /dashboard`)

One call returns a different summary for each role:

| Role | What the dashboard shows |
| --- | --- |
| Employee | Counts of their own incidents by status, and their recent incidents |
| Engineer | Their assigned tickets, their availability and remaining capacity, and a switch to change availability (`PATCH /engineers/me/availability`) |
| Admin | Counts across all incidents, a "Needs attention" list, each engineer's workload, and building, floor and seat totals |

## Admin actions

Only a Facility Admin can manage buildings and engineers. Anyone else gets **403** "You don't have permission to do that.", and the admin menu and pages are hidden from them.

**Buildings, floors and seats** (`/buildings`, `/floors`, `/seats`)

1. **Create:** the hierarchy is building → floor → seat. A duplicate code or number in the same parent gets **409**.
2. **Edit or deactivate:** a deactivated location stays on old incidents but no longer appears in the new-incident form.
3. **Delete:** the database refuses if any incident or engineer still uses the location. The API turns that into **409** "… Deactivate it instead." so old incidents keep a valid location.

**Engineers** (`/engineers`)

1. **Create:** the API creates two linked rows in one transaction, a user with role Engineer and an engineer profile. The profile holds specialisations, availability, maximum active tickets and home building. The admin gives the engineer their first password.
2. **Edit:** change details, capacity or availability.
3. **Deactivate:** refused with **409** while the engineer still has active tickets ("Reassign them first"). You also can't deactivate yourself. A deactivated engineer can't sign in, and their existing token stops working on the next request.

**People** (`/users`)

1. **The list** shows every account with its role, department, usual building and last sign-in. You can search by name or email, filter by role, and show inactive accounts.
2. **Usual building:** pick one from the row and it saves straight away (`PATCH /users/{id}` with `home_building_id`; `null` clears it). It must be an active building. Admins can set their own. When that person opens **Report incident**, the page asks the API for their account (`GET /auth/me`) and the form starts on that building, with a note saying so. Asking fresh means a change applies without signing in again. A building that's been deactivated is ignored; deleting a building clears it for everyone (`ON DELETE SET NULL`). The column comes from migration 006.
3. **Make admin / Make employee** changes an employee into a Facility Admin or back. It takes effect on that person's next request, because every request reads the role from the database, and they get a notification.
4. **Deactivate** signs the person out on their next request and blocks sign-in. **Reactivate** lets them back in.
5. **Safeguards:** you can't change your own role or deactivate yourself; engineers are managed on the Engineers page (their tickets and capacity rules live there); and there is always at least one active Facility Admin. If two admins demote each other at the same moment, the API locks the admin rows and refuses the second change with **409**.

## Install it as an app

The app is a **progressive web app (PWA)**. Chrome, Edge and phones offer to install it, and it then opens in its own window with the ACME icon.

- `manifest.webmanifest` gives the name, colours and icons.
- `sw.js`, a service worker, caches the app's files, so it opens instantly and still loads offline (it then says it can't reach the server).
- The service worker **never caches `/api/` responses**: incident data is always live, and nothing private is stored on the device.
- Pages are fetched from the network first, so a new deploy shows up on the next visit.

## Running on AWS

The same code runs on AWS: the React app on S3 behind CloudFront, and the API on Lambda, connected to Aurora PostgreSQL. The workshop scripts deploy it: `deploy-backend.sh aws`, then `deploy-frontend.sh aws`.

**Setting up the database.** Aurora has no public address, so the tables are created by the Lambda itself. Someone with AWS credentials invokes it directly with a task; web requests can never trigger these.

| Task | What it does |
| --- | --- |
| `status` | Are there tables? How many users, incidents and admins? Is the signing key set? |
| `init_db` | Empty database only: creates the tables, an admin (or the sample data) and a random 256-bit token-signing key |
| `migrate` | Runs every migration (each safe to repeat). Use it after deploying a version that adds tables or columns |

**What changes on AWS** (`IS_LOCAL=false`):

- the database connection requires TLS (`sslmode=require`);
- tokens are signed with the random key `init_db` stored in the database, not one derived from settings;
- Aurora pauses after 5 idle minutes, so the API retries the connection for up to 25 seconds while it wakes: the first visit after a quiet spell takes a few seconds instead of failing. That limit stays under CloudFront's 30-second timeout.

## When things go wrong

Every error comes back as `{"message": "..."}` in plain English, and the page shows that message as it is. A failed request changes nothing, because the whole transaction is rolled back.

| Code | When it happens | What you see |
| --- | --- | --- |
| 400 | A rule or field check failed, such as a wrong location, a missing field or an invalid email | The reason in red directly above the field it's about, for example "That floor is not in the selected building." above Floor, and the cursor moves to the first one. Nothing appears at the top of the page. |
| 401 | No token, an expired token (after 8 hours), or a deactivated account | You are signed out and sent back to the login page. A wrong password does not sign you out; it just shows the error. |
| 403 | Your role isn't allowed to do this | "You can't change this incident from X to Y." or "You don't have permission to do that." |
| 404 | The incident doesn't exist **or** you aren't allowed to see it | "Incident not found." The same answer for both, so nobody can guess other people's incidents. |
| 409 | A duplicate, or something still in use | "An account with this email already exists." or "… Deactivate it instead." |
| 503 | The database pool is full (waited 10 s) or the database is down | "The service is busy right now…" with a `Retry-After` header |
| 500 | An unexpected bug | "Something went wrong. Please try again." The details go to the server log, never to the browser. |
| none | The browser can't reach the API at all | "Cannot reach the server. Is the backend running?" |

## Why it's built this way

Most choices follow from two facts. The workshop deploys to Lambda, which keeps no memory between requests and can't hold connections open. And an incident tool has to be trustworthy: the right people see the right things, and nothing is lost.

**Architecture**

| Decision | Why |
| --- | --- |
| React on S3 + CloudFront, one API on Lambda | This is the infrastructure the workshop provides. You pay only when it is used, and Lambda handles more traffic by starting more instances. |
| One API service instead of several | One codebase, one deploy and one database connection setup. The app is small enough that splitting it would add work without benefit. |
| FastAPI with Pydantic | Request checks are declared once on the data models. Bad input is rejected before our code runs, and the API documents itself at `/docs`. |
| PostgreSQL | The data is relational: incidents link to users, buildings, floors and seats. Constraints and triggers enforce the rules even if the API has a bug. |
| Middleware strips `/api/api-service` | The same code runs behind CloudFront, which adds the prefix, and behind the local proxy, which doesn't. |
| Layout switches by what fits, not by device: menu drawer below 960 px (1200 px for admins' six links), incident lists as cards below 960 px, the Engineers table as cards below 1100 px | An audit at 320, 375, 414, 600, 768, 1024, 1280 and 1920 px found the admin top bar spilling off a 1024 px screen and tables squeezed on tablets, so each breakpoint is where that part stops fitting. A browser test checks every page at four sizes and fails if a page or a table scrolls sideways. |

**Security**

| Decision | Why |
| --- | --- |
| JWT token instead of server sessions | Lambda instances share no memory, so a session stored on one would be unknown to the next. A signed token is checked anywhere without a lookup. |
| 8-hour token kept in `sessionStorage` | It lasts a working day. Closing the tab signs you out, which matters on shared office PCs. |
| bcrypt password hashes | They are slow to compute on purpose, so a leaked database can't be cracked quickly. |
| Role rules checked on the server, and `role` ignored on register | The browser can be tampered with. Nobody can make themselves an admin or reach a hidden button by editing the page. |
| Same message for a wrong email or password; 404 for incidents you can't see | Attackers can't learn which accounts or incident numbers exist. |
| Only `@acme.inc` emails | Only company staff can register. The check runs in the form, the API and the database. |
| Quiet token renewal, capped at 24 hours per sign-in | Nobody is thrown out mid-task after 8 hours, yet a stolen token stops working within a day. Each renewal re-reads the role and active flag, so admin changes apply quickly. |
| People page safeguards: not yourself, not engineers, never zero admins | An admin can't lock everyone out by accident or in a race. Engineers stay on the Engineers page, where their open tickets block deactivation. |
| Database set-up as a Lambda task, plus a random signing key stored in the database | Aurora isn't reachable from outside AWS, and the key the app would otherwise derive on AWS comes from a guessable database password. Direct invocation needs AWS credentials, so the public site can't trigger it. |

**Workflow**

| Decision | Why |
| --- | --- |
| All role rules in one file, `permissions.py` | The API enforces them and the page shows buttons from the same list, so the UI never offers an action the API will reject. |
| The reporter confirms the fix before it closes | The person who had the problem decides whether it is solved, not the engineer. |
| Only admins set Critical; employees escalate | Otherwise everyone would choose Critical. Escalation lets an admin triage and approve. |
| Assignment blocks engineers on leave, offline or at full capacity | Tickets don't sit with someone who isn't working or is already overloaded. The limit is checked on the server against the \`engineer\_workload\` view, and full engineers are greyed out in the picker. |
| Internal notes | Engineers and admins can discuss costs or vendors without confusing the employee. |
| Deactivate instead of delete for locations and engineers | Old incidents keep a valid location and engineer. An engineer with open tickets must hand them over first, so no ticket is orphaned. |
| History written by a database trigger | No code path can forget to log a change. The API tells the trigger who is acting, so every entry names a person. |
| Readable `INC-000012` references | People can quote them over the phone or in email. The database generates them, so there are never duplicates. |
| Duplicates are merged: the copy is cancelled and its reporter follows the main incident | One problem gets one engineer and one fix, and nobody is left without updates. Only the original reporter confirms the fix, so that decision stays with one person. Cancelled (not a new status) is used because the database requires an engineer for every other status. |
| Reviews filtered on the server, never shown to engineers | Hiding them only in the UI would still send them to the engineer's browser. Filtering in one function (visible\_reviews) keeps employees' feedback honest. Each review stores the engineer at the time, so a later reassignment can't move a rating to someone else. |
| Light and dark mode with a sun/moon button, following the device until you pick | Both colour sets live in one theme file as CSS variables, so switching only flips a class on the page and nothing reloads. The choice is saved in the browser, and a tiny script applies it before the app starts, so the screen never flashes white. No server change was needed. |
| Errors shown above the field they're about, never in a banner at the top | People look at the field they just filled, not the top of the page, which may be scrolled away. The API names the field in the same errors list it uses for invalid input, so rule errors (a duplicate email, a full engineer) land in the right place too. Errors that name no field sit just above the button that was clicked. |
| Already-reported check before saving, with Request escalation instead of a duplicate | Stops duplicates at the source, so admins merge less, and the extra person still counts: the incident is escalated and they follow it. The match (same building, category and floor) is simple and predictable; the employee decides, and can always report anyway. The list shows no reporter or description, because employees otherwise only see their own incidents. One request per person stops repeated alerts. |

**Reliability**

| Decision | Why |
| --- | --- |
| Notifications saved in the same transaction as the change | An alert can't exist for a change that failed, and a change can't save without its alerts. |
| Bell polls every 30 s instead of a live push | Lambda can't keep a WebSocket open. A cheap count query every 30 s is close enough to live for incident updates. |
| Pool of 1+1 connections on Lambda, 10+30 on a server | Each Lambda instance serves one request at a time, so a big pool would waste Aurora's connection limit. The load test showed that 4 connections starved the server, failing 434 of 510 users; with the new sizes none failed. |
| 503 with `Retry-After` after 10 s | Users get a clear "busy" message instead of a page that hangs for 30 s. |
| Every error is `{"message": "..."}` | The page shows any error as it is, with no special cases, and stack traces never reach the browser. |
| Retry the database connection for up to 25 s on AWS | Aurora Serverless pauses when idle to save cost; without the retry, the first visit after a quiet spell failed. Tested on the live site: 200 in 6.6 s after 7 idle minutes. |
| Hand-written service worker that never caches the API | About 60 lines with no plugin to learn or update. App files are cached for speed and offline start; data always comes live, so nobody sees stale incidents or leaves private data on a shared device. |
| Lock the incident row on every change, plus a version check on edits | Without it, two requests could both pass their rule check on the same old status and the last save would win, which let a reporter cancel work already started. The lock makes concurrent changes run one at a time and costs a few milliseconds per incident; it never blocks other incidents. The version check stops an edit from overwriting a change made while the form was open. |
