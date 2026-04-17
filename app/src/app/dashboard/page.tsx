import { db } from '@/lib/db';
import { cycles, tokens, submissions, conflicts, snapshots } from '@/lib/db/schema';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { DashboardView } from './DashboardView';
import { calculateHoursUtilization, getLoadTag } from '@/lib/utilization';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import type { ProjectBreakdownItem, ProjectType } from '@/types';

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
  capacityMeu: number;
  totalMeu: number;
  utilizationPct: number;
  loadTag: string;
  projectBreakdown: ProjectBreakdownItem[];
  snapshotDate: string;
  totalHoursPerWeek: number | null;
  hoursUtilizationPct: number | null;
  hoursLoadTag: string | null;
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
}

type LiveFellowResult = LiveFellowData | null;

export interface LiveCycleData {
  cycleId: string;
  startDate: string;
  submittedFellows: LiveFellowData[];
  pendingFellows: { name: string; designation: string }[];
  pendingConflicts: number;
}

async function getLiveCycleData(): Promise<LiveCycleData | null> {
  const [activeCycle] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'collecting'))
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!activeCycle) return null;

  const [allTokens, allSubs, allConflicts] = await Promise.all([
    db.select().from(tokens).where(eq(tokens.cycleId, activeCycle.id)),
    db.select().from(submissions).where(
      and(eq(submissions.cycleId, activeCycle.id), eq(submissions.isSelfReport, true))
    ),
    db.select().from(conflicts).where(eq(conflicts.cycleId, activeCycle.id)),
  ]);

  const pendingConflicts = allConflicts.filter(c => c.status === 'pending');
  const conflictFellowIds = new Set<string>();
  // Find which fellows are involved in pending conflicts
  for (const c of pendingConflicts) {
    const relatedSubs = allSubs.filter(s => s.projectRecordId === c.projectRecordId);
    for (const s of relatedSubs) conflictFellowIds.add(s.fellowRecordId);
  }

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
      const fellowSubs = subsByFellow.get(t.fellowRecordId) || [];
      if (fellowSubs.length === 0) return null;

      const totalHpw = fellowSubs.reduce((sum, s) => sum + (s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK), 0);
      const utilPct = calculateHoursUtilization(totalHpw);
      const tag = getLoadTag(utilPct) as string;
      const hasConflict = conflictFellowIds.has(t.fellowRecordId);

      const breakdown: ProjectBreakdownItem[] = fellowSubs.map(s => ({
        projectName: s.projectName,
        projectType: s.projectType as ProjectType,
        score: s.autoScore,
        meu: s.autoMeu,
        hoursPerDay: s.hoursPerDay,
        hoursPerWeek: s.hoursPerWeek ?? s.hoursPerDay * WORKING_DAYS_PER_WEEK,
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
      };
    })
    .filter((f): f is LiveFellowData => f !== null);

  return {
    cycleId: activeCycle.id,
    startDate: activeCycle.startDate,
    submittedFellows,
    pendingFellows: pendingTokens.map(t => ({ name: t.fellowName, designation: t.fellowDesignation })),
    pendingConflicts: pendingConflicts.length,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ iy?: string }>;
}) {
  const { iy: iyParam } = await searchParams;

  const now = new Date();
  const defaultIy = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const iy = iyParam ? parseInt(iyParam) : defaultIy;
  const { start, end } = getIyRange(iy);

  const [allSnapshots, liveCycle] = await Promise.all([
    db
      .select()
      .from(snapshots)
      .where(and(gte(snapshots.snapshotDate, start), lte(snapshots.snapshotDate, end))),
    getLiveCycleData(),
  ]);

  // Serialize for client component
  const snapshotData: SnapshotData[] = allSnapshots.map(s => ({
    id: s.id,
    cycleId: s.cycleId,
    fellowRecordId: s.fellowRecordId,
    fellowName: s.fellowName,
    designation: s.designation,
    capacityMeu: s.capacityMeu,
    totalMeu: s.totalMeu,
    utilizationPct: s.utilizationPct,
    loadTag: s.loadTag,
    projectBreakdown: s.projectBreakdown,
    snapshotDate: s.snapshotDate,
    totalHoursPerWeek: s.totalHoursPerWeek,
    hoursUtilizationPct: s.hoursUtilizationPct,
    hoursLoadTag: s.hoursLoadTag,
  }));

  // Compute available IYs for the selector
  const availableIys = new Set<number>();
  for (const snap of allSnapshots) {
    const d = new Date(snap.snapshotDate);
    availableIys.add(d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear());
  }
  availableIys.add(defaultIy);

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
            {Array.from(availableIys)
              .sort()
              .map(y => (
                <option key={y} value={y}>
                  IY{y} ({y - 1}-{y})
                </option>
              ))}
          </select>
          <button type="submit" className="text-xs text-blue-600 hover:underline">Go</button>
        </form>
      </div>

      <DashboardView snapshots={snapshotData} iy={iy} liveCycle={liveCycle} />
    </main>
  );
}
