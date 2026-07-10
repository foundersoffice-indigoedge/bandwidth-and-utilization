import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { snapshots } from '../src/lib/db/schema';

describe('snapshots schema', () => {
  it('stores the durable excluded-project count', () => {
    const columns = getTableColumns(snapshots);
    expect(columns.excludedProjectCount?.name).toBe('excluded_project_count');
    expect(columns.excludedProjectCount?.notNull).toBe(true);
    expect(columns.excludedProjectCount?.hasDefault).toBe(true);
  });
});
