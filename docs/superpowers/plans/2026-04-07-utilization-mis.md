# Utilization MIS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated bandwidth collection, scoring, cross-referencing, and utilization reporting system for IndigoEdge, replacing bi-weekly verbal meetings with email-driven async data collection and persistent dashboards.

**Architecture:** Next.js 15 (App Router) on Vercel. Neon Postgres (via Vercel Marketplace) stores submissions, cycles, tokens, conflicts, and historical snapshots. Airtable is the source of truth for projects and fellows (read) and receives bandwidth narrative updates (write). Resend sends transactional email. Slack webhook posts to #team-allocation.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, Neon Postgres, Resend, Tailwind CSS, Vitest, Recharts

**Spec:** `docs/superpowers/specs/2026-04-07-utilization-mis-design.md`

---

## File Structure

```
app/                                    # Next.js project root (within Utilization MIS/)
├── package.json
├── next.config.ts
├── vercel.ts                           # Vercel config (crons, etc.)
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── .env.local.example
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # Redirect to /dashboard
│   │   ├── submit/
│   │   │   └── [token]/
│   │   │       ├── page.tsx            # Server: validate token, fetch projects
│   │   │       └── form.tsx            # Client: bandwidth input form
│   │   ├── submitted/
│   │   │   └── page.tsx                # Confirmation after submission
│   │   ├── resolve/
│   │   │   └── [token]/
│   │   │       ├── page.tsx            # Server: fetch conflict data
│   │   │       └── form.tsx            # Client: custom hours input
│   │   ├── resolved/
│   │   │   └── page.tsx                # Confirmation after resolution
│   │   ├── admin/
│   │   │   ├── page.tsx                # Server: fetch cycle + fellows
│   │   │   └── fellows-list.tsx        # Client: toggle not_needed
│   │   ├── dashboard/
│   │   │   ├── page.tsx                # Utilization overview (month-by-month)
│   │   │   └── [fellowId]/
│   │   │       └── page.tsx            # Per-person drill-down
│   │   └── api/
│   │       ├── cron/
│   │       │   ├── start-cycle/route.ts
│   │       │   └── send-reminders/route.ts
│   │       ├── submit/route.ts
│   │       ├── resolve/route.ts
│   │       └── admin/toggle/route.ts
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts                # Drizzle client export
│   │   │   └── schema.ts              # All 5 table schemas
│   │   ├── airtable/
│   │   │   ├── client.ts              # Base fetch/update helpers
│   │   │   ├── config.ts              # Per-table field name mappings
│   │   │   ├── fellows.ts             # Fetch eligible fellows
│   │   │   ├── projects.ts            # Fetch projects + team assignments
│   │   │   └── writeback.ts           # Generate narratives, write to Airtable
│   │   ├── scoring.ts                 # Normalize hours, score, MEU mapping
│   │   ├── utilization.ts             # MEU aggregation, load tags
│   │   ├── conflicts.ts               # Detect VP vs Associate discrepancy
│   │   ├── cycle.ts                   # Cycle lifecycle (start, check, finalize)
│   │   ├── email.ts                   # Resend client + all email templates
│   │   └── slack.ts                   # Slack webhook client
│   └── types.ts                       # Shared TypeScript types
├── tests/
│   ├── scoring.test.ts
│   ├── utilization.test.ts
│   ├── conflicts.test.ts
│   ├── cycle.test.ts
│   └── writeback.test.ts
└── drizzle/                            # Generated migration SQL
```

## Environment Variables

```bash
# Database
DATABASE_URL=                          # Neon Postgres connection string

# Airtable
AIRTABLE_API_KEY=                      # Personal access token
AIRTABLE_BASE_ID=appmsoOuN72RJ9Qho

# Email
RESEND_API_KEY=                        # Resend API key
EMAIL_FROM=bandwidth@indigoedge.com    # Verified sender (configure domain in Resend)

# Slack
SLACK_WEBHOOK_URL=                     # #team-allocation incoming webhook

# App
APP_URL=                               # Stable app URL (e.g., https://utilization.indigoedge.com)
ADMIN_EMAIL=ajder@indigoedge.com
CC_EMAIL=                              # Pai's email for conflict CC

# Security
CRON_SECRET=                           # Bearer token for cron route auth
```

---

## Phase 1: Foundation

### Task 1: Project Scaffolding & Database Schema

**Files:**
- Create: `app/` (entire Next.js project)
- Create: `app/src/lib/db/schema.ts`
- Create: `app/src/lib/db/index.ts`
- Create: `app/src/types.ts`
- Create: `app/vitest.config.ts`
- Create: `app/drizzle.config.ts`
- Create: `app/.env.local.example`

- [ ] **Step 1: Scaffold Next.js project**

```bash
cd "/Users/ajder/Documents/IndigoEdge/Utilization MIS"
npx create-next-app@latest app --typescript --tailwind --eslint --app --src-dir --use-pnpm --no-import-alias
```

- [ ] **Step 2: Install dependencies**

```bash
cd app
pnpm add drizzle-orm @neondatabase/serverless resend recharts
pnpm add -D drizzle-kit vitest @types/node
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
// app/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Create drizzle.config.ts**

```typescript
// app/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 5: Create .env.local.example**

Copy the environment variables section above into `app/.env.local.example`.

- [ ] **Step 6: Write database schema**

```typescript
// app/src/lib/db/schema.ts
import { pgTable, uuid, text, date, timestamp, real, integer, boolean, jsonb } from 'drizzle-orm/pg-core';

export const cycles = pgTable('cycles', {
  id: uuid('id').defaultRandom().primaryKey(),
  startDate: date('start_date').notNull(),
  status: text('status', { enum: ['collecting', 'complete'] }).notNull().default('collecting'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tokens = pgTable('tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  fellowRecordId: text('fellow_record_id').notNull(),
  fellowName: text('fellow_name').notNull(),
  fellowEmail: text('fellow_email').notNull(),
  fellowDesignation: text('fellow_designation').notNull(),
  token: text('token').unique().notNull(),
  status: text('status', { enum: ['pending', 'submitted', 'not_needed'] }).notNull().default('pending'),
  submittedAt: timestamp('submitted_at'),
});

export const submissions = pgTable('submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  fellowRecordId: text('fellow_record_id').notNull(),
  projectRecordId: text('project_record_id').notNull(),
  projectName: text('project_name').notNull(),
  projectType: text('project_type', { enum: ['mandate', 'dde', 'pitch'] }).notNull(),
  hoursValue: real('hours_value').notNull(),
  hoursUnit: text('hours_unit', { enum: ['per_day', 'per_week'] }).notNull(),
  hoursPerDay: real('hours_per_day').notNull(),
  autoScore: integer('auto_score').notNull(),
  autoMeu: real('auto_meu').notNull(),
  isSelfReport: boolean('is_self_report').notNull(),
  targetFellowId: text('target_fellow_id'),
  remarks: text('remarks'),
});

export const conflicts = pgTable('conflicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  projectRecordId: text('project_record_id').notNull(),
  vpSubmissionId: uuid('vp_submission_id').references(() => submissions.id).notNull(),
  associateSubmissionId: uuid('associate_submission_id').references(() => submissions.id).notNull(),
  vpHoursPerDay: real('vp_hours_per_day').notNull(),
  associateHoursPerDay: real('associate_hours_per_day').notNull(),
  difference: real('difference').notNull(),
  status: text('status', { enum: ['pending', 'resolved'] }).notNull().default('pending'),
  resolvedHoursPerDay: real('resolved_hours_per_day'),
  resolvedBy: text('resolved_by'),
  resolutionToken: text('resolution_token'),
});

export const snapshots = pgTable('snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  fellowRecordId: text('fellow_record_id').notNull(),
  fellowName: text('fellow_name').notNull(),
  designation: text('designation').notNull(),
  capacityMeu: real('capacity_meu').notNull(),
  totalMeu: real('total_meu').notNull(),
  utilizationPct: real('utilization_pct').notNull(),
  loadTag: text('load_tag').notNull(),
  projectBreakdown: jsonb('project_breakdown').notNull(),
  snapshotDate: date('snapshot_date').notNull(),
});
```

- [ ] **Step 7: Create DB client**

```typescript
// app/src/lib/db/index.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

- [ ] **Step 8: Create shared types**

```typescript
// app/src/types.ts
export type ProjectType = 'mandate' | 'dde' | 'pitch';
export type HoursUnit = 'per_day' | 'per_week';
export type LoadTag = 'Free' | 'Comfortable' | 'Busy' | 'At Capacity' | 'Overloaded';
export type TokenStatus = 'pending' | 'submitted' | 'not_needed';
export type ConflictResolution = 'vp_number' | 'associate_number' | 'custom';

export interface Fellow {
  recordId: string;
  name: string;
  email: string;
  designation: string;
  capacityMeu: number;
}

export interface ProjectAssignment {
  projectRecordId: string;
  projectName: string;
  projectType: ProjectType;
  stage: string;
  vpAvpIds: string[];
  associateIds: string[];
}

export interface SubmissionEntry {
  projectRecordId: string;
  projectName: string;
  projectType: ProjectType;
  targetFellowId: string | null;
  hoursValue: number;
  hoursUnit: HoursUnit;
}

export interface ProjectBreakdownItem {
  projectName: string;
  projectType: ProjectType;
  score: number;
  meu: number;
  hoursPerDay: number;
}
```

- [ ] **Step 9: Generate migration**

```bash
cd app
pnpm drizzle-kit generate
```

Expected: creates `drizzle/0000_*.sql` with CREATE TABLE statements for all 5 tables.

- [ ] **Step 10: Verify types compile**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat: scaffold Next.js app with DB schema and shared types"
```

---

## Phase 2: Core Business Logic

### Task 2: Scoring Engine (TDD)

**Files:**
- Test: `app/tests/scoring.test.ts`
- Create: `app/src/lib/scoring.ts`

**Depends on:** Task 1

- [ ] **Step 1: Write failing tests**

```typescript
// app/tests/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeToHoursPerDay, scoreHours } from '../src/lib/scoring';

describe('normalizeToHoursPerDay', () => {
  it('returns per_day values unchanged', () => {
    expect(normalizeToHoursPerDay(4, 'per_day')).toBe(4);
  });

  it('divides per_week by 5', () => {
    expect(normalizeToHoursPerDay(10, 'per_week')).toBe(2);
  });

  it('handles zero', () => {
    expect(normalizeToHoursPerDay(0, 'per_week')).toBe(0);
  });
});

describe('scoreHours — mandates', () => {
  it('scores 0 hrs/day as 1, MEU 0.25', () => {
    expect(scoreHours(0, 'mandate')).toEqual({ score: 1, meu: 0.25 });
  });

  it('scores 1.49 hrs/day as 1', () => {
    expect(scoreHours(1.49, 'mandate')).toEqual({ score: 1, meu: 0.25 });
  });

  it('scores exactly 1.5 hrs/day as 2 (boundary goes up)', () => {
    expect(scoreHours(1.5, 'mandate')).toEqual({ score: 2, meu: 0.75 });
  });

  it('scores 2 hrs/day as 2', () => {
    expect(scoreHours(2, 'mandate')).toEqual({ score: 2, meu: 0.75 });
  });

  it('scores exactly 3 hrs/day as 3', () => {
    expect(scoreHours(3, 'mandate')).toEqual({ score: 3, meu: 1.00 });
  });

  it('scores 5 hrs/day as 3', () => {
    expect(scoreHours(5, 'mandate')).toEqual({ score: 3, meu: 1.00 });
  });

  it('scores exactly 6 hrs/day as 4', () => {
    expect(scoreHours(6, 'mandate')).toEqual({ score: 4, meu: 1.25 });
  });

  it('scores 7.5 hrs/day as 4', () => {
    expect(scoreHours(7.5, 'mandate')).toEqual({ score: 4, meu: 1.25 });
  });

  it('scores exactly 8 hrs/day as 5', () => {
    expect(scoreHours(8, 'mandate')).toEqual({ score: 5, meu: 1.50 });
  });

  it('scores 10 hrs/day as 5', () => {
    expect(scoreHours(10, 'mandate')).toEqual({ score: 5, meu: 1.50 });
  });
});

describe('scoreHours — dde/pitch (1/3 intensity)', () => {
  it('scores 0 hrs/day as 1, MEU 0.10', () => {
    expect(scoreHours(0, 'dde')).toEqual({ score: 1, meu: 0.10 });
  });

  it('scores 0.49 hrs/day as 1', () => {
    expect(scoreHours(0.49, 'dde')).toEqual({ score: 1, meu: 0.10 });
  });

  it('scores exactly 0.5 hrs/day as 2', () => {
    expect(scoreHours(0.5, 'dde')).toEqual({ score: 2, meu: 0.20 });
  });

  it('scores exactly 1 hr/day as 3', () => {
    expect(scoreHours(1, 'pitch')).toEqual({ score: 3, meu: 0.30 });
  });

  it('scores 1.5 hrs/day as 3', () => {
    expect(scoreHours(1.5, 'dde')).toEqual({ score: 3, meu: 0.30 });
  });

  it('scores exactly 2 hrs/day as 4', () => {
    expect(scoreHours(2, 'dde')).toEqual({ score: 4, meu: 0.40 });
  });

  it('scores exactly 3 hrs/day as 5', () => {
    expect(scoreHours(3, 'pitch')).toEqual({ score: 5, meu: 0.50 });
  });

  it('scores 5 hrs/day as 5', () => {
    expect(scoreHours(5, 'pitch')).toEqual({ score: 5, meu: 0.50 });
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
cd app && pnpm vitest run tests/scoring.test.ts
```

Expected: all tests FAIL (module not found).

- [ ] **Step 3: Write implementation**

```typescript
// app/src/lib/scoring.ts
import type { ProjectType, HoursUnit } from '@/types';

export function normalizeToHoursPerDay(value: number, unit: HoursUnit): number {
  return unit === 'per_week' ? value / 5 : value;
}

export function scoreHours(hoursPerDay: number, projectType: ProjectType): { score: number; meu: number } {
  if (projectType === 'mandate') return scoreMandateHours(hoursPerDay);
  return scoreDdePitchHours(hoursPerDay);
}

function scoreMandateHours(h: number): { score: number; meu: number } {
  if (h < 1.5) return { score: 1, meu: 0.25 };
  if (h < 3)   return { score: 2, meu: 0.75 };
  if (h < 6)   return { score: 3, meu: 1.00 };
  if (h < 8)   return { score: 4, meu: 1.25 };
  return { score: 5, meu: 1.50 };
}

function scoreDdePitchHours(h: number): { score: number; meu: number } {
  if (h < 0.5) return { score: 1, meu: 0.10 };
  if (h < 1)   return { score: 2, meu: 0.20 };
  if (h < 2)   return { score: 3, meu: 0.30 };
  if (h < 3)   return { score: 4, meu: 0.40 };
  return { score: 5, meu: 0.50 };
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd app && pnpm vitest run tests/scoring.test.ts
```

Expected: all 18 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring.ts tests/scoring.test.ts
git commit -m "feat: scoring engine with mandate and DDE/pitch tables"
```

---

### Task 3: Utilization Calculator (TDD)

**Files:**
- Test: `app/tests/utilization.test.ts`
- Create: `app/src/lib/utilization.ts`

**Depends on:** Task 1

- [ ] **Step 1: Write failing tests**

```typescript
// app/tests/utilization.test.ts
import { describe, it, expect } from 'vitest';
import { sumMeu, calculateUtilization, getLoadTag } from '../src/lib/utilization';

describe('sumMeu', () => {
  it('sums an array of MEU values', () => {
    expect(sumMeu([1.00, 0.75, 0.30])).toBeCloseTo(2.05);
  });

  it('returns 0 for empty array', () => {
    expect(sumMeu([])).toBe(0);
  });

  it('handles single value', () => {
    expect(sumMeu([1.50])).toBe(1.50);
  });
});

describe('calculateUtilization', () => {
  it('calculates totalMeu / capacityMeu', () => {
    expect(calculateUtilization(2.25, 3.0)).toBeCloseTo(0.75);
  });

  it('returns 0 when capacity is 0', () => {
    expect(calculateUtilization(1.0, 0)).toBe(0);
  });

  it('can exceed 1.0 for overloaded fellows', () => {
    expect(calculateUtilization(4.0, 3.0)).toBeCloseTo(1.333, 2);
  });

  it('returns 0 when totalMeu is 0', () => {
    expect(calculateUtilization(0, 3.0)).toBe(0);
  });
});

describe('getLoadTag', () => {
  it('Free for < 0.30', () => {
    expect(getLoadTag(0)).toBe('Free');
    expect(getLoadTag(0.15)).toBe('Free');
    expect(getLoadTag(0.29)).toBe('Free');
  });

  it('Comfortable for 0.30 to < 0.60', () => {
    expect(getLoadTag(0.30)).toBe('Comfortable');
    expect(getLoadTag(0.45)).toBe('Comfortable');
    expect(getLoadTag(0.59)).toBe('Comfortable');
  });

  it('Busy for 0.60 to < 0.85', () => {
    expect(getLoadTag(0.60)).toBe('Busy');
    expect(getLoadTag(0.75)).toBe('Busy');
    expect(getLoadTag(0.84)).toBe('Busy');
  });

  it('At Capacity for 0.85 to 1.00', () => {
    expect(getLoadTag(0.85)).toBe('At Capacity');
    expect(getLoadTag(0.95)).toBe('At Capacity');
    expect(getLoadTag(1.00)).toBe('At Capacity');
  });

  it('Overloaded for > 1.00', () => {
    expect(getLoadTag(1.01)).toBe('Overloaded');
    expect(getLoadTag(1.50)).toBe('Overloaded');
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
cd app && pnpm vitest run tests/utilization.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write implementation**

```typescript
// app/src/lib/utilization.ts
import type { LoadTag } from '@/types';

export function sumMeu(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}

export function calculateUtilization(totalMeu: number, capacityMeu: number): number {
  if (capacityMeu <= 0) return 0;
  return totalMeu / capacityMeu;
}

export function getLoadTag(utilization: number): LoadTag {
  if (utilization < 0.30) return 'Free';
  if (utilization < 0.60) return 'Comfortable';
  if (utilization < 0.85) return 'Busy';
  if (utilization <= 1.00) return 'At Capacity';
  return 'Overloaded';
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd app && pnpm vitest run tests/utilization.test.ts
```

Expected: all 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utilization.ts tests/utilization.test.ts
git commit -m "feat: utilization calculator with MEU aggregation and load tags"
```

---

### Task 4: Conflict Detection (TDD)

**Files:**
- Test: `app/tests/conflicts.test.ts`
- Create: `app/src/lib/conflicts.ts`

**Depends on:** Task 1

- [ ] **Step 1: Write failing tests**

```typescript
// app/tests/conflicts.test.ts
import { describe, it, expect } from 'vitest';
import { isConflict, CONFLICT_THRESHOLD_HOURS } from '../src/lib/conflicts';

describe('isConflict', () => {
  it('exports threshold as 2 hours', () => {
    expect(CONFLICT_THRESHOLD_HOURS).toBe(2);
  });

  it('returns false when difference is 0', () => {
    expect(isConflict(4, 4)).toBe(false);
  });

  it('returns false when difference is under 2 hrs', () => {
    expect(isConflict(4, 3)).toBe(false);
    expect(isConflict(3, 4.5)).toBe(false);
  });

  it('returns false when difference is exactly 2 hrs', () => {
    expect(isConflict(5, 3)).toBe(false);
  });

  it('returns true when difference exceeds 2 hrs', () => {
    expect(isConflict(6, 3)).toBe(true);
  });

  it('detects conflict regardless of direction', () => {
    expect(isConflict(1, 4)).toBe(true);
  });

  it('handles small decimals', () => {
    expect(isConflict(3.01, 1)).toBe(true);
    expect(isConflict(3.0, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
cd app && pnpm vitest run tests/conflicts.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write implementation**

```typescript
// app/src/lib/conflicts.ts
export const CONFLICT_THRESHOLD_HOURS = 2;

export function isConflict(vpHoursPerDay: number, associateHoursPerDay: number): boolean {
  return Math.abs(vpHoursPerDay - associateHoursPerDay) > CONFLICT_THRESHOLD_HOURS;
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd app && pnpm vitest run tests/conflicts.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conflicts.ts tests/conflicts.test.ts
git commit -m "feat: conflict detection with 2hrs/day threshold"
```

---

## Phase 3: Airtable Integration

### Task 5: Airtable Client (Fellows & Projects)

**Files:**
- Create: `app/src/lib/airtable/client.ts`
- Create: `app/src/lib/airtable/config.ts`
- Create: `app/src/lib/airtable/fellows.ts`
- Create: `app/src/lib/airtable/projects.ts`

**Depends on:** Task 1

- [ ] **Step 1: Create Airtable HTTP client**

```typescript
// app/src/lib/airtable/client.ts
const BASE_URL = 'https://api.airtable.com/v0';

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
}

export async function fetchAllRecords(
  tableId: string,
  params: Record<string, string> = {}
): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(`${BASE_URL}/${process.env.AIRTABLE_BASE_ID}/${tableId}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Airtable ${tableId}: ${res.status} ${await res.text()}`);

    const data: AirtableListResponse = await res.json();
    all.push(...data.records);
    offset = data.offset;
  } while (offset);

  return all;
}

export async function updateRecord(
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/${process.env.AIRTABLE_BASE_ID}/${tableId}/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  );
  if (!res.ok) throw new Error(`Airtable update ${recordId}: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 2: Create table config with exact field names**

```typescript
// app/src/lib/airtable/config.ts
import type { ProjectType } from '@/types';

export const FELLOWS_TABLE_ID = 'tbl2EquvDVwvSaGVy';

// Exact Airtable field names per project table.
// VP/AVP fields and Associate fields are arrays because some tables have 2 slots.
export const TABLE_CONFIG: Record<ProjectType, {
  tableId: string;
  nameField: string;
  stageField: string;
  vpAvpFields: string[];
  associateFields: string[];
  bandwidthField: string;
}> = {
  mandate: {
    tableId: 'tblETYHFy9FnXG9TH',
    nameField: 'Mandate Name',
    stageField: 'Current Stage of Mandate',
    vpAvpFields: ['Mandate VP / AVP 1', 'Mandate VP / AVP 2'],
    associateFields: ['Mandate Associate 1', 'Mandate Associate 2'],
    bandwidthField: 'Mandate Bandwidth Situation',
  },
  dde: {
    tableId: 'tblxyEcXA5piBJKyP',
    nameField: 'DDE Name',
    stageField: 'Current Stage of DDE',
    vpAvpFields: ['DDE VP / AVP'],
    associateFields: ['DDE Associate'],
    bandwidthField: 'DDE Bandwidth Situation',
  },
  pitch: {
    tableId: 'tblOMIyzJZYUMrJ2N',
    nameField: 'Name',
    stageField: 'Pitch Status',
    vpAvpFields: ['Pitch VP / AVP', 'Pitch VP / AVP 2'],
    associateFields: ['Pitch Associate 1', 'Pitch Associate 2'],
    bandwidthField: 'Pitch Bandwidth Situation',
  },
};
```

- [ ] **Step 3: Create fellows fetcher**

```typescript
// app/src/lib/airtable/fellows.ts
import { fetchAllRecords } from './client';
import { FELLOWS_TABLE_ID } from './config';
import type { Fellow } from '@/types';

const ELIGIBLE_DESIGNATIONS = ['VP', 'AVP', 'Associate 3', 'Associate 2', 'Associate 1'];

export async function fetchEligibleFellows(): Promise<Fellow[]> {
  const records = await fetchAllRecords(FELLOWS_TABLE_ID, {
    filterByFormula: "AND({Current Employee} = 'Yes', {Team} = 'Investment Banking')",
  });

  return records
    .filter(r => ELIGIBLE_DESIGNATIONS.includes(r.fields['Designation'] as string))
    .map(r => ({
      recordId: r.id,
      name: r.fields['Name'] as string,
      email: r.fields['Email'] as string,
      designation: r.fields['Designation'] as string,
      capacityMeu: Number(r.fields['Capacity [MEU]']) || 3.0,
    }));
}

export function isVpOrAvp(designation: string): boolean {
  return designation === 'VP' || designation === 'AVP';
}
```

- [ ] **Step 4: Create projects fetcher**

```typescript
// app/src/lib/airtable/projects.ts
import { fetchAllRecords } from './client';
import { TABLE_CONFIG } from './config';
import type { ProjectType, ProjectAssignment } from '@/types';

export async function fetchAllProjects(): Promise<ProjectAssignment[]> {
  const types: ProjectType[] = ['mandate', 'dde', 'pitch'];

  const results = await Promise.all(
    types.map(async (type) => {
      const cfg = TABLE_CONFIG[type];
      const records = await fetchAllRecords(cfg.tableId);

      return records.map((r): ProjectAssignment => {
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

        return {
          projectRecordId: r.id,
          projectName: r.fields[cfg.nameField] as string,
          projectType: type,
          stage: (r.fields[cfg.stageField] as string) || '',
          vpAvpIds,
          associateIds,
        };
      });
    })
  );

  return results.flat();
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

- [ ] **Step 5: Verify types compile**

```bash
cd app && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/airtable/
git commit -m "feat: Airtable client with fellows and projects fetchers"
```

---

### Task 6: Airtable Write-Back & Narrative Generation

**Files:**
- Create: `app/src/lib/airtable/writeback.ts`
- Test: `app/tests/writeback.test.ts`

**Depends on:** Task 5

- [ ] **Step 1: Write test for narrative generation**

```typescript
// app/tests/writeback.test.ts
import { describe, it, expect } from 'vitest';
import { generateNarrative } from '../src/lib/airtable/writeback';

describe('generateNarrative', () => {
  it('formats a mandate narrative with multiple fellows', () => {
    const result = generateNarrative('Acme Corp', 'mandate', '2026-05-04', [
      { fellowName: 'Sai K', score: 3, hoursPerDay: 4, stage: 'Live' },
      { fellowName: 'Ravi P', score: 2, hoursPerDay: 2, stage: 'Live' },
    ]);

    expect(result).toContain('Acme Corp');
    expect(result).toContain('2026-05-04');
    expect(result).toContain('Sai K');
    expect(result).toContain('Score 3');
    expect(result).toContain('4 hrs/day');
    expect(result).toContain('Ravi P');
    expect(result).toContain('Score 2');
    expect(result).toContain('2 hrs/day');
  });

  it('includes stage context when provided', () => {
    const result = generateNarrative('Beta Inc', 'dde', '2026-05-04', [
      { fellowName: 'Jay M', score: 1, hoursPerDay: 0.3, stage: 'Research' },
    ]);

    expect(result).toContain('Research');
  });
});
```

- [ ] **Step 2: Write implementation**

```typescript
// app/src/lib/airtable/writeback.ts
import { updateRecord } from './client';
import { TABLE_CONFIG } from './config';
import type { ProjectType } from '@/types';

export interface FellowBandwidthEntry {
  fellowName: string;
  score: number;
  hoursPerDay: number;
  stage: string;
}

export function generateNarrative(
  projectName: string,
  projectType: ProjectType,
  dateStr: string,
  entries: FellowBandwidthEntry[]
): string {
  const lines = entries.map(e => {
    const stageNote = e.stage ? ` ${e.stage}.` : '';
    return `- ${e.fellowName} – Score ${e.score}; ${e.hoursPerDay} hrs/day.${stageNote}`;
  });

  return [
    projectName,
    `Current Bandwidth Situation for ${projectName} as on ${dateStr}`,
    '',
    ...lines,
  ].join('\n');
}

export async function writeBandwidthToAirtable(
  projectRecordId: string,
  projectType: ProjectType,
  narrative: string
): Promise<void> {
  const cfg = TABLE_CONFIG[projectType];
  await updateRecord(cfg.tableId, projectRecordId, {
    [cfg.bandwidthField]: narrative,
  });
}
```

- [ ] **Step 3: Run tests**

```bash
cd app && pnpm vitest run tests/writeback.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/airtable/writeback.ts tests/writeback.test.ts
git commit -m "feat: narrative generation and Airtable write-back"
```

---

## Phase 4: Email & Notifications

### Task 7: Email System

**Files:**
- Create: `app/src/lib/email.ts`

**Depends on:** Task 1

- [ ] **Step 1: Create email client with all 4 templates**

```typescript
// app/src/lib/email.ts
import { Resend } from 'resend';
import type { ProjectAssignment, Fellow } from '@/types';

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.EMAIL_FROM || 'bandwidth@indigoedge.com';

function formatDateRange(startDate: string): string {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return `${start.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// --- Collection Email ---
export async function sendCollectionEmail(
  fellow: Fellow,
  projects: ProjectAssignment[],
  token: string,
  cycleStartDate: string
) {
  const dateRange = formatDateRange(cycleStartDate);
  const projectRows = projects
    .map(p => `<tr><td style="padding:8px;border:1px solid #ddd">${p.projectName}</td><td style="padding:8px;border:1px solid #ddd">${p.projectType.toUpperCase()}</td><td style="padding:8px;border:1px solid #ddd">${p.stage}</td></tr>`)
    .join('');

  await resend.emails.send({
    from,
    to: fellow.email,
    subject: `Bandwidth Update — ${dateRange}`,
    html: `
      <p>Hi ${fellow.name},</p>
      <p>Please submit your bandwidth update for the current cycle (${dateRange}).</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr style="background:#f3f4f6"><th style="padding:8px;border:1px solid #ddd;text-align:left">Project</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Type</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Stage</th></tr>
        ${projectRows}
      </table>
      <a href="${process.env.APP_URL}/submit/${token}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Submit Your Bandwidth</a>
    `,
  });
}

// --- Reminder Email ---
export async function sendReminderEmail(
  fellow: Fellow,
  token: string,
  cycleStartDate: string
) {
  const dateRange = formatDateRange(cycleStartDate);

  await resend.emails.send({
    from,
    to: fellow.email,
    subject: 'Reminder: Bandwidth Update Pending',
    html: `
      <p>Hi ${fellow.name},</p>
      <p>Your bandwidth update for ${dateRange} is still pending. Please submit it at your earliest convenience.</p>
      <a href="${process.env.APP_URL}/submit/${token}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Submit Your Bandwidth</a>
    `,
  });
}

// --- Conflict Email ---
export async function sendConflictEmail(
  vpName: string,
  vpEmail: string,
  associateName: string,
  associateEmail: string,
  projectName: string,
  vpHours: number,
  associateHours: number,
  resolutionToken: string
) {
  const appUrl = process.env.APP_URL;

  await resend.emails.send({
    from,
    to: vpEmail,
    cc: [associateEmail, process.env.ADMIN_EMAIL!, process.env.CC_EMAIL!].filter(Boolean),
    subject: `Bandwidth Conflict — ${projectName}`,
    html: `
      <p>Hi ${vpName},</p>
      <p>On <strong>${projectName}</strong>, you reported ${associateName} will spend <strong>${vpHours} hrs/day</strong>, but ${associateName} reported <strong>${associateHours} hrs/day</strong>.</p>
      <p>Please confirm the accurate number:</p>
      <div style="margin:16px 0">
        <a href="${appUrl}/resolve/${resolutionToken}?action=use_associate" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">${associateName}'s number (${associateHours} hrs/day)</a>
        <a href="${appUrl}/resolve/${resolutionToken}?action=use_vp" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">My number (${vpHours} hrs/day)</a>
        <a href="${appUrl}/resolve/${resolutionToken}?action=custom" style="display:inline-block;background:#6b7280;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Enter a different number</a>
      </div>
    `,
  });
}

// --- Completion Report Email ---
export async function sendCompletionEmail(
  cycleStartDate: string,
  submissionCount: number,
  conflictCount: number,
  projectCount: number,
  failures: Array<{ projectName: string; error: string }>
) {
  const dateRange = formatDateRange(cycleStartDate);

  const failureHtml = failures.length > 0
    ? `<p style="color:#dc2626"><strong>Failures:</strong></p><ul>${failures.map(f => `<li>${f.projectName}: ${f.error}</li>`).join('')}</ul>`
    : '';

  await resend.emails.send({
    from,
    to: process.env.ADMIN_EMAIL!,
    subject: `Bandwidth Cycle ${dateRange} — Complete`,
    html: `
      <p>${submissionCount} submissions processed, ${conflictCount} conflicts resolved.</p>
      <p>All ${projectCount} project bandwidth fields updated on Airtable${failures.length > 0 ? ' with some failures' : ' successfully'}.</p>
      ${failureHtml}
    `,
  });
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd app && pnpm tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: email system with collection, reminder, conflict, and completion templates"
```

---

### Task 8: Slack Integration

**Files:**
- Create: `app/src/lib/slack.ts`

**Depends on:** Task 1

- [ ] **Step 1: Create Slack webhook client**

```typescript
// app/src/lib/slack.ts
async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    console.error(`Slack webhook failed: ${res.status}`);
  }
}

export async function postPendingList(
  names: string[],
  dateRange: string
): Promise<void> {
  if (names.length === 0) return;

  const bullets = names.map(n => `• ${n}`).join('\n');
  await postToSlack(
    `The following people have not submitted their bandwidth update for ${dateRange}:\n${bullets}`
  );
}

export async function postRemark(
  fellowName: string,
  remark: string
): Promise<void> {
  await postToSlack(`${fellowName} flagged: ${remark}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/slack.ts
git commit -m "feat: Slack webhook for pending list and remarks"
```

---

## Phase 5: Collection Flow

### Task 9: Submission Form Page

**Files:**
- Create: `app/src/app/submit/[token]/page.tsx`
- Create: `app/src/app/submit/[token]/form.tsx`
- Create: `app/src/app/submitted/page.tsx`

**Depends on:** Tasks 1, 5

- [ ] **Step 1: Create server page component**

```tsx
// app/src/app/submit/[token]/page.tsx
import { db } from '@/lib/db';
import { tokens } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchAllProjects, getProjectsForFellow } from '@/lib/airtable/projects';
import { fetchEligibleFellows, isVpOrAvp } from '@/lib/airtable/fellows';
import { notFound, redirect } from 'next/navigation';
import { SubmissionForm } from './form';

export default async function SubmitPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: tokenValue } = await params;

  const [tokenRecord] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token, tokenValue))
    .limit(1);

  if (!tokenRecord) return notFound();
  if (tokenRecord.status === 'submitted') redirect('/submitted');
  if (tokenRecord.status === 'not_needed') redirect('/submitted');

  const [projects, fellows] = await Promise.all([
    fetchAllProjects(),
    fetchEligibleFellows(),
  ]);

  const fellowProjects = getProjectsForFellow(projects, tokenRecord.fellowRecordId);
  const isVp = isVpOrAvp(tokenRecord.fellowDesignation);

  const projectsWithAssociates = fellowProjects.map(project => {
    const associates = isVp
      ? project.associateIds
          .map(id => fellows.find(f => f.recordId === id))
          .filter((f): f is NonNullable<typeof f> => f != null)
          .map(f => ({ recordId: f.recordId, name: f.name }))
      : [];
    return {
      projectRecordId: project.projectRecordId,
      projectName: project.projectName,
      projectType: project.projectType,
      stage: project.stage,
      associates,
    };
  });

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Bandwidth Update</h1>
      <p className="text-gray-600 mb-6">
        Hi {tokenRecord.fellowName}, report your bandwidth for each project below.
      </p>
      <SubmissionForm
        token={tokenValue}
        fellowName={tokenRecord.fellowName}
        isVp={isVp}
        projects={projectsWithAssociates}
      />
    </main>
  );
}
```

- [ ] **Step 2: Create client form component**

```tsx
// app/src/app/submit/[token]/form.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Associate {
  recordId: string;
  name: string;
}

interface Project {
  projectRecordId: string;
  projectName: string;
  projectType: string;
  stage: string;
  associates: Associate[];
}

interface HoursEntry {
  projectRecordId: string;
  targetFellowId: string | null;
  hoursValue: string;
  hoursUnit: 'per_day' | 'per_week';
}

export function SubmissionForm({
  token,
  fellowName,
  isVp,
  projects,
}: {
  token: string;
  fellowName: string;
  isVp: boolean;
  projects: Project[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<string, HoursEntry>>(() => {
    const init: Record<string, HoursEntry> = {};
    for (const project of projects) {
      init[`${project.projectRecordId}:self`] = {
        projectRecordId: project.projectRecordId,
        targetFellowId: null,
        hoursValue: '',
        hoursUnit: 'per_day',
      };
      if (isVp) {
        for (const assoc of project.associates) {
          init[`${project.projectRecordId}:${assoc.recordId}`] = {
            projectRecordId: project.projectRecordId,
            targetFellowId: assoc.recordId,
            hoursValue: '',
            hoursUnit: 'per_day',
          };
        }
      }
    }
    return init;
  });
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function update(key: string, field: 'hoursValue' | 'hoursUnit', value: string) {
    setEntries(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const list = Object.values(entries).map(entry => ({
      ...entry,
      hoursValue: parseFloat(entry.hoursValue),
    }));

    if (list.some(e => isNaN(e.hoursValue) || e.hoursValue < 0)) {
      setError('Fill in all hours fields with valid numbers.');
      setSubmitting(false);
      return;
    }

    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, entries: list, remarks }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Submission failed.');
      setSubmitting(false);
      return;
    }

    router.push('/submitted');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {projects.map(project => (
        <div key={project.projectRecordId} className="border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold">{project.projectName}</h2>
            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded uppercase">
              {project.projectType}
            </span>
            {project.stage && (
              <span className="text-xs text-gray-500">{project.stage}</span>
            )}
          </div>

          <HoursInput
            label={`Your bandwidth (${fellowName})`}
            entry={entries[`${project.projectRecordId}:self`]}
            onChange={(field, val) => update(`${project.projectRecordId}:self`, field, val)}
          />

          {isVp &&
            project.associates.map(assoc => (
              <HoursInput
                key={assoc.recordId}
                label={assoc.name}
                entry={entries[`${project.projectRecordId}:${assoc.recordId}`]}
                onChange={(field, val) =>
                  update(`${project.projectRecordId}:${assoc.recordId}`, field, val)
                }
              />
            ))}
        </div>
      ))}

      <div>
        <label className="block text-sm font-medium mb-1">Remarks (optional)</label>
        <textarea
          className="w-full border rounded-lg p-2 text-sm"
          rows={3}
          placeholder="Flag projects not in the system, other work, or concerns..."
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit Bandwidth Update'}
      </button>
    </form>
  );
}

function HoursInput({
  label,
  entry,
  onChange,
}: {
  label: string;
  entry: HoursEntry;
  onChange: (field: 'hoursValue' | 'hoursUnit', value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <span className="text-sm min-w-[160px]">{label}</span>
      <input
        type="number"
        step="0.5"
        min="0"
        required
        className="border rounded px-2 py-1 w-20 text-sm"
        value={entry.hoursValue}
        onChange={e => onChange('hoursValue', e.target.value)}
      />
      <select
        className="border rounded px-2 py-1 text-sm"
        value={entry.hoursUnit}
        onChange={e => onChange('hoursUnit', e.target.value)}
      >
        <option value="per_day">hrs/day</option>
        <option value="per_week">hrs/week</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Create submitted confirmation page**

```tsx
// app/src/app/submitted/page.tsx
export default function SubmittedPage() {
  return (
    <main className="max-w-md mx-auto p-6 text-center mt-20">
      <div className="text-4xl mb-4">&#10003;</div>
      <h1 className="text-2xl font-bold mb-2">Submitted</h1>
      <p className="text-gray-600">
        Your bandwidth update has been recorded. You can close this page.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/submit/ src/app/submitted/
git commit -m "feat: submission form with VP/AVP and associate variants"
```

---

### Task 10: Submission API

**Files:**
- Create: `app/src/app/api/submit/route.ts`

**Depends on:** Tasks 2, 4, 5, 7, 8

- [ ] **Step 1: Create submission API route**

```typescript
// app/src/app/api/submit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens, submissions, conflicts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { normalizeToHoursPerDay, scoreHours } from '@/lib/scoring';
import { isConflict } from '@/lib/conflicts';
import { sendConflictEmail } from '@/lib/email';
import { postRemark } from '@/lib/slack';
import { fetchEligibleFellows, isVpOrAvp } from '@/lib/airtable/fellows';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { checkAndFinalizeCycle } from '@/lib/cycle';

interface EntryPayload {
  projectRecordId: string;
  targetFellowId: string | null;
  hoursValue: number;
  hoursUnit: 'per_day' | 'per_week';
}

export async function POST(req: NextRequest) {
  const { token: tokenValue, entries, remarks } = (await req.json()) as {
    token: string;
    entries: EntryPayload[];
    remarks: string;
  };

  // Validate token
  const [tokenRecord] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token, tokenValue))
    .limit(1);

  if (!tokenRecord || tokenRecord.status !== 'pending') {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  // Fetch project data for names/types
  const allProjects = await fetchAllProjects();
  const projectMap = new Map(allProjects.map(p => [p.projectRecordId, p]));

  // Process and save each entry
  const savedSubmissions: Array<typeof submissions.$inferInsert> = [];
  let remarksText = remarks?.trim() || null;

  for (const entry of entries) {
    const project = projectMap.get(entry.projectRecordId);
    if (!project) continue;

    const hoursPerDay = normalizeToHoursPerDay(entry.hoursValue, entry.hoursUnit);
    const { score, meu } = scoreHours(hoursPerDay, project.projectType);
    const isSelfReport = entry.targetFellowId === null;

    const [saved] = await db
      .insert(submissions)
      .values({
        cycleId: tokenRecord.cycleId,
        fellowRecordId: tokenRecord.fellowRecordId,
        projectRecordId: entry.projectRecordId,
        projectName: project.projectName,
        projectType: project.projectType,
        hoursValue: entry.hoursValue,
        hoursUnit: entry.hoursUnit,
        hoursPerDay,
        autoScore: score,
        autoMeu: meu,
        isSelfReport,
        targetFellowId: entry.targetFellowId,
        remarks: isSelfReport ? remarksText : null,
      })
      .returning();

    savedSubmissions.push(saved);
  }

  // Cross-reference: check VP projections against associate self-reports
  const isVp = isVpOrAvp(tokenRecord.fellowDesignation);
  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  for (const sub of savedSubmissions) {
    if (isVp && !sub.isSelfReport && sub.targetFellowId) {
      // VP just submitted a projection for an associate.
      // Check if the associate has already self-reported for this project.
      const [assocSub] = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.cycleId, tokenRecord.cycleId),
            eq(submissions.projectRecordId, sub.projectRecordId),
            eq(submissions.fellowRecordId, sub.targetFellowId),
            eq(submissions.isSelfReport, true)
          )
        )
        .limit(1);

      if (assocSub && isConflict(sub.hoursPerDay, assocSub.hoursPerDay)) {
        const resToken = crypto.randomUUID();
        await db.insert(conflicts).values({
          cycleId: tokenRecord.cycleId,
          projectRecordId: sub.projectRecordId,
          vpSubmissionId: sub.id,
          associateSubmissionId: assocSub.id,
          vpHoursPerDay: sub.hoursPerDay,
          associateHoursPerDay: assocSub.hoursPerDay,
          difference: Math.abs(sub.hoursPerDay - assocSub.hoursPerDay),
          resolutionToken: resToken,
        });

        const assocFellow = fellowMap.get(sub.targetFellowId);
        if (assocFellow) {
          await sendConflictEmail(
            tokenRecord.fellowName,
            tokenRecord.fellowEmail,
            assocFellow.name,
            assocFellow.email,
            sub.projectName,
            sub.hoursPerDay,
            assocSub.hoursPerDay,
            resToken
          );
        }
      }
    }

    if (!isVp && sub.isSelfReport) {
      // Associate just self-reported. Check if any VP has projected for them on this project.
      const vpProjections = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.cycleId, tokenRecord.cycleId),
            eq(submissions.projectRecordId, sub.projectRecordId),
            eq(submissions.targetFellowId, tokenRecord.fellowRecordId),
            eq(submissions.isSelfReport, false)
          )
        );

      for (const vpSub of vpProjections) {
        if (isConflict(vpSub.hoursPerDay, sub.hoursPerDay)) {
          const vpToken = await db
            .select()
            .from(tokens)
            .where(
              and(
                eq(tokens.cycleId, tokenRecord.cycleId),
                eq(tokens.fellowRecordId, vpSub.fellowRecordId)
              )
            )
            .limit(1);

          const vpFellow = fellowMap.get(vpSub.fellowRecordId);
          if (vpFellow) {
            const resToken = crypto.randomUUID();
            await db.insert(conflicts).values({
              cycleId: tokenRecord.cycleId,
              projectRecordId: sub.projectRecordId,
              vpSubmissionId: vpSub.id,
              associateSubmissionId: sub.id,
              vpHoursPerDay: vpSub.hoursPerDay,
              associateHoursPerDay: sub.hoursPerDay,
              difference: Math.abs(vpSub.hoursPerDay - sub.hoursPerDay),
              resolutionToken: resToken,
            });

            await sendConflictEmail(
              vpFellow.name,
              vpFellow.email,
              tokenRecord.fellowName,
              tokenRecord.fellowEmail,
              sub.projectName,
              vpSub.hoursPerDay,
              sub.hoursPerDay,
              resToken
            );
          }
        }
      }
    }
  }

  // Burn token
  await db
    .update(tokens)
    .set({ status: 'submitted' as const, submittedAt: new Date() })
    .where(eq(tokens.id, tokenRecord.id));

  // Post remarks to Slack
  if (remarksText) {
    await postRemark(tokenRecord.fellowName, remarksText);
  }

  // Check if cycle is now complete
  await checkAndFinalizeCycle(tokenRecord.cycleId);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd app && pnpm tsc --noEmit
```

Note: This will show an error for `checkAndFinalizeCycle` which doesn't exist yet. That's expected — it'll be created in Task 13. For now, add a stub in `src/lib/cycle.ts`:

```typescript
// app/src/lib/cycle.ts (stub — full implementation in Task 13)
export async function checkAndFinalizeCycle(cycleId: string): Promise<void> {
  // Implemented in Task 13
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/submit/route.ts src/lib/cycle.ts
git commit -m "feat: submission API with scoring, cross-referencing, and conflict detection"
```

---

## Phase 6: Conflict Resolution

### Task 11: Conflict Resolution Flow

**Files:**
- Create: `app/src/app/resolve/[token]/page.tsx`
- Create: `app/src/app/resolve/[token]/form.tsx`
- Create: `app/src/app/resolved/page.tsx`
- Create: `app/src/app/api/resolve/route.ts`

**Depends on:** Tasks 1, 7

- [ ] **Step 1: Create resolution API route**

```typescript
// app/src/app/api/resolve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { conflicts, submissions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { scoreHours } from '@/lib/scoring';
import { checkAndFinalizeCycle } from '@/lib/cycle';
import type { ConflictResolution, ProjectType } from '@/types';

export async function POST(req: NextRequest) {
  const { resolutionToken, action, customHours } = (await req.json()) as {
    resolutionToken: string;
    action: ConflictResolution;
    customHours?: number;
  };

  const [conflict] = await db
    .select()
    .from(conflicts)
    .where(eq(conflicts.resolutionToken, resolutionToken))
    .limit(1);

  if (!conflict || conflict.status === 'resolved') {
    return NextResponse.json({ error: 'Invalid or already resolved' }, { status: 400 });
  }

  let resolvedHours: number;
  if (action === 'associate_number') {
    resolvedHours = conflict.associateHoursPerDay;
  } else if (action === 'vp_number') {
    resolvedHours = conflict.vpHoursPerDay;
  } else {
    resolvedHours = customHours!;
  }

  // Update conflict record
  await db
    .update(conflicts)
    .set({
      status: 'resolved' as const,
      resolvedHoursPerDay: resolvedHours,
      resolvedBy: action,
    })
    .where(eq(conflicts.id, conflict.id));

  // Update the VP's projection submission with the resolved hours and re-score
  const [vpSub] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, conflict.vpSubmissionId))
    .limit(1);

  if (vpSub) {
    const { score, meu } = scoreHours(resolvedHours, vpSub.projectType as ProjectType);
    await db
      .update(submissions)
      .set({ hoursPerDay: resolvedHours, autoScore: score, autoMeu: meu })
      .where(eq(submissions.id, conflict.vpSubmissionId));
  }

  // Also update the associate's self-report with resolved hours
  const [assocSub] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, conflict.associateSubmissionId))
    .limit(1);

  if (assocSub) {
    const { score, meu } = scoreHours(resolvedHours, assocSub.projectType as ProjectType);
    await db
      .update(submissions)
      .set({ hoursPerDay: resolvedHours, autoScore: score, autoMeu: meu })
      .where(eq(submissions.id, conflict.associateSubmissionId));
  }

  // Check if cycle is now complete
  await checkAndFinalizeCycle(conflict.cycleId);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create resolution server page**

```tsx
// app/src/app/resolve/[token]/page.tsx
import { db } from '@/lib/db';
import { conflicts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { ResolutionView } from './form';

export default async function ResolvePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { token } = await params;
  const { action } = await searchParams;

  const [conflict] = await db
    .select()
    .from(conflicts)
    .where(eq(conflicts.resolutionToken, token))
    .limit(1);

  if (!conflict) return notFound();
  if (conflict.status === 'resolved') redirect('/resolved');

  // For one-click actions (use_associate or use_vp), process immediately via API
  // For custom, show the form
  return (
    <main className="max-w-md mx-auto p-6 mt-10">
      <h1 className="text-xl font-bold mb-4">Resolve Bandwidth Conflict</h1>
      <ResolutionView
        resolutionToken={token}
        vpHours={conflict.vpHoursPerDay}
        associateHours={conflict.associateHoursPerDay}
        initialAction={action as 'use_associate' | 'use_vp' | 'custom' | undefined}
      />
    </main>
  );
}
```

- [ ] **Step 3: Create resolution client component**

```tsx
// app/src/app/resolve/[token]/form.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function ResolutionView({
  resolutionToken,
  vpHours,
  associateHours,
  initialAction,
}: {
  resolutionToken: string;
  vpHours: number;
  associateHours: number;
  initialAction?: 'use_associate' | 'use_vp' | 'custom';
}) {
  const router = useRouter();
  const [customHours, setCustomHours] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto-resolve for one-click actions
  useEffect(() => {
    if (initialAction === 'use_associate' || initialAction === 'use_vp') {
      resolve(initialAction === 'use_associate' ? 'associate_number' : 'vp_number');
    }
  }, [initialAction]);

  async function resolve(action: string, hours?: number) {
    setSubmitting(true);
    setError('');

    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolutionToken, action, customHours: hours }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Resolution failed.');
      setSubmitting(false);
      return;
    }

    router.push('/resolved');
  }

  if (initialAction === 'use_associate' || initialAction === 'use_vp') {
    return <p className="text-gray-600">{submitting ? 'Processing...' : error || 'Redirecting...'}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        VP reported <strong>{vpHours} hrs/day</strong>, Associate reported{' '}
        <strong>{associateHours} hrs/day</strong>.
      </p>

      <div className="space-y-2">
        <button
          onClick={() => resolve('associate_number')}
          disabled={submitting}
          className="w-full bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
        >
          Use Associate's number ({associateHours} hrs/day)
        </button>
        <button
          onClick={() => resolve('vp_number')}
          disabled={submitting}
          className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Use VP's number ({vpHours} hrs/day)
        </button>
      </div>

      <div className="border-t pt-4">
        <label className="block text-sm font-medium mb-1">Or enter a different number:</label>
        <div className="flex gap-2">
          <input
            type="number"
            step="0.5"
            min="0"
            className="border rounded px-2 py-1 w-24 text-sm"
            value={customHours}
            onChange={e => setCustomHours(e.target.value)}
            placeholder="hrs/day"
          />
          <button
            onClick={() => {
              const val = parseFloat(customHours);
              if (isNaN(val) || val < 0) {
                setError('Enter a valid number.');
                return;
              }
              resolve('custom', val);
            }}
            disabled={submitting}
            className="bg-gray-600 text-white px-4 py-1 rounded-lg text-sm hover:bg-gray-700 disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Create resolved confirmation page**

```tsx
// app/src/app/resolved/page.tsx
export default function ResolvedPage() {
  return (
    <main className="max-w-md mx-auto p-6 text-center mt-20">
      <div className="text-4xl mb-4">&#10003;</div>
      <h1 className="text-2xl font-bold mb-2">Conflict Resolved</h1>
      <p className="text-gray-600">
        The bandwidth number has been updated. You can close this page.
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/resolve/ src/app/resolved/ src/app/api/resolve/
git commit -m "feat: conflict resolution flow with one-click and custom options"
```

---

## Phase 7: Cycle Orchestration

### Task 12: Cycle Management

**Files:**
- Modify: `app/src/lib/cycle.ts` (replace stub)

**Depends on:** Tasks 2, 3, 5, 6, 7, 8

- [ ] **Step 1: Write cycle schedule test**

```typescript
// app/tests/cycle.test.ts
import { describe, it, expect } from 'vitest';
import { isCycleMonday } from '../src/lib/cycle';

describe('isCycleMonday', () => {
  it('returns true for the reference date Apr 20 2026', () => {
    expect(isCycleMonday(new Date('2026-04-20'))).toBe(true);
  });

  it('returns false for Apr 27 2026 (off-week Monday)', () => {
    expect(isCycleMonday(new Date('2026-04-27'))).toBe(false);
  });

  it('returns true for May 4 2026 (2 weeks after reference)', () => {
    expect(isCycleMonday(new Date('2026-05-04'))).toBe(true);
  });

  it('returns true for May 18 2026 (4 weeks after reference)', () => {
    expect(isCycleMonday(new Date('2026-05-18'))).toBe(true);
  });

  it('returns false for a Tuesday', () => {
    expect(isCycleMonday(new Date('2026-04-21'))).toBe(false);
  });

  it('returns false for dates before the reference', () => {
    expect(isCycleMonday(new Date('2026-04-06'))).toBe(false);
  });
});
```

- [ ] **Step 2: Implement full cycle management**

Replace the stub `app/src/lib/cycle.ts` with:

```typescript
// app/src/lib/cycle.ts
import { db } from '@/lib/db';
import { cycles, tokens, submissions, conflicts, snapshots } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';
import { fetchAllProjects, getProjectsForFellow } from '@/lib/airtable/projects';
import { sendCollectionEmail, sendCompletionEmail } from '@/lib/email';
import { generateNarrative, writeBandwidthToAirtable } from '@/lib/airtable/writeback';
import { sumMeu, calculateUtilization, getLoadTag } from '@/lib/utilization';
import type { ProjectType, ProjectBreakdownItem } from '@/types';

const REFERENCE_DATE = new Date('2026-04-20');

export function isCycleMonday(date: Date): boolean {
  if (date.getDay() !== 1) return false;
  const diffMs = date.getTime() - REFERENCE_DATE.getTime();
  if (diffMs < 0) return false;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays % 14 === 0;
}

export async function startCycle(): Promise<string> {
  const today = new Date();
  const startDate = today.toISOString().split('T')[0];

  // Create cycle
  const [cycle] = await db
    .insert(cycles)
    .values({ startDate })
    .returning();

  // Fetch fellows and projects
  const fellows = await fetchEligibleFellows();
  const allProjects = await fetchAllProjects();

  // Generate tokens and send emails
  for (const fellow of fellows) {
    const fellowProjects = getProjectsForFellow(allProjects, fellow.recordId);
    if (fellowProjects.length === 0) continue;

    const tokenValue = crypto.randomUUID();

    await db.insert(tokens).values({
      cycleId: cycle.id,
      fellowRecordId: fellow.recordId,
      fellowName: fellow.name,
      fellowEmail: fellow.email,
      fellowDesignation: fellow.designation,
      token: tokenValue,
    });

    await sendCollectionEmail(fellow, fellowProjects, tokenValue, startDate);
  }

  return cycle.id;
}

export async function getActiveCycle() {
  const [cycle] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'collecting'))
    .orderBy(desc(cycles.createdAt))
    .limit(1);
  return cycle || null;
}

export async function checkAndFinalizeCycle(cycleId: string): Promise<void> {
  // Check all tokens are submitted or not_needed
  const pendingTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.cycleId, cycleId), eq(tokens.status, 'pending')));

  if (pendingTokens.length > 0) return;

  // Check all conflicts are resolved
  const pendingConflicts = await db
    .select()
    .from(conflicts)
    .where(and(eq(conflicts.cycleId, cycleId), eq(conflicts.status, 'pending')));

  if (pendingConflicts.length > 0) return;

  // Cycle is complete — finalize
  await finalizeCycle(cycleId);
}

async function finalizeCycle(cycleId: string): Promise<void> {
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1);
  if (!cycle || cycle.status === 'complete') return;

  const allSubmissions = await db
    .select()
    .from(submissions)
    .where(eq(submissions.cycleId, cycleId));

  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));
  const failures: Array<{ projectName: string; error: string }> = [];

  // Group self-report submissions by project for Airtable write-back
  const projectSubmissions = new Map<string, typeof allSubmissions>();
  for (const sub of allSubmissions) {
    if (!sub.isSelfReport) continue;
    const existing = projectSubmissions.get(sub.projectRecordId) || [];
    existing.push(sub);
    projectSubmissions.set(sub.projectRecordId, existing);
  }

  // Write narratives to Airtable
  let projectCount = 0;
  for (const [projectRecordId, subs] of projectSubmissions) {
    const firstSub = subs[0];
    const entries = subs.map(s => ({
      fellowName: fellowMap.get(s.fellowRecordId)?.name || s.fellowRecordId,
      score: s.autoScore,
      hoursPerDay: s.hoursPerDay,
      stage: '', // Stage comes from Airtable, could be enriched
    }));

    const narrative = generateNarrative(
      firstSub.projectName,
      firstSub.projectType as ProjectType,
      cycle.startDate,
      entries
    );

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
  }

  // Create snapshots per fellow
  const dateStr = cycle.startDate;
  for (const fellow of fellows) {
    const fellowSubs = allSubmissions.filter(
      s => s.fellowRecordId === fellow.recordId && s.isSelfReport
    );
    if (fellowSubs.length === 0) continue;

    const meuValues = fellowSubs.map(s => s.autoMeu);
    const totalMeu = sumMeu(meuValues);
    const utilPct = calculateUtilization(totalMeu, fellow.capacityMeu);
    const loadTag = getLoadTag(utilPct);

    const breakdown: ProjectBreakdownItem[] = fellowSubs.map(s => ({
      projectName: s.projectName,
      projectType: s.projectType as ProjectType,
      score: s.autoScore,
      meu: s.autoMeu,
      hoursPerDay: s.hoursPerDay,
    }));

    await db.insert(snapshots).values({
      cycleId,
      fellowRecordId: fellow.recordId,
      fellowName: fellow.name,
      designation: fellow.designation,
      capacityMeu: fellow.capacityMeu,
      totalMeu,
      utilizationPct: utilPct,
      loadTag,
      projectBreakdown: breakdown,
      snapshotDate: dateStr,
    });
  }

  // Mark cycle complete
  await db.update(cycles).set({ status: 'complete' as const }).where(eq(cycles.id, cycleId));

  // Send completion email
  const conflictCount = (
    await db
      .select()
      .from(conflicts)
      .where(and(eq(conflicts.cycleId, cycleId), eq(conflicts.status, 'resolved')))
  ).length;

  await sendCompletionEmail(
    cycle.startDate,
    allSubmissions.filter(s => s.isSelfReport).length,
    conflictCount,
    projectCount,
    failures
  );
}
```

- [ ] **Step 3: Run cycle schedule tests**

```bash
cd app && pnpm vitest run tests/cycle.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 4: Verify types compile**

```bash
cd app && pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/cycle.ts tests/cycle.test.ts
git commit -m "feat: cycle management with start, completion check, finalization, and snapshots"
```

---

### Task 13: Cron Routes

**Files:**
- Create: `app/src/app/api/cron/start-cycle/route.ts`
- Create: `app/src/app/api/cron/send-reminders/route.ts`

**Depends on:** Tasks 7, 8, 12

- [ ] **Step 1: Create start-cycle cron route**

```typescript
// app/src/app/api/cron/start-cycle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { isCycleMonday, startCycle, getActiveCycle } from '@/lib/cycle';

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date();

  if (!isCycleMonday(today)) {
    return NextResponse.json({ message: 'Not a cycle Monday, skipping' });
  }

  const active = await getActiveCycle();
  if (active) {
    return NextResponse.json({ message: 'Cycle already active, skipping' });
  }

  const cycleId = await startCycle();
  return NextResponse.json({ message: 'Cycle started', cycleId });
}
```

- [ ] **Step 2: Create send-reminders cron route**

```typescript
// app/src/app/api/cron/send-reminders/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getActiveCycle } from '@/lib/cycle';
import { sendReminderEmail } from '@/lib/email';
import { postPendingList } from '@/lib/slack';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cycle = await getActiveCycle();
  if (!cycle) {
    return NextResponse.json({ message: 'No active cycle' });
  }

  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ..., 5=Fri

  // Skip weekends and Monday (collection emails sent on Monday)
  if (dayOfWeek === 0 || dayOfWeek === 6 || dayOfWeek === 1) {
    return NextResponse.json({ message: 'No reminders today' });
  }

  // Get pending tokens
  const pendingTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.cycleId, cycle.id), eq(tokens.status, 'pending')));

  if (pendingTokens.length === 0) {
    return NextResponse.json({ message: 'All submitted' });
  }

  // Send email reminders (Tue-Fri)
  for (const t of pendingTokens) {
    await sendReminderEmail(
      { recordId: t.fellowRecordId, name: t.fellowName, email: t.fellowEmail, designation: t.fellowDesignation, capacityMeu: 0 },
      t.token,
      cycle.startDate
    );
  }

  // Post Slack pending list (Wed-Fri only)
  if (dayOfWeek >= 3) {
    const startDate = new Date(cycle.startDate);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 13);
    const dateRange = `${startDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    await postPendingList(
      pendingTokens.map(t => t.fellowName),
      dateRange
    );
  }

  return NextResponse.json({
    message: `Reminders sent to ${pendingTokens.length} fellows`,
    slackPosted: dayOfWeek >= 3,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/
git commit -m "feat: cron routes for cycle start and daily reminders"
```

---

## Phase 8: Admin & Dashboards

### Task 14: Admin Page

**Files:**
- Create: `app/src/app/admin/page.tsx`
- Create: `app/src/app/admin/fellows-list.tsx`
- Create: `app/src/app/api/admin/toggle/route.ts`

**Depends on:** Task 1

- [ ] **Step 1: Create admin toggle API**

```typescript
// app/src/app/api/admin/toggle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { checkAndFinalizeCycle } from '@/lib/cycle';

export async function POST(req: NextRequest) {
  const { tokenId, status } = (await req.json()) as {
    tokenId: string;
    status: 'pending' | 'not_needed';
  };

  const [token] = await db.select().from(tokens).where(eq(tokens.id, tokenId)).limit(1);
  if (!token) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  await db.update(tokens).set({ status }).where(eq(tokens.id, tokenId));

  // Check if toggling to not_needed completes the cycle
  if (status === 'not_needed') {
    await checkAndFinalizeCycle(token.cycleId);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create admin server page**

```tsx
// app/src/app/admin/page.tsx
import { db } from '@/lib/db';
import { cycles, tokens } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { FellowsList } from './fellows-list';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const [cycle] = await db
    .select()
    .from(cycles)
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!cycle) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Admin</h1>
        <p className="text-gray-600">No cycles yet.</p>
      </main>
    );
  }

  const cycleTokens = await db
    .select()
    .from(tokens)
    .where(eq(tokens.cycleId, cycle.id));

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Admin</h1>
      <p className="text-sm text-gray-500 mb-6">
        Cycle: {cycle.startDate} | Status: {cycle.status}
      </p>
      <FellowsList
        fellows={cycleTokens.map(t => ({
          tokenId: t.id,
          name: t.fellowName,
          designation: t.fellowDesignation,
          status: t.status,
          submittedAt: t.submittedAt?.toISOString() || null,
        }))}
      />
    </main>
  );
}
```

- [ ] **Step 3: Create fellows list client component**

```tsx
// app/src/app/admin/fellows-list.tsx
'use client';

import { useState } from 'react';

interface FellowToken {
  tokenId: string;
  name: string;
  designation: string;
  status: string;
  submittedAt: string | null;
}

export function FellowsList({ fellows: initial }: { fellows: FellowToken[] }) {
  const [fellows, setFellows] = useState(initial);

  async function toggle(tokenId: string, currentStatus: string) {
    const newStatus = currentStatus === 'not_needed' ? 'pending' : 'not_needed';
    const res = await fetch('/api/admin/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId, status: newStatus }),
    });
    if (res.ok) {
      setFellows(prev =>
        prev.map(f => (f.tokenId === tokenId ? { ...f, status: newStatus } : f))
      );
    }
  }

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    submitted: 'bg-green-100 text-green-800',
    not_needed: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-2">
      {fellows.map(f => (
        <div key={f.tokenId} className="flex items-center justify-between border rounded-lg p-3">
          <div>
            <span className="font-medium">{f.name}</span>
            <span className="text-xs text-gray-500 ml-2">{f.designation}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${statusColor[f.status] || ''}`}>
              {f.status}
            </span>
            {f.status !== 'submitted' && (
              <button
                onClick={() => toggle(f.tokenId, f.status)}
                className="text-xs text-blue-600 hover:underline"
              >
                {f.status === 'not_needed' ? 'Re-enable' : 'Mark not needed'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/ src/app/api/admin/
git commit -m "feat: admin page with not_needed toggle per fellow"
```

---

### Task 15: Dashboard — Utilization Overview

**Files:**
- Create: `app/src/app/dashboard/page.tsx`

**Depends on:** Task 1

- [ ] **Step 1: Create the overview dashboard**

```tsx
// app/src/app/dashboard/page.tsx
import { db } from '@/lib/db';
import { snapshots, cycles } from '@/lib/db/schema';
import { desc, eq, and, gte, lte, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function getIyRange(iy: number): { start: string; end: string } {
  return {
    start: `${iy - 1}-07-01`,
    end: `${iy}-06-30`,
  };
}

function getLoadColor(tag: string): string {
  switch (tag) {
    case 'Free':
    case 'Comfortable':
      return 'bg-green-100 text-green-800';
    case 'Busy':
      return 'bg-yellow-100 text-yellow-800';
    case 'At Capacity':
      return 'bg-orange-100 text-orange-800';
    case 'Overloaded':
      return 'bg-red-100 text-red-800';
    default:
      return '';
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ iy?: string }>;
}) {
  const { iy: iyParam } = await searchParams;

  // Default to current IY. IY = July(year-1) to June(year).
  // If today is Jan-Jun, current IY = this year. If Jul-Dec, current IY = next year.
  const now = new Date();
  const defaultIy = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const iy = iyParam ? parseInt(iyParam) : defaultIy;
  const { start, end } = getIyRange(iy);

  // Fetch all snapshots for this IY
  const allSnapshots = await db
    .select()
    .from(snapshots)
    .where(and(gte(snapshots.snapshotDate, start), lte(snapshots.snapshotDate, end)));

  // Group by fellow, then by month. Use the latest snapshot per month per fellow.
  const fellowMonthMap = new Map<string, Map<number, typeof allSnapshots[0]>>();
  const fellowNames = new Map<string, string>();

  for (const snap of allSnapshots) {
    const date = new Date(snap.snapshotDate);
    // Map month to IY column index: Jul=0, Aug=1, ..., Jun=11
    const monthIdx = (date.getMonth() + 6) % 12;

    if (!fellowMonthMap.has(snap.fellowRecordId)) {
      fellowMonthMap.set(snap.fellowRecordId, new Map());
    }
    fellowNames.set(snap.fellowRecordId, snap.fellowName);

    const existing = fellowMonthMap.get(snap.fellowRecordId)!.get(monthIdx);
    if (!existing || snap.snapshotDate > existing.snapshotDate) {
      fellowMonthMap.get(snap.fellowRecordId)!.set(monthIdx, snap);
    }
  }

  const fellowIds = Array.from(fellowMonthMap.keys()).sort((a, b) =>
    (fellowNames.get(a) || '').localeCompare(fellowNames.get(b) || '')
  );

  // IY selector options (scan available years from DB)
  const availableIys = new Set<number>();
  for (const snap of allSnapshots) {
    const d = new Date(snap.snapshotDate);
    availableIys.add(d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear());
  }
  availableIys.add(defaultIy);

  return (
    <main className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Utilization Overview</h1>
        <form className="flex items-center gap-2">
          <label className="text-sm text-gray-600">IY:</label>
          <select
            name="iy"
            defaultValue={iy}
            className="border rounded px-2 py-1 text-sm"
          >
            {Array.from(availableIys)
              .sort()
              .map(y => (
                <option key={y} value={y}>
                  IY{y} ({y - 1}-{y})
                </option>
              ))}
          </select>
          <button type="submit" className="text-xs text-blue-600 hover:underline">Go</button>
        </form>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="border p-2 text-left sticky left-0 bg-gray-50 z-10">Fellow</th>
              {MONTHS.map(m => (
                <th key={m} className="border p-2 text-center min-w-[100px]">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fellowIds.map(fid => {
              const months = fellowMonthMap.get(fid)!;
              return (
                <tr key={fid}>
                  <td className="border p-2 font-medium sticky left-0 bg-white z-10">
                    <a
                      href={`/dashboard/${fid}?iy=${iy}`}
                      className="text-blue-600 hover:underline"
                    >
                      {fellowNames.get(fid)}
                    </a>
                  </td>
                  {MONTHS.map((_, idx) => {
                    const snap = months.get(idx);
                    if (!snap) {
                      return <td key={idx} className="border p-2 text-center text-gray-300">—</td>;
                    }
                    return (
                      <td
                        key={idx}
                        className={`border p-2 text-center text-xs ${getLoadColor(snap.loadTag)}`}
                      >
                        <div className="font-medium">
                          {Math.round(snap.utilizationPct * 100)}%
                        </div>
                        <div className="text-[10px] opacity-75">
                          {snap.totalMeu.toFixed(2)}/{snap.capacityMeu.toFixed(1)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: utilization overview dashboard with month-by-month table"
```

---

### Task 16: Dashboard — Per-Person Drill-Down

**Files:**
- Create: `app/src/app/dashboard/[fellowId]/page.tsx`

**Depends on:** Task 1

- [ ] **Step 1: Create drill-down page**

```tsx
// app/src/app/dashboard/[fellowId]/page.tsx
import { db } from '@/lib/db';
import { snapshots } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import type { ProjectBreakdownItem } from '@/types';

export const dynamic = 'force-dynamic';

const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function getIyRange(iy: number) {
  return { start: `${iy - 1}-07-01`, end: `${iy}-06-30` };
}

export default async function DrillDownPage({
  params,
  searchParams,
}: {
  params: Promise<{ fellowId: string }>;
  searchParams: Promise<{ iy?: string }>;
}) {
  const { fellowId } = await params;
  const { iy: iyParam } = await searchParams;

  const now = new Date();
  const defaultIy = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const iy = iyParam ? parseInt(iyParam) : defaultIy;
  const { start, end } = getIyRange(iy);

  const fellowSnapshots = await db
    .select()
    .from(snapshots)
    .where(
      and(
        eq(snapshots.fellowRecordId, fellowId),
        gte(snapshots.snapshotDate, start),
        lte(snapshots.snapshotDate, end)
      )
    );

  if (fellowSnapshots.length === 0) return notFound();

  const fellowName = fellowSnapshots[0].fellowName;
  const designation = fellowSnapshots[0].designation;
  const capacityMeu = fellowSnapshots[0].capacityMeu;

  // Group by month, take latest per month
  const monthData = new Map<number, typeof fellowSnapshots[0]>();
  for (const snap of fellowSnapshots) {
    const d = new Date(snap.snapshotDate);
    const monthIdx = (d.getMonth() + 6) % 12;
    const existing = monthData.get(monthIdx);
    if (!existing || snap.snapshotDate > existing.snapshotDate) {
      monthData.set(monthIdx, snap);
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <a href={`/dashboard?iy=${iy}`} className="text-sm text-blue-600 hover:underline">
        &larr; Back to overview
      </a>

      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold">{fellowName}</h1>
        <p className="text-sm text-gray-500">
          {designation} | Capacity: {capacityMeu} MEU | IY{iy}
        </p>
      </div>

      {/* Monthly summary table */}
      <table className="w-full text-sm border-collapse mb-8">
        <thead>
          <tr className="bg-gray-50">
            <th className="border p-2 text-left">Month</th>
            <th className="border p-2 text-center">Utilization</th>
            <th className="border p-2 text-center">MEU</th>
            <th className="border p-2 text-center">Mandates</th>
            <th className="border p-2 text-center">DDEs</th>
            <th className="border p-2 text-center">Pitches</th>
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((monthName, idx) => {
            const snap = monthData.get(idx);
            if (!snap) {
              return (
                <tr key={idx}>
                  <td className="border p-2">{monthName}</td>
                  <td className="border p-2 text-center text-gray-300" colSpan={5}>
                    —
                  </td>
                </tr>
              );
            }

            const breakdown = snap.projectBreakdown as ProjectBreakdownItem[];
            const mandateCount = breakdown.filter(b => b.projectType === 'mandate').length;
            const ddeCount = breakdown.filter(b => b.projectType === 'dde').length;
            const pitchCount = breakdown.filter(b => b.projectType === 'pitch').length;

            return (
              <tr key={idx}>
                <td className="border p-2 font-medium">{monthName}</td>
                <td className="border p-2 text-center">
                  {Math.round(snap.utilizationPct * 100)}%
                </td>
                <td className="border p-2 text-center">
                  {snap.totalMeu.toFixed(2)} / {snap.capacityMeu.toFixed(1)}
                </td>
                <td className="border p-2 text-center">{mandateCount}</td>
                <td className="border p-2 text-center">{ddeCount}</td>
                <td className="border p-2 text-center">{pitchCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Per-month project breakdown */}
      <h2 className="text-lg font-semibold mb-3">Project Breakdown</h2>
      {MONTHS.map((monthName, idx) => {
        const snap = monthData.get(idx);
        if (!snap) return null;

        const breakdown = snap.projectBreakdown as ProjectBreakdownItem[];

        return (
          <div key={idx} className="mb-4">
            <h3 className="font-medium text-sm text-gray-700 mb-1">{monthName}</h3>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="p-2 text-left">Project</th>
                    <th className="p-2 text-center">Type</th>
                    <th className="p-2 text-center">Score</th>
                    <th className="p-2 text-center">MEU</th>
                    <th className="p-2 text-center">Hrs/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((b, i) => (
                    <tr key={i}>
                      <td className="p-2">{b.projectName}</td>
                      <td className="p-2 text-center uppercase">{b.projectType}</td>
                      <td className="p-2 text-center">{b.score}</td>
                      <td className="p-2 text-center">{b.meu.toFixed(2)}</td>
                      <td className="p-2 text-center">{b.hoursPerDay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </main>
  );
}
```

- [ ] **Step 2: Create root page redirect**

```tsx
// app/src/app/page.tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');
}
```

- [ ] **Step 3: Update layout with basic styling**

```tsx
// app/src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Utilization MIS',
  description: 'IndigoEdge bandwidth tracking and utilization reporting',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/ src/app/page.tsx src/app/layout.tsx
git commit -m "feat: dashboards with utilization overview and per-person drill-down"
```

---

## Phase 9: Deployment

### Task 17: Vercel Configuration & Deploy

**Files:**
- Create: `app/vercel.ts`
- Modify: `app/.env.local.example` (final check)

**Depends on:** All previous tasks

- [ ] **Step 1: Create vercel.ts with cron schedules**

```typescript
// app/vercel.ts
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [
    {
      // Every Monday at 9:00 AM IST (3:30 AM UTC)
      path: '/api/cron/start-cycle',
      schedule: '30 3 * * 1',
    },
    {
      // Every weekday (Tue-Fri) at 9:00 AM IST (3:30 AM UTC)
      path: '/api/cron/send-reminders',
      schedule: '30 3 * * 2-5',
    },
  ],
};
```

- [ ] **Step 2: Install @vercel/config**

```bash
cd app && pnpm add -D @vercel/config
```

- [ ] **Step 3: Provision infrastructure**

Run these manually:

1. **Vercel Marketplace Postgres:** Go to Vercel dashboard > Storage > Add > Postgres (Neon). This creates the `DATABASE_URL` env var automatically.

2. **Run migration:**
```bash
cd app && pnpm drizzle-kit push
```

3. **Set environment variables** on Vercel dashboard (or via CLI):
```bash
vercel-ie env add AIRTABLE_API_KEY
vercel-ie env add AIRTABLE_BASE_ID
vercel-ie env add RESEND_API_KEY
vercel-ie env add EMAIL_FROM
vercel-ie env add SLACK_WEBHOOK_URL
vercel-ie env add APP_URL
vercel-ie env add ADMIN_EMAIL
vercel-ie env add CC_EMAIL
vercel-ie env add CRON_SECRET
```

4. **Verify domain setup** in Resend for the `EMAIL_FROM` address.

- [ ] **Step 4: Deploy**

```bash
cd app && vercel-ie deploy --prod
```

- [ ] **Step 5: Verify crons registered**

```bash
vercel-ie crons ls
```

Expected: two crons listed (start-cycle on Mondays, send-reminders on weekdays).

- [ ] **Step 6: Commit**

```bash
git add vercel.ts package.json pnpm-lock.yaml
git commit -m "feat: Vercel deployment config with cron schedules"
```

---

## Dependency Graph

```
Task 1 (Foundation) ──┬── Task 2 (Scoring) ────────────────┐
                      ├── Task 3 (Utilization) ─────────────┤
                      ├── Task 4 (Conflicts) ───────────────┤
                      ├── Task 5 (Airtable Read) ──┬────────┤
                      │                            ├── Task 6 (Write-back)
                      │                            └── Task 9 (Form Page)
                      ├── Task 7 (Email) ───────────────────┤
                      ├── Task 8 (Slack) ───────────────────┤
                      ├── Task 14 (Admin) ──────────────────┤
                      ├── Task 15 (Dashboard Overview) ─────┤
                      └── Task 16 (Dashboard Drill-Down) ───┤
                                                            │
Tasks 2-9 ──> Task 10 (Submit API) ──> Task 11 (Resolution)│
                                                            │
Tasks 2,3,5,6,7,8 ──> Task 12 (Cycle Management) ──────────┤
                                                            │
Task 12 ──> Task 13 (Cron Routes) ─────────────────────────┤
                                                            │
All ──> Task 17 (Deploy) ──────────────────────────────────>│
```

Tasks 2, 3, 4 can run in parallel. Tasks 14, 15, 16 can run in parallel (they only need Task 1). Everything else is sequential along the critical path.

---

## Spec Coverage Checklist

| Spec Section | Task(s) |
|---|---|
| S3: Who Participates | Task 5 (fellows filter) |
| S4: Collection Cycle | Tasks 12, 13 (cycle + crons) |
| S5: Email Design | Task 7 (all 4 templates) |
| S6: Web Form | Tasks 9, 10 (form + API) |
| S7: Auto-Scoring | Task 2 (scoring engine) |
| S8: Cross-Referencing | Task 10 (submit API conflict detection) |
| S9: Airtable Write-Back | Tasks 6, 12 (writeback + finalization) |
| S10: Slack Integration | Tasks 8, 13 (slack + cron reminders) |
| S11: Dashboard Views | Tasks 15, 16 (overview + drill-down) |
| S12: Database Schema | Task 1 (all 5 tables) |
| S13: External Integrations | Tasks 5, 7, 8, 17 |
| Admin "not needed" toggle | Task 14 |
| Conflict Resolution | Task 11 |
| Historical Snapshots | Task 12 (in finalizeCycle) |
