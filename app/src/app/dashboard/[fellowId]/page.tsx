import { db } from '@/lib/db';
import { snapshots } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import type { ProjectBreakdownItem } from '@/types';

export const dynamic = 'force-dynamic';

const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function getIyRange(iy: number) {
  return { start: `${iy - 1}-07-01`, end: `${iy}-06-30` };
}

export default async function DrillDownPage({
  params,
  searchParams,
}: {
  params: Promise<{ fellowId: string }>;
  searchParams: Promise<{ iy?: string }>;
}) {
  const { fellowId } = await params;
  const { iy: iyParam } = await searchParams;

  const now = new Date();
  const defaultIy = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const iy = iyParam ? parseInt(iyParam) : defaultIy;
  const { start, end } = getIyRange(iy);

  const fellowSnapshots = await db
    .select()
    .from(snapshots)
    .where(
      and(
        eq(snapshots.fellowRecordId, fellowId),
        gte(snapshots.snapshotDate, start),
        lte(snapshots.snapshotDate, end)
      )
    );

  if (fellowSnapshots.length === 0) return notFound();

  const fellowName = fellowSnapshots[0].fellowName;
  const designation = fellowSnapshots[0].designation;
  const capacityMeu = fellowSnapshots[0].capacityMeu;

  const monthData = new Map<number, typeof fellowSnapshots[0]>();
  for (const snap of fellowSnapshots) {
    const d = new Date(snap.snapshotDate);
    const monthIdx = (d.getMonth() + 6) % 12;
    const existing = monthData.get(monthIdx);
    if (!existing || snap.snapshotDate > existing.snapshotDate) {
      monthData.set(monthIdx, snap);
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <a href={`/dashboard?iy=${iy}`} className="text-sm text-blue-600 hover:underline">
        &larr; Back to overview
      </a>

      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold">{fellowName}</h1>
        <p className="text-sm text-gray-500">
          {designation} | Capacity: {capacityMeu} MEU | IY{iy}
        </p>
      </div>

      <table className="w-full text-sm border-collapse mb-8">
        <thead>
          <tr className="bg-gray-50">
            <th className="border p-2 text-left">Month</th>
            <th className="border p-2 text-center">Utilization</th>
            <th className="border p-2 text-center">MEU</th>
            <th className="border p-2 text-center">Mandates</th>
            <th className="border p-2 text-center">DDEs</th>
            <th className="border p-2 text-center">Pitches</th>
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((monthName, idx) => {
            const snap = monthData.get(idx);
            if (!snap) {
              return (
                <tr key={idx}>
                  <td className="border p-2">{monthName}</td>
                  <td className="border p-2 text-center text-gray-300" colSpan={5}>
                    —
                  </td>
                </tr>
              );
            }

            const breakdown = snap.projectBreakdown as ProjectBreakdownItem[];
            const mandateCount = breakdown.filter(b => b.projectType === 'mandate').length;
            const ddeCount = breakdown.filter(b => b.projectType === 'dde').length;
            const pitchCount = breakdown.filter(b => b.projectType === 'pitch').length;

            return (
              <tr key={idx}>
                <td className="border p-2 font-medium">{monthName}</td>
                <td className="border p-2 text-center">
                  {Math.round(snap.utilizationPct * 100)}%
                </td>
                <td className="border p-2 text-center">
                  {snap.totalMeu.toFixed(2)} / {snap.capacityMeu.toFixed(1)}
                </td>
                <td className="border p-2 text-center">{mandateCount}</td>
                <td className="border p-2 text-center">{ddeCount}</td>
                <td className="border p-2 text-center">{pitchCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="text-lg font-semibold mb-3">Project Breakdown</h2>
      {MONTHS.map((monthName, idx) => {
        const snap = monthData.get(idx);
        if (!snap) return null;

        const breakdown = snap.projectBreakdown as ProjectBreakdownItem[];

        return (
          <div key={idx} className="mb-4">
            <h3 className="font-medium text-sm text-gray-700 mb-1">{monthName}</h3>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="p-2 text-left">Project</th>
                    <th className="p-2 text-center">Type</th>
                    <th className="p-2 text-center">Score</th>
                    <th className="p-2 text-center">MEU</th>
                    <th className="p-2 text-center">Hrs/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((b, i) => (
                    <tr key={i}>
                      <td className="p-2">{b.projectName}</td>
                      <td className="p-2 text-center uppercase">{b.projectType}</td>
                      <td className="p-2 text-center">{b.score}</td>
                      <td className="p-2 text-center">{b.meu.toFixed(2)}</td>
                      <td className="p-2 text-center">{b.hoursPerDay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </main>
  );
}
