/**
 * Deletes a preview cycle and all its associated rows in FK-safe order:
 * snapshots → conflicts → submissions → tokens → cycles.
 *
 * Run: node cleanup-preview.mjs <cycleId>
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env.vercel-prod', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    v = v.replace(/\\n$/, '').replace(/\\n/g, '');
    process.env[m[1].trim()] = v;
  }
}

const cycleId = process.argv[2];
if (!cycleId) {
  console.error('Usage: node cleanup-preview.mjs <cycleId>');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const [cycle] = await sql`SELECT id, start_date, status FROM cycles WHERE id = ${cycleId}`;
if (!cycle) {
  console.error(`Cycle ${cycleId} not found.`);
  process.exit(1);
}
console.log(`Deleting cycle ${cycle.id} (start_date=${cycle.start_date}, status=${cycle.status})`);

const snaps = await sql`DELETE FROM snapshots WHERE cycle_id = ${cycleId} RETURNING id`;
console.log(`  snapshots deleted: ${snaps.length}`);

const reminders = await sql`
  DELETE FROM conflict_reminders_sent
  WHERE conflict_id IN (SELECT id FROM conflicts WHERE cycle_id = ${cycleId})
  RETURNING id
`;
console.log(`  conflict_reminders_sent deleted: ${reminders.length}`);

const confs = await sql`DELETE FROM conflicts WHERE cycle_id = ${cycleId} RETURNING id`;
console.log(`  conflicts deleted: ${confs.length}`);

const adhocs = await sql`DELETE FROM ad_hoc_projects WHERE cycle_id = ${cycleId} RETURNING id`;
console.log(`  ad_hoc_projects deleted: ${adhocs.length}`);

const subs = await sql`DELETE FROM submissions WHERE cycle_id = ${cycleId} RETURNING id`;
console.log(`  submissions deleted: ${subs.length}`);

const toks = await sql`DELETE FROM tokens WHERE cycle_id = ${cycleId} RETURNING id`;
console.log(`  tokens deleted: ${toks.length}`);

const cyc = await sql`DELETE FROM cycles WHERE id = ${cycleId} RETURNING id`;
console.log(`  cycles deleted: ${cyc.length}`);

console.log('Done.');
