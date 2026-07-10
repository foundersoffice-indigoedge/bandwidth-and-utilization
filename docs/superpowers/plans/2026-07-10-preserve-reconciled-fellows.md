# Preserve Reconciled Fellows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep submitted fellows visible at 0 current hours when every submitted project is excluded by live Airtable reconciliation, and preserve the adjustment explanation after finalization.

**Architecture:** Extend live reconciliation to return both surviving submissions and an exclusion count. A pure utilization builder will convert that result into the shared 0-hour or active-load calculation used by the live dashboard and cycle finalization. Store the exclusion count on snapshots so live, finalized, and historical weekly views carry the same explanation.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, Neon Postgres, Vitest, Tailwind CSS.

## Global Constraints

- Keep current reconciliation rules intact: current utilization excludes projects that are inactive, deleted, or no longer assigned to the fellow.
- Keep a submitted fellow visible when all submitted projects are excluded.
- Show 0 hours per week, 0% utilization, `Free`, and 0 active projects when no submitted project survives.
- Preserve `excludedProjectCount` in finalized snapshots and historical weekly drill-downs.
- Fellows with 0 raw self-reports remain absent from snapshot creation.
- Mid-cycle `pending_` projects remain included.
- Peer bandwidth email behavior stays unchanged.
- Historical utilization calculations continue to read stored snapshots.
- Use a hand-authored migration. The repository's Drizzle journal currently stops at `0007`; `0008_remarks_lifecycle.sql` was also applied directly.
- Apply the production migration before deploying code that writes `excluded_project_count`.
- Follow the repository Voice DNA for user-facing dashboard copy. Don't use em dashes.

---

## File Map

- `app/src/lib/airtable/projects.ts`: expose reconciliation metadata while retaining the existing array-only compatibility function.
- `app/src/lib/reconciled-utilization.ts`: own the pure submitted-versus-reconciled utilization calculation shared by dashboard assembly and finalization.
- `app/src/lib/db/schema.ts`: map the durable snapshot exclusion count.
- `app/drizzle/0009_snapshot_excluded_project_count.sql`: add the production database column safely.
- `app/src/lib/cycle.ts`: create snapshots and completion summaries for submitted fellows even when 0 projects survive.
- `app/src/app/dashboard/page.tsx`: carry exclusion metadata through live rows, finalized rows, stored snapshots, and active-cycle pseudo-snapshots.
- `app/src/lib/dashboard-reconciliation.ts`: own singular and plural adjustment copy.
- `app/src/app/dashboard/DashboardView.tsx`: render the adjusted badge and live/historical explanations.
- `app/tests/filter-live-self-reports.test.ts`: prove reconciliation metadata behavior.
- `app/tests/reconciled-utilization.test.ts`: prove 0-hour preservation and ordinary utilization behavior.
- `app/tests/dashboard-reconciliation.test.ts`: prove singular and plural copy.

---

### Task 1: Return reconciliation metadata

**Files:**
- Modify: `app/src/lib/airtable/projects.ts:115-143`
- Modify: `app/tests/filter-live-self-reports.test.ts`

**Interfaces:**
- Produces: `LiveReconciliation<T> { submissions: T[]; excludedProjectCount: number }`
- Produces: `reconcileLiveSelfReports<T>(selfReports, activeProjects, fellowRecordId, fellowDesignation): LiveReconciliation<T>`
- Preserves: `filterLiveSelfReports<T>(...): T[]`

- [ ] **Step 1: Add failing metadata tests**

Add `reconcileLiveSelfReports` to the existing import and add these cases:

```ts
import {
  filterLiveSelfReports,
  reconcileLiveSelfReports,
} from '../src/lib/airtable/projects';

it('returns an exclusion count when every submitted project is inactive or removed', () => {
  const result = reconcileLiveSelfReports(
    [sub('recInactive')],
    active,
    'recMe',
    'Associate 1',
  );

  expect(result.submissions).toEqual([]);
  expect(result.excludedProjectCount).toBe(1);
});

it('counts only excluded projects in a mixed batch', () => {
  const result = reconcileLiveSelfReports(
    [sub('recOnAsAssoc'), sub('recInactive'), sub('pending_x')],
    active,
    'recMe',
    'Associate 1',
  );

  expect(result.submissions.map(s => s.projectRecordId)).toEqual([
    'recOnAsAssoc',
    'pending_x',
  ]);
  expect(result.excludedProjectCount).toBe(1);
});

it('does not count a pending project as excluded', () => {
  const result = reconcileLiveSelfReports(
    [sub('pending_x')],
    active,
    'recMe',
    'Associate 1',
  );

  expect(result.excludedProjectCount).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
cd app && pnpm test:run tests/filter-live-self-reports.test.ts
```

Expected: FAIL because `reconcileLiveSelfReports` isn't exported.

- [ ] **Step 3: Implement the metadata-returning helper**

Add this interface and function above the existing compatibility wrapper:

```ts
export interface LiveReconciliation<T> {
  submissions: T[];
  excludedProjectCount: number;
}

export function reconcileLiveSelfReports<T extends { projectRecordId: string }>(
  selfReports: T[],
  activeProjects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string,
): LiveReconciliation<T> {
  const onIds = new Set(
    getProjectsForFellow(activeProjects, fellowRecordId, fellowDesignation)
      .map(p => p.projectRecordId),
  );
  const submissions = selfReports.filter(
    s => s.projectRecordId.startsWith('pending_') || onIds.has(s.projectRecordId),
  );

  return {
    submissions,
    excludedProjectCount: selfReports.length - submissions.length,
  };
}
```

Rewrite `filterLiveSelfReports` as a compatibility wrapper:

```ts
export function filterLiveSelfReports<T extends { projectRecordId: string }>(
  selfReports: T[],
  activeProjects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string,
): T[] {
  return reconcileLiveSelfReports(
    selfReports,
    activeProjects,
    fellowRecordId,
    fellowDesignation,
  ).submissions;
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run:

```bash
cd app && pnpm test:run tests/filter-live-self-reports.test.ts
```

Expected: all reconciliation tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add app/src/lib/airtable/projects.ts app/tests/filter-live-self-reports.test.ts
git commit -m "refactor(utilization): expose reconciliation metadata"
```

---

### Task 2: Build submitted-fellow utilization from reconciliation

**Files:**
- Create: `app/src/lib/reconciled-utilization.ts`
- Create: `app/tests/reconciled-utilization.test.ts`

**Interfaces:**
- Consumes: `reconcileLiveSelfReports`
- Produces: `ReconciledSubmission` structural input type
- Produces: `ReconciledUtilization<T>`
- Produces: `buildReconciledUtilization<T>(rawSelfReports, activeProjects, fellowRecordId, fellowDesignation): ReconciledUtilization<T> | null`

- [ ] **Step 1: Write failing tests for presence and calculation rules**

Create `app/tests/reconciled-utilization.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildReconciledUtilization } from '../src/lib/reconciled-utilization';
import type { ProjectAssignment } from '../src/types';

const activeProjects: ProjectAssignment[] = [{
  projectRecordId: 'recActive',
  projectName: 'Active Mandate',
  projectType: 'mandate',
  stage: 'Mandate Signed',
  vpAvpIds: [],
  associateIds: ['recMe'],
  directorIds: [],
}];

const sub = (projectRecordId: string, hoursPerWeek: number) => ({
  projectRecordId,
  projectName: projectRecordId,
  projectType: 'mandate' as const,
  hoursPerDay: hoursPerWeek / 6,
  hoursPerWeek,
});

describe('buildReconciledUtilization', () => {
  it('returns null when the fellow has no raw self-report', () => {
    expect(buildReconciledUtilization(
      [], activeProjects, 'recMe', 'Associate 1',
    )).toBeNull();
  });

  it('preserves a submitted fellow at zero when every project is excluded', () => {
    const result = buildReconciledUtilization(
      [sub('recInactive', 60)],
      activeProjects,
      'recMe',
      'Associate 1',
    );

    expect(result).toMatchObject({
      totalHoursPerWeek: 0,
      hoursUtilizationPct: 0,
      loadTag: 'Free',
      excludedProjectCount: 1,
      submissions: [],
    });
  });

  it('calculates load from surviving projects and counts exclusions', () => {
    const result = buildReconciledUtilization(
      [sub('recActive', 24), sub('recInactive', 60)],
      activeProjects,
      'recMe',
      'Associate 1',
    );

    expect(result?.submissions.map(s => s.projectRecordId)).toEqual(['recActive']);
    expect(result?.totalHoursPerWeek).toBe(24);
    expect(result?.hoursUtilizationPct).toBeCloseTo(24 / 84, 4);
    expect(result?.loadTag).toBe('Comfortable');
    expect(result?.excludedProjectCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
cd app && pnpm test:run tests/reconciled-utilization.test.ts
```

Expected: FAIL because `src/lib/reconciled-utilization.ts` doesn't exist.

- [ ] **Step 3: Implement the shared pure builder**

Create `app/src/lib/reconciled-utilization.ts`:

```ts
import { reconcileLiveSelfReports } from '@/lib/airtable/projects';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import { calculateHoursUtilization, getLoadTag } from '@/lib/utilization';
import type { LoadTag, ProjectAssignment } from '@/types';

export interface ReconciledSubmission {
  projectRecordId: string;
  hoursPerDay: number;
  hoursPerWeek: number | null;
}

export interface ReconciledUtilization<T> {
  submissions: T[];
  excludedProjectCount: number;
  totalHoursPerWeek: number;
  hoursUtilizationPct: number;
  loadTag: LoadTag;
}

export function buildReconciledUtilization<T extends ReconciledSubmission>(
  rawSelfReports: T[],
  activeProjects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string,
): ReconciledUtilization<T> | null {
  if (rawSelfReports.length === 0) return null;

  const { submissions, excludedProjectCount } = reconcileLiveSelfReports(
    rawSelfReports,
    activeProjects,
    fellowRecordId,
    fellowDesignation,
  );
  const totalHoursPerWeek = submissions.reduce(
    (sum, submission) => sum + (
      submission.hoursPerWeek ?? submission.hoursPerDay * WORKING_DAYS_PER_WEEK
    ),
    0,
  );
  const hoursUtilizationPct = calculateHoursUtilization(totalHoursPerWeek);

  return {
    submissions,
    excludedProjectCount,
    totalHoursPerWeek,
    hoursUtilizationPct,
    loadTag: getLoadTag(hoursUtilizationPct),
  };
}
```

- [ ] **Step 4: Run focused reconciliation and utilization tests**

Run:

```bash
cd app && pnpm test:run tests/filter-live-self-reports.test.ts tests/reconciled-utilization.test.ts
```

Expected: both test files pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add app/src/lib/reconciled-utilization.ts app/tests/reconciled-utilization.test.ts
git commit -m "feat(utilization): preserve submitted fellows at zero load"
```

---

### Task 3: Persist adjusted snapshots during finalization

**Files:**
- Create: `app/drizzle/0009_snapshot_excluded_project_count.sql`
- Modify: `app/src/lib/db/schema.ts:88-100`
- Modify: `app/src/lib/cycle.ts:209-280`
- Create: `app/tests/snapshot-schema.test.ts`

**Interfaces:**
- Consumes: `buildReconciledUtilization`
- Produces: `snapshots.excludedProjectCount: number`
- Produces: snapshot rows for every fellow with at least 1 raw self-report

- [ ] **Step 1: Write a failing snapshot-schema test**

Create `app/tests/snapshot-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { snapshots } from '../src/lib/db/schema';

describe('snapshots schema', () => {
  it('stores the durable excluded-project count', () => {
    const columns = getTableColumns(snapshots);
    expect(columns.excludedProjectCount?.name).toBe('excluded_project_count');
    expect(columns.excludedProjectCount?.notNull).toBe(true);
    expect(columns.excludedProjectCount?.hasDefault).toBe(true);
  });
});
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run:

```bash
cd app && pnpm test:run tests/snapshot-schema.test.ts
```

Expected: FAIL because `snapshots.excludedProjectCount` doesn't exist.

- [ ] **Step 3: Add the hand-authored database migration**

Create `app/drizzle/0009_snapshot_excluded_project_count.sql`:

```sql
ALTER TABLE "snapshots"
ADD COLUMN IF NOT EXISTS "excluded_project_count" integer NOT NULL DEFAULT 0;
```

Do not edit `app/drizzle/meta/_journal.json`. This repository applies post-`0004` hand-authored migrations directly because the journal has drifted from the production sequence.

- [ ] **Step 4: Add the Drizzle schema field**

In `app/src/lib/db/schema.ts`, add this field to `snapshots`:

```ts
excludedProjectCount: integer('excluded_project_count').notNull().default(0),
```

- [ ] **Step 5: Route finalization through the shared builder**

Replace the current `filterLiveSelfReports` call, empty-array `continue`, and duplicated utilization calculation in `finalizeCycle` with:

```ts
const rawSelfReports = allSubmissions.filter(
  submission => submission.fellowRecordId === fellow.recordId && submission.isSelfReport,
);
const utilization = buildReconciledUtilization(
  rawSelfReports,
  allProjects,
  fellow.recordId,
  fellow.designation,
);
if (!utilization) continue;

const {
  submissions: fellowSubs,
  excludedProjectCount,
  totalHoursPerWeek: totalHpw,
  hoursUtilizationPct: hoursUtilPct,
  loadTag: hoursTag,
} = utilization;
```

Add this value to the snapshot insert:

```ts
excludedProjectCount,
```

Keep the existing project-breakdown mapping and completion-summary mapping. They will naturally produce 0 projects and 0 current hours when `fellowSubs` is empty.

Update imports:

```ts
import { fetchAllProjects, getProjectsForFellow } from '@/lib/airtable/projects';
import { buildReconciledUtilization } from '@/lib/reconciled-utilization';
```

Remove finalization-only imports that become unused after the shared builder owns the calculation.

- [ ] **Step 6: Run focused tests and TypeScript**

Run:

```bash
cd app && pnpm test:run tests/filter-live-self-reports.test.ts tests/reconciled-utilization.test.ts tests/snapshot-schema.test.ts tests/hours-integration.test.ts
cd app && pnpm exec tsc --noEmit
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 7: Inspect the migration and schema diff**

Run:

```bash
git diff --check
git diff -- app/drizzle/0009_snapshot_excluded_project_count.sql app/src/lib/db/schema.ts app/src/lib/cycle.ts
```

Expected: one additive column, one shared-builder integration, and no journal edit.

- [ ] **Step 8: Commit Task 3**

```bash
git add app/drizzle/0009_snapshot_excluded_project_count.sql app/src/lib/db/schema.ts app/src/lib/cycle.ts app/tests/snapshot-schema.test.ts
git commit -m "feat(utilization): persist reconciled zero-load snapshots"
```

---

### Task 4: Carry adjustment metadata through dashboard data assembly

**Files:**
- Modify: `app/src/app/dashboard/page.tsx:20-45`
- Modify: `app/src/app/dashboard/page.tsx:96-140`
- Modify: `app/src/app/dashboard/page.tsx:198-249`
- Modify: `app/src/app/dashboard/page.tsx:286-321`

**Interfaces:**
- Consumes: `buildReconciledUtilization`
- Extends: `SnapshotData.excludedProjectCount: number`
- Extends: `LiveFellowData.excludedProjectCount: number`
- Preserves: pending-token and submitted-token counts

- [ ] **Step 1: Extend dashboard data interfaces**

Add this required field to both `SnapshotData` and `LiveFellowData`:

```ts
excludedProjectCount: number;
```

- [ ] **Step 2: Serialize finalized snapshot metadata**

In `getLatestFinalizedCycleData`, add:

```ts
excludedProjectCount: s.excludedProjectCount,
```

In the IY snapshot serialization, add the same field:

```ts
excludedProjectCount: s.excludedProjectCount,
```

- [ ] **Step 3: Route live dashboard calculation through the shared builder**

Inside the submitted-token map, replace direct filtering and duplicated utilization calculation with:

```ts
const rawSelfReports = subsByFellow.get(t.fellowRecordId) || [];
const utilization = buildReconciledUtilization(
  rawSelfReports,
  allProjects,
  t.fellowRecordId,
  t.fellowDesignation,
);
if (!utilization) return null;

const {
  submissions: fellowSubs,
  excludedProjectCount,
  totalHoursPerWeek: totalHpw,
  hoursUtilizationPct: utilPct,
  loadTag: tag,
} = utilization;
```

Add `excludedProjectCount` to the returned `LiveFellowData` object. Keep conflict flags, remarks, and project breakdown based on `fellowSubs`.

- [ ] **Step 4: Carry metadata into the active-cycle pseudo-snapshot**

Add:

```ts
excludedProjectCount: f.excludedProjectCount,
```

This makes the fellow appear in the current IY monthly overview even when the active project breakdown is empty.

- [ ] **Step 5: Clean imports and run TypeScript**

Use:

```ts
import { fetchAllProjects } from '@/lib/airtable/projects';
import { buildReconciledUtilization } from '@/lib/reconciled-utilization';
```

Run:

```bash
cd app && pnpm exec tsc --noEmit
```

Expected: TypeScript exits 0 after every required data shape carries `excludedProjectCount`.

- [ ] **Step 6: Commit Task 4**

```bash
git add app/src/app/dashboard/page.tsx
git commit -m "feat(dashboard): retain adjusted fellows in data assembly"
```

---

### Task 5: Render adjusted state in live and historical views

**Files:**
- Create: `app/src/lib/dashboard-reconciliation.ts`
- Create: `app/tests/dashboard-reconciliation.test.ts`
- Modify: `app/src/app/dashboard/DashboardView.tsx:390-490`
- Modify: `app/src/app/dashboard/DashboardView.tsx:618-733`

**Interfaces:**
- Produces: `formatExcludedProjectsNotice(count: number): string`
- Consumes: `SnapshotData.excludedProjectCount`
- Consumes: `LiveFellowData.excludedProjectCount`

- [ ] **Step 1: Write failing copy tests**

Create `app/tests/dashboard-reconciliation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatExcludedProjectsNotice } from '../src/lib/dashboard-reconciliation';

describe('formatExcludedProjectsNotice', () => {
  it('uses singular wording for one excluded project', () => {
    expect(formatExcludedProjectsNotice(1)).toBe(
      '1 submitted project was excluded because its Airtable stage or team assignment changed after submission.',
    );
  });

  it('uses plural wording for multiple excluded projects', () => {
    expect(formatExcludedProjectsNotice(2)).toBe(
      '2 submitted projects were excluded because their Airtable stage or team assignment changed after submission.',
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
cd app && pnpm test:run tests/dashboard-reconciliation.test.ts
```

Expected: FAIL because `dashboard-reconciliation.ts` doesn't exist.

- [ ] **Step 3: Implement the copy helper**

Create `app/src/lib/dashboard-reconciliation.ts`:

```ts
export function formatExcludedProjectsNotice(count: number): string {
  if (count === 1) {
    return '1 submitted project was excluded because its Airtable stage or team assignment changed after submission.';
  }
  return `${count} submitted projects were excluded because their Airtable stage or team assignment changed after submission.`;
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run:

```bash
cd app && pnpm test:run tests/dashboard-reconciliation.test.ts
```

Expected: both copy tests pass.

- [ ] **Step 5: Add the Latest Cycle adjusted badge**

Import the helper:

```ts
import { formatExcludedProjectsNotice } from '@/lib/dashboard-reconciliation';
```

Beside the existing conflict badge in each fellow-name cell, add:

```tsx
{f.excludedProjectCount > 0 && (
  <span
    className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded"
    title={formatExcludedProjectsNotice(f.excludedProjectCount)}
  >
    adjusted
  </span>
)}
```

- [ ] **Step 6: Add the live drill-down callout**

Above `ProjectBreakdownTable`, add:

```tsx
{fellow.excludedProjectCount > 0 && (
  <div className="mb-4 border-l-4 border-amber-400 bg-amber-50 rounded-r-md p-3 text-sm text-gray-800">
    {formatExcludedProjectsNotice(fellow.excludedProjectCount)}
  </div>
)}
```

- [ ] **Step 7: Add the historical weekly callout**

Inside the expanded week breakdown row, above `ProjectBreakdownTable`, add:

```tsx
{weekSnap.excludedProjectCount > 0 && (
  <div className="mb-3 border-l-4 border-amber-400 bg-amber-50 rounded-r-md p-3 text-sm text-gray-800">
    {formatExcludedProjectsNotice(weekSnap.excludedProjectCount)}
  </div>
)}
```

`ProjectBreakdownTable` already returns `null` for an empty array. Leave that function unchanged. An all-excluded week therefore renders the callout by itself without an empty table header.

- [ ] **Step 8: Run focused tests and TypeScript**

Run:

```bash
cd app && pnpm test:run tests/dashboard-reconciliation.test.ts tests/filter-live-self-reports.test.ts tests/reconciled-utilization.test.ts
cd app && pnpm exec tsc --noEmit
```

Expected: focused tests pass and TypeScript exits 0.

- [ ] **Step 9: Commit Task 5**

```bash
git add app/src/lib/dashboard-reconciliation.ts app/tests/dashboard-reconciliation.test.ts app/src/app/dashboard/DashboardView.tsx
git commit -m "feat(dashboard): explain reconciled utilization adjustments"
```

---

### Task 6: Full verification and release handoff

**Files:**
- Verify: all changed files from Tasks 1 through 5
- No production mutation during this task

**Interfaces:**
- Verifies: test suite, TypeScript, lint, build, migration safety, and Kabir reproduction
- Produces: exact production migration and deployment handoff

- [ ] **Step 1: Run the full test suite**

Run:

```bash
cd app && pnpm test:run
```

Expected: 0 failing tests.

- [ ] **Step 2: Run TypeScript, lint, and build**

Run:

```bash
cd app && pnpm exec tsc --noEmit
cd app && pnpm lint
cd app && pnpm build
```

Expected: all commands exit 0. Record any existing warnings separately from new failures.

- [ ] **Step 3: Review the complete implementation diff**

Run:

```bash
git diff --check HEAD~5..HEAD
git diff --stat HEAD~5..HEAD
git status --short --branch
```

Expected: only the planned application, test, migration, spec, and plan files are present. The worktree is clean after task commits.

- [ ] **Step 4: Verify the Kabir case with a read-only local reproduction**

Use the pure builder with:

```ts
rawSelfReports = [{
  projectRecordId: 'recoUlhAwv3r2s1z1',
  hoursPerDay: 10,
  hoursPerWeek: 60,
}]
activeProjects = []
fellowRecordId = 'recw4Mz4ysswW9Qo1'
fellowDesignation = 'Associate 1'
```

Expected result:

```ts
{
  submissions: [],
  excludedProjectCount: 1,
  totalHoursPerWeek: 0,
  hoursUtilizationPct: 0,
  loadTag: 'Free',
}
```

- [ ] **Step 5: Prepare the production migration command and stop for approval**

The migration SQL is:

```sql
ALTER TABLE "snapshots"
ADD COLUMN IF NOT EXISTS "excluded_project_count" integer NOT NULL DEFAULT 0;
```

Report the verified implementation state and ask Ajder for explicit approval before applying the Neon migration, pushing, or deploying.

- [ ] **Step 6: Commit any verification-only corrections**

If verification required a source correction, rerun the relevant failing test first, apply the minimal fix, rerun the complete verification set, and commit with a focused message. Skip this step when the worktree is already clean.

---

## Release Sequence After Explicit Approval

1. Apply `app/drizzle/0009_snapshot_excluded_project_count.sql` directly to production Neon.
2. Push the verified commits to `origin/main` using the IE Central account configuration already attached to this repository.
3. Confirm the Git-triggered Vercel production deployment reaches READY.
4. Open the production dashboard.
5. Confirm Kabir Thakwani appears in the cycle beginning 2026-07-06 with 0.0 hours per week, 0%, `Free`, 0 active projects, and the `adjusted` badge.
6. Open Kabir's drill-down and confirm the 1-project exclusion explanation.
7. Confirm the submission count still includes Kabir.
8. Confirm at least 1 fellow with surviving active projects remains unchanged.
9. After cycle finalization, confirm Kabir remains visible in the stored weekly drill-down with the same explanation.
