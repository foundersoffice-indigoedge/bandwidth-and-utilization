import { db } from '@/lib/db';
import { directorSignoffs, submissions as submissionsTable, cycles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { fetchEligibleFellows } from '@/lib/airtable/fellows';
import { buildSignoffGroups } from '@/lib/signoff';
import { formatDateRange } from '@/lib/schedule';
import { SignoffForm } from './signoff-form';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function SignoffPage({ params }: Props) {
  const { token } = await params;

  const [signoff] = await db
    .select()
    .from(directorSignoffs)
    .where(eq(directorSignoffs.signoffToken, token))
    .limit(1);

  if (!signoff) {
    return (
      <main style={{ padding: 32 }}>
        <h1>Invalid sign-off link</h1>
        <p>This link is either invalid or has already expired.</p>
      </main>
    );
  }

  const [cycle] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.id, signoff.cycleId))
    .limit(1);

  const dateRange = cycle ? formatDateRange(cycle.startDate) : '';

  // Terminal state views
  if (signoff.status === 'confirmed') {
    return (
      <main style={{ padding: 32 }}>
        <h1>Already confirmed</h1>
        <p>
          You confirmed bandwidth for {dateRange}
          {signoff.confirmedAt ? ` on ${signoff.confirmedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}.
        </p>
      </main>
    );
  }

  if (signoff.status === 'flagged' || signoff.status === 'flagged_resolved') {
    return (
      <main style={{ padding: 32 }}>
        <h1>Already responded</h1>
        <p>
          You flagged this cycle ({dateRange}). Resolution is{' '}
          {signoff.status === 'flagged_resolved' ? 'complete' : 'in progress'}.
        </p>
      </main>
    );
  }

  // status === 'email_sent' — render the interactive form
  const [projects, cycleSubmissions, fellows] = await Promise.all([
    fetchAllProjects(),
    db.select().from(submissionsTable).where(eq(submissionsTable.cycleId, signoff.cycleId)),
    fetchEligibleFellows(),
  ]);

  const groups = buildSignoffGroups(signoff.directorFellowId, projects, cycleSubmissions, fellows);

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 32 }}>
      <h1>Bandwidth Sign-off — {dateRange}</h1>
      <p>
        Director: <strong>{signoff.directorName}</strong>
      </p>
      <SignoffForm token={token} groups={groups} />
    </main>
  );
}
