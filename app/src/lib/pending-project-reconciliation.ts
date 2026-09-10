import { and, eq, or } from 'drizzle-orm';
import { db, getSql } from '@/lib/db';
import { conflicts, pendingProjects, snapshots, submissions } from '@/lib/db/schema';
import { calculateHoursUtilization, getLoadTag } from '@/lib/utilization';
import type { ProjectBreakdownItem } from '@/types';

type SubmissionRow = typeof submissions.$inferSelect;
type ConflictRow = typeof conflicts.$inferSelect;
type SnapshotRow = typeof snapshots.$inferSelect;
type PendingProjectRow = typeof pendingProjects.$inferSelect;

/** PostgreSQL UUID ordering is bytewise, so fingerprints must avoid locale collation. */
function compareStableIds(left: { id: string }, right: { id: string }): number {
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export interface ReconciliationCounts {
  promotedSubmissions: number;
  collapsedDuplicates: number;
  updatedConflicts: number;
  repairedSnapshots: number;
}

export class PendingProjectReconciliationHold extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'PendingProjectReconciliationHold';
  }
}

export function isPendingProjectGuardError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '22012';
}

function nullableEqual<T>(left: T | null, right: T | null): boolean {
  return left === right;
}

export function sameSubmissionIdentity(left: SubmissionRow, right: SubmissionRow): boolean {
  return left.cycleId === right.cycleId
    && left.fellowRecordId === right.fellowRecordId
    && left.isSelfReport === right.isSelfReport
    && nullableEqual(left.targetFellowId, right.targetFellowId);
}

export function isExactSubmissionDuplicate(left: SubmissionRow, right: SubmissionRow): boolean {
  return sameSubmissionIdentity(left, right)
    && left.hoursValue === right.hoursValue
    && left.hoursUnit === right.hoursUnit
    && left.hoursPerDay === right.hoursPerDay
    && nullableEqual(left.hoursPerWeek, right.hoursPerWeek)
    && nullableEqual(left.remarks, right.remarks);
}

export interface ReconciliationPlan {
  collapseSubmissionIds: string[];
  promoteSubmissionIds: string[];
}

/**
 * The exact-match rule deliberately compares reporting mode, target, both
 * normalized hour values and remarks. A same-project row with different
 * bandwidth needs a human decision, never an automated overwrite.
 */
export function planSubmissionReconciliation(
  pendingRows: SubmissionRow[],
  canonicalRows: SubmissionRow[],
): ReconciliationPlan {
  const collapseSubmissionIds: string[] = [];
  const promoteSubmissionIds: string[] = [];

  for (const pending of pendingRows) {
    const sameIdentity = canonicalRows.filter((candidate) => sameSubmissionIdentity(pending, candidate));
    if (sameIdentity.length === 0) {
      promoteSubmissionIds.push(pending.id);
      continue;
    }

    if (sameIdentity.every((candidate) => isExactSubmissionDuplicate(pending, candidate))) {
      collapseSubmissionIds.push(pending.id);
      continue;
    }

    throw new PendingProjectReconciliationHold(
      `Pending submission ${pending.id} has competing canonical bandwidth for the same fellow and cycle. Review the two rows before finishing this project.`,
    );
  }

  return { collapseSubmissionIds, promoteSubmissionIds };
}

export interface SnapshotRepair {
  id: string;
  oldBreakdown: ProjectBreakdownItem[];
  newBreakdown: ProjectBreakdownItem[];
  totalHoursPerWeek: number;
  hoursUtilizationPct: number;
  hoursLoadTag: string;
}

function matchesBreakdownLine(item: ProjectBreakdownItem, submission: SubmissionRow, pendingReference: string): boolean {
  if (item.projectRecordId) return item.projectRecordId === pendingReference;
  return item.projectName === submission.projectName
    && item.projectType === submission.projectType
    && item.hoursPerDay === submission.hoursPerDay
    && item.hoursPerWeek === submission.hoursPerWeek;
}

export function planSnapshotRepairs(
  snapshotRows: SnapshotRow[],
  sourceRows: SubmissionRow[],
  collapseIds: Set<string>,
  canonicalRecordId: string,
  canonicalProjectName: string,
  pendingReference: string,
): SnapshotRepair[] {
  const sourceByCycleAndFellow = new Map<string, SubmissionRow[]>();
  for (const source of sourceRows) {
    // Projected teammate rows retain the reporting senior in fellowRecordId,
    // but they are not lines in that senior's frozen personal snapshot.
    if (!source.isSelfReport) continue;
    const key = `${source.cycleId}:${source.fellowRecordId}`;
    sourceByCycleAndFellow.set(key, [...(sourceByCycleAndFellow.get(key) ?? []), source]);
  }

  const repairs: SnapshotRepair[] = [];
  for (const snapshot of snapshotRows) {
    const sources = sourceByCycleAndFellow.get(`${snapshot.cycleId}:${snapshot.fellowRecordId}`) ?? [];
    if (sources.length === 0) continue;

    const oldBreakdown = snapshot.projectBreakdown;
    const newBreakdown: Array<ProjectBreakdownItem | null> = oldBreakdown.map((item) => ({ ...item }));
    const consumed = new Set<number>();
    let hoursRemoved = 0;

    for (const source of sources) {
      const matching = oldBreakdown
        .map((item, index) => ({ item, index }))
        .filter(({ item, index }) => !consumed.has(index) && matchesBreakdownLine(item, source, pendingReference));
      if (matching.length !== 1) {
        throw new PendingProjectReconciliationHold(
          `Snapshot ${snapshot.id} cannot be reconciled safely for pending submission ${source.id}. Its pending breakdown line is missing or ambiguous.`,
        );
      }
      const index = matching[0].index;
      consumed.add(index);
      if (collapseIds.has(source.id)) {
        newBreakdown[index] = null;
        hoursRemoved += source.hoursPerWeek ?? source.hoursPerDay * 6;
      } else {
        newBreakdown[index] = {
          ...oldBreakdown[index],
          projectRecordId: canonicalRecordId,
          projectName: canonicalProjectName,
        };
      }
    }

    const compacted = newBreakdown.filter((item): item is ProjectBreakdownItem => item !== null);
    const previousTotal = snapshot.totalHoursPerWeek ?? 0;
    const totalHoursPerWeek = previousTotal - hoursRemoved;
    if (totalHoursPerWeek < 0) {
      throw new PendingProjectReconciliationHold(`Snapshot ${snapshot.id} would have a negative total after reconciliation.`);
    }
    const hoursUtilizationPct = calculateHoursUtilization(totalHoursPerWeek);
    const hoursLoadTag = getLoadTag(hoursUtilizationPct);

    const changed = JSON.stringify(oldBreakdown) !== JSON.stringify(compacted)
      || previousTotal !== totalHoursPerWeek
      || snapshot.hoursUtilizationPct !== hoursUtilizationPct
      || snapshot.hoursLoadTag !== hoursLoadTag;
    if (changed) {
      repairs.push({
        id: snapshot.id,
        oldBreakdown,
        newBreakdown: compacted,
        totalHoursPerWeek,
        hoursUtilizationPct,
        hoursLoadTag,
      });
    }
  }
  return repairs;
}

function submissionFingerprint(rows: SubmissionRow[]): string {
  return JSON.stringify(rows
    .map((row) => ({
      id: row.id,
      cycleId: row.cycleId,
      fellowRecordId: row.fellowRecordId,
      projectRecordId: row.projectRecordId,
      projectName: row.projectName,
      projectType: row.projectType,
      hoursValue: row.hoursValue,
      hoursUnit: row.hoursUnit,
      hoursPerDay: row.hoursPerDay,
      hoursPerWeek: row.hoursPerWeek,
      isSelfReport: row.isSelfReport,
      targetFellowId: row.targetFellowId,
      remarks: row.remarks,
    }))
    .sort(compareStableIds));
}

function conflictFingerprint(rows: ConflictRow[]): string {
  return JSON.stringify(rows
    .map((row) => ({
      id: row.id,
      cycleId: row.cycleId,
      projectRecordId: row.projectRecordId,
      vpSubmissionId: row.vpSubmissionId,
      associateSubmissionId: row.associateSubmissionId,
      source: row.source,
    }))
    .sort(compareStableIds));
}

function snapshotFingerprint(rows: SnapshotRow[]): string {
  return JSON.stringify(rows
    .map((row) => ({
      id: row.id,
      cycleId: row.cycleId,
      fellowRecordId: row.fellowRecordId,
      projectBreakdown: row.projectBreakdown,
      totalHoursPerWeek: row.totalHoursPerWeek,
      hoursUtilizationPct: row.hoursUtilizationPct,
      hoursLoadTag: row.hoursLoadTag,
    }))
    .sort(compareStableIds));
}

function assertPendingCanBeCompleted(row: PendingProjectRow): asserts row is PendingProjectRow & { airtableRecordId: string } {
  const historicalCompleted = row.status === 'finished' && row.resolution === 'completed';
  if (row.status !== 'awaiting_setup' && !historicalCompleted) {
    throw new PendingProjectReconciliationHold(`Cannot reconcile a pending project from status=${row.status}.`);
  }
  if (!row.airtableRecordId) {
    throw new PendingProjectReconciliationHold('The pending project has no canonical Airtable record. Re-open it with the canonical project details.');
  }
}

export async function reconcileCompletedPendingProject(row: PendingProjectRow): Promise<ReconciliationCounts> {
  if (row.referencesReconciledAt) {
    return { promotedSubmissions: 0, collapsedDuplicates: 0, updatedConflicts: 0, repairedSnapshots: 0 };
  }
  assertPendingCanBeCompleted(row);
  const expectedStatus = row.status;

  const pendingReference = `pending_${row.id}`;
  // Awaiting rows created before the additive migration can still complete.
  // New callers always provide the actual Airtable name through awaiting-setup.
  const canonicalProjectName = row.airtableProjectName ?? row.name;
  const sourceRows = await db.select().from(submissions).where(eq(submissions.projectRecordId, pendingReference));
  const canonicalRows = await db.select().from(submissions).where(eq(submissions.projectRecordId, row.airtableRecordId));
  const plan = planSubmissionReconciliation(sourceRows, canonicalRows);
  const collapseIds = new Set(plan.collapseSubmissionIds);

  const pendingConflictRows = await db.select().from(conflicts).where(eq(conflicts.projectRecordId, pendingReference));
  const canonicalConflictRows = await db.select().from(conflicts).where(eq(conflicts.projectRecordId, row.airtableRecordId));
  for (const pendingConflict of pendingConflictRows) {
    const collides = canonicalConflictRows.some((candidate) => (
      candidate.cycleId === pendingConflict.cycleId
      && candidate.source === pendingConflict.source
      && candidate.vpSubmissionId === pendingConflict.vpSubmissionId
      && candidate.associateSubmissionId === pendingConflict.associateSubmissionId
    ));
    if (collides) {
      throw new PendingProjectReconciliationHold(
        `Pending conflict ${pendingConflict.id} already has a canonical counterpart. Review it before finishing this project.`,
      );
    }
  }

  const snapshotSourceRows = sourceRows.filter((source) => source.isSelfReport);
  const snapshotRows = snapshotSourceRows.length === 0
    ? []
    : await db.select().from(snapshots).where(or(
      ...snapshotSourceRows.map((source) => and(eq(snapshots.cycleId, source.cycleId), eq(snapshots.fellowRecordId, source.fellowRecordId))),
    ));
  const snapshotRepairs = planSnapshotRepairs(
    snapshotRows,
    sourceRows,
    collapseIds,
    row.airtableRecordId,
    canonicalProjectName,
    pendingReference,
  );

  const sql = getSql();
  const sourceFingerprint = submissionFingerprint(sourceRows);
  const canonicalFingerprint = submissionFingerprint(canonicalRows);
  const pendingConflictFingerprint = conflictFingerprint(pendingConflictRows);
  const canonicalConflictFingerprint = conflictFingerprint(canonicalConflictRows);
  const snapshotStateFingerprint = snapshotFingerprint(snapshotRows);

  try {
    await sql.transaction((tx) => {
      const snapshotGuard = snapshotRows.length > 0
      ? tx`SELECT 1 / CASE WHEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', id, 'cycleId', cycle_id, 'fellowRecordId', fellow_record_id,
            'projectBreakdown', project_breakdown, 'totalHoursPerWeek', total_hours_per_week,
            'hoursUtilizationPct', hours_utilization_pct, 'hoursLoadTag', hours_load_tag
          ) ORDER BY id)
          FROM snapshots WHERE id = ANY(${snapshotRows.map((snapshot) => snapshot.id)}::uuid[])
        ), '[]'::jsonb) = ${snapshotStateFingerprint}::jsonb THEN 1 ELSE 0 END AS snapshot_guard`
      : tx`SELECT 1 AS snapshot_guard`;

      return [
        tx`SELECT pg_advisory_xact_lock(hashtext(${`pending-project:${row.id}`}))`,
    tx`SELECT 1 / CASE WHEN EXISTS (
      SELECT 1 FROM pending_projects
      WHERE id = ${row.id}
        AND status = ${expectedStatus}
        AND (${expectedStatus} <> 'finished' OR resolution = 'completed')
        AND airtable_record_id = ${row.airtableRecordId}
        AND COALESCE(airtable_project_name, name) = ${canonicalProjectName}
        AND references_reconciled_at IS NULL
    ) THEN 1 ELSE 0 END AS pending_guard`,
    tx`SELECT 1 / CASE WHEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'cycleId', cycle_id, 'fellowRecordId', fellow_record_id,
        'projectRecordId', project_record_id, 'projectName', project_name,
        'projectType', project_type, 'hoursValue', hours_value, 'hoursUnit', hours_unit,
        'hoursPerDay', hours_per_day, 'hoursPerWeek', hours_per_week,
        'isSelfReport', is_self_report, 'targetFellowId', target_fellow_id, 'remarks', remarks
      ) ORDER BY id)
      FROM submissions WHERE project_record_id = ${pendingReference}
    ), '[]'::jsonb) = ${sourceFingerprint}::jsonb THEN 1 ELSE 0 END AS source_guard`,
    tx`SELECT 1 / CASE WHEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'cycleId', cycle_id, 'fellowRecordId', fellow_record_id,
        'projectRecordId', project_record_id, 'projectName', project_name,
        'projectType', project_type, 'hoursValue', hours_value, 'hoursUnit', hours_unit,
        'hoursPerDay', hours_per_day, 'hoursPerWeek', hours_per_week,
        'isSelfReport', is_self_report, 'targetFellowId', target_fellow_id, 'remarks', remarks
      ) ORDER BY id)
      FROM submissions WHERE project_record_id = ${row.airtableRecordId}
    ), '[]'::jsonb) = ${canonicalFingerprint}::jsonb THEN 1 ELSE 0 END AS canonical_guard`,
    tx`SELECT 1 / CASE WHEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'cycleId', cycle_id, 'projectRecordId', project_record_id,
        'vpSubmissionId', vp_submission_id, 'associateSubmissionId', associate_submission_id, 'source', source
      ) ORDER BY id)
      FROM conflicts WHERE project_record_id = ${pendingReference}
    ), '[]'::jsonb) = ${pendingConflictFingerprint}::jsonb THEN 1 ELSE 0 END AS pending_conflict_guard`,
    tx`SELECT 1 / CASE WHEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'cycleId', cycle_id, 'projectRecordId', project_record_id,
        'vpSubmissionId', vp_submission_id, 'associateSubmissionId', associate_submission_id, 'source', source
      ) ORDER BY id)
      FROM conflicts WHERE project_record_id = ${row.airtableRecordId}
    ), '[]'::jsonb) = ${canonicalConflictFingerprint}::jsonb THEN 1 ELSE 0 END AS canonical_conflict_guard`,
    snapshotGuard,
    ...plan.collapseSubmissionIds.map((id) => tx`
      DELETE FROM submissions WHERE id = ${id} AND project_record_id = ${pendingReference}
    `),
    ...plan.promoteSubmissionIds.map((id) => tx`
      UPDATE submissions
      SET project_record_id = ${row.airtableRecordId}, project_name = ${canonicalProjectName}
      WHERE id = ${id} AND project_record_id = ${pendingReference}
    `),
    ...pendingConflictRows.map((conflict) => tx`
      UPDATE conflicts
      SET project_record_id = ${row.airtableRecordId}
      WHERE id = ${conflict.id} AND project_record_id = ${pendingReference}
    `),
    ...snapshotRepairs.map((repair) => tx`
      UPDATE snapshots
      SET project_breakdown = ${JSON.stringify(repair.newBreakdown)}::jsonb,
          total_hours_per_week = ${repair.totalHoursPerWeek},
          hours_utilization_pct = ${repair.hoursUtilizationPct},
          hours_load_tag = ${repair.hoursLoadTag}
      WHERE id = ${repair.id}
        AND project_breakdown = ${JSON.stringify(repair.oldBreakdown)}::jsonb
    `),
    tx`
      UPDATE pending_projects
      SET status = 'finished', resolution = 'completed', resolved_at = COALESCE(resolved_at, now()), references_reconciled_at = now()
      WHERE id = ${row.id}
        AND status = ${expectedStatus}
        AND (${expectedStatus} <> 'finished' OR resolution = 'completed')
        AND references_reconciled_at IS NULL
    `,
      ];
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isPendingProjectGuardError(error)) {
      throw new PendingProjectReconciliationHold(
        `Pending project ${row.id} changed during reconciliation. Re-run the review against its latest state.`,
      );
    }
    throw error;
  }

  return {
    promotedSubmissions: plan.promoteSubmissionIds.length,
    collapsedDuplicates: plan.collapseSubmissionIds.length,
    updatedConflicts: pendingConflictRows.length,
    repairedSnapshots: snapshotRepairs.length,
  };
}
