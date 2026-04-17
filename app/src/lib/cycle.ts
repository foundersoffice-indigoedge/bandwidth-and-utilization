import { db } from '@/lib/db';
import { cycles, tokens, submissions, conflicts, snapshots } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';
import { fetchAllProjects, getProjectsForFellow } from '@/lib/airtable/projects';
import { sendCollectionEmail, sendCompletionEmail, type FellowSummary } from '@/lib/email';
import { generateNarrative, writeBandwidthToAirtable } from '@/lib/airtable/writeback';
import { sumMeu, calculateUtilization, getLoadTag, calculateHoursUtilization } from '@/lib/utilization';
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
    const fellowProjects = getProjectsForFellow(allProjects, fellow.recordId);
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

  await finalizeCycle(cycleId);
}

async function finalizeCycle(cycleId: string): Promise<void> {
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1);
  if (!cycle || cycle.status === 'complete') return;

  const allSubmissions = await db
    .select()
    .from(submissions)
    .where(eq(submissions.cycleId, cycleId));

  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));
  const allProjects = await fetchAllProjects();
  const projectMap = new Map(allProjects.map(p => [p.projectRecordId, p]));
  const failures: Array<{ projectName: string; error: string }> = [];

  // Group self-report submissions by project for Airtable write-back
  const projectSubmissions = new Map<string, typeof allSubmissions>();
  for (const sub of allSubmissions) {
    if (!sub.isSelfReport) continue;
    const existing = projectSubmissions.get(sub.projectRecordId) || [];
    existing.push(sub);
    projectSubmissions.set(sub.projectRecordId, existing);
  }

  // Write narratives to Airtable
  let projectCount = 0;
  for (const [projectRecordId, subs] of projectSubmissions) {
    const firstSub = subs[0];
    const projectData = projectMap.get(projectRecordId);
    const entries = subs.map(s => ({
      fellowName: fellowMap.get(s.fellowRecordId)?.name || s.fellowRecordId,
      score: s.autoScore,
      hoursPerDay: s.hoursPerDay,
      stage: projectData?.stage || '',
    }));

    const narrative = generateNarrative(
      firstSub.projectName,
      firstSub.projectType as ProjectType,
      cycle.startDate,
      entries
    );

    try {
      await writeBandwidthToAirtable(
        projectRecordId,
        firstSub.projectType as ProjectType,
        narrative
      );
      projectCount++;
    } catch (err) {
      failures.push({ projectName: firstSub.projectName, error: String(err) });
    }
  }

  // Create snapshots per fellow and collect summaries for email
  const dateStr = cycle.startDate;
  const fellowSummaries: FellowSummary[] = [];

  for (const fellow of fellows) {
    const fellowSubs = allSubmissions.filter(
      s => s.fellowRecordId === fellow.recordId && s.isSelfReport
    );
    if (fellowSubs.length === 0) continue;

    const meuValues = fellowSubs.map(s => s.autoMeu);
    const totalMeu = sumMeu(meuValues);
    const utilPct = calculateUtilization(totalMeu, fellow.capacityMeu);
    const loadTag = getLoadTag(utilPct);

    // Hours-based utilization (new method)
    const totalHpw = fellowSubs.reduce((sum, s) => sum + (s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK), 0);
    const hoursUtilPct = calculateHoursUtilization(totalHpw);
    const hoursTag = getLoadTag(hoursUtilPct);

    const breakdown: ProjectBreakdownItem[] = fellowSubs.map(s => ({
      projectName: s.projectName,
      projectType: s.projectType as ProjectType,
      score: s.autoScore,
      meu: s.autoMeu,
      hoursPerDay: s.hoursPerDay,
      hoursPerWeek: s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK,
    }));

    await db.insert(snapshots).values({
      cycleId,
      fellowRecordId: fellow.recordId,
      fellowName: fellow.name,
      designation: fellow.designation,
      capacityMeu: fellow.capacityMeu,
      totalMeu,
      utilizationPct: utilPct,
      loadTag,
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

  // Mark cycle complete
  await db.update(cycles).set({ status: 'complete' as const }).where(eq(cycles.id, cycleId));

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
    projectCount,
    failures,
    fellowSummaries
  );
}
