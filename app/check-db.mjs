import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.vercel-prod', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const sql = neon(process.env.DATABASE_URL);
const cycles = await sql`SELECT id, start_date, status, created_at FROM cycles ORDER BY created_at DESC LIMIT 5`;
console.log('Recent cycles:', JSON.stringify(cycles, null, 2));
const tokens = await sql`SELECT cycle_id, COUNT(*) as tokens, SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) as submitted FROM tokens GROUP BY cycle_id`;
console.log('Tokens by cycle:', JSON.stringify(tokens, null, 2));
const conflicts = await sql`SELECT cycle_id, status, COUNT(*) FROM conflicts GROUP BY cycle_id, status`;
console.log('Conflicts:', JSON.stringify(conflicts, null, 2));
