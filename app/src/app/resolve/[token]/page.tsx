import { db } from '@/lib/db';
import { conflicts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { ResolutionView } from './form';

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

  return (
    <main className="max-w-md mx-auto p-6 mt-10">
      <h1 className="text-xl font-bold mb-4">Resolve Bandwidth Conflict</h1>
      <ResolutionView
        resolutionToken={token}
        vpHours={conflict.vpHoursPerDay}
        associateHours={conflict.associateHoursPerDay}
        initialAction={action as 'use_associate' | 'use_vp' | 'custom' | undefined}
      />
    </main>
  );
}
