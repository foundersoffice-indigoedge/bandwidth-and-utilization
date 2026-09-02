import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tokens, submissions, conflicts, pendingProjects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { isConflict } from '@/lib/conflicts';
import { sendConflictEmail } from '@/lib/email';
import { postRemark } from '@/lib/slack';
import { fetchEligibleFellows, isVpOrAvp } from '@/lib/airtable/fellows';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { checkAndFinalizeCycle } from '@/lib/cycle';
import { createSignoffIfReady } from '@/lib/signoff';
import { getPerformedRoleLabel, resolveProjectRole } from '@/lib/project-role';
import {
  validateAndResolveSubmissionEntries,
  type ResolvedSubmissionEntry,
} from '@/lib/submission-validation';
import {
  createSubmissionConflict,
  upsertSubmission,
  type PersistedSubmission,
} from '@/lib/submission-persistence';
import type { ProjectAssignment } from '@/types';

interface SubmissionPayload {
  token?: unknown;
  entries?: unknown;
  remarks?: unknown;
}

interface SavedEntry {
  submission: PersistedSubmission;
  source: ResolvedSubmissionEntry;
}

interface EligibleFellow {
  recordId: string;
  name: string;
  email: string;
  designation: string;
}

export async function POST(req: NextRequest) {
  let payload: SubmissionPayload;
  try {
    payload = await req.json() as SubmissionPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid submission payload.' }, { status: 400 });
  }

  if (typeof payload.token !== 'string' || payload.token.length === 0) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  const [tokenRecord] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token, payload.token))
    .limit(1);
  if (!tokenRecord || tokenRecord.status !== 'pending') {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  let allProjects: ProjectAssignment[];
  let eligibleFellows: EligibleFellow[];
  let cyclePending: Array<typeof pendingProjects.$inferSelect>;
  try {
    [allProjects, eligibleFellows, cyclePending] = await Promise.all([
      fetchAllProjects(),
      fetchEligibleFellows(),
      db.select().from(pendingProjects).where(eq(pendingProjects.cycleId, tokenRecord.cycleId)),
    ]);
  } catch (error) {
    console.error('Unable to load submission context', error);
    return NextResponse.json({ error: 'Unable to validate this submission. Please try again.' }, { status: 500 });
  }

  const eligibleById = new Map(eligibleFellows.map(fellow => [fellow.recordId, fellow]));
  const isEligibleVpAvp = (fellowRecordId: string) => {
    const fellow = eligibleById.get(fellowRecordId);
    return !!fellow && isVpOrAvp(fellow.designation);
  };
  const validation = validateAndResolveSubmissionEntries(payload.entries, {
    token: {
      cycleId: tokenRecord.cycleId,
      fellowRecordId: tokenRecord.fellowRecordId,
      fellowDesignation: tokenRecord.fellowDesignation,
    },
    allProjects,
    pendingProjects: cyclePending,
    isEligibleVpAvp,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const remarksText = typeof payload.remarks === 'string' ? payload.remarks.trim() || null : null;
  const projectMap = new Map(allProjects.map(project => [project.projectRecordId, project]));
  const savedEntries: SavedEntry[] = [];

  // Every validated row is durable before the token can be consumed. The upsert
  // constraints make a retry safe if a later write fails.
  try {
    for (const entry of validation.entries) {
      const submission = await upsertSubmission(db, {
        ...entry,
        cycleId: tokenRecord.cycleId,
        fellowRecordId: tokenRecord.fellowRecordId,
        remarks: entry.isSelfReport ? remarksText : null,
      });
      savedEntries.push({ submission, source: entry });
    }
  } catch (error) {
    console.error('Unable to persist submission entries', error);
    return NextResponse.json({ error: 'We could not save every project entry. Please try again.' }, { status: 500 });
  }

  try {
    for (const saved of savedEntries) {
      await reconcileSubmissionConflict({
        saved,
        tokenRecord,
        eligibleById,
        isEligibleVpAvp,
        projectMap,
      });
    }
  } catch (error) {
    // Entries are already safe. Keep the token pending so this pass can retry
    // without creating duplicate conflict records or email.
    console.error('Unable to reconcile submission conflicts', error);
    return NextResponse.json({ error: 'Your entries were saved, but could not be finalized. Please try again.' }, { status: 500 });
  }

  try {
    await db
      .update(tokens)
      .set({ status: 'submitted' as const, submittedAt: new Date(), statusUpdatedAt: new Date() })
      .where(eq(tokens.id, tokenRecord.id));
  } catch (error) {
    console.error('Unable to finalize submitted token', error);
    return NextResponse.json({ error: 'Your entries were saved, but could not be finalized. Please try again.' }, { status: 500 });
  }

  // These follow-on actions do not alter whether the form was saved. Record a
  // failure without presenting a completed submission as an unsuccessful form.
  try {
    if (remarksText) await postRemark(tokenRecord.fellowName, remarksText);

    const uniqueProjectIds = new Set(savedEntries.map(entry => entry.submission.projectRecordId));
    for (const projectId of uniqueProjectIds) {
      const project = projectMap.get(projectId);
      if (!project) continue;
      for (const directorId of project.directorIds) {
        await createSignoffIfReady(tokenRecord.cycleId, directorId);
      }
    }
    await checkAndFinalizeCycle(tokenRecord.cycleId);
  } catch (error) {
    console.error('Submission follow-on processing failed', error);
  }

  return NextResponse.json({ ok: true });
}

async function reconcileSubmissionConflict({
  saved,
  tokenRecord,
  eligibleById,
  isEligibleVpAvp,
  projectMap,
}: {
  saved: SavedEntry;
  tokenRecord: typeof tokens.$inferSelect;
  eligibleById: Map<string, EligibleFellow>;
  isEligibleVpAvp: (fellowRecordId: string) => boolean;
  projectMap: Map<string, ProjectAssignment>;
}) {
  const { submission, source } = saved;

  if (!submission.isSelfReport && submission.targetFellowId) {
    if (submission.fellowRecordId !== source.seniorFellowId) return;
    const [associateSubmission] = await db
      .select()
      .from(submissions)
      .where(and(
        eq(submissions.cycleId, tokenRecord.cycleId),
        eq(submissions.projectRecordId, submission.projectRecordId),
        eq(submissions.fellowRecordId, submission.targetFellowId),
        eq(submissions.isSelfReport, true),
      ))
      .limit(1);
    if (!associateSubmission || !isConflict(submission.hoursPerDay, associateSubmission.hoursPerDay)) return;

    const created = await createSubmissionConflict(db, {
      cycleId: tokenRecord.cycleId,
      projectRecordId: submission.projectRecordId,
      vpSubmissionId: submission.id,
      associateSubmissionId: associateSubmission.id,
      vpHoursPerDay: submission.hoursPerDay,
      associateHoursPerDay: associateSubmission.hoursPerDay,
      resolutionToken: crypto.randomUUID(),
    });
    if (!created) return;

    const associate = eligibleById.get(submission.targetFellowId);
    if (!associate) return;
    const project = projectMap.get(submission.projectRecordId);
    const targetRole = project
      ? resolveProjectRole(project, submission.targetFellowId, isEligibleVpAvp).role
      : null;
    const associateRoleLabel = targetRole
      ? getPerformedRoleLabel(targetRole, isVpOrAvp(associate.designation)) ?? undefined
      : isVpOrAvp(associate.designation) ? 'Performing Associate role' : undefined;
    const emailId = await sendConflictEmail(
      tokenRecord.fellowName,
      tokenRecord.fellowEmail,
      associate.name,
      associate.email,
      submission.projectName,
      submission.hoursPerDay,
      associateSubmission.hoursPerDay,
      created.resolutionToken,
      associateRoleLabel,
    );
    if (emailId) {
      await db.update(conflicts)
        .set({ emailMessageId: emailId, emailSentAt: new Date() })
        .where(eq(conflicts.id, created.id));
    }
    return;
  }

  if (!submission.isSelfReport || !source.seniorFellowId) return;
  const projections = await db
    .select()
    .from(submissions)
    .where(and(
      eq(submissions.cycleId, tokenRecord.cycleId),
      eq(submissions.projectRecordId, submission.projectRecordId),
      eq(submissions.targetFellowId, submission.fellowRecordId),
      eq(submissions.isSelfReport, false),
    ));
  const projection = projections.find(row => row.fellowRecordId === source.seniorFellowId);
  if (!projection || !isConflict(projection.hoursPerDay, submission.hoursPerDay)) return;

  const created = await createSubmissionConflict(db, {
    cycleId: tokenRecord.cycleId,
    projectRecordId: submission.projectRecordId,
    vpSubmissionId: projection.id,
    associateSubmissionId: submission.id,
    vpHoursPerDay: projection.hoursPerDay,
    associateHoursPerDay: submission.hoursPerDay,
    resolutionToken: crypto.randomUUID(),
  });
  if (!created) return;

  const senior = eligibleById.get(projection.fellowRecordId);
  if (!senior) return;
  const project = projectMap.get(submission.projectRecordId);
  const selfRole = project
    ? resolveProjectRole(project, submission.fellowRecordId, isEligibleVpAvp).role
    : null;
  const selfRoleLabel = selfRole
    ? getPerformedRoleLabel(selfRole, isVpOrAvp(tokenRecord.fellowDesignation)) ?? undefined
    : isVpOrAvp(tokenRecord.fellowDesignation) ? 'Performing Associate role' : undefined;
  const emailId = await sendConflictEmail(
    senior.name,
    senior.email,
    tokenRecord.fellowName,
    tokenRecord.fellowEmail,
    submission.projectName,
    projection.hoursPerDay,
    submission.hoursPerDay,
    created.resolutionToken,
    selfRoleLabel,
  );
  if (emailId) {
    await db.update(conflicts)
      .set({ emailMessageId: emailId, emailSentAt: new Date() })
      .where(eq(conflicts.id, created.id));
  }
}
