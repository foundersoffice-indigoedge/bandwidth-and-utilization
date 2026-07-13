import { db } from '@/lib/db';
import { cycles, tokens, submissions, conflicts, snapshots, directorSignoffs } from '@/lib/db/schema';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { DashboardView } from './DashboardView';
import { INVESTMENT_YEAR_START_MONTH } from '@/lib/utilization';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import type { ProjectBreakdownItem, ProjectType } from '@/types';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { fetchDirectors } from '@/lib/airtable/fellows';
import { buildLiveDashboardFellow } from '@/lib/live-dashboard-fellow';
import { getAvailableInvestmentYears } from '@/lib/dashboard-investment-years';

export const dynamic = 'force-dynamic';

function getIyRange(iy: number): { start: string; end: string } {
  return {
    start: `${iy - 1}-07-01`,
    end: `${iy}-06-30`,
  };
}

export interface SnapshotData {
  id: string;
  cycleId: string;
  fellowRecordId: string;
  fellowName: string;
  designation: string;
  projectBreakdown: ProjectBreakdownItem[];
  snapshotDate: string;
  totalHoursPerWeek: number | null;
  hoursUtilizationPct: number | null;
  hoursLoadTag: string | null;
  excludedProjectCount: number;
}

export interface LiveFellowData {
  fellowRecordId: string;
  fellowName: string;
  designation: string;
  totalHoursPerWeek: number;
  hoursUtilizationPct: number;
  loadTag: string;
  projectBreakdown: ProjectBreakdownItem[];
  hasConflict: boolean;
  remarks: string | null;
  excludedProjectCount: number;
}

type LiveFellowResult = LiveFellowData | null;

export interface SignoffPanelRow {
  directorName: string;
  projectCount: number;
  status: string;
}

export interface LiveCycleData {
  cycleId: string;
  startDate: string;
  status: 'collecting' | 'complete';
  submittedFellows: LiveFellowData[];
  pendingFellows: { name: string; designation: string }[];
  pendingConflicts: number;
  signoffPanelRows: SignoffPanelRow[];
}

type DirectorSignoffRow = typeof directorSignoffs.$inferSelect;
type DirectorRecord = { recordId: string; name: string };
type ProjectRow = import('@/types').ProjectAssignment;

function buildSignoffPanelRows(
  allProjects: ProjectRow[],
  cycleSignoffs: DirectorSignoffRow[],
  directors: DirectorRecord[],
): SignoffPanelRow[] {
  // Team-based scope: only projects with at least one VP/AVP or associate assigned
  const directorScope = new Map<string, number>();
  for (const p of allProjects) {
    if (p.vpAvpIds.length + p.associateIds.length === 0) continue;
    for (const dirId of p.directorIds) {
      directorScope.set(dirId, (directorScope.get(dirId) ?? 0) + 1);
    }
  }

  if (directorScope.size === 0) return [];

  const signoffByDirector = new Map(cycleSignoffs.map(s => [s.directorFellowId, s]));
  const directorNameMap = new Map(directors.map(d => [d.recordId, d.name]));

  return [...directorScope.entries()].map(([directorId, projectCount]) => {
    const signoff = signoffByDirector.get(directorId);
    return {
      directorName: directorNameMap.get(directorId) ?? 'Unknown',
      projectCount,
      status: signoff?.status ?? 'awaiting_slice',
    };
  });
}

async function getLatestFinalizedCycleData(): Promise<LiveCycleData | null> {
  const [latest] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'complete'))
    .orderBy(desc(cycles.startDate))
    .limit(1);
  if (!latest) return null;

  const [cycleSnaps, cycleSubs, cycleSignoffs, allProjects, directors] = await Promise.all([
    db.select().from(snapshots).where(eq(snapshots.cycleId, latest.id)),
    db.select().from(submissions).where(
      and(eq(submissions.cycleId, latest.id), eq(submissions.isSelfReport, true))
    ),
    db.select().from(directorSignoffs).where(eq(directorSignoffs.cycleId, latest.id)),
    fetchAllProjects(),
    fetchDirectors(),
  ]);
  if (cycleSnaps.length === 0) return null;

  const remarksByFellow = new Map<string, string>();
  for (const sub of cycleSubs) {
    if (remarksByFellow.has(sub.fellowRecordId)) continue;
    const trimmed = sub.remarks?.trim();
    if (trimmed) remarksByFellow.set(sub.fellowRecordId, trimmed);
  }

  const submittedFellows: LiveFellowData[] = cycleSnaps.map(s => ({
    fellowRecordId: s.fellowRecordId,
    fellowName: s.fellowName,
    designation: s.designation,
    totalHoursPerWeek: s.totalHoursPerWeek ?? 0,
    hoursUtilizationPct: s.hoursUtilizationPct ?? 0,
    loadTag: s.hoursLoadTag ?? 'Free',
    projectBreakdown: s.projectBreakdown,
    hasConflict: false,
    remarks: remarksByFellow.get(s.fellowRecordId) ?? null,
    excludedProjectCount: s.excludedProjectCount,
  }));

  const signoffPanelRows = buildSignoffPanelRows(allProjects, cycleSignoffs, directors);

  return {
    cycleId: latest.id,
    startDate: latest.startDate,
    status: 'complete',
    submittedFellows,
    pendingFellows: [],
    pendingConflicts: 0,
    signoffPanelRows,
  };
}

async function getLiveCycleData(): Promise<LiveCycleData | null> {
  const [activeCycle] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'collecting'))
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!activeCycle) return null;

  const [allTokens, allSubs, allConflicts, allCycleSignoffs, allProjects, directors] = await Promise.all([
    db.select().from(tokens).where(eq(tokens.cycleId, activeCycle.id)),
    db.select().from(submissions).where(
      and(eq(submissions.cycleId, activeCycle.id), eq(submissions.isSelfReport, true))
    ),
    db.select().from(conflicts).where(eq(conflicts.cycleId, activeCycle.id)),
    db.select().from(directorSignoffs).where(eq(directorSignoffs.cycleId, activeCycle.id)),
    fetchAllProjects(),
    fetchDirectors(),
  ]);

  // Open signoffs = email_sent or flagged — used to compute the awaiting-signoff chip
  const openSignoffs = allCycleSignoffs.filter(
    s => s.status === 'email_sent' || s.status === 'flagged'
  );

  const pendingConflicts = allConflicts.filter(c => c.status === 'pending');
  const conflictProjectIds = new Set(pendingConflicts.map(c => c.projectRecordId));
  const conflictFellowIds = new Set<string>();
  // Find which fellows are involved in pending conflicts
  for (const c of pendingConflicts) {
    const relatedSubs = allSubs.filter(s => s.projectRecordId === c.projectRecordId);
    for (const s of relatedSubs) conflictFellowIds.add(s.fellowRecordId);
  }

  // Compute projects with an open director signoff (team-based scope only)
  const awaitingSignoffProjects = new Set<string>();
  for (const sig of openSignoffs) {
    for (const p of allProjects) {
      if (p.vpAvpIds.length + p.associateIds.length > 0 && p.directorIds.includes(sig.directorFellowId)) {
        awaitingSignoffProjects.add(p.projectRecordId);
      }
    }
  }

  const signoffPanelRows = buildSignoffPanelRows(allProjects, allCycleSignoffs, directors);

  const submittedTokens = allTokens.filter(t => t.status === 'submitted');
  const pendingTokens = allTokens.filter(t => t.status === 'pending');

  // Group submissions by fellow
  const subsByFellow = new Map<string, typeof allSubs>();
  for (const sub of allSubs) {
    const list = subsByFellow.get(sub.fellowRecordId) || [];
    list.push(sub);
    subsByFellow.set(sub.fellowRecordId, list);
  }

  const submittedFellows: LiveFellowData[] = submittedTokens
    .map((t): LiveFellowResult => {
      const rawSelfReports = subsByFellow.get(t.fellowRecordId) || [];
      const utilization = buildLiveDashboardFellow(
        rawSelfReports,
        allProjects,
        t.fellowRecordId,
        t.fellowDesignation,
      );
      if (!utilization) return null;

      const {
        submissions: fellowSubs,
        excludedProjectCount,
        totalHoursPerWeek: totalHpw,
        hoursUtilizationPct: utilPct,
        loadTag: tag,
        remarks,
      } = utilization;
      const hasConflict = conflictFellowIds.has(t.fellowRecordId);

      const breakdown: ProjectBreakdownItem[] = fellowSubs.map(s => ({
        projectName: s.projectName,
        projectType: s.projectType as ProjectType,
        hoursPerDay: s.hoursPerDay,
        hoursPerWeek: s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK,
        hasConflict: conflictProjectIds.has(s.projectRecordId),
        awaitingSignoff: awaitingSignoffProjects.has(s.projectRecordId),
        projectRecordId: s.projectRecordId,
      }));

      return {
        fellowRecordId: t.fellowRecordId,
        fellowName: t.fellowName,
        designation: t.fellowDesignation,
        totalHoursPerWeek: totalHpw,
        hoursUtilizationPct: utilPct,
        loadTag: tag,
        projectBreakdown: breakdown,
        hasConflict,
        remarks,
        excludedProjectCount,
      };
    })
    .filter((f): f is LiveFellowData => f !== null);

  return {
    cycleId: activeCycle.id,
    startDate: activeCycle.startDate,
    status: 'collecting',
    submittedFellows,
    pendingFellows: pendingTokens.map(t => ({ name: t.fellowName, designation: t.fellowDesignation })),
    pendingConflicts: pendingConflicts.length,
    signoffPanelRows,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ iy?: string }>;
}) {
  const { iy: iyParam } = await searchParams;

  const now = new Date();
  const defaultIy = now.getMonth() >= INVESTMENT_YEAR_START_MONTH ? now.getFullYear() + 1 : now.getFullYear();
  const iy = iyParam ? parseInt(iyParam) : defaultIy;
  const { start, end } = getIyRange(iy);

  const [allSnapshots, snapshotDates, activeLiveCycle] = await Promise.all([
    db
      .select()
      .from(snapshots)
      .where(and(gte(snapshots.snapshotDate, start), lte(snapshots.snapshotDate, end))),
    db
      .selectDistinct({ snapshotDate: snapshots.snapshotDate })
      .from(snapshots),
    getLiveCycleData(),
  ]);

  const latestCycle: LiveCycleData | null =
    activeLiveCycle && activeLiveCycle.submittedFellows.length > 0
      ? activeLiveCycle
      : await getLatestFinalizedCycleData();

  // Serialize for client component
  const snapshotData: SnapshotData[] = allSnapshots.map(s => ({
    id: s.id,
    cycleId: s.cycleId,
    fellowRecordId: s.fellowRecordId,
    fellowName: s.fellowName,
    designation: s.designation,
    projectBreakdown: s.projectBreakdown,
    snapshotDate: s.snapshotDate,
    totalHoursPerWeek: s.totalHoursPerWeek,
    hoursUtilizationPct: s.hoursUtilizationPct,
    hoursLoadTag: s.hoursLoadTag,
    excludedProjectCount: s.excludedProjectCount,
  }));

  // Blend active cycle into Monthly view: synthesize a pseudo-snapshot per submitted fellow.
  // Only blend when the active cycle is within the current IY range.
  if (
    activeLiveCycle &&
    activeLiveCycle.status === 'collecting' &&
    activeLiveCycle.startDate >= start &&
    activeLiveCycle.startDate <= end
  ) {
    for (const f of activeLiveCycle.submittedFellows) {
      snapshotData.push({
        id: `pseudo-${activeLiveCycle.cycleId}-${f.fellowRecordId}`,
        cycleId: activeLiveCycle.cycleId,
        fellowRecordId: f.fellowRecordId,
        fellowName: f.fellowName,
        designation: f.designation,
        projectBreakdown: f.projectBreakdown,
        snapshotDate: activeLiveCycle.startDate,
        totalHoursPerWeek: f.totalHoursPerWeek,
        hoursUtilizationPct: f.hoursUtilizationPct,
        hoursLoadTag: f.loadTag,
        excludedProjectCount: f.excludedProjectCount,
      });
    }
  }

  const availableIys = getAvailableInvestmentYears(
    snapshotDates.map(row => row.snapshotDate),
    defaultIy,
  );

  return (
    <main className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Utilization Dashboard</h1>
        <form className="flex items-center gap-2">
          <label className="text-sm text-gray-600">IY:</label>
          <select
            name="iy"
            defaultValue={iy}
            className="border rounded px-2 py-1 text-sm"
          >
            {availableIys.map(y => (
              <option key={y} value={y}>
                IY{y} ({y - 1}-{y})
              </option>
            ))}
          </select>
          <button type="submit" className="text-xs text-blue-600 hover:underline">Go</button>
        </form>
      </div>

      <DashboardView snapshots={snapshotData} iy={iy} liveCycle={latestCycle} />
    </main>
  );
}
