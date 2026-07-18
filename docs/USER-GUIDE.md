# C2Admin User Guide

The C2 Capital portfolio platform: tasks, property profiles, inspections, CapEx, contracts, and insurance in one place. This guide covers what the app does today and how to drive it fast, on desktop and phone.

---

## 1. Getting around

**Desktop sidebar.** Two groups: *Portfolio* (Dashboard, Tasks, CapEx, PM Performance, Contracts, Insurance, Reports, Inspections, Settings) and *Properties* (one link per property, colored initials). Reports is a placeholder ("Coming soon"), as are the Underwriting and Pipeline entries at the bottom. Sign out is in the footer.

**Mobile.** A fixed bottom tab bar gives one-thumb access to Dashboard, Tasks, Inspections, and Properties — the Properties tab toggles the sidebar as a slide-in drawer (that's where the property links and the rest of the nav live). The top bar has a hamburger (same drawer) and a **+** button that opens the task capture sheet from any page.

**Command palette (desktop only).** `Cmd+K` / `Ctrl+K` opens a search over:

- Pages (the sidebar destinations)
- Active properties
- Open tasks (most recent 300, anything not done)
- Active CapEx projects (planning / approved / in progress)

Arrow keys move, Enter selects, Esc closes. As soon as you type anything, **row 0 becomes "Create task"** — Enter on it runs your text through the same natural-language parser as the quick-add bar and creates the task on the spot, without leaving the page.

**Global capture.** Press `n` on any page (desktop; the Tasks page repurposes `n` to focus its own quick-add bar) or tap the mobile **+** to open the capture sheet. It's context-aware: on a property page (or an inspection page, via its property) the property is pre-set and shown as a chip; everywhere else the parser matches property names in your text. Only *active* properties are offered for matching. Tasks created here (or in the palette, or via any "+ Task" button) show an "Added to Tasks" toast and appear instantly in any open task list — no refresh needed.

**Settings.** Four tabs: Properties (add/edit, status active / disposition / watchlist, PMC and PMS platform), PMCs, Contacts, and Digest (send yourself a test of the daily email digest).

---

## 2. Tasks

The core of the app. Three views, switched by the tab toggle at the top:

| View | What it's for |
|---|---|
| **Agenda** (default) | The daily driver. Quick-add bar, then *your* inbox to process, then everything actionable now grouped by due date, snoozed items parked at the bottom. |
| **All tasks** | The full list with status pills, filters, search, and group-by. Use it to slice by property, CapEx project, person, or priority. |
| **Review** | A guided weekly sweep (see below). |

### Agenda

Shows only what you can act on: tasks assigned to you (or unassigned), not snoozed, not blocked by an open task, not done. Sections: **Inbox** (things you captured that still need processing — date them, promote them, or delete them), then **Overdue / Today / This week / Later / No due date**, then a collapsed **Snoozed** section listing wake dates. "Later" is unbounded, so something dated months out never disappears.

### All tasks

- **Status pills** — Inbox, Next action, Waiting, Blocked, Done (with counts). Done starts toggled off; click pills to include/exclude.
- **Filters** — property, CapEx project, person (contact on the task), priority, plus free-text search over title and description.
- **Group by** — Status (default), Property, Priority, or Due. In Due grouping, done and snoozed tasks move to trailing *Completed* / *Snoozed* sections instead of polluting the date buckets.
- Sections collapse independently per grouping; the Done section starts collapsed.
- Deep links work: `/tasks?property=<id>` or `/tasks?capex=<id>` opens the All view pre-filtered (CapEx detail pages link here).

### Review — the weekly sweep

Five fixed sections, in order:

1. **Inbox to zero** — every unprocessed capture of yours.
2. **Waiting on** — all `waiting` tasks, oldest-touched first, each showing "waiting *N*d" and the attached people. Chase or close.
3. **Obligations horizon** — auto-generated deadline tasks (renewals, expirations) due within 90 days, grouped by property. See section 7.
4. **Rocks** — open tasks tagged `rock` (the big things this quarter). Toggle a task's rock status with the mountain icon on its row, or type `#rock` in quick-add.
5. **Shipped last 7 days** — what got completed, newest first. Momentum check.

### Quick-add natural language

One line of text becomes a structured task. Matched tokens preview as chips under the bar before you hit Enter, and are stripped from the title.

| You type | Parsed as |
|---|---|
| `#roof #rock` | Tags (anywhere in the text; `#rock` marks a rock) |
| `!urgent` / `!high` / `!low` | Priority (anywhere) |
| `urgent` / `high` / `low` as the **last word** | Priority (bare word, trailing only) |
| `today`, `tomorrow`, `tmr` | Due date |
| `next week` | Next Monday |
| `friday` (full weekday name) | Next occurrence of that weekday (anywhere in text) |
| `fri`, `mon`, `tues`, … (abbreviation) | Same — but only after `on`/`by`/`due`, or at the very end |
| `7/25/2026` (M/D/YYYY) | That date (anywhere) |
| `7/25` (bare M/D) | Next occurrence — only after `on`/`by`/`due`, or at the very end |
| `aug 15`, `august 15th` | Next occurrence of that month/day (anywhere) |
| `on` / `by` / `due` before any date | Connector — stripped along with the date |
| `fox hill`, `at fox hill`, `@fox hill` | Property match (longest word-run from an active property's name wins; single generic words like "main", "park", "street" don't match on their own) |

Capture rules (same on every surface — quick-add bar, capture sheet, palette): a task **with a due date lands as Next action**, one **without lands in Inbox**; you become creator and assignee; a preset property (property-page context) beats a parser match.

Example: `call plumber fox hill tomorrow !urgent` → title "call plumber", due tomorrow, urgent, on Fox Hill.

### Keyboard shortcuts (Tasks page, desktop only)

| Key | Action |
|---|---|
| `j` / `k` (or ↓ / ↑) | Move row selection |
| `c` | Complete / un-complete selected task |
| `s` | Open its snooze menu |
| `d` | Open its due-date editor |
| `e` | Open the edit modal |
| `1` / `2` / `3` / `4` | Priority urgent / high / medium / low |
| `Delete` / `Backspace` | Delete (with Undo toast) |
| `l` / `h` | Open / close the row's subtask drill-down |
| `Enter` | Toggle the drill-down |
| `n` or `q` | Focus the quick-add bar (Agenda) |
| `Esc` | Clear selection / leave an input |

The shortcut legend sits in a footer strip on large screens. On any *other* page, `n` opens the global capture sheet.

### Snooze and swipe

**Snooze** hides a task from the Agenda until a wake date. Presets: **Tomorrow**, **Next week (Mon)**, **Next month**, or **Pick date…** — from the moon icon on any row, the `s` shortcut, the edit modal's "Snooze until" field, or a swipe.

**Swipe gestures (touch):** swipe a row **right to complete** (green check reveal), **left to open the snooze menu** (amber moon). The action arms at about half a swipe; vertical scrolling is unaffected.

### Subtasks

One level of nesting, deliberately. To create: expand a parent and use the inline **"Add subtask…"** input (inherits the parent's property, lands as Next action), or pick a **Parent task** in the edit modal. Rows with children show a **`2/5` progress chip** — click it (or `l`/`h`/`Enter`) to expand the drill-down. Subtasks never appear as top-level rows in any list or count.

Completion semantics: **completing a parent completes its open subtasks in the same action** — one toast, one Undo that restores everything. Un-completing a parent never touches children. A task that has children can't itself become a subtask, and auto-generated deadline tasks always stay top-level.

### Recurrence

Set in the edit modal: Daily, Weekly, Every 2 weeks, Monthly, Quarterly, Annually, or Custom (every N days/weeks/months), with an end condition (never / on date / after N times). The **next instance is created when you complete the current one**, stepping from the *original* due date — completing late never drifts the series. The completion toast says "next occurrence <date>", and Undo removes the spawned instance too. A recurring subtask's next occurrence stays under its parent unless the parent is done, in which case it spawns top-level.

### Saved views

The bookmark row above the list saves the *entire* page state — tab, status pills, all four filters, search text, and group-by — as a named chip. Click a chip to restore it (including switching tabs); the chip highlights while your current state matches it and un-highlights the moment you touch a filter. Rename/delete from the chip's kebab menu (delete has Undo). If a saved view references a property/project/contact that no longer exists, the stale filter is cleared with a notice instead of showing an empty list.

### Undo everywhere

Completing, deleting, and snoozing are all instant and optimistic, with toasts. Delete-undo is thorough: it restores the task, its subtasks, its contact links, and any "blocked by" links that pointed at it. If a write fails, the change rolls back visibly — the screen never silently disagrees with the database.

### Row anatomy

Priority pip (click to change) · complete circle · title (click to edit inline) · badges · property chip · CapEx link · people avatars (tap for call/text/email) · status dropdown · due date (inline picker, red when overdue, amber when due within 7 days) · mountain (rock toggle) · moon (snooze) · X (delete). Status/people columns hide on smaller screens.

---

## 3. Property profiles

Every property page has a hero header (name, city, units, PMC, parcel; occupancy / delinquency / NOI-variance traffic lights from the latest month) and these tabs:

| Tab | Contents |
|---|---|
| **Overview** | Building stat strip, 5-task preview with count, CapEx budget bars, property details + PMC contact, latest metrics, active insurance with days-to-expiry |
| **Tasks** | The full task toolkit scoped to this property: quick-add (property pre-set), due-date groups, inline edits, snooze, swipe, subtasks, undo — plus a collapsed "recently completed" section (last 14 days) where you can un-complete |
| **CapEx** | This property's projects with budget bars; links to project detail |
| **Metrics** | Monthly PM metrics table (occupancy, delinquency, NOI actual/budget, move-ins/outs, work-order close rate). Enter data on the PM Performance page |
| **Inspections** | Rollup of walks: score/grade per inspection, follow-up counts, links to stored PDF reports, and a **score trend line** once two or more completed walks exist |
| **Building** | Building facts (year built, SF, parking, construction, roof, unit mix…) — inline-editable — plus PCA items. Drag a PCA report PDF onto the tab to AI-extract facts and condition items (category, cost estimate, remaining useful life); review before saving. Each PCA item has a "+ Task" button |
| **Permits** | Read-only municipal permit table (pulled from the city permit portal during onboarding) |
| **Documents** | Property documents with expiration highlighting |

Tabs are URL-driven (`?tab=building`), so they're linkable.

---

## 4. Inspections

Built for walking a property with a phone.

**Start:** Inspections → New Inspection → pick property, type, date. Two types: **Site Visit** (regular walk-through) and **Annual** (everything in a site visit plus electrical, plumbing, life safety, parking/asphalt, signage, landscaping, building exterior). The inspection opens as a **draft** straight into capture.

**Capture findings.** The add-finding form sits right under the header:

1. Pick a **section** from the dropdown — it follows how you walk, never forces an order. Unit-type sections (Vacant Unit, Occupied Unit, and Building Exterior on annuals) take a **unit number**, creating instances like "Vacant Unit · 204". The dropdown shows a finding count per section.
2. Snap **photos** (opens the camera on mobile, multiple allowed) and/or type a short description.
3. Optionally flag **Follow up** with a priority (Low / Medium / High / Urgent).
4. **Save.** Each finding saves independently the moment you tap Save — flaky onsite connectivity can't lose a walk. On failure, the form keeps your photos and text; tap Save to retry.

Findings accumulate below, grouped by section instance. On each card you can add more photos, edit (description, section, unit, follow-up), or delete.

**Findings → tasks.** The list icon on a finding card (also in the edit modal) creates a follow-up task in one tap: Next action, on the inspection's property, priority copied from the finding, description pointing back at the finding and date. The card then shows a green **Task** chip linking to Tasks; the toast has Undo.

**Score & grades.** Score = 100 minus a deduction per follow-up finding — urgent 15, high 10, medium 5, low 2 — floored at 0. Findings without the follow-up flag cost nothing; they're observations. Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below. Drafts show no score (partial walks would inflate it).

**Report flow.** Mark the inspection **Submitted** when the walk is done (you can reopen the draft anytime). The report panel then appears:

- **Generate report** builds and stores the PDF (score, grade, findings with photos).
- **View PDF** opens it.
- **Send to PM** emails it with a summary — recipients pre-fill from the property's PMC primary contact, with one-tap chips for other PMC contacts, plus an optional message. Sending sets status **Report Sent**.

**Invalidation rule:** *any* change after generating — adding, editing, or deleting a finding, adding photos, or changing the inspection date — deletes the stored PDF and clears the sent state (status drops back to Submitted). The report behind "View PDF" always reflects reality; regenerate after edits.

The inspections list shows every walk with filters (property / type / status), sortable columns, scores, and follow-up counts. Only drafts can be deleted.

---

## 5. CapEx

**List vs Board** — toggle at the top (the board is also linkable at `/capex?view=board`).

- **List** defaults to *active* projects (planning / approved / in progress); switch the status filter for the rest. Desktop rows are inline-editable — title, category, status, budget, vendor, target date — no modal needed. Mobile shows cards that tap through to detail. Search covers title, property, vendor. KPI strip: total budget, actual spend, % used (for the filtered set).
- **Board** shows five status columns — Planning, Approved, In Progress, On Hold, Complete — always all statuses. **Drag a card to another column to change its status** (long-press to lift on touch); each column header shows count and budget total. Click a card to open its detail.

**Project detail** (`/capex/<id>`):

- **Budget overview** — budget, committed, actual spend, and an over/remaining readout. Actual spend derives from paid invoices.
- **Invoice & cost line items** — add description, vendor, amount, invoice date/number; click the status pill to toggle **pending ⇄ paid**. Footer totals paid vs pending.
- **Open linked tasks** — top-level tasks attached to this project, with "View in Tasks →" (a filtered deep link). Link a task to a project via the CapEx Project field in the task edit modal.
- **Edit** switches the header and details column into a form; Delete removes the project (confirm, permanent).

---

## 6. Contracts & Insurance

### Contracts (sidebar: "Contracts")

**Upload + AI extraction:** drag a vendor contract PDF **anywhere on the page** (or use Scan PDF) and the app extracts vendor, dates, cancellation terms, pricing, and type-specific detail. A **review modal** opens before anything is saved:

- Each extracted contract carries a **confidence badge** (high / medium / low) and an include checkbox.
- The banner tells you what to double-check: **expiration date** and **cancellation notice period** — they drive your deadline alerts. The **Cancel By date is auto-derived** (expiration − notice days) and re-derives as you correct either field.
- Type-specific blocks appear where relevant: trash (containers, pickup schedule, surcharges), elevator/HVAC/plumbing/electrical (inspection frequency, coverage, response SLA, emergency fee), laundry (revenue share %, equipment).
- **Save** uploads the PDF to storage and inserts the records. If a newer contract covers the same property + vendor + type, the older active one is automatically archived as **superseded** and linked to its replacement.

**Alert banners** at the top of the page: red for **cancellation deadlines within 90 days** (with the required notice method — certified mail, email, written), amber for **expirations within 90 days**.

Statuses: active (default filter), pending, expired, terminated, archived, superseded. Rows offer download, edit, archive-toggle, and permanent delete; Export produces an Excel of every field.

### Insurance

**Policies** works the same way: drag a COI or policy declaration PDF to extract carrier, limits, dates, and agent info, then review-confirm. The table shows a **Days Left** badge per policy (red ≤ 30 days, amber ≤ 90), an expiring-within-90-days banner, an inline status select (active / expired / cancelled / archived), a per-row **+ Task** button for follow-ups, and Excel export.

**Claims** is a tracker: type (property damage, liability, loss of income), amounts claimed/received, and a status pipeline — reported → under review → negotiating → settlement → closed / denied. The default filter shows open claims.

---

## 7. Obligations engine

A nightly job (6:00 UTC) turns contract and insurance deadlines into tasks automatically, so nothing renews or lapses unwatched.

**What qualifies:**

- Active **insurance policies** expiring within **120 days** → task "Renew insurance: <carrier> <type> — expires <date>", due on the expiry date.
- Active **contracts** whose **cancel deadline** (or expiration, if no cancel deadline is set) falls within **120 days** → task "Contract cancel window: <vendor> — <title>", due on that deadline.

**Priorities escalate nightly** as the deadline nears: insurance — medium (> 60 days), high (31–60), urgent (≤ 30); contracts — medium, high (≤ 30), urgent (≤ 14).

**It's a sync, not a one-shot:** if a deadline or title changes on the source record, the pending task updates; if the record is renewed or closed, the pending task auto-resolves (marked done with a note); a task you've completed is never recreated for the same deadline, but a new renewal cycle correctly gets a fresh task. These tasks always stay top-level, and the **Review → Obligations horizon** section shows every one due within 90 days, grouped by property.

The 120-day lead exists to leave runway for shopping replacements before a cancel window closes.

---

## 8. Reference

### Keyboard shortcuts

| Context | Key | Action |
|---|---|---|
| Anywhere (desktop) | `Cmd+K` / `Ctrl+K` | Command palette (navigate or create a task) |
| Any page except Tasks (desktop) | `n` | Open the capture sheet |
| Tasks page | `j` / `k`, ↓ / ↑ | Move selection |
| Tasks page | `c` | Complete / un-complete |
| Tasks page | `s` | Snooze menu |
| Tasks page | `d` | Due-date editor |
| Tasks page | `e` | Edit modal |
| Tasks page | `1`–`4` | Priority urgent → low |
| Tasks page | `⌫` / `Delete` | Delete (Undo toast) |
| Tasks page | `l` / `h` / `Enter` | Open / close / toggle subtasks |
| Tasks page | `n` / `q` | Focus the quick-add bar |
| Anywhere | `Esc` | Close / back out |

### Quick-add syntax

| Token | Effect | Placement |
|---|---|---|
| `#tag` | Add tag (`#rock` = rock) | Anywhere |
| `!urgent` `!high` `!low` | Priority | Anywhere |
| `urgent` `high` `low` | Priority | Last word only |
| `today` `tomorrow` `tmr` | Due date | Anywhere |
| `next week` | Due next Monday | Anywhere |
| `monday`…`sunday` | Next such weekday | Anywhere |
| `mon` `tue(s)` `wed` `thu(r/rs)` `fri` `sat` `sun` | Next such weekday | After `on`/`by`/`due`, or at end |
| `M/D/YYYY` | Exact date | Anywhere |
| `M/D` | Next occurrence | After `on`/`by`/`due`, or at end |
| `aug 15` / `august 15th` | Next occurrence | Anywhere |
| Property name fragment (optionally `at`/`for`/`@` first) | Assign property | Anywhere; active properties only |

Dated → Next action; undated → Inbox.

### Badges & chips glossary

| Badge | Meaning |
|---|---|
| Blue refresh chip (e.g. "Monthly") | Recurring task; next instance spawns on completion |
| Amber "Auto" clock chip | Auto-generated deadline task (obligations engine) |
| `2/5` chevron chip | Subtask progress; click to expand the drill-down |
| Colored property chip | The task/record's property (color is derived from the name, consistent everywhere) |
| Orange link + title | Linked CapEx project |
| ⛓ blocked | Waiting on another open task (set via "Blocked by" in the modal) |
| Mountain (amber when on) | Rock — big quarterly priority; surfaces in Review |
| "waiting *N*d" (Review) | Days since a waiting task was last touched |
| Grade badge A–F | Inspection score band (A/B green, C/D amber, F red) |
| "Follow up · High" flag | Inspection finding flagged for action, with priority |
| Green "Task" chip (finding) | Finding already has a linked task |
| Days-left badge | Time to expiry: red ≤ 30 days, amber ≤ 90 |
| Confidence badge (extraction review) | AI extraction confidence — verify low/medium rows before saving |

### Status vocabularies

- **Tasks:** inbox → next action / waiting / blocked → done
- **Inspections:** draft → submitted → report sent
- **CapEx:** planning → approved → in progress → on hold → complete
- **Contracts:** active, pending, expired, terminated, archived, superseded
- **Insurance policies:** active, expired, cancelled, archived
- **Claims:** reported → under review → negotiating → settlement → closed / denied
- **Properties:** active, disposition, watchlist (only active properties join task capture and quick-add matching)
