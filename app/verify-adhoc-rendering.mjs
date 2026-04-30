/**
 * Server-side verification: for each project type (mandate, dde, pitch),
 * inject a synthetic ad-hoc row into the preview cycle, fetch the submit page,
 * confirm the HTML includes the new project + the "Added by you" section,
 * then clean up the injected row. Bypasses /api/add-project so no Slack posts.
 *
 * Run: node verify-adhoc-rendering.mjs <cycleId> <tokenValue>
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

const [cycleId, tokenValue] = [process.argv[2], process.argv[3]];
if (!cycleId || !tokenValue) {
  console.error('Usage: node verify-adhoc-rendering.mjs <cycleId> <tokenValue>');
  process.exit(1);
}

const APP_URL = process.env.APP_URL;
const sql = neon(process.env.DATABASE_URL);

const [tok] = await sql`SELECT fellow_record_id, fellow_name FROM tokens WHERE token = ${tokenValue}`;
if (!tok) {
  console.error('Token not found.');
  process.exit(1);
}
console.log(`Testing as: ${tok.fellow_name} (${tok.fellow_record_id})\n`);

async function check(type, name) {
  // 1. Insert ad-hoc row
  const [adhoc] = await sql`
    INSERT INTO ad_hoc_projects (cycle_id, type, name, director_name, teammate_record_ids, created_by_fellow_id, created_by_fellow_name)
    VALUES (${cycleId}, ${type}, ${name}, 'Test Director', '[]'::jsonb, ${tok.fellow_record_id}, ${tok.fellow_name})
    RETURNING id
  `;
  const adHocId = adhoc.id;
  const projectRecordId = `adhoc_${adHocId}`;

  // 2. Insert matching submission so rendering pulls it into projectBreakdown path
  await sql`
    INSERT INTO submissions (cycle_id, fellow_record_id, project_record_id, project_name, project_type, hours_value, hours_unit, hours_per_day, hours_per_week, auto_score, is_self_report)
    VALUES (${cycleId}, ${tok.fellow_record_id}, ${projectRecordId}, ${name}, ${type}, 2, 'per_day', 2, 12, 0.5, true)
  `;

  // 3. Fetch the submit page
  const res = await fetch(`${APP_URL}/submit/${tokenValue}`);
  const html = await res.text();

  const ok = res.ok;
  const hasProjectName = html.includes(name);
  const hasAdHocSection = html.includes('Added by you / teammates');
  const hasTypeLabel = {
    mandate: html.includes('Mandates'),
    dde: html.includes('DDEs'),
    pitch: html.includes('Pitches'),
  }[type];

  const verdict = ok && hasProjectName && hasAdHocSection ? '✓' : '✗';
  console.log(`${verdict} ${type.toUpperCase().padEnd(8)} "${name}"  http=${res.status} name=${hasProjectName} adhocSection=${hasAdHocSection} typeLabel=${hasTypeLabel}`);

  // 4. Clean up
  await sql`DELETE FROM submissions WHERE cycle_id = ${cycleId} AND project_record_id = ${projectRecordId}`;
  await sql`DELETE FROM ad_hoc_projects WHERE id = ${adHocId}`;

  return ok && hasProjectName && hasAdHocSection;
}

const results = await Promise.all([
  check('mandate', 'Verify Mandate Alpha'),
  check('dde', 'Verify DDE Beta'),
  check('pitch', 'Verify Pitch Gamma'),
]);

console.log('');
if (results.every(r => r)) {
  console.log('All three project types render correctly with ad-hoc injected.');
  process.exit(0);
} else {
  console.error('FAIL: at least one type did not render correctly.');
  process.exit(1);
}
