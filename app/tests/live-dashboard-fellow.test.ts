import { describe, expect, it } from 'vitest';
import { buildLiveDashboardFellow } from '../src/lib/live-dashboard-fellow';
import type { ProjectAssignment } from '../src/types';

const activeProjects: ProjectAssignment[] = [];

describe('buildLiveDashboardFellow', () => {
  it('keeps submitted work and remarks after the Airtable project changes', () => {
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
      submissions: [expect.objectContaining({ projectRecordId: 'recExcluded' })],
      excludedProjectCount: 0,
      totalHoursPerWeek: 60,
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
