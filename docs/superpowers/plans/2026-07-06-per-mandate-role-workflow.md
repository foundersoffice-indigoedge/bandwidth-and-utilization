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

- **Create** `src/lib/project-role.ts` — pure role resolver (`determineSeniorId`, `resolveProjectRole`, `computeAllowedTargets`, `isPendingProjectSenior`).
- **Create** `tests/project-role.test.ts` — unit tests for the resolver.
- **Modify** `tests/rules-contract.test.ts` — add VP/AVP slot-order contract assertions.
- **Modify** `src/app/submit/[token]/page.tsx` — replace the `isVpRun/isVp/isLeadVp` block with `resolveProjectRole`; extract a pure `buildFormProjects` helper; pass performed role to the form.
- **Create** `src/app/submit/[token]/build-form-projects.ts` — the extracted pure helper (testable without rendering the server component).
- **Create** `tests/build-form-projects.test.ts`.
- **Modify** `src/app/submit/[token]/form-entries.ts` — drop the global `isVp` param; drive associate inputs off each project's `associates`.
- **Modify** `tests/form-entries.test.ts` — update signature usage.
- **Modify** `src/app/submit/[token]/form.tsx` — render per-project role pill; generalize the lead line.
- **Modify** `src/app/api/submit/route.ts` — server-side entry validation, projection-based conflict gate, idempotency guard.
- **Modify** `src/app/api/add-project/route.ts` — pending-project senior rule + teammate validation.
- **Modify** `src/lib/director-flag.ts` — placement-aware resolver via `determineSeniorId`.
- **Modify** `tests/director-flag.test.ts` — cover AVP-in-associate-slot.
- **Modify** `src/lib/peer-bandwidth.ts` + `tests/peer-bandwidth.test.ts` — per-project performed-role on `PeerProjectRow`; pill in HTML.

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

- [ ] **Step 1: Write the failing tests**

Create `tests/project-role.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  determineSeniorId,
  resolveProjectRole,
  computeAllowedTargets,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run tests/project-role.test.ts`
Expected: FAIL — cannot resolve `../src/lib/project-role`.

- [ ] **Step 3: Write the module**

Create `src/lib/project-role.ts`:

```ts
import type { ProjectAssignment } from '@/types';
import { isVpOrAvp } from '@/lib/airtable/fellows';

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

/** Pending (mid-cycle) projects have no Airtable columns; the creator is senior iff they are a VP/AVP. */
export function isPendingProjectSenior(designation: string): boolean {
  return isVpOrAvp(designation);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run tests/project-role.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-role.ts tests/project-role.test.ts
git commit -m "feat(role): pure per-mandate role resolver"
```

---

## Task 2: Slot-order contract test

**Files:**
- Modify: `tests/rules-contract.test.ts`

**Interfaces:**
- Consumes: `teamRoleFields` from `ie-ai-rulebook` (already used by `src/lib/airtable/config.ts`).

Senior selection depends on `fetchAllProjects` preserving VP/AVP slot order, which comes from the rulebook. Lock it.

- [ ] **Step 1: Add the failing assertions**

Append to `tests/rules-contract.test.ts`:

```ts
import { teamRoleFields } from 'ie-ai-rulebook';

describe('VP/AVP slot ordering contract (senior selection depends on it)', () => {
  it('mandate VP/AVP fields are ordered [1, 2]', () => {
    const names = teamRoleFields('mandate', 'vpAvp').map(f => f.name);
    expect(names[0]).toBe('Mandate VP / AVP 1');
    expect(names[1]).toBe('Mandate VP / AVP 2');
  });
  it('pitch VP/AVP has the primary slot first', () => {
    const names = teamRoleFields('pitch', 'vpAvp').map(f => f.name);
    expect(names[0]).toBe('Pitch VP / AVP');
  });
});
```

- [ ] **Step 2: Run to verify pass (contract currently holds)**

Run: `pnpm test:run tests/rules-contract.test.ts`
Expected: PASS. (If it fails, the rulebook contract changed and senior selection must be revisited — that is the point of this test.)

- [ ] **Step 3: Commit**

```bash
git add tests/rules-contract.test.ts
git commit -m "test(role): lock VP/AVP slot ordering contract"
```

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
  });

  it('AVP in the associate slot sees self only and an "acting as Associate" pill', () => {
    const p = project({ projectRecordId: 'pant', vpAvpIds: ['recTanya'], associateIds: ['recAdit'] });
    const [fp] = buildFormProjects([p], 'recAdit', 'AVP', fellows);
    expect(fp.associates).toEqual([]);
    expect(fp.performedRole).toBe('associate');
    expect(fp.performedRoleLabel).toBe('acting as Associate');
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
import { resolveProjectRole, type MandateRole } from '@/lib/project-role';

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

    return {
      projectRecordId: project.projectRecordId,
      projectName: project.projectName,
      projectType: project.projectType,
      stage: project.stage,
      associates,
      isVpRun: project.isVpRun,
      leadFellowName: project.leadFellowName,
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

- [ ] **Step 4: Update the form caller**

In `src/app/submit/[token]/form.tsx`, find the `deriveEntries(` call (inside the `useMemo`) and remove the `isVp` argument. The `isVp` prop stays on the component for now (used by add-project UI); only the `deriveEntries` call loses it.

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

Where each project header renders (near the current `VP-run{project.leadFellowName ? ...}` line ~138), add:

```tsx
{project.performedRoleLabel && (
  <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
    {project.performedRoleLabel}
  </span>
)}
{project.leadFellowName && (
  <span className="ml-2 text-xs text-gray-500">Led by {project.leadFellowName}</span>
)}
```

Remove the old `VP-run · Led by …` conditional (the "Led by" now shows for any mandate with a known senior; `leadFellowName` is only set when there is one).

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
- Consumes: `computeAllowedTargets` (Task 1); `fetchAllProjects`, `fetchEligibleFellows`, `isVpOrAvp`.

- [ ] **Step 1: Build the eligibility predicate + allowed-target map early**

Near the top of `POST`, after `const allProjects = await fetchAllProjects();` and after the token is validated, add:

```ts
import { computeAllowedTargets } from '@/lib/project-role';
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
const allowedTargets = computeAllowedTargets(fellowProjects, tokenRecord.fellowRecordId, isEligibleVpAvp);
```

- [ ] **Step 2: Validate each entry before insert**

Inside the `for (const entry of entries)` loop, for non-pending, non-self entries, drop anything not allowed. Right after `const isSelfReport = entry.targetFellowId === null;` (for the non-pending branch) add:

```ts
if (!isPending && !isSelfReport) {
  const allowed = allowedTargets.get(entry.projectRecordId);
  if (!allowed || !allowed.has(entry.targetFellowId!)) {
    continue; // ignore projections the server did not authorize
  }
}
```

(Pending projects are handled in Task 7; leave their branch unchanged here.)

- [ ] **Step 3: Replace the title-based conflict gate**

Change the first conflict block condition from:

```ts
if (isVp && !sub.isSelfReport && sub.targetFellowId) {
```

to:

```ts
if (!sub.isSelfReport && sub.targetFellowId) {
```

and delete the now-unused `const isVp = isVpOrAvp(tokenRecord.fellowDesignation);` line in this route.

- [ ] **Step 4: Add an idempotency guard before inserting a conflict**

In BOTH conflict-creation blocks, immediately before `await db.insert(conflicts).values({...})`, add a guard:

```ts
const [dup] = await db
  .select()
  .from(conflicts)
  .where(and(
    eq(conflicts.cycleId, tokenRecord.cycleId),
    eq(conflicts.projectRecordId, sub.projectRecordId!),
    eq(conflicts.vpSubmissionId, /* the projection submission id in scope */),
    eq(conflicts.associateSubmissionId, /* the self-report submission id in scope */),
  ))
  .limit(1);
if (dup) continue;
```

Use the correct submission-id variables local to each block (`sub.id`/`assocSub.id` in the first block; `vpSub.id`/`sub.id` in the second).

- [ ] **Step 5: Add a focused test for validation + gate**

Because the route touches the DB, add a unit test for the pure guard instead. Extract the drop-decision into a tiny exported helper in `project-role.ts` if not already covered by `computeAllowedTargets`. `computeAllowedTargets` already gives us the check; add to `tests/project-role.test.ts`:

```ts
it('a projection to a non-allowed target is rejected by the allowed-target map', () => {
  const p = project({ projectRecordId: 'p2', vpAvpIds: ['recOther'], associateIds: ['recMe'] });
  const map = computeAllowedTargets([p], 'recMe', eligible(['recOther', 'recMe']));
  expect(map.get('p2')!.has('recSomeAssoc')).toBe(false); // recMe is an associate here → may project for no one
});
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `pnpm test:run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/submit/route.ts" tests/project-role.test.ts
git commit -m "feat(role): server-validate projections + projection-based conflict gate"
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

- [ ] **Step 3: Align the page's pending branch**

In `src/app/submit/[token]/page.tsx`, the `myPendingProjects` mapping currently uses `const associates = isVp ? teammateIds... : []`. Replace `isVp` there with the same pending rule:

```ts
import { isPendingProjectSenior } from '@/lib/project-role';
const creatorIsSenior = isPendingProjectSenior(tokenRecord.fellowDesignation);
// ...
const associates = creatorIsSenior ? teammateIds.map(...) : [];
```

Now the last use of the old `isVp` in `page.tsx` is gone — delete the `const isVp = isVpOrAvp(...)` line and its unused import if any.

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

- [ ] **Step 4: Update the caller**

Find every `computeResolverForFlag({ ... })` call in `src/` (grep: `rg -n computeResolverForFlag src`) and add `projectDirectorIds` from the project (the caller already has the `ProjectAssignment`; pass `project.directorIds`).

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test:run tests/director-flag.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/director-flag.ts tests/director-flag.test.ts $(rg -l computeResolverForFlag src)
git commit -m "feat(role): director-flag resolver follows performed role"
```

---

## Task 9: Performed-role pill in peer + conflict emails

**Files:**
- Modify: `src/lib/peer-bandwidth.ts`
- Modify: `tests/peer-bandwidth.test.ts`

**Interfaces:**
- Consumes: `resolveProjectRole` (Task 1). `assemblePeerBandwidthData` already has `allProjects` and `fellows`.
- Produces (changed): `PeerProjectRow` gains `performedRoleLabel: string | null`.

- [ ] **Step 1: Write the failing test**

Add to `tests/peer-bandwidth.test.ts` a case where a teammate is an AVP sitting in an associate slot on a shared project, and assert the assembled `PeerProjectRow.performedRoleLabel === 'acting as Associate'`, while the teammate's `designation` stays `'AVP'`. (Mirror the fixture shape already used in that file; set the project so `vpAvpIds` has another eligible VP/AVP and `associateIds` includes the teammate.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run tests/peer-bandwidth.test.ts`
Expected: FAIL — `performedRoleLabel` undefined.

- [ ] **Step 3: Populate the field at assembly time**

In `assemblePeerBandwidthData`, where each `PeerProjectRow` is built (the `selfSubs.map`), compute the teammate's performed role on that project:

```ts
import { resolveProjectRole } from '@/lib/project-role';
// build isEligible once from `fellows`:
const eligById = new Map(fellows.map(f => [f.recordId, f]));
const isEligible = (id: string) => {
  const f = eligById.get(id);
  return !!f && isVpOrAvp(f.designation);
};
// inside the projects map, per submission's project:
const proj = allProjects.find(p => p.projectRecordId === s.projectRecordId);
const role = proj ? resolveProjectRole(proj, fellow.recordId, isEligible).role : 'associate';
const performedRoleLabel =
  role === 'associate' && isVpOrAvp(fellow.designation) ? 'acting as Associate' : null;
```

Add `performedRoleLabel` to the `PeerProjectRow` object and to its interface. In `buildPeerBandwidthEmailHtml`, render the label as a small pill in the project row when present (append to the project-name cell).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test:run tests/peer-bandwidth.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/peer-bandwidth.ts tests/peer-bandwidth.test.ts
git commit -m "feat(role): performed-role pill in peer bandwidth email"
```

---

## Task 10: Full-suite green + production build

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

- Spec §5 core rule → Tasks 1, 3. Spec §6 senior determination → Task 1. Spec §7.3 page → Task 3. §7.4 form-entries → Task 4. §7.5 form pill → Task 5. §7.6 submit validation/gate/idempotency → Task 6. §7.7 add-project → Task 7. §7.8 director-flag → Task 8. §7.9 peer/email → Task 9. §11 tests → each task + Task 2 contract. §13 rollout → Rollout section. All covered.
- No placeholders; every code step has real code.
- Type names consistent: `MandateRole`, `ResolvedProjectRole`, `IsEligibleVpAvp`, `determineSeniorId`, `resolveProjectRole`, `computeAllowedTargets`, `isPendingProjectSenior`, `FormProject`, `buildFormProjects` used identically across tasks.
