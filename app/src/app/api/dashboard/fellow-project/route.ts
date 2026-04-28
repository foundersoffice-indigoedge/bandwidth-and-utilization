import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submissions, cycles, tokens } from '@/lib/db/schema';
import { eq, or, and } from 'drizzle-orm';
import {
  buildTimeline,
  iyOf,
  listProjectsForFellow,
  type TimelineSubmission,
} from '@/lib/fellow-project-timeline';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

async function loadRelevantSubmissions(fellowRecordId: string): Promise<TimelineSubmission[]> {
  const rows = await db
    .select({
      cycleId: submissions.cycleId,
      cycleStart: cycles.startDate,
      fellowRecordId: submissions.fellowRecordId,
      targetFellowId: submissions.targetFellowId,
      isSelfReport: submissions.isSelfReport,
      projectRecordId: submissions.projectRecordId,
      projectName: submissions.projectName,
      projectType: submissions.projectType,
      hoursPerWeek: submissions.hoursPerWeek,
      hoursPerDay: submissions.hoursPerDay,
      autoScore: submissions.autoScore,
    })
    .from(submissions)
    .innerJoin(cycles, eq(submissions.cycleId, cycles.id))
    .where(
      or(
        and(eq(submissions.fellowRecordId, fellowRecordId), eq(submissions.isSelfReport, true)),
        and(eq(submissions.targetFellowId, fellowRecordId), eq(submissions.isSelfReport, false)),
      ),
    );

  return rows.map(r => ({
    cycleId: r.cycleId,
    cycleStart: r.cycleStart,
    fellowRecordId: r.fellowRecordId,
    targetFellowId: r.targetFellowId,
    isSelfReport: r.isSelfReport,
    projectRecordId: r.projectRecordId,
    projectName: r.projectName,
    projectType: r.projectType,
    hoursPerWeek: r.hoursPerWeek ?? r.hoursPerDay * WORKING_DAYS_PER_WEEK,
    hoursPerDay: r.hoursPerDay,
    autoScore: r.autoScore,
  }));
}

async function handleBootstrap() {
  // All fellows who have ever participated (as submitter or target), with latest known name/designation
  const [tokRows, cycleRows] = await Promise.all([
    db
      .select({
        fellowRecordId: tokens.fellowRecordId,
        fellowName: tokens.fellowName,
        fellowDesignation: tokens.fellowDesignation,
      })
      .from(tokens),
    db.select({ startDate: cycles.startDate }).from(cycles),
  ]);

  const fellowMap = new Map<string, { fellowRecordId: string; name: string; designation: string }>();
  for (const t of tokRows) {
    fellowMap.set(t.fellowRecordId, {
      fellowRecordId: t.fellowRecordId,
      name: t.fellowName,
      designation: t.fellowDesignation,
    });
  }

  const fellows = Array.from(fellowMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  const iySet = new Set<number>();
  for (const c of cycleRows) iySet.add(iyOf(c.startDate));
  const iys = Array.from(iySet).sort((a, b) => b - a);

  return NextResponse.json({ fellows, iys });
}

async function handleProjects(fellowRecordId: string, iys: number[]) {
  const subs = await loadRelevantSubmissions(fellowRecordId);
  const projects = listProjectsForFellow(subs, fellowRecordId, iys);
  return NextResponse.json({ projects });
}

async function handleTimeline(fellowRecordId: string, projectRecordId: string) {
  const subs = await loadRelevantSubmissions(fellowRecordId);
  const points = buildTimeline(subs, fellowRecordId, projectRecordId);
  return NextResponse.json({ points });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

  if (mode === 'bootstrap') {
    return handleBootstrap();
  }

  if (mode === 'projects') {
    const fellow = url.searchParams.get('fellow');
    const iysParam = url.searchParams.get('iys');
    if (!fellow || !iysParam) {
      return NextResponse.json({ error: 'fellow and iys required' }, { status: 400 });
    }
    const iys = iysParam.split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
    if (iys.length === 0) {
      return NextResponse.json({ projects: [] });
    }
    return handleProjects(fellow, iys);
  }

  if (mode === 'timeline') {
    const fellow = url.searchParams.get('fellow');
    const project = url.searchParams.get('project');
    if (!fellow || !project) {
      return NextResponse.json({ error: 'fellow and project required' }, { status: 400 });
    }
    return handleTimeline(fellow, project);
  }

  return NextResponse.json({ error: 'unknown mode' }, { status: 400 });
}
