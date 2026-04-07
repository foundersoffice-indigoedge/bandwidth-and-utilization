import { db } from '@/lib/db';
import { cycles, tokens } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { FellowsList } from './fellows-list';

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

  return (
    <main className="max-w-2xl mx-auto p-6">
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
    </main>
  );
}
