# ACME Facility Desk: speaker notes

One section per slide, in order. The slides are in [slides.pdf](slides.pdf) and [slides.html](slides.html).

## 1. ACME Facility Desk

Introduce the project: a self-service help desk for facility problems at ACME, things like a broken chair, a leaking tap or a dead light. Built during the workshop on the required stack and deployed to AWS.

## 2. Let staff report office problems themselves, and see them through to the fix

The workshop brief asked for self-service incident reporting, role-based responsibilities and transparent communication through notes, with no external integrations.

## 3. Three roles, three different views

Every role check happens on the server, on every request. The UI hides buttons you can’t use, but the API is what enforces it.

## 4. A problem is closed only when the person who reported it agrees

Each box is a status; the line under it says who moves the problem there. Engineer capacity is enforced when assigning, so an admin can’t overload someone.

## 5. Report a problem, then follow it

Left: the report form. The building is pre-filled from the employee’s usual building. Right: the incident page Emma sees, with the notes thread between her and the engineer and the option to escalate.

## 6. See everything that needs attention

The admin dashboard surfaces unassigned and escalated problems first. The Engineers page is the only place ratings appear; engineers themselves never see them.

## 7. Just my jobs, highest priority first

The engineer view is deliberately narrow: their assigned tickets, their availability and their capacity. Admins can’t assign past an engineer’s capacity.

## 8. The same app on a desktop and a phone

Built with Material UI and React Responsive. On phones, tables become cards and the menu moves into a drawer. It can also be installed as an app.

## 9. Small touches that cut noise for everyone

Pick one or two of these to demo live. The already-reported prompt and the merge flow show best how the app keeps one problem as one ticket.

## 10. One click is one API call, checked twice and saved in one transaction

Requests go through CloudFront: static files come from S3, API calls go to a single FastAPI Lambda. Every request checks the token (401) and the role rules (403), then saves the change and its notifications in one transaction. We considered splitting into microservices and decided against it.

## 11. 524 automated tests, from single functions to a real browser

All suites pass. The integration tests build a fresh database from schema.sql and reload the seed data before every test, so they never touch real data. The load test found pool exhaustion early, which we fixed.

## 12. The server decides what you may do, on every click

Known gap, mention if asked: there is no limit yet on repeated login attempts. The JWT signing key is generated at setup and stored in the database, not in code.

## 13. Three things on the list

Wrap up and switch to the live demo. Suggested path: sign in as an employee and report a problem, show the already-reported prompt, then switch to admin to assign it and to engineer to resolve it.
