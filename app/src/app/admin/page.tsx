import { db } from '@/lib/db';
import { cycles, tokens, adHocProjects, submissions } from '@/lib/db/schema';
import { eq, desc, count as countFn } from 'drizzle-orm';
import { FellowsList } from './fellows-list';
import { AdHocList } from './ad-hoc-list';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const [cycle] = await db
    .select()
    .from(cycles)
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!cycle) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Admin</h1>
        <p className="text-gray-600">No cycles yet.</p>
      </main>
    );
  }

  const cycleTokens = await db
    .select()
    .from(tokens)
    .where(eq(tokens.cycleId, cycle.id));

  const activeAdHocs = await db
    .select()
    .from(adHocProjects)
    .where(eq(adHocProjects.status, 'active'));

  const fellows = await fetchEligibleFellows();
  const fellowMap = new Map(fellows.map(f => [f.recordId, f.name]));

  const adHocsWithMeta = await Promise.all(activeAdHocs.map(async a => {
    const [{ c }] = await db
      .select({ c: countFn() })
      .from(submissions)
      .where(eq(submissions.projectRecordId, `adhoc_${a.id}`));
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      directorName: a.directorName ?? '—',
      teammateNames: (a.teammateRecordIds as string[]).map(id => fellowMap.get(id) ?? id),
      createdByFellowName: a.createdByFellowName,
      createdAt: a.createdAt.toISOString(),
      submissionCount: Number(c ?? 0),
    };
  }));

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Admin</h1>
      <p className="text-sm text-gray-500 mb-6">
        Cycle: {cycle.startDate} | Status: {cycle.status}
      </p>
      <FellowsList
        fellows={cycleTokens.map(t => ({
          tokenId: t.id,
          name: t.fellowName,
          designation: t.fellowDesignation,
          status: t.status,
          submittedAt: t.submittedAt?.toISOString() || null,
        }))}
      />
      <AdHocList adHocs={adHocsWithMeta} />
    </main>
  );
}
