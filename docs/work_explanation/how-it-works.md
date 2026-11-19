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

## Reporting an incident

A new incident starts as **Open**, is unassigned, and gets a reference like `INC-000012`. Every Facility Admin is notified.

1. **The form loads.** The page calls `GET /facilities` and fills the Building, Floor and Seat lists. Picking a building limits the floors to that building, and picking a floor limits the seats.
2. **You submit.** The form checks the required fields first: title, description, category, building. Then it sends `POST /incidents`.
3. **The API checks the request:**
   - Priority must be Low, Medium or High. Only admins can choose Critical; an employee gets **400** and is told to escalate instead.
   - The floor must belong to the building and the seat must be on that floor. None of them can be deactivated.
4. **The database saves it.** It creates the row with status `open` and builds the `INC-` reference from the id. A trigger logs a "created" history entry.
5. **Notifications are added** for every active admin, in the same transaction: "Alice reported INC-000012: Broken chair".
6. **The page opens the new incident** at `/incidents/12`.

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

## When things go wrong

Every error comes back as `{"message": "..."}` in plain English, and the page shows that message as it is. A failed request changes nothing, because the whole transaction is rolled back.

| Code | When it happens | What you see |
| --- | --- | --- |
| 400 | A rule or field check failed, such as a wrong location, a missing field or an invalid email | "Please fix the highlighted fields." with the reason under each field, or one reason at the top, for example "That floor is not in the selected building." |
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

**Security**

| Decision | Why |
| --- | --- |
| JWT token instead of server sessions | Lambda instances share no memory, so a session stored on one would be unknown to the next. A signed token is checked anywhere without a lookup. |
| 8-hour token kept in `sessionStorage` | It lasts a working day. Closing the tab signs you out, which matters on shared office PCs. |
| bcrypt password hashes | They are slow to compute on purpose, so a leaked database can't be cracked quickly. |
| Role rules checked on the server, and `role` ignored on register | The browser can be tampered with. Nobody can make themselves an admin or reach a hidden button by editing the page. |
| Same message for a wrong email or password; 404 for incidents you can't see | Attackers can't learn which accounts or incident numbers exist. |
| Only `@acme.inc` emails | Only company staff can register. The check runs in the form, the API and the database. |

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

**Reliability**

| Decision | Why |
| --- | --- |
| Notifications saved in the same transaction as the change | An alert can't exist for a change that failed, and a change can't save without its alerts. |
| Bell polls every 30 s instead of a live push | Lambda can't keep a WebSocket open. A cheap count query every 30 s is close enough to live for incident updates. |
| Pool of 1+1 connections on Lambda, 10+30 on a server | Each Lambda instance serves one request at a time, so a big pool would waste Aurora's connection limit. The load test showed that 4 connections starved the server, failing 434 of 510 users; with the new sizes none failed. |
| 503 with `Retry-After` after 10 s | Users get a clear "busy" message instead of a page that hangs for 30 s. |
| Every error is `{"message": "..."}` | The page shows any error as it is, with no special cases, and stack traces never reach the browser. |
