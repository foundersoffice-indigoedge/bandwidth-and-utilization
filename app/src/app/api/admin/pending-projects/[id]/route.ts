import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects, cycles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/pending-projects/:id
 *
 * Returns a single pending_projects row by id, regardless of status.
 * Used by the Slack interaction handler to re-fetch a row that is in
 * `confirming` state (not returned by the standard GET /pending-projects list).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedIntegrationRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const [row] = await db
    .select({
      id: pendingProjects.id,
      type: pendingProjects.type,
      name: pendingProjects.name,
      directorRecordId: pendingProjects.directorRecordId,
      directorName: pendingProjects.directorName,
      teammateRecordIds: pendingProjects.teammateRecordIds,
      createdByFellowName: pendingProjects.createdByFellowName,
      createdAt: pendingProjects.createdAt,
      status: pendingProjects.status,
      airtableRecordId: pendingProjects.airtableRecordId,
      cycleStartDate: cycles.startDate,
    })
    .from(pendingProjects)
    .innerJoin(cycles, eq(pendingProjects.cycleId, cycles.id))
    .where(eq(pendingProjects.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ row });
}
