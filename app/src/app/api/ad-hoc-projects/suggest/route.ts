import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adHocProjects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { similarity } from '@/lib/similarity';

export async function GET(req: NextRequest) {
  const adHocId = req.nextUrl.searchParams.get('adHocId');
  if (!adHocId) return NextResponse.json({ error: 'adHocId required' }, { status: 400 });

  const [adHoc] = await db.select().from(adHocProjects).where(eq(adHocProjects.id, adHocId)).limit(1);
  if (!adHoc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const allProjects = await fetchAllProjects();
  const candidates = allProjects
    .filter(p => p.projectType === adHoc.type)
    .map(p => ({
      projectRecordId: p.projectRecordId,
      projectName: p.projectName,
      score: similarity(p.projectName, adHoc.name),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return NextResponse.json({ topCandidate: candidates[0] ?? null, alternatives: candidates.slice(1) });
}
