import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

let _db: NeonHttpDatabase<typeof schema> | null = null;
let _sql: ReturnType<typeof neon> | null = null;

/**
 * Raw Neon access is reserved for guarded multi-query transactions. Drizzle's
 * HTTP adapter is ideal for normal CRUD, while Neon owns the transaction
 * boundary for pending-project reconciliation.
 */
export function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getSql(), { schema });
  }
  return _db;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_, prop) {
    return (getDb() as any)[prop];
  },
});
