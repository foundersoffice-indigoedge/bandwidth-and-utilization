import { and, eq, gt } from 'drizzle-orm';
import { db, getSql } from '../src/lib/db/index';
import { snapshots, submissions } from '../src/lib/db/schema';
import { rebuildHistoricalSnapshot } from '../src/lib/historical-snapshot-repair';

const APPLY = process.argv.includes('--apply');
const REASON = '2026-09-10-preserve-submitted-work';

const affected = await db.select().from(snapshots).where(gt(snapshots.excludedProjectCount, 0));
const plans = [];

for (const snapshot of affected) {
  const sourceRows = await db.select({
    projectRecordId: submissions.projectRecordId,
    projectName: submissions.projectName,
    projectType: submissions.projectType,
    hoursPerDay: submissions.hoursPerDay,
    hoursPerWeek: submissions.hoursPerWeek,
  }).from(submissions).where(and(
    eq(submissions.cycleId, snapshot.cycleId),
    eq(submissions.fellowRecordId, snapshot.fellowRecordId),
    eq(submissions.isSelfReport, true),
  ));
  const rebuilt = rebuildHistoricalSnapshot(sourceRows, snapshot.projectBreakdown);
  plans.push({ snapshot, rebuilt });
}

if (APPLY) {
  const sql = getSql();
  for (const { snapshot, rebuilt } of plans) {
    await sql.transaction(tx => [
      tx`SELECT pg_advisory_xact_lock(hashtext(${`snapshot:${snapshot.id}`}))`,
      tx`SELECT 1 / CASE WHEN EXISTS (
        SELECT 1 FROM snapshots
        WHERE id = ${snapshot.id}
          AND project_breakdown = ${JSON.stringify(snapshot.projectBreakdown)}::jsonb
          AND total_hours_per_week IS NOT DISTINCT FROM ${snapshot.totalHoursPerWeek}
          AND hours_utilization_pct IS NOT DISTINCT FROM ${snapshot.hoursUtilizationPct}
          AND hours_load_tag IS NOT DISTINCT FROM ${snapshot.hoursLoadTag}
          AND excluded_project_count = ${snapshot.excludedProjectCount}
      ) THEN 1 ELSE 0 END AS snapshot_guard`,
      tx`INSERT INTO snapshot_revisions (
        snapshot_id, reason, old_project_breakdown, old_total_hours_per_week,
        old_hours_utilization_pct, old_hours_load_tag, old_excluded_project_count,
        new_project_breakdown, new_total_hours_per_week, new_hours_utilization_pct,
        new_hours_load_tag
      ) VALUES (
        ${snapshot.id}, ${REASON}, ${JSON.stringify(snapshot.projectBreakdown)}::jsonb,
        ${snapshot.totalHoursPerWeek}, ${snapshot.hoursUtilizationPct}, ${snapshot.hoursLoadTag},
        ${snapshot.excludedProjectCount}, ${JSON.stringify(rebuilt.projectBreakdown)}::jsonb,
        ${rebuilt.totalHoursPerWeek}, ${rebuilt.hoursUtilizationPct}, ${rebuilt.hoursLoadTag}
      ) ON CONFLICT (snapshot_id, reason) DO NOTHING`,
      tx`UPDATE snapshots SET
        project_breakdown = ${JSON.stringify(rebuilt.projectBreakdown)}::jsonb,
        total_hours_per_week = ${rebuilt.totalHoursPerWeek},
        hours_utilization_pct = ${rebuilt.hoursUtilizationPct},
        hours_load_tag = ${rebuilt.hoursLoadTag},
        excluded_project_count = 0
      WHERE id = ${snapshot.id}
        AND project_breakdown = ${JSON.stringify(snapshot.projectBreakdown)}::jsonb
        AND excluded_project_count = ${snapshot.excludedProjectCount}`,
    ], { isolationLevel: 'Serializable' });
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'applied' : 'dry-run',
  reports: plans.length,
  excludedEntries: plans.reduce((sum, plan) => sum + plan.snapshot.excludedProjectCount, 0),
  oldHours: plans.reduce((sum, plan) => sum + (plan.snapshot.totalHoursPerWeek ?? 0), 0),
  rebuiltHours: plans.reduce((sum, plan) => sum + plan.rebuilt.totalHoursPerWeek, 0),
  changes: plans.map(({ snapshot, rebuilt }) => ({
    snapshotId: snapshot.id,
    cycleId: snapshot.cycleId,
    fellowRecordId: snapshot.fellowRecordId,
    fellowName: snapshot.fellowName,
    excludedEntries: snapshot.excludedProjectCount,
    oldHours: snapshot.totalHoursPerWeek,
    rebuiltHours: rebuilt.totalHoursPerWeek,
    oldProjects: snapshot.projectBreakdown.length,
    rebuiltProjects: rebuilt.projectBreakdown.length,
  })),
}, null, 2));
