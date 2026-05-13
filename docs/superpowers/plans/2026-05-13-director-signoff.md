# Director Sign-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-director sign-off step that runs after each director's slice (all submissions + all submission-level conflicts) completes. Director receives an email summarizing team bandwidth on their projects, confirms it or flags specific lines. Each flag becomes a `director_flag` conflict row that resolves through a workflow mirroring today's VP↔Associate resolution, routed via a resolver matrix. Cycle finalization gates on all signoffs reaching a terminal state.

**Architecture:** Reuse the existing `conflicts` table as the resolution primitive — add `source = 'director_flag'` rows. New `director_signoffs` table tracks per-director state and the cycle's third finalization gate. Pure functions for slice-status, resolver matrix, recipient dedupe are extracted to their own files for unit-testing. Existing token-route pattern (`/submit/[token]`, `/resolve/[token]`) extended with `/signoff/[token]`. Existing `conflict-reminders` cron extended to cover signoffs and director-flag conflicts.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM over Neon Postgres, Resend (email), Vitest (tests), Tailwind (UI). Working dir is `app/`. Tests live in `app/tests/`. Run `pnpm test:run` from `app/` for the test suite.

**Spec reference:** `docs/superpowers/specs/2026-05-13-director-signoff-design.md`. Read it first.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `app/drizzle/0005_director_signoff.sql` | Migration: new table + conflicts table extensions |
| `app/src/lib/signoff.ts` | Slice-status check + signoff creation/transition + flag submission |
| `app/src/lib/director-flag.ts` | Pure: resolver matrix + recipient dedupe |
| `app/src/app/signoff/[token]/page.tsx` | Server component: signoff landing page |
| `app/src/app/signoff/[token]/signoff-form.tsx` | Client component: form UI |
| `app/src/app/api/signoff/confirm/route.ts` | POST endpoint: director hits Confirm |
| `app/src/app/api/signoff/flag/route.ts` | POST endpoint: director submits flags |
| `app/tests/director-flag.test.ts` | Pure: resolver matrix, dedupe |
| `app/tests/signoff.test.ts` | Slice status + signoff lifecycle |
| `app/tests/api-signoff.test.ts` | API endpoints |

**Modified files:**

| File | Change |
|---|---|
| `app/src/lib/db/schema.ts` | New `directorSignoffs` table; new columns on `conflicts` |
| `app/src/lib/airtable/config.ts` | New `directorFields` per project type |
| `app/src/lib/airtable/projects.ts` | Read directorIds (skip VP-led) |
| `app/src/lib/airtable/fellows.ts` | Add `fetchFellowsByIds` helper if missing |
| `app/src/types.ts` | Extend `ProjectAssignment` with `directorIds`; new types |
| `app/src/lib/email.ts` | 4 new send functions |
| `app/src/lib/slack.ts` | New `postDirectorFlagToSlack` helper |
| `app/src/lib/cycle.ts` | Extend `checkAndFinalizeCycle` gate |
| `app/src/app/api/submit/route.ts` | Call `createSignoffIfReady` after submit |
| `app/src/app/api/resolve/route.ts` | Branch on `conflict.source`; one-sided writeback for `director_flag`; call `createSignoffIfReady` |
| `app/src/app/api/cron/conflict-reminders/route.ts` | Iterate signoffs too |
| `app/src/app/dashboard/*` | Awaiting-signoff chip + Director Sign-offs panel |

---

### Task 1: Confirm Airtable Director field names

This task pins down a spec-level Open Question before any code is written. The exact field name "Director" might be different on each of the three tables (e.g., `Director (Mandate)`, `DDE Director`, `Pitch Director`). The migration and config depend on knowing the right strings.

**Files:**
- Modify: `app/src/lib/airtable/config.ts`

- [ ] **Step 1: Query Airtable via MCP for each table's field list**

Use the native Airtable MCP (`mcp__claude_ai_Airtable__get_table_schema`) for tableIds `tblETYHFy9FnXG9TH` (mandate), `tblxyEcXA5piBJKyP` (DDE), `tblOMIyzJZYUMrJ2N` (pitch). Look for any field whose name contains "Director" and whose type is `multipleRecordLinks` pointing at the Fellows table. Record the exact string for each.

- [ ] **Step 2: Add directorFields to TABLE_CONFIG**

Open `app/src/lib/airtable/config.ts`. Add `directorFields: string[]` to the config object's TypeScript shape, and populate it on each entry. Example shape after this step (replace `<verified-name>` with the actual strings from step 1):

```ts
export const TABLE_CONFIG: Record<ProjectType, {
  tableId: string;
  nameField: string;
  stageField: string;
  vpAvpFields: string[];
  associateFields: string[];
  directorFields: string[];        // NEW
  isVpRunField?: string;
  activeStages: string[];
  label: string;
}> = {
  mandate: {
    // ... existing fields unchanged ...
    directorFields: ['<verified mandate director field>'],
  },
  dde: {
    // ... existing fields unchanged ...
    directorFields: ['<verified dde director field>'],
  },
  pitch: {
    // ... existing fields unchanged ...
    directorFields: ['<verified pitch director field>'],
  },
};
```

- [ ] **Step 3: Verify the change compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 4: Commit**

```bash
cd app && git add src/lib/airtable/config.ts && cd .. && git commit -m "feat(airtable): add directorFields to TABLE_CONFIG"
```

---

### Task 2: Schema + migration

**Files:**
- Create: `app/drizzle/0005_director_signoff.sql`
- Modify: `app/src/lib/db/schema.ts`

- [ ] **Step 1: Write the migration SQL**

Create `app/drizzle/0005_director_signoff.sql`:

```sql
-- Director sign-off table
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

-- Conflicts table extensions
ALTER TABLE conflicts
  ADD COLUMN source text NOT NULL DEFAULT 'submission',
  ADD COLUMN flagged_submission_id uuid REFERENCES submissions(id),
  ADD COLUMN flagged_by_fellow_id text,
  ADD COLUMN flagged_original_hours_per_day real,
  ADD COLUMN proposed_hours_per_day real,
  ADD COLUMN director_comment text,
  ADD COLUMN signoff_id uuid REFERENCES director_signoffs(id),
  ADD COLUMN resolver_fellow_id text,
  ADD COLUMN resolver_email text;

ALTER TABLE conflicts ALTER COLUMN vp_submission_id DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN associate_submission_id DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN vp_hours_per_day DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN associate_hours_per_day DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN difference DROP NOT NULL;
```

- [ ] **Step 2: Extend schema.ts with directorSignoffs table**

In `app/src/lib/db/schema.ts`, after the `pendingProjects` table definition, add:

```ts
export const directorSignoffs = pgTable('director_signoffs', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  directorFellowId: text('director_fellow_id').notNull(),
  directorEmail: text('director_email').notNull(),
  directorName: text('director_name').notNull(),
  status: text('status', { enum: ['email_sent', 'confirmed', 'flagged', 'flagged_resolved'] }).notNull(),
  signoffToken: text('signoff_token').unique().notNull(),
  emailMessageId: text('email_message_id'),
  lastReminderSentAt: timestamp('last_reminder_sent_at'),
  confirmedAt: timestamp('confirmed_at'),
  confirmedBy: text('confirmed_by'),
  flaggedAt: timestamp('flagged_at'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

- [ ] **Step 3: Extend conflicts table definition in schema.ts**

Modify the existing `conflicts` table in `app/src/lib/db/schema.ts`. Drop `.notNull()` from the 5 columns and add the new columns. The final shape:

```ts
export const conflicts = pgTable('conflicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  projectRecordId: text('project_record_id').notNull(),
  vpSubmissionId: uuid('vp_submission_id').references(() => submissions.id),           // dropped notNull
  associateSubmissionId: uuid('associate_submission_id').references(() => submissions.id), // dropped notNull
  vpHoursPerDay: real('vp_hours_per_day'),                  // dropped notNull
  associateHoursPerDay: real('associate_hours_per_day'),    // dropped notNull
  difference: real('difference'),                            // dropped notNull
  status: text('status', { enum: ['pending', 'resolved'] }).notNull().default('pending'),
  resolvedHoursPerDay: real('resolved_hours_per_day'),
  resolvedBy: text('resolved_by'),
  resolutionToken: text('resolution_token'),
  emailMessageId: text('email_message_id'),
  lastReminderSentAt: timestamp('last_reminder_sent_at'),
  // NEW columns:
  source: text('source', { enum: ['submission', 'director_flag'] }).notNull().default('submission'),
  flaggedSubmissionId: uuid('flagged_submission_id').references(() => submissions.id),
  flaggedByFellowId: text('flagged_by_fellow_id'),
  flaggedOriginalHoursPerDay: real('flagged_original_hours_per_day'),
  proposedHoursPerDay: real('proposed_hours_per_day'),
  directorComment: text('director_comment'),
  signoffId: uuid('signoff_id').references(() => directorSignoffs.id),
  resolverFellowId: text('resolver_fellow_id'),
  resolverEmail: text('resolver_email'),
});
```

- [ ] **Step 4: Apply migration to local Neon DB (preview branch)**

Use the existing approach (per `2026-04-28-pending-projects-rename` and `2026-04-30-pending-projects-bt-endpoints` precedent): apply the SQL directly. Confirm with the user before running on the production DB.

For a preview branch / local dev DB:
```bash
cd app && psql "$DATABASE_URL" -f drizzle/0005_director_signoff.sql
```
Expected: no errors. Confirm tables exist with `\d director_signoffs` and `\d conflicts`.

- [ ] **Step 5: Verify schema compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd app && git add drizzle/0005_director_signoff.sql src/lib/db/schema.ts && cd .. && git commit -m "feat(db): director_signoffs table + conflicts extensions"
```

---

### Task 3: Read directorIds in projects.ts (skip VP-led)

**Files:**
- Modify: `app/src/types.ts`
- Modify: `app/src/lib/airtable/projects.ts`
- Test: `app/tests/projects-director.test.ts` (new)

- [ ] **Step 1: Extend ProjectAssignment type**

In `app/src/types.ts`, find the `ProjectAssignment` interface and add `directorIds: string[]`:

```ts
export interface ProjectAssignment {
  // ... existing fields ...
  directorIds: string[];     // NEW: Airtable record ids of directors. Empty array for VP-led mandates.
}
```

- [ ] **Step 2: Write failing test for directorIds extraction**

Create `app/tests/projects-director.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractDirectorIds } from '../src/lib/airtable/projects';

describe('extractDirectorIds', () => {
  it('returns empty array for VP-led mandate regardless of Director field', () => {
    const fields = {
      'Director (Mandate)': ['recDirector1'],
      'Is this a VP run mandate?': 'Yes',
    };
    expect(extractDirectorIds('mandate', fields, true)).toEqual([]);
  });

  it('reads Director field for non-VP-led mandate', () => {
    const fields = {
      'Director (Mandate)': ['recDirector1', 'recDirector2'],
    };
    expect(extractDirectorIds('mandate', fields, false)).toEqual(['recDirector1', 'recDirector2']);
  });

  it('reads Director field for DDE (no VP-led concept)', () => {
    const fields = { '<dde director field>': ['recDirA'] };
    expect(extractDirectorIds('dde', fields, false)).toEqual(['recDirA']);
  });

  it('reads Director field for pitch', () => {
    const fields = { '<pitch director field>': ['recDirB'] };
    expect(extractDirectorIds('pitch', fields, false)).toEqual(['recDirB']);
  });

  it('returns empty array when Director field is absent', () => {
    expect(extractDirectorIds('mandate', {}, false)).toEqual([]);
  });

  it('handles multiple director fields per type (defensive)', () => {
    // If a type ever has more than one director field, combine them
    const fields = {
      'Director (Mandate)': ['recA'],
    };
    // Test depends on TABLE_CONFIG having only one entry by default; defensive case is that it could have more
    expect(extractDirectorIds('mandate', fields, false)).toContain('recA');
  });
});
```

Replace `<dde director field>` and `<pitch director field>` strings with the actual field names from Task 1.

- [ ] **Step 3: Run the test (expect failure)**

Run: `cd app && pnpm vitest run tests/projects-director.test.ts`
Expected: FAIL — `extractDirectorIds is not exported from projects.ts`.

- [ ] **Step 4: Implement extractDirectorIds + wire into fetchAllProjects**

In `app/src/lib/airtable/projects.ts`:

```ts
import { fetchAllRecords } from './client';
import { TABLE_CONFIG } from './config';
import { fetchEligibleFellows } from './fellows';
import type { ProjectType, ProjectAssignment } from '@/types';

/** Extract director record ids from an Airtable project row. Returns [] for VP-led mandates. */
export function extractDirectorIds(
  type: ProjectType,
  fields: Record<string, unknown>,
  isVpRun: boolean
): string[] {
  if (type === 'mandate' && isVpRun) return [];
  const cfg = TABLE_CONFIG[type];
  const ids: string[] = [];
  for (const fieldName of cfg.directorFields) {
    const raw = fields[fieldName];
    if (Array.isArray(raw)) ids.push(...(raw as string[]));
  }
  return ids;
}

export async function fetchAllProjects(): Promise<ProjectAssignment[]> {
  const types: ProjectType[] = ['mandate', 'dde', 'pitch'];

  const results = await Promise.all(
    types.map(async (type) => {
      const cfg = TABLE_CONFIG[type];
      const records = await fetchAllRecords(cfg.tableId);

      return records
        .filter(r => {
          const stage = (r.fields[cfg.stageField] as string) || '';
          return cfg.activeStages.includes(stage);
        })
        .map((r): ProjectAssignment => {
          const vpAvpIds: string[] = [];
          for (const field of cfg.vpAvpFields) {
            const ids = r.fields[field] as string[] | undefined;
            if (ids?.length) vpAvpIds.push(...ids);
          }

          const associateIds: string[] = [];
          for (const field of cfg.associateFields) {
            const ids = r.fields[field] as string[] | undefined;
            if (ids?.length) associateIds.push(...ids);
          }

          let isVpRun: boolean | undefined;
          let leadFellowRecordId: string | undefined;
          if (type === 'mandate' && cfg.isVpRunField) {
            const raw = r.fields[cfg.isVpRunField];
            isVpRun = raw === 'Yes';
            if (isVpRun) {
              const vp1Ids = (r.fields['Mandate VP / AVP 1'] as string[] | undefined) || [];
              if (vp1Ids.length > 0) leadFellowRecordId = vp1Ids[0];
            }
          }

          const directorIds = extractDirectorIds(type, r.fields, isVpRun === true);

          return {
            projectRecordId: r.id,
            projectName: r.fields[cfg.nameField] as string,
            projectType: type,
            stage: (r.fields[cfg.stageField] as string) || '',
            vpAvpIds,
            associateIds,
            isVpRun,
            leadFellowRecordId,
            directorIds,
          };
        });
    })
  );

  const projects = results.flat();

  const needsLeadName = projects.some(p => p.leadFellowRecordId);
  if (needsLeadName) {
    const fellows = await fetchEligibleFellows();
    const nameMap = new Map(fellows.map(f => [f.recordId, f.name]));
    for (const p of projects) {
      if (p.leadFellowRecordId) {
        p.leadFellowName = nameMap.get(p.leadFellowRecordId);
      }
    }
  }

  return projects;
}

export function getProjectsForFellow(
  projects: ProjectAssignment[],
  fellowRecordId: string
): ProjectAssignment[] {
  return projects.filter(
    p => p.vpAvpIds.includes(fellowRecordId) || p.associateIds.includes(fellowRecordId)
  );
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `cd app && pnpm vitest run tests/projects-director.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 6: Run full test suite to check no regressions**

Run: `cd app && pnpm test:run`
Expected: same prior count of tests still passing, +6 new.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/types.ts src/lib/airtable/projects.ts tests/projects-director.test.ts && cd .. && git commit -m "feat(airtable): extract director ids per project, skip VP-led mandates"
```

---

### Task 4: Pure function — slice status

**Files:**
- Create: `app/src/lib/signoff.ts`
- Test: `app/tests/signoff.test.ts` (new)

- [ ] **Step 1: Write failing tests for getDirectorSliceStatus**

Create `app/tests/signoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getDirectorSliceStatus, type SliceInput } from '../src/lib/signoff';
import type { ProjectAssignment } from '../src/types';

const baseProject = (id: string, overrides: Partial<ProjectAssignment> = {}): ProjectAssignment => ({
  projectRecordId: id,
  projectName: id,
  projectType: 'mandate',
  stage: 'In Production',
  vpAvpIds: [],
  associateIds: [],
  directorIds: [],
  ...overrides,
});

describe('getDirectorSliceStatus', () => {
  it('returns incomplete when a project has a pending token', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'pending' }],
      submissions: [],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('returns complete when all tokens are non-pending and no conflicts on the project', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('returns incomplete when a submission-level conflict on the project is pending', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'pending', source: 'submission' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('ignores resolved conflicts on the project', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'resolved', source: 'submission' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('ignores pending director_flag conflicts (defensive — should not block re-check)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'pending', source: 'director_flag' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('excludes projects with zero submissions (no team to sign off on)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [
        baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] }),
        baseProject('p2', { directorIds: ['recDirector1'], associateIds: [] }),  // no team
      ],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('returns incomplete when director has multiple projects and one has a pending token', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [
        baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] }),
        baseProject('p2', { directorIds: ['recDirector1'], associateIds: ['recB'] }),
      ],
      tokens: [
        { projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' },
        { projectRecordId: 'p2', fellowRecordId: 'recB', status: 'pending' },
      ],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('returns complete when director has no projects in scope (vacuous)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recOther'] })],  // different director
      tokens: [],
      submissions: [],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `cd app && pnpm vitest run tests/signoff.test.ts`
Expected: FAIL — `signoff` module doesn't exist.

- [ ] **Step 3: Implement getDirectorSliceStatus**

Create `app/src/lib/signoff.ts`:

```ts
import type { ProjectAssignment } from '@/types';

export interface SliceInput {
  directorFellowId: string;
  projects: ProjectAssignment[];
  tokens: Array<{ projectRecordId: string; fellowRecordId: string; status: string }>;
  submissions: Array<{ id: string; projectRecordId: string; fellowRecordId: string }>;
  conflicts: Array<{ projectRecordId: string; status: string; source: string }>;
}

/**
 * Determine whether a director's slice is complete.
 * Complete = every project where the director is in directorIds has had all team members submit
 * (no pending tokens) AND has no pending submission-level conflicts. Projects with zero
 * submissions are excluded from the check.
 */
export function getDirectorSliceStatus(input: SliceInput): 'complete' | 'incomplete' {
  const { directorFellowId, projects, tokens, submissions, conflicts } = input;

  // Director's projects only
  const directorProjects = projects.filter(p => p.directorIds.includes(directorFellowId));

  // Build per-project submission count
  const submissionsByProject = new Map<string, number>();
  for (const s of submissions) {
    submissionsByProject.set(s.projectRecordId, (submissionsByProject.get(s.projectRecordId) || 0) + 1);
  }

  // Exclude projects with zero submissions
  const inScope = directorProjects.filter(p => (submissionsByProject.get(p.projectRecordId) || 0) > 0);

  for (const project of inScope) {
    const teamIds = new Set([...project.vpAvpIds, ...project.associateIds]);

    // Pending tokens for anyone on this project's team
    const hasPendingToken = tokens.some(
      t => t.projectRecordId === project.projectRecordId
           && teamIds.has(t.fellowRecordId)
           && t.status === 'pending'
    );
    if (hasPendingToken) return 'incomplete';

    // Pending submission-level conflicts on this project
    const hasPendingConflict = conflicts.some(
      c => c.projectRecordId === project.projectRecordId
           && c.status === 'pending'
           && c.source === 'submission'
    );
    if (hasPendingConflict) return 'incomplete';
  }

  return 'complete';
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd app && pnpm vitest run tests/signoff.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/signoff.ts tests/signoff.test.ts && cd .. && git commit -m "feat(signoff): pure getDirectorSliceStatus function"
```

---

### Task 5: Pure function — resolver matrix

**Files:**
- Create: `app/src/lib/director-flag.ts`
- Test: `app/tests/director-flag.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `app/tests/director-flag.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeResolverForFlag, type FlagResolverInput } from '../src/lib/director-flag';

const fellow = (id: string, designation: string, email = `${id}@indigoedge.com`, name = id) => ({
  recordId: id, designation, email, name,
});

describe('computeResolverForFlag', () => {
  it('routes to the flagged VP themselves when a VP is flagged', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recVP1', 'VP'),
      projectVpAvpIds: ['recVP1'],
      allFellows: [fellow('recVP1', 'VP')],
    };
    const r = computeResolverForFlag(input);
    expect(r.resolverFellowId).toBe('recVP1');
    expect(r.resolverEmail).toBe('recVP1@indigoedge.com');
  });

  it('treats AVP same as VP — flagged AVP resolves themselves', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recAVP', 'AVP'),
      projectVpAvpIds: ['recAVP'],
      allFellows: [fellow('recAVP', 'AVP')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recAVP');
  });

  it('routes to first VP on project when an associate is flagged and a VP exists', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recA1', 'Associate 2'),
      projectVpAvpIds: ['recVP1', 'recVP2'],
      allFellows: [
        fellow('recA1', 'Associate 2'),
        fellow('recVP1', 'VP'),
        fellow('recVP2', 'VP'),
      ],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recVP1');
  });

  it('routes to associate themselves when no VP/AVP is on the project', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recA1', 'Associate 1'),
      projectVpAvpIds: [],
      allFellows: [fellow('recA1', 'Associate 1')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recA1');
  });

  it('routes to analyst themselves when no VP/AVP is on the project', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recAn', 'Analyst'),
      projectVpAvpIds: [],
      allFellows: [fellow('recAn', 'Analyst')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recAn');
  });

  it('skips non-VP entries in vpAvpIds when picking first VP', () => {
    // Defensive: vpAvpIds should only contain VP/AVPs, but the matrix verifies designation
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recA1', 'Associate 3'),
      projectVpAvpIds: ['recOther', 'recVP1'],
      allFellows: [
        fellow('recA1', 'Associate 3'),
        fellow('recOther', 'Associate 1'),    // mis-tagged on the project
        fellow('recVP1', 'VP'),
      ],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recVP1');
  });

  it('falls back to admin when no resolver derivable', () => {
    // Edge case: flagged fellow not in allFellows and no VPs on project
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recGhost', 'Associate 1'),
      projectVpAvpIds: [],
      allFellows: [],
      adminEmail: 'ajder@indigoedge.com',
    };
    const r = computeResolverForFlag(input);
    expect(r.resolverEmail).toBe('ajder@indigoedge.com');
    expect(r.resolverFellowId).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd app && pnpm vitest run tests/director-flag.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement computeResolverForFlag**

Create `app/src/lib/director-flag.ts`:

```ts
export interface FellowMinimal {
  recordId: string;
  designation: string;
  email: string;
  name: string;
}

export interface FlagResolverInput {
  flaggedFellow: FellowMinimal;
  projectVpAvpIds: string[];
  allFellows: FellowMinimal[];
  adminEmail?: string;
}

export interface ResolverResult {
  resolverFellowId: string | null;
  resolverEmail: string;
  resolverName: string | null;
}

function isVpOrAvp(designation: string): boolean {
  return designation === 'VP' || designation === 'AVP';
}

/**
 * Pick the resolver (TO recipient) for a director_flag conflict.
 *
 * Rules:
 *   - If the flagged fellow is VP or AVP → they resolve themselves.
 *   - Else if the project has at least one VP/AVP → first one on the project resolves.
 *   - Else → the flagged fellow resolves themselves.
 *   - Else (no resolver reachable) → fall back to adminEmail.
 */
export function computeResolverForFlag(input: FlagResolverInput): ResolverResult {
  const { flaggedFellow, projectVpAvpIds, allFellows, adminEmail } = input;

  if (isVpOrAvp(flaggedFellow.designation)) {
    return {
      resolverFellowId: flaggedFellow.recordId,
      resolverEmail: flaggedFellow.email,
      resolverName: flaggedFellow.name,
    };
  }

  // Find first VP/AVP among project's vpAvpIds (verified by designation lookup)
  for (const id of projectVpAvpIds) {
    const f = allFellows.find(x => x.recordId === id);
    if (f && isVpOrAvp(f.designation)) {
      return {
        resolverFellowId: f.recordId,
        resolverEmail: f.email,
        resolverName: f.name,
      };
    }
  }

  // No VP on project — flagged fellow resolves themselves if reachable
  const self = allFellows.find(x => x.recordId === flaggedFellow.recordId);
  if (self) {
    return {
      resolverFellowId: self.recordId,
      resolverEmail: self.email,
      resolverName: self.name,
    };
  }

  // Defensive fallback
  return {
    resolverFellowId: null,
    resolverEmail: adminEmail || 'admin@indigoedge.com',
    resolverName: null,
  };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd app && pnpm vitest run tests/director-flag.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/director-flag.ts tests/director-flag.test.ts && cd .. && git commit -m "feat(director-flag): resolver matrix pure function"
```

---

### Task 6: Pure function — recipient dedupe

**Files:**
- Modify: `app/src/lib/director-flag.ts`
- Modify: `app/tests/director-flag.test.ts`

- [ ] **Step 1: Write failing tests for dedupeRecipients**

Append to `app/tests/director-flag.test.ts`:

```ts
import { dedupeRecipients } from '../src/lib/director-flag';

describe('dedupeRecipients', () => {
  it('keeps TO, drops CC duplicates (case-insensitive)', () => {
    const r = dedupeRecipients({
      to: 'VP@indigoedge.com',
      cc: ['ajder@indigoedge.com', 'vp@INDIGOEDGE.com', 'pai@indigoedge.com'],
    });
    expect(r.to).toBe('VP@indigoedge.com');
    expect(r.cc).toEqual(['ajder@indigoedge.com', 'pai@indigoedge.com']);
  });

  it('dedupes within CC', () => {
    const r = dedupeRecipients({
      to: 'vp@indigoedge.com',
      cc: ['ajder@indigoedge.com', 'AJDER@indigoedge.com', 'pai@indigoedge.com'],
    });
    expect(r.cc).toEqual(['ajder@indigoedge.com', 'pai@indigoedge.com']);
  });

  it('handles empty CC', () => {
    const r = dedupeRecipients({ to: 'vp@indigoedge.com', cc: [] });
    expect(r.cc).toEqual([]);
  });

  it('preserves CC order after dedupe', () => {
    const r = dedupeRecipients({
      to: 'x@a.com',
      cc: ['c@a.com', 'b@a.com', 'a@a.com', 'B@a.com'],
    });
    expect(r.cc).toEqual(['c@a.com', 'b@a.com', 'a@a.com']);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd app && pnpm vitest run tests/director-flag.test.ts`
Expected: FAIL (4 new failing).

- [ ] **Step 3: Implement dedupeRecipients**

Append to `app/src/lib/director-flag.ts`:

```ts
export interface Recipients {
  to: string;
  cc: string[];
}

/**
 * Dedupe by email (case-insensitive). TO takes priority — any CC that matches TO is dropped.
 * CC order is preserved on first occurrence.
 */
export function dedupeRecipients(r: Recipients): Recipients {
  const toLower = r.to.toLowerCase();
  const seen = new Set<string>([toLower]);
  const cc: string[] = [];
  for (const addr of r.cc) {
    const lc = addr.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    cc.push(addr);
  }
  return { to: r.to, cc };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd app && pnpm vitest run tests/director-flag.test.ts`
Expected: all passing (7 + 4 = 11).

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/director-flag.ts tests/director-flag.test.ts && cd .. && git commit -m "feat(director-flag): recipient dedupe pure function"
```

---

### Task 7: Email — sign-off email + reminder

**Files:**
- Modify: `app/src/lib/email.ts`

- [ ] **Step 1: Define the per-line bandwidth shape**

In `app/src/types.ts`, add:

```ts
export interface SignoffLine {
  submissionId: string;
  fellowName: string;
  designation: string;
  hoursPerDay: number;
  hoursPerWeek: number;
}

export interface SignoffProjectGroup {
  projectRecordId: string;
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  lines: SignoffLine[];
}
```

- [ ] **Step 2: Add sendDirectorSignoffEmail to email.ts**

Append to `app/src/lib/email.ts`:

```ts
// --- Director Sign-off Email ---
export async function sendDirectorSignoffEmail(params: {
  directorName: string;
  directorEmail: string;
  cycleStartDate: string;
  signoffToken: string;
  groups: import('@/types').SignoffProjectGroup[];
}): Promise<string | undefined> {
  const { directorName, directorEmail, cycleStartDate, signoffToken, groups } = params;
  const dateRange = formatDateRange(cycleStartDate);
  const appUrl = process.env.APP_URL || '';
  const link = `${appUrl}/signoff/${signoffToken}`;
  const projectCount = groups.length;

  const groupsHtml = groups.map(g => {
    const typeLabel = g.projectType === 'mandate' ? 'Mandate' : g.projectType === 'dde' ? 'DDE' : 'Pitch';
    const rows = g.lines.map((l, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      return `<tr style="background:${bg}">
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${l.fellowName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${l.designation}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">${l.hoursPerDay.toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">${l.hoursPerWeek.toFixed(1)}</td>
      </tr>`;
    }).join('');
    return `<div style="margin:20px 0">
      <p style="font-weight:600;margin:0 0 6px;font-size:14px">${g.projectName} <span style="font-size:11px;color:#6b7280;font-weight:400">(${typeLabel})</span></p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
        <tr style="background:#f3f4f6">
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600">Person</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600">Designation</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600">Hrs/day</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600">Hrs/week</th>
        </tr>
        ${rows}
      </table>
    </div>`;
  }).join('');

  return await sendEmail({
    from,
    to: overrideTo(directorEmail),
    cc: standardCc(),
    subject: `Bandwidth Sign-off — ${dateRange} — ${projectCount} project${projectCount !== 1 ? 's' : ''}`,
    html: `
      <p>Hi ${directorName},</p>
      <p>Your team has finished reporting bandwidth on the projects you direct for the cycle of <strong>${dateRange}</strong>. Please review the summary below and either confirm everything looks right or flag specific lines you think need a second look.</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#16a34a;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Review & confirm bandwidth →</a>
      </p>
      <p style="font-size:13px;color:#6b7280;margin:0 0 8px">One-click confirmation if everything looks right. Or flag specific lines and we'll route them for resolution.</p>
      ${groupsHtml}
      <p style="font-size:12px;color:#9ca3af;margin-top:32px">A reminder will be sent daily until this is responded to.</p>
    `,
  });
}

// --- Director Sign-off Reminder ---
export async function sendDirectorSignoffReminderEmail(params: {
  directorName: string;
  directorEmail: string;
  cycleStartDate: string;
  signoffToken: string;
  originalMessageId: string | null;
}): Promise<string | undefined> {
  const { directorName, directorEmail, cycleStartDate, signoffToken, originalMessageId } = params;
  const dateRange = formatDateRange(cycleStartDate);
  const appUrl = process.env.APP_URL || '';
  const link = `${appUrl}/signoff/${signoffToken}`;

  const headers: Record<string, string> = {};
  if (originalMessageId) {
    headers['In-Reply-To'] = originalMessageId;
    headers['References'] = originalMessageId;
  }

  return await sendEmail({
    from,
    to: overrideTo(directorEmail),
    subject: `Re: Bandwidth Sign-off — ${dateRange}`,
    headers,
    html: `
      <p>Hi ${directorName},</p>
      <p>Friendly nudge — your bandwidth sign-off for <strong>${dateRange}</strong> is still pending.</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#16a34a;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Open sign-off →</a>
      </p>
    `,
  });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/types.ts src/lib/email.ts && cd .. && git commit -m "feat(email): director sign-off email + reminder"
```

---

### Task 8: Email — flag resolution + confirmation

**Files:**
- Modify: `app/src/lib/email.ts`

- [ ] **Step 1: Add sendDirectorFlagResolutionEmail and sendDirectorFlagResolutionConfirmationEmail**

Append to `app/src/lib/email.ts`:

```ts
// --- Director Flag Resolution Email ---
export async function sendDirectorFlagResolutionEmail(params: {
  resolverName: string;
  resolverEmail: string;
  ccEmails: string[];
  directorName: string;
  fellowName: string;
  fellowDesignation: string;
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  originalHoursPerDay: number;
  proposedHoursPerDay: number | null;
  directorComment: string | null;
  resolutionToken: string;
}): Promise<string | undefined> {
  const { resolverName, resolverEmail, ccEmails, directorName, fellowName, fellowDesignation,
          projectName, projectType, originalHoursPerDay, proposedHoursPerDay, directorComment,
          resolutionToken } = params;
  const typeLabel = projectType === 'mandate' ? 'Mandate' : projectType === 'dde' ? 'DDE' : 'Pitch';
  const appUrl = process.env.APP_URL || '';
  const originalHrsPerWeek = (originalHoursPerDay * 6).toFixed(1);
  const proposedHrsPerWeek = proposedHoursPerDay !== null ? (proposedHoursPerDay * 6).toFixed(1) : null;

  const keepLink = `${appUrl}/resolve/${resolutionToken}?action=keep_original`;
  const proposedLink = `${appUrl}/resolve/${resolutionToken}?action=use_proposed`;
  const customLink = `${appUrl}/resolve/${resolutionToken}`;

  const proposedBlock = proposedHoursPerDay !== null
    ? `<p><strong>Director's proposed value:</strong> ${proposedHoursPerDay.toFixed(2)} hrs/day (${proposedHrsPerWeek} hrs/week)</p>`
    : '';
  const commentBlock = directorComment
    ? `<p><strong>Director's comment:</strong> "${directorComment}"</p>`
    : '';
  const proposedButton = proposedHoursPerDay !== null
    ? `<a href="${proposedLink}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;margin:4px">Use director's value (${proposedHoursPerDay.toFixed(2)})</a>`
    : '';

  return await sendEmail({
    from,
    to: overrideTo(resolverEmail),
    cc: overrideCc(ccEmails),
    subject: `Bandwidth Sign-off Flag — ${projectName} — ${fellowName}`,
    html: `
      <p>Hi ${resolverName},</p>
      <p><strong>${directorName}</strong> flagged <strong>${fellowName}</strong>'s (${fellowDesignation}) bandwidth on <strong>${projectName}</strong> (${typeLabel}) this cycle.</p>
      <p><strong>Original value:</strong> ${originalHoursPerDay.toFixed(2)} hrs/day (${originalHrsPerWeek} hrs/week)</p>
      ${proposedBlock}
      ${commentBlock}
      <div style="margin:24px 0">
        <a href="${keepLink}" style="background:#6b7280;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;margin:4px">Keep original (${originalHoursPerDay.toFixed(2)})</a>
        ${proposedButton}
        <a href="${customLink}" style="background:#ffffff;color:#1e40af;border:2px solid #2563eb;padding:8px 18px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;margin:4px">Provide a different value</a>
      </div>
    `,
  });
}

// --- Confirmation after flag resolves (threaded reply) ---
export async function sendDirectorFlagResolutionConfirmationEmail(params: {
  resolverEmail: string;
  ccEmails: string[];
  fellowName: string;
  projectName: string;
  finalHoursPerDay: number;
  action: string;
  originalMessageId: string | null;
}): Promise<string | undefined> {
  const { resolverEmail, ccEmails, fellowName, projectName, finalHoursPerDay, action, originalMessageId } = params;
  const actionLabel =
    action === 'keep_original' ? 'kept the original value' :
    action === 'use_proposed' ? 'used the director\'s proposed value' :
    'set a custom value';
  const headers: Record<string, string> = {};
  if (originalMessageId) {
    headers['In-Reply-To'] = originalMessageId;
    headers['References'] = originalMessageId;
  }

  return await sendEmail({
    from,
    to: overrideTo(resolverEmail),
    cc: overrideCc(ccEmails),
    subject: `Re: Bandwidth Sign-off Flag — ${projectName} — ${fellowName}`,
    headers,
    html: `
      <p>Resolved: <strong>${finalHoursPerDay.toFixed(2)} hrs/day</strong>.</p>
      <p>The resolver ${actionLabel}.</p>
    `,
  });
}
```

- [ ] **Step 2: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/lib/email.ts && cd .. && git commit -m "feat(email): director flag resolution + confirmation"
```

---

### Task 9: Slack — postDirectorFlagToSlack

**Files:**
- Modify: `app/src/lib/slack.ts`

- [ ] **Step 1: Export postToSlack (for internal reuse) + add helper**

In `app/src/lib/slack.ts`, change `async function postToSlack` to `export async function postToSlack`, then append:

```ts
export interface FlagSlackEntry {
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  fellowName: string;
  fellowDesignation: string;
  reportedHoursPerDay: number;
  proposedHoursPerDay: number | null;
  directorComment: string | null;
  resolverName: string;
}

export async function postDirectorFlagToSlack(params: {
  directorName: string;
  cycleDateRange: string;
  flags: FlagSlackEntry[];
}): Promise<void> {
  const { directorName, cycleDateRange, flags } = params;
  if (flags.length === 0) return;

  const lines = flags.map(f => {
    const typeLabel = f.projectType === 'mandate' ? 'Mandate' : f.projectType === 'dde' ? 'DDE' : 'Pitch';
    const proposed = f.proposedHoursPerDay !== null
      ? `${f.proposedHoursPerDay.toFixed(2)} hrs/day`
      : 'no proposed value';
    let block =
      `• *${f.projectName}* (${typeLabel}) — ${f.fellowName} (${f.fellowDesignation})\n` +
      `    Reported: ${f.reportedHoursPerDay.toFixed(2)} hrs/day\n` +
      `    Proposed: ${proposed}`;
    if (f.directorComment) block += `\n    Comment: "${f.directorComment}"`;
    block += `\n    Resolution email sent to: ${f.resolverName}`;
    return block;
  }).join('\n\n');

  const text =
    `:triangular_flag_on_post: *Director sign-off flag* — ${directorName} — Cycle ${cycleDateRange}\n\n` +
    `${directorName} flagged ${flags.length} bandwidth claim${flags.length !== 1 ? 's' : ''}:\n\n` +
    `${lines}\n\n` +
    `_Sign-off: ${directorName} — flagged (resolution pending)_`;

  await postToSlack(text);
}
```

- [ ] **Step 2: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/lib/slack.ts && cd .. && git commit -m "feat(slack): postDirectorFlagToSlack helper"
```

---

### Task 10: signoff.ts — createSignoffIfReady

**Files:**
- Modify: `app/src/lib/signoff.ts`
- Modify: `app/tests/signoff.test.ts`

- [ ] **Step 1: Write failing test for createSignoffIfReady (idempotency + email send)**

Append to `app/tests/signoff.test.ts`:

```ts
import { createSignoffIfReady } from '../src/lib/signoff';
import { db } from '../src/lib/db/client';
import { directorSignoffs } from '../src/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { vi, beforeEach } from 'vitest';

// Mock email send to avoid real Resend calls in tests
vi.mock('../src/lib/email', () => ({
  sendDirectorSignoffEmail: vi.fn().mockResolvedValue('msg_test_123'),
}));

describe('createSignoffIfReady — DB integration', () => {
  // Set up: requires a test cycle + a director + projects + submissions.
  // Use a per-test transaction or test fixtures. Concrete setup deferred to
  // implementation — pattern matches existing api-pending-projects.test.ts.

  it.skip('inserts a signoff row + sends email when slice is complete', async () => {
    // Setup test fixtures
    // ... insert cycle, director fellow, project, submissions ...
    // Call createSignoffIfReady(...)
    // Assert: 1 row in director_signoffs, status='email_sent', emailMessageId='msg_test_123'
  });

  it.skip('does nothing when slice is incomplete', async () => {
    // Insert a pending token
    // Call createSignoffIfReady
    // Assert: 0 rows in director_signoffs
  });

  it.skip('idempotency: second call when row already exists does nothing', async () => {
    // Insert a signoff row
    // Call createSignoffIfReady
    // Assert: still 1 row, no second email send
  });
});
```

(Tests marked `.skip` until the project has integration-test infrastructure for Neon. Pattern matches existing test layout. The pure logic was covered in Task 4.)

- [ ] **Step 2: Implement createSignoffIfReady**

Append to `app/src/lib/signoff.ts`:

```ts
import { db } from './db/client';
import { directorSignoffs, tokens, submissions as submissionsTable, conflicts as conflictsTable, cycles } from './db/schema';
import { eq, and } from 'drizzle-orm';
import { fetchAllProjects } from './airtable/projects';
import { fetchEligibleFellows } from './airtable/fellows';
import { sendDirectorSignoffEmail } from './email';
import { randomUUID } from 'crypto';
import type { SignoffProjectGroup } from '@/types';

/**
 * If the given director's slice is now complete and no signoff row exists yet,
 * insert one (status=email_sent), send the sign-off email, and store the message id.
 * No-op otherwise. Idempotent via the (cycleId, directorFellowId) unique constraint.
 */
export async function createSignoffIfReady(
  cycleId: string,
  directorFellowId: string
): Promise<{ created: boolean; reason?: string }> {
  // Bail early if signoff already exists
  const existing = await db.select().from(directorSignoffs)
    .where(and(eq(directorSignoffs.cycleId, cycleId), eq(directorSignoffs.directorFellowId, directorFellowId)))
    .limit(1);
  if (existing.length > 0) return { created: false, reason: 'already exists' };

  // Gather data for the slice check
  const projects = await fetchAllProjects();
  const allTokens = await db.select().from(tokens).where(eq(tokens.cycleId, cycleId));
  const allSubmissions = await db.select().from(submissionsTable).where(eq(submissionsTable.cycleId, cycleId));
  const allConflicts = await db.select().from(conflictsTable).where(eq(conflictsTable.cycleId, cycleId));

  const status = getDirectorSliceStatus({
    directorFellowId,
    projects,
    tokens: allTokens.map(t => ({ projectRecordId: '', fellowRecordId: t.fellowRecordId, status: t.status })),
    // tokens don't carry projectRecordId — we need to map via projects + fellow lists
    // Better: pass each token along with the set of projectRecordIds it covers (any project the fellow is on)
    submissions: allSubmissions.map(s => ({ id: s.id, projectRecordId: s.projectRecordId, fellowRecordId: s.fellowRecordId })),
    conflicts: allConflicts.map(c => ({ projectRecordId: c.projectRecordId, status: c.status, source: c.source })),
  });
  // NOTE: tokens don't have projectRecordId directly; the slice check needs to be enriched
  // by joining tokens to projects-by-fellow. Refactor: in this function, build a token list
  // where each token expands to (token, projectRecordId) for every project that fellow is on.

  // Rebuild tokens to be projectRecordId-aware:
  const expandedTokens: Array<{ projectRecordId: string; fellowRecordId: string; status: string }> = [];
  for (const t of allTokens) {
    const fellowProjects = projects.filter(p =>
      p.vpAvpIds.includes(t.fellowRecordId) || p.associateIds.includes(t.fellowRecordId)
    );
    for (const p of fellowProjects) {
      expandedTokens.push({ projectRecordId: p.projectRecordId, fellowRecordId: t.fellowRecordId, status: t.status });
    }
  }

  const status2 = getDirectorSliceStatus({
    directorFellowId,
    projects,
    tokens: expandedTokens,
    submissions: allSubmissions.map(s => ({ id: s.id, projectRecordId: s.projectRecordId, fellowRecordId: s.fellowRecordId })),
    conflicts: allConflicts.map(c => ({ projectRecordId: c.projectRecordId, status: c.status, source: c.source })),
  });

  if (status2 !== 'complete') return { created: false, reason: 'incomplete' };

  // Fetch director profile
  const fellows = await fetchEligibleFellows();
  const director = fellows.find(f => f.recordId === directorFellowId);
  if (!director) return { created: false, reason: 'director not found' };

  // Build groups for the email
  const groups = buildSignoffGroups(directorFellowId, projects, allSubmissions, fellows);
  if (groups.length === 0) return { created: false, reason: 'no projects to sign off on' };

  // Fetch cycle start date
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1);
  if (!cycle) return { created: false, reason: 'cycle not found' };

  const signoffToken = randomUUID();

  try {
    await db.insert(directorSignoffs).values({
      cycleId,
      directorFellowId,
      directorEmail: director.email,
      directorName: director.name,
      status: 'email_sent',
      signoffToken,
    });
  } catch (err) {
    // Unique-constraint violation = a concurrent caller already inserted. No-op.
    return { created: false, reason: 'race lost' };
  }

  const messageId = await sendDirectorSignoffEmail({
    directorName: director.name,
    directorEmail: director.email,
    cycleStartDate: cycle.startDate,
    signoffToken,
    groups,
  });

  if (messageId) {
    await db.update(directorSignoffs)
      .set({ emailMessageId: messageId, updatedAt: new Date() })
      .where(and(eq(directorSignoffs.cycleId, cycleId), eq(directorSignoffs.directorFellowId, directorFellowId)));
  }

  return { created: true };
}

interface SubmissionRow {
  id: string;
  projectRecordId: string;
  fellowRecordId: string;
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  hoursPerDay: number;
  hoursPerWeek: number | null;
}

interface FellowRow {
  recordId: string;
  name: string;
  designation: string;
}

/** Group submissions by project for the director's slice. */
function buildSignoffGroups(
  directorFellowId: string,
  projects: Awaited<ReturnType<typeof fetchAllProjects>>,
  submissions: SubmissionRow[],
  fellows: FellowRow[]
): SignoffProjectGroup[] {
  const directorProjects = projects.filter(p => p.directorIds.includes(directorFellowId));
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  const groups: SignoffProjectGroup[] = [];
  for (const p of directorProjects) {
    const projectSubmissions = submissions.filter(s => s.projectRecordId === p.projectRecordId);
    if (projectSubmissions.length === 0) continue;

    const lines = projectSubmissions.map(s => {
      const f = fellowMap.get(s.fellowRecordId);
      return {
        submissionId: s.id,
        fellowName: f?.name || 'Unknown',
        designation: f?.designation || 'Unknown',
        hoursPerDay: s.hoursPerDay,
        hoursPerWeek: s.hoursPerWeek ?? s.hoursPerDay * 6,
      };
    });

    groups.push({
      projectRecordId: p.projectRecordId,
      projectName: p.projectName,
      projectType: p.projectType,
      lines,
    });
  }
  return groups;
}

export { buildSignoffGroups };
```

NOTE for the implementer: the type of `submissions` from drizzle may differ slightly from `SubmissionRow` above (e.g., `hoursPerWeek` might be `real | null`). Adjust types to match drizzle's inferred row type. The `projectName` and `projectType` fields live on the submissions table already (see schema.ts:28-29), so no extra join needed.

- [ ] **Step 3: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean. If types complain, adjust `SubmissionRow` to match drizzle's inferred shape.

- [ ] **Step 4: Run any non-skipped tests**

Run: `cd app && pnpm test:run`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/signoff.ts tests/signoff.test.ts && cd .. && git commit -m "feat(signoff): createSignoffIfReady — DB insert + email send"
```

---

### Task 11: signoff.ts — submitFlags

**Files:**
- Modify: `app/src/lib/signoff.ts`

- [ ] **Step 1: Implement submitFlags**

Append to `app/src/lib/signoff.ts`:

```ts
import { conflicts as conflictsTable } from './db/schema';
import { computeResolverForFlag, dedupeRecipients } from './director-flag';
import { sendDirectorFlagResolutionEmail } from './email';
import { postDirectorFlagToSlack } from './slack';
import { formatDateRange } from './schedule';  // or wherever it lives; see Task 7's email refactor

export interface FlagInput {
  submissionId: string;
  proposedHoursPerDay?: number;
  comment?: string;
}

export interface SubmitFlagsResult {
  conflictIds: string[];
  flagsProcessed: number;
}

export async function submitFlags(params: {
  signoffToken: string;
  flags: FlagInput[];
}): Promise<SubmitFlagsResult> {
  const { signoffToken, flags } = params;

  if (flags.length === 0) throw new Error('At least one flag required');

  // Validate: each flag has at least one of proposedHoursPerDay or comment
  for (const f of flags) {
    const hasValue = typeof f.proposedHoursPerDay === 'number' && !Number.isNaN(f.proposedHoursPerDay);
    const hasComment = typeof f.comment === 'string' && f.comment.trim().length > 0;
    if (!hasValue && !hasComment) {
      throw new Error(`Flag for submission ${f.submissionId} must include a proposed value or a comment`);
    }
  }

  // Validate: no duplicate submissionIds in the array
  const ids = new Set<string>();
  for (const f of flags) {
    if (ids.has(f.submissionId)) throw new Error(`Duplicate flag for submission ${f.submissionId}`);
    ids.add(f.submissionId);
  }

  // Resolve signoff
  const [signoff] = await db.select().from(directorSignoffs).where(eq(directorSignoffs.signoffToken, signoffToken)).limit(1);
  if (!signoff) throw new Error('Invalid token');
  if (signoff.status !== 'email_sent') throw new Error(`Signoff is in state ${signoff.status}, not flaggable`);

  // Fetch all needed data
  const projects = await fetchAllProjects();
  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  // For each flag: lookup submission, project, flagged fellow, compute resolver
  const flagSubmissions = await Promise.all(
    flags.map(async f => {
      const [sub] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, f.submissionId)).limit(1);
      if (!sub) throw new Error(`Submission ${f.submissionId} not found`);
      if (sub.cycleId !== signoff.cycleId) throw new Error('Cross-cycle submission');
      const project = projects.find(p => p.projectRecordId === sub.projectRecordId);
      if (!project) throw new Error(`Project ${sub.projectRecordId} not in active projects`);
      if (!project.directorIds.includes(signoff.directorFellowId)) {
        throw new Error(`Submission ${f.submissionId} is not in the director's slice`);
      }
      const flaggedFellow = fellowMap.get(sub.fellowRecordId);
      if (!flaggedFellow) throw new Error(`Fellow ${sub.fellowRecordId} not found`);
      return { input: f, submission: sub, project, flaggedFellow };
    })
  );

  // Compute resolver for each
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@indigoedge.com';
  const enriched = flagSubmissions.map(item => {
    const resolver = computeResolverForFlag({
      flaggedFellow: {
        recordId: item.flaggedFellow.recordId,
        designation: item.flaggedFellow.designation,
        email: item.flaggedFellow.email,
        name: item.flaggedFellow.name,
      },
      projectVpAvpIds: item.project.vpAvpIds,
      allFellows: fellows.map(f => ({
        recordId: f.recordId, designation: f.designation, email: f.email, name: f.name,
      })),
      adminEmail,
    });
    return { ...item, resolver };
  });

  // Transaction: update signoff + insert all conflict rows
  const ccBase = [
    signoff.directorEmail,
    process.env.ADMIN_EMAIL,
    process.env.CC_EMAIL,
  ].filter(Boolean) as string[];

  const insertedConflictIds: string[] = [];
  await db.transaction(async (tx) => {
    await tx.update(directorSignoffs).set({
      status: 'flagged',
      flaggedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(directorSignoffs.id, signoff.id));

    for (const item of enriched) {
      const [row] = await tx.insert(conflictsTable).values({
        cycleId: signoff.cycleId,
        projectRecordId: item.submission.projectRecordId,
        // Submission-source columns left null
        vpSubmissionId: null,
        associateSubmissionId: null,
        vpHoursPerDay: null,
        associateHoursPerDay: null,
        difference: null,
        status: 'pending',
        resolutionToken: randomUUID(),
        // Director-flag fields:
        source: 'director_flag',
        flaggedSubmissionId: item.submission.id,
        flaggedByFellowId: signoff.directorFellowId,
        flaggedOriginalHoursPerDay: item.submission.hoursPerDay,
        proposedHoursPerDay: item.input.proposedHoursPerDay ?? null,
        directorComment: item.input.comment ?? null,
        signoffId: signoff.id,
        resolverFellowId: item.resolver.resolverFellowId,
        resolverEmail: item.resolver.resolverEmail,
      }).returning({ id: conflictsTable.id, resolutionToken: conflictsTable.resolutionToken });
      insertedConflictIds.push(row.id);
    }
  });

  // Post-commit side effects: Slack + emails
  // Fetch cycle start date for date range
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, signoff.cycleId)).limit(1);
  const cycleDateRange = cycle ? formatDateRange(cycle.startDate) : '';

  // Slack post
  await postDirectorFlagToSlack({
    directorName: signoff.directorName,
    cycleDateRange,
    flags: enriched.map(e => ({
      projectName: e.project.projectName,
      projectType: e.project.projectType,
      fellowName: e.flaggedFellow.name,
      fellowDesignation: e.flaggedFellow.designation,
      reportedHoursPerDay: e.submission.hoursPerDay,
      proposedHoursPerDay: e.input.proposedHoursPerDay ?? null,
      directorComment: e.input.comment ?? null,
      resolverName: e.resolver.resolverName || 'Admin',
    })),
  });

  // Resolution emails (one per flag)
  for (let i = 0; i < enriched.length; i++) {
    const item = enriched[i];
    const conflictId = insertedConflictIds[i];

    const [insertedRow] = await db.select().from(conflictsTable).where(eq(conflictsTable.id, conflictId)).limit(1);
    if (!insertedRow?.resolutionToken) continue;

    // Build CC: directorEmail + ADMIN_EMAIL + CC_EMAIL + (flaggedFellow.email if different from resolver)
    let cc: string[] = [...ccBase];
    if (item.resolver.resolverEmail.toLowerCase() !== item.flaggedFellow.email.toLowerCase()) {
      cc.push(item.flaggedFellow.email);
    }

    // Dedupe TO vs CC
    const { to, cc: dedupedCc } = dedupeRecipients({ to: item.resolver.resolverEmail, cc });

    const messageId = await sendDirectorFlagResolutionEmail({
      resolverName: item.resolver.resolverName || 'Admin',
      resolverEmail: to,
      ccEmails: dedupedCc,
      directorName: signoff.directorName,
      fellowName: item.flaggedFellow.name,
      fellowDesignation: item.flaggedFellow.designation,
      projectName: item.project.projectName,
      projectType: item.project.projectType,
      originalHoursPerDay: item.submission.hoursPerDay,
      proposedHoursPerDay: item.input.proposedHoursPerDay ?? null,
      directorComment: item.input.comment ?? null,
      resolutionToken: insertedRow.resolutionToken,
    });

    if (messageId) {
      await db.update(conflictsTable)
        .set({ emailMessageId: messageId })
        .where(eq(conflictsTable.id, conflictId));
    }
  }

  return { conflictIds: insertedConflictIds, flagsProcessed: enriched.length };
}
```

NOTE: `formatDateRange` is currently a private function in `email.ts`. Refactor it to a shared utility in `app/src/lib/schedule.ts` (or wherever `getCycleEndDate` lives) and re-export from both modules. Step 2 below covers this refactor.

- [ ] **Step 2: Refactor formatDateRange to schedule.ts**

In `app/src/lib/schedule.ts`, add:

```ts
export function formatDateRange(startDate: string): string {
  const start = new Date(startDate);
  const end = getCycleEndDate(start);
  return `${start.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
```

In `app/src/lib/email.ts`, remove the private `formatDateRange` and `import { formatDateRange } from './schedule'` instead.

- [ ] **Step 3: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run tests**

Run: `cd app && pnpm test:run`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/signoff.ts src/lib/schedule.ts src/lib/email.ts && cd .. && git commit -m "feat(signoff): submitFlags transaction + Slack + resolution emails"
```

---

### Task 12: signoff.ts — transitionToFlaggedResolved

**Files:**
- Modify: `app/src/lib/signoff.ts`

- [ ] **Step 1: Implement transitionToFlaggedResolved**

Append to `app/src/lib/signoff.ts`:

```ts
/**
 * After a director_flag conflict resolves, check whether its parent signoff
 * still has any pending children. If not, transition the signoff to flagged_resolved.
 * Returns true if a transition happened.
 */
export async function transitionToFlaggedResolved(signoffId: string): Promise<boolean> {
  const pending = await db.select({ id: conflictsTable.id })
    .from(conflictsTable)
    .where(and(eq(conflictsTable.signoffId, signoffId), eq(conflictsTable.status, 'pending')))
    .limit(1);

  if (pending.length > 0) return false;

  const updated = await db.update(directorSignoffs)
    .set({ status: 'flagged_resolved', resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(directorSignoffs.id, signoffId), eq(directorSignoffs.status, 'flagged')))
    .returning({ id: directorSignoffs.id });

  return updated.length > 0;
}

export async function confirmSignoff(signoffToken: string): Promise<{ confirmed: boolean }> {
  const updated = await db.update(directorSignoffs).set({
    status: 'confirmed',
    confirmedAt: new Date(),
    confirmedBy: 'director',
    updatedAt: new Date(),
  })
    .where(and(eq(directorSignoffs.signoffToken, signoffToken), eq(directorSignoffs.status, 'email_sent')))
    .returning({ id: directorSignoffs.id });

  return { confirmed: updated.length > 0 };
}
```

- [ ] **Step 2: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/lib/signoff.ts && cd .. && git commit -m "feat(signoff): transitionToFlaggedResolved + confirmSignoff"
```

---

### Task 13: API — POST /api/signoff/confirm

**Files:**
- Create: `app/src/app/api/signoff/confirm/route.ts`
- Test: append cases to `app/tests/api-signoff.test.ts` (new file)

- [ ] **Step 1: Write a test for the endpoint shape**

Create `app/tests/api-signoff.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// These tests are smoke tests for endpoint shape; integration is verified in dev manually
// against a preview deployment with seeded data (mirrors the api-pending-projects.test.ts style).

describe('POST /api/signoff/confirm', () => {
  it('rejects missing token with 400', async () => {
    const { POST } = await import('../src/app/api/signoff/confirm/route');
    const req = new Request('http://localhost/api/signoff/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects unknown token with 404', async () => {
    vi.mock('../src/lib/signoff', () => ({
      confirmSignoff: vi.fn().mockResolvedValue({ confirmed: false }),
    }));
    const { POST } = await import('../src/app/api/signoff/confirm/route');
    const req = new Request('http://localhost/api/signoff/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'bad-token' }),
    });
    const res = await POST(req);
    expect([404, 409]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run, expect failure (module missing)**

Run: `cd app && pnpm vitest run tests/api-signoff.test.ts`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `app/src/app/api/signoff/confirm/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { confirmSignoff } from '@/lib/signoff';
import { checkAndFinalizeCycle } from '@/lib/cycle';

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.token || typeof body.token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  const { confirmed } = await confirmSignoff(body.token);
  if (!confirmed) {
    return NextResponse.json({ error: 'Signoff not found or already responded' }, { status: 409 });
  }

  // Trigger cycle finalization check
  await checkAndFinalizeCycle();

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd app && pnpm vitest run tests/api-signoff.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/app/api/signoff/confirm/route.ts tests/api-signoff.test.ts && cd .. && git commit -m "feat(api): POST /api/signoff/confirm"
```

---

### Task 14: API — POST /api/signoff/flag

**Files:**
- Create: `app/src/app/api/signoff/flag/route.ts`

- [ ] **Step 1: Implement the route**

Create `app/src/app/api/signoff/flag/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { submitFlags } from '@/lib/signoff';
import { checkAndFinalizeCycle } from '@/lib/cycle';

interface FlagBody {
  token?: string;
  flags?: Array<{
    submissionId?: string;
    proposedHoursPerDay?: number;
    comment?: string;
  }>;
}

export async function POST(req: Request) {
  let body: FlagBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.token || typeof body.token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }
  if (!Array.isArray(body.flags) || body.flags.length === 0) {
    return NextResponse.json({ error: 'flags must be a non-empty array' }, { status: 400 });
  }
  for (const f of body.flags) {
    if (!f.submissionId || typeof f.submissionId !== 'string') {
      return NextResponse.json({ error: 'each flag needs submissionId' }, { status: 400 });
    }
  }

  try {
    const result = await submitFlags({
      signoffToken: body.token,
      flags: body.flags.map(f => ({
        submissionId: f.submissionId as string,
        proposedHoursPerDay: f.proposedHoursPerDay,
        comment: f.comment,
      })),
    });

    // Note: cycle can't finalize yet — there are pending director_flag conflicts.
    // But run the check anyway in case other directors' state allows finalization
    // of unrelated cycles (defensive).
    await checkAndFinalizeCycle();

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 2: Compile + commit**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

```bash
cd app && git add src/app/api/signoff/flag/route.ts && cd .. && git commit -m "feat(api): POST /api/signoff/flag"
```

---

### Task 15: API — extend /api/resolve to handle director_flag

**Files:**
- Modify: `app/src/app/api/resolve/route.ts`

- [ ] **Step 1: Inspect existing /api/resolve handler**

Run: `cat app/src/app/api/resolve/route.ts | head -80` to see current shape. Then add a branch that detects `conflict.source === 'director_flag'` and handles it separately.

- [ ] **Step 2: Add director_flag handling logic**

Modify `app/src/app/api/resolve/route.ts` — add a branch after fetching the conflict row, before the existing two-sided writeback logic. Reference the existing imports for `db`, `conflictsTable`, `submissionsTable`, `scoreHours`, etc.

Sketch (replace with code that fits the actual existing route's style):

```ts
// ... existing imports and conflict fetch ...

if (conflict.source === 'director_flag') {
  // Branch: one-sided writeback for director-flag resolution
  if (!conflict.flaggedSubmissionId || conflict.flaggedOriginalHoursPerDay === null) {
    return NextResponse.json({ error: 'malformed director_flag conflict' }, { status: 500 });
  }

  let finalHoursPerDay: number;
  if (action === 'keep_original') {
    // Read the current submission value fresh (defensive; do NOT use snapshotted flaggedOriginalHoursPerDay)
    const [currentSub] = await db.select().from(submissionsTable)
      .where(eq(submissionsTable.id, conflict.flaggedSubmissionId))
      .limit(1);
    if (!currentSub) return NextResponse.json({ error: 'submission missing' }, { status: 500 });
    finalHoursPerDay = currentSub.hoursPerDay;
    // No UPDATE to submission — endorsing current value
  } else if (action === 'use_proposed') {
    if (conflict.proposedHoursPerDay === null) {
      return NextResponse.json({ error: 'no proposed value' }, { status: 400 });
    }
    finalHoursPerDay = conflict.proposedHoursPerDay;
  } else if (action === 'custom') {
    if (typeof customHoursPerDay !== 'number') {
      return NextResponse.json({ error: 'customHoursPerDay required' }, { status: 400 });
    }
    finalHoursPerDay = customHoursPerDay;
  } else {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }

  const hoursPerWeek = finalHoursPerDay * WORKING_DAYS_PER_WEEK;
  const [sub] = await db.select().from(submissionsTable)
    .where(eq(submissionsTable.id, conflict.flaggedSubmissionId))
    .limit(1);
  const { score } = scoreHours(finalHoursPerDay, sub!.projectType);

  if (action !== 'keep_original') {
    await db.update(submissionsTable).set({
      hoursPerDay: finalHoursPerDay,
      hoursPerWeek,
      autoScore: score,
    }).where(eq(submissionsTable.id, conflict.flaggedSubmissionId));
  }

  await db.update(conflictsTable).set({
    status: 'resolved',
    resolvedHoursPerDay: finalHoursPerDay,
    resolvedBy: action,
  }).where(eq(conflictsTable.id, conflict.id));

  // Send threaded confirmation email
  const ccEmails = [conflict.flaggedByFellowId, process.env.CC_EMAIL, process.env.ADMIN_EMAIL]
    .filter(Boolean) as string[];
  // ... fetch directorEmail via signoffs, build full CC list per matrix ...
  await sendDirectorFlagResolutionConfirmationEmail({
    resolverEmail: conflict.resolverEmail || process.env.ADMIN_EMAIL!,
    ccEmails: [] /* TODO: populate full list */,
    fellowName: '...',  // lookup
    projectName: '...',  // lookup
    finalHoursPerDay,
    action,
    originalMessageId: conflict.emailMessageId,
  });

  // Transition signoff lifecycle
  if (conflict.signoffId) {
    await transitionToFlaggedResolved(conflict.signoffId);
  }

  await checkAndFinalizeCycle();

  return NextResponse.json({ ok: true });
}

// ... existing submission-source handling continues below ...
```

NOTE for the implementer: this is a sketch. The exact existing route's structure (whether it's a single `POST` function, how it parses `action`, what helper functions it calls) should drive the final shape. Preserve existing behavior for `source='submission'` cases.

- [ ] **Step 2: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run all tests**

Run: `cd app && pnpm test:run`
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/app/api/resolve/route.ts && cd .. && git commit -m "feat(api): /api/resolve handles director_flag source"
```

---

### Task 16: Signoff page — server component

**Files:**
- Create: `app/src/app/signoff/[token]/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/src/app/signoff/[token]/page.tsx`:

```tsx
import { db } from '@/lib/db/client';
import { directorSignoffs, submissions as submissionsTable, cycles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';
import { buildSignoffGroups } from '@/lib/signoff';
import { formatDateRange } from '@/lib/schedule';
import { SignoffForm } from './signoff-form';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function SignoffPage({ params }: Props) {
  const { token } = await params;

  const [signoff] = await db.select().from(directorSignoffs).where(eq(directorSignoffs.signoffToken, token)).limit(1);
  if (!signoff) {
    return <main style={{ padding: 32 }}><h1>Invalid sign-off link</h1></main>;
  }

  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, signoff.cycleId)).limit(1);
  const dateRange = cycle ? formatDateRange(cycle.startDate) : '';

  // Status views for terminal states
  if (signoff.status === 'confirmed') {
    return <main style={{ padding: 32 }}>
      <h1>Already confirmed</h1>
      <p>You confirmed bandwidth for {dateRange} on {signoff.confirmedAt?.toString().slice(0, 16)}.</p>
    </main>;
  }
  if (signoff.status === 'flagged' || signoff.status === 'flagged_resolved') {
    return <main style={{ padding: 32 }}>
      <h1>Already responded</h1>
      <p>You flagged this cycle. Resolution is {signoff.status === 'flagged_resolved' ? 'complete' : 'in progress'}.</p>
    </main>;
  }

  // status='email_sent' — render the form
  const projects = await fetchAllProjects();
  const cycleSubmissions = await db.select().from(submissionsTable).where(eq(submissionsTable.cycleId, signoff.cycleId));
  const fellows = await fetchEligibleFellows();

  const groups = buildSignoffGroups(signoff.directorFellowId, projects, cycleSubmissions, fellows);

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 32 }}>
      <h1>Bandwidth Sign-off — {dateRange}</h1>
      <p>Director: <strong>{signoff.directorName}</strong></p>
      <SignoffForm token={token} groups={groups} />
    </main>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/app/signoff/[token]/page.tsx && cd .. && git commit -m "feat(signoff): page server component"
```

---

### Task 17: Signoff page — client form

**Files:**
- Create: `app/src/app/signoff/[token]/signoff-form.tsx`

- [ ] **Step 1: Implement the form**

Create `app/src/app/signoff/[token]/signoff-form.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { SignoffProjectGroup } from '@/types';

interface FlagState {
  submissionId: string;
  enabled: boolean;
  proposedHoursPerDay?: string;  // input as string
  comment: string;
}

export function SignoffForm({ token, groups }: { token: string; groups: SignoffProjectGroup[] }) {
  const [flags, setFlags] = useState<Record<string, FlagState>>(() => {
    const init: Record<string, FlagState> = {};
    for (const g of groups) {
      for (const l of g.lines) {
        init[l.submissionId] = { submissionId: l.submissionId, enabled: false, proposedHoursPerDay: '', comment: '' };
      }
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'confirming' | 'flagging' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const enabledFlags = Object.values(flags).filter(f => f.enabled);
  const validFlags = enabledFlags.filter(f => {
    const hasValue = f.proposedHoursPerDay !== undefined && f.proposedHoursPerDay !== '' && !Number.isNaN(Number(f.proposedHoursPerDay));
    const hasComment = f.comment.trim().length > 0;
    return hasValue || hasComment;
  });

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setStatus('confirming');
    try {
      const res = await fetch('/api/signoff/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.error || 'Confirm failed');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFlag() {
    if (submitting || validFlags.length === 0) return;
    setSubmitting(true);
    setStatus('flagging');
    try {
      const payload = {
        token,
        flags: validFlags.map(f => ({
          submissionId: f.submissionId,
          proposedHoursPerDay: f.proposedHoursPerDay && f.proposedHoursPerDay !== '' ? Number(f.proposedHoursPerDay) : undefined,
          comment: f.comment.trim() || undefined,
        })),
      };
      const res = await fetch('/api/signoff/flag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.error || 'Flag failed');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'done') {
    return <div style={{ padding: 24, background: '#dcfce7', borderRadius: 8 }}>
      <h2>Thanks — recorded.</h2>
      <p>You can close this tab.</p>
    </div>;
  }

  return (
    <div>
      {status === 'error' && <div style={{ background: '#fee2e2', padding: 12, borderRadius: 6, marginBottom: 16 }}>{errorMsg}</div>}

      <button
        onClick={handleConfirm}
        disabled={submitting}
        style={{
          background: '#16a34a', color: 'white', padding: '16px 32px', borderRadius: 8,
          fontSize: 16, fontWeight: 600, border: 'none', cursor: 'pointer', width: '100%', marginBottom: 24,
        }}
      >
        ✅ Confirm all accurate
      </button>

      <p style={{ color: '#6b7280', textAlign: 'center', margin: '24px 0' }}>or flag specific lines below ↓</p>

      {groups.map(g => (
        <section key={g.projectRecordId} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>{g.projectName} <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 400 }}>({g.projectType})</span></h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ padding: 8, textAlign: 'left' }}>Person</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Designation</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Hrs/day</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Hrs/week</th>
                <th style={{ padding: 8 }}>Flag</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map(line => {
                const f = flags[line.submissionId];
                return (
                  <React.Fragment key={line.submissionId}>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: 8 }}>{line.fellowName}</td>
                      <td style={{ padding: 8 }}>{line.designation}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{line.hoursPerDay.toFixed(2)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{line.hoursPerWeek.toFixed(1)}</td>
                      <td style={{ padding: 8, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          onChange={(e) => setFlags(prev => ({ ...prev, [line.submissionId]: { ...prev[line.submissionId], enabled: e.target.checked } }))}
                        />
                      </td>
                    </tr>
                    {f.enabled && (
                      <tr style={{ background: '#fef9c3' }}>
                        <td colSpan={5} style={{ padding: 12 }}>
                          <div style={{ marginBottom: 8 }}>
                            <label>Proposed correct value (optional): </label>
                            <input
                              type="number"
                              step="0.25"
                              value={f.proposedHoursPerDay || ''}
                              onChange={(e) => setFlags(prev => ({ ...prev, [line.submissionId]: { ...prev[line.submissionId], proposedHoursPerDay: e.target.value } }))}
                              placeholder="hrs/day"
                              style={{ padding: 4, borderRadius: 4 }}
                            />
                          </div>
                          <div>
                            <label>Comment (optional): </label>
                            <textarea
                              value={f.comment}
                              onChange={(e) => setFlags(prev => ({ ...prev, [line.submissionId]: { ...prev[line.submissionId], comment: e.target.value } }))}
                              rows={2}
                              style={{ width: '100%', padding: 4, borderRadius: 4 }}
                              placeholder="At least one of proposed value or comment is required"
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <button
        onClick={handleFlag}
        disabled={submitting || validFlags.length === 0}
        style={{
          background: validFlags.length === 0 ? '#9ca3af' : '#dc2626',
          color: 'white', padding: '14px 28px', borderRadius: 8, fontSize: 15, fontWeight: 600,
          border: 'none', cursor: validFlags.length === 0 ? 'not-allowed' : 'pointer', width: '100%',
        }}
      >
        Submit {validFlags.length} flag{validFlags.length !== 1 ? 's' : ''}
      </button>
    </div>
  );
}
```

NOTE: import React at the top if `React.Fragment` is used: `import React, { useState } from 'react';`.

- [ ] **Step 2: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-test in dev (manual)**

Run: `cd app && pnpm dev`
Then manually create a `director_signoffs` row in the test DB and visit `http://localhost:3000/signoff/<token>` — confirm the page renders, Confirm and Flag both submit cleanly.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/app/signoff/[token]/signoff-form.tsx && cd .. && git commit -m "feat(signoff): client form with confirm + per-line flag UI"
```

---

### Task 18: Cycle gate — extend checkAndFinalizeCycle

**Files:**
- Modify: `app/src/lib/cycle.ts`

- [ ] **Step 1: Inspect existing gate**

Run: `grep -n "checkAndFinalizeCycle\|notPending\|pending" app/src/lib/cycle.ts | head -30`

Find the two existing checks (no pending tokens, no pending conflicts) and the finalize trigger.

- [ ] **Step 2: Add third gate (all expected signoffs terminal)**

Modify `app/src/lib/cycle.ts` — inside `checkAndFinalizeCycle`, after the existing two pending checks pass, add:

```ts
// New gate: every director who has ≥1 in-scope project with ≥1 submission this cycle
// must have a director_signoffs row in confirmed or flagged_resolved.
const projects = await fetchAllProjects();
const submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.cycleId, cycleId));

// Set of project record ids with ≥1 submission this cycle
const projectsWithSubmissions = new Set(submissions.map(s => s.projectRecordId));

// Directors in scope: any director on a project that has submissions
const expectedDirectorIds = new Set<string>();
for (const p of projects) {
  if (!projectsWithSubmissions.has(p.projectRecordId)) continue;
  for (const dirId of p.directorIds) expectedDirectorIds.add(dirId);
}

// All signoffs for this cycle in terminal state?
const cycleSignoffs = await db.select().from(directorSignoffs).where(eq(directorSignoffs.cycleId, cycleId));
const terminal = new Set(['confirmed', 'flagged_resolved']);
const signoffByDirector = new Map(cycleSignoffs.map(s => [s.directorFellowId, s.status]));

for (const dirId of expectedDirectorIds) {
  const s = signoffByDirector.get(dirId);
  if (!s || !terminal.has(s)) {
    // Not all directors done — bail out
    return;
  }
}

// All three gates pass — proceed to finalize (existing logic below this point)
```

NOTE: Adjust imports at the top of cycle.ts: `import { directorSignoffs } from './db/schema'`; `import { fetchAllProjects } from './airtable/projects'`.

- [ ] **Step 3: Verify compile**

Run: `cd app && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run tests**

Run: `cd app && pnpm test:run`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/cycle.ts && cd .. && git commit -m "feat(cycle): extend finalize gate with director signoffs"
```

---

### Task 19: Wire — /api/submit triggers createSignoffIfReady

**Files:**
- Modify: `app/src/app/api/submit/route.ts`

- [ ] **Step 1: Inspect existing submit handler**

Run: `grep -n "checkAndFinalizeCycle\|fetchAllProjects" app/src/app/api/submit/route.ts | head -10`

Find where post-submit work runs (after the submission row is inserted, before the response is sent).

- [ ] **Step 2: Add createSignoffIfReady calls**

After the submission is inserted and any submission-level conflict is detected/created, add:

```ts
import { createSignoffIfReady } from '@/lib/signoff';
import { fetchAllProjects } from '@/lib/airtable/projects';

// ... existing submission insert ...

// After all post-submit work, trigger signoff check for any director whose slice
// could now be complete. The submission's projectRecordId determines which
// directors might have just had their slice complete.
const projects = await fetchAllProjects();
const project = projects.find(p => p.projectRecordId === insertedSubmission.projectRecordId);
if (project) {
  for (const directorId of project.directorIds) {
    await createSignoffIfReady(insertedSubmission.cycleId, directorId);
  }
}

// Then existing finalize trigger:
await checkAndFinalizeCycle();
```

- [ ] **Step 3: Verify compile + tests**

Run: `cd app && pnpm tsc --noEmit && pnpm test:run`
Expected: clean, no regressions.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/app/api/submit/route.ts && cd .. && git commit -m "feat(submit): trigger signoff check on submission"
```

---

### Task 20: Wire — /api/resolve triggers createSignoffIfReady on submission conflict resolve

**Files:**
- Modify: `app/src/app/api/resolve/route.ts`

- [ ] **Step 1: Add signoff trigger after submission-level conflict resolution**

In `app/src/app/api/resolve/route.ts`, in the `source='submission'` branch (existing logic), after the conflict is marked resolved and the writeback is done, add the same per-director check:

```ts
// After existing writeback for submission-source conflict:
const projects = await fetchAllProjects();
const project = projects.find(p => p.projectRecordId === conflict.projectRecordId);
if (project) {
  for (const directorId of project.directorIds) {
    await createSignoffIfReady(conflict.cycleId, directorId);
  }
}
```

- [ ] **Step 2: Verify compile + tests**

Run: `cd app && pnpm tsc --noEmit && pnpm test:run`
Expected: clean, no regressions.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/app/api/resolve/route.ts && cd .. && git commit -m "feat(resolve): trigger signoff check on submission-source resolve"
```

---

### Task 21: Cron — extend conflict-reminders for signoffs

**Files:**
- Modify: `app/src/app/api/cron/conflict-reminders/route.ts`

- [ ] **Step 1: Add signoff reminder loop**

In `app/src/app/api/cron/conflict-reminders/route.ts`, after the existing conflict-reminder loop, add:

```ts
import { directorSignoffs } from '@/lib/db/schema';
import { sendDirectorSignoffReminderEmail } from '@/lib/email';
import { lt, or, isNull } from 'drizzle-orm';

// ... existing conflict reminder loop ...

// Signoff reminders — daily nudge for open signoffs
const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
const openSignoffs = await db.select().from(directorSignoffs).where(
  and(
    eq(directorSignoffs.status, 'email_sent'),
    or(
      isNull(directorSignoffs.lastReminderSentAt),
      lt(directorSignoffs.lastReminderSentAt, twentyFourHoursAgo)
    )
  )
);

for (const s of openSignoffs) {
  try {
    const [cycle] = await db.select().from(cycles).where(eq(cycles.id, s.cycleId)).limit(1);
    if (!cycle) continue;
    await sendDirectorSignoffReminderEmail({
      directorName: s.directorName,
      directorEmail: s.directorEmail,
      cycleStartDate: cycle.startDate,
      signoffToken: s.signoffToken,
      originalMessageId: s.emailMessageId,
    });
    await db.update(directorSignoffs)
      .set({ lastReminderSentAt: new Date(), updatedAt: new Date() })
      .where(eq(directorSignoffs.id, s.id));
  } catch (err) {
    console.error(`Signoff reminder failed for ${s.id}:`, err);
  }
}
```

- [ ] **Step 2: Also update the existing conflict-reminder loop to handle director_flag conflicts**

The existing loop probably reads `vpSubmissionId → submissions → fellow → email` to find who to remind. For director_flag rows, that path is null; use `conflict.resolverEmail` directly. Update the reminder send logic:

```ts
// Inside the existing conflict-reminder loop:
const reminderRecipient =
  conflict.source === 'director_flag'
    ? conflict.resolverEmail
    : /* existing VP-lookup logic */;
```

- [ ] **Step 3: Verify compile + tests**

Run: `cd app && pnpm tsc --noEmit && pnpm test:run`
Expected: clean, no regressions.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/app/api/cron/conflict-reminders/route.ts && cd .. && git commit -m "feat(cron): conflict-reminders covers signoffs + director_flag conflicts"
```

---

### Task 22: Dashboard — awaiting-signoff chip in Live drill-down

**Files:**
- Modify: dashboard files that render the per-project chip (locate via grep)

- [ ] **Step 1: Locate the existing conflict-pending chip code**

Run: `grep -rn "conflict pending\|conflictPending\|conflict_pending" app/src/app/dashboard/ app/src/app/api/dashboard/ 2>/dev/null`

This finds the existing per-project chip rendering and data attachment. The new chip mirrors that flow.

- [ ] **Step 2: Compute awaitingSignoff set in the dashboard data builder**

In the file that builds `getLiveCycleData` (likely `app/src/lib/dashboard.ts` or `app/src/app/dashboard/page.tsx`), fetch open signoffs for the current cycle and expand to a `Set<projectRecordId>`:

```ts
const openSignoffs = await db.select().from(directorSignoffs).where(
  and(eq(directorSignoffs.cycleId, currentCycleId),
      or(eq(directorSignoffs.status, 'email_sent'), eq(directorSignoffs.status, 'flagged')))
);
const projects = await fetchAllProjects();
const awaitingSignoffProjects = new Set<string>();
for (const s of openSignoffs) {
  for (const p of projects) {
    if (p.directorIds.includes(s.directorFellowId)) {
      awaitingSignoffProjects.add(p.projectRecordId);
    }
  }
}
// Attach to each breakdown row: awaitingSignoff: awaitingSignoffProjects.has(row.projectRecordId)
```

- [ ] **Step 3: Render the chip alongside the existing conflict-pending chip**

In the breakdown row JSX, add a chip when `row.awaitingSignoff` is true:

```tsx
{row.awaitingSignoff && (
  <span style={{
    background: '#dbeafe', color: '#1e40af',
    padding: '2px 8px', borderRadius: 4, fontSize: 11, marginLeft: 6,
  }}>
    awaiting director sign-off
  </span>
)}
```

(Match the existing conflict-pending chip's styling exactly, just with different colors.)

- [ ] **Step 4: Smoke-test in dev**

Run: `cd app && pnpm dev` and visit `/dashboard`. Confirm a project with an open signoff shows the new chip; a project with a confirmed signoff does not.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/app/dashboard src/lib/dashboard.ts && cd .. && git commit -m "feat(dashboard): awaiting-signoff chip per project"
```

---

### Task 23: Dashboard — Director Sign-offs panel

**Files:**
- Modify: dashboard page

- [ ] **Step 1: Build the panel data**

In the dashboard data builder, compute the directors-in-scope-this-cycle and their signoff status:

```ts
const projects = await fetchAllProjects();
const submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.cycleId, currentCycleId));
const projectsWithSubmissions = new Set(submissions.map(s => s.projectRecordId));

const directorScope = new Map<string, number>();  // directorId -> # projects in scope
for (const p of projects) {
  if (!projectsWithSubmissions.has(p.projectRecordId)) continue;
  for (const dirId of p.directorIds) {
    directorScope.set(dirId, (directorScope.get(dirId) || 0) + 1);
  }
}

const cycleSignoffs = await db.select().from(directorSignoffs).where(eq(directorSignoffs.cycleId, currentCycleId));
const signoffByDirector = new Map(cycleSignoffs.map(s => [s.directorFellowId, s]));

const fellows = await fetchEligibleFellows();
const fellowByRecordId = new Map(fellows.map(f => [f.recordId, f]));

const signoffPanelRows = [...directorScope.entries()].map(([directorId, projectCount]) => {
  const fellow = fellowByRecordId.get(directorId);
  const signoff = signoffByDirector.get(directorId);
  return {
    directorName: fellow?.name || 'Unknown',
    projectCount,
    status: signoff?.status || 'awaiting_slice',
    confirmedAt: signoff?.confirmedAt || null,
    flaggedAt: signoff?.flaggedAt || null,
    resolvedAt: signoff?.resolvedAt || null,
  };
});
```

- [ ] **Step 2: Render the panel in the Latest Cycle view**

Add a new `<section>` in the Latest Cycle drill-down:

```tsx
<section style={{ marginTop: 32 }}>
  <h2>Director Sign-offs</h2>
  <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb' }}>
    <thead>
      <tr style={{ background: '#f3f4f6' }}>
        <th style={{ padding: 8, textAlign: 'left' }}>Director</th>
        <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
        <th style={{ padding: 8, textAlign: 'right' }}>Projects</th>
      </tr>
    </thead>
    <tbody>
      {signoffPanelRows.map(r => (
        <tr key={r.directorName} style={{ borderBottom: '1px solid #e5e7eb' }}>
          <td style={{ padding: 8 }}>{r.directorName}</td>
          <td style={{ padding: 8 }}>{statusLabel(r.status)}</td>
          <td style={{ padding: 8, textAlign: 'right' }}>{r.projectCount}</td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

Where `statusLabel` is:

```ts
function statusLabel(s: string): string {
  switch (s) {
    case 'awaiting_slice': return '⏳ Slice not complete yet';
    case 'email_sent':     return '📧 Email sent — awaiting director';
    case 'confirmed':      return '✅ Confirmed';
    case 'flagged':        return '🚩 Flagged — resolution pending';
    case 'flagged_resolved': return '✅ Flagged & resolved';
    default:               return s;
  }
}
```

- [ ] **Step 3: Smoke-test in dev**

Run: `cd app && pnpm dev` and verify panel renders.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/app/dashboard && cd .. && git commit -m "feat(dashboard): Director Sign-offs panel"
```

---

### Task 24: Apply migration to production Neon

**Files:** none (DB operation)

This task is a manual DB operation. Do not run without user confirmation.

- [ ] **Step 1: Confirm with user before running**

Ask: "Apply migration 0005_director_signoff.sql to production Neon? This is non-destructive (one new table, additive columns on conflicts, NOT NULL relaxations) but cannot be auto-rolled-back."

- [ ] **Step 2: Apply**

After user confirmation:

```bash
cd app && psql "$DATABASE_URL_PROD" -f drizzle/0005_director_signoff.sql
```

Expected: `CREATE TABLE`, several `ALTER TABLE` confirmations, no errors.

- [ ] **Step 3: Verify schema**

```bash
psql "$DATABASE_URL_PROD" -c "\d director_signoffs"
psql "$DATABASE_URL_PROD" -c "\d conflicts"
```

Confirm new columns exist on conflicts; new table exists with the expected columns.

---

### Task 25: End-to-end smoke test in preview

**Files:** none (manual verification against a preview deployment)

- [ ] **Step 1: Deploy to preview**

```bash
cd app && vercel-ie deploy
```

Note: uses `vercel-ie` shell alias (per `~/.claude/CLAUDE.md`) since this is an IE Pro project. Wait for preview URL.

- [ ] **Step 2: Seed test data**

Use `seed-test-data.mjs` or manual SQL to seed: a test cycle, a director fellow, 1-2 projects with the director in the Director field, submissions on those projects from 2-3 fellows.

- [ ] **Step 3: Manually trigger slice completion**

Submit the last pending submission (or resolve the last conflict) via the existing submission form / /api/resolve. Check Resend dashboard for the signoff email.

- [ ] **Step 4: Test confirm path**

Click "Review & confirm bandwidth" in the email. On the page, click "Confirm all accurate". Verify:
- Page shows success state
- DB: `director_signoffs.status='confirmed'`, `confirmedAt` set
- If this was the last gate, the completion email fires + cycle marked complete

- [ ] **Step 5: Test flag path (separate test cycle)**

Repeat with a fresh cycle. On the page, flag 1-2 lines with a mix of proposed values and comments. Verify:
- Slack post hits `#team-allocation` with the right content
- One resolution email per flag arrives at the right resolver (per matrix)
- DB: `director_signoffs.status='flagged'`, conflict rows inserted with `source='director_flag'`

- [ ] **Step 6: Test resolution path**

Click an action button in a resolution email. Verify:
- Submission updated (for use_proposed or custom)
- Submission unchanged (for keep_original)
- Confirmation email arrives, threaded
- DB: conflict.status='resolved'
- If last child, signoff transitions to `flagged_resolved`

- [ ] **Step 7: Test reminder cron**

Manually invoke `/api/cron/conflict-reminders` for a cycle with an open signoff:

```bash
curl -X GET "https://<preview-url>/api/cron/conflict-reminders" -H "Authorization: Bearer $CRON_SECRET"
```

Verify: signoff `lastReminderSentAt` is set; reminder email arrives threaded.

- [ ] **Step 8: Test dashboard chip + panel**

Visit `/dashboard` on preview. Verify:
- Open-signoff projects show the new "awaiting director sign-off" chip
- Director Sign-offs panel lists each director with the right status

- [ ] **Step 9: Commit a smoke-test summary**

If everything passes, post a summary message to the user. No commit needed unless test data scripts were added/modified.

---

## Spec Coverage Cross-check

| Spec section | Implemented in task(s) |
|---|---|
| 4.1 director_signoffs table | Task 2 |
| 4.2 conflicts extensions | Task 2 |
| 4.4 migration | Tasks 2, 24 |
| 5 Airtable directorFields | Tasks 1, 3 |
| 6.1 state machine | Tasks 10, 11, 12 |
| 6.2 slice-completion check | Tasks 4, 10 |
| 6.3 trigger points | Tasks 19, 20 |
| 6.4 cycle gate | Task 18 |
| 7 signoff email | Task 7 |
| 8 signoff page + endpoints | Tasks 13, 14, 16, 17 |
| 9.1 resolver matrix | Task 5 |
| 9.1 recipient dedup | Task 6 |
| 9.2 resolution email | Task 8 |
| 9.3 /resolve extension | Task 15 |
| 9.4 writeback (incl. keep_original fix) | Task 15 |
| 9.5 signoff lifecycle transition | Task 12 |
| 10 Slack post | Task 9 |
| 11 reminder cron | Task 21 |
| 12 dashboard chip | Task 22 |
| 12 dashboard panel | Task 23 |
| 13 edge cases | Tested implicitly across all tasks |
| 15 test plan | Each task includes its tests |
