import { db } from './db/index';
import { directorSignoffs, tokens as tokensTable, submissions as submissionsTable, conflicts as conflictsTable, cycles } from './db/schema';
import { eq, and } from 'drizzle-orm';
import { fetchAllProjects } from './airtable/projects';
import { fetchEligibleFellows } from './airtable/fellows';
import { sendDirectorSignoffEmail, sendDirectorFlagResolutionEmail } from './email';
import { computeResolverForFlag, dedupeRecipients } from './director-flag';
import { postDirectorFlagToSlack } from './slack';
import { formatDateRange } from './schedule';
import { randomUUID } from 'crypto';
import type { ProjectAssignment, SignoffProjectGroup } from '@/types';

export interface SliceInput {
  directorFellowId: string;
  projects: ProjectAssignment[];
  tokens: Array<{ projectRecordId: string; fellowRecordId: string; status: string }>;
  submissions: Array<{ id: string; projectRecordId: string; fellowRecordId: string }>;
  conflicts: Array<{ projectRecordId: string; status: string; source: string }>;
}

/**
 * Determine whether a director's slice is complete.
 * Complete = every project where the director is in directorIds has had all team members submit
 * (no pending tokens) AND has no pending submission-level conflicts. Projects with zero
 * submissions are excluded from the check.
 */
export function getDirectorSliceStatus(input: SliceInput): 'complete' | 'incomplete' {
  const { directorFellowId, projects, tokens, submissions, conflicts } = input;

  // Director's projects only
  const directorProjects = projects.filter(p => p.directorIds.includes(directorFellowId));

  // Build per-project submission count
  const submissionsByProject = new Map<string, number>();
  for (const s of submissions) {
    submissionsByProject.set(s.projectRecordId, (submissionsByProject.get(s.projectRecordId) || 0) + 1);
  }

  // Exclude projects with zero team members AND zero submissions (truly empty — no one to sign off on)
  const inScope = directorProjects.filter(p => {
    const hasTeam = p.vpAvpIds.length > 0 || p.associateIds.length > 0;
    const hasSubmissions = (submissionsByProject.get(p.projectRecordId) || 0) > 0;
    return hasTeam || hasSubmissions;
  });

  for (const project of inScope) {
    const teamIds = new Set([...project.vpAvpIds, ...project.associateIds]);

    // Pending tokens for anyone on this project's team
    const hasPendingToken = tokens.some(
      t => t.projectRecordId === project.projectRecordId
           && teamIds.has(t.fellowRecordId)
           && t.status === 'pending'
    );
    if (hasPendingToken) return 'incomplete';

    // Pending submission-level conflicts on this project
    const hasPendingConflict = conflicts.some(
      c => c.projectRecordId === project.projectRecordId
           && c.status === 'pending'
           && c.source === 'submission'
    );
    if (hasPendingConflict) return 'incomplete';
  }

  return 'complete';
}

// ---------------------------------------------------------------------------
// buildSignoffGroups — exported for reuse by the signoff page (Batch 6)
// ---------------------------------------------------------------------------

type SubmissionRow = typeof submissionsTable.$inferSelect;
type FellowRow = { recordId: string; name: string; designation: string; email: string };

/**
 * Group submissions by project for a director's slice. Exported so the signoff
 * page server component can reuse the same grouping logic without re-implementing it.
 */
export function buildSignoffGroups(
  directorFellowId: string,
  projects: ProjectAssignment[],
  submissions: SubmissionRow[],
  fellows: FellowRow[]
): SignoffProjectGroup[] {
  const directorProjects = projects.filter(p => p.directorIds.includes(directorFellowId));
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  const groups: SignoffProjectGroup[] = [];
  for (const p of directorProjects) {
    const projectSubmissions = submissions.filter(s => s.projectRecordId === p.projectRecordId);
    if (projectSubmissions.length === 0) continue;

    // Dedupe by (projectRecordId, fellowRecordId): prefer self-report, fallback to first encountered.
    const byFellow = new Map<string, SubmissionRow>();
    for (const s of projectSubmissions) {
      const existing = byFellow.get(s.fellowRecordId);
      if (!existing) {
        byFellow.set(s.fellowRecordId, s);
      } else if (s.isSelfReport && !existing.isSelfReport) {
        byFellow.set(s.fellowRecordId, s);
      }
      // else: keep existing (first-encountered wins among ties)
    }

    const lines = Array.from(byFellow.values()).map(s => {
      const f = fellowMap.get(s.fellowRecordId);
      return {
        submissionId: s.id,
        fellowName: f?.name ?? 'Unknown',
        designation: f?.designation ?? 'Unknown',
        hoursPerDay: s.hoursPerDay,
        hoursPerWeek: s.hoursPerWeek ?? s.hoursPerDay * 6,
      };
    });

    groups.push({
      projectRecordId: p.projectRecordId,
      projectName: p.projectName,
      projectType: p.projectType,
      lines,
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// createSignoffIfReady
// ---------------------------------------------------------------------------

/**
 * If the given director's slice is now complete and no signoff row exists yet,
 * inserts a directorSignoffs row (status=email_sent), sends the sign-off email,
 * and stores the Resend message id. No-op otherwise. Idempotent via the
 * (cycleId, directorFellowId) unique constraint — a concurrent insert results
 * in a unique-violation which is caught and returned as { created: false, reason: 'race lost' }.
 */
export async function createSignoffIfReady(
  cycleId: string,
  directorFellowId: string
): Promise<{ created: boolean; reason?: string }> {
  // Bail early if signoff already exists
  const existing = await db
    .select({ id: directorSignoffs.id })
    .from(directorSignoffs)
    .where(and(eq(directorSignoffs.cycleId, cycleId), eq(directorSignoffs.directorFellowId, directorFellowId)))
    .limit(1);
  if (existing.length > 0) return { created: false, reason: 'already exists' };

  // Gather data in parallel
  const [projects, allTokens, allSubmissions, allConflicts] = await Promise.all([
    fetchAllProjects(),
    db.select().from(tokensTable).where(eq(tokensTable.cycleId, cycleId)),
    db.select().from(submissionsTable).where(eq(submissionsTable.cycleId, cycleId)),
    db.select().from(conflictsTable).where(eq(conflictsTable.cycleId, cycleId)),
  ]);

  // Tokens don't carry projectRecordId directly — expand each token to one entry
  // per project that fellow is on, so the slice check can match by (projectRecordId, fellowRecordId).
  const expandedTokens: Array<{ projectRecordId: string; fellowRecordId: string; status: string }> = [];
  for (const t of allTokens) {
    for (const p of projects) {
      if (p.vpAvpIds.includes(t.fellowRecordId) || p.associateIds.includes(t.fellowRecordId)) {
        expandedTokens.push({ projectRecordId: p.projectRecordId, fellowRecordId: t.fellowRecordId, status: t.status });
      }
    }
  }

  const sliceStatus = getDirectorSliceStatus({
    directorFellowId,
    projects,
    tokens: expandedTokens,
    submissions: allSubmissions.map(s => ({ id: s.id, projectRecordId: s.projectRecordId, fellowRecordId: s.fellowRecordId })),
    conflicts: allConflicts.map(c => ({ projectRecordId: c.projectRecordId, status: c.status, source: c.source ?? 'submission' })),
  });

  if (sliceStatus !== 'complete') return { created: false, reason: 'incomplete' };

  // Fetch director profile and cycle
  const [fellows, cycleRows] = await Promise.all([
    fetchEligibleFellows(),
    db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1),
  ]);

  const director = fellows.find(f => f.recordId === directorFellowId);
  if (!director) return { created: false, reason: 'director not found' };

  const cycle = cycleRows[0];
  if (!cycle) return { created: false, reason: 'cycle not found' };

  // Build email groups — if empty, there's nothing to sign off on
  const groups = buildSignoffGroups(directorFellowId, projects, allSubmissions, fellows);
  if (groups.length === 0) return { created: false, reason: 'no projects to sign off on' };

  const signoffToken = randomUUID();

  try {
    await db.insert(directorSignoffs).values({
      cycleId,
      directorFellowId,
      directorEmail: director.email,
      directorName: director.name,
      status: 'email_sent',
      signoffToken,
    });
  } catch (err: unknown) {
    // Unique-constraint violation (PG error code 23505) means a concurrent caller
    // already inserted this row. No-op gracefully.
    const pg = err as { code?: string };
    if (pg?.code === '23505') return { created: false, reason: 'race lost' };
    throw err;
  }

  const messageId = await sendDirectorSignoffEmail({
    directorName: director.name,
    directorEmail: director.email,
    cycleStartDate: cycle.startDate,
    signoffToken,
    groups,
  });

  if (messageId) {
    await db
      .update(directorSignoffs)
      .set({ emailMessageId: messageId, updatedAt: new Date() })
      .where(and(eq(directorSignoffs.cycleId, cycleId), eq(directorSignoffs.directorFellowId, directorFellowId)));
  }

  return { created: true };
}

// ---------------------------------------------------------------------------
// submitFlags — Task 11
// ---------------------------------------------------------------------------

export interface FlagInput {
  submissionId: string;
  proposedHoursPerDay?: number;
  comment?: string;
}

export interface SubmitFlagsResult {
  conflictIds: string[];
  flagsProcessed: number;
}

/**
 * Transactionally: flip the signoff to 'flagged', insert one director_flag conflicts
 * row per flag, then post to Slack and send resolution emails (post-commit side effects).
 */
export async function submitFlags(params: {
  signoffToken: string;
  flags: FlagInput[];
}): Promise<SubmitFlagsResult> {
  const { signoffToken, flags } = params;

  if (flags.length === 0) throw new Error('At least one flag required');

  // Validate each flag has a proposed value (required); comment is optional
  for (const f of flags) {
    const hasValue =
      typeof f.proposedHoursPerDay === 'number' &&
      !Number.isNaN(f.proposedHoursPerDay) &&
      f.proposedHoursPerDay > 0;
    if (!hasValue) {
      throw new Error(`Flag for submission ${f.submissionId} must include a proposed value (positive number)`);
    }
  }

  // Validate no duplicate submissionIds
  const seenIds = new Set<string>();
  for (const f of flags) {
    if (seenIds.has(f.submissionId)) throw new Error(`Duplicate flag for submission ${f.submissionId}`);
    seenIds.add(f.submissionId);
  }

  // Resolve the signoff
  const signoffRows = await db
    .select()
    .from(directorSignoffs)
    .where(eq(directorSignoffs.signoffToken, signoffToken))
    .limit(1);
  const signoff = signoffRows[0];
  if (!signoff) throw new Error('Invalid signoff token');
  if (signoff.status !== 'email_sent') throw new Error(`Signoff is in state '${signoff.status}', not flaggable`);

  // Load data needed for validation and resolver derivation
  const [projects, fellows] = await Promise.all([fetchAllProjects(), fetchEligibleFellows()]);
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));

  // Validate each flag's submission and enrich with project/fellow data
  const enriched = await Promise.all(
    flags.map(async (f) => {
      const subRows = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, f.submissionId))
        .limit(1);
      const sub = subRows[0];
      if (!sub) throw new Error(`Submission ${f.submissionId} not found`);
      if (sub.cycleId !== signoff.cycleId) throw new Error(`Submission ${f.submissionId} belongs to a different cycle`);

      const project = projects.find(p => p.projectRecordId === sub.projectRecordId);
      if (!project) throw new Error(`Project ${sub.projectRecordId} not found in active projects`);
      if (!project.directorIds.includes(signoff.directorFellowId)) {
        throw new Error(`Submission ${f.submissionId} is not in this director's slice`);
      }

      const flaggedFellow = fellowMap.get(sub.fellowRecordId);
      if (!flaggedFellow) throw new Error(`Fellow ${sub.fellowRecordId} not found`);

      return { input: f, submission: sub, project, flaggedFellow };
    })
  );

  // Compute resolver for each flag
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@indigoedge.com';
  const withResolvers = enriched.map(item => {
    const resolver = computeResolverForFlag({
      flaggedFellow: {
        recordId: item.flaggedFellow.recordId,
        designation: item.flaggedFellow.designation,
        email: item.flaggedFellow.email,
        name: item.flaggedFellow.name,
      },
      projectVpAvpIds: item.project.vpAvpIds,
      allFellows: fellows.map(f => ({ recordId: f.recordId, designation: f.designation, email: f.email, name: f.name })),
      adminEmail,
    });
    return { ...item, resolver };
  });

  // DB transaction: update signoff + insert all conflict rows
  const insertedRows: Array<{ id: string; resolutionToken: string | null }> = [];

  await db.transaction(async (tx) => {
    // Flip signoff to flagged
    await tx
      .update(directorSignoffs)
      .set({ status: 'flagged', flaggedAt: new Date(), updatedAt: new Date() })
      .where(eq(directorSignoffs.id, signoff.id));

    // Insert one conflict row per flag
    for (const item of withResolvers) {
      const [row] = await tx
        .insert(conflictsTable)
        .values({
          cycleId: signoff.cycleId,
          projectRecordId: item.submission.projectRecordId,
          // submission-source columns: null for director_flag rows
          vpSubmissionId: null,
          associateSubmissionId: null,
          vpHoursPerDay: null,
          associateHoursPerDay: null,
          difference: null,
          status: 'pending',
          resolutionToken: randomUUID(),
          // director-flag fields
          source: 'director_flag',
          flaggedSubmissionId: item.submission.id,
          flaggedByFellowId: signoff.directorFellowId,
          flaggedOriginalHoursPerDay: item.submission.hoursPerDay,
          proposedHoursPerDay: item.input.proposedHoursPerDay ?? null,
          directorComment: item.input.comment ?? null,
          signoffId: signoff.id,
          resolverFellowId: item.resolver.resolverFellowId,
          resolverEmail: item.resolver.resolverEmail,
        })
        .returning({ id: conflictsTable.id, resolutionToken: conflictsTable.resolutionToken });
      insertedRows.push(row);
    }
  });

  const conflictIds = insertedRows.map(r => r.id);

  // Post-commit side effects: Slack post + resolution emails

  // Fetch cycle for date range
  const cycleRows = await db.select().from(cycles).where(eq(cycles.id, signoff.cycleId)).limit(1);
  const cycle = cycleRows[0];
  const cycleDateRange = cycle ? formatDateRange(cycle.startDate) : '';

  // Slack — one post for the whole flag submission
  await postDirectorFlagToSlack({
    directorName: signoff.directorName,
    cycleDateRange,
    flags: withResolvers.map(e => ({
      projectName: e.project.projectName,
      projectType: e.project.projectType,
      fellowName: e.flaggedFellow.name,
      fellowDesignation: e.flaggedFellow.designation,
      reportedHoursPerDay: e.submission.hoursPerDay,
      proposedHoursPerDay: e.input.proposedHoursPerDay ?? null,
      directorComment: e.input.comment ?? null,
      resolverName: e.resolver.resolverName ?? 'Admin',
    })),
  });

  // One resolution email per flag
  const ccBase: string[] = [signoff.directorEmail, process.env.ADMIN_EMAIL, process.env.CC_EMAIL].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );

  for (let i = 0; i < withResolvers.length; i++) {
    const item = withResolvers[i];
    const insertedRow = insertedRows[i];
    if (!insertedRow?.resolutionToken) continue;

    // CC = base CC + flagged fellow's email if different from resolver
    const cc: string[] = [...ccBase];
    if (item.resolver.resolverEmail.toLowerCase() !== item.flaggedFellow.email.toLowerCase()) {
      cc.push(item.flaggedFellow.email);
    }
    const { to, cc: dedupedCc } = dedupeRecipients({ to: item.resolver.resolverEmail, cc });

    const messageId = await sendDirectorFlagResolutionEmail({
      resolverName: item.resolver.resolverName ?? 'Admin',
      resolverEmail: to,
      ccEmails: dedupedCc,
      directorName: signoff.directorName,
      fellowName: item.flaggedFellow.name,
      fellowDesignation: item.flaggedFellow.designation,
      projectName: item.project.projectName,
      projectType: item.project.projectType,
      originalHoursPerDay: item.submission.hoursPerDay,
      proposedHoursPerDay: item.input.proposedHoursPerDay ?? null,
      directorComment: item.input.comment ?? null,
      resolutionToken: insertedRow.resolutionToken,
    });

    if (messageId) {
      await db
        .update(conflictsTable)
        .set({ emailMessageId: messageId })
        .where(eq(conflictsTable.id, insertedRow.id));
    }
  }

  return { conflictIds, flagsProcessed: withResolvers.length };
}

// ---------------------------------------------------------------------------
// transitionToFlaggedResolved + confirmSignoff — Task 12
// ---------------------------------------------------------------------------

/**
 * After a director_flag conflict resolves, check whether any pending child conflicts
 * remain under the parent signoff. If none remain, flip the signoff to flagged_resolved.
 * Returns true if the transition happened.
 */
export async function transitionToFlaggedResolved(signoffId: string): Promise<boolean> {
  const pending = await db
    .select({ id: conflictsTable.id })
    .from(conflictsTable)
    .where(and(eq(conflictsTable.signoffId, signoffId), eq(conflictsTable.status, 'pending')))
    .limit(1);

  if (pending.length > 0) return false;

  const updated = await db
    .update(directorSignoffs)
    .set({ status: 'flagged_resolved', resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(directorSignoffs.id, signoffId), eq(directorSignoffs.status, 'flagged')))
    .returning({ id: directorSignoffs.id });

  return updated.length > 0;
}

/**
 * Flip a signoff from email_sent → confirmed (one-way, idempotent via status guard).
 * Returns { confirmed: true } if the transition happened, { confirmed: false } if the
 * signoff was not found or was already in a different state.
 */
export async function confirmSignoff(signoffToken: string): Promise<{ confirmed: boolean }> {
  const updated = await db
    .update(directorSignoffs)
    .set({ status: 'confirmed', confirmedAt: new Date(), confirmedBy: 'director', updatedAt: new Date() })
    .where(and(eq(directorSignoffs.signoffToken, signoffToken), eq(directorSignoffs.status, 'email_sent')))
    .returning({ id: directorSignoffs.id });

  return { confirmed: updated.length > 0 };
}
