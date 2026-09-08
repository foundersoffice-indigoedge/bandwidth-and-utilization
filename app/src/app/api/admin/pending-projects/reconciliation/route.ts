import { NextResponse } from 'next/server';
import { asc, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pendingProjects, cycles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isAuthorizedIntegrationRequest } from '@/lib/integration-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAuthorizedIntegrationRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await db.select({
    id: pendingProjects.id,
    cycleId: pendingProjects.cycleId,
    cycleStartDate: cycles.startDate,
    type: pendingProjects.type,
    name: pendingProjects.name,
    directorRecordId: pendingProjects.directorRecordId,
    directorName: pendingProjects.directorName,
    teammateRecordIds: pendingProjects.teammateRecordIds,
    createdByFellowId: pendingProjects.createdByFellowId,
    createdByFellowName: pendingProjects.createdByFellowName,
    createdAt: pendingProjects.createdAt,
    status: pendingProjects.status,
    airtableRecordId: pendingProjects.airtableRecordId,
    airtableProjectName: pendingProjects.airtableProjectName,
    processingClaimId: pendingProjects.processingClaimId,
    processingClaimedAt: pendingProjects.processingClaimedAt,
    processingStep: pendingProjects.processingStep,
    processingProgress: pendingProjects.processingProgress,
    processingError: pendingProjects.processingError,
    processingUpdatedAt: pendingProjects.processingUpdatedAt,
  }).from(pendingProjects).innerJoin(cycles, eq(pendingProjects.cycleId, cycles.id))
    .where(inArray(pendingProjects.status, ['pending', 'confirming', 'awaiting_setup']))
    .orderBy(asc(pendingProjects.createdAt));
  const now = Date.now();
  return NextResponse.json({ rows: rows.map((row) => ({ ...row, leaseExpired: row.status === 'confirming' && (!row.processingClaimedAt || now - row.processingClaimedAt.getTime() > 600_000) })) });
}
