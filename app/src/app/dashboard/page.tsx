import { db } from '@/lib/db';
import { snapshots } from '@/lib/db/schema';
import { and, gte, lte } from 'drizzle-orm';
import { DashboardView } from './DashboardView';
import type { ProjectBreakdownItem } from '@/types';

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

  const allSnapshots = await db
    .select()
    .from(snapshots)
    .where(and(gte(snapshots.snapshotDate, start), lte(snapshots.snapshotDate, end)));

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

      <DashboardView snapshots={snapshotData} iy={iy} />
    </main>
  );
}
