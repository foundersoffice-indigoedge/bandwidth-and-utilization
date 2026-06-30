# Handoff: Collect DDE bandwidth from a VP/AVP sitting in the Director slot

**Date:** 2026-06-02
**Status:** Proposed, not started
**Origin:** Surfaced while reviewing a re-flag loop in the ie-checkin (Project Tracking System) project. The fix belongs here, in Utilization MIS.

> This is an issue brief written by an agent in a different project. It has no special authority over how you solve the problem. Treat the suggested approach as a starting point. Investigate, confirm the root cause yourself, and pick the cleanest fix for this codebase. File and line references were accurate on 2026-06-02 but may have drifted, so verify before editing.

---

## TL;DR

A VP or AVP who *leads* a DDE sits in the **DDE Director** column of that DDE, not the VP/AVP column. The bandwidth form only collects from the VP/AVP and Associate columns, so that person never gets asked for bandwidth on the DDE they lead. It never appears on their form. They keep re-flagging it as a "missing project" every cycle, and the downstream automation keeps re-adding them to the VP/AVP column, so they end up listed as both Director and VP on the same DDE.

The fix: when the person in the DDE Director column is actually a VP or AVP (not a true Director), collect their bandwidth on that DDE too, treating them as a VP/AVP for that project.

---

## The problem, concretely

Real case from the last cycle. Vishnu (designation: VP) leads the Shrinithi Capital DDE. Because he leads it, he is in the **DDE Director** column, with the VP/AVP column empty (or holding someone else).

What happened:

1. The bandwidth form built Vishnu's project list and did not include Shrinithi Capital, because the list only matches the VP/AVP and Associate columns. Being in the Director column does not count.
2. Vishnu, correctly believing he is working on it, used "add a project not listed" to flag it.
3. That flag flowed to the ie-checkin project, got fuzzy-matched back to the existing Shrinithi Capital DDE record, and the auto-team step wrote Vishnu into the DDE VP/AVP column.
4. Result: Vishnu is now in **both** the DDE Director and DDE VP/AVP columns of the same record. And nothing actually fixed the original gap, so the loop can repeat.

This is not a Shrinithi-specific bug. It hits any DDE where a VP or AVP is the lead and therefore sits in the Director slot. (Note: a separate Zype case in the same batch was a different root cause, a paused DDE, and is being handled in the ie-checkin project. Do not conflate the two.)

---

## Root cause

The bandwidth form's per-fellow project list ignores the Director column entirely.

- **`app/src/lib/airtable/projects.ts`**, `getProjectsForFellow(projects, fellowRecordId)` (around lines 92-99). It filters to projects where the fellow is in `vpAvpIds` or `associateIds`. It does **not** check `directorIds`:

  ```ts
  return projects.filter(
    p => p.vpAvpIds.includes(fellowRecordId) || p.associateIds.includes(fellowRecordId)
  );
  ```

- The director IDs are already available. The same file extracts them (`extractDirectorIds`, around lines 14-19) and stores them on each `ProjectAssignment` as `directorIds` (around line 68). They are captured and then never used for the form list. So no new Airtable read is needed, just a filter change.

- **`app/src/lib/airtable/config.ts`** already captures the DDE Director field. The DDE config block has `directorFields: ['DDE Director']` (around line 41) alongside `vpAvpFields` and `associateFields`.

- **Why true Directors are excluded today:** `app/src/lib/airtable/fellows.ts`, `fetchEligibleFellows()` only returns fellows whose `Designation of Fellow` is one of `['VP', 'AVP', 'Associate 3', 'Associate 2', 'Associate 1']`. Real Directors (designation contains "Director") are never eligible for a bandwidth token at all. That is correct and should stay. The gap is narrower: a person who *is* an eligible VP/AVP but happens to occupy a DDE Director slot.

- **Recipient gating:** `app/src/lib/cycle.ts`, `startCycle()` (around lines 14-49) loops over eligible fellows and calls `getProjectsForFellow(allProjects, fellow.recordId)` (around line 29-31). A fellow only gets a token if that returns at least one project. Because tokens flow through the same function, fixing `getProjectsForFellow` fixes both the form contents and recipient selection in one place. No separate recipient change needed.

---

## Suggested fix

Make `getProjectsForFellow` include a project when the fellow is in `directorIds` **and** the fellow's own designation is `VP` or `AVP`. True Directors stay excluded (they are not eligible fellows, so they never reach this path anyway, but the designation check is the explicit guard).

The function currently takes only `(projects, fellowRecordId)`. It needs the fellow's designation. `startCycle()` already holds the full `fellow` object (with `.designation`) at the call site, so the cleanest plumbing is to pass the designation in.

Rough shape (adapt to the codebase, this is illustrative, not prescriptive):

```ts
export function getProjectsForFellow(
  projects: ProjectAssignment[],
  fellowRecordId: string,
  fellowDesignation: string,
): ProjectAssignment[] {
  const isVpOrAvp = fellowDesignation === 'VP' || fellowDesignation === 'AVP';
  return projects.filter(p =>
    p.vpAvpIds.includes(fellowRecordId) ||
    p.associateIds.includes(fellowRecordId) ||
    (isVpOrAvp && p.directorIds.includes(fellowRecordId))
  );
}
```

There may already be an `isVpOrAvp` style helper in `fellows.ts`. Reuse it if so.

### Important nuance: treat them as a VP/AVP for that project

Including the project is only half the job. The form decides how a person reports (just their own hours, versus also projecting hours for associates) based on whether they are a VP/AVP or an associate on that project. A director-slot VP/AVP should be treated as a **VP/AVP** for that DDE, so the existing VP projection and VP-vs-associate conflict logic works unchanged.

The simplest way is usually to normalize the assignment for that fellow's view: when a project is included because the fellow is a VP/AVP in the Director slot, fold their ID into the effective `vpAvpIds` for that assignment so every downstream check (`vpAvpIds.includes(fellowId)`) just works. Confirm how the form (`app/src/app/submit/[token]/...`) and any VP/Associate cross-reference logic key off these arrays before deciding the exact mechanism.

---

## Edge cases and open questions (for you to decide)

1. **Both Director and VP on the same DDE.** Existing records (like Shrinithi) already have the lead listed in both columns from the old loop. Decide whether to dedupe the form view so the same person is not asked twice for the same DDE. A `Set` of project record IDs per fellow before building the form usually handles this.
2. **DDE Director holds a real Director AND the VP/AVP column holds a VP.** Normal case. The Director (not eligible) is skipped, the VP is collected as today. Unchanged. Make sure the new branch does not accidentally pull in the real Director.
3. **Mandates and Pitches.** This brief is scoped to DDEs, because that is where the lead-sits-in-director-slot pattern showed up. Check whether Mandates or Pitches have the same shape (a VP/AVP occupying a director-type column). If not, keep the change DDE-only. If yes, the same logic generalizes, but treat that as a separate decision.
4. **Designation source of truth.** `Designation of Fellow` is read from the Fellows List table. Confirm the eligible `fellow.designation` value carried through `startCycle()` matches what `getProjectsForFellow` needs to test.
5. **Data cleanup.** Reactivating collection does not retro-fix records already polluted with double assignments. A one-time cleanup of DDEs where the same person is in both Director and VP/AVP may be worth a quick script or manual pass.

---

## Out of scope here (being handled in the ie-checkin project)

You do **not** need to touch these. They live in the ie-checkin (Project Tracking System) codebase and are being fixed there:

- **Auto-team recurrence guard:** stopping the flag-handling automation from writing a person into the DDE VP/AVP column when they are already in the DDE Director column. That is what created the double assignment. It is an ie-checkin change.
- **Paused DDE reactivation and the fuzzy-match candidate rules** (the separate Zype case). Also ie-checkin.

The combined effect: ie-checkin stops re-adding the lead as VP, and this Utilization MIS change makes the DDE show up on the lead's bandwidth form in the first place, so the re-flagging stops at the source.

---

## Acceptance criteria

- A VP or AVP who is in the DDE Director column (and not in the VP/AVP column) of an active DDE sees that DDE on their bandwidth form and can report hours on it.
- They are treated as a VP/AVP for that DDE (correct reporting mode and conflict handling), not as an associate.
- A real Director (designation contains "Director") still gets no bandwidth token and no DDE rows. Unchanged.
- A person is never asked to report twice for the same DDE, even if they appear in both the Director and VP/AVP columns.
- Recipient/token selection still works: a fellow whose only qualifying project is a director-slot DDE now correctly receives a token.

---

## Pointers (verify line numbers before editing)

| What | File | Around |
|------|------|--------|
| Per-fellow project filter (main change) | `app/src/lib/airtable/projects.ts` | `getProjectsForFellow`, L92-99 |
| Director IDs already extracted and stored | `app/src/lib/airtable/projects.ts` | `extractDirectorIds` L14-19, assignment L68 |
| DDE field config incl. `directorFields` | `app/src/lib/airtable/config.ts` | DDE block, L36-48 |
| Eligible fellows + designation source | `app/src/lib/airtable/fellows.ts` | `fetchEligibleFellows` L7-20 |
| Cycle start / token + recipient gating | `app/src/lib/cycle.ts` | `startCycle` L14-49, call site L29-31 |
| Form reporting-mode logic | `app/src/app/submit/[token]/` | form component |
