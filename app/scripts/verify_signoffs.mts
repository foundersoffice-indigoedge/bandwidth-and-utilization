import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\\n$/, '');
}
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
const [cycle] = await sql`SELECT id, start_date FROM cycles ORDER BY start_date DESC LIMIT 1` as any[];
const rows = await sql`
  SELECT director_name, director_email, status, created_at, email_message_id
  FROM director_signoffs WHERE cycle_id = ${cycle.id}
  ORDER BY created_at` as any[];
console.log(`Sign-offs for cycle ${cycle.id} (start ${cycle.start_date}):`);
console.table(rows);
