import { sql, type SQL } from 'drizzle-orm';
import type { ResolvedSubmissionEntry } from '@/lib/submission-validation';

interface DatabaseExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface PersistedSubmission {
  id: string;
  cycleId: string;
  fellowRecordId: string;
  projectRecordId: string;
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  hoursValue: number;
  hoursUnit: 'per_day' | 'per_week';
  hoursPerDay: number;
  hoursPerWeek: number | null;
  isSelfReport: boolean;
  targetFellowId: string | null;
  remarks: string | null;
}

export interface SubmissionUpsertInput extends ResolvedSubmissionEntry {
  cycleId: string;
  fellowRecordId: string;
  remarks: string | null;
}

export interface SubmissionConflictInput {
  cycleId: string;
  projectRecordId: string;
  vpSubmissionId: string;
  associateSubmissionId: string;
  vpHoursPerDay: number;
  associateHoursPerDay: number;
  resolutionToken: string;
}

export interface CreatedSubmissionConflict {
  id: string;
  resolutionToken: string;
}

/**
 * Save one logical submission with the database as the idempotency authority.
 * The two conflict targets deliberately mirror the partial unique indexes in
 * migration 0012.
 */
export async function upsertSubmission(
  db: DatabaseExecutor,
  input: SubmissionUpsertInput,
): Promise<PersistedSubmission> {
  const result = input.isSelfReport
    ? await db.execute(sql<PersistedSubmission>`
      INSERT INTO "submissions" (
        "cycle_id", "fellow_record_id", "project_record_id", "project_name", "project_type",
        "hours_value", "hours_unit", "hours_per_day", "hours_per_week", "is_self_report",
        "target_fellow_id", "remarks"
      ) VALUES (
        ${input.cycleId}, ${input.fellowRecordId}, ${input.projectRecordId}, ${input.projectName}, ${input.projectType},
        ${input.hoursValue}, ${input.hoursUnit}, ${input.hoursPerDay}, ${input.hoursPerWeek}, true,
        NULL, ${input.remarks}
      )
      ON CONFLICT ("cycle_id", "fellow_record_id", "project_record_id")
      WHERE "is_self_report" = true
      DO UPDATE SET
        "project_name" = EXCLUDED."project_name",
        "project_type" = EXCLUDED."project_type",
        "hours_value" = EXCLUDED."hours_value",
        "hours_unit" = EXCLUDED."hours_unit",
        "hours_per_day" = EXCLUDED."hours_per_day",
        "hours_per_week" = EXCLUDED."hours_per_week",
        "remarks" = EXCLUDED."remarks"
      RETURNING
        "id", "cycle_id" AS "cycleId", "fellow_record_id" AS "fellowRecordId",
        "project_record_id" AS "projectRecordId", "project_name" AS "projectName",
        "project_type" AS "projectType", "hours_value" AS "hoursValue", "hours_unit" AS "hoursUnit",
        "hours_per_day" AS "hoursPerDay", "hours_per_week" AS "hoursPerWeek",
        "is_self_report" AS "isSelfReport", "target_fellow_id" AS "targetFellowId", "remarks"
    `)
    : await db.execute(sql<PersistedSubmission>`
      INSERT INTO "submissions" (
        "cycle_id", "fellow_record_id", "project_record_id", "project_name", "project_type",
        "hours_value", "hours_unit", "hours_per_day", "hours_per_week", "is_self_report",
        "target_fellow_id", "remarks"
      ) VALUES (
        ${input.cycleId}, ${input.fellowRecordId}, ${input.projectRecordId}, ${input.projectName}, ${input.projectType},
        ${input.hoursValue}, ${input.hoursUnit}, ${input.hoursPerDay}, ${input.hoursPerWeek}, false,
        ${input.targetFellowId}, NULL
      )
      ON CONFLICT ("cycle_id", "fellow_record_id", "project_record_id", "target_fellow_id")
      WHERE "is_self_report" = false AND "target_fellow_id" IS NOT NULL
      DO UPDATE SET
        "project_name" = EXCLUDED."project_name",
        "project_type" = EXCLUDED."project_type",
        "hours_value" = EXCLUDED."hours_value",
        "hours_unit" = EXCLUDED."hours_unit",
        "hours_per_day" = EXCLUDED."hours_per_day",
        "hours_per_week" = EXCLUDED."hours_per_week"
      RETURNING
        "id", "cycle_id" AS "cycleId", "fellow_record_id" AS "fellowRecordId",
        "project_record_id" AS "projectRecordId", "project_name" AS "projectName",
        "project_type" AS "projectType", "hours_value" AS "hoursValue", "hours_unit" AS "hoursUnit",
        "hours_per_day" AS "hoursPerDay", "hours_per_week" AS "hoursPerWeek",
        "is_self_report" AS "isSelfReport", "target_fellow_id" AS "targetFellowId", "remarks"
    `);

  const row = rowsOf<PersistedSubmission>(result)[0];
  if (!row) throw new Error('Submission upsert did not return a row.');
  return row;
}

/** Returns a row only for the invocation that created the conflict. */
export async function createSubmissionConflict(
  db: DatabaseExecutor,
  input: SubmissionConflictInput,
): Promise<CreatedSubmissionConflict | null> {
  const result = await db.execute(sql<CreatedSubmissionConflict>`
    INSERT INTO "conflicts" (
      "cycle_id", "project_record_id", "vp_submission_id", "associate_submission_id",
      "vp_hours_per_day", "associate_hours_per_day", "difference", "resolution_token", "source"
    ) VALUES (
      ${input.cycleId}, ${input.projectRecordId}, ${input.vpSubmissionId}, ${input.associateSubmissionId},
      ${input.vpHoursPerDay}, ${input.associateHoursPerDay},
      ${Math.abs(input.vpHoursPerDay - input.associateHoursPerDay)}, ${input.resolutionToken}, 'submission'
    )
    ON CONFLICT ("cycle_id", "project_record_id", "vp_submission_id", "associate_submission_id")
    WHERE "source" = 'submission'
      AND "vp_submission_id" IS NOT NULL
      AND "associate_submission_id" IS NOT NULL
    DO NOTHING
    RETURNING "id", "resolution_token" AS "resolutionToken"
  `);

  return rowsOf<CreatedSubmissionConflict>(result)[0] ?? null;
}

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as T[] : [];
}
