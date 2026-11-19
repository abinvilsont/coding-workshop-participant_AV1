# ACME Facility Desk: A Simple Guide

> **View in your browser:** [ACME Facility Desk: A Simple Guide](https://claude.ai/artifact/2WkYhtV276bDhJCe8zQMBt) (live doc)
>
> This file is a copy exported on 19 Nov 2026. For the technical details, see [how-it-works.md](how-it-works.md).

## What it is

ACME Facility Desk is where ACME staff report wee problems round the office: a broken chair, a leaking tap, a light that's packed in. A Facility Admin hands each one to an engineer, the engineer sorts it, and the person who reported it says whether it's fixed.

You can see where your problem's at any time, and the app lets the right people know whenever something changes. It works in a browser, on your phone, and as an app you can install.

## Who uses it

There are three kinds of user, and each one only sees the screens and buttons for their own job. No clutter.

| Role | Who they are | What they do |
| --- | --- | --- |
| **Employee** | Any ACME staff member with an @acme.inc email. They sign up themselves. | Report problems, follow their progress, add notes, confirm the fix, and rate the engineer |
| **Engineer** | Maintenance staff. An admin creates their account. | See the jobs given to them, start and finish work, add notes, and say when they're available |
| **Facility Admin** | The people who run the help desk | See every problem, set priorities, assign engineers, merge duplicates, and manage buildings, engineers and people |

## What you can do

| Feature | In plain words |
| --- | --- |
| **Report a problem** | Pick the building, floor and seat, say what's wrong, and send it. If an admin's set your usual building, it's already filled in for you. You can still pick another; the app just gives you a wee reminder it isn't your usual one. Your report gets a number like INC-000012. |
| **"Already reported?" check** | Before it saves, the app shows any open problems at the same spot. If yours is there already, you can join it instead of reporting it twice. |
| **Track progress** | Every problem shows where it's at, who's fixing it, and everything that's happened to it. |
| **Notes** | Anybody involved can add a note. Engineers and admins can also write internal notes that employees don't see. |
| **Notifications** | A bell with a red badge tells you when something changes on your problems. You're never told about things you did yourself. |
| **Dashboard** | A home page that suits your role: your own problems, your jobs, or the whole picture if you're an admin. |
| **Escalate** | Mark a problem as urgent and say why, so the admins look at it first. |
| **Rate the engineer** | Once it's fixed, give the engineer 1 to 5 stars. Only admins see the ratings; engineers never do. |
| **Admin tools** | Manage buildings, floors and seats, engineer accounts, who's an admin, and each person's usual building. |
| **Install as an app** | Chrome, Edge and phones can install it, so it opens in its own window like any other app. |

## The main workflow: from report to fix

![A problem is closed only when the person who reported it agrees](images/simple-workflow.png)

Every step sends a notification to the folk involved. The reporter can cancel while the problem's still Open or Assigned, and an engineer can put the work on hold and pick it back up later.

## Other workflows

**Somebody's already reported it**

1. You fill in the form and press Submit.
2. The app shows any open problems in the same building and category.
3. You press **Request escalation** on the one that matches and say why it's urgent.
4. Now you follow that problem and get its updates. It's marked urgent, and the engineer sees your reason.

**Two people reported the same thing**

1. An admin spots the duplicate and merges it into the main problem.
2. The duplicate closes, with a link to the main one.
3. Both people get every update on the main problem from then on. Only the first person who reported it can say it's fixed.

**Rating the engineer**

1. Once you've confirmed the fix, a **Rate** box appears.
2. Give 1 to 5 stars and a comment if you like. You can change it or delete it later.
3. Admins see each engineer's average on the Engineers page. The engineer never sees it.

**Managing people (admins)**

1. Create engineer accounts and set how many jobs each one can hold at once.
2. Make an employee an admin, or back again.
3. Turn an account off. That person's signed out on their next click and can't sign back in.
4. The app always keeps at least one admin, and an engineer with open jobs can't be turned off until those jobs are handed to somebody else.

**Two people act at the same moment**

The second one waits a wee second, then checks again. If the first one changed things, the second is turned down with a clear message, so nobody's change goes missing without them knowing.

## Keeping accounts safe

- **Passwords are never stored the way you typed them.** They're scrambled one way (bcrypt), so even the database doesn't hold your real password.
- **Signing in gives you a pass (a token).** Your browser shows it with every click, so you're not typing your password over and over. The server checks the pass is the real deal every time.
- **Passes run out.** One lasts 8 hours and is renewed quietly while you work. After 24 hours you sign in again. Close the tab and you're signed out.
- **The server decides what you're allowed to do.** Your role is checked on every click, so if an account's turned off or changed, that takes effect straight away.
- **A wrong email and a wrong password get the same message**, so nobody can go fishing for who has an account.

Still on the list: a limit on repeated login attempts. The technical details are in [How ACME Facility Desk Works](how-it-works.md).
