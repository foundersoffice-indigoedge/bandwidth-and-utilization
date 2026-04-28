import { db } from '@/lib/db';
import { tokens, pendingProjects, submissions } from '@/lib/db/schema';
import { eq, and, like } from 'drizzle-orm';
import { fetchAllProjects, getProjectsForFellow } from '@/lib/airtable/projects';
import { fetchEligibleFellows, isVpOrAvp, fetchDirectors } from '@/lib/airtable/fellows';
import { notFound, redirect } from 'next/navigation';
import { SubmissionForm } from './form';

export default async function SubmitPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: tokenValue } = await params;

  const [tokenRecord] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token, tokenValue))
    .limit(1);

  if (!tokenRecord) return notFound();
  if (tokenRecord.status === 'submitted') redirect('/submitted');
  if (tokenRecord.status === 'not_needed') redirect('/submitted');

  const [projects, fellows, directors, cyclePending, pendingSubs] = await Promise.all([
    fetchAllProjects(),
    fetchEligibleFellows(),
    fetchDirectors(),
    db
      .select()
      .from(pendingProjects)
      .where(
        and(
          eq(pendingProjects.cycleId, tokenRecord.cycleId),
          eq(pendingProjects.status, 'pending'),
        ),
      ),
    db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.cycleId, tokenRecord.cycleId),
          eq(submissions.fellowRecordId, tokenRecord.fellowRecordId),
          like(submissions.projectRecordId, 'pending_%'),
        ),
      ),
  ]);

  const fellowProjects = getProjectsForFellow(projects, tokenRecord.fellowRecordId);
  const isVp = isVpOrAvp(tokenRecord.fellowDesignation);

  const fellowRecordId = tokenRecord.fellowRecordId;

  const projectsWithAssociates = fellowProjects.map(project => {
    const isVpRunMandate = project.projectType === 'mandate' && project.isVpRun === true;
    const isLeadVp = isVpRunMandate && project.leadFellowRecordId === fellowRecordId;

    let targetIds: string[] = [];
    if (isVpRunMandate && !isLeadVp) {
      // VP2 or associate on a VP-run mandate — self only
      targetIds = [];
    } else if (isLeadVp) {
      // VP1 — project for VP2 + every associate
      const otherVpIds = project.vpAvpIds.filter(id => id !== fellowRecordId);
      targetIds = [...otherVpIds, ...project.associateIds];
    } else if (isVp) {
      // Non-VP-run: VP/AVP projects for associates (unchanged)
      targetIds = project.associateIds;
    }

    const associates = targetIds
      .map(id => fellows.find(f => f.recordId === id))
      .filter((f): f is NonNullable<typeof f> => f != null)
      .map(f => ({ recordId: f.recordId, name: f.name }));

    return {
      projectRecordId: project.projectRecordId,
      projectName: project.projectName,
      projectType: project.projectType,
      stage: project.stage,
      associates,
      isVpRun: project.isVpRun,
      leadFellowName: project.leadFellowName,
    };
  });

  const myPendingProjects = cyclePending
    .filter(p =>
      p.createdByFellowId === tokenRecord.fellowRecordId ||
      (p.teammateRecordIds as string[]).includes(tokenRecord.fellowRecordId)
    )
    .map(p => {
      const otherIds = (p.teammateRecordIds as string[]).filter(id => id !== fellowRecordId);
      const creatorId = p.createdByFellowId;
      const teammateIds = creatorId !== fellowRecordId
        ? [creatorId, ...otherIds.filter(id => id !== creatorId)]
        : otherIds;

      const associates = isVp
        ? teammateIds
            .map(id => fellows.find(f => f.recordId === id))
            .filter((f): f is NonNullable<typeof f> => f != null)
            .map(f => ({ recordId: f.recordId, name: f.name }))
        : [];

      const typeLabel = p.type === 'mandate' ? 'Mandate' : p.type === 'dde' ? 'DDE' : 'Pitch';
      return {
        projectRecordId: `pending_${p.id}`,
        projectName: p.name,
        projectType: p.type,
        stage: typeLabel,
        associates,
        isVpRun: false,
        isNew: true,
      };
    });

  const allProjectsForForm = [...projectsWithAssociates, ...myPendingProjects];

  // Pre-fill bandwidth for newly-added projects so values entered at add-time stay visible after re-render.
  const initialEntries: Record<string, { hoursValue: string; hoursUnit: 'per_day' | 'per_week' }> = {};
  for (const s of pendingSubs) {
    const suffix = s.targetFellowId ?? 'self';
    initialEntries[`${s.projectRecordId}:${suffix}`] = {
      hoursValue: String(s.hoursValue),
      hoursUnit: s.hoursUnit,
    };
  }

  const fellowOptions = fellows
    .filter(f => f.recordId !== fellowRecordId)
    .map(f => ({ recordId: f.recordId, name: f.name, designation: f.designation }));

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Bandwidth Update</h1>
      <p className="text-gray-600 mb-6">
        Hi {tokenRecord.fellowName}, report your bandwidth for each project below.
      </p>
      <SubmissionForm
        token={tokenValue}
        fellowName={tokenRecord.fellowName}
        isVp={isVp}
        projects={allProjectsForForm}
        directors={directors}
        fellowOptions={fellowOptions}
        initialEntries={initialEntries}
      />
    </main>
  );
}
