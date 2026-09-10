import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../src/lib/db/index';
import { pendingProjects, submissions } from '../src/lib/db/schema';
import { reconcileCompletedPendingProject } from '../src/lib/pending-project-reconciliation';

const APPLY = process.argv.includes('--apply');
const candidates = await db.select().from(pendingProjects).where(and(
  eq(pendingProjects.status, 'finished'),
  eq(pendingProjects.resolution, 'completed'),
  isNull(pendingProjects.referencesReconciledAt),
));

const rows = [];
for (const candidate of candidates) {
  const source = await db.select({ id: submissions.id }).from(submissions)
    .where(eq(submissions.projectRecordId, `pending_${candidate.id}`));
  if (source.length === 0) continue;
  if (!candidate.airtableRecordId) {
    rows.push({ id: candidate.id, name: candidate.name, sourceRows: source.length, status: 'held', detail: 'missing Airtable project link' });
    continue;
  }
  if (!APPLY) {
    rows.push({ id: candidate.id, name: candidate.name, sourceRows: source.length, status: 'ready' });
    continue;
  }
  try {
    const result = await reconcileCompletedPendingProject(candidate);
    rows.push({ id: candidate.id, name: candidate.name, sourceRows: source.length, status: 'reconciled', result });
  } catch (error) {
    rows.push({ id: candidate.id, name: candidate.name, sourceRows: source.length, status: 'held', detail: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'applied' : 'dry-run',
  candidates: rows.length,
  sourceRows: rows.reduce((sum, row) => sum + row.sourceRows, 0),
  ready: rows.filter(row => row.status === 'ready').length,
  reconciled: rows.filter(row => row.status === 'reconciled').length,
  held: rows.filter(row => row.status === 'held').length,
  rows,
}, null, 2));
