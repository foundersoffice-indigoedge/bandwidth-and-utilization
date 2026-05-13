import { db } from '@/lib/db';
import { conflicts, submissions, directorSignoffs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { ResolutionView } from './form';
import { DirectorFlagResolveForm } from './director-flag-form';

export default async function ResolvePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { token } = await params;
  const { action } = await searchParams;

  const [conflict] = await db
    .select()
    .from(conflicts)
    .where(eq(conflicts.resolutionToken, token))
    .limit(1);

  if (!conflict) return notFound();
  if (conflict.status === 'resolved') redirect('/resolved');

  // ---------------------------------------------------------------------------
  // Branch: director_flag conflict — different UI
  // ---------------------------------------------------------------------------
  if (conflict.source === 'director_flag') {
    // Gather context for the display: flagged submission + signoff (for director name)
    let submissionProjectName = 'this project';
    let submissionFellowName = 'this person';
    let directorName = 'the director';

    if (conflict.flaggedSubmissionId) {
      const [sub] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, conflict.flaggedSubmissionId))
        .limit(1);
      if (sub) {
        submissionProjectName = sub.projectName;
      }
    }

    if (conflict.signoffId) {
      const [signoffRow] = await db
        .select({ directorName: directorSignoffs.directorName })
        .from(directorSignoffs)
        .where(eq(directorSignoffs.id, conflict.signoffId))
        .limit(1);
      if (signoffRow) {
        directorName = signoffRow.directorName;
      }
    }

    const originalHours = conflict.flaggedOriginalHoursPerDay ?? 0;

    return (
      <main className="max-w-md mx-auto p-6 mt-10">
        <h1 className="text-xl font-bold mb-1">Director Sign-off Flag</h1>
        <p className="text-sm text-gray-500 mb-4">
          {directorName} flagged{' '}
          {submissionFellowName !== 'this person' ? (
            <strong>{submissionFellowName}</strong>
          ) : (
            'a bandwidth entry'
          )}{' '}
          on <strong>{submissionProjectName}</strong>.
        </p>
        <DirectorFlagResolveForm
          resolutionToken={token}
          originalHoursPerDay={originalHours}
          proposedHoursPerDay={conflict.proposedHoursPerDay ?? null}
          directorComment={conflict.directorComment ?? null}
          initialAction={action}
        />
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Existing path: submission-source conflict
  // ---------------------------------------------------------------------------
  return (
    <main className="max-w-md mx-auto p-6 mt-10">
      <h1 className="text-xl font-bold mb-4">Resolve Bandwidth Conflict</h1>
      <ResolutionView
        resolutionToken={token}
        vpHours={conflict.vpHoursPerDay!}
        associateHours={conflict.associateHoursPerDay!}
        initialAction={action as 'use_associate' | 'use_vp' | 'custom' | undefined}
      />
    </main>
  );
}
