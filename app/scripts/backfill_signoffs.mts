// One-off backfill: trigger createSignoffIfReady for each current Director with
// an in-scope project on the latest cycle. Idempotent — createSignoffIfReady bails
// if a row already exists. Sends real emails. Run AFTER the fix is deployed.

import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\\n$/, '');
}

import { neon } from '@neondatabase/serverless';
const projMod: any = await import('../src/lib/airtable/projects');
const fellMod: any = await import('../src/lib/airtable/fellows');
const signoffMod: any = await import('../src/lib/signoff');

const sql = neon(process.env.DATABASE_URL!);

const dryRun = process.argv.includes('--dry-run');
const cycleIdArg = process.argv.slice(2).find(a => !a.startsWith('--'));
const cycle = cycleIdArg
  ? ((await sql`SELECT id, start_date, status FROM cycles WHERE id = ${cycleIdArg}`) as any[])[0]
  : ((await sql`SELECT id, start_date, status FROM cycles ORDER BY start_date DESC LIMIT 1`) as any[])[0];

if (!cycle) {
  console.error('No cycle found.');
  process.exit(1);
}
console.log(`Backfilling sign-offs for cycle ${cycle.id} (start_date=${cycle.start_date}, status=${cycle.status})`);

const [projects, directors] = await Promise.all([projMod.fetchAllProjects(), fellMod.fetchDirectors()]);
const directorIds = new Set(directors.map((d: any) => d.recordId));

// Collect every director recordId that appears on an in-scope project (≥1 team member)
const expected = new Set<string>();
for (const p of projects) {
  if (p.vpAvpIds.length + p.associateIds.length === 0) continue;
  for (const dirId of p.directorIds) {
    if (directorIds.has(dirId)) expected.add(dirId);
  }
}

console.log(`Current Directors with in-scope projects: ${expected.size}`);
console.log([...expected].map(id => `  • ${directors.find((d: any) => d.recordId === id)?.name ?? id}`).join('\n'));

if (dryRun) {
  console.log('\n[DRY RUN] — not calling createSignoffIfReady.');
  process.exit(0);
}

console.log('\nRunning createSignoffIfReady for each…\n');
for (const dirId of expected) {
  const dir = directors.find((d: any) => d.recordId === dirId);
  try {
    const result = await signoffMod.createSignoffIfReady(cycle.id, dirId);
    console.log(`  ${dir?.name ?? dirId}: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`  ${dir?.name ?? dirId}: ERROR`, err instanceof Error ? err.message : err);
  }
}
console.log('\nDone.');
