# Utilization MIS v2 Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five discrete updates (weekly cadence, conflict reminders, dashboard restructure, ad-hoc projects, Airtable pause, VP-run mandates) as v2 of the running Utilization MIS before April 27, 2026 09:00 IST.

**Architecture:** Incremental changes against the deployed Next.js 16 + Neon + Drizzle codebase. New schema tables for ad-hoc projects and conflict-reminder audit. New cron for daily conflict reminders. Gated Airtable writeback via env var. Extended submit form UI. Restructured dashboard with tier grouping and live-cycle blending. VP-run mandates read a new Airtable field and change submission pairing.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM, Neon Postgres, Resend, Vercel Crons, Tailwind CSS, Vitest.

**Working directory:** `/Users/ajder/Documents/IndigoEdge/Utilization MIS/` — all paths in this plan are relative to the `app/` subdirectory unless noted. Commands should be run from `app/`.

**Spec:** `docs/superpowers/specs/2026-04-20-utilization-mis-v2-updates-design.md`

---

## Phase 1 — Schema migration

### Task 1.1: Add new schema tables and columns

**Files:**
- Modify: `app/src/lib/db/schema.ts`

- [ ] **Step 1: Add adHocProjects and conflictRemindersSent tables, extend conflicts table**

Open `app/src/lib/db/schema.ts` and append these tables at the bottom of the file, then modify the `conflicts` table to add one new column:

```ts
// Add to conflicts table (insert before closing brace):
  lastReminderSentAt: timestamp('last_reminder_sent_at'),
  isAdHoc: boolean('is_ad_hoc').notNull().default(false),

// Append at the end of the file:
export const adHocProjects = pgTable('ad_hoc_projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  type: text('type', { enum: ['mandate', 'dde', 'pitch'] }).notNull(),
  name: text('name').notNull(),
  directorRecordId: text('director_record_id'),
  directorName: text('director_name'),
  teammateRecordIds: jsonb('teammate_record_ids').$type<string[]>().notNull(),
  createdByFellowId: text('created_by_fellow_id').notNull(),
  createdByFellowName: text('created_by_fellow_name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  status: text('status', { enum: ['active', 'linked', 'superseded'] }).notNull().default('active'),
  linkedAirtableRecordId: text('linked_airtable_record_id'),
  linkedAt: timestamp('linked_at'),
});

export const conflictRemindersSent = pgTable('conflict_reminders_sent', {
  id: uuid('id').defaultRandom().primaryKey(),
  conflictId: uuid('conflict_id').references(() => conflicts.id).notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  resendMessageId: text('resend_message_id'),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/db/schema.ts
git commit -m "feat(db): add ad_hoc_projects, conflict_reminders_sent tables; extend conflicts"
```

### Task 1.2: Push schema to Neon

**Files:**
- No code changes — DB migration only

- [ ] **Step 1: Run drizzle-kit push against production Neon**

Run: `cd app && vercel-ie env pull .env.local --environment=production && pnpm drizzle-kit push`
Expected: prompts to apply schema changes; approve. Should report new tables created and column added.

- [ ] **Step 2: Verify via Neon console**

Open Neon project in Vercel dashboard. In SQL editor:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'conflicts';
-- Expect: `last_reminder_sent_at` and `is_ad_hoc` present
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- Expect: `ad_hoc_projects` and `conflict_reminders_sent` present
```

- [ ] **Step 3: Delete local .env.local to avoid accidental commits**

Run: `cd app && rm -f .env.local`

---

## Phase 2 — Weekly cadence (Update #1)

### Task 2.1: Update schedule.ts to weekly logic with April 27 anchor

**Files:**
- Modify: `app/src/lib/schedule.ts`
- Test: `app/tests/schedule.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `app/tests/schedule.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isCycleMonday } from '../src/lib/schedule';

describe('isCycleMonday (weekly cadence from 2026-04-27)', () => {
  it('returns false for today (2026-04-20) — April 20 exception', () => {
    expect(isCycleMonday(new Date('2026-04-20'))).toBe(false);
  });

  it('returns true for 2026-04-27 (first weekly Monday)', () => {
    expect(isCycleMonday(new Date('2026-04-27'))).toBe(true);
  });

  it('returns true for every Monday after 2026-04-27', () => {
    expect(isCycleMonday(new Date('2026-05-04'))).toBe(true);
    expect(isCycleMonday(new Date('2026-05-11'))).toBe(true);
    expect(isCycleMonday(new Date('2026-06-08'))).toBe(true);
  });

  it('returns false for non-Mondays', () => {
    expect(isCycleMonday(new Date('2026-04-28'))).toBe(false);  // Tue
    expect(isCycleMonday(new Date('2026-05-03'))).toBe(false);  // Sun
  });

  it('returns false for Mondays before 2026-04-27', () => {
    expect(isCycleMonday(new Date('2026-04-13'))).toBe(false);
    expect(isCycleMonday(new Date('2026-04-06'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd app && pnpm test:run tests/schedule.test.ts`
Expected: April 20 test and April 27 test fail — current code returns `true` for April 20 and `false` for April 27 (biweekly logic).

- [ ] **Step 3: Update schedule.ts**

Replace `app/src/lib/schedule.ts` contents with:
```ts
const REFERENCE_DATE = new Date('2026-04-27');
// Weekly cadence. Every Monday from REFERENCE_DATE onward is a cycle Monday.
// To restore biweekly: re-add `if ((diffDays / 7) % 2 !== 0) return false;` after the date check.
export function isCycleMonday(date: Date): boolean {
  if (date.getDay() !== 1) return false;
  return date.getTime() >= REFERENCE_DATE.getTime();
}
```

- [ ] **Step 4: Run tests — expect all pass**

Run: `cd app && pnpm test:run tests/schedule.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/schedule.ts app/tests/schedule.test.ts
git commit -m "feat(schedule): switch to weekly cadence anchored at 2026-04-27"
```

### Task 2.2: Update seed script comment

**Files:**
- Modify: `app/seed-test-data.mjs`

- [ ] **Step 1: Find and replace "biweekly" wording**

Open `app/seed-test-data.mjs`, search for "biweekly" or "bi-weekly", replace with "weekly" in comments only (not variable names unless they also shift).

- [ ] **Step 2: Commit**

```bash
git add app/seed-test-data.mjs
git commit -m "chore(seed): update comments from biweekly to weekly"
```

---

## Phase 3 — Auto-finalize old cycles at new-cycle start

This covers the April 17 cycle closeout when April 27 fires. Also general-purpose: if any older `collecting` cycle exists when a new cycle starts, finalize it first.

### Task 3.1: Add finalizeStaleCycles helper to cycle.ts

**Files:**
- Modify: `app/src/lib/cycle.ts`

- [ ] **Step 1: Add new exported function after finalizeCycle**

In `app/src/lib/cycle.ts`, expose `finalizeCycle` by changing `async function finalizeCycle` to `export async function finalizeCycle`. Then add below it:

```ts
/**
 * Finds all cycles in 'collecting' status and finalizes them.
 * Any remaining unresolved conflicts are auto-closed using the VP's submitted value.
 * Used at new-cycle start to close out dangling old cycles.
 */
export async function finalizeStaleCycles(): Promise<string[]> {
  const staleCycles = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'collecting'));

  const finalizedIds: string[] = [];
  for (const cycle of staleCycles) {
    // Auto-close any dangling conflicts using VP's value as truth
    const pendingConflicts = await db
      .select()
      .from(conflicts)
      .where(and(eq(conflicts.cycleId, cycle.id), eq(conflicts.status, 'pending')));

    for (const conflict of pendingConflicts) {
      await db
        .update(conflicts)
        .set({
          status: 'resolved' as const,
          resolvedHoursPerDay: conflict.vpHoursPerDay,
          resolvedBy: 'system-auto-close',
        })
        .where(eq(conflicts.id, conflict.id));
    }

    await finalizeCycle(cycle.id);
    finalizedIds.push(cycle.id);
  }

  return finalizedIds;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/cycle.ts
git commit -m "feat(cycle): add finalizeStaleCycles helper with VP-as-truth conflict auto-close"
```

### Task 3.2: Call finalizeStaleCycles in start-cycle route

**Files:**
- Modify: `app/src/app/api/cron/start-cycle/route.ts`

- [ ] **Step 1: Replace the "already active" return with auto-finalize**

Replace `app/src/app/api/cron/start-cycle/route.ts` contents with:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { isCycleMonday, startCycle, finalizeStaleCycles } from '@/lib/cycle';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date();
  const force = req.nextUrl.searchParams.get('force') === 'true';

  if (!force && !isCycleMonday(today)) {
    return NextResponse.json({ message: 'Not a cycle Monday, skipping' });
  }

  // Finalize any dangling cycles before starting a new one.
  const finalizedIds = await finalizeStaleCycles();

  const fellowsParam = req.nextUrl.searchParams.get('fellows');
  const testFellowIds = fellowsParam ? fellowsParam.split(',') : undefined;

  const cycleId = await startCycle(testFellowIds);
  return NextResponse.json({
    message: 'Cycle started',
    cycleId,
    finalizedStale: finalizedIds,
    testMode: !!testFellowIds,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/cron/start-cycle/route.ts
git commit -m "feat(cron): finalize stale cycles before starting new ones"
```

---

## Phase 4 — Airtable writeback pause (Update #4)

### Task 4.1: Gate writeback with env var

**Files:**
- Modify: `app/src/lib/cycle.ts`

- [ ] **Step 1: Wrap the writeBandwidthToAirtable call**

In `app/src/lib/cycle.ts`, find the block that calls `writeBandwidthToAirtable` (around lines 122-133). Wrap the call:

Change:
```ts
    try {
      await writeBandwidthToAirtable(
        projectRecordId,
        firstSub.projectType as ProjectType,
        narrative
      );
      projectCount++;
    } catch (err) {
      failures.push({ projectName: firstSub.projectName, error: String(err) });
    }
```

To:
```ts
    if (process.env.DISABLE_AIRTABLE_WRITEBACK === 'true') {
      projectCount++;  // still count it for reporting
      continue;
    }
    try {
      await writeBandwidthToAirtable(
        projectRecordId,
        firstSub.projectType as ProjectType,
        narrative
      );
      projectCount++;
    } catch (err) {
      failures.push({ projectName: firstSub.projectName, error: String(err) });
    }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/cycle.ts
git commit -m "feat(cycle): gate Airtable writeback behind DISABLE_AIRTABLE_WRITEBACK env var"
```

### Task 4.2: Set env var on Vercel (manual step)

**Files:**
- None (external config)

- [ ] **Step 1: Set env var**

Run: `cd app && printf 'true' | vercel-ie env add DISABLE_AIRTABLE_WRITEBACK production`
Expected: `Success! Added Environment Variable DISABLE_AIRTABLE_WRITEBACK to Project app`.

Also add for preview: `printf 'true' | vercel-ie env add DISABLE_AIRTABLE_WRITEBACK preview`.

- [ ] **Step 2: Verify**

Run: `cd app && vercel-ie env ls | grep DISABLE_AIRTABLE_WRITEBACK`
Expected: listed for `production` and `preview` environments.

---

## Phase 5 — Conflict reminder cron (Update #2a)

### Task 5.1: Add sendConflictReminderEmail to email.ts

**Files:**
- Modify: `app/src/lib/email.ts`

- [ ] **Step 1: Add the exported function after sendConflictResolutionEmail**

In `app/src/lib/email.ts`, after the `sendConflictResolutionEmail` export, add:
```ts
/** Send a reminder email threaded with the original conflict email. */
export async function sendConflictReminderEmail(
  vpName: string,
  vpEmail: string,
  associateName: string,
  associateEmail: string,
  projectName: string,
  vpHours: number,
  associateHours: number,
  resolutionToken: string,
  originalMessageId: string,
): Promise<string | undefined> {
  const appUrl = process.env.APP_URL;

  return await sendEmail({
    from,
    to: overrideTo(vpEmail),
    cc: overrideCc([associateEmail, process.env.ADMIN_EMAIL!, process.env.CC_EMAIL!].filter(Boolean)),
    subject: `Reminder: Bandwidth Conflict — ${projectName}`,
    headers: {
      'In-Reply-To': originalMessageId,
      'References': originalMessageId,
    },
    html: `
      <div style="background:#fef3c7;padding:16px 20px;border-radius:8px;border-left:4px solid #d97706;margin:16px 0">
        <p style="margin:0 0 8px;font-weight:600;color:#92400e">Conflict Still Pending</p>
        <p style="margin:0;font-size:14px">Hi ${vpName}, the bandwidth conflict on <strong>${projectName}</strong> is still unresolved.</p>
      </div>
      <p>On <strong>${projectName}</strong>, you reported ${associateName} will spend <strong>${vpHours} hrs/day</strong>, but ${associateName} reported <strong>${associateHours} hrs/day</strong>.</p>
      <p>Please resolve:</p>
      <div style="margin:16px 0">
        <a href="${appUrl}/resolve/${resolutionToken}?action=use_associate" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">${associateName}'s number (${associateHours} hrs/day)</a>
        <a href="${appUrl}/resolve/${resolutionToken}?action=use_vp" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">My number (${vpHours} hrs/day)</a>
        <a href="${appUrl}/resolve/${resolutionToken}?action=custom" style="display:inline-block;background:#6b7280;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Enter a different number</a>
      </div>
    `,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/email.ts
git commit -m "feat(email): add sendConflictReminderEmail with threading"
```

### Task 5.2: Create conflict-reminders cron route

**Files:**
- Create: `app/src/app/api/cron/conflict-reminders/route.ts`

- [ ] **Step 1: Create the file with the handler**

Create `app/src/app/api/cron/conflict-reminders/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cycles, conflicts, submissions, conflictRemindersSent } from '@/lib/db/schema';
import { eq, and, desc, gte, isNotNull } from 'drizzle-orm';
import { sendConflictReminderEmail } from '@/lib/email';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const REMINDERS_START_DATE = '2026-04-27';  // Don't backfill April 17 cycle conflicts

function isSameIstDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  // Compare yyyy-mm-dd in IST (UTC+5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ad = new Date(a.getTime() + istOffsetMs).toISOString().split('T')[0];
  const bd = new Date(b.getTime() + istOffsetMs).toISOString().split('T')[0];
  return ad === bd;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get most recent cycle
  const [latestCycle] = await db
    .select()
    .from(cycles)
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!latestCycle) {
    return NextResponse.json({ message: 'No cycles' });
  }

  if (latestCycle.startDate < REMINDERS_START_DATE) {
    return NextResponse.json({ message: 'Latest cycle predates reminder start date' });
  }

  if (latestCycle.status === 'complete') {
    return NextResponse.json({ message: 'Latest cycle complete; no reminders' });
  }

  const pendingConflicts = await db
    .select()
    .from(conflicts)
    .where(
      and(
        eq(conflicts.cycleId, latestCycle.id),
        eq(conflicts.status, 'pending'),
        isNotNull(conflicts.emailMessageId),
      ),
    );

  const now = new Date();
  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  let sent = 0;
  for (const conflict of pendingConflicts) {
    if (isSameIstDay(conflict.lastReminderSentAt, now)) continue;  // already sent today

    // Load VP + associate submissions for names/emails
    const [vpSub] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, conflict.vpSubmissionId))
      .limit(1);
    const [assocSub] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, conflict.associateSubmissionId))
      .limit(1);
    if (!vpSub || !assocSub) continue;

    const vpFellow = fellowMap.get(vpSub.fellowRecordId);
    const assocFellow = fellowMap.get(assocSub.fellowRecordId);
    if (!vpFellow || !assocFellow) continue;

    try {
      const msgId = await sendConflictReminderEmail(
        vpFellow.name,
        vpFellow.email,
        assocFellow.name,
        assocFellow.email,
        vpSub.projectName,
        conflict.vpHoursPerDay,
        conflict.associateHoursPerDay,
        conflict.resolutionToken!,
        conflict.emailMessageId!,
      );

      await db.insert(conflictRemindersSent).values({
        conflictId: conflict.id,
        resendMessageId: msgId ?? null,
      });
      await db
        .update(conflicts)
        .set({ lastReminderSentAt: now })
        .where(eq(conflicts.id, conflict.id));

      sent++;
      await sleep(500);
    } catch (err) {
      console.error(`Failed to send reminder for conflict ${conflict.id}:`, err);
    }
  }

  return NextResponse.json({ message: `Sent ${sent} conflict reminder(s)`, total: pendingConflicts.length });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/cron/conflict-reminders/route.ts
git commit -m "feat(cron): add conflict-reminders cron — daily threaded reminders for unresolved conflicts"
```

### Task 5.3: Register cron in vercel.json

**Files:**
- Modify: `app/vercel.json`

- [ ] **Step 1: Add cron entry**

Replace `app/vercel.json` with:
```json
{
  "framework": "nextjs",
  "crons": [
    {
      "path": "/api/cron/start-cycle",
      "schedule": "30 3 * * 1"
    },
    {
      "path": "/api/cron/send-reminders",
      "schedule": "30 3 * * 2-5"
    },
    {
      "path": "/api/cron/conflict-reminders",
      "schedule": "30 4 * * *"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add app/vercel.json
git commit -m "feat(vercel): register conflict-reminders cron at 10am IST daily"
```

---

## Phase 6 — VP-run mandate (Update #5)

### Task 6.1: Add isVpRun to airtable config

**Files:**
- Modify: `app/src/lib/airtable/config.ts`

- [ ] **Step 1: Add isVpRunField to mandate config**

In `app/src/lib/airtable/config.ts`, add `isVpRunField` to the mandate entry:

Change the mandate entry so it includes:
```ts
  mandate: {
    tableId: 'tblETYHFy9FnXG9TH',
    nameField: 'Mandate Name',
    stageField: 'Current Stage of Mandate',
    vpAvpFields: ['Mandate VP / AVP 1', 'Mandate VP / AVP 2'],
    associateFields: ['Mandate Associate 1', 'Mandate Associate 2'],
    bandwidthField: 'Mandate Bandwidth Situation',
    isVpRunField: 'Is this a VP run mandate?',  // NEW — Yes/No field
    activeStages: [
      'Not Started', 'In Production', 'In GTM', 'In Docs', 'Closing',
      'Term Sheet Signed', 'DD Started',
    ],
    label: 'Mandates',
  },
```

Update the `TABLE_CONFIG` type signature at the top to make `isVpRunField` optional (only mandates have it):
```ts
export const TABLE_CONFIG: Record<ProjectType, {
  tableId: string;
  nameField: string;
  stageField: string;
  vpAvpFields: string[];
  associateFields: string[];
  bandwidthField: string;
  isVpRunField?: string;   // Only set for mandates
  activeStages: string[];
  label: string;
}> = { ... };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/airtable/config.ts
git commit -m "feat(airtable): add isVpRunField to mandate config"
```

### Task 6.2: Thread isVpRun through Project type and projects.ts

**Files:**
- Modify: `app/src/types.ts`
- Modify: `app/src/lib/airtable/projects.ts`

- [ ] **Step 1: Extend Project type**

In `app/src/types.ts`, find the `ProjectAssignment` (or equivalent) type. Add optional fields:
```ts
// Extend existing ProjectAssignment or Project type
  isVpRun?: boolean;
  leadFellowRecordId?: string;  // VP1's record ID when isVpRun=true
  leadFellowName?: string;      // VP1's name when isVpRun=true
```

Also extend `ProjectBreakdownItem`:
```ts
export type ProjectBreakdownItem = {
  // ...existing
  isVpRun?: boolean;
  leadFellowName?: string;
};
```

- [ ] **Step 2: Read isVpRun in fetchAllProjects**

In `app/src/lib/airtable/projects.ts`, find where mandate fields are parsed. Add logic to read the new field:

Inside the loop that parses each mandate record, add:
```ts
  const isVpRunRaw = record.fields[TABLE_CONFIG.mandate.isVpRunField!];
  const isVpRun = isVpRunRaw === 'Yes';
  const vpAvp1Ids = (record.fields['Mandate VP / AVP 1'] as string[] | undefined) || [];
  const leadFellowRecordId = isVpRun && vpAvp1Ids.length > 0 ? vpAvp1Ids[0] : undefined;
```

Include `isVpRun` and `leadFellowRecordId` in the returned project object. Do this only for mandate records; pitches and DDEs keep the fields undefined.

- [ ] **Step 3: Resolve leadFellowName in getProjectsForFellow / post-processing**

If the lookup of VP name from record ID isn't already done elsewhere, add a post-processing step in `getProjectsForFellow` (or wherever projects are returned) that takes `fetchEligibleFellows()` once and maps `leadFellowRecordId` to `leadFellowName` via the fellow list.

Concretely, in the function that's called from `startCycle` and the submit form to produce the projects list:
```ts
// After fetching projects, enrich with lead name:
import { fetchEligibleFellows } from './fellows';

const fellows = await fetchEligibleFellows();
const fellowMap = new Map(fellows.map(f => [f.recordId, f.name]));
for (const p of projects) {
  if (p.leadFellowRecordId) {
    p.leadFellowName = fellowMap.get(p.leadFellowRecordId);
  }
}
```

(If `projects.ts` already has a post-processing helper, add this there.)

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/types.ts app/src/lib/airtable/projects.ts
git commit -m "feat(airtable): read isVpRun and thread leadFellow info through project data"
```

### Task 6.3: Fix conflict cross-reference logic for any self-reporter

**Files:**
- Modify: `app/src/app/api/submit/route.ts`
- Test: `app/tests/vp-run-conflict.test.ts` (new unit-style)

- [ ] **Step 1: Write failing test (logic-level)**

Create `app/tests/vp-run-conflict.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isConflict } from '../src/lib/conflicts';

// This test documents the VP-run mandate logic: any self-report should be
// checked against projections (not just associate self-reports). Since the
// route currently contains the logic inline, this test asserts the helpers
// compose correctly. End-to-end verification is a manual step.

describe('VP-run mandate conflict semantics (logic)', () => {
  it('VP1-for-VP2 value differing from VP2 self is a conflict', () => {
    expect(isConflict(4, 6)).toBe(true);
  });

  it('VP1-for-VP2 matching VP2 self is not a conflict', () => {
    expect(isConflict(4, 4)).toBe(false);
  });

  it('VP1-for-associate differing from associate self is a conflict', () => {
    expect(isConflict(5, 2)).toBe(true);
  });
});
```

Run: `cd app && pnpm test:run tests/vp-run-conflict.test.ts`
Expected: tests pass (these use existing `isConflict` — they pass today but establish the coverage).

- [ ] **Step 2: Modify submit route to check any self-reporter**

In `app/src/app/api/submit/route.ts`, find the block starting with `if (!isVp && sub.isSelfReport)`. Change the guard:

From:
```ts
    if (!isVp && sub.isSelfReport) {
      // Associate just self-reported. Check if any VP has projected for them on this project.
```

To:
```ts
    if (sub.isSelfReport) {
      // Any self-report — check for existing projections for this fellow on this project.
```

This makes the self-report check fire for VP2's self-report on a VP-run mandate (where VP1 projected for VP2).

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd app && pnpm test:run`
Expected: all tests pass (87+ total).

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/submit/route.ts app/tests/vp-run-conflict.test.ts
git commit -m "fix(submit): check all self-reports for conflicts (VP-run mandate fix)"
```

### Task 6.4: Update submit form UI for VP-run mandates

**Files:**
- Modify: `app/src/app/submit/[token]/page.tsx` or `form.tsx` (whichever renders the mandate rows)

- [ ] **Step 1: Read current form structure**

Open both files. Identify where mandates are rendered. The existing form shows VP a row per associate they should project for. For VP-run mandates, VP1 should also see a row for VP2.

- [ ] **Step 2: Read current resolution logic**

Before writing code, open `app/src/lib/airtable/projects.ts` and identify the function that builds the per-fellow project list (likely `getProjectsForFellow`). Note:
- The exact return type / shape of a project object
- Where team members (VP1, VP2, Associate1, Associate2) are enumerated
- Whether projection targets are already computed server-side or derived client-side

This step is read-only — no code yet. The goal is to know exactly what to change in Step 3.

- [ ] **Step 3: Update project resolution for VP-run mandates**

In the existing per-fellow resolver, branch on `project.isVpRun`. Target rules:
- Non-VP-run mandate (or pitch/DDE): unchanged from today.
- VP-run mandate, fellow is VP1 (i.e., `fellow.recordId === project.leadFellowRecordId`): include VP2 and each associate as projection targets.
- VP-run mandate, fellow is VP2: self-only (no projection targets).
- VP-run mandate, fellow is an associate: self-only (unchanged).

Concrete pseudocode to adapt:
```ts
// Inside the loop that computes what a fellow sees for a project:
const isVpRunMandate = project.projectType === 'mandate' && project.isVpRun;
const isLeadVp = isVpRunMandate && project.leadFellowRecordId === fellowRecordId;

if (isVpRunMandate && !isLeadVp) {
  // VP2 or associate on a VP-run mandate — self only
  projectionTargets = [];
} else if (isLeadVp) {
  // VP1 — project for VP2 (if present) + every associate
  const vp2Id = project.vpAvpRecordIds.find(id => id !== fellowRecordId);
  const assocIds = project.associateRecordIds;
  projectionTargets = [vp2Id, ...assocIds]
    .filter((id): id is string => !!id)
    .map(id => ({ recordId: id, name: fellowMap.get(id) ?? '' }));
}
// else: existing non-VP-run projection logic applies
```

Field names (`vpAvpRecordIds`, `associateRecordIds`) are placeholders — replace with the actual property names from the object read in Step 2.

- [ ] **Step 4: Verify form component renders VP2 row automatically**

If the existing form iterates `projectionTargets` to render inputs (which Step 2 reading should have confirmed), no component change is needed — the new VP2 entry in the targets list renders through the existing loop. If the form instead hardcodes rendering of associate rows only, update it to iterate `projectionTargets` generically.

- [ ] **Step 5: Manual UI verification**

Start dev server: `cd app && pnpm dev`.
Use a test token (via admin or seed) where the fellow is VP1 on a mandate with `Is this a VP run mandate? = Yes`. Verify:
- The mandate appears
- Inputs are shown for self + VP2 + each associate (one per present teammate)

Actual Airtable record verification is required — pick a live mandate with VP-run flag if any exist, or toggle the flag on one for testing then toggle back.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/submit/[token]/
git commit -m "feat(submit): render VP1 bandwidth inputs for VP2 + associates on VP-run mandates"
```

### Task 6.5: Update dashboard to show "Led by" for VP-run mandates

**Files:**
- Modify: `app/src/app/dashboard/DashboardView.tsx`

- [ ] **Step 1: Find the project breakdown rendering**

Grep for `projectName` or `projectBreakdown` inside `DashboardView.tsx`.

- [ ] **Step 2: Modify project row to include leadFellowName when isVpRun**

Where the project name is rendered, add a line for the lead if present:
```tsx
<span>{proj.projectName}</span>
{proj.isVpRun && proj.leadFellowName && (
  <span className="text-xs text-gray-500 ml-2">Led by: {proj.leadFellowName}</span>
)}
```

Ensure `isVpRun` and `leadFellowName` reach the breakdown items by updating the finalize step in `cycle.ts` to populate them:

In `app/src/lib/cycle.ts`, in the `breakdown` map construction (around line 155), include:
```ts
      // Look up isVpRun + leadFellowName from projectMap
      ...(projectMap.get(s.projectRecordId) || {}),  // if project data is included
      // Or explicitly:
      isVpRun: projectMap.get(s.projectRecordId)?.isVpRun,
      leadFellowName: projectMap.get(s.projectRecordId)?.leadFellowName,
```

(Adjust based on actual structure — keep breakdown lean.)

- [ ] **Step 3: Manual verification in dashboard**

Run dev server, check a fellow who's on a VP-run mandate in the drill-down. Project row should show "Led by: X".

- [ ] **Step 4: Commit**

```bash
git add app/src/app/dashboard/DashboardView.tsx app/src/lib/cycle.ts
git commit -m "feat(dashboard): show 'Led by VP1' for VP-run mandates in project breakdown"
```

---

## Phase 7 — Ad-hoc projects (Update #3)

### Task 7.1: Create postNewAdHocProject Slack helper

**Files:**
- Modify: `app/src/lib/slack.ts`

- [ ] **Step 1: Add helper function**

Append to `app/src/lib/slack.ts`:
```ts
export async function postNewAdHocProject(
  projectName: string,
  projectType: 'mandate' | 'dde' | 'pitch',
  directorName: string,
  teammateNames: string[],
  submitterName: string,
  cycleStartDate: string,
  submitterHoursPerWeek: number,
  submitterUtilizationPct: number,
  teammateBandwidth: Array<{ name: string; hoursPerWeek: number }>,
): Promise<void> {
  const typeLabel = projectType === 'mandate' ? 'Mandate' : projectType === 'dde' ? 'DDE' : 'Pitch';
  const teammateList = teammateNames.length > 0 ? teammateNames.join(', ') : '—';
  const pctInt = Math.round(submitterUtilizationPct * 100);

  let text = `:new: New ad-hoc project added to bandwidth tracker\n` +
    `*Name:* ${projectName}\n` +
    `*Type:* ${typeLabel}\n` +
    `*Director:* ${directorName}\n` +
    `*Team:* ${teammateList}\n` +
    `*Added by:* ${submitterName}\n` +
    `*Cycle:* Week of ${cycleStartDate}\n` +
    `Bandwidth given by ${submitterName}: ${submitterHoursPerWeek.toFixed(1)} hrs/week (${pctInt}% of capacity)`;

  for (const tb of teammateBandwidth) {
    text += `\nBandwidth noted for ${tb.name}: ${tb.hoursPerWeek.toFixed(1)} hrs/week`;
  }

  await postToSlack(text);
}
```

Note: `postToSlack` is a private function inside the file — since the new helper uses it, no export change needed. If `postToSlack` is not exported, just call it directly.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/slack.ts
git commit -m "feat(slack): add postNewAdHocProject helper for ad-hoc project notifications"
```

### Task 7.2: Create /api/add-project route

**Files:**
- Create: `app/src/app/api/add-project/route.ts`

- [ ] **Step 1: Create route**

Create `app/src/app/api/add-project/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens, submissions, adHocProjects, conflicts, cycles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { normalizeToHoursPerDay, normalizeToHoursPerWeek, scoreHours } from '@/lib/scoring';
import { isConflict } from '@/lib/conflicts';
import { sendConflictEmail } from '@/lib/email';
import { postNewAdHocProject } from '@/lib/slack';
import { fetchEligibleFellows, isVpOrAvp } from '@/lib/airtable/fellows';

type ProjectType = 'mandate' | 'dde' | 'pitch';

interface AddProjectPayload {
  token: string;
  existingAdHocId?: string;  // set if fellow joined an existing ad-hoc
  type: ProjectType;
  name: string;
  directorRecordId: string;
  directorName: string;
  teammateRecordIds: string[];
  selfBandwidth: { value: number; unit: 'per_day' | 'per_week' };
  teammateBandwidth?: Array<{ recordId: string; value: number; unit: 'per_day' | 'per_week' }>;
}

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as AddProjectPayload;

  // Validate token
  const [tokenRecord] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token, payload.token))
    .limit(1);
  if (!tokenRecord || tokenRecord.status !== 'pending') {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  // Basic validation
  if (!payload.name?.trim() || !payload.type || !payload.directorRecordId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Create or reuse ad-hoc project
  let adHocId: string;
  if (payload.existingAdHocId) {
    adHocId = payload.existingAdHocId;
  } else {
    const [created] = await db
      .insert(adHocProjects)
      .values({
        cycleId: tokenRecord.cycleId,
        type: payload.type,
        name: payload.name.trim(),
        directorRecordId: payload.directorRecordId,
        directorName: payload.directorName,
        teammateRecordIds: payload.teammateRecordIds,
        createdByFellowId: tokenRecord.fellowRecordId,
        createdByFellowName: tokenRecord.fellowName,
      })
      .returning();
    adHocId = created.id;
  }

  const projectRecordId = `adhoc_${adHocId}`;

  // Self-submission
  const selfHpd = normalizeToHoursPerDay(payload.selfBandwidth.value, payload.selfBandwidth.unit);
  const selfHpw = normalizeToHoursPerWeek(payload.selfBandwidth.value, payload.selfBandwidth.unit);
  const { score: selfScore, meu: selfMeu } = scoreHours(selfHpd, payload.type);

  const [selfSub] = await db
    .insert(submissions)
    .values({
      cycleId: tokenRecord.cycleId,
      fellowRecordId: tokenRecord.fellowRecordId,
      projectRecordId,
      projectName: payload.name.trim(),
      projectType: payload.type,
      hoursValue: payload.selfBandwidth.value,
      hoursUnit: payload.selfBandwidth.unit,
      hoursPerDay: selfHpd,
      hoursPerWeek: selfHpw,
      autoScore: selfScore,
      autoMeu: selfMeu,
      isSelfReport: true,
    })
    .returning();

  const isVp = isVpOrAvp(tokenRecord.fellowDesignation);
  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  // VP/AVP can provide teammate bandwidth
  const teammateBandwidthForSlack: Array<{ name: string; hoursPerWeek: number }> = [];
  if (isVp && payload.teammateBandwidth && payload.teammateBandwidth.length > 0) {
    for (const tb of payload.teammateBandwidth) {
      const tbHpd = normalizeToHoursPerDay(tb.value, tb.unit);
      const tbHpw = normalizeToHoursPerWeek(tb.value, tb.unit);
      const { score: tbScore, meu: tbMeu } = scoreHours(tbHpd, payload.type);

      const [projSub] = await db
        .insert(submissions)
        .values({
          cycleId: tokenRecord.cycleId,
          fellowRecordId: tokenRecord.fellowRecordId,
          projectRecordId,
          projectName: payload.name.trim(),
          projectType: payload.type,
          hoursValue: tb.value,
          hoursUnit: tb.unit,
          hoursPerDay: tbHpd,
          hoursPerWeek: tbHpw,
          autoScore: tbScore,
          autoMeu: tbMeu,
          isSelfReport: false,
          targetFellowId: tb.recordId,
        })
        .returning();

      const teammate = fellowMap.get(tb.recordId);
      if (teammate) {
        teammateBandwidthForSlack.push({ name: teammate.name, hoursPerWeek: tbHpw });

        // Check for conflict: has teammate self-reported on this ad-hoc?
        const [existingSelf] = await db
          .select()
          .from(submissions)
          .where(
            and(
              eq(submissions.cycleId, tokenRecord.cycleId),
              eq(submissions.projectRecordId, projectRecordId),
              eq(submissions.fellowRecordId, tb.recordId),
              eq(submissions.isSelfReport, true),
            ),
          )
          .limit(1);

        if (existingSelf && isConflict(tbHpd, existingSelf.hoursPerDay)) {
          const resToken = crypto.randomUUID();
          const [conflictRow] = await db
            .insert(conflicts)
            .values({
              cycleId: tokenRecord.cycleId,
              projectRecordId,
              vpSubmissionId: projSub.id,
              associateSubmissionId: existingSelf.id,
              vpHoursPerDay: tbHpd,
              associateHoursPerDay: existingSelf.hoursPerDay,
              difference: Math.abs(tbHpd - existingSelf.hoursPerDay),
              resolutionToken: resToken,
              isAdHoc: true,
            })
            .returning();

          const emailId = await sendConflictEmail(
            tokenRecord.fellowName, tokenRecord.fellowEmail,
            teammate.name, teammate.email,
            payload.name.trim(), tbHpd, existingSelf.hoursPerDay, resToken,
          );
          if (emailId) {
            await db.update(conflicts).set({ emailMessageId: emailId }).where(eq(conflicts.id, conflictRow.id));
          }
        }
      }
    }
  }

  // If submitter is an associate and there's an existing VP projection for this ad-hoc → check conflict
  if (!isVp && payload.existingAdHocId) {
    const vpProjections = await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.cycleId, tokenRecord.cycleId),
          eq(submissions.projectRecordId, projectRecordId),
          eq(submissions.targetFellowId, tokenRecord.fellowRecordId),
          eq(submissions.isSelfReport, false),
        ),
      );
    for (const vpSub of vpProjections) {
      if (isConflict(vpSub.hoursPerDay, selfHpd)) {
        const vpFellow = fellowMap.get(vpSub.fellowRecordId);
        if (!vpFellow) continue;
        const resToken = crypto.randomUUID();
        const [conflictRow] = await db
          .insert(conflicts)
          .values({
            cycleId: tokenRecord.cycleId,
            projectRecordId,
            vpSubmissionId: vpSub.id,
            associateSubmissionId: selfSub.id,
            vpHoursPerDay: vpSub.hoursPerDay,
            associateHoursPerDay: selfHpd,
            difference: Math.abs(vpSub.hoursPerDay - selfHpd),
            resolutionToken: resToken,
            isAdHoc: true,
          })
          .returning();

        const emailId = await sendConflictEmail(
          vpFellow.name, vpFellow.email,
          tokenRecord.fellowName, tokenRecord.fellowEmail,
          payload.name.trim(), vpSub.hoursPerDay, selfHpd, resToken,
        );
        if (emailId) {
          await db.update(conflicts).set({ emailMessageId: emailId }).where(eq(conflicts.id, conflictRow.id));
        }
      }
    }
  }

  // Slack notification (only on initial create)
  if (!payload.existingAdHocId) {
    const teammateNames = payload.teammateRecordIds
      .map(id => fellowMap.get(id)?.name)
      .filter((n): n is string => !!n);
    const [cycleRow] = await db.select().from(cycles).where(eq(cycles.id, tokenRecord.cycleId)).limit(1);

    await postNewAdHocProject(
      payload.name.trim(),
      payload.type,
      payload.directorName,
      teammateNames,
      tokenRecord.fellowName,
      cycleRow?.startDate ?? '',
      selfHpw,
      selfHpw / 84,
      teammateBandwidthForSlack,
    );
  }

  return NextResponse.json({ ok: true, adHocId });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/add-project/route.ts
git commit -m "feat(api): add /api/add-project route for ad-hoc project creation"
```

### Task 7.3: Include ad-hoc projects in submission form (where fellow is teammate)

**Files:**
- Modify: `app/src/app/submit/[token]/page.tsx`

- [ ] **Step 1: Load ad-hoc projects for the fellow**

In the submit page's server component, after loading the Airtable projects for this fellow, also load ad-hoc projects from this cycle where the fellow is in `teammateRecordIds`:

```ts
import { adHocProjects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// After existing project fetch:
const cycleAdHoc = await db
  .select()
  .from(adHocProjects)
  .where(
    and(
      eq(adHocProjects.cycleId, tokenRecord.cycleId),
      eq(adHocProjects.status, 'active'),
    ),
  );

const myAdHoc = cycleAdHoc.filter(p =>
  p.createdByFellowId === tokenRecord.fellowRecordId ||
  (p.teammateRecordIds as string[]).includes(tokenRecord.fellowRecordId)
);
```

- [ ] **Step 2: Pass ad-hoc list to the form component**

Include `myAdHoc` in the props passed to the form component. Map each to the same shape as Airtable projects (with `projectRecordId = 'adhoc_' + p.id`).

- [ ] **Step 3: Manual verification**

Seed an ad-hoc project referencing a test fellow. Open `/submit/<test-token>` — the ad-hoc project should appear in the list.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/submit/[token]/page.tsx
git commit -m "feat(submit): show ad-hoc projects to fellows listed as teammates"
```

### Task 7.4: Add "Add Project" UI to submit form

**Files:**
- Modify: `app/src/app/submit/[token]/form.tsx`

- [ ] **Step 1: Add button + modal/expand block**

Below the existing project list in the form:
- Add a button labeled "+ Add a project not listed".
- On click, reveal an inline form with:
  - Type selector (radio: Mandate / Pitch / DDE)
  - Name input with autocomplete (fetches matching ad-hoc projects for this cycle via new `/api/ad-hoc-search?q=...` route — or fetch once on mount and filter client-side)
  - Director dropdown (loaded from an endpoint or passed in as a prop)
  - Teammate multi-select
  - Self-bandwidth input (same hrs/day or hrs/week UI)
  - If submitter is VP/AVP: expandable "Teammate bandwidth" block with one input per selected teammate

- [ ] **Step 2: Wire submission to /api/add-project**

On submit:
```ts
const res = await fetch('/api/add-project', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
if (!res.ok) { /* show error */ }
else { /* show success, refresh or reset */ }
```

- [ ] **Step 3: Directors list**

For the director dropdown, either:
- Expose a server endpoint `/api/directors` that returns fellows with designation matching "Director",
- Or fetch once at page mount on the server and pass as a prop.

Prefer the latter (simpler, no extra route).

- [ ] **Step 4: Teammate list**

Same as directors — pass all eligible fellows from server as a prop. Multi-select with client-side search.

- [ ] **Step 5: Manual verification**

Start dev server. Open a test submission page. Click "Add Project". Fill a pitch with self + 1 teammate. Submit. Verify:
- DB row in `ad_hoc_projects`
- DB rows in `submissions` (self + teammate projection if VP)
- Slack message posted
- Success state in UI

- [ ] **Step 6: Commit**

```bash
git add app/src/app/submit/[token]/
git commit -m "feat(submit): add 'Add project' button and form for ad-hoc projects"
```

### Task 7.5: Airtable project suggestion endpoint for admin linking

**Files:**
- Create: `app/src/app/api/ad-hoc-projects/suggest/route.ts`
- Create: `app/src/lib/similarity.ts` (for name similarity scoring)

- [ ] **Step 1: Create similarity helper**

Create `app/src/lib/similarity.ts`:
```ts
/** Simple similarity: Dice coefficient on character bigrams. 0–1 range. */
export function similarity(a: string, b: string): number {
  const an = a.toLowerCase().trim();
  const bn = b.toLowerCase().trim();
  if (an === bn) return 1;
  if (an.length < 2 || bn.length < 2) return 0;

  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };

  const aGrams = bigrams(an);
  const bGrams = bigrams(bn);
  let intersection = 0;
  for (const g of aGrams) if (bGrams.has(g)) intersection++;
  return (2 * intersection) / (aGrams.size + bGrams.size);
}
```

- [ ] **Step 2: Write test for similarity**

Create `app/tests/similarity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { similarity } from '../src/lib/similarity';

describe('similarity', () => {
  it('returns 1 for identical strings', () => {
    expect(similarity('acme', 'acme')).toBe(1);
  });

  it('returns high score for near matches', () => {
    expect(similarity('Acme Fundraise', 'Acme Corp Fundraise')).toBeGreaterThan(0.5);
  });

  it('returns low score for unrelated strings', () => {
    expect(similarity('Zomato pitch', 'Healthcare DDE')).toBeLessThan(0.2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd app && pnpm test:run tests/similarity.test.ts`
Expected: all 3 pass.

- [ ] **Step 4: Create suggest route**

Create `app/src/app/api/ad-hoc-projects/suggest/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adHocProjects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { similarity } from '@/lib/similarity';

export async function GET(req: NextRequest) {
  const adHocId = req.nextUrl.searchParams.get('adHocId');
  if (!adHocId) return NextResponse.json({ error: 'adHocId required' }, { status: 400 });

  const [adHoc] = await db.select().from(adHocProjects).where(eq(adHocProjects.id, adHocId)).limit(1);
  if (!adHoc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const allProjects = await fetchAllProjects();
  const candidates = allProjects
    .filter(p => p.projectType === adHoc.type)
    .map(p => ({
      projectRecordId: p.projectRecordId,
      projectName: p.projectName,
      score: similarity(p.projectName, adHoc.name),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return NextResponse.json({ topCandidate: candidates[0] ?? null, alternatives: candidates.slice(1) });
}
```

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/similarity.ts app/src/app/api/ad-hoc-projects/ app/tests/similarity.test.ts
git commit -m "feat(api): suggest Airtable project matches for ad-hoc linking"
```

### Task 7.6: Link ad-hoc to Airtable record

**Files:**
- Create: `app/src/app/api/ad-hoc-projects/link/route.ts`

- [ ] **Step 1: Create route**

Create `app/src/app/api/ad-hoc-projects/link/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adHocProjects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface LinkPayload {
  adHocId: string;
  airtableRecordId: string;
}

export async function POST(req: NextRequest) {
  const { adHocId, airtableRecordId } = (await req.json()) as LinkPayload;

  if (!adHocId || !airtableRecordId) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  await db
    .update(adHocProjects)
    .set({
      status: 'linked' as const,
      linkedAirtableRecordId: airtableRecordId,
      linkedAt: new Date(),
    })
    .where(eq(adHocProjects.id, adHocId));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/app/api/ad-hoc-projects/link/route.ts
git commit -m "feat(api): link ad-hoc project to Airtable record"
```

### Task 7.7: Admin UI — active ad-hoc projects section

**Files:**
- Modify: `app/src/app/admin/page.tsx`
- Create: `app/src/app/admin/ad-hoc-list.tsx`

- [ ] **Step 1: Create AdHocList client component**

Create `app/src/app/admin/ad-hoc-list.tsx`:
```tsx
'use client';
import { useState } from 'react';

interface AdHoc {
  id: string;
  name: string;
  type: string;
  directorName: string;
  teammateNames: string[];
  createdByFellowName: string;
  createdAt: string;
  submissionCount: number;
}

export function AdHocList({ adHocs }: { adHocs: AdHoc[] }) {
  const [linking, setLinking] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ id: string; name: string; score: number } | null>(null);

  async function openLinkModal(adHocId: string) {
    setLinking(adHocId);
    const res = await fetch(`/api/ad-hoc-projects/suggest?adHocId=${adHocId}`);
    const data = await res.json();
    setSuggestion(data.topCandidate);
  }

  async function confirmLink(adHocId: string, airtableRecordId: string) {
    await fetch('/api/ad-hoc-projects/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adHocId, airtableRecordId }),
    });
    window.location.reload();
  }

  if (adHocs.length === 0) {
    return <p className="text-sm text-gray-500 mt-8">No active ad-hoc projects.</p>;
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold mb-2">Active ad-hoc projects</h2>
      <table className="w-full text-sm border border-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-2 text-left">Name</th>
            <th className="p-2 text-left">Type</th>
            <th className="p-2 text-left">Director</th>
            <th className="p-2 text-left">Added by</th>
            <th className="p-2 text-center">Subs</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {adHocs.map(a => (
            <tr key={a.id} className="border-t">
              <td className="p-2">{a.name}</td>
              <td className="p-2 capitalize">{a.type}</td>
              <td className="p-2">{a.directorName}</td>
              <td className="p-2">{a.createdByFellowName}</td>
              <td className="p-2 text-center">{a.submissionCount}</td>
              <td className="p-2">
                <button className="px-3 py-1 text-xs bg-blue-600 text-white rounded" onClick={() => openLinkModal(a.id)}>
                  Link to Airtable
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {linking && suggestion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-2">Link to Airtable</h3>
            <p className="mb-4">Suggested match: <strong>{suggestion.name}</strong> (score: {suggestion.score.toFixed(2)})</p>
            <div className="flex gap-2">
              <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={() => confirmLink(linking, suggestion.id)}>Confirm</button>
              <button className="px-3 py-1 bg-gray-300 rounded" onClick={() => { setLinking(null); setSuggestion(null); }}>Cancel</button>
            </div>
            <p className="text-xs text-gray-500 mt-3">Alternative search/pick to be added if needed — for v2, confirm or cancel.</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Load data in admin page**

Modify `app/src/app/admin/page.tsx` to fetch active ad-hocs and render:

```tsx
// After existing data fetch, add:
import { adHocProjects, submissions } from '@/lib/db/schema';
import { eq, count as countFn } from 'drizzle-orm';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';
import { AdHocList } from './ad-hoc-list';

const activeAdHocs = await db
  .select()
  .from(adHocProjects)
  .where(eq(adHocProjects.status, 'active'));

const fellows = await fetchEligibleFellows();
const fellowMap = new Map(fellows.map(f => [f.recordId, f.name]));

const adHocsWithMeta = await Promise.all(activeAdHocs.map(async a => {
  const [{ c }] = await db.select({ c: countFn() }).from(submissions).where(eq(submissions.projectRecordId, `adhoc_${a.id}`));
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    directorName: a.directorName ?? '—',
    teammateNames: (a.teammateRecordIds as string[]).map(id => fellowMap.get(id) ?? id),
    createdByFellowName: a.createdByFellowName,
    createdAt: a.createdAt.toISOString(),
    submissionCount: Number(c ?? 0),
  };
}));
```

Render: `<AdHocList adHocs={adHocsWithMeta} />` below existing content.

- [ ] **Step 3: Manual verification**

Seed an ad-hoc, visit `/admin`. Verify row shows, "Link to Airtable" opens modal with suggested match.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/admin/
git commit -m "feat(admin): add active ad-hoc projects section with link-to-Airtable flow"
```

---

## Phase 8 — Dashboard restructure (Update #2b)

### Task 8.1: Tier helper

**Files:**
- Create: `app/src/lib/tiers.ts`
- Test: `app/tests/tiers.test.ts`

- [ ] **Step 1: Write failing test**

Create `app/tests/tiers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTier, TIER_ORDER } from '../src/lib/tiers';

describe('getTier', () => {
  it('maps VP/AVP directly', () => {
    expect(getTier('VP')).toBe('VP');
    expect(getTier('AVP')).toBe('AVP');
  });

  it('maps all Associate sub-tiers to Associate', () => {
    expect(getTier('Associate 1')).toBe('Associate');
    expect(getTier('Associate 2')).toBe('Associate');
    expect(getTier('Associate 3')).toBe('Associate');
  });

  it('maps Analyst', () => {
    expect(getTier('Analyst')).toBe('Analyst');
  });

  it('maps unknown designations to Analyst', () => {
    expect(getTier('Intern')).toBe('Analyst');
    expect(getTier('')).toBe('Analyst');
  });

  it('exports TIER_ORDER in expected order', () => {
    expect(TIER_ORDER).toEqual(['VP', 'AVP', 'Associate', 'Analyst']);
  });
});
```

- [ ] **Step 2: Run — expect failure (module not found)**

Run: `cd app && pnpm test:run tests/tiers.test.ts`
Expected: import fails.

- [ ] **Step 3: Implement**

Create `app/src/lib/tiers.ts`:
```ts
export type Tier = 'VP' | 'AVP' | 'Associate' | 'Analyst';

export const TIER_ORDER: Tier[] = ['VP', 'AVP', 'Associate', 'Analyst'];

export function getTier(designation: string): Tier {
  if (designation === 'VP') return 'VP';
  if (designation === 'AVP') return 'AVP';
  if (designation.startsWith('Associate')) return 'Associate';
  if (designation === 'Analyst') return 'Analyst';
  return 'Analyst';  // fallback
}
```

- [ ] **Step 4: Run — expect pass**

Run: `cd app && pnpm test:run tests/tiers.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/tiers.ts app/tests/tiers.test.ts
git commit -m "feat(tiers): add designation tier grouping helper"
```

### Task 8.2: Monthly view blends live cycle data

**Files:**
- Modify: `app/src/app/dashboard/page.tsx` or wherever monthly data is assembled for DashboardView

- [ ] **Step 1: Read current monthly data assembly**

Open `app/src/app/dashboard/page.tsx`. Find where snapshots are loaded and grouped by month.

- [ ] **Step 2: Add live submissions into the same data structure when a cycle is collecting**

After loading snapshots:
```ts
import { submissions, cycles } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';

const [activeCycle] = await db
  .select().from(cycles)
  .where(eq(cycles.status, 'collecting'))
  .orderBy(desc(cycles.createdAt))
  .limit(1);

if (activeCycle) {
  const activeSubs = await db
    .select().from(submissions)
    .where(eq(submissions.cycleId, activeCycle.id));

  // Group active submissions by fellowRecordId, compute pseudo-snapshot
  const byFellow = new Map<string, typeof activeSubs>();
  for (const s of activeSubs.filter(s => s.isSelfReport)) {
    const list = byFellow.get(s.fellowRecordId) ?? [];
    list.push(s);
    byFellow.set(s.fellowRecordId, list);
  }

  for (const [fellowId, subs] of byFellow) {
    const totalHpw = subs.reduce((sum, s) => sum + (s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK), 0);
    const pseudoSnapshot = {
      fellowRecordId: fellowId,
      cycleId: activeCycle.id,
      snapshotDate: activeCycle.startDate,
      totalHoursPerWeek: totalHpw,
      hoursUtilizationPct: totalHpw / 84,
      isPseudo: true,
    };
    // Append to the data structure the dashboard uses for monthly averaging.
    // Adjust shape to match existing snapshots. Keep only fields the dashboard reads.
  }
}
```

(Exact fields to fill depend on existing dashboard structure — ensure it averages correctly with real snapshots in the same month.)

- [ ] **Step 3: Manual verification**

During an active cycle with at least 1 submission, open `/dashboard` — monthly row for that fellow reflects live data.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/dashboard/
git commit -m "feat(dashboard): blend active cycle submissions into monthly view"
```

### Task 8.3: Always show Latest Cycle section

**Files:**
- Modify: `app/src/app/dashboard/DashboardView.tsx`

- [ ] **Step 1: Find the conditional that hides the live section**

Grep in DashboardView.tsx for the condition that checks cycle status.

- [ ] **Step 2: Remove the hide condition, make section always render**

Change the conditional so the Latest Cycle table:
- Always renders.
- Title includes "Week of [cycle.startDate]" + either "— [N of M] submitted" (collecting) or "— finalized" (complete).
- Data source: if cycle.status === 'collecting', use submissions aggregation. If 'complete', use that cycle's snapshots.

Rough shape:
```tsx
<section>
  <h2>Latest cycle — Week of {latestCycle.startDate}
    {latestCycle.status === 'collecting' ? ` — ${submittedCount} of ${totalCount} submitted` : ' — finalized'}
  </h2>
  <LiveCycleTable cycle={latestCycle} data={latestCycleData} />
</section>
```

- [ ] **Step 3: Manual verification**

Load `/dashboard` when no active cycle exists — section should still show the last finalized cycle.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/dashboard/DashboardView.tsx
git commit -m "feat(dashboard): always show Latest Cycle section (no hide after finalization)"
```

### Task 8.4: Section reorder — Monthly top, Latest Cycle middle

**Files:**
- Modify: `app/src/app/dashboard/DashboardView.tsx`

- [ ] **Step 1: Reorder the JSX**

Move the Monthly Report block above the Latest Cycle block. Final order:
1. Monthly Report
2. Latest Cycle
3. (Person drill-down lives in-place via click — unchanged)

- [ ] **Step 2: Manual verification**

Load `/dashboard`. Monthly should be at the top of the page, Latest Cycle below.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/dashboard/DashboardView.tsx
git commit -m "feat(dashboard): reorder sections — Monthly at top, Latest Cycle below"
```

### Task 8.5: Tier grouping in Monthly view

**Files:**
- Modify: `app/src/app/dashboard/DashboardView.tsx`

- [ ] **Step 1: Import tier helper**

Add to DashboardView.tsx:
```tsx
import { getTier, TIER_ORDER, type Tier } from '@/lib/tiers';
```

- [ ] **Step 2: Group fellows by tier**

Where the Monthly table is built, compute grouped rows:
```tsx
const groupedFellows = new Map<Tier, typeof fellows>();
for (const f of sortedFellows) {
  const t = getTier(f.designation);
  const list = groupedFellows.get(t) ?? [];
  list.push(f);
  groupedFellows.set(t, list);
}
```

- [ ] **Step 3: Track expanded state per tier (localStorage)**

```tsx
const [expanded, setExpanded] = useState<Record<Tier, boolean>>(() => {
  if (typeof window === 'undefined') return { VP: true, AVP: true, Associate: true, Analyst: true };
  const raw = localStorage.getItem('utilmis.monthlyTierState');
  if (!raw) return { VP: true, AVP: true, Associate: true, Analyst: true };
  try { return { VP: true, AVP: true, Associate: true, Analyst: true, ...JSON.parse(raw) }; }
  catch { return { VP: true, AVP: true, Associate: true, Analyst: true }; }
});

useEffect(() => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('utilmis.monthlyTierState', JSON.stringify(expanded));
  }
}, [expanded]);

function toggleTier(t: Tier) {
  setExpanded(prev => ({ ...prev, [t]: !prev[t] }));
}
```

- [ ] **Step 4: Render tier headers with collapse**

Replace the flat Monthly rows with tier-grouped rendering:
```tsx
{TIER_ORDER.map(tier => {
  const list = groupedFellows.get(tier) ?? [];
  if (list.length === 0) return null;
  return (
    <div key={tier}>
      <button className="w-full text-left font-semibold bg-gray-100 px-3 py-2 flex items-center gap-2" onClick={() => toggleTier(tier)}>
        <span>{expanded[tier] ? '▾' : '▸'}</span>
        <span>{tier} ({list.length})</span>
      </button>
      {expanded[tier] && (
        <table>...existing row rendering for list...</table>
      )}
    </div>
  );
})}
```

- [ ] **Step 5: Manual verification**

Load `/dashboard`. Expand/collapse each tier. Refresh — state persists.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/dashboard/DashboardView.tsx
git commit -m "feat(dashboard): tier grouping for Monthly view with collapsible headers + localStorage"
```

### Task 8.6: Sort persistence for Latest Cycle

**Files:**
- Modify: `app/src/app/dashboard/DashboardView.tsx`

- [ ] **Step 1: Find existing sort toggle**

Grep for `Designation` and `Load` in DashboardView.tsx — this is the existing toggle.

- [ ] **Step 2: Persist to localStorage**

Replace the `useState` for sort:
```tsx
const [liveSort, setLiveSort] = useState<'designation' | 'load'>(() => {
  if (typeof window === 'undefined') return 'designation';
  const raw = localStorage.getItem('utilmis.liveCycleSort');
  return raw === 'load' ? 'load' : 'designation';
});

useEffect(() => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('utilmis.liveCycleSort', liveSort);
  }
}, [liveSort]);
```

- [ ] **Step 3: Manual verification**

Flip the toggle in Latest Cycle section. Refresh — the last choice persists.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/dashboard/DashboardView.tsx
git commit -m "feat(dashboard): persist Latest Cycle sort choice in localStorage"
```

---

## Phase 9 — Final verification + deploy

### Task 9.1: Run all tests

- [ ] **Step 1: Full test run**

Run: `cd app && pnpm test:run`
Expected: All tests pass. Prior count was 85; after this plan expect ~100+.

### Task 9.2: Manual end-to-end check (pre-deploy)

- [ ] **Step 1: Start dev server**

Run: `cd app && pnpm dev`
Expected: server running at http://localhost:3000.

- [ ] **Step 2: Force-start a test cycle**

Using admin/force flags and TEST_EMAIL_OVERRIDE, trigger a cycle with a 1-2 fellow scope. Verify:
- Collection email sends with correct "Week of" dating
- Submit form shows projects including VP-run if applicable
- "Add Project" flow works: create one, verify Slack + DB rows
- Conflict creation on a test mandate works
- Trigger `/api/cron/conflict-reminders` manually with CRON_SECRET — verify threaded reminder email sends
- Dashboard shows Monthly at top with tier groups, Latest Cycle below

### Task 9.3: Deploy to production

- [ ] **Step 1: Push to main**

Run: `git push origin main`
Expected: Vercel auto-deploys.

- [ ] **Step 2: Verify env var on production**

Run: `cd app && vercel-ie env ls` — confirm `DISABLE_AIRTABLE_WRITEBACK=true` in production.

- [ ] **Step 3: Verify crons registered**

In Vercel dashboard → Project → Crons, confirm all 3 crons visible:
- `start-cycle` at `30 3 * * 1`
- `send-reminders` at `30 3 * * 2-5`
- `conflict-reminders` at `30 4 * * *`

- [ ] **Step 4: Verify schema on production Neon**

Use Neon console SQL editor to confirm new tables and columns exist.

### Task 9.4: Update PROGRESS TRACKER + MEMORY

**Files:**
- Modify: `PROGRESS TRACKER.md`
- Modify: `MEMORY.md`

- [ ] **Step 1: Propose updates to user**

Per the project's CLAUDE.md rules, never write to these files without explicit user approval. At end of execution, propose:

- PROGRESS TRACKER: activity log entry for v2 ship, workstream updates for v2 phases, Upcoming Milestones update for April 27 first weekly cycle.
- MEMORY: new decisions (weekly cadence effective April 27, Airtable writeback paused, ad-hoc project workflow).

Wait for user approval before writing.

---

## Plan-level notes

- **Commit discipline**: one commit per task (not per step). Each commit should leave the tree green (tests pass, type-checks clean).
- **No backwards-compat bloat**: when gating old behavior (weekly vs biweekly, writeback), use env vars or one-line comments, not full feature flag systems.
- **UI changes (Phase 6.4, 7.4, 8.x)**: some are hard to TDD. Manual verification steps are called out. Prefer React Testing Library + jsdom if you want to lock behavior later, but not required for v2.
- **Deploy order matters**: Phase 1 (schema) must go to Neon before any deploy that uses new tables. Phase 4 env var must be set before next cycle start to avoid Airtable writes.
- **April 27 deadline**: target deploy date is April 26 or morning of April 27 before 09:00 IST.
