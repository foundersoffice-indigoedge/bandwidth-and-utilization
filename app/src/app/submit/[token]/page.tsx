import { db } from '@/lib/db';
import { tokens } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchAllProjects, getProjectsForFellow } from '@/lib/airtable/projects';
import { fetchEligibleFellows, isVpOrAvp } from '@/lib/airtable/fellows';
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

  const [projects, fellows] = await Promise.all([
    fetchAllProjects(),
    fetchEligibleFellows(),
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
        projects={projectsWithAssociates}
      />
    </main>
  );
}
