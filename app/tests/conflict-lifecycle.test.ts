import { afterEach, describe, expect, it, vi } from 'vitest';
const { mockSelect, mockUpdate } = vi.hoisted(() => ({ mockSelect: vi.fn(), mockUpdate: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { select: mockSelect, update: mockUpdate } }));

import { classifySubmissionConflict, reconcilePendingSubmissionConflicts } from '../src/lib/conflict-lifecycle';
import type { ProjectAssignment } from '../src/types';

const eligible = (id: string) => id === 'vp-current';
const activeProject = (overrides: Partial<ProjectAssignment> = {}): ProjectAssignment => ({
  projectRecordId: 'dde-loadshare',
  projectName: 'LoadShare DDE',
  projectType: 'dde',
  stage: 'DDE Live',
  vpAvpIds: ['vp-current'],
  associateIds: ['associate-current'],
  directorIds: ['director-current'],
  ...overrides,
});
const conflict = (overrides: Record<string, unknown> = {}) => ({
  id: 'conflict-1',
  cycleId: 'cycle-1',
  projectRecordId: 'dde-loadshare',
  source: 'submission' as const,
  status: 'pending' as const,
  vpSubmissionId: 'vp-submission',
  associateSubmissionId: 'associate-submission',
  ...overrides,
});
const rows = (overrides: Record<string, unknown> = {}) => new Map([
  ['vp-submission', {
    id: 'vp-submission', cycleId: 'cycle-1', projectRecordId: 'dde-loadshare',
    fellowRecordId: 'vp-current', isSelfReport: false, targetFellowId: 'associate-current', ...overrides,
  }],
  ['associate-submission', {
    id: 'associate-submission', cycleId: 'cycle-1', projectRecordId: 'dde-loadshare',
    fellowRecordId: 'associate-current', isSelfReport: true, targetFellowId: null,
  }],
]);
const classify = (project: ProjectAssignment | undefined, overrides: Record<string, unknown> = {}) =>
  classifySubmissionConflict(conflict(overrides), rows(), { activeProjects: project ? [project] : [], isEligibleVpAvp: eligible });

describe('submission conflict lifecycle', () => {
  it('keeps an active DDE conflict live even when a resulting Mandate link exists', () => {
    const ddeWithResultingMandate = {
      ...activeProject(),
      resultingMandateId: 'mandate-loadshare',
    } as ProjectAssignment;
    expect(classify(ddeWithResultingMandate)).toBe('active');
  });

  it.each(['completed', 'cancelled', 'paused', 'deleted'])('closes an absent %s project', () => {
    expect(classify(undefined)).toBe('obsolete');
  });

  it('closes a conflict when the current senior has changed', () => {
    expect(classify(activeProject({ vpAvpIds: ['vp-reassigned'] }))).toBe('obsolete');
  });

  it('closes a conflict when the projected fellow leaves the current team', () => {
    expect(classify(activeProject({ associateIds: ['associate-reassigned'] }))).toBe('obsolete');
  });

  it('leaves pending setup conflicts out of Airtable lifecycle reconciliation', () => {
    expect(classify(undefined, { projectRecordId: 'pending_loadshare' })).toBe('active');
  });

  it('keeps incomplete source evidence for review instead of closing it', () => {
    expect(classifySubmissionConflict(
      conflict(),
      new Map(),
      { activeProjects: [], isEligibleVpAvp: eligible },
    )).toBe('ambiguous');
  });

  it('treats a malformed submission relationship as ambiguous', () => {
    expect(classifySubmissionConflict(
      conflict(),
      rows({ targetFellowId: 'another-fellow' }),
      { activeProjects: [activeProject()], isEligibleVpAvp: eligible },
    )).toBe('ambiguous');
  });
});

describe('submission conflict reconciliation', () => {
  afterEach(() => {
    mockSelect.mockReset();
    mockUpdate.mockReset();
  });

  it('closes the terminal LoadShare DDE conflict without touching either submission', async () => {
    const terminalConflict = conflict();
    const submissionRows = [...rows().values()];
    mockSelect
      .mockReturnValueOnce({ from: () => ({ where: async () => [terminalConflict] }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => submissionRows }) });
    mockUpdate.mockReturnValueOnce({
      set: (values: unknown) => {
        expect(values).toEqual({
          status: 'resolved',
          resolvedHoursPerDay: null,
          resolvedBy: 'project_inactive',
        });
        return { where: () => ({ returning: async () => [{ id: 'conflict-1' }] }) };
      },
    });

    const result = await reconcilePendingSubmissionConflicts('cycle-1', {
      activeProjects: [],
      isEligibleVpAvp: eligible,
    });

    expect(result).toEqual({
      resolvedConflictIds: ['conflict-1'], activeConflictIds: [], ambiguousConflictIds: [],
    });
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});
