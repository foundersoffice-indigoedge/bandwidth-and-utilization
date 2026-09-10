import { describe, expect, it } from 'vitest';
import { rebuildHistoricalSnapshot } from '@/lib/historical-snapshot-repair';

describe('rebuildHistoricalSnapshot', () => {
  it('preserves closed-project and former-employee work from stored submissions', () => {
    const result = rebuildHistoricalSnapshot([
      { projectRecordId: 'recClosed', projectName: 'Closed mandate', projectType: 'mandate', hoursPerDay: 2, hoursPerWeek: 12 },
      { projectRecordId: 'pending_old', projectName: 'Historical DDE', projectType: 'dde', hoursPerDay: 3, hoursPerWeek: null },
    ]);

    expect(result.projectBreakdown).toEqual([
      expect.objectContaining({ projectRecordId: 'recClosed', hoursPerWeek: 12 }),
      expect.objectContaining({ projectRecordId: 'pending_old', hoursPerWeek: 18 }),
    ]);
    expect(result.totalHoursPerWeek).toBe(30);
    expect(result.hoursUtilizationPct).toBeCloseTo(30 / 84, 6);
    expect(result.hoursLoadTag).toBe('Comfortable');
  });

  it('retains frozen report annotations for an existing project ID', () => {
    const result = rebuildHistoricalSnapshot(
      [{ projectRecordId: 'recMandate', projectName: 'Acme', projectType: 'mandate', hoursPerDay: 2, hoursPerWeek: 12 }],
      [{ projectRecordId: 'recMandate', projectName: 'Old label', projectType: 'mandate', hoursPerDay: 1, hoursPerWeek: 6, isVpRun: true, leadFellowName: 'Pai', awaitingSignoff: true }],
    );
    expect(result.projectBreakdown[0]).toEqual(expect.objectContaining({
      projectName: 'Acme', hoursPerWeek: 12, isVpRun: true, leadFellowName: 'Pai', awaitingSignoff: true,
    }));
  });
});
