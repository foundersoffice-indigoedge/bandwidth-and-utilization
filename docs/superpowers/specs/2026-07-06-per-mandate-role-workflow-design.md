# Per-Mandate Role Workflow — Design Spec

- **Date:** 2026-07-06
- **Status:** Draft — self-reviewed + Codex-reviewed (7 findings incorporated); pending user approval
- **Author:** Ajder (via Claude)
- **Related:** [director-signoff-design](2026-05-13-director-signoff-design.md), [utilization-mis-v2-updates-design](2026-04-20-utilization-mis-v2-updates-design.md)

## 1. Context & Problem

Several IB team members were promoted: Shan → Director; Anmol, Harshal, Adit, Nihar → AVP (from Associate); Murali → VP (from AVP). Designations are already updated in the IE Fellow List (Airtable), and on some mandates these people have been moved into the VP/AVP column while on others they remain in the Associate column.

The Utilization MIS bandwidth-collection workflow currently decides "who reports bandwidth for whom" using two signals that no longer fit:

1. **A person-level `isVp` flag** derived from designation (`isVpOrAvp(tokenRecord.fellowDesignation)`), applied globally across every project the person is on.
2. **The `isVpRun` mandate flag**, which branches the seniority logic differently for VP-run vs director-led mandates.

Consequences with the new promotions:

- An AVP sitting in the **Associate** column of a mandate (e.g. Adit on the Pant project) is still treated as a senior there, because `isVp` is global. He gets asked to project bandwidth for the other associates, and even for himself (he appears in that mandate's associate list). Wrong.
- On director-led mandates, **two** AVP/VPs both project for all associates (peers), producing duplicate projections and possible cross-conflicts.
- Seniority between two seniors is only resolved on VP-run mandates, not director-led ones.

### Real-data confirmation (Airtable, base `appmsoOuN72RJ9Qho`)

- Designations verified: Shan T = Director, Murali = VP, Anmol/Harshal/Adit/Nihar = AVP.
- Adit (`recHwqlv7i3t6Qsdc`) is VP/AVP-1 on some active mandates (`rec2TI02iVs2mrOEq`) and an Associate on others (`recBLMWSyfOrv5xQv`, `recn4tUJjCryEy2SO`, `reclgMJ0SZScSEZYe`). Exactly the mixed-role case.
- VP/AVP-2 slot is populated on many mandates, so the two-senior case is real and common.
- Edge patterns present in live data: mandates with an associate and **no VP/AVP** (`reclgMJ0SZScSEZYe`), and Directors occupying a VP/AVP slot on older mandates (non-eligible for collection).

## 2. Goals

1. A person's **per-mandate role is decided by which column they occupy on that mandate**, not by a global title flag.
2. On any mandate with two or more seniors, **the occupant of the first VP/AVP slot is senior** and owns projecting + conflict resolution for that mandate, regardless of VP-run vs director-led.
3. The **second VP/AVP** submits only their own bandwidth: nobody projects for them, they never enter a conflict, and no conflict email reaches them.
4. An AVP/VP sitting in an **Associate** slot behaves as an associate on that mandate (self-report only) and is **covered by the senior like any associate** (senior projects a number for them; a mismatch is a conflict they participate in).
5. **Designation is always taken from the IE Fellow List and printed as the person's title** on every form and email. Where the mandate role differs from the title, a small "acting as …" pill conveys the performed role. People are never blanket-relabelled as associates.
6. **No data migration, no corruption of historical data.**

## 3. Non-Goals

- No change to the utilization/scoring maths, capacity calibration, or load tags.
- No change to director sign-off scope logic beyond what already exists (VP-run mandates keep having no director).
- No persistence of "performed role" onto submissions or snapshots (drill-down role history is out of scope; see §11).
- No change to how projects are matched to a fellow (`getProjectsForFellow` still matches any column the person occupies).

## 4. Definitions

- **Slot order:** The rulebook (`shared.fields.team-roles`) defines ordered VP/AVP fields per project type — Mandate: `VP / AVP 1`, `VP / AVP 2`; Pitch: `VP / AVP`, `VP / AVP 2`; DDE: single `VP / AVP`. `fetchAllProjects` reads them in order, so the flattened `vpAvpIds` list preserves slot order (index 0 = first slot).
- **Eligible VP/AVP:** A fellow whose designation is in `utilization-mis.vocab.vp-avp` (`VP`, `AVP`) and who passes the standard eligibility filter (current IB employee). Directors are not eligible for collection.
- **Senior (per project):** The first **eligible VP/AVP** in slot order. If no VP/AVP slot holds an eligible VP/AVP, fall back to an eligible VP/AVP occupying the **Director** slot (the existing "leads from director slot" pattern). If neither exists, the project has **no senior**.
- **Performed role (per project, per fellow):** `senior`, `second_senior`, or `associate` — derived purely from column placement (see §5).

## 5. The Core Rule

For a given fellow on a given project, the role and who they project for:

| Fellow's placement on the project | Submits | Projects for | Conflict role | Title pill |
|---|---|---|---|---|
| Is the project's **senior** (first eligible VP/AVP, or the director-slot lead) | Own bandwidth | **Every associate-slot occupant** (any title) | Owns all conflicts on the mandate | none (or their title) |
| In a VP/AVP slot but **not** the senior (second senior) | Own bandwidth | Nobody | None; trusted, no cross-check | none |
| In an **Associate** slot (any title, incl. an AVP like Adit) | Own bandwidth | Nobody | Covered by the senior; mismatch = conflict they're in | "acting as Associate" when title ≠ Associate |
| Leads from the **Director** slot and is an eligible VP/AVP | Own bandwidth | Every associate-slot occupant | Owns all conflicts | none |

Key properties:
- The senior projects for associate-slot occupants **only** — never for the second senior (satisfies goal 3).
- `isVpRun` no longer influences who projects for whom (satisfies goal 2). It survives solely in director sign-off scope, unchanged.
- The senior covers everyone in the associate columns regardless of their title, so an AVP in the associate slot is covered exactly like an associate (satisfies goal 4).

## 6. Senior Determination Algorithm

Given a project and a way to test eligibility/designation of a record id:

```
function determineSenior(project, isEligibleVpAvp):
    for id in project.vpAvpIds (in slot order):
        if isEligibleVpAvp(id): return id
    for id in project.directorIds (in slot order):
        if isEligibleVpAvp(id): return id      # "leads from director slot"
    return null                                 # no senior; associates self-report, director signs off
```

Notes:
- Using "first **eligible** VP/AVP" (not merely "first slot") handles older mandates where a Director sits in a VP/AVP slot: that non-eligible occupant is skipped and the next eligible VP/AVP becomes senior. This is a deliberate refinement of "slot 1 is senior" and is called out for review in §12.
- `project.directorIds` is already `[]` for VP-run mandates (directors stripped upstream), so the director-slot fallback naturally does not fire on VP-run mandates.

## 7. Component Design

### 7.1 New module: `src/lib/project-role.ts` (pure, unit-tested)

```ts
export type MandateRole = 'senior' | 'second_senior' | 'associate';

export interface ResolvedProjectRole {
  role: MandateRole;
  /** Fellow record ids this fellow must project bandwidth for (associate-slot occupants when senior; else []). */
  targetFellowIds: string[];
  /** True when this fellow is the project's senior (projects + owns conflicts). */
  isSenior: boolean;
}

/** Pure. `isEligibleVpAvp` lets the caller inject designation context. */
export function determineSenior(
  project: ProjectAssignment,
  isEligibleVpAvp: (recordId: string) => boolean,
): string | null;

export function resolveProjectRole(
  project: ProjectAssignment,
  fellowRecordId: string,
  isEligibleVpAvp: (recordId: string) => boolean,
): ResolvedProjectRole;
```

`resolveProjectRole` logic:
1. `seniorId = determineSenior(project, isEligibleVpAvp)`.
2. If `fellowRecordId === seniorId` → `{ role: 'senior', isSenior: true, targetFellowIds: project.associateIds }`.
3. Else if `project.vpAvpIds.includes(fellowRecordId)` → `{ role: 'second_senior', isSenior: false, targetFellowIds: [] }`.
4. Else (in an associate slot) → `{ role: 'associate', isSenior: false, targetFellowIds: [] }`.

Note: a non-eligible occupant of the director slot (an actual Director) never reaches this function for their own form — Directors are not eligible fellows and get no token. The director-lead branch in `determineSenior` only promotes an *eligible* VP/AVP who happens to sit in the director slot.

The `isEligibleVpAvp` predicate is built by the caller from the already-fetched eligible-fellows list: `id => eligibleFellowsById.has(id) && isVpOrAvp(fellowById.get(id).designation)`.

### 7.2 `src/lib/airtable/projects.ts`

- `ProjectAssignment` already carries ordered `vpAvpIds`, `associateIds`, `directorIds`. No shape change strictly required; the resolver derives everything from these plus the eligibility predicate.
- `getProjectsForFellow` is unchanged (still returns any project where the fellow appears in any column, incl. the director-slot-lead branch).

### 7.3 `src/app/submit/[token]/page.tsx`

- Replace the `isVpRun`/`isVp`/`isLeadVp` block that computes `targetIds` with a single call to `resolveProjectRole(project, fellowRecordId, isEligibleVpAvp)`.
- Build `isEligibleVpAvp` from the already-fetched `fellows` list.
- Pass each project's `role` (and `isSenior`) to the form so it can render the associate inputs and the role pill.
- The pending-project branch keeps its current behaviour but uses the same "am I senior here" signal instead of the global `isVp` (a manually added project has the creator as senior only if they are an eligible VP/AVP; otherwise self-only — see §12 open question).

### 7.4 `src/app/submit/[token]/form-entries.ts`

- `deriveEntries` stops taking a global `isVp`. Each project already knows whether the viewer is senior there (`project.isSenior` / presence of `associates`), so entries for associates are generated per project when `isSenior` is true. Concretely: replace the `isVp` parameter with reliance on each project's `associates` array being non-empty (which the page only populates for the senior).

### 7.5 `src/app/submit/[token]/form.tsx`

- Render a small role pill per project when the performed role differs from the person's designation (e.g. "acting as Associate"). Generalize the existing "VP-run · Led by X" line to "Led by {seniorName}" for any mandate that has a senior.

### 7.6 `src/app/api/submit/route.ts` (server is the source of truth — do NOT trust the client)

The submit route currently saves whatever `entries` the client posts and gates the VP→associate conflict branch on the global `isVp`. Two problems: (a) a stale/crafted payload from a second senior or associate could post projection rows; (b) moving the gate to "row is a projection" without validation would then turn those bogus rows into conflicts.

Changes:
- **Recompute roles server-side.** For the token's fellow, fetch projects + eligible fellows and run `resolveProjectRole` per project. Build the set of *allowed* projection targets = the union of `targetFellowIds` across projects where the fellow is senior.
- **Validate/drop entries before insert.** Reject or silently drop any non-self-report entry whose `(projectRecordId, targetFellowId)` is not in the allowed set. A self-report entry is always allowed for a project the fellow is on. This makes correctness independent of the form.
- With entries validated, the conflict gate becomes "row is a projection" (`!sub.isSelfReport && sub.targetFellowId`) safely, because only a genuine senior can have produced such a row.
- **Fix the symmetric self-report branch** (the block that, on a self-report, looks up existing projections targeting this fellow): filter those projections to ones authored by the *current* valid senior for that project, so a stale projection from a now-non-senior cannot email the wrong person.
- **Idempotency guard** (pre-existing weakness, hardened here): the `conflicts` table has no unique constraint and two blocks can insert depending on arrival order. Before inserting, check for an existing `source='submission'` conflict for the same `(cycleId, projectRecordId, vpSubmissionId, associateSubmissionId)` and skip if present.

Net effect: all conflicts on a mandate route to the senior (goals 2/3), second seniors never appear in a conflict, and no client payload can subvert it.

### 7.7 `src/app/api/add-project/route.ts` (second submission path — must use the same rule)

Mid-cycle "add a project" also writes submissions **and** creates conflicts at add-time, gated on global `isVp`. Because a pending project has no Airtable columns yet, its "senior" cannot come from placement; the creator defines the team ad hoc. Rule (explicit): **the creator is senior for a pending project iff they are an eligible VP/AVP** — i.e. keep the title-based decision *for pending projects only*, but centralize it through `project-role.ts` (a small `isPendingProjectSenior(designation)` helper) so both this route and the form's `myPendingProjects` branch in `page.tsx` agree. Validate posted teammate ids against the eligible-fellow set before inserting projections. This keeps the pending flow consistent with the real-project flow without inventing placement that doesn't exist.

### 7.8 `src/lib/director-flag.ts` (`computeResolverForFlag`)

Director-flag resolution currently routes by title: a VP/AVP self-resolves; otherwise the first VP/AVP on the project resolves. Under the new model this is wrong for an AVP sitting in an associate slot (e.g. Adit on Pant would self-resolve a flag though he's junior there). Change it to **placement-aware routing via the same `determineSenior`**: the flagged fellow self-resolves only if they are the project's senior; otherwise the project's senior resolves; else the flagged fellow; else admin. `computeResolverForFlag` already receives `projectVpAvpIds` and `allFellows`; pass `directorIds` too so the director-slot-lead fallback matches §6. This keeps "covered like an associate" consistent for flags, not just VP/self bandwidth conflicts.

### 7.9 `src/lib/peer-bandwidth.ts` and `src/lib/email.ts`

- Add the performed-role pill next to a person's name where their mandate role differs from their designation, in the conflict-resolution email and the peer-bandwidth email. Name label still shows the real designation.
- Peer email needs per-project role context: extend `PeerProjectRow` with the viewer-independent performed role of the teammate on that project (computed at assembly time from `allProjects` placement). No stored field needed.

## 8. Data Flow

1. Cycle starts → each eligible fellow gets a token freezing `fellowDesignation` (unchanged).
2. Fellow opens the form → `resolveProjectRole` runs per project using live Airtable placement → the form shows self input always, associate inputs only where the fellow is senior, and a role pill where relevant.
3. Fellow submits → submissions saved; the submit route creates conflicts from senior projections vs associate self-reports; conflict emails go to the senior.
4. Cycle finalizes → snapshots + peer emails; peer email shows the role pill.

## 9. Data Integrity & Migration

**No migration. No historical corruption.** Rationale:

- `submissions` rows store `fellowRecordId`, hours, `isSelfReport`, `targetFellowId` — **no designation and no role**. Changing a person's Airtable title cannot alter any past submission.
- Designation is frozen per cycle on `tokens.fellowDesignation` and again on `snapshots.designation` at finalize. Past cycles keep the title the person held then (Adit stays "Associate N" historically); the next cycle freezes "AVP".
- The change is confined to *derivation logic* (who projects for whom, and display), which is computed live each cycle. Nothing about the stored schema changes.

## 10. Bugs This Fixes

- AVP-in-associate-slot no longer asked to project for other associates (and no longer self-projects).
- Director-led mandates with two seniors no longer double-project associates; only the first senior does.
- Seniority is now resolved consistently across VP-run and director-led mandates.

## 11. Testing Plan (TDD)

Unit tests for `project-role.ts` covering, with fixtures mirroring real records:
- Single senior + associates → senior targets all associates; associates self-only.
- Two seniors → slot-1 senior targets associates only (not slot-2); slot-2 self-only.
- AVP in associate slot (Adit/Pant) → associate role, self-only, covered by senior (senior's targets include Adit).
- AVP as slot-1 senior (Adit/FreshBus) → senior, targets associates.
- No VP/AVP, associate + director (`reclgMJ...`) → no senior; associate self-only; nobody projects.
- Director in VP/AVP slot 1 + eligible AVP in slot 2 → AVP in slot 2 becomes senior (first *eligible*).
- VP/AVP leads from director slot, no VP/AVP occupants → director-slot lead is senior.
- DDE (single VP/AVP) and Pitch (two VP/AVP slots) shapes.

Integration-ish tests:
- Submit route, **both arrival orders**: (a) senior projects first, associate self-reports later; (b) associate self-reports first, senior projects later → exactly one conflict either way, email to senior, idempotency guard prevents duplicates.
- Submit route trust boundary: a payload containing a projection row from a *second senior* or an *associate* is dropped server-side → no submission, no conflict.
- Second senior self-report while a senior projection exists for associate-slot occupants → no conflict involving the second senior.
- `add-project`: creator who is an eligible VP/AVP → teammate projections + conflicts created; creator who is an associate → self-only, no projections; posted teammate ids validated against eligible set.
- `director-flag` `computeResolverForFlag`: AVP flagged while in an associate slot → resolver is the mandate senior, not the AVP; AVP flagged while senior → self-resolves.
- Form-entries: senior sees associate inputs; second senior and associate see self only.

Contract test:
- Assert the rulebook VP/AVP field order for mandate (`VP / AVP 1` before `VP / AVP 2`) and pitch, since senior selection depends on `fetchAllProjects` preserving slot order. Fail loudly if the contract changes.

Regression: existing peer-bandwidth, projects-for-fellow, and signoff-scope tests still pass.

## 12. Decisions & Open Questions

Resolved (incorporated after Codex review):
- **`project-role.ts` is the single source** for senior determination, allowed projection targets, display pills, and server-side entry validation. No caller re-implements the rule.
- **Server is authoritative:** the submit and add-project routes validate posted entries against server-computed roles; the form is a convenience, never a trust boundary.
- **Director-flag routing follows performed role**, not title (§7.8).
- **Pending projects** keep a title-based senior test (creator is senior iff eligible VP/AVP), because a not-yet-in-Airtable project has no columns (§7.7).

Open for reviewer/user confirmation:
1. **"First eligible VP/AVP" vs "literal slot 1":** Spec uses first *eligible* VP/AVP as senior, so a Director wrongly placed in slot 1 is skipped in favour of an eligible AVP in slot 2. Confirm this is preferred over treating a non-eligible slot-1 occupant as senior (which would leave associates uncovered). Recommended: keep "first eligible".
2. **Role pill when title == role:** Show the pill only when performed role differs from designation (less noise), vs always. Recommended: only when different.
3. **Second-senior data hygiene:** if slot 1 holds a non-eligible Director and slot 2 an eligible AVP, the AVP becomes senior (correct), but this only surfaces if such rows are still active. Worth a one-time Airtable sweep, not code.

## 13. Rollout

- Land behind no feature flag (behaviour is strictly more correct); ship via the normal deploy.
- The Monday `start-cycle` cron is currently paused for 2026-07-06 via a dated skip guard. Once this change is merged, deployed, and verified, remove the skip guard (or let it lapse — it only skips that one date) so the next cycle runs with the new logic.
- Because the git→Vercel auto-deploy is currently broken (private-dep install failure), either fix that first or deploy this via `vercel build && vercel deploy --prebuilt --prod` as was done for the pause.
