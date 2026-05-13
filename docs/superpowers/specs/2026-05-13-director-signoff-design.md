# Director Sign-off on Team Bandwidth — Design

**Date:** 2026-05-13
**Status:** Draft, awaiting user review
**Author:** Ajder + Claude

## 1. Problem

Today the cycle finalizes the moment all fellow submissions land and all (VP↔Associate) conflicts resolve. Bandwidth numbers are taken at face value from the people reporting them. Directors — who actually run the projects — have no structured way to confirm that the bandwidth their team is reporting matches reality, and no easy mechanism to flag a number they think is wrong.

The new feature gives each director a per-cycle sign-off step: as soon as their full portfolio's bandwidth is in (all submissions + all submission-level conflicts resolved), they get an email summarizing what their team reported. They either confirm the whole thing or flag specific lines. Flags kick off a conflict-resolution leg that mirrors the existing one, routed to the VP who owns the project (or the associate if there's no VP).

This is a third gate on cycle finalization, sitting after submissions and (submission-level) conflicts.

## 2. Scope

**In scope**

- Non-VP-led Mandates, DDEs, and Pitches. Each of these tables in Airtable has a Director field. For DDEs and Pitches there's no VP-led flag at all — if a VP is leading, they're already in the Director field. The director (whoever they are by designation) gets the sign-off email.
- Only established Airtable projects. Pending projects (new ones a fellow flagged this cycle that haven't been created in Airtable yet) are explicitly excluded from director sign-off this cycle; they'll show up in next cycle's sign-off once they're real Airtable records.
- Daily reminder emails for unresolved sign-offs, threaded into the original email (extending the existing `conflict-reminders` cron).
- A dashboard indicator on each project that's awaiting director sign-off, alongside the existing per-project "conflict pending" chip.

**Out of scope**

- **VP-led Mandates** (`Is this a VP run mandate? = Yes`). The VP/AVP 1 already runs the mandate end-to-end; there's no separate director to consult. VP-led mandates are auto-approved — bandwidth on them is taken as final the moment all submissions land and submission-level conflicts (if any) resolve. They contribute nothing to any director's slice and aren't gated by sign-off. The dashboard does not show a "awaiting director sign-off" chip on VP-led mandates.
- Sign-off on pending projects (next cycle's problem).
- Reopening or revising a sign-off after it's terminal.
- A bulk admin override to mark a director as confirmed on their behalf (could be added later if it turns out we need it; not building it now).
- Snapshots written before director sign-off completes — finalization is the only point where snapshots are written, and that already happens after all gates pass.

## 3. Definitions

- **Director's slice** — the set of bandwidth submissions on projects where this director is named in the Airtable Director field, within the current cycle. **VP-led Mandates are never in any slice** — they bypass sign-off entirely.
- **Slice complete** — every fellow with a token on any of those projects has a non-pending token AND every submission-level conflict referencing those projects' submissions is resolved.
- **Signoff** — a `director_signoffs` row representing one director's response status for one cycle.
- **Flag** — a director's claim that a specific submission's number is wrong. Each flag becomes one `conflicts` row with `source='director_flag'`.

## 4. Data Model

### 4.1 New table: `director_signoffs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default random | |
| `cycleId` | uuid | FK → `cycles.id`, NOT NULL | |
| `directorFellowId` | text | NOT NULL | Airtable record id |
| `directorEmail` | text | NOT NULL | snapshot at create time |
| `directorName` | text | NOT NULL | snapshot |
| `status` | enum | NOT NULL | `email_sent | confirmed | flagged | flagged_resolved` |
| `signoffToken` | text | NOT NULL, UNIQUE | UUID used in `/signoff/[token]` URL |
| `emailMessageId` | text | nullable | Resend message id, for reminder threading |
| `lastReminderSentAt` | timestamp | nullable | cron reads/writes this |
| `confirmedAt` | timestamp | nullable | when director hit Confirm |
| `confirmedBy` | text | nullable | `'director'` today; field exists to future-proof for admin override |
| `flaggedAt` | timestamp | nullable | when director submitted ≥1 flag |
| `resolvedAt` | timestamp | nullable | when last child conflict resolved |
| `createdAt` | timestamp | NOT NULL, default now | |
| `updatedAt` | timestamp | NOT NULL, default now | bump on every transition |

Unique constraint: `(cycleId, directorFellowId)`. This is the idempotency anchor — if two near-simultaneous slice-completion checks fire for the same director, only one row exists and only one email goes out.

Note: there is no `pending` status. A director's signoff row only exists once their slice has become complete and the email has gone out. "Pending" is the implicit pre-row state.

### 4.2 Existing `conflicts` table — extend

The existing `conflicts` table represents a two-sided disagreement (VP submission vs Associate submission). A director flag is one-sided: a third party flagging a single submission. To represent both shapes in one table we add a `source` discriminator and a few new columns, and drop the NOT NULL on the columns that only apply to one shape.

| Column | Change | Notes |
|---|---|---|
| `source` | NEW, text enum NOT NULL default `'submission'` | values: `submission`, `director_flag` |
| `flaggedSubmissionId` | NEW, uuid FK → `submissions.id`, nullable | set for `director_flag` rows only |
| `flaggedByFellowId` | NEW, text, nullable | the director's fellow record id (for `director_flag` rows) |
| `flaggedOriginalHoursPerDay` | NEW, real, nullable | snapshot of the value the director is flagging |
| `proposedHoursPerDay` | NEW, real, nullable | director's proposed value. Nullable in DB for backwards compat with any existing rows; at insert time always set to a positive number (application-level requirement). |
| `directorComment` | NEW, text, nullable | director's free-text note |
| `signoffId` | NEW, uuid FK → `director_signoffs.id`, nullable | parent signoff for `director_flag` rows |
| `resolverFellowId` | NEW, text, nullable | the resolver's Airtable record id (the TO recipient on the resolution email). Set for `director_flag` rows at insert time so the reminder cron doesn't have to re-derive via Airtable each tick. Existing `submission` rows leave this NULL (cron continues to derive from `vpSubmissionId` for those). |
| `resolverEmail` | NEW, text, nullable | resolver's email at insert time, same purpose |
| `vpSubmissionId` | DROP NOT NULL | nullable for `director_flag` rows |
| `associateSubmissionId` | DROP NOT NULL | nullable for `director_flag` rows |
| `vpHoursPerDay` | DROP NOT NULL | nullable for `director_flag` rows |
| `associateHoursPerDay` | DROP NOT NULL | nullable for `director_flag` rows |
| `difference` | DROP NOT NULL | nullable for `director_flag` rows |

**Application-level invariants** (not enforced by CHECK constraints — discipline in the insert paths):

- `source='submission'`: `vpSubmissionId`, `associateSubmissionId`, `vpHoursPerDay`, `associateHoursPerDay`, `difference` all populated; `flaggedSubmissionId`, `signoffId`, `flaggedByFellowId`, `flaggedOriginalHoursPerDay`, `proposedHoursPerDay`, `directorComment` all NULL.
- `source='director_flag'`: `flaggedSubmissionId`, `flaggedByFellowId`, `flaggedOriginalHoursPerDay`, `signoffId` all populated; `proposedHoursPerDay` always set to a valid positive number (required — UI enforces, server-side rejects otherwise); `directorComment` optional (may be NULL); `vpSubmissionId`, `associateSubmissionId`, `vpHoursPerDay`, `associateHoursPerDay`, `difference` all NULL.

### 4.3 No changes to

`submissions`, `cycles`, `tokens`, `pending_projects`, `snapshots`, `conflict_reminders_sent`.

The existing `conflict_reminders_sent` log table is reused as-is — its `conflictId` FK works for resolution-leg reminders on `director_flag` conflicts. Sign-off reminders (different shape: keyed on signoff, not conflict) use `director_signoffs.lastReminderSentAt` directly instead of a separate log table, since signoff reminders are simpler (one-per-signoff, no per-side targeting).

### 4.4 Migration

One additive SQL file: `drizzle/0005_director_signoff.sql`. Same hand-applied-to-Neon pattern as `0004_pending_projects_lifecycle.sql`. All changes are non-destructive (new table, new columns, NULL-relaxations on `conflicts`).

```sql
CREATE TABLE director_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  director_fellow_id text NOT NULL,
  director_email text NOT NULL,
  director_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('email_sent','confirmed','flagged','flagged_resolved')),
  signoff_token text NOT NULL UNIQUE,
  email_message_id text,
  last_reminder_sent_at timestamp,
  confirmed_at timestamp,
  confirmed_by text,
  flagged_at timestamp,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, director_fellow_id)
);

ALTER TABLE conflicts
  ADD COLUMN source text NOT NULL DEFAULT 'submission',
  ADD COLUMN flagged_submission_id uuid REFERENCES submissions(id),
  ADD COLUMN flagged_by_fellow_id text,
  ADD COLUMN flagged_original_hours_per_day real,
  ADD COLUMN proposed_hours_per_day real,
  ADD COLUMN director_comment text,
  ADD COLUMN signoff_id uuid REFERENCES director_signoffs(id);

ALTER TABLE conflicts ALTER COLUMN vp_submission_id DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN associate_submission_id DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN vp_hours_per_day DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN associate_hours_per_day DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN difference DROP NOT NULL;
```

The `cycles.id` and `submissions.id` are `uuid` types, confirmed against `schema.ts`. Director fellow id is `text` to match the rest of the codebase's Airtable record id convention.

## 5. Airtable Field Additions

The mandate table already has a Director column (per user confirmation). DDE and Pitch tables also have it. The codebase doesn't read it yet — `TABLE_CONFIG` in `app/src/lib/airtable/config.ts` will gain a new `directorFields: string[]` entry per project type. Exact field names are TBD and need to be confirmed against the live Airtable schema before implementation starts; one quick MCP query during implementation will pin them down.

`fetchAllProjects()` in `app/src/lib/airtable/projects.ts` is extended to also pull director ids per project, attached to each `ProjectAssignment` as `directorIds: string[]`.

**VP-led Mandates are excluded:** if `isVpRun === true` on a Mandate, `directorIds` is set to `[]` (empty array). The Director field on Airtable is not read for those rows. A project with `directorIds = []` is never in any slice and is never gated by sign-off. This is the mechanical implementation of "VP-led mandates are auto-approved" from Section 2.

A project may have multiple directors (Airtable Director field can hold multiple linked records). The slice-completion check fires per-director, so each director independently gets their own email and either confirms or flags.

## 6. State Machine & Cycle Gate

### 6.1 Signoff lifecycle

```
(no row exists)
    │  trigger: director's slice just became complete
    ▼
email_sent ───────────── Confirm ──────────▶ confirmed         (TERMINAL)
    │
    └──────────────────── Flag ────────────▶ flagged
                                                │
                                                │ trigger: last child conflict resolves
                                                ▼
                                          flagged_resolved      (TERMINAL)
```

A signoff that's `email_sent` or `flagged` is "open". A signoff that's `confirmed` or `flagged_resolved` is "terminal".

### 6.2 Slice-completion check

Implemented as a pure function: `getDirectorSliceStatus(cycleId, directorFellowId): 'incomplete' | 'complete'`.

Logic:
1. Fetch all live projects where `directorIds` includes `directorFellowId` (treating VP-led Mandates accordingly).
2. Drop projects that have zero submissions this cycle (no team → nothing to sign off on).
3. For each remaining project: check that no token exists with `status='pending'` for any fellow on that project's team, AND no `conflicts` row exists with `status='pending'` AND `source='submission'` referencing any submission from that project.
4. Return `complete` only if every project in the trimmed set passes both checks.

Note step 3 filters to `source='submission'` conflicts — child `director_flag` conflicts from this same director's prior flag (if they responded once and then... wait, signoffs are terminal once they hit `flagged`; the director can't flag twice. So there's no recursion here. Still, the filter is good defensive practice to avoid future bugs.)

### 6.3 Where the check fires

Inside two endpoints, after the existing global-completion check returns its answer:

- `POST /api/submit` — after a submission lands, gather all directorIds for projects that submission touched (the submission's `projectRecordId`). For each director: if no `director_signoffs` row exists for `(cycleId, directorFellowId)` AND `getDirectorSliceStatus` returns `complete`: try to insert the signoff row (uniqueness handles races), and if the insert succeeds, send the signoff email.
- `POST /api/resolve` — after a submission-level conflict resolves, do the same for the directorIds of that conflict's `projectRecordId`. (Also handles the `flagged → flagged_resolved` transition when a director_flag conflict resolves — see section 9.5.)

Race safety: the unique constraint `(cycleId, directorFellowId)` is the bottom line. Two concurrent slice-complete detections → one INSERT succeeds, the other fails with a unique-constraint violation, which the app catches and silently no-ops (the other path already sent the email).

### 6.4 Cycle finalization gate

`checkAndFinalizeCycle` today gates on:
- (existing) All `tokens.status != 'pending'` for the cycle
- (existing) All `conflicts.status != 'pending'` for the cycle

New gate adds:
- (new) For every director who has ≥1 live project this cycle that received ≥1 submission: a `director_signoffs` row exists for `(cycleId, directorFellowId)` AND its `status` is `confirmed` or `flagged_resolved`.

The "director-completes-the-cycle" finalize trigger lives in the same place as the slice-completion check: after each `/api/submit` and `/api/resolve` call, after the slice-completion check runs (which may have flipped a signoff to `flagged_resolved` or created a new email_sent row), `checkAndFinalizeCycle` runs and either finalizes or no-ops.

## 7. Sign-off Email

### 7.1 Send path

When a director's signoff row is freshly inserted in `email_sent`, a function `sendDirectorSignoffEmail` runs immediately (synchronous within the request handler, same pattern as the existing collection / conflict emails).

Failure handling: if Resend returns an error, we leave the signoff row in `email_sent` with `emailMessageId = null`. The next slice-completion check will see the existing row and not retry the email. Operationally, this means a Resend failure leaves a director stuck — admin would notice in the dashboard (signoff row present but no `emailMessageId`) and could re-trigger manually. Same failure-mode as today's collection emails; not worse.

### 7.2 Recipients

- **TO:** director's email — the director is the sole actor; only they can press Confirm or submit Flags
- **CC:** `CC_EMAIL` (Pai) and `ADMIN_EMAIL` (Ajder) — informational visibility only. The signoff page enforces that only the director (via their unique signoff token) can act; Pai and Ajder seeing the CC'd email can't accidentally confirm or flag.
- **From:** `EMAIL_FROM`

### 7.3 Subject

`Bandwidth Sign-off — [date range] — [N] project(s)`

Where date range follows the existing cycle subject format (e.g., `12 May – 18 May 2026`) and N is the count of projects in the director's slice.

### 7.4 Body structure

Plain HTML, matches the existing email-template style (`email.ts` patterns):

- IndigoEdge header / logo line
- Greeting: `Hi [Director Name],`
- One-paragraph intro: `Your team has finished reporting bandwidth on the projects you direct for the cycle of [date range]. Please review the summary below and either confirm everything looks right or flag specific lines you think need a second look.`
- Primary CTA button: `Review & confirm bandwidth →` linking to `[APP_URL]/signoff/[token]`
- Secondary text: `One-click confirmation if everything looks right. Or flag specific lines and we'll route them for resolution.`
- Per-project preview table (just the bandwidth summary, no buttons inline — actions are all on the web page):
  - Project name + type label (Mandate / DDE / Pitch)
  - Sub-table: Person | Designation | Hrs/day | Hrs/week
- Closing line: `Reminder will be sent daily until this is responded to.`
- Footer: standard signature

The full action UI (Confirm + per-line Flag) lives on the linked page, not in the email. Rationale: HTML email rendering is unreliable for complex forms; email link scanners can prefetch GET links and cause accidental confirmations. The web page is the safe surface for state-changing actions.

## 8. Sign-off Web Page (`/signoff/[token]`)

### 8.1 Route

`app/src/app/signoff/[token]/page.tsx` — server component, fetches the signoff by token, fetches projects + submissions in scope, renders the page.

If the token is invalid or the signoff is already terminal, render a status page (`This signoff has already been [confirmed | resolved]`).

### 8.2 Layout

```
┌──────────────────────────────────────────────────────┐
│  Bandwidth Sign-off — [Date Range]                   │
│  Director: [Name]                                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ╔══════════════════════════════════════════════╗   │
│  ║   ✅  Confirm all accurate                    ║   │  ← large prominent
│  ║   Bandwidth across all your projects below   ║   │     button
│  ║   is correct, no flags needed.               ║   │
│  ╚══════════════════════════════════════════════╝   │
│                                                      │
│  or flag specific lines below ↓                      │
│                                                      │
│  ─── Project Name (Mandate) ─────────────────────    │
│  Person   Designation   Hrs/day   Hrs/week   Flag    │
│  Tanya    VP            2.0       12.0       [🚩]    │
│  Riya     Associate 2   1.5       9.0        [🚩]    │
│  Karan    Analyst       0.5       3.0        [🚩]    │
│                                                      │
│  [ flagged-row expansion: ]                          │
│  ┌──────────────────────────────────────────────┐    │
│  │ Proposed correct value:                      │    │
│  │ [_____] hrs/day  (required)                  │    │
│  │ Comment (optional):                          │    │
│  │ [______________________________________]     │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ─── Next Project ──────────────────────────────     │
│  ...                                                 │
│                                                      │
│  ╔══════════════════════════════════════════════╗   │
│  ║   Submit [N] flag(s)                         ║   │  ← sticky bottom
│  ╚══════════════════════════════════════════════╝   │
└──────────────────────────────────────────────────────┘
```

### 8.3 Client behavior

- "Confirm all accurate" → POST `/api/signoff/confirm` with `{ token }`. On success: show success message, replace UI with a confirmation state.
- "Flag" toggle on a row → expands inline form with required `proposedHoursPerDay` and optional `comment`. Inline validation: `proposedHoursPerDay` must be a positive number before that row can count as a valid flag. Comment is always optional.
- "Submit flags" button at the bottom → POST `/api/signoff/flag` with `{ token, flags: [{ submissionId, proposedHoursPerDay, comment? }, ...] }`. Disabled until ≥1 row has a valid flag. On success: show success message listing what was flagged + who got the resolution email + a note that Slack was posted.

Tokens are single-use against terminal state: once the signoff is `confirmed` or `flagged`/`flagged_resolved`, the page renders the status view, not the form. (A signoff sitting at `flagged` while child conflicts are still pending shows a "thanks, resolution in progress" state.)

### 8.4 API endpoints

- `POST /api/signoff/confirm` — body `{ token: string }`. Looks up the signoff, validates status is `email_sent`, transitions to `confirmed` (sets `confirmedAt = now()`, `confirmedBy = 'director'`), then runs `checkAndFinalizeCycle`. Returns 200 or 409 (already responded) / 404 (bad token).
- `POST /api/signoff/flag` — body `{ token: string, flags: Array<{ submissionId: string, proposedHoursPerDay: number, comment?: string }> }`. Server-side validation: token resolves to a signoff in `email_sent`; ≥1 flag; each flag must have `proposedHoursPerDay` as a valid positive number (comment is optional); each `submissionId` belongs to a submission on a project in this director's slice (no cross-cycle, no out-of-scope submissions). Within a single DB transaction:
  - Update signoff: `status='flagged'`, `flaggedAt=now()`.
  - For each flag, insert one `conflicts` row with `source='director_flag'`, `flaggedSubmissionId`, `flaggedByFellowId = directorFellowId`, `flaggedOriginalHoursPerDay` = submission's current `hoursPerDay`, `proposedHoursPerDay`, `directorComment`, `signoffId`, `resolutionToken = uuid()`, `status='pending'`, `projectRecordId = submission.projectRecordId`, `cycleId`.
  - After transaction commits: post one Slack message summarizing the flag set; send one resolution email per flag.
  - Returns 200 with a summary or 4xx for validation errors.

Both endpoints are token-authenticated (no other auth). Following the existing `/resolve/[token]` pattern. The signoffToken is a long random UUID; not signed/HMAC'd, same as today's tokens. The token's UNIQUE constraint plus DB-level status checks prevent replay.

## 9. Flag Resolution Flow

Each `director_flag` conflict row is resolved through a workflow that mirrors today's `/resolve/[token]` flow with a different resolver matrix and a one-sided writeback.

### 9.1 Resolver routing matrix

For a flagged submission, the resolver (the `TO` recipient of the resolution email) is determined by the flagged fellow's designation and the project's team composition.

Inputs available: `flaggedSubmissionId → submission.fellowRecordId, submission.projectRecordId`; project's `vpAvpIds` (treating AVP same as VP per user direction); flagged fellow's designation from the fellows table.

| Flagged fellow's designation | Project has ≥1 VP/AVP? | Resolver (TO) | Additional CC (always: director, Ajder, Pai) |
|---|---|---|---|
| VP or AVP | n/a (they are the VP/AVP) | The flagged fellow themselves | — |
| Anyone else (Associate 1/2/3, Analyst) | Yes | First VP/AVP on the project | The flagged fellow |
| Anyone else | No | The flagged fellow themselves | — |

"First VP/AVP on the project" = the first record id in the project's `vpAvpIds` list, after filtering to those whose fellow record's `Designation` contains "VP" (handles both VP and AVP). If multiple VPs on a project, the first one is the resolver; others not CC'd individually (Ajder + Pai already covered).

**Recipient deduplication:** the final TO+CC list is deduplicated by email address (case-insensitive). Common collisions: the director themselves being one of {Ajder, Pai}, or the flagged fellow being the resolver (TO and CC both pointing at the same person). The deduper keeps the higher-priority position (TO > CC) and drops the duplicate from the other.

If somehow there are zero VP/AVPs AND the flagged fellow isn't reachable (e.g., they're no longer an employee), fall back to: TO = ADMIN_EMAIL (Ajder), the conflict gets resolved by admin. Logged as a warning. Defensive case, shouldn't fire in practice.

### 9.2 Resolution email

- **Subject:** `Bandwidth Sign-off Flag — [Project Name] — [Fellow Name]`
- **TO:** resolver per matrix above
- **CC:** per matrix, always including director + ADMIN_EMAIL + CC_EMAIL
- **Body:**
  - `[Director Name] flagged [Fellow Name]'s bandwidth on [Project Name] ([Type]) this cycle.`
  - `Original value: [X] hrs/day ([Y] hrs/week)`
  - `Director's proposed value: [Z] hrs/day` (always present — proposed value is now required)
  - `Director's comment: "[text]"` (line omitted if no comment)
  - Three action buttons:
    1. **Keep original ([X] hrs/day)** → POST `/api/resolve` with `action='keep_original'`
    2. **Use director's proposed value ([Z] hrs/day)** → POST `/api/resolve` with `action='use_proposed'`
    3. **Provide a different value** → form with hrs/day input → POST `/api/resolve` with `action='custom'` and `customHoursPerDay`
  - All three action buttons land on `/resolve/[token]` for confirmation, same pattern as today's resolution emails.

### 9.3 `/resolve/[token]` extension

The existing route handles `source='submission'` conflicts today (two submissions, pick a side or custom). It's extended to also handle `source='director_flag'`:

- The page detects the conflict's `source` and renders the appropriate UI.
- For `director_flag`: shows the original value, proposed value, comment, and the three buttons above.
- Submission shape on POST is: `{ token, action: 'keep_original' | 'use_proposed' | 'custom', customHoursPerDay? }`.

### 9.4 Writeback

When a `director_flag` conflict resolves:

- **`action='keep_original'`:** Do NOT update the `submissions` row. The resolver is endorsing the current value as final. Read the submission's current `hoursPerDay` fresh and store it in `conflicts.resolvedHoursPerDay`. This avoids reverting the submission if some other path mutated it between flag-time and resolve-time (extremely unlikely in practice, but the cleanest defensive posture).
- **`action='use_proposed'` or `action='custom'`:** UPDATE the one `submissions` row identified by `flaggedSubmissionId` with new `hoursPerDay`, `hoursPerWeek = hoursPerDay * WORKING_DAYS_PER_WEEK`, and `autoScore = scoreHours(...)`. Set `conflicts.resolvedHoursPerDay` to the new value.
- **In all cases:** UPDATE the `conflicts` row: `status='resolved'`, `resolvedBy = action`. Send the confirmation email threaded via In-Reply-To to the resolution email's `emailMessageId` (already on the conflicts row). Mirrors `sendConflictResolutionEmail`.

This is one-sided writeback — unlike submission-level conflicts which UPDATE both VP and Associate submissions.

### 9.5 Signoff lifecycle transition

After a `director_flag` conflict resolves (and the writeback completes), check whether it was the last open child conflict of its parent signoff. SQL: `SELECT COUNT(*) FROM conflicts WHERE signoffId = $1 AND status = 'pending'`. If zero, transition the signoff to `flagged_resolved` (`status='flagged_resolved'`, `resolvedAt = now()`).

Then run `checkAndFinalizeCycle` — same as today.

## 10. Slack Post

When a director submits ≥1 flag, post one message to `#team-allocation` (via the existing webhook + `postToSlack` helper in `slack.ts`).

**One post per flag submission** (not one per individual flag). If the director flags 3 lines in one submission, the Slack post lists all 3. Reduces noise; everything is in one place. Threading is not used (existing Slack helper posts plain text, no thread_ts).

**Content (plain text + Slack mrkdwn, matching the existing `:new: *New Mandate*` style in `postNewProject`):**

```
:triangular_flag_on_post: *Director sign-off flag* — [Director Name] — Cycle [Date Range]

[Director Name] flagged [N] bandwidth claim(s):

• *[Project Name]* ([Type]) — [Fellow Name] ([Designation])
    Reported: [X] hrs/day
    Proposed: [Y] hrs/day  (or "no proposed value")
    Comment: "[text]"     (or omitted if no comment)
    Resolution email sent to: [Resolver Name]

• ... more lines ...

_Sign-off: [Director Name] — flagged (resolution pending)_
```

A new helper goes in `slack.ts`: `postDirectorFlagToSlack(payload)`.

## 11. Reminder Cron

The existing `app/src/app/api/cron/conflict-reminders/route.ts` runs Tue–Fri at 9am IST. It iterates pending `conflicts` rows and sends threaded reminders.

It's extended to also iterate `director_signoffs` rows where `status='email_sent'` AND (`lastReminderSentAt IS NULL OR lastReminderSentAt < now() - interval '24 hours'`). For each: send a threaded reminder email (TO = director, In-Reply-To = original `emailMessageId`, subject prefixed `Re: ` like the existing reminders), then UPDATE `lastReminderSentAt = now()`.

Reminder body is short: a one-paragraph nudge and the same `/signoff/[token]` link.

Resolution-leg reminders for `director_flag` conflicts come for free — the existing cron already iterates by `conflicts.status='pending'`, regardless of source. Only the resolver gets the reminder (TO), same as today. CC list on the reminder defaults to the same recipients as the original conflict email (which we already store implicitly via threading). No extra work.

## 12. Dashboard Indicator

### 12.1 Per-project chip in Latest Cycle drill-down

The existing per-project "conflict pending" amber chip in the Live drill-down lives in the breakdown row rendering. Add a parallel blue chip: `awaiting director sign-off`.

A project displays the chip if there exists a `director_signoffs` row for the current cycle with `status IN ('email_sent', 'flagged')` AND that director's slice includes this project. Equivalently: any project in an open director's slice gets the chip.

Server-side derivation: in `getLiveCycleData` / `getLatestFinalizedCycleData`, fetch open signoffs for the cycle, expand to their project sets (via the same Airtable projects fetch + director-id filter), build a `Set<projectRecordId>` of awaiting-signoff projects, attach a boolean to each breakdown row.

The chip is independent of the conflict-pending chip — a project can have both (if it has a pending submission-level conflict AND its director hasn't signed off yet) or just one or neither.

### 12.2 Director sign-off panel

A new collapsible section in the Latest Cycle view: **Director Sign-offs**. Table:

| Director | Status | Projects | Last activity |
|---|---|---|---|
| Pai | ⏳ Awaiting | 5 | Email sent 2h ago |
| Shiv | 🚩 Flagged (1 of 2 resolved) | 4 | Flagged 1d ago |
| Sandeep | ✅ Confirmed | 3 | Confirmed 5h ago |

Each row links to the signoff (admin view) or to the relevant filtered Latest Cycle view. For v1: read-only table, no admin actions. Future iteration could add "force-confirm" or "remind now".

Directors with no live projects this cycle are excluded entirely from this panel.

### 12.3 Monthly view

No changes for v1. The monthly view shows aggregated utilization; signoff state is per-cycle and stops being relevant after the cycle finalizes (at which point all signoffs are terminal anyway).

## 13. Edge Cases & Race Handling

| Case | Behavior |
|---|---|
| VP-led Mandate in the cycle | `directorIds = []`, never enters any slice. Bandwidth on it flows through submissions + conflict resolution as normal. No sign-off email, no gate, no dashboard chip. Auto-approved. |
| Two directors share a project (Director field has multiple values) | Each gets their own email when their slice completes. Either may flag independently. If one flags and one confirms, the cycle still waits for the flag's child conflicts to resolve. |
| Director field changes mid-cycle (Airtable updated) | We use whatever the value is at the moment of slice-completion check. If a signoff row already exists for the original director, no new signoff is sent (the new director is silently dropped). Acceptable trade-off — director changes mid-cycle are rare and ambiguous; we don't auto-redirect. |
| Project moved out of active stage mid-cycle | Already excluded by existing active-stage filtering in `fetchAllProjects`. Won't appear in the slice check. |
| Director's slice was complete at cycle start, then a fresh conflict pops up | This should never happen in normal operation — conflicts are only detected at submission time, and submissions only fire during the collection window. The slice-completion check filters on `source='submission'` conflicts, so a director_flag conflict from this same director doesn't loop back. If somehow a new submission-level conflict appears post-signoff-send, it independently blocks finalization via the existing conflict gate; the director's signoff is not invalidated. |
| Director is also a fellow on someone else's project | Two independent flows. They submit as a fellow, they sign off as a director. Different tokens, different emails. |
| Director is a fellow on a project they direct | Their own bandwidth is shown in their own signoff email. They can confirm it (effectively self-confirming) or flag it. Acceptable; this is what we want. |
| Signoff token reused / replayed | DB status check rejects it. `email_sent → confirmed | flagged` is a one-way transition; subsequent POSTs return 409. |
| Director clicks "Confirm" on a stale email when status is already `flagged` | Page renders the "already flagged, resolution in progress" status view. POST is rejected with 409. |
| Resend bounce on signoff email | Signoff row left in `email_sent` with `emailMessageId = NULL`. Reminder cron will retry (re-sends not threaded since there's no message id, but at least the director gets nudged). Admin sees the gap in the dashboard. Same posture as today's collection email failures. |
| Director with zero live projects | No signoff row created, not gated against. |
| Director with live projects but every project has zero submissions (no team assigned) | No signoff row, not gated against. The director's "slice" is empty. |
| All directors confirm, but a submission-level conflict is still open | Cycle waits on the conflict, same as today. |
| Force-finalize via admin override | Existing override path (if any) bypasses gates. Not changing that. |
| Cycle re-opens for any reason | Out of scope. The system doesn't support cycle re-opening today. |
| Director flags without a proposed value | UI prevents submission (proposed value is required, comment is optional). Server-side also rejects (defense in depth). |
| Director flags the same line twice in one submission | UI doesn't allow it (Flag toggle is per-row). Server validates `submissionId` uniqueness in the `flags` array. |
| Two submissions land at the same instant, both completing slices for different directors | Both signoff rows insert successfully (different `(cycleId, directorFellowId)`). Two emails fire. Independent. |
| Two slice-completion checks fire for the same director simultaneously | Unique constraint serializes the insert. One succeeds, one fails with a constraint violation, which the app catches and no-ops. One email goes out. |
| The same flag's `flaggedSubmissionId` is also referenced by a still-open submission-level conflict | The flag waits, the submission-level conflict is the active dispute. In practice, slice-completion check would have failed (open submission-level conflict on a director's project), so the signoff email wouldn't have fired yet. This case shouldn't be reachable. |
| Director clicks the link after cycle finalization | Status view: "this cycle is closed". Read-only summary of what was reported. |

## 14. Files Touched

| File | Change |
|---|---|
| `app/src/lib/db/schema.ts` | New `directorSignoffs` table; extend `conflicts` with new columns |
| `app/drizzle/0005_director_signoff.sql` | New migration |
| `app/src/lib/airtable/config.ts` | Add `directorFields` to each project type's config |
| `app/src/lib/airtable/projects.ts` | Read directorIds in `fetchAllProjects`, attach to `ProjectAssignment` |
| `app/src/types.ts` | Extend `ProjectAssignment` with `directorIds`; add `DirectorSignoff`, `DirectorFlag` types |
| `app/src/lib/signoff.ts` | NEW — `getDirectorSliceStatus`, `createSignoffIfReady`, `submitFlags`, `transitionToFlaggedResolved` |
| `app/src/lib/email.ts` | Add `sendDirectorSignoffEmail`, `sendDirectorFlagResolutionEmail`, `sendDirectorSignoffReminderEmail`, `sendDirectorFlagResolutionConfirmationEmail` |
| `app/src/lib/slack.ts` | Add `postDirectorFlagToSlack` |
| `app/src/app/api/submit/route.ts` | Call `createSignoffIfReady` after existing post-submit logic |
| `app/src/app/api/resolve/route.ts` | Branch on `conflict.source`; for `director_flag`, write back single submission; call `transitionToFlaggedResolved` + `createSignoffIfReady` for related projects |
| `app/src/app/signoff/[token]/page.tsx` | NEW — server-rendered signoff page |
| `app/src/app/signoff/[token]/signoff-form.tsx` | NEW — client component with flag UI |
| `app/src/app/api/signoff/confirm/route.ts` | NEW |
| `app/src/app/api/signoff/flag/route.ts` | NEW |
| `app/src/app/api/cron/conflict-reminders/route.ts` | Extend to also reminder open signoffs |
| `app/src/app/dashboard/...` | Add awaiting-signoff chip + Director Sign-offs panel (specific files determined during implementation) |
| `app/src/lib/cycle.ts` | Extend `checkAndFinalizeCycle` gate; helper to enumerate "directors in scope this cycle" |
| `app/tests/...` | New test files: `signoff.test.ts` (slice-status logic, resolver matrix), `api-signoff.test.ts` (endpoint behaviors), `email-signoff.test.ts` (template rendering), `cycle-gate.test.ts` (the new third gate) |

## 15. Test Plan

| Area | Tests |
|---|---|
| Slice completion | All combinations of (submissions pending / all in) × (conflicts pending / all resolved) × (some projects, no projects, zero-team projects). Both VP-led Mandate path and Director-field path. |
| Resolver matrix | All three branches (VP flagged, Associate flagged with VP present, Associate flagged with no VP). AVP treated as VP. Fallback to ADMIN_EMAIL when no resolver available. |
| Race idempotency | Two concurrent inserts on the same `(cycleId, directorFellowId)` — one succeeds, one no-ops. Two concurrent confirms — one succeeds, one returns 409. |
| Flag submission validation | Empty flags rejected. Flag with neither proposed nor comment rejected. Flag with out-of-scope submissionId rejected. Duplicate submissionId in flags array rejected. |
| Conflict resolution one-sided writeback | UPDATE on the single submission row. `scoreHours` re-runs. `flagged_resolved` transition fires only when last child conflict resolves. |
| Cycle gate | All three gate combinations tested. Director with no projects ignored. Director with all-zero-submissions projects ignored. |
| Reminder cron | Signoff in `email_sent` for >24h gets reminder. Signoff in terminal state ignored. `director_flag` conflicts pulled into the existing conflict-reminder loop without modification. |
| Email rendering | Signoff email template snapshot test. Resolution email template snapshot test. Both with multi-project / single-project cases. |
| Dashboard | Chip appears for projects in open signoffs; doesn't appear for confirmed/resolved/no-signoff projects. Director Sign-offs panel renders all three states. |
| End-to-end | Single full happy-path test that runs through: submission → conflict resolution → signoff email fires → director confirms → cycle finalizes. Plus a parallel test where director flags and resolution happens before finalization. |

Existing test suite at 147 passing. Targeting roughly +35 new tests, bringing total to ~180. All Vitest, same patterns as existing tests.

## 16. Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | Exact Airtable field names for Director on each of the three project tables (Mandate, DDE, Pitch). | Confirm via MCP / Airtable during implementation kickoff | OPEN |
| 2 | ~~Should the initial signoff email CC Ajder + Pai?~~ Resolved 2026-05-13: YES — CC both. Pai is informational; director is sole actor. | Ajder | RESOLVED |
| 3 | Should the resolution-email confirmation thread back to the original sign-off email or to the resolution email? Current design says resolution email (consistent with today's submission-conflict pattern). | Ajder | OPEN — recommend keep as-is |

None of these block the spec; they're refinable during/after implementation.

## 17. Out of Scope (Future)

- Admin force-confirm action on the dashboard (would let Ajder mark a director as confirmed if they go AWOL).
- "Remind now" button per signoff on the dashboard.
- Re-opening a signoff after it's terminal (allow a director to revise their response).
- Sign-off on pending projects.
- A weekly digest email to Ajder summarizing the cycle's sign-off activity.
- Per-project deep links in the signoff email (jump-to-project anchors).
