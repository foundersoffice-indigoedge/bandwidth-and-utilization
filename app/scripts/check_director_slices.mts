// Quick read-only check: which current Directors have COMPLETE slices on the latest cycle?
// Answer tells us what backfill_signoffs.mts will actually create vs skip.

import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\\n$/, '');
}

import { neon } from '@neondatabase/serverless';
const projMod: any = await import('../src/lib/airtable/projects');
const fellMod: any = await import('../src/lib/airtable/fellows');

const sql = neon(process.env.DATABASE_URL!);

const [cycle] = await sql`SELECT id, start_date, status FROM cycles ORDER BY start_date DESC LIMIT 1` as any[];

const [projects, directors] = await Promise.all([projMod.fetchAllProjects(), fellMod.fetchDirectors()]);
const tokens = await sql`SELECT fellow_record_id, status FROM tokens WHERE cycle_id = ${cycle.id}` as any[];
const submissions = await sql`SELECT id, fellow_record_id, project_record_id FROM submissions WHERE cycle_id = ${cycle.id}` as any[];
const conflicts = await sql`SELECT project_record_id, status, source FROM conflicts WHERE cycle_id = ${cycle.id}` as any[];

const expanded: { projectRecordId: string; fellowRecordId: string; status: string }[] = [];
for (const t of tokens) {
  for (const p of projects) {
    if (p.vpAvpIds.includes(t.fellow_record_id) || p.associateIds.includes(t.fellow_record_id)) {
      expanded.push({ projectRecordId: p.projectRecordId, fellowRecordId: t.fellow_record_id, status: t.status });
    }
  }
}
const subsForSlice = submissions.map((s: any) => ({ id: s.id, projectRecordId: s.project_record_id, fellowRecordId: s.fellow_record_id }));
const conflictsForSlice = conflicts.map((c: any) => ({ projectRecordId: c.project_record_id, status: c.status, source: c.source ?? 'submission' }));

function sliceStatus(dirId: string) {
  const dirProjects = projects.filter((p: any) => p.directorIds.includes(dirId));
  const subsByProject = new Map<string, number>();
  for (const s of subsForSlice) subsByProject.set(s.projectRecordId, (subsByProject.get(s.projectRecordId) || 0) + 1);
  const inScope = dirProjects.filter((p: any) => {
    const hasTeam = p.vpAvpIds.length + p.associateIds.length > 0;
    const hasSubs = (subsByProject.get(p.projectRecordId) || 0) > 0;
    return hasTeam || hasSubs;
  });
  const blockers: string[] = [];
  for (const p of inScope) {
    const teamIds = new Set([...p.vpAvpIds, ...p.associateIds]);
    const pendingFellows = tokens.filter((t: any) => teamIds.has(t.fellow_record_id) && t.status === 'pending');
    if (pendingFellows.length > 0) blockers.push(`${p.projectName}: pending ${pendingFellows.map((f: any) => f.fellow_record_id).join(',')}`);
    const pendingConfs = conflictsForSlice.filter(c => c.projectRecordId === p.projectRecordId && c.status === 'pending' && c.source === 'submission');
    if (pendingConfs.length > 0) blockers.push(`${p.projectName}: pending submission conflict`);
  }
  return { status: blockers.length === 0 ? 'COMPLETE' : 'incomplete', blockers };
}

const fellowMap = new Map<string, string>();
const fellows = await fellMod.fetchEligibleFellows();
for (const f of fellows) fellowMap.set(f.recordId, f.name);
for (const d of directors) fellowMap.set(d.recordId, d.name);

console.log(`Cycle ${cycle.id} (start ${cycle.start_date}, status ${cycle.status})\n`);
const directorIds = new Set<string>();
for (const p of projects) {
  if (p.vpAvpIds.length + p.associateIds.length === 0) continue;
  for (const dirId of p.directorIds) {
    if (directors.find((d: any) => d.recordId === dirId)) directorIds.add(dirId);
  }
}
for (const dirId of directorIds) {
  const name = directors.find((d: any) => d.recordId === dirId)?.name ?? dirId;
  const { status, blockers } = sliceStatus(dirId);
  console.log(`[${name}] ${status}`);
  for (const b of blockers) {
    const enriched = b.replace(/recA-Za-z0-9]+/g, (m) => fellowMap.get(m) ?? m);
    console.log(`  ${enriched.replace(/(rec[A-Za-z0-9]+)/g, (m) => fellowMap.get(m) ?? m)}`);
  }
}
