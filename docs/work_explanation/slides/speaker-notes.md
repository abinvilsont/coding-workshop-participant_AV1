# ACME Facility Desk: speaker notes

One section per slide, in order. The slides are in [slides.pdf](slides.pdf) and [slides.html](slides.html). The same notes are in the live deck's presenter view.

Each slide has what to **say**, what to **point at** or the key point to land, a likely question with a short answer, and the line that leads into the next slide.

## 1. ACME Facility Desk

**Say:** Hi, I'm going to show you ACME Facility Desk. It's a self-service help desk for problems round the office: a broken chair, a leaking tap, a light that's packed in. Staff report the problem, a Facility Admin hands it to an engineer, the engineer fixes it, and the person who reported it confirms it's actually fixed. I built it during the workshop on the required stack, and it's live on AWS right now.

**Point at:** The four tags along the bottom: React with Material UI, FastAPI on Lambda, PostgreSQL, CloudFront. And the QR code: anyone can scan it and follow along on their phone.

**Plan:** About 10 minutes of slides, then a live demo, then questions. Sign-ins for the demo are emma@acme.inc (employee), alice.admin@acme.inc (admin) and tom.eng@acme.inc (engineer), all with Password123!. Open the live site a minute before you start so the Lambda and the database are warm.

**Next:** "First, what we were asked to build."

## 2. Let staff report office problems themselves, and see them through to the fix

**Say:** The brief had three parts. One, self-service: anyone with an @acme.inc email signs up and reports a problem in under a minute, without phoning anyone. Two, clear responsibilities: employees, engineers and admins each get only the screens and actions for their job. Three, open communication: every problem has notes, a full history of who changed what, and notifications, so nobody has to chase anyone for an update.

**Point at:** The line at the bottom: it's stand-alone on purpose. No email, chat or HR integrations; that was part of the brief, and it kept the scope honest.

**If asked:** "Why only @acme.inc?" Self sign-up is limited to the company domain, so only staff can report. Engineers and admins can't sign themselves up; an admin creates them.

**Next:** "So who are these three roles?"

## 3. Three roles, three different views

**Say:** Employees sign up themselves. They report problems, follow them, add notes, confirm the fix and rate the engineer. Engineers are created by an admin. They see only their own jobs: start work, put it on hold, mark it resolved, add notes, and set their availability. Facility Admins run the desk. They see everything, set priorities, assign engineers, merge duplicates, and manage buildings, engineers and people.

**Key point:** The UI hides the buttons you can't use, but that's only for tidiness. The server checks the role on every single request. Even if someone crafted the call by hand, an engineer can't assign tickets and an employee can't see someone else's problem; they get a 403 or a 404.

**If asked:** "Can one person have two roles?" An admin can make an employee an admin and back again. The app always keeps at least one admin, so you can't lock everybody out.

**Next:** "Here's how a problem moves between them."

## 4. A problem is closed only when the person who reported it agrees

**Say:** Each box is a status, and the line under it says who moves it there. The employee reports it: Open. An admin picks an engineer: Assigned. The engineer starts: In progress. The engineer fixes it: Resolved. And it's only Closed when the person who reported it agrees. If it isn't fixed, they reopen it and it goes back to In progress with the same engineer.

**Key point:** Engineers don't get to close their own tickets. That's the design choice behind the slide title: the person who had the problem decides when it's gone.

**Also:** Reporters can cancel while it's still Open or Assigned. Engineers can put work on hold. Every step notifies the people involved. When assigning, the server checks the engineer's capacity (5 active jobs by default), so an admin can't overload someone. If an admin moves a ticket back to Open, the engineer comes off it, so it shows as unassigned again.

**If asked:** "Where are these rules?" One function, allowed_transitions in permissions.py. The API uses it to refuse a move, and the UI uses the same answer to decide which buttons to show.

**Next:** "Let's see that from the employee's side."

## 5. Report a problem, then follow it

**Say:** On the left is the report form. Title, description, category, priority, and where it is: building, floor, seat. The building is already filled in with the employee's usual building, which an admin sets. If they pick a different one, the app gives a wee reminder that it isn't their usual one. On the right is the incident page Emma sees: the status, the notes thread between her and the engineer, the details, and the actions she's allowed.

**Point at:** The Escalate button. An employee can't choose Critical when reporting. If it's urgent, they escalate with a reason and can ask for a higher priority. That flags it for the admins, but only an admin actually changes the priority, so priority keeps its meaning.

**If asked:** "What stops duplicates?" Before it saves, the app shows open problems at the same spot. That's on the features slide in a minute.

**Next:** "Now the admin's view."

## 6. See everything that needs attention

**Say:** The admin dashboard puts the problems that need action first: unassigned tickets, escalated ones, priority requests, and resolved tickets waiting for the reporter to confirm. Below that, each engineer's workload, so you can see who has room. On the right, the Engineers page: their skills, availability, how full they are, their star rating and their home building.

**Key point:** Ratings appear only here, on the admin's Engineers page. Engineers never see their own rating, anywhere. That's enforced on the server, in one function that decides which reviews go into a response, not just hidden in the UI.

**Numbers:** The sample data has 10 employees, 5 engineers and 2 admins, across 5 buildings with 21 floors and 115 seats.

**If asked:** "How do you choose an engineer?" The assign dropdown shows each engineer's availability and load, puts a star next to the ones who specialise in that category, and greys out anyone who's full.

**Next:** "And the engineer's view is deliberately small."

## 7. Just my jobs, highest priority first

**Say:** The engineer sees just their own jobs, highest priority first, with counts for new, in progress and on hold. At the top there's a one-click availability switch: available, busy, on leave or offline. And a capacity bar showing how many more jobs they can take.

**Key point:** "Only their own tickets" is a server rule, not a filter in the UI. If a ticket's reassigned to someone else while the old engineer still has it open, and they click a button, the server refuses with "not found" and the page tells them it may have been reassigned. I found that one while rehearsing; on AWS it used to show a blank page, and it's fixed now.

**If asked:** "What if two admins assign the same engineer's last slot at once?" The engineer's profile row is locked during assignment, so the second admin waits, then sees the engineer is full and is refused.

**Next:** "All of this works on a phone as well."

## 8. The same app on a desktop and a phone

**Say:** Same app, same data. On a desktop you get tables with every detail. On a phone the tables turn into cards, the menu moves into a drawer, and forms stack. It's built with Material UI and React Responsive, and it's tested at phone, small phone, tablet and tablet landscape sizes in the browser tests.

**Point at:** It installs as an app on Chrome, Edge and phones, so it opens in its own window like any other app. Scan the QR code if you want to try it on your phone now.

**If asked:** "Dark mode?" Yes: it follows your system setting, or you can switch it. It remembers your choice, and it stays in step across tabs.

**Next:** "A few smaller features that cut noise for everyone."

## 9. Small touches that cut noise for everyone

**Say:** Six touches. Already reported?: before saving, the app shows open problems at the same place, so you join one instead of filing a duplicate. Merge duplicates: an admin folds a duplicate into the main ticket, and both reporters follow one problem from then on. Engineer ratings: one to five stars after a fix; admins see averages, engineers never do. Notifications: a bell with a badge for every change on your problems, never for things you did yourself. Usual building: the form starts on your building. Installable app.

**Demo:** Pick one or two to show live. The already-reported prompt and the merge flow show best how the app keeps one problem as one ticket.

**If asked:** "Who gets updates after a merge?" Both reporters get every update on the main problem. Only the original reporter can confirm it's fixed.

**Next:** "So how is it built?"

## 10. One click is one API call, checked twice and saved in one transaction

**Say:** Left to right. The React app in the browser. CloudFront in front: web files come from S3, and anything under /api goes to the Lambda. One FastAPI app on Lambda. And PostgreSQL, which is Aurora on AWS. Every request does the same three things: check the sign-in token (401 if not), check the role rules (403 if not), then save the change and its notifications in one transaction, so it's all or nothing.

**Key points:** It's a modular monolith: one Lambda, split inside into routes, services and a single permissions module. We considered microservices and decided against them; it's one team and one database, and splitting would add network hops and deployments for no benefit at this size. The history of every incident is written by a database trigger, so no code path can forget to log a change. 51 endpoints, 12 tables, 7 additive migrations. Terraform and shell scripts deploy the same code to LocalStack on a laptop or to AWS.

**If asked:** "What happens if two people click at once?" Every change locks the incident row first, so they run one after the other, and the second one re-checks the rules against what the first saved. Edits also carry the version they started from, so a stale edit is refused instead of overwriting.

**Next:** "How do we know it works?"

## 11. 524 automated tests, from single functions to a real browser

**Say:** Three layers. 336 backend tests with pytest, run against a real throwaway PostgreSQL, at 99% coverage. 161 frontend tests with Vitest and React Testing Library, phone layouts included, at 96% of lines. And 27 end-to-end journeys in a real Chrome with Playwright, covering every role and the full life cycle of an incident.

**Key points:** All suites pass. The integration tests build a fresh database from schema.sql and reload the seed data before every test, so they never touch real data. Coverage runs fail below 80%. Race conditions are tested properly: one change holds the row lock while a second request runs in another thread, so the race happens every time, not by luck. An Artillery load test found database connection-pool exhaustion early, and we fixed it.

**If asked:** "What did rehearsing find?" Two real bugs: an engineer left attached when a ticket went back to Open, and a blank page when an old engineer acted on a reassigned ticket. Both are fixed, and both now have tests.

**Next:** "Last technical slide: keeping accounts safe."

## 12. The server decides what you may do, on every click

**Say:** Four things. Passwords are hashed with bcrypt, so the database never holds the real password. Sign-in tokens expire: 8 hours, renewed quietly while you work, and after 24 hours you sign in again. Closing the tab signs you out. Roles are checked on the server on every request, so if an admin turns an account off or changes it, that takes effect on the next click. And a wrong email and a wrong password get the same message, so nobody can probe who has an account.

**Also:** The signing key for tokens is generated at setup and stored in the database, not in the code or the repo. Incidents you aren't allowed to see return 404, the same as ones that don't exist, so nobody can guess other people's ticket numbers. All SQL goes through bound parameters, so there's no SQL injection, and React escapes everything it shows.

**Known gap:** Mention if asked: there's no limit yet on repeated login attempts, or on how many reports one person can file. That's first on the next slide.

**Next:** "Which brings me to what's next."

## 13. Three things on the list

**Say:** Three things I'd do next. One, limit repeated sign-in attempts, with an AWS WAF rate rule on CloudFront plus a per-account limit in the API. Two, self-service password reset, which needs an email service, deliberately left out of this brief. Three, push notifications to phones, since the app already installs as one.

**Then:** Switch to the live demo. Suggested path: sign in as Emma and report a problem; show the already-reported prompt. Switch to Alice: the problem is at the top of the dashboard, assign it to Tom with the capacity shown. Switch to Tom: start work, add a note, mark it resolved. Back to Emma: she has a notification, confirms it's fixed, and rates Tom. Finish on Alice's Engineers page to show the rating that Tom can't see.

**Tips:** Use separate browser windows for each person, not tabs in one window, so the sign-ins stay separate and easy to follow. If something is slow on the first click, it's the Lambda waking up; say so and carry on.

**Close:** "That's ACME Facility Desk. Happy to take questions, or to show any part of the code."
