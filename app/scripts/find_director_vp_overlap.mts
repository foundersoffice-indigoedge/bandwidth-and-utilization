// Read-only diagnostic: find active projects where the SAME person sits in both
// a Director column and the VP/AVP column. These are the polluted records created by
// the old auto-team re-flag loop. No writes — just reports what a cleanup would touch.

import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\\n$/, '');
}

const projMod: any = await import('../src/lib/airtable/projects');
const fellMod: any = await import('../src/lib/airtable/fellows');

const [projects, eligible, directors] = await Promise.all([
  projMod.fetchAllProjects(),
  fellMod.fetchEligibleFellows(),
  fellMod.fetchDirectors(),
]);

const nameMap = new Map<string, { name: string; designation: string }>();
for (const f of [...eligible, ...directors]) {
  nameMap.set(f.recordId, { name: f.name, designation: f.designation });
}

const describe = (id: string) => {
  const f = nameMap.get(id);
  return f ? `${f.name} (${f.designation})` : `${id} (not an active IB fellow)`;
};

let found = 0;
for (const p of projects) {
  const overlap = p.directorIds.filter((id: string) => p.vpAvpIds.includes(id));
  if (overlap.length === 0) continue;
  found++;
  console.log(`\n[${p.projectType.toUpperCase()}] ${p.projectName}  (${p.projectRecordId})  stage=${p.stage}`);
  console.log(`  Director col:  ${p.directorIds.map(describe).join(', ') || '(empty)'}`);
  console.log(`  VP/AVP col:    ${p.vpAvpIds.map(describe).join(', ') || '(empty)'}`);
  console.log(`  Associate col: ${p.associateIds.map(describe).join(', ') || '(empty)'}`);
  for (const id of overlap) {
    console.log(`  >> DOUBLE-LISTED: ${describe(id)} is in BOTH Director and VP/AVP`);
  }
}

console.log(`\n${found} active project(s) with a Director↔VP/AVP overlap.`);
