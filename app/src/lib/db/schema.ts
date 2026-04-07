import { pgTable, uuid, text, date, timestamp, real, integer, boolean, jsonb } from 'drizzle-orm/pg-core';
import type { ProjectBreakdownItem } from '@/types';

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
  projectBreakdown: jsonb('project_breakdown').$type<ProjectBreakdownItem[]>().notNull(),
  snapshotDate: date('snapshot_date').notNull(),
});
