import { readFileSync } from 'node:fs';
import { db, getSql } from '../src/lib/db/index';
import { snapshots } from '../src/lib/db/schema';

const REASON = '2026-09-10-reconcile-completed-project-references';
const baselinePath = process.argv.find(argument => argument.startsWith('--baseline='))?.slice('--baseline='.length);
const APPLY = process.argv.includes('--apply');
if (!baselinePath) throw new Error('--baseline=/absolute/path/to/util-before.csv is required');

type BaselineRow = Record<string, unknown>;

function parseBaseline(path: string): Map<string, BaselineRow[]> {
  const grouped = new Map<string, BaselineRow[]>();
  const lines = readFileSync(path, 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const comma = line.indexOf(',');
    if (comma < 1) throw new Error('Malformed baseline row');
    const source = line.slice(0, comma);
    const quoted = line.slice(comma + 1);
    if (!quoted.startsWith('"') || !quoted.endsWith('"')) throw new Error(`Malformed baseline JSON for ${source}`);
    const record = JSON.parse(quoted.slice(1, -1).replaceAll('""', '"')) as BaselineRow;
    grouped.set(source, [...(grouped.get(source) ?? []), record]);
  }
  return grouped;
}

const baseline = parseBaseline(baselinePath);
const pendingRows = baseline.get('pending_projects') ?? [];
const completedIds = new Set(pendingRows
  .filter(row => row.status === 'finished' && row.resolution === 'completed' && !row.references_reconciled_at)
  .map(row => String(row.id)));
const affectedKeys = new Set((baseline.get('submissions') ?? [])
  .filter(row => {
    const projectId = String(row.project_record_id ?? '');
    return projectId.startsWith('pending_') && completedIds.has(projectId.slice('pending_'.length));
  })
  .map(row => `${row.cycle_id}:${row.fellow_record_id}`));
const baselineSnapshots = (baseline.get('snapshots') ?? []).filter(row => affectedKeys.has(`${row.cycle_id}:${row.fellow_record_id}`));
const liveSnapshots = new Map((await db.select().from(snapshots)).map(snapshot => [snapshot.id, snapshot]));
const plans = baselineSnapshots.map(old => {
  const current = liveSnapshots.get(String(old.id));
  if (!current) throw new Error(`Snapshot ${String(old.id)} is missing`);
  if (current.totalHoursPerWeek === null || current.hoursUtilizationPct === null || current.hoursLoadTag === null) throw new Error(`Snapshot ${current.id} has incomplete current totals`);
  return { old, current };
});

if (APPLY) {
  const sql = getSql();
  for (const { old, current } of plans) {
    await sql`
      INSERT INTO snapshot_revisions (
        snapshot_id, reason, old_project_breakdown, old_total_hours_per_week,
        old_hours_utilization_pct, old_hours_load_tag, old_excluded_project_count,
        new_project_breakdown, new_total_hours_per_week, new_hours_utilization_pct,
        new_hours_load_tag
      ) VALUES (
        ${current.id}, ${REASON}, ${JSON.stringify(old.project_breakdown)}::jsonb,
        ${old.total_hours_per_week as number | null}, ${old.hours_utilization_pct as number | null},
        ${old.hours_load_tag as string | null}, ${Number(old.excluded_project_count ?? 0)},
        ${JSON.stringify(current.projectBreakdown)}::jsonb, ${current.totalHoursPerWeek},
        ${current.hoursUtilizationPct}, ${current.hoursLoadTag}
      ) ON CONFLICT (snapshot_id, reason) DO NOTHING
    `;
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'applied' : 'dry-run',
  completedPendingProjects: completedIds.size,
  affectedPersonCycles: affectedKeys.size,
  snapshotRevisions: plans.length,
}, null, 2));
