import { pgTable, uuid, text, date, timestamp, real, integer, boolean, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { ProjectBreakdownItem } from '@/types';

export const cycles = pgTable('cycles', {
  id: uuid('id').defaultRandom().primaryKey(),
  startDate: date('start_date').notNull(),
  status: text('status', { enum: ['collecting', 'complete'] }).notNull().default('collecting'),
  // Limited-scope `?fellows=` runs are safe email tests, never production compliance evidence.
  isTest: boolean('is_test').notNull().default(false),
  peerEmailsSent: boolean('peer_emails_sent').notNull().default(false),
  complianceReportClaimedAt: timestamp('compliance_report_claimed_at'),
  complianceReportSentAt: timestamp('compliance_report_sent_at'),
  complianceReportMessageId: text('compliance_report_message_id'),
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
  // Preserves whether a manual exemption was active at the compliance deadline.
  notNeededAt: timestamp('not_needed_at'),
  statusUpdatedAt: timestamp('status_updated_at').defaultNow().notNull(),
});

/** Immutable outcome of a required form at the Monday 13:00 IST deadline. */
export const submissionDeadlineChecks = pgTable('submission_deadline_checks', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokenId: uuid('token_id').references(() => tokens.id).notNull(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  cycleStartDate: date('cycle_start_date').notNull(),
  fellowRecordId: text('fellow_record_id').notNull(),
  fellowName: text('fellow_name').notNull(),
  fellowDesignation: text('fellow_designation').notNull(),
  outcome: text('outcome', { enum: ['on_time', 'missed'] }).notNull(),
  deadlineAt: timestamp('deadline_at').notNull(),
  submittedAt: timestamp('submitted_at'),
  checkedAt: timestamp('checked_at').defaultNow().notNull(),
}, table => [
  uniqueIndex('submission_deadline_checks_token_id_unique').on(table.tokenId),
  index('submission_deadline_checks_fellow_date_idx').on(table.fellowRecordId, table.cycleStartDate),
]);

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
  autoScore: integer('auto_score'),
  isSelfReport: boolean('is_self_report').notNull(),
  targetFellowId: text('target_fellow_id'),
  remarks: text('remarks'),
  hoursPerWeek: real('hours_per_week'),
  remarksClaimedAt: timestamp('remarks_claimed_at'),
  remarksProcessedAt: timestamp('remarks_processed_at'),
});

export const directorSignoffs = pgTable('director_signoffs', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  directorFellowId: text('director_fellow_id').notNull(),
  directorEmail: text('director_email').notNull(),
  directorName: text('director_name').notNull(),
  status: text('status', { enum: ['email_sent', 'confirmed', 'flagged', 'flagged_resolved'] }).notNull(),
  signoffToken: text('signoff_token').unique().notNull(),
  emailMessageId: text('email_message_id'),
  lastReminderSentAt: timestamp('last_reminder_sent_at'),
  confirmedAt: timestamp('confirmed_at'),
  confirmedBy: text('confirmed_by'),
  flaggedAt: timestamp('flagged_at'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const conflicts = pgTable('conflicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  projectRecordId: text('project_record_id').notNull(),
  vpSubmissionId: uuid('vp_submission_id').references(() => submissions.id),
  associateSubmissionId: uuid('associate_submission_id').references(() => submissions.id),
  vpHoursPerDay: real('vp_hours_per_day'),
  associateHoursPerDay: real('associate_hours_per_day'),
  difference: real('difference'),
  status: text('status', { enum: ['pending', 'resolved'] }).notNull().default('pending'),
  resolvedHoursPerDay: real('resolved_hours_per_day'),
  resolvedBy: text('resolved_by'),
  resolutionToken: text('resolution_token'),
  emailMessageId: text('email_message_id'),
  // Successful original-email timestamp. Kept separately from reminder history so
  // reminder eligibility can enforce a full first-day grace period.
  emailSentAt: timestamp('email_sent_at'),
  lastReminderSentAt: timestamp('last_reminder_sent_at'),
  // Director sign-off extensions
  source: text('source', { enum: ['submission', 'director_flag'] }).notNull().default('submission'),
  flaggedSubmissionId: uuid('flagged_submission_id').references(() => submissions.id),
  flaggedByFellowId: text('flagged_by_fellow_id'),
  flaggedOriginalHoursPerDay: real('flagged_original_hours_per_day'),
  proposedHoursPerDay: real('proposed_hours_per_day'),
  directorComment: text('director_comment'),
  signoffId: uuid('signoff_id').references(() => directorSignoffs.id),
  resolverFellowId: text('resolver_fellow_id'),
  resolverEmail: text('resolver_email'),
});

export const snapshots = pgTable('snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id').references(() => cycles.id).notNull(),
  fellowRecordId: text('fellow_record_id').notNull(),
  fellowName: text('fellow_name').notNull(),
  designation: text('designation').notNull(),
  projectBreakdown: jsonb('project_breakdown').$type<ProjectBreakdownItem[]>().notNull(),
  snapshotDate: date('snapshot_date').notNull(),
  totalHoursPerWeek: real('total_hours_per_week'),
  hoursUtilizationPct: real('hours_utilization_pct'),
  hoursLoadTag: text('hours_load_tag'),
  excludedProjectCount: integer('excluded_project_count').notNull().default(0),
});

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
  status: text('status', { enum: ['pending', 'awaiting_setup', 'finished', 'confirming'] }).notNull().default('pending'),
  airtableRecordId: text('airtable_record_id'),
  resolution: text('resolution', { enum: ['completed', 'rejected'] }),
  resolvedAt: timestamp('resolved_at'),
});

export const conflictRemindersSent = pgTable('conflict_reminders_sent', {
  id: uuid('id').defaultRandom().primaryKey(),
  conflictId: uuid('conflict_id').references(() => conflicts.id).notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  resendMessageId: text('resend_message_id'),
});
