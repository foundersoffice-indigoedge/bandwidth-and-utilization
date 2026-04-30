import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pendingProjects } from '@/lib/db/schema';
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
      airtableRecordId: pendingProjects.airtableRecordId,
    })
    .from(pendingProjects)
    .where(eq(pendingProjects.status, 'awaiting_setup'))
    .orderBy(asc(pendingProjects.createdAt));

  return NextResponse.json({ rows });
}
