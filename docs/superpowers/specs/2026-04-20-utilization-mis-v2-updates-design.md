# Utilization MIS v2 — Post-Rollout Updates Design

**Date:** 2026-04-20
**Status:** Draft — pending user review
**Supersedes:** None (incremental updates to the April 7 spec)

## 1. Context

The Utilization MIS shipped on April 7 and ran its first live cycle on April 17. 24 of 33 fellows submitted; 9 pending; 1 conflict unresolved. Feedback from the first cycle drives this v2 batch: five discrete updates across cadence, workflow, UI, data, and mandate-lead logic.

The goal is to ship all five updates as a single release that goes live before **April 27, 2026 at 09:00 IST** — the first true weekly cycle.

## 2. Goals

1. Switch from biweekly to weekly cycles, anchored at April 27, 2026. Skip the April 20 slot.
2. Daily morning reminders on unresolved conflicts, threaded on the original conflict email.
3. Dashboard shows live cycle data and real-time monthly rollup without waiting for cycle finalization. Restructure for better IA (monthly at top, live cycle below, person drill-down on click).
4. New in-form capability for fellows to add projects not yet in Airtable (mandate / pitch / DDE) with Slack notification and conflict checking against teammate submissions.
5. Pause Airtable bandwidth writeback. Neon is the single source of truth for bandwidth.
6. Correct handling of VP-run mandates: VP1 is the actual lead (not the director), and owns submissions for the whole team.

## 3. Non-goals

- No authentication layer added for the dashboard.
- No changes to Airtable reads beyond adding the `Is this a VP run mandate?` field.
- No changes to utilization math, capacity formula, or conflict threshold.
- No backfilling of daily conflict reminders for the April 17 cycle's existing unresolved conflict.

## 4. High-level Architecture

| Layer | Change |
|---|---|
| Cron schedule | `start-cycle` stays at `30 3 * * 1` (9 AM IST Mon) but `isCycleMonday()` flips from biweekly to weekly. NEW cron `/api/cron/conflict-reminders` at `30 4 * * *` (10 AM IST daily). |
| DB schema | New tables: `ad_hoc_projects`, `conflict_reminders_sent`. Modified: `conflicts` gets `is_ad_hoc` and `last_reminder_sent_at`. |
| Config | `REFERENCE_DATE` in `schedule.ts` moves to `2026-04-27`. Biweekly logic kept as one-line comment for rollback. |
| Feature flags | `DISABLE_AIRTABLE_WRITEBACK=true` env var gates writeback. |
| Dashboard | Section reorder. Tier grouping. Sort persistence via localStorage. Live section decoupled from cycle status. Monthly view blends live submissions. |
| Airtable reads | NEW field `Is this a VP run mandate?` on mandates. Changes submission form logic for lead VPs. |

## 5. Migration Plan

| Phase | Date | What happens |
|---|---|---|
| Current state | 2026-04-20 | April 17 cycle still `collecting`, 9 pending + 1 conflict. Biweekly code running. |
| Deploy v2 | Before 2026-04-27 09:00 IST | New code live. `DISABLE_AIRTABLE_WRITEBACK=true`. Weekly cron logic anchored at April 27. |
| Auto-finalize old cycle | 2026-04-27 ~08:50 IST | `start-cycle` handler checks for older `collecting` cycles and finalizes them before kicking off the new one. April 17 cycle snapshots created from submitted data. Non-submitters recorded as "no data." |
| First weekly cycle | 2026-04-27 09:00 IST | Collection emails for the April 27 cycle go out. Old-cycle conflict reminders cease (replaced by silence — the April 17 conflict is closed with a note during auto-finalize). |
| First conflict reminder possible | 2026-04-28 10:00 IST | First morning the new cron could fire reminders — only for April 27+ cycle conflicts. |

**April 17 conflict handling.** The existing April 17 conflict never receives a daily reminder. During auto-finalize on April 27, if the conflict is still unresolved, it's closed with `resolvedBy = 'system-auto-close'` and the VP's submitted value is used as the final bandwidth. Alternative approaches were considered (force-resolve with one of the two values, leave permanently pending) — closing with VP value matches the "take VP as truth absent other data" rule from the new-project conflict logic.

## 6. Detailed Design

### 6.1 Weekly Cadence (Update #1)

**`app/src/lib/schedule.ts`** becomes:
```ts
const REFERENCE_DATE = new Date('2026-04-27');
// Was biweekly (diffDays % 14 === 0). Weekly now: every Monday from REFERENCE_DATE onward.
// To restore biweekly: re-add the `% 14 === 0` check.
export function isCycleMonday(date: Date): boolean {
  if (date.getDay() !== 1) return false;
  return date.getTime() >= REFERENCE_DATE.getTime();
}
```

**Effect on April 20.** Today's Monday returns `false` because `April 20 < April 27`. Even if the cron fires at 09:00 IST, `start-cycle` no-ops.

**`app/vercel.json`** — schedule string unchanged. Only the function logic changes.

**Email / UI copy.** No explicit "biweekly" text found in email templates (grep confirmed). The only reference is in `seed-test-data.mjs` which says "biweekly cycles" — update the comment to "weekly cycles" (seed script isn't production; informational only).

### 6.2 Conflict Reminder Cron (Update #2a)

**New file:** `app/src/app/api/cron/conflict-reminders/route.ts`

**Schedule:** `30 4 * * *` (10 AM IST daily). Added to `vercel.json`.

**Handler logic:**
```
1. Auth: verify CRON_SECRET (matches pattern of other cron routes).
2. Fetch the most recent cycle by createdAt desc.
3. If cycle is null OR cycle.startDate < '2026-04-27': exit (no eligible conflicts).
4. If cycle.status === 'complete': exit (cycle finalized, reminders stop per user rule).
5. Find all conflicts where:
   - cycleId === current cycle
   - status === 'pending'
   - emailMessageId IS NOT NULL
   - lastReminderSentAt IS NULL OR < today (date-truncated, IST)
6. For each conflict, send threaded reminder via Resend:
   - In-Reply-To: <emailMessageId>
   - References: <emailMessageId>
   - To: original VP/AVP (fetched via VP submission → fellow)
   - CC: ADMIN_EMAIL, CC_EMAIL (Ajder, Pai)
   - Subject: "Re: [original conflict subject]"
   - Body: "This conflict is still pending. Please resolve using the link below." + resolution link (reuses conflict.resolutionToken).
   - Insert row in conflict_reminders_sent with Resend message ID.
   - Update conflicts.lastReminderSentAt = now.
7. Respect Resend rate limit — 500ms sleep between sends (same pattern as send-reminders route).
```

**Stop conditions.** Reminders stop when:
- The conflict is resolved (`status='resolved'`) — natural flow.
- The cycle is finalized — already the auto-finalize step happening at next Monday 08:50 IST.
- A new cycle starts — implicit via step 2 (most recent cycle is the new one, which has no legacy conflicts).

**Schema changes:**
```ts
// app/src/lib/db/schema.ts — new table
export const conflictRemindersSent = pgTable('conflict_reminders_sent', {
  id: uuid('id').defaultRandom().primaryKey(),
  conflictId: uuid('conflict_id').references(() => conflicts.id).notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  resendMessageId: text('resend_message_id'),
});

// Modify existing conflicts table — one new column
lastReminderSentAt: timestamp('last_reminder_sent_at'),
```

Migration: `pnpm drizzle-kit push` against Neon.

### 6.3 Dashboard Restructure (Update #2b)

**New section order on `/dashboard`:**

1. **Monthly Report** (top)
   - Grouped by designation tier: VP, AVP, Associate, Analyst (in that order).
   - Each tier collapsible — Notion-style header row with caret (▸/▾) and tier name.
   - Click a row within a tier to open person drill-down.
   - Blends live cycle data with finalized snapshots: if a cycle is currently `collecting`, its submissions are used to compute a live utilization for the current month. When finalized, replaced by snapshot data seamlessly.
   - Existing sort already sorts by designation hierarchy + alpha; that stays.
   - Each tier's expand/collapse state persisted in localStorage key `utilmis.monthlyTierState` as `{ VP: true, AVP: true, Associate: true, Analyst: true }`.

2. **Latest Cycle** (middle) — always visible, never hidden
   - Shows the most recent cycle's data (whichever cycle is most recent, regardless of status).
   - If cycle is `collecting`: reads `submissions` table, computes utilization per fellow on-the-fly.
   - If cycle is `complete`: reads `snapshots` table for that cycle.
   - Header: "Week of [cycle start date] — [N of M] submitted" (collecting) or "Week of [cycle start date] — finalized" (complete).
   - Sort toggle (Designation / Load) — **same as today** — but the last-used sort is persisted in localStorage key `utilmis.liveCycleSort`.

3. **Person Drill-down** — same behavior as today
   - Triggered by clicking a row in Monthly Report or Latest Cycle.
   - Shows the fellow's month-by-month breakdown with week-level expansion.

**Tier grouping helper:**
```ts
// app/src/lib/tiers.ts (new)
export function getTier(designation: string): 'VP' | 'AVP' | 'Associate' | 'Analyst' {
  if (designation === 'VP') return 'VP';
  if (designation === 'AVP') return 'AVP';
  if (designation.startsWith('Associate')) return 'Associate';  // catches Associate 1/2/3
  return 'Analyst';
}
```

**Live-blending logic (monthly view).**
```
For each fellow, for each month in the current IY:
  - Collect all snapshots for that fellow in that month.
  - If the current cycle (status='collecting') has startDate in this month:
    - Compute a live pseudo-snapshot from the fellow's submissions in that cycle.
    - Include in the average.
  - Return: avg(utilizationPct) across all real + pseudo snapshots.
```

The pseudo-snapshot computation mirrors the finalize step's math but runs in-memory at page load. No DB write. No additional cron needed (Approach Q3.A locked during brainstorming).

**LocalStorage keys:**
- `utilmis.liveCycleSort` — `'designation' | 'load'`
- `utilmis.monthlyTierState` — JSON `{ VP: boolean, AVP: boolean, Associate: boolean, Analyst: boolean }`

No auth exists today; localStorage is the simplest persistent state (Approach Q3e.i locked).

### 6.4 Add Project Feature (Update #3)

**UI — submission form (`/submit/[token]`):**

New button below the existing project list: **"+ Add a project not listed"**. Click opens an inline expand (not modal — keeps the flow on one page).

Form fields:
| Field | Type | Notes |
|---|---|---|
| Project type | Radio: Mandate / Pitch / DDE | Required |
| Project name | Text input with autocomplete | Autocomplete shows existing ad-hoc projects from the same cycle matching the typed name (simple contains-match). Lets fellow join instead of duplicate. |
| Director | Dropdown | Fetched from Fellows List where Designation contains "Director". |
| Teammates on this project with me | Multi-select (searchable) | Populated from all fellows. User can select 0 or more. |
| My bandwidth | hrs/day or hrs/week | Same inputs as the main form. |
| Bandwidth for teammates (optional) | Expandable per-teammate block | If the submitter is a VP/AVP, they can provide bandwidth for each selected teammate. If the submitter is an associate, this block is hidden — only self-bandwidth is captured. |

Submit → POST `/api/add-project` → creates:
1. Row in `ad_hoc_projects` table (or reuses if fellow picked an existing suggestion).
2. One row in `submissions` for the submitter's self-bandwidth on this project. `projectRecordId` uses prefix `adhoc_<uuid>`.
3. If submitter is VP/AVP and provided teammate bandwidth: additional `submissions` rows with `isSelfReport=false` and `targetFellowId` set.
4. Slack webhook post to `#team-allocation` (formatted message below).
5. Response: 200, UI shows confirmation.

**Slack message format:**
```
:new: New ad-hoc project added to bandwidth tracker
*Name:* {name}
*Type:* {Mandate|Pitch|DDE}
*Director:* {director name}
*Team:* {comma-separated teammate names}
*Added by:* {submitter name}
*Cycle:* Week of {cycle start date}
Bandwidth given by {submitter}: {X hrs/week} ({Y% of capacity})
```

If the submitter also provided bandwidth for teammates, append one line per teammate:
```
Bandwidth noted for {teammate}: {X hrs/week}
```

**How teammates see an ad-hoc project that someone else created:**

When Fellow A creates an ad-hoc project and names Fellow B as a teammate, B's submission form (whenever B opens it) automatically lists the ad-hoc project alongside their Airtable-sourced projects. B sees:
- The ad-hoc project name, type, director, team (same display as regular projects).
- A self-bandwidth input.
- If A already provided bandwidth for B (and A was a VP/AVP), B sees a read-only indicator "Bandwidth noted by {A}: {X hrs/week}" as informational context — but B can still independently submit their own value. If they differ, conflict fires.

If A never named B, but B later uses "Add Project" and types the same name, autocomplete surfaces A's ad-hoc and B can join (sharing the same `adhoc_<uuid>`).

**Conflict detection on ad-hoc projects:**

Existing `detectConflicts` in `conflicts.ts` finds pairs where two fellows submitted different bandwidth for the same `projectRecordId`. This extends naturally to ad-hoc projects because both fellows reference the same `adhoc_<uuid>` if they picked the same project via autocomplete or were named as teammates.

**Conflict rules** (per user clarification):
1. If VP provides teammate bandwidth AND teammate self-submits → conflict check. If they differ by >1 hr/day, trigger conflict resolution workflow.
2. If VP provides teammate bandwidth AND teammate doesn't self-submit → VP value is truth. No conflict.
3. If teammate self-submits AND no VP submission for them → teammate value is truth. No conflict.

Rule (1) is the only case that triggers conflict resolution. Rules (2) and (3) are implicit (no pair to compare, so no conflict).

**Admin UI — linking ad-hoc to Airtable (`/admin` page):**

New section "Active ad-hoc projects" lists all ad-hoc projects where `status='active'`. For each row:

- Shows: name, type, director, team, created date, submission count.
- "Link to Airtable" button → opens modal:
  - Shows a **single suggested match** — fuzzy match (name similarity score using Levenshtein + director match). Top candidate displayed with confidence score.
  - One-click confirm: marks ad-hoc `status='linked'`, sets `linkedAirtableRecordId`, sets `linkedAt`.
  - "Not this one" → searchable dropdown of all active Airtable projects of the same type. Admin picks the right one.
  - Cancel → close modal, no change.

Once linked, the ad-hoc project is excluded from the next cycle's submission options (Airtable record takes over naturally).

**Schema additions:**
```ts
// app/src/lib/db/schema.ts
export const adHocProjects = pgTable('ad_hoc_projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  type: text('type', { enum: ['mandate', 'dde', 'pitch'] }).notNull(),
  name: text('name').notNull(),
  directorRecordId: text('director_record_id'),
  directorName: text('director_name'),
  teammateRecordIds: jsonb('teammate_record_ids').$type<string[]>().notNull(),
  createdByFellowId: text('created_by_fellow_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  status: text('status', { enum: ['active', 'linked', 'superseded'] }).notNull().default('active'),
  linkedAirtableRecordId: text('linked_airtable_record_id'),
  linkedAt: timestamp('linked_at'),
});
```

### 6.5 Airtable Writeback Pause (Update #4)

**Change:** In `app/src/lib/cycle.ts`, the call to `writeback(...)` in the finalize step gets wrapped:
```ts
if (process.env.DISABLE_AIRTABLE_WRITEBACK !== 'true') {
  await writeback(finalizedBandwidth);
}
```

**Env var setup:** `DISABLE_AIRTABLE_WRITEBACK=true` set on Vercel (production + preview).

**Rationale:** Scope is bandwidth writeback only (per user clarification). Other Airtable interactions (reading fellows, projects, config) stay untouched. Writeback code stays in the codebase — flip the env var to re-enable.

### 6.6 VP-run Mandate Logic (Update #5)

**Airtable field read.** Add to `app/src/lib/airtable/config.ts`:
```ts
mandates: {
  // ...existing fields
  isVpRun: 'Is this a VP run mandate?',
}
```
Values in Airtable: `Yes` / `No` (or empty). Treat anything other than `Yes` as `false`.

**Project type extension** (`app/src/types.ts`):
```ts
export type ProjectBreakdownItem = {
  // ...existing
  isVpRun?: boolean;
  leadFellowId?: string;       // VP1 record ID if isVpRun
  leadFellowName?: string;     // VP1 name if isVpRun
};
```

**Submission form routing** (`/submit/[token]`):

Determine a fellow's role on each mandate:

| Fellow's role on mandate | `isVpRun` = false | `isVpRun` = true |
|---|---|---|
| VP/AVP 1 | Submits for self + associate(s). Existing behavior. | Submits for self + VP/AVP 2 + every associate linked to the mandate. **New behavior.** |
| VP/AVP 2 | Submits for self + associate(s). Existing behavior. | Submits for self only. **New behavior.** |
| Associate | Self-submits. Existing behavior. | Self-submits. Existing behavior. |

"Every associate linked to the mandate" means all fellows appearing in the mandate's Associate slots in Airtable (2 slots per mandate per existing schema; VP1 sees whichever are populated).

On the form, each mandate row renders the appropriate set of bandwidth inputs based on this matrix.

**Conflict detection branching** (`app/src/lib/conflicts.ts`):

For a mandate where `isVpRun=true`:
- Pair A: VP1's bandwidth for VP2 vs VP2's own self-submission → conflict if differ by >1 hr/day.
- Pair B: VP1's bandwidth for each associate vs that associate's own self-submission → conflict if differ by >1 hr/day.

For `isVpRun=false`: existing logic unchanged (VP-side submits for associate, compare to associate's self-report).

**Dashboard display** (`DashboardView.tsx` → project breakdown rows):

For VP-run mandates, project label changes:
- Before: `{Project name} · Director: {director name}`
- After: `{Project name} · Led by: {VP1 name} · Director: {director name}`

Secondary director text gets muted styling to de-emphasize.

**Completion email** (per-fellow project list):
Same label treatment as dashboard.

## 7. Error handling

- **Conflict reminder cron** — if Resend send fails, log and continue to next conflict. Don't update `lastReminderSentAt` on failure so it retries tomorrow. Surface failures in admin email digest if needed (stretch; not required v1).
- **Add-project submit** — validate required fields server-side. Reject if `name` is empty, `director` not found, or `type` invalid. Autocomplete miss (fellow creates dupe of existing ad-hoc) is not blocked — user is nudged but can override.
- **Ad-hoc link to Airtable** — verify the chosen Airtable record exists and is of the same type before linking. If not, error and prompt to pick again.
- **VP-run mandate with missing VP/AVP 2 slot** — some VP-run mandates may only have VP1. Treat VP2 slot as absent; VP1 just submits for self + associates.
- **Monthly view blend** — if the current cycle has zero submissions, skip the live pseudo-snapshot computation. Fall back to snapshots only.
- **localStorage unavailable** — dashboard falls back to default (all tiers expanded, sort=designation). No error shown.

## 8. Testing

Unit:
- `schedule.test.ts` — updated: weekly cadence. April 20 returns false. April 27 returns true. May 4 returns true. Any Tuesday returns false.
- `conflict-reminders.test.ts` (new) — cron handler sends when conditions met, skips when no emailMessageId, skips when cycle complete, skips when cycle.startDate < 2026-04-27, respects lastReminderSentAt to avoid same-day duplicates.
- `conflicts.test.ts` — new tests: VP-run mandate pairs (VP1 vs VP2, VP1 vs each associate). Existing VP-associate pairs still pass for non-VP-run mandates.
- `ad-hoc-projects.test.ts` (new) — create ad-hoc, verify Neon rows, verify Slack webhook called (mocked), verify conflict fires when two fellows submit differently on same ad-hoc UUID.
- `dashboard-tier-grouping.test.ts` (new) — `getTier()` returns correct tier for each designation variant.
- Existing tests should continue to pass. Current count: 85 tests.

Integration:
- Manual e2e before April 27: force-start a test cycle after April 20 (use `?force=true` + `TEST_EMAIL_OVERRIDE`), create a conflict, force-trigger conflict-reminders cron, verify threaded email delivery.
- Manual e2e of Add Project: use `/submit/[token]` form, add a pitch, verify Slack post, verify Neon rows.

## 9. Open items for later (not v2 scope)

- Long-tail: a dashboard auth layer would let us move sort persistence server-side (currently localStorage, per-device).
- Long-tail: auto-match ad-hoc to new Airtable records could be upgraded from fuzzy-match suggestion to auto-link with admin confirmation.
- Long-tail: a "conflicts dashboard" showing all currently-active conflicts across cycles for admin visibility.

## 10. Rollout checklist

- [ ] Schema migration (`pnpm drizzle-kit push`) — creates `ad_hoc_projects`, `conflict_reminders_sent`; adds column to `conflicts`.
- [ ] Airtable config update — add `isVpRun` field read.
- [ ] Env var set: `DISABLE_AIRTABLE_WRITEBACK=true` on Vercel (production).
- [ ] Deploy new `conflict-reminders` cron — verify registered in Vercel.
- [ ] Update `vercel.json` with the new cron entry.
- [ ] Deploy before April 27 09:00 IST.
- [ ] Verify April 27 09:00 IST cron fires, auto-finalizes April 17 cycle, starts new weekly cycle.
- [ ] Verify April 28 10:00 IST conflict-reminders cron fires (will no-op if no conflicts).
- [ ] Close the April 17 dangling conflict as `system-auto-close` during auto-finalize.
