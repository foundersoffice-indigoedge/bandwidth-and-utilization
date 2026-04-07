import { db } from '@/lib/db';
import { snapshots } from '@/lib/db/schema';
import { and, gte, lte } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function getIyRange(iy: number): { start: string; end: string } {
  return {
    start: `${iy - 1}-07-01`,
    end: `${iy}-06-30`,
  };
}

function getLoadColor(tag: string): string {
  switch (tag) {
    case 'Free':
    case 'Comfortable':
      return 'bg-green-100 text-green-800';
    case 'Busy':
      return 'bg-yellow-100 text-yellow-800';
    case 'At Capacity':
      return 'bg-orange-100 text-orange-800';
    case 'Overloaded':
      return 'bg-red-100 text-red-800';
    default:
      return '';
  }
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

  const fellowMonthMap = new Map<string, Map<number, typeof allSnapshots[0]>>();
  const fellowNames = new Map<string, string>();

  for (const snap of allSnapshots) {
    const date = new Date(snap.snapshotDate);
    const monthIdx = (date.getMonth() + 6) % 12;

    if (!fellowMonthMap.has(snap.fellowRecordId)) {
      fellowMonthMap.set(snap.fellowRecordId, new Map());
    }
    fellowNames.set(snap.fellowRecordId, snap.fellowName);

    const existing = fellowMonthMap.get(snap.fellowRecordId)!.get(monthIdx);
    if (!existing || snap.snapshotDate > existing.snapshotDate) {
      fellowMonthMap.get(snap.fellowRecordId)!.set(monthIdx, snap);
    }
  }

  const fellowIds = Array.from(fellowMonthMap.keys()).sort((a, b) =>
    (fellowNames.get(a) || '').localeCompare(fellowNames.get(b) || '')
  );

  const availableIys = new Set<number>();
  for (const snap of allSnapshots) {
    const d = new Date(snap.snapshotDate);
    availableIys.add(d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear());
  }
  availableIys.add(defaultIy);

  return (
    <main className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Utilization Overview</h1>
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="border p-2 text-left sticky left-0 bg-gray-50 z-10">Fellow</th>
              {MONTHS.map(m => (
                <th key={m} className="border p-2 text-center min-w-[100px]">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fellowIds.map(fid => {
              const months = fellowMonthMap.get(fid)!;
              return (
                <tr key={fid}>
                  <td className="border p-2 font-medium sticky left-0 bg-white z-10">
                    <a
                      href={`/dashboard/${fid}?iy=${iy}`}
                      className="text-blue-600 hover:underline"
                    >
                      {fellowNames.get(fid)}
                    </a>
                  </td>
                  {MONTHS.map((_, idx) => {
                    const snap = months.get(idx);
                    if (!snap) {
                      return <td key={idx} className="border p-2 text-center text-gray-300">—</td>;
                    }
                    return (
                      <td
                        key={idx}
                        className={`border p-2 text-center text-xs ${getLoadColor(snap.loadTag)}`}
                      >
                        <div className="font-medium">
                          {Math.round(snap.utilizationPct * 100)}%
                        </div>
                        <div className="text-[10px] opacity-75">
                          {snap.totalMeu.toFixed(2)}/{snap.capacityMeu.toFixed(1)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
