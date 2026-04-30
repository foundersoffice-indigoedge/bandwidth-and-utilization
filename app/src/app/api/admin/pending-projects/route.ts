import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects, cycles } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: pendingProjects.id,
      type: pendingProjects.type,
      name: pendingProjects.name,
      directorRecordId: pendingProjects.directorRecordId,
      directorName: pendingProjects.directorName,
      teammateRecordIds: pendingProjects.teammateRecordIds,
      createdByFellowName: pendingProjects.createdByFellowName,
      createdAt: pendingProjects.createdAt,
      cycleStartDate: cycles.startDate,
    })
    .from(pendingProjects)
    .innerJoin(cycles, eq(pendingProjects.cycleId, cycles.id))
    .where(eq(pendingProjects.status, 'pending'))
    .orderBy(asc(pendingProjects.createdAt));

  return NextResponse.json({ rows });
}
