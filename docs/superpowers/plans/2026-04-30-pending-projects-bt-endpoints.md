# Pending Projects — BT Integration Endpoints

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose four authenticated endpoints on the Bandwidth Tracker so an external automation (ie-checkin) can drain `pending_projects` rows by creating Airtable records, then track their lifecycle through director resolution.

**Architecture:** Extend the existing `pending_projects` table with a 3-state status enum (`pending → awaiting_setup → finished`) plus columns for `airtable_record_id`, `resolution`, `resolved_at`. Add `/api/admin/pending-projects/...` routes gated by a shared bearer token (`BT_INTEGRATION_SECRET`). BT remains storage + state-machine only; ie-checkin owns the Airtable side.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Neon Postgres, vitest. Existing repo conventions: API routes return JSON, `db` is a lazy Proxy from `@/lib/db`, schema lives in `@/lib/db/schema.ts`.

**Companion plan:** ie-checkin side at `Project Tracking System/ie-checkin/docs/plans/2026-04-30-pending-projects-drainer.md`. The two plans share a contract (the four endpoints below) but ship independently. BT ships first so ie-checkin has something to call.

---

## File Structure

**Modify:**
- `app/src/lib/db/schema.ts` — extend `pendingProjects` table (status enum + 3 new columns)
- `app/drizzle/0004_pending_projects_lifecycle.sql` — new migration

**Create:**
- `app/src/lib/integration-auth.ts` — Bearer token helper
- `app/src/app/api/admin/pending-projects/route.ts` — `GET` pending list
- `app/src/app/api/admin/pending-projects/[id]/awaiting-setup/route.ts` — `POST` transition
- `app/src/app/api/admin/pending-projects/awaiting-setup/route.ts` — `GET` awaiting list
- `app/src/app/api/admin/pending-projects/[id]/finish/route.ts` — `POST` resolve
- `app/tests/integration-auth.test.ts`
- `app/tests/api-pending-projects.test.ts`

**Total LoC estimate:** ~250 (most of it tests).

---

## Endpoint Contract

All routes require header `Authorization: Bearer ${BT_INTEGRATION_SECRET}`. Mismatch returns 401.

### `GET /api/admin/pending-projects`
Returns rows where `status='pending'`, sorted by `createdAt` ascending.

```json
{
  "rows": [
    {
      "id": "uuid",
      "type": "mandate" | "dde" | "pitch",
      "name": "Botlabs",
      "directorRecordId": "rec...",
      "directorName": "Shivakumar R",
      "teammateRecordIds": ["rec...", "rec..."],
      "createdByFellowName": "Yajur Sehgal",
      "createdAt": "2026-04-28T15:53:00Z",
      "cycleStartDate": "2026-04-27"
    }
  ]
}
```

### `POST /api/admin/pending-projects/:id/awaiting-setup`
Body: `{ "airtableRecordId": "rec..." }`. Sets `status='awaiting_setup'`, stores `airtableRecordId`. Idempotent: if already `awaiting_setup` with the same `airtableRecordId`, returns 200. If row is `finished`, returns 409.

Response: `{ "ok": true }` (200).

### `GET /api/admin/pending-projects/awaiting-setup`
Returns rows where `status='awaiting_setup'`. Same shape as `pending-projects` plus `airtableRecordId`.

```json
{
  "rows": [
    {
      "id": "uuid",
      "type": "mandate",
      "name": "Botlabs",
      "directorRecordId": "rec...",
      "directorName": "Shivakumar R",
      "airtableRecordId": "recABC123",
      "createdAt": "2026-04-28T15:53:00Z"
    }
  ]
}
```

### `POST /api/admin/pending-projects/:id/finish`
Body: `{ "resolution": "completed" | "rejected" }`. Sets `status='finished'`, stores `resolution` and `resolved_at=now()`. Idempotent: re-applying same resolution returns 200. Different resolution on already-finished row returns 409.

Response: `{ "ok": true }` (200).

---

## Task 1: Extend pendingProjects schema

**Files:**
- Modify: `app/src/lib/db/schema.ts:70-82` (the `pendingProjects` table block)

- [ ] **Step 1: Update the schema definition**

Replace the existing `pendingProjects` table block in `app/src/lib/db/schema.ts` with:

```ts
export const pendingProjects = pgTable('pending_projects', {
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
  status: text('status', { enum: ['pending', 'awaiting_setup', 'finished'] }).notNull().default('pending'),
  airtableRecordId: text('airtable_record_id'),
  resolution: text('resolution', { enum: ['completed', 'rejected'] }),
  resolvedAt: timestamp('resolved_at'),
});
```

- [ ] **Step 2: Generate the SQL migration**

Run from `app/`:
```bash
pnpm drizzle-kit generate
```

Expected: produces `drizzle/0004_*.sql`. Rename it to `drizzle/0004_pending_projects_lifecycle.sql` so it matches existing naming convention.

- [ ] **Step 3: Inspect the generated SQL**

Open the new migration. It should contain ALTER statements that:
- Drop the existing `status` check constraint and add a new one allowing `pending | awaiting_setup | finished`.
- Add `airtable_record_id text`.
- Add `resolution text` with check constraint allowing `completed | rejected | NULL`.
- Add `resolved_at timestamp`.

If drizzle-kit produced something different (it sometimes drops + recreates the column for enum changes), hand-edit the SQL to be a non-destructive `ALTER`. Existing rows must keep their `pending`/`finished` values intact.

- [ ] **Step 4: Apply migration to local Neon dev branch**

```bash
pnpm drizzle-kit push
```

Expected: "Changes applied" with the new columns visible. If using a Neon dev branch, point `DATABASE_URL` there first.

- [ ] **Step 5: Verify schema with a manual query**

```bash
psql "$DATABASE_URL" -c "\d pending_projects"
```

Expected: see the 3 new columns and the expanded `status` constraint.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/db/schema.ts app/drizzle/0004_pending_projects_lifecycle.sql app/drizzle/meta/
git commit -m "feat(db): extend pending_projects with awaiting_setup lifecycle"
```

---

## Task 2: Integration auth helper

**Files:**
- Create: `app/src/lib/integration-auth.ts`
- Test: `app/tests/integration-auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/integration-auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAuthorizedIntegrationRequest } from '../src/lib/integration-auth';

describe('isAuthorizedIntegrationRequest', () => {
  const ORIGINAL_SECRET = process.env.BT_INTEGRATION_SECRET;

  beforeEach(() => {
    process.env.BT_INTEGRATION_SECRET = 'test-secret-123';
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.BT_INTEGRATION_SECRET;
    else process.env.BT_INTEGRATION_SECRET = ORIGINAL_SECRET;
  });

  it('accepts a request with the correct bearer token', () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer test-secret-123' } });
    expect(isAuthorizedIntegrationRequest(req)).toBe(true);
  });

  it('rejects a request with the wrong token', () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer wrong' } });
    expect(isAuthorizedIntegrationRequest(req)).toBe(false);
  });

  it('rejects a request with no Authorization header', () => {
    const req = new Request('http://x');
    expect(isAuthorizedIntegrationRequest(req)).toBe(false);
  });

  it('rejects a request when BT_INTEGRATION_SECRET is unset', () => {
    delete process.env.BT_INTEGRATION_SECRET;
    const req = new Request('http://x', { headers: { authorization: 'Bearer test-secret-123' } });
    expect(isAuthorizedIntegrationRequest(req)).toBe(false);
  });

  it('rejects a request with malformed scheme', () => {
    const req = new Request('http://x', { headers: { authorization: 'test-secret-123' } });
    expect(isAuthorizedIntegrationRequest(req)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test integration-auth -- --run`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the helper**

Create `app/src/lib/integration-auth.ts`:

```ts
export function isAuthorizedIntegrationRequest(req: Request): boolean {
  const secret = process.env.BT_INTEGRATION_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  if (!header) return false;
  return header === `Bearer ${secret}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test integration-auth -- --run`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/integration-auth.ts app/tests/integration-auth.test.ts
git commit -m "feat(integration): add bearer-token auth helper for BT integration routes"
```

---

## Task 3: GET /api/admin/pending-projects

**Files:**
- Create: `app/src/app/api/admin/pending-projects/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects, cycles } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: pendingProjects.id,
      type: pendingProjects.type,
      name: pendingProjects.name,
      directorRecordId: pendingProjects.directorRecordId,
      directorName: pendingProjects.directorName,
      teammateRecordIds: pendingProjects.teammateRecordIds,
      createdByFellowName: pendingProjects.createdByFellowName,
      createdAt: pendingProjects.createdAt,
      cycleStartDate: cycles.startDate,
    })
    .from(pendingProjects)
    .innerJoin(cycles, eq(pendingProjects.cycleId, cycles.id))
    .where(eq(pendingProjects.status, 'pending'))
    .orderBy(asc(pendingProjects.createdAt));

  return NextResponse.json({ rows });
}
```

- [ ] **Step 2: Smoke-test against local dev**

Run: `pnpm dev` (in another terminal)

Then:
```bash
curl -i -H "Authorization: Bearer $BT_INTEGRATION_SECRET" http://localhost:3000/api/admin/pending-projects
```

Expected: 200 OK, JSON `{ rows: [...] }`. If no pending rows exist, `rows: []`.

```bash
curl -i http://localhost:3000/api/admin/pending-projects
```

Expected: 401.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/admin/pending-projects/route.ts
git commit -m "feat(api): GET /api/admin/pending-projects (integration list)"
```

---

## Task 4: POST /api/admin/pending-projects/:id/awaiting-setup

**Files:**
- Create: `app/src/app/api/admin/pending-projects/[id]/awaiting-setup/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { airtableRecordId?: string } | null;
  if (!body?.airtableRecordId) {
    return NextResponse.json({ error: 'airtableRecordId is required' }, { status: 400 });
  }

  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (row.status === 'awaiting_setup') {
    if (row.airtableRecordId === body.airtableRecordId) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: 'Already awaiting_setup with a different airtableRecordId' },
      { status: 409 }
    );
  }

  if (row.status === 'finished') {
    return NextResponse.json({ error: 'Already finished' }, { status: 409 });
  }

  await db
    .update(pendingProjects)
    .set({ status: 'awaiting_setup', airtableRecordId: body.airtableRecordId })
    .where(eq(pendingProjects.id, id));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Smoke-test**

Insert a fake pending row in the dev DB:
```bash
psql "$DATABASE_URL" -c "INSERT INTO pending_projects (cycle_id, type, name, teammate_record_ids, created_by_fellow_id, created_by_fellow_name) SELECT id, 'dde', 'TestCo', '[]'::jsonb, 'recX', 'TestFellow' FROM cycles ORDER BY created_at DESC LIMIT 1 RETURNING id;"
```

Note the returned `id`. Then:
```bash
curl -i -X POST -H "Authorization: Bearer $BT_INTEGRATION_SECRET" -H "Content-Type: application/json" -d '{"airtableRecordId":"recABC123"}' http://localhost:3000/api/admin/pending-projects/<id>/awaiting-setup
```

Expected: 200 `{ ok: true }`.

Re-run the same curl. Expected: 200 (idempotent).

Send a different airtableRecordId. Expected: 409.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/admin/pending-projects/[id]/awaiting-setup/route.ts
git commit -m "feat(api): POST awaiting-setup transition for pending projects"
```

---

## Task 5: GET /api/admin/pending-projects/awaiting-setup

**Files:**
- Create: `app/src/app/api/admin/pending-projects/awaiting-setup/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: pendingProjects.id,
      type: pendingProjects.type,
      name: pendingProjects.name,
      directorRecordId: pendingProjects.directorRecordId,
      directorName: pendingProjects.directorName,
      teammateRecordIds: pendingProjects.teammateRecordIds,
      createdByFellowName: pendingProjects.createdByFellowName,
      createdAt: pendingProjects.createdAt,
      airtableRecordId: pendingProjects.airtableRecordId,
    })
    .from(pendingProjects)
    .where(eq(pendingProjects.status, 'awaiting_setup'))
    .orderBy(asc(pendingProjects.createdAt));

  return NextResponse.json({ rows });
}
```

- [ ] **Step 2: Smoke-test**

```bash
curl -i -H "Authorization: Bearer $BT_INTEGRATION_SECRET" http://localhost:3000/api/admin/pending-projects/awaiting-setup
```

Expected: 200 with the row you transitioned in Task 4.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/admin/pending-projects/awaiting-setup/route.ts
git commit -m "feat(api): GET awaiting-setup list endpoint"
```

---

## Task 6: POST /api/admin/pending-projects/:id/finish

**Files:**
- Create: `app/src/app/api/admin/pending-projects/[id]/finish/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

type Resolution = 'completed' | 'rejected';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { resolution?: Resolution } | null;
  if (!body?.resolution || (body.resolution !== 'completed' && body.resolution !== 'rejected')) {
    return NextResponse.json(
      { error: 'resolution must be "completed" or "rejected"' },
      { status: 400 }
    );
  }

  const [row] = await db.select().from(pendingProjects).where(eq(pendingProjects.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (row.status === 'finished') {
    if (row.resolution === body.resolution) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: `Already finished with resolution=${row.resolution}` },
      { status: 409 }
    );
  }

  if (row.status !== 'awaiting_setup') {
    return NextResponse.json(
      { error: `Cannot finish from status=${row.status}` },
      { status: 409 }
    );
  }

  await db
    .update(pendingProjects)
    .set({ status: 'finished', resolution: body.resolution, resolvedAt: new Date() })
    .where(eq(pendingProjects.id, id));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Smoke-test**

Use the row id from Task 4:
```bash
curl -i -X POST -H "Authorization: Bearer $BT_INTEGRATION_SECRET" -H "Content-Type: application/json" -d '{"resolution":"completed"}' http://localhost:3000/api/admin/pending-projects/<id>/finish
```

Expected: 200. Re-run: 200 (idempotent). Send `rejected`: 409.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/admin/pending-projects/[id]/finish/route.ts
git commit -m "feat(api): POST finish endpoint for pending projects"
```

---

## Task 7: Integration tests for the four endpoints

**Files:**
- Create: `app/tests/api-pending-projects.test.ts`

- [ ] **Step 1: Write the test file**

This test exercises the routes through their handlers directly (no fetch). It mocks the db Proxy. Pattern matches `app/tests/conflicts.test.ts` if one exists; otherwise inline mock.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: mockSelect }) }), where: () => ({ orderBy: mockSelect, limit: mockSelect }) }) }),
    update: () => ({ set: () => ({ where: mockUpdate }) }),
  },
}));

import { GET as getPending } from '../src/app/api/admin/pending-projects/route';
import { GET as getAwaiting } from '../src/app/api/admin/pending-projects/awaiting-setup/route';
import { POST as postAwaitingSetup } from '../src/app/api/admin/pending-projects/[id]/awaiting-setup/route';
import { POST as postFinish } from '../src/app/api/admin/pending-projects/[id]/finish/route';

const SECRET = 'test-secret-xyz';
beforeEach(() => {
  process.env.BT_INTEGRATION_SECRET = SECRET;
  mockSelect.mockReset();
  mockUpdate.mockReset();
});

const auth = { headers: { authorization: `Bearer ${SECRET}` } };

describe('GET /api/admin/pending-projects', () => {
  it('returns 401 without auth', async () => {
    const res = await getPending(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns rows with auth', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', type: 'dde', name: 'TestCo' }]);
    const res = await getPending(new Request('http://x', auth));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
  });
});

describe('POST awaiting-setup', () => {
  const params = Promise.resolve({ id: 'u1' });

  it('returns 401 without auth', async () => {
    const res = await postAwaitingSetup(new Request('http://x', { method: 'POST' }), { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 without airtableRecordId', async () => {
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({}) }),
      { params }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when row missing', async () => {
    mockSelect.mockResolvedValueOnce([]);
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ airtableRecordId: 'recA' }) }),
      { params }
    );
    expect(res.status).toBe(404);
  });

  it('transitions pending -> awaiting_setup', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'pending', airtableRecordId: null }]);
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ airtableRecordId: 'recA' }) }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it('is idempotent for same airtableRecordId', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'awaiting_setup', airtableRecordId: 'recA' }]);
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ airtableRecordId: 'recA' }) }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it('returns 409 on different airtableRecordId', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'awaiting_setup', airtableRecordId: 'recA' }]);
    const res = await postAwaitingSetup(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ airtableRecordId: 'recB' }) }),
      { params }
    );
    expect(res.status).toBe(409);
  });
});

describe('POST finish', () => {
  const params = Promise.resolve({ id: 'u1' });

  it('returns 400 on bad resolution', async () => {
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'wat' }) }),
      { params }
    );
    expect(res.status).toBe(400);
  });

  it('transitions awaiting_setup -> finished with completed', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'awaiting_setup' }]);
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'completed' }) }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it('is idempotent for same resolution', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'finished', resolution: 'completed' }]);
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'completed' }) }),
      { params }
    );
    expect(res.status).toBe(200);
  });

  it('returns 409 on conflicting resolution', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'finished', resolution: 'completed' }]);
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'rejected' }) }),
      { params }
    );
    expect(res.status).toBe(409);
  });

  it('returns 409 from pending', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', status: 'pending' }]);
    const res = await postFinish(
      new Request('http://x', { method: 'POST', headers: auth.headers, body: JSON.stringify({ resolution: 'completed' }) }),
      { params }
    );
    expect(res.status).toBe(409);
  });
});

describe('GET awaiting-setup', () => {
  it('returns 401 without auth', async () => {
    const res = await getAwaiting(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns rows', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'u1', airtableRecordId: 'recA' }]);
    const res = await getAwaiting(new Request('http://x', auth));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test api-pending-projects -- --run`
Expected: all tests pass.

If the db mock structure doesn't match how Drizzle's chained calls actually flow in this codebase, simplify by mocking at a higher level (e.g., mock the whole `db` object's `.select()` to return a pre-built thenable). Look at any existing Drizzle-mocking test in `app/tests/` to copy the pattern.

- [ ] **Step 3: Run the full suite to make sure nothing else broke**

Run: `pnpm test -- --run`
Expected: previous count + new tests, all green. (Pre-change count is 117 per the latest MEMORY entry.)

- [ ] **Step 4: Commit**

```bash
git add app/tests/api-pending-projects.test.ts
git commit -m "test: integration coverage for pending-projects endpoints"
```

---

## Task 8: Provision BT_INTEGRATION_SECRET on Vercel

**This task is half automated, half user-confirmation. The shared secret must exist on BOTH Vercels (BT and ie-checkin), but actually adding it to ie-checkin is not in scope of this plan — it happens in the companion plan, or as a one-shot.**

- [ ] **Step 1: Generate a secret value**

```bash
openssl rand -hex 32
```

Save the output. This is the production value.

- [ ] **Step 2: Add to BT Vercel project**

```bash
printf '%s' '<secret-value>' | vercel-ie env add BT_INTEGRATION_SECRET production
```

Use `printf` (not `echo`) — `echo` adds a trailing newline that Vercel rejects on env vars used in HTTP headers (this exact bug is documented in `MEMORY.md`).

When prompted, confirm "Production".

- [ ] **Step 3: Verify it's set**

```bash
vercel-ie env ls | grep BT_INTEGRATION_SECRET
```

Expected: visible in Production scope.

- [ ] **Step 4: Hand the secret value to the companion plan**

The same value goes onto ie-checkin's Vercel project. See `Project Tracking System/ie-checkin/docs/plans/2026-04-30-pending-projects-drainer.md`, Task 12.

---

## Task 9: Apply schema migration to production Neon

**This task touches production. Run only after Tasks 1-7 are merged.**

- [ ] **Step 1: Pull production env**

```bash
cd app && vercel-ie env pull .env.production
```

- [ ] **Step 2: Strip wrapping quotes**

Per the `MEMORY.md` learning, `vercel env pull` wraps values in double quotes with literal `\n` trailing. Inspect `.env.production` and clean any line that doesn't deserialize cleanly. Existing prod migrations have used this same flow.

- [ ] **Step 3: Apply migration to prod Neon**

```bash
DATABASE_URL=$(grep '^DATABASE_URL=' .env.production | cut -d'=' -f2- | tr -d '"') pnpm drizzle-kit push
```

Expected: "Changes applied" mentioning the new columns and constraint.

- [ ] **Step 4: Spot-check production schema**

```bash
DATABASE_URL=$(grep '^DATABASE_URL=' .env.production | cut -d'=' -f2- | tr -d '"') psql "$DATABASE_URL" -c "\d pending_projects"
```

Expected: 3 new columns, expanded status check.

Existing rows should still show `pending` or `finished`. None should be `awaiting_setup` yet — that state only exists once ie-checkin starts calling the endpoints.

- [ ] **Step 5: Cleanup**

```bash
rm .env.production
```

---

## Task 10: Deploy to Vercel

- [ ] **Step 1: Push to git**

```bash
git push origin main
```

- [ ] **Step 2: Confirm Vercel auto-deploy succeeded**

Watch `vercel-ie ls` or the Vercel dashboard. Build should succeed.

- [ ] **Step 3: Smoke-test against production**

```bash
SECRET=<the-value-from-task-8>
curl -i -H "Authorization: Bearer $SECRET" https://bandwidth-and-utilization.vercel.app/api/admin/pending-projects
```

Expected: 200 with current pending rows (could be empty — that's fine).

```bash
curl -i https://bandwidth-and-utilization.vercel.app/api/admin/pending-projects
```

Expected: 401.

- [ ] **Step 4: Done**

The BT side of this work is complete. ie-checkin now has a contract to call against. Move to the companion plan.

---

## Self-review checklist

**Spec coverage.** Section 4 of `Pending-Projects-Drain-Requirements.md` covers GET pending, POST complete, and "what does NOT change." This plan adds two endpoints beyond the original (`GET awaiting-setup`, `POST finish` replacing `POST complete`) because Option A keeps stub lifecycle in BT instead of deleting drained rows. Section 4.3 (no schema change to existing fields, no form changes, no Slack post changes, bandwidth submissions still work with `pending_*` IDs) is preserved — none of those touched here.

**Placeholder scan.** None.

**Type consistency.** `awaiting_setup` matches across schema enum, route handler comparisons, and test fixtures. `airtableRecordId` named consistently in DB column (`airtable_record_id`) and TS field. `resolution` enum (`completed | rejected`) consistent.

**Migration safety.** The migration only adds columns and expands a check constraint. Existing `pending`/`finished` rows are valid under the new constraint. No backfill needed because no existing row had `awaiting_setup`.

**What's NOT in this plan.** No changes to the `pending_projects` form, the Slack post, the cycle bandwidth math, or the dashboard. All scoped to integration endpoints + schema lifecycle.
