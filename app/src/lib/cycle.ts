import { db } from '@/lib/db';
import { cycles, tokens, submissions, conflicts, snapshots, directorSignoffs } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { fetchEligibleFellows, fetchDirectors } from '@/lib/airtable/fellows';
import { fetchAllProjects, getProjectsForFellow } from '@/lib/airtable/projects';
import { sendCollectionEmail, sendCompletionEmail, sendPeerBandwidthEmails, type FellowSummary } from '@/lib/email';
import { getLoadTag, calculateHoursUtilization } from '@/lib/utilization';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import type { ProjectType, ProjectBreakdownItem } from '@/types';
export { isCycleMonday } from '@/lib/schedule';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function startCycle(testFellowIds?: string[]): Promise<string> {
  const today = new Date();
  const startDate = today.toISOString().split('T')[0];

  const [cycle] = await db
    .insert(cycles)
    .values({ startDate })
    .returning();

  let fellows = await fetchEligibleFellows();
  if (testFellowIds && testFellowIds.length > 0) {
    fellows = fellows.filter(f => testFellowIds.includes(f.recordId));
  }
  const allProjects = await fetchAllProjects();

  for (const fellow of fellows) {
    const fellowProjects = getProjectsForFellow(allProjects, fellow.recordId, fellow.designation);
    if (fellowProjects.length === 0) continue;

    const tokenValue = crypto.randomUUID();

    await db.insert(tokens).values({
      cycleId: cycle.id,
      fellowRecordId: fellow.recordId,
      fellowName: fellow.name,
      fellowEmail: fellow.email,
      fellowDesignation: fellow.designation,
      token: tokenValue,
    });

    await sendCollectionEmail(fellow, fellowProjects, tokenValue, startDate);
    await sleep(500);
  }

  return cycle.id;
}

export async function getActiveCycle() {
  const [cycle] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'collecting'))
    .orderBy(desc(cycles.createdAt))
    .limit(1);
  return cycle || null;
}

export async function checkAndFinalizeCycle(cycleId: string): Promise<void> {
  const pendingTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.cycleId, cycleId), eq(tokens.status, 'pending')));

  if (pendingTokens.length > 0) return;

  const pendingConflicts = await db
    .select()
    .from(conflicts)
    .where(and(eq(conflicts.cycleId, cycleId), eq(conflicts.status, 'pending')));

  if (pendingConflicts.length > 0) return;

  // Third gate: every current Director who has ≥1 in-scope project this cycle must
  // have a director_signoffs row in a terminal state (confirmed or flagged_resolved).
  // A project is "in scope" if it has ≥1 team member (matches getDirectorSliceStatus).
  // Resolve via fetchDirectors so the gate ignores both ex-directors and VPs that
  // happen to appear in an Airtable project's director field — neither category
  // produces a sign-off, so neither should block finalization.
  const [allProjects, currentDirectors] = await Promise.all([
    fetchAllProjects(),
    fetchDirectors(),
  ]);
  const currentDirectorIds = new Set(currentDirectors.map(f => f.recordId));
  const expectedDirectorIds = new Set<string>();
  for (const p of allProjects) {
    if (p.vpAvpIds.length + p.associateIds.length === 0) continue;
    for (const dirId of p.directorIds) {
      if (currentDirectorIds.has(dirId)) expectedDirectorIds.add(dirId);
    }
  }

  const cycleSignoffs = await db
    .select()
    .from(directorSignoffs)
    .where(eq(directorSignoffs.cycleId, cycleId));

  const terminal = new Set(['confirmed', 'flagged_resolved']);
  const signoffByDirector = new Map(cycleSignoffs.map(s => [s.directorFellowId, s.status]));

  for (const dirId of expectedDirectorIds) {
    const s = signoffByDirector.get(dirId);
    if (!s || !terminal.has(s)) return;
  }

  await finalizeCycle(cycleId);
}

export async function finalizeStaleCycles(): Promise<string[]> {
  const staleCycles = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'collecting'));

  const finalizedIds: string[] = [];
  for (const cycle of staleCycles) {
    // Step 1: Auto-resolve dangling submission-source conflicts (VP-as-truth).
    const pendingConflicts = await db
      .select()
      .from(conflicts)
      .where(and(eq(conflicts.cycleId, cycle.id), eq(conflicts.status, 'pending')));

    for (const conflict of pendingConflicts) {
      if (conflict.source === 'director_flag') continue; // handled below
      await db
        .update(conflicts)
        .set({
          status: 'resolved' as const,
          resolvedHoursPerDay: conflict.vpHoursPerDay,
          resolvedBy: 'system-auto-close',
        })
        .where(eq(conflicts.id, conflict.id));
    }

    // Step 2: Auto-confirm open director signoffs so finalizeCycle's third gate passes.
    const cycleSignoffs = await db
      .select()
      .from(directorSignoffs)
      .where(eq(directorSignoffs.cycleId, cycle.id));

    for (const signoff of cycleSignoffs) {
      if (signoff.status === 'email_sent') {
        await db
          .update(directorSignoffs)
          .set({
            status: 'confirmed' as const,
            confirmedAt: new Date(),
            confirmedBy: 'system_stale_close',
            updatedAt: new Date(),
          })
          .where(eq(directorSignoffs.id, signoff.id));
      } else if (signoff.status === 'flagged') {
        // Director flagged but their child director_flag conflicts are still pending.
        // Resolve those conflicts with keep-original semantics, then close the signoff.
        const directorFlagConflicts = await db
          .select()
          .from(conflicts)
          .where(
            and(
              eq(conflicts.cycleId, cycle.id),
              eq(conflicts.source, 'director_flag'),
              eq(conflicts.status, 'pending'),
              eq(conflicts.signoffId, signoff.id),
            )
          );

        for (const c of directorFlagConflicts) {
          await db
            .update(conflicts)
            .set({
              status: 'resolved' as const,
              resolvedHoursPerDay: c.flaggedOriginalHoursPerDay ?? c.vpHoursPerDay,
              resolvedBy: 'system_stale_close_keep_original',
            })
            .where(eq(conflicts.id, c.id));
        }

        await db
          .update(directorSignoffs)
          .set({
            status: 'flagged_resolved' as const,
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(directorSignoffs.id, signoff.id));
      }
    }

    await finalizeCycle(cycle.id);
    finalizedIds.push(cycle.id);
  }

  return finalizedIds;
}

async function finalizeCycle(cycleId: string): Promise<void> {
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1);
  if (!cycle || cycle.status === 'complete') return;

  const allSubmissions = await db
    .select()
    .from(submissions)
    .where(eq(submissions.cycleId, cycleId));

  const fellows = await fetchEligibleFellows();
  const allProjects = await fetchAllProjects();
  const projectMap = new Map(allProjects.map(p => [p.projectRecordId, p]));

  // Create snapshots per fellow and collect summaries for email
  const dateStr = cycle.startDate;
  const fellowSummaries: FellowSummary[] = [];

  for (const fellow of fellows) {
    const fellowSubs = allSubmissions.filter(
      s => s.fellowRecordId === fellow.recordId && s.isSelfReport
    );
    if (fellowSubs.length === 0) continue;

    const totalHpw = fellowSubs.reduce((sum, s) => sum + (s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK), 0);
    const hoursUtilPct = calculateHoursUtilization(totalHpw);
    const hoursTag = getLoadTag(hoursUtilPct);

    const breakdown: ProjectBreakdownItem[] = fellowSubs.map(s => {
      const proj = projectMap.get(s.projectRecordId);
      return {
        projectName: s.projectName,
        projectType: s.projectType as ProjectType,
        hoursPerDay: s.hoursPerDay,
        hoursPerWeek: s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK,
        isVpRun: proj?.isVpRun,
        leadFellowName: proj?.leadFellowName,
      };
    });

    await db.insert(snapshots).values({
      cycleId,
      fellowRecordId: fellow.recordId,
      fellowName: fellow.name,
      designation: fellow.designation,
      projectBreakdown: breakdown,
      snapshotDate: dateStr,
      totalHoursPerWeek: totalHpw,
      hoursUtilizationPct: hoursUtilPct,
      hoursLoadTag: hoursTag,
    });

    fellowSummaries.push({
      name: fellow.name,
      designation: fellow.designation,
      utilizationPct: hoursUtilPct,
      loadTag: hoursTag,
      projectCount: fellowSubs.length,
      totalHoursPerWeek: totalHpw,
    });
  }

  // Mark cycle complete (atomically set peerEmailsSent to false initially; updated below on success)
  await db.update(cycles).set({ status: 'complete' as const, peerEmailsSent: false }).where(eq(cycles.id, cycleId));

  // Send completion email
  const conflictCount = (
    await db
      .select()
      .from(conflicts)
      .where(and(eq(conflicts.cycleId, cycleId), eq(conflicts.status, 'resolved')))
  ).length;

  await sendCompletionEmail(
    cycle.startDate,
    allSubmissions.filter(s => s.isSelfReport).length,
    conflictCount,
    fellowSummaries
  );

  // Peer bandwidth-visibility emails (gated by env flag)
  const enabledFrom = process.env.PEER_EMAIL_ENABLED_FROM;
  if (enabledFrom && cycle.startDate >= enabledFrom && !cycle.peerEmailsSent) {
    try {
      await sendPeerBandwidthEmails(allSubmissions, fellows, allProjects, cycle.startDate);
      await db.update(cycles).set({ peerEmailsSent: true }).where(eq(cycles.id, cycleId));
    } catch (e) {
      console.error('peer bandwidth emails failed', e);
    }
  }
}
