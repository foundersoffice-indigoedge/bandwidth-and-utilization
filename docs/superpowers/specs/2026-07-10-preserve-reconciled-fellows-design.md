# Preserve Reconciled Fellows in the Utilization Dashboard

**Date:** 2026-07-10

**Status:** Approved for implementation planning

## Problem

The live-cycle reconciliation added in commit `057dee2` removes self-reported projects when the project is no longer active in Airtable or the fellow is no longer assigned to it. This keeps current utilization totals aligned with the latest staffing state.

The dashboard currently treats an empty reconciled project list as an absent fellow. When every submitted project is excluded, the fellow disappears from the live cycle, the current IY monthly view, the completion summary, and the finalized snapshot.

Kabir Thakwani exposed the failure. He submitted 60 hours per week against Zilo in the cycle that began on 2026-07-06. Zilo later moved to `Mandate on Pause`. Reconciliation correctly removed the 60 hours, then the dashboard removed Kabir's entire row because no projects remained.

## Desired Behavior

A fellow who submitted for the cycle must remain visible after reconciliation, including when every submitted project is excluded.

When all projects are excluded:

- Show the fellow with 0 current hours per week.
- Show 0% utilization and the `Free` load tag.
- Show 0 active mandates, DDEs, and pitches.
- Mark the row as adjusted.
- Explain how many submitted projects were excluded because their Airtable stage or team assignment changed after submission.
- Preserve the adjusted row and explanation after cycle finalization and in historical weekly drill-downs.

Existing dashboard behavior remains unchanged for fellows who haven't submitted and fellows whose submissions all survive reconciliation.

## Chosen Approach

Persist reconciliation metadata in snapshots.

Reconciliation will return the surviving self-reports plus the number of excluded self-reports. Dashboard assembly and cycle finalization will use both values. A submitted fellow with 0 surviving self-reports will produce a 0-hour row instead of being dropped.

Snapshots will gain an `excluded_project_count` integer with a default of `0`. This keeps the adjustment explanation available after the live cycle closes and across future IY navigation. Existing snapshots will read as 0 exclusions.

## Data Flow

### Live cycle

1. Read the fellow's raw self-reports for the active cycle.
2. Reconcile them against current active Airtable projects and current team placement.
3. Return:
   - surviving self-reports;
   - excluded project count;
   - whether the fellow submitted any self-report.
4. Include the fellow when at least 1 raw self-report exists.
5. Calculate utilization from surviving self-reports only.
6. When 0 submissions survive, calculate 0 hours, 0% utilization, and `Free`.
7. Pass `excludedProjectCount` to both the Latest Cycle view and the active-cycle pseudo-snapshot used by the monthly view.

### Finalization

1. Read raw self-reports for each eligible fellow.
2. Skip fellows with 0 raw self-reports, preserving the existing distinction between submitted fellows and people who had no cycle submission.
3. Reconcile the submitted rows.
4. Create a snapshot even when 0 rows survive.
5. Store `excluded_project_count` with the snapshot.
6. Include the fellow in the completion summary with the reconciled 0-hour result.

### Historical dashboard

1. Read `excluded_project_count` from stored snapshots.
2. Keep the fellow in monthly and weekly views because the snapshot exists.
3. Show the adjustment explanation in the weekly drill-down whenever the count is greater than 0.

## Dashboard Presentation

### Latest Cycle table

When `excludedProjectCount > 0`, show a compact `adjusted` badge next to the fellow's name. The badge title will explain that submitted projects were excluded after an Airtable stage or team-assignment change.

The numeric cells continue to show the reconciled result. Kabir's current row will therefore show 0.0 hours per week, 0% utilization, `Free`, and 0 projects.

### Live fellow drill-down

Show an amber informational callout above the project breakdown:

> 1 submitted project was excluded because its Airtable stage or team assignment changed after submission.

Pluralize `project` when the count differs from 1.

### Historical weekly drill-down

Show the same callout beneath the selected week's summary and above its project breakdown. This preserves the reason for a 0-hour snapshot after finalization.

## Schema Change

Add the following column to `snapshots`:

```sql
excluded_project_count integer NOT NULL DEFAULT 0
```

The migration must be applied to the production Neon database before deploying application code that writes the field. The Drizzle schema and migration journal must match the repository's current migration practice.

No existing snapshot values need a custom backfill because the default of 0 represents the behavior before this feature.

## Interfaces

The reconciliation helper will expose both the filtered records and metadata:

```ts
interface LiveReconciliation<T> {
  submissions: T[];
  excludedProjectCount: number;
}
```

`LiveFellowData` and `SnapshotData` will gain:

```ts
excludedProjectCount: number;
```

The existing `filterLiveSelfReports` function may remain as a compatibility wrapper for consumers that only need the surviving rows. New dashboard and finalization code will use the metadata-returning interface.

## Scope

This change covers:

- live dashboard assembly;
- active-cycle monthly pseudo-snapshots;
- finalized snapshot creation;
- completion-summary inclusion;
- Latest Cycle presentation;
- live fellow drill-down;
- historical weekly drill-down;
- schema migration and regression tests.

Peer bandwidth email behavior stays unchanged. Historical utilization calculations remain based on their stored snapshots.

## Testing

Use test-driven development. Each behavioral test must fail for the expected reason before implementation.

Required cases:

1. A submitted fellow with 1 inactive or removed project returns 0 surviving submissions and `excludedProjectCount = 1`.
2. A mixed submission set retains active projects and counts excluded projects correctly.
3. A pending mid-cycle project survives reconciliation and doesn't increment the excluded count.
4. A fellow with 0 raw self-reports remains absent from snapshot creation.
5. A fellow with raw self-reports and 0 surviving rows produces a 0-hour snapshot with the exclusion count.
6. A fellow with surviving rows keeps the existing utilization calculation.
7. Live dashboard serialization carries the exclusion count.
8. Finalized snapshot serialization carries the exclusion count.
9. The adjustment message uses singular and plural wording correctly.
10. Existing reconciliation, peer-email, utilization, and snapshot tests remain green.

Verification will include the focused tests, the full test suite, TypeScript checking, linting, and a production build.

## Deployment

Deployment order:

1. Apply the snapshot migration to production Neon.
2. Deploy the application.
3. Open the production dashboard and verify Kabir appears in the 2026-07-06 cycle with 0 hours, the `adjusted` badge, and the exclusion explanation.
4. Confirm the submission count still treats Kabir as submitted.
5. Confirm fellows with active submissions are unchanged.

The change doesn't alter Airtable records, submissions, tokens, or historical snapshot calculations.
