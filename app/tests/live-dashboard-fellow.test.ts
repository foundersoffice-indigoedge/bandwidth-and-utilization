import { describe, expect, it } from 'vitest';
import { buildLiveDashboardFellow } from '../src/lib/live-dashboard-fellow';
import type { ProjectAssignment } from '../src/types';

const activeProjects: ProjectAssignment[] = [];

describe('buildLiveDashboardFellow', () => {
  it('keeps raw remarks while excluding the project from reconciled submissions', () => {
    const result = buildLiveDashboardFellow(
      [{
        projectRecordId: 'recExcluded',
        hoursPerDay: 10,
        hoursPerWeek: 60,
        remarks: '  Follow up on sector outreach  ',
      }],
      activeProjects,
      'recMe',
      'Associate 1',
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      submissions: [],
      excludedProjectCount: 1,
      totalHoursPerWeek: 0,
      hoursUtilizationPct: 0,
      loadTag: 'Free',
      remarks: 'Follow up on sector outreach',
    });
  });

  it('returns null when the fellow has no raw self-reports', () => {
    expect(buildLiveDashboardFellow(
      [],
      activeProjects,
      'recMe',
      'Associate 1',
    )).toBeNull();
  });
});
