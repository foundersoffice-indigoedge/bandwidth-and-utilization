# Per-Mandate Role Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide each fellow's per-mandate bandwidth role (senior / second-senior / associate) from their Airtable column placement, not a global title flag, so a promoted AVP is senior where they sit in the VP/AVP column and an ordinary associate where they sit in the Associate column.

**Architecture:** One pure module (`src/lib/project-role.ts`) becomes the single source of truth for senior determination, allowed projection targets, and display role. Every consumer (submit page, submit API, add-project API, director-flag routing, peer/conflict emails) calls it instead of re-deriving from `isVpOrAvp(designation)`. Server routes validate client-posted entries against server-computed roles. No DB schema change.

**Tech Stack:** Next.js App Router (TS), Drizzle/Postgres, Airtable via `ie-ai-rulebook` field contracts, Vitest.

## Global Constraints

- Designation is always read from the IE Fellow List and printed as the person's title on every form/email. Never blanket-relabel an AVP/VP as "Associate"; use a per-project "acting as …" pill only.
- Senior = **first eligible VP/AVP in slot order**, then an eligible VP/AVP in the Director slot, else none. Eligible VP/AVP = designation in `utilization-mis.vocab.vp-avp` (`VP`,`AVP`) and present in the eligible-fellows set.
- No DB migration; `submissions` never stores designation/role. Historical data stays intact.
- The server is authoritative: never trust client-posted `targetFellowId`s; validate against `resolveProjectRole`.
- TDD, DRY, YAGNI, frequent commits. Test runner: `pnpm test:run` (Vitest) from `app/`.
- All commands run from `app/` (the Vercel root directory), i.e. `.../Utilization MIS/app`.

---

## File Structure

- **Create** `src/lib/project-role.ts` — pure role resolver (`determineSeniorId`, `resolveProjectRole`, `computeAllowedTargets`, `isPendingProjectSenior`, `isAllowedSubmissionEntry`).
- **Create** `tests/project-role.test.ts` — unit tests for the resolver.
- (`tests/rules-contract.test.ts` already locks VP/AVP slot order — no change, just keep it green.)
- **Modify** `src/app/submit/[token]/page.tsx` — replace the `isVpRun/isVp/isLeadVp` block with `resolveProjectRole`; extract a pure `buildFormProjects` helper; pass performed role to the form.
- **Create** `src/app/submit/[token]/build-form-projects.ts` — the extracted pure helper (testable without rendering the server component).
- **Create** `tests/build-form-projects.test.ts`.
- **Modify** `src/app/submit/[token]/form-entries.ts` — drop the global `isVp` param; drive associate inputs off each project's `associates`.
- **Modify** `tests/form-entries.test.ts` — update signature usage.
- **Modify** `src/app/submit/[token]/form.tsx` — render per-project role pill; generalize the lead line.
- **Modify** `src/app/api/submit/route.ts` — server-side entry validation, projection-based conflict gate, idempotency guard.
- **Modify** `src/app/api/add-project/route.ts` — pending-project senior rule + teammate validation.
- **Modify** `src/lib/director-flag.ts` + `src/lib/signoff.ts` (caller) + `tests/director-flag.test.ts` — placement-aware resolver via `determineSeniorId`; cover AVP-in-associate-slot.
- **Modify** `src/lib/peer-bandwidth.ts` + `tests/peer-bandwidth.test.ts` — per-project performed-role on `PeerProjectRow`; pill in HTML.
- **Modify** `src/lib/email.ts` + conflict-email callers + `tests/templates-golden.test.ts` (+ snapshot) — performed-role label in conflict emails.

---

## Task 1: Pure role resolver (`project-role.ts`)

**Files:**
- Create: `src/lib/project-role.ts`
- Test: `tests/project-role.test.ts`

**Interfaces:**
- Consumes: `ProjectAssignment` from `src/types.ts`; `isVpOrAvp` from `src/lib/airtable/fellows.ts`.
- Produces:
  - `type MandateRole = 'senior' | 'second_senior' | 'associate'`
  - `interface ResolvedProjectRole { role: MandateRole; isSenior: boolean; targetFellowIds: string[] }`
  - `type IsEligibleVpAvp = (recordId: string) => boolean`
  - `determineSeniorId(vpAvpIds: string[], directorIds: string[], isEligible: IsEligibleVpAvp): string | null`
  - `resolveProjectRole(project: ProjectAssignment, fellowRecordId: string, isEligible: IsEligibleVpAvp): ResolvedProjectRole`
  - `computeAllowedTargets(projects: ProjectAssignment[], fellowRecordId: string, isEligible: IsEligibleVpAvp): Map<string, Set<string>>`
  - `isPendingProjectSenior(designation: string): boolean`
  - `isAllowedSubmissionEntry(entry: { projectRecordId: string; targetFellowId: string | null }, allowedTargets: Map<string, Set<string>>, fellowProjectIds: Set<string>): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/project-role.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  determineSeniorId,
  resolveProjectRole,
  computeAllowedTargets,
  isAllowedSubmissionEntry,
} from '../src/lib/project-role';
import type { ProjectAssignment } from '../src/types';

function project(o: Partial<ProjectAssignment>): ProjectAssignment {
  return {
    projectRecordId: 'recP', projectName: 'P', projectType: 'mandate',
    stage: 'Mandate Signed', vpAvpIds: [], associateIds: [], directorIds: [], ...o,
  };
}

// Eligibility predicate: everyone listed here is an eligible VP/AVP.
const eligible = (ids: string[]) => (id: string) => ids.includes(id);

describe('determineSeniorId', () => {
  it('picks the first eligible VP/AVP in slot order', () => {
    expect(determineSeniorId(['recA', 'recB'], [], eligible(['recA', 'recB']))).toBe('recA');
  });
  it('skips a non-eligible slot-1 occupant (e.g. a Director) for the next eligible VP/AVP', () => {
    expect(determineSeniorId(['recDir', 'recAvp'], [], eligible(['recAvp']))).toBe('recAvp');
  });
  it('falls back to an eligible VP/AVP in the director slot when no VP/AVP occupant', () => {
    expect(determineSeniorId([], ['recLeadVp'], eligible(['recLeadVp']))).toBe('recLeadVp');
  });
  it('returns null when there is no eligible senior anywhere', () => {
    expect(determineSeniorId(['recDir'], ['recDir2'], eligible([]))).toBeNull();
  });
});

describe('resolveProjectRole', () => {
  it('senior projects for all associate-slot occupants', () => {
    const p = project({ vpAvpIds: ['recSenior'], associateIds: ['recA1', 'recA2'] });
    expect(resolveProjectRole(p, 'recSenior', eligible(['recSenior']))).toEqual({
      role: 'senior', isSenior: true, targetFellowIds: ['recA1', 'recA2'],
    });
  });
  it('second VP/AVP submits self only, projects for nobody', () => {
    const p = project({ vpAvpIds: ['recSenior', 'recSecond'], associateIds: ['recA1'] });
    expect(resolveProjectRole(p, 'recSecond', eligible(['recSenior', 'recSecond']))).toEqual({
      role: 'second_senior', isSenior: false, targetFellowIds: [],
    });
  });
  it('AVP in an associate slot is an associate here (self only), covered by the senior', () => {
    // Adit (AVP) sits in the associate column; Tanya is the senior.
    const p = project({ vpAvpIds: ['recTanya'], associateIds: ['recAdit'] });
    expect(resolveProjectRole(p, 'recAdit', eligible(['recTanya', 'recAdit']))).toEqual({
      role: 'associate', isSenior: false, targetFellowIds: [],
    });
    // And the senior's targets include Adit:
    expect(resolveProjectRole(p, 'recTanya', eligible(['recTanya', 'recAdit'])).targetFellowIds)
      .toContain('recAdit');
  });
  it('no eligible senior → an associate still self-only, nobody projects', () => {
    const p = project({ vpAvpIds: [], associateIds: ['recAdit'], directorIds: ['recRealDirector'] });
    expect(resolveProjectRole(p, 'recAdit', eligible([]))).toEqual({
      role: 'associate', isSenior: false, targetFellowIds: [],
    });
  });
});

describe('computeAllowedTargets', () => {
  it('maps each project to the set of ids the fellow may project for', () => {
    const p1 = project({ projectRecordId: 'p1', vpAvpIds: ['recMe'], associateIds: ['recA1'] });
    const p2 = project({ projectRecordId: 'p2', vpAvpIds: ['recOther'], associateIds: ['recMe'] });
    const map = computeAllowedTargets([p1, p2], 'recMe', eligible(['recMe', 'recOther']));
    expect(map.get('p1')).toEqual(new Set(['recA1'])); // senior on p1
    expect(map.get('p2')).toEqual(new Set());          // associate on p2
  });
});

describe('isAllowedSubmissionEntry', () => {
  const p1 = project({ projectRecordId: 'p1', vpAvpIds: ['recMe'], associateIds: ['recA1'] });
  const p2 = project({ projectRecordId: 'p2', vpAvpIds: ['recOther'], associateIds: ['recMe'] });
  const allowed = computeAllowedTargets([p1, p2], 'recMe', eligible(['recMe', 'recOther']));
  const onProjects = new Set(['p1', 'p2']);

  it('allows a self-report on a project the fellow is on', () => {
    expect(isAllowedSubmissionEntry({ projectRecordId: 'p1', targetFellowId: null }, allowed, onProjects)).toBe(true);
  });
  it('rejects a self-report on a project the fellow is NOT on', () => {
    expect(isAllowedSubmissionEntry({ projectRecordId: 'pX', targetFellowId: null }, allowed, onProjects)).toBe(false);
  });
  it('allows a senior projection to a real associate', () => {
    expect(isAllowedSubmissionEntry({ projectRecordId: 'p1', targetFellowId: 'recA1' }, allowed, onProjects)).toBe(true);
  });
  it('rejects a projection where the fellow is only an associate (p2)', () => {
    expect(isAllowedSubmissionEntry({ projectRecordId: 'p2', targetFellowId: 'recSomeone' }, allowed, onProjects)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run tests/project-role.test.ts`
Expected: FAIL — cannot resolve `../src/lib/project-role`.

- [ ] **Step 3: Write the module**

Create `src/lib/project-role.ts`:

```ts
import type { ProjectAssignment } from '@/types';
import { getStringList } from 'ie-ai-rulebook';

export type MandateRole = 'senior' | 'second_senior' | 'associate';

export interface ResolvedProjectRole {
  role: MandateRole;
  isSenior: boolean;
  /** Fellow ids this fellow must project bandwidth for (associate-slot occupants when senior; else []). */
  targetFellowIds: string[];
}

export type IsEligibleVpAvp = (recordId: string) => boolean;

/** First eligible VP/AVP in slot order, then an eligible VP/AVP leading from the director slot, else null. */
export function determineSeniorId(
  vpAvpIds: string[],
  directorIds: string[],
  isEligible: IsEligibleVpAvp,
): string | null {
  for (const id of vpAvpIds) if (isEligible(id)) return id;
  for (const id of directorIds) if (isEligible(id)) return id;
  return null;
}

export function resolveProjectRole(
  project: ProjectAssignment,
  fellowRecordId: string,
  isEligible: IsEligibleVpAvp,
): ResolvedProjectRole {
  const seniorId = determineSeniorId(project.vpAvpIds, project.directorIds, isEligible);
  if (seniorId && fellowRecordId === seniorId) {
    return { role: 'senior', isSenior: true, targetFellowIds: project.associateIds };
  }
  if (project.vpAvpIds.includes(fellowRecordId) || project.directorIds.includes(fellowRecordId)) {
    return { role: 'second_senior', isSenior: false, targetFellowIds: [] };
  }
  return { role: 'associate', isSenior: false, targetFellowIds: [] };
}

/** projectRecordId → set of fellow ids this fellow is allowed to project for. Used to validate submit payloads. */
export function computeAllowedTargets(
  projects: ProjectAssignment[],
  fellowRecordId: string,
  isEligible: IsEligibleVpAvp,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of projects) {
    const { targetFellowIds } = resolveProjectRole(p, fellowRecordId, isEligible);
    map.set(p.projectRecordId, new Set(targetFellowIds));
  }
  return map;
}

/** Pending (mid-cycle) projects have no Airtable columns; the creator is senior iff they are a VP/AVP.
 *  Reads the vocab directly from the rulebook to keep this module free of the airtable client import. */
export function isPendingProjectSenior(designation: string): boolean {
  return getStringList('utilization-mis.vocab.vp-avp').includes(designation);
}

/** Server-side gate for a posted (non-pending) submission entry. Self-reports are allowed only for
 *  projects the fellow is actually on; projections only to an authorized target on that project. */
export function isAllowedSubmissionEntry(
  entry: { projectRecordId: string; targetFellowId: string | null },
  allowedTargets: Map<string, Set<string>>,
  fellowProjectIds: Set<string>,
): boolean {
  if (entry.targetFellowId === null) return fellowProjectIds.has(entry.projectRecordId);
  return allowedTargets.get(entry.projectRecordId)?.has(entry.targetFellowId) ?? false;
}
```

Note: `resolveProjectRole`/`determineSeniorId`/`computeAllowedTargets` take an injected `isEligible` predicate, so this module imports no airtable client code — it stays pure/deterministic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run tests/project-role.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-role.ts tests/project-role.test.ts
git commit -m "feat(role): pure per-mandate role resolver"
```

---

## Task 2: (Removed — slot ordering is already locked)

`tests/rules-contract.test.ts` already asserts the VP/AVP field order that senior selection depends on:
`m.vpAvpFields === ['Mandate VP / AVP 1', 'Mandate VP / AVP 2']` and `p.vpAvpFields === ['Pitch VP / AVP', 'Pitch VP / AVP 2']`.
No new test needed. When implementing, just confirm this file still passes; if it ever fails, senior selection must be revisited. No code change, no commit.

---

## Task 3: Extract + wire `buildFormProjects` into the submit page

**Files:**
- Create: `src/app/submit/[token]/build-form-projects.ts`
- Test: `tests/build-form-projects.test.ts`
- Modify: `src/app/submit/[token]/page.tsx:61-96` (the `projectsWithAssociates` block)

**Interfaces:**
- Consumes: `resolveProjectRole`, `isPendingProjectSenior` (Task 1); `ProjectAssignment`, `Fellow` types.
- Produces:
  - `interface FormProject { projectRecordId: string; projectName: string; projectType: ProjectType; stage: string; associates: { recordId: string; name: string }[]; isVpRun?: boolean; leadFellowName?: string; performedRole: MandateRole; performedRoleLabel: string | null }`
  - `buildFormProjects(fellowProjects: ProjectAssignment[], fellowRecordId: string, fellowDesignation: string, fellows: Fellow[]): FormProject[]`

`performedRoleLabel` is `null` when the performed role matches the person's designation tier; otherwise a short string like `"acting as Associate"`.

- [ ] **Step 1: Write the failing test**

Create `tests/build-form-projects.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFormProjects } from '../src/app/submit/[token]/build-form-projects';
import type { ProjectAssignment, Fellow } from '../src/types';

const fellows: Fellow[] = [
  { recordId: 'recTanya', name: 'Tanya', email: 't@x.com', designation: 'AVP' },
  { recordId: 'recAdit', name: 'Adit', email: 'a@x.com', designation: 'AVP' },
  { recordId: 'recAssoc', name: 'Assoc', email: 'c@x.com', designation: 'Associate 2' },
];

function project(o: Partial<ProjectAssignment>): ProjectAssignment {
  return { projectRecordId: 'recP', projectName: 'P', projectType: 'mandate',
    stage: 'Mandate Signed', vpAvpIds: [], associateIds: [], directorIds: [], ...o };
}

describe('buildFormProjects', () => {
  it('senior AVP sees associate inputs and no acting-as pill', () => {
    const p = project({ projectRecordId: 'fresh', vpAvpIds: ['recAdit'], associateIds: ['recAssoc'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates.map(a => a.recordId)).toEqual(['recAssoc']);
    expect(fp.performedRole).toBe('senior');
    expect(fp.performedRoleLabel).toBeNull();
    expect(fp.leadFellowName).toBe('Adit'); // senior on this mandate
  });

  it('AVP in the associate slot sees self only, an "acting as Associate" pill, and the real senior as lead', () => {
    const p = project({ projectRecordId: 'pant', vpAvpIds: ['recTanya'], associateIds: ['recAdit'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates).toEqual([]);
    expect(fp.performedRole).toBe('associate');
    expect(fp.performedRoleLabel).toBe('acting as Associate');
    expect(fp.leadFellowName).toBe('Tanya'); // lead line shows the senior even on a director-led mandate
  });

  it('second VP/AVP sees self only', () => {
    const p = project({ projectRecordId: 'two', vpAvpIds: ['recTanya', 'recAdit'], associateIds: ['recAssoc'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates).toEqual([]);
    expect(fp.performedRole).toBe('second_senior');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:run tests/build-form-projects.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `src/app/submit/[token]/build-form-projects.ts`:

```ts
import type { ProjectAssignment, Fellow, ProjectType } from '@/types';
import { isVpOrAvp } from '@/lib/airtable/fellows';
import { resolveProjectRole, determineSeniorId, type MandateRole } from '@/lib/project-role';

export interface FormProject {
  projectRecordId: string;
  projectName: string;
  projectType: ProjectType;
  stage: string;
  associates: { recordId: string; name: string }[];
  isVpRun?: boolean;
  leadFellowName?: string;
  performedRole: MandateRole;
  performedRoleLabel: string | null;
}

const ROLE_NOUN: Record<MandateRole, string> = {
  senior: 'VP/AVP',
  second_senior: 'VP/AVP',
  associate: 'Associate',
};

/** Show a pill only when the mandate role differs from the person's own designation tier. */
function pillFor(role: MandateRole, designation: string): string | null {
  const actingAssociate = role === 'associate' && isVpOrAvp(designation);
  return actingAssociate ? 'acting as Associate' : null;
}

export function buildFormProjects(
  fellowProjects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string,
  fellows: Fellow[],
): FormProject[] {
  const byId = new Map(fellows.map(f => [f.recordId, f]));
  const isEligible = (id: string) => {
    const f = byId.get(id);
    return !!f && isVpOrAvp(f.designation);
  };

  return fellowProjects.map(project => {
    const { role, targetFellowIds } = resolveProjectRole(project, fellowRecordId, isEligible);
    const associates = targetFellowIds
      .map(id => byId.get(id))
      .filter((f): f is Fellow => f != null)
      .map(f => ({ recordId: f.recordId, name: f.name }));

    // Lead line: the project's senior, computed the same way for every mandate type
    // (the Airtable `leadFellowName` is only populated for VP-run mandates, so don't rely on it).
    const seniorId = determineSeniorId(project.vpAvpIds, project.directorIds, isEligible);
    const leadFellowName = seniorId ? byId.get(seniorId)?.name : undefined;

    return {
      projectRecordId: project.projectRecordId,
      projectName: project.projectName,
      projectType: project.projectType,
      stage: project.stage,
      associates,
      isVpRun: project.isVpRun,
      leadFellowName,
      performedRole: role,
      performedRoleLabel: pillFor(role, fellowDesignation),
    };
  });
}
```

Note: `ROLE_NOUN` is exported-in-spirit but only `pillFor` needs it right now; keep it if a future "acting as VP/AVP" case appears, else inline. (YAGNI: if only the associate pill is needed, delete `ROLE_NOUN` and hardcode the string in `pillFor`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:run tests/build-form-projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `page.tsx`**

In `src/app/submit/[token]/page.tsx`, replace the whole `const projectsWithAssociates = fellowProjects.map(...)` block (currently lines ~61-96, the `isVpRunMandate`/`isLeadVp`/`targetIds` logic) with:

```tsx
import { buildFormProjects } from './build-form-projects';
// ...
const projectsWithAssociates = buildFormProjects(
  fellowProjects,
  tokenRecord.fellowRecordId,
  tokenRecord.fellowDesignation,
  fellows,
);
```

Remove the now-unused `const isVp = isVpOrAvp(tokenRecord.fellowDesignation);` only if it is not used elsewhere in the file. It is still used by the `myPendingProjects` branch — leave that branch for Task 7 and keep `isVp` until then (do not delete in this task). Pass `performedRoleLabel` through to the form (the form already receives the `projects` array; the new field rides along).

- [ ] **Step 6: Run the full suite + typecheck**

Run: `pnpm test:run && npx tsc --noEmit`
Expected: PASS, no type errors. (Existing page behavior for VP-run mandates is now driven by column order; confirm `projects-for-fellow` and any page tests pass.)

- [ ] **Step 7: Commit**

```bash
git add src/app/submit/[token]/build-form-projects.ts tests/build-form-projects.test.ts "src/app/submit/[token]/page.tsx"
git commit -m "feat(role): column-based form projects on submit page"
```

---

## Task 4: `form-entries.ts` — drop global `isVp`

**Files:**
- Modify: `src/app/submit/[token]/form-entries.ts`
- Modify: `tests/form-entries.test.ts`

**Interfaces:**
- Produces: `deriveEntries(projects: ProjectShape[], userInput: Record<string, HoursEntry>, initialEntries?: ...): Record<string, HoursEntry>` (the `isVp` parameter is removed).

Rationale: whether the viewer projects for associates is now encoded per-project in `project.associates` (populated only for a senior by Task 3). `deriveEntries` should always iterate `project.associates`.

- [ ] **Step 1: Update the tests to the new signature (make them fail)**

In `tests/form-entries.test.ts`, remove the `isVp` argument from every `deriveEntries(...)` call, and adjust expectations so associate keys appear whenever `associates` is non-empty regardless of a title flag. Add:

```ts
it('creates associate entries whenever the project lists associates (no global VP flag)', () => {
  const projects = [mandate]; // mandate has one associate
  const result = deriveEntries(projects, {});
  expect(result['recMandate1:self']).toBeDefined();
  expect(result['recMandate1:recAssoc1']).toBeDefined();
});

it('creates only a self entry when the project lists no associates', () => {
  const projects = [pitch]; // pitch has associates: []
  const result = deriveEntries(projects, {});
  expect(result['recPitch1:self']).toBeDefined();
  expect(Object.keys(result).filter(k => k.startsWith('recPitch1:'))).toEqual(['recPitch1:self']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run tests/form-entries.test.ts`
Expected: FAIL — `deriveEntries` still requires the `isVp` boolean / arity mismatch.

- [ ] **Step 3: Edit `deriveEntries`**

In `src/app/submit/[token]/form-entries.ts`, change the signature and the loop:

```ts
export function deriveEntries(
  projects: ProjectShape[],
  userInput: Record<string, HoursEntry>,
  initialEntries: Record<string, { hoursValue: string; hoursUnit: 'per_day' | 'per_week' }> = {},
): Record<string, HoursEntry> {
  const result: Record<string, HoursEntry> = {};
  for (const project of projects) {
    const selfKey = `${project.projectRecordId}:self`;
    result[selfKey] = userInput[selfKey] ?? withInitial(defaultEntry(project.projectRecordId, null), initialEntries[selfKey]);
    for (const assoc of project.associates) {
      const key = `${project.projectRecordId}:${assoc.recordId}`;
      result[key] = userInput[key] ?? withInitial(defaultEntry(project.projectRecordId, assoc.recordId), initialEntries[key]);
    }
  }
  return result;
}
```

- [ ] **Step 4: Update the form caller (two edits in `form.tsx`)**

(a) In the `useMemo`, drop the `isVp` argument:

```tsx
() => deriveEntries(projects, userInput, initialEntries),
[projects, userInput, initialEntries],
```

(b) The main-form associate inputs currently gate on the global `isVp` (~line 149: `{isVp && project.associates.map(...)}`). Change this to per-project, since `associates` is now populated only for a senior:

```tsx
{project.associates.map(assoc => (
  <HoursInput
    key={assoc.recordId}
    label={assoc.name}
    entry={entries[`${project.projectRecordId}:${assoc.recordId}`]}
    onChange={(field, val) => update(`${project.projectRecordId}:${assoc.recordId}`, field, val)}
  />
))}
```

(An empty `associates` renders nothing, so the guard is unnecessary.) The `isVp` prop stays on the component for the add-project UI and is repurposed in Task 7; only these two main-form uses change here.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test:run tests/form-entries.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/submit/[token]/form-entries.ts" tests/form-entries.test.ts "src/app/submit/[token]/form.tsx"
git commit -m "refactor(role): derive form entries from per-project associates"
```

---

## Task 5: Role pill + lead line in `form.tsx`

**Files:**
- Modify: `src/app/submit/[token]/form.tsx`

**Interfaces:**
- Consumes: `FormProject.performedRoleLabel`, `FormProject.leadFellowName` from Task 3.

- [ ] **Step 1: Update the `Project` interface in `form.tsx`**

Add `performedRoleLabel?: string | null;` to the local `Project`/`FormProject` interface used by the form.

- [ ] **Step 2: Render the pill and generalize the lead line**

In the project header block (currently ~lines 136-140), keep the VP-run badge as a pure mandate-type marker but strip the `· Led by` from inside it, and add the role pill + a standalone lead line. Replace:

```tsx
{project.isVpRun && (
  <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-medium">
    VP-run{project.leadFellowName ? ` · Led by ${project.leadFellowName}` : ''}
  </span>
)}
```

with:

```tsx
{project.isVpRun && (
  <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-medium">
    VP-run
  </span>
)}
{project.performedRoleLabel && (
  <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
    {project.performedRoleLabel}
  </span>
)}
{project.leadFellowName && (
  <span className="text-xs text-gray-500">Led by {project.leadFellowName}</span>
)}
```

The "Led by" now shows for any mandate with a known senior (`leadFellowName` is set by `buildFormProjects` from the computed senior).

- [ ] **Step 3: Manual/visual check via existing snapshot tests**

Run: `pnpm test:run`
Expected: PASS. If a form snapshot exists and legitimately changed, update it with `pnpm test:run -u` and eyeball the diff (pill added, lead line generalized).

- [ ] **Step 4: Commit**

```bash
git add "src/app/submit/[token]/form.tsx" tests/__snapshots__ 2>/dev/null; git add "src/app/submit/[token]/form.tsx"
git commit -m "feat(role): show acting-as pill and generalized lead line"
```

---

## Task 6: Submit route — server validation, conflict gate, idempotency

**Files:**
- Modify: `src/app/api/submit/route.ts`

**Interfaces:**
- Consumes: `computeAllowedTargets`, `isAllowedSubmissionEntry`, `determineSeniorId` (Task 1); `fetchAllProjects`, `fetchEligibleFellows`, `isVpOrAvp`.

The pure decision (`isAllowedSubmissionEntry`) is already tested in Task 1. This task wires it into the route and hardens conflict creation. All steps below edit `src/app/api/submit/route.ts` only.

- [ ] **Step 1: Build the eligibility predicate, fellow-project set, and allowed-target map**

Near the top of `POST`, after `const allProjects = await fetchAllProjects();` (the map `projectMap` is built right after — keep it), add:

```ts
import { computeAllowedTargets, isAllowedSubmissionEntry, determineSeniorId } from '@/lib/project-role';
// ...
const eligibleFellows = await fetchEligibleFellows();
const eligibleById = new Map(eligibleFellows.map(f => [f.recordId, f]));
const isEligibleVpAvp = (id: string) => {
  const f = eligibleById.get(id);
  return !!f && isVpOrAvp(f.designation);
};
const fellowProjects = allProjects.filter(p =>
  p.vpAvpIds.includes(tokenRecord.fellowRecordId) ||
  p.associateIds.includes(tokenRecord.fellowRecordId) ||
  p.directorIds.includes(tokenRecord.fellowRecordId),
);
const fellowProjectIds = new Set(fellowProjects.map(p => p.projectRecordId));
const allowedTargets = computeAllowedTargets(fellowProjects, tokenRecord.fellowRecordId, isEligibleVpAvp);
```

- [ ] **Step 2: Validate every non-pending entry before insert (self-reports too)**

Inside `for (const entry of entries)`, in the non-pending branch (`else { ... }` where `project = projectMap.get(...)`), right after `const isSelfReport = entry.targetFellowId === null;`, drop unauthorized entries:

```ts
if (!isAllowedSubmissionEntry(
      { projectRecordId: entry.projectRecordId, targetFellowId: entry.targetFellowId },
      allowedTargets, fellowProjectIds,
    )) {
  continue; // reject self-reports on projects the fellow isn't on, and unauthorized projections
}
```

(Pending entries — `projectRecordId.startsWith('pending_')` — keep their existing branch; Task 7 governs them.)

- [ ] **Step 3: Replace the title-based conflict gate**

Delete `const isVp = isVpOrAvp(tokenRecord.fellowDesignation);` in this route. Change the first conflict block condition from `if (isVp && !sub.isSelfReport && sub.targetFellowId) {` to:

```ts
if (!sub.isSelfReport && sub.targetFellowId) {
```

- [ ] **Step 4: Harden the self-report conflict block to the current senior**

The second block (on a self-report, find existing projections targeting this fellow) must only treat a projection as valid if its author is the project's **current senior**. Replace the loop that iterates `vpProjections` so it first computes the senior and skips others:

```ts
const seniorId = (() => {
  const proj = allProjects.find(p => p.projectRecordId === sub.projectRecordId);
  return proj ? determineSeniorId(proj.vpAvpIds, proj.directorIds, isEligibleVpAvp) : null;
})();
for (const vpSub of vpProjections) {
  if (vpSub.fellowRecordId !== seniorId) continue; // ignore stale / non-senior projections
  if (isConflict(vpSub.hoursPerDay, sub.hoursPerDay!)) {
    // ... existing conflict-creation, with the idempotency guard from Step 5 ...
  }
}
```

- [ ] **Step 5: Add a full idempotency guard before each conflict insert**

In BOTH conflict-creation blocks, immediately before `await db.insert(conflicts).values({...})`, add. First block (VP just submitted a projection; ids `sub.id`, `assocSub.id`):

```ts
const [dup1] = await db.select().from(conflicts).where(and(
  eq(conflicts.cycleId, tokenRecord.cycleId),
  eq(conflicts.projectRecordId, sub.projectRecordId!),
  eq(conflicts.vpSubmissionId, sub.id),
  eq(conflicts.associateSubmissionId, assocSub.id),
  eq(conflicts.source, 'submission'),
)).limit(1);
if (dup1) continue;
```

Second block (self-report finds a senior projection; ids `vpSub.id`, `sub.id`):

```ts
const [dup2] = await db.select().from(conflicts).where(and(
  eq(conflicts.cycleId, tokenRecord.cycleId),
  eq(conflicts.projectRecordId, sub.projectRecordId!),
  eq(conflicts.vpSubmissionId, vpSub.id),
  eq(conflicts.associateSubmissionId, sub.id),
  eq(conflicts.source, 'submission'),
)).limit(1);
if (dup2) continue;
```

(`conflicts.source` defaults to `'submission'`; the guard matches only submission-origin conflicts, never director-flag ones.)

- [ ] **Step 6: Run tests + typecheck + build**

Run: `pnpm test:run && npx tsc --noEmit`
Expected: PASS. The pure gate is covered by Task 1's `isAllowedSubmissionEntry` tests; this step verifies the wiring compiles and no existing submit/conflict test regresses.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/submit/route.ts"
git commit -m "feat(role): server-validate entries, senior-scoped conflicts, idempotency"
```

---

## Task 7: Add-project route — pending senior rule + teammate validation

**Files:**
- Modify: `src/app/api/add-project/route.ts`
- Modify: `src/app/submit/[token]/page.tsx` (the `myPendingProjects` branch)

**Interfaces:**
- Consumes: `isPendingProjectSenior` (Task 1).

- [ ] **Step 1: Replace the title check in the API**

In `src/app/api/add-project/route.ts`, change:

```ts
const isVp = isVpOrAvp(tokenRecord.fellowDesignation);
```

to:

```ts
import { isPendingProjectSenior } from '@/lib/project-role';
const creatorIsSenior = isPendingProjectSenior(tokenRecord.fellowDesignation);
```

and update the guard `if (isVp && payload.teammateBandwidth ...)` to `if (creatorIsSenior && payload.teammateBandwidth ...)`.

- [ ] **Step 2: Validate posted teammate ids against eligible fellows**

Inside the teammate loop, skip any teammate id not in the eligible-fellow map (already fetched as `fellowMap`):

```ts
for (const tb of payload.teammateBandwidth) {
  if (!fellowMap.has(tb.recordId)) continue; // reject unknown / ineligible teammate ids
  // ... existing projection + conflict logic ...
}
```

- [ ] **Step 3: Repurpose `isVp` in the page to the pending-senior capability**

In `src/app/submit/[token]/page.tsx`, replace the old global `const isVp = isVpOrAvp(tokenRecord.fellowDesignation);` with:

```ts
import { isPendingProjectSenior } from '@/lib/project-role';
const canProjectForPending = isPendingProjectSenior(tokenRecord.fellowDesignation);
```

- Use `canProjectForPending` in the `myPendingProjects` mapping: `const associates = canProjectForPending ? teammateIds.map(...) : [];`.
- The `<SubmissionForm ... />` render currently passes `isVp={isVp}`. Change it to `isVp={canProjectForPending}` (the form prop keeps its name to avoid a wide rename; it now means "may this fellow add projections for teammates on a *pending* project"). The `SubmissionForm`/`AddProjectBlock` prop and its uses in `form.tsx` are unchanged — they already only use `isVp` for the add-project teammate UI after Task 4 removed its main-form and `deriveEntries` uses.
- Remove the now-unused `isVpOrAvp` import from `page.tsx` if nothing else references it (the eligibility predicate for real projects lives inside `buildFormProjects`, so `page.tsx` no longer needs `isVpOrAvp` directly).

- [ ] **Step 4: Test the pending rule**

Add to `tests/project-role.test.ts`:

```ts
import { isPendingProjectSenior } from '../src/lib/project-role';
describe('isPendingProjectSenior', () => {
  it('true for VP and AVP, false for associates', () => {
    expect(isPendingProjectSenior('VP')).toBe(true);
    expect(isPendingProjectSenior('AVP')).toBe(true);
    expect(isPendingProjectSenior('Associate 2')).toBe(false);
  });
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test:run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/add-project/route.ts" "src/app/submit/[token]/page.tsx" tests/project-role.test.ts
git commit -m "feat(role): pending-project senior rule + teammate validation"
```

---

## Task 8: Director-flag routing follows performed role

**Files:**
- Modify: `src/lib/director-flag.ts`
- Modify: `tests/director-flag.test.ts`

**Interfaces:**
- Consumes: `determineSeniorId` (Task 1).
- Produces (changed): `computeResolverForFlag(input: FlagResolverInput): ResolverResult`, where `FlagResolverInput` gains `projectDirectorIds: string[]`.

- [ ] **Step 1: Write the failing test**

Add to `tests/director-flag.test.ts`:

```ts
it('routes an AVP-in-associate-slot flag to the mandate senior, not the AVP', () => {
  const adit = { recordId: 'recAdit', designation: 'AVP', email: 'a@x.com', name: 'Adit' };
  const tanya = { recordId: 'recTanya', designation: 'AVP', email: 't@x.com', name: 'Tanya' };
  const res = computeResolverForFlag({
    flaggedFellow: adit,
    projectVpAvpIds: ['recTanya'],      // Tanya is the senior; Adit sits in the associate slot
    projectDirectorIds: [],
    allFellows: [adit, tanya],
  });
  expect(res.resolverFellowId).toBe('recTanya');
});

it('lets an AVP who is the project senior resolve their own flag', () => {
  const adit = { recordId: 'recAdit', designation: 'AVP', email: 'a@x.com', name: 'Adit' };
  const res = computeResolverForFlag({
    flaggedFellow: adit,
    projectVpAvpIds: ['recAdit'],
    projectDirectorIds: [],
    allFellows: [adit],
  });
  expect(res.resolverFellowId).toBe('recAdit');
});
```

Update existing `computeResolverForFlag` calls in this test file to pass `projectDirectorIds: []`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run tests/director-flag.test.ts`
Expected: FAIL — AVP self-resolves under the old title rule; `projectDirectorIds` not accepted.

- [ ] **Step 3: Rewrite the resolver**

In `src/lib/director-flag.ts`, add `projectDirectorIds: string[]` to `FlagResolverInput` and replace the body of `computeResolverForFlag`:

```ts
import { determineSeniorId } from '@/lib/project-role';

export function computeResolverForFlag(input: FlagResolverInput): ResolverResult {
  const { flaggedFellow, projectVpAvpIds, projectDirectorIds, allFellows, adminEmail } = input;
  const byId = new Map(allFellows.map(f => [f.recordId, f]));
  const isEligible = (id: string) => {
    const f = byId.get(id);
    return !!f && isVpOrAvp(f.designation);
  };

  const seniorId = determineSeniorId(projectVpAvpIds, projectDirectorIds, isEligible);

  // The senior resolves. If the flagged fellow IS the senior, they resolve themselves.
  if (seniorId) {
    const s = byId.get(seniorId)!;
    return { resolverFellowId: s.recordId, resolverEmail: s.email, resolverName: s.name };
  }

  // No senior on the project — flagged fellow resolves themselves if reachable.
  const self = byId.get(flaggedFellow.recordId);
  if (self) return { resolverFellowId: self.recordId, resolverEmail: self.email, resolverName: self.name };

  return { resolverFellowId: null, resolverEmail: adminEmail || 'admin@indigoedge.com', resolverName: null };
}
```

- [ ] **Step 4: Update the sole caller (`src/lib/signoff.ts`)**

The only non-test caller is `src/lib/signoff.ts` (~line 335), inside `enriched.map(item => { const resolver = computeResolverForFlag({ flaggedFellow: {...}, projectVpAvpIds: item.project.vpAvpIds, ... }) })`. Add the new field:

```ts
projectVpAvpIds: item.project.vpAvpIds,
projectDirectorIds: item.project.directorIds,
```

Confirm no other caller exists: `rg -n computeResolverForFlag src` should show only `director-flag.ts` (definition) and `signoff.ts` (this call).

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test:run tests/director-flag.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/director-flag.ts tests/director-flag.test.ts $(rg -l computeResolverForFlag src)
git commit -m "feat(role): director-flag resolver follows performed role"
```

---

## Task 9: Performed-role pill in the peer-bandwidth email

**Files:**
- Modify: `src/lib/peer-bandwidth.ts`
- Modify: `tests/peer-bandwidth.test.ts`

**Interfaces:**
- Consumes: `resolveProjectRole` (Task 1); `isVpOrAvp` from `src/lib/airtable/fellows.ts`. `assemblePeerBandwidthData` already receives `allProjects` and `fellows` (confirm by reading its signature: `assemblePeerBandwidthData(allSubmissions, fellows, allProjects, dateRange, pendingFellowIds)`).
- Produces (changed): `PeerProjectRow` gains `performedRoleLabel: string | null`.

- [ ] **Step 1: Write the failing test**

In `tests/peer-bandwidth.test.ts`, reuse the existing `SubmissionRow`/`Fellow`/`ProjectAssignment` fixtures in that file. Add a teammate who is an `AVP` sitting in the associate slot of a shared project (project `vpAvpIds: ['recOtherVp']` eligible VP/AVP, `associateIds: ['recTeammate']`), with a self-report submission for that project. Assert:

```ts
const models = assemblePeerBandwidthData(subs, fellows, projects, 'Jul 6 – Jul 12, 2026', new Set());
const row = models
  .flatMap(m => m.teammates)
  .find(t => t.recordId === 'recTeammate')!
  .projects.find(p => p.projectRecordId === 'recShared')!;
expect(row.performedRoleLabel).toBe('acting as Associate');
// designation label unchanged:
const tm = models.flatMap(m => m.teammates).find(t => t.recordId === 'recTeammate')!;
expect(tm.designation).toBe('AVP');
```

(If the file lacks a ready `ProjectAssignment` fixture, add one with the `project({...})` helper pattern used elsewhere.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run tests/peer-bandwidth.test.ts`
Expected: FAIL — `performedRoleLabel` undefined.

- [ ] **Step 3: Populate the field at assembly time**

At the top of `src/lib/peer-bandwidth.ts` add imports:

```ts
import { resolveProjectRole } from '@/lib/project-role';
import { isVpOrAvp } from '@/lib/airtable/fellows';
```

Add `performedRoleLabel: string | null;` to the `PeerProjectRow` interface. In `assemblePeerBandwidthData`, build the eligibility predicate once (fellows are in scope):

```ts
const eligById = new Map(fellows.map(f => [f.recordId, f]));
const isEligible = (id: string) => {
  const f = eligById.get(id);
  return !!f && isVpOrAvp(f.designation);
};
```

In the `selfSubs.map(s => { ... })` that builds each `PeerProjectRow` (note: `fellow` there is the teammate whose row this is), compute:

```ts
const proj = allProjects.find(p => p.projectRecordId === s.projectRecordId);
const role = proj ? resolveProjectRole(proj, fellow.recordId, isEligible).role : 'associate';
const performedRoleLabel =
  role === 'associate' && isVpOrAvp(fellow.designation) ? 'acting as Associate' : null;
```

and include `performedRoleLabel` in the returned row object. In `buildPeerBandwidthEmailHtml`, in the `projectRows` map, append a pill to the project-name cell when present:

```ts
const pill = p.performedRoleLabel
  ? ` <span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;font-size:10px">${p.performedRoleLabel}</span>`
  : '';
```

and interpolate `${pill}` right after `${p.projectName}${sharedBadge}` in the cell.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test:run tests/peer-bandwidth.test.ts && npx tsc --noEmit`
Expected: PASS. If a peer-bandwidth golden snapshot exists and changed, review and update with `-u`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/peer-bandwidth.ts tests/peer-bandwidth.test.ts
git commit -m "feat(role): performed-role pill in peer bandwidth email"
```

---

## Task 10: Performed-role label in conflict emails

**Files:**
- Modify: `src/lib/email.ts` (`sendConflictEmail`, and reminder/resolution senders if they render the associate's name)
- Modify: `src/app/api/submit/route.ts` and `src/app/api/add-project/route.ts` (callers pass the label)
- Modify: `tests/templates-golden.test.ts` + `tests/__snapshots__/templates-golden.test.ts.snap`

The user asked for the role to flow into conflict emails, not just peer emails. The conflict email names a senior and one associate; when that associate is an AVP-in-associate-slot, show the pill next to their name.

- [ ] **Step 1: Extend `sendConflictEmail` with an optional label**

In `src/lib/email.ts`, add a trailing optional parameter to `sendConflictEmail(...)`: `associateRoleLabel?: string`. Where the associate's name is rendered in the HTML, append a small pill when the label is present (same amber style as the peer pill). Keep the parameter optional so nothing breaks if a caller omits it.

- [ ] **Step 2: Compute + pass the label from the submit route**

In `src/app/api/submit/route.ts`, at each `sendConflictEmail(...)` call, compute the associate's performed role on that project via `resolveProjectRole(proj, associateFellowId, isEligibleVpAvp)` and pass `role === 'associate' && isVpOrAvp(associateDesignation) ? 'acting as Associate' : undefined`. The associate's designation comes from `eligibleById.get(associateFellowId)?.designation`. Do the same in `src/app/api/add-project/route.ts` (it already has `fellowMap`).

- [ ] **Step 3: Update the golden snapshots deliberately**

`tests/templates-golden.test.ts` calls the conflict senders directly. Add one case that passes `associateRoleLabel: 'acting as Associate'` and assert the pill appears; leave the existing no-label cases unchanged (the optional param means their output is identical). Run `pnpm test:run tests/templates-golden.test.ts`; if the snapshot legitimately changed only for the new case, update with `-u` and eyeball the diff.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test:run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts "src/app/api/submit/route.ts" "src/app/api/add-project/route.ts" tests/templates-golden.test.ts tests/__snapshots__
git commit -m "feat(role): performed-role label in conflict emails"
```

---

## Task 11: Full-suite green + production build

**Files:** none (verification task).

- [ ] **Step 1: Run everything**

Run: `pnpm test:run && npx tsc --noEmit && pnpm build`
Expected: all tests pass, no type errors, production build succeeds.

- [ ] **Step 2: Grep for stragglers**

Run: `rg -n "isVpOrAvp\\(tokenRecord.fellowDesignation\\)|isLeadVp|isVpRunMandate" src`
Expected: no remaining title-based role decisions in the collection/conflict paths (only sign-off scope may legitimately use designation/isVpRun). Investigate any hit.

- [ ] **Step 3: Commit any final cleanup**

```bash
git add -A && git commit -m "chore(role): verification pass" || echo "nothing to commit"
```

---

## Rollout (operational, after merge)

1. This repo's git→Vercel auto-deploy is currently broken (private-dep install). Deploy via the prebuilt path from `app/`'s repo root: `vercel build --prod && vercel deploy --prebuilt --prod` (IE Vercel token), as was done for the pause. Or fix the pipeline first (separate task).
2. Verify on the deployment: open a submit link for a known AVP-in-associate-slot fellow (e.g. Adit on a Pant-type mandate) and confirm the form shows self-only + the "acting as Associate" pill; open a senior's link and confirm associate inputs appear.
3. Remove the `2026-07-06` skip guard in `src/app/api/cron/start-cycle/route.ts` (or let it lapse — it only skips that one date) so the next Monday cycle runs the new logic.

## Self-Review Checklist (run before handing off)

- Spec §5 core rule → Tasks 1, 3. §6 senior determination → Task 1. §7.3 page → Tasks 3, 7. §7.4 form-entries → Task 4. §7.5 form pill → Task 5. §7.6 submit validation/gate/idempotency → Task 6. §7.7 add-project → Task 7. §7.8 director-flag → Task 8. §7.9 peer email → Task 9, conflict email → Task 10. §11 tests → each task (slot-order already locked in `rules-contract.test.ts`). §13 rollout → Rollout section. All covered.
- No placeholders; every code step has real code.
- Type/symbol names consistent across tasks: `MandateRole`, `ResolvedProjectRole`, `IsEligibleVpAvp`, `determineSeniorId`, `resolveProjectRole`, `computeAllowedTargets`, `isPendingProjectSenior`, `isAllowedSubmissionEntry`, `FormProject`, `buildFormProjects`.
- Codex round-2 findings incorporated: self-report validation (Task 6.2), senior-scoped self-report conflict block (6.4), full idempotency guards with `source` (6.5), `isVp`→`canProjectForPending` repurpose keeps `form.tsx` compiling (7.3), `leadFellowName` derived from computed senior (3), `signoff.ts` caller updated (8.4), peer import fixed + conflict emails as their own task (9, 10), `project-role.ts` free of the airtable client import (1).
