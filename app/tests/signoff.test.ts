import { describe, it, expect, vi } from 'vitest';
import { getDirectorSliceStatus, createSignoffIfReady, type SliceInput } from '../src/lib/signoff';
import type { ProjectAssignment } from '../src/types';

const baseProject = (id: string, overrides: Partial<ProjectAssignment> = {}): ProjectAssignment => ({
  projectRecordId: id,
  projectName: id,
  projectType: 'mandate',
  stage: 'In Production',
  vpAvpIds: [],
  associateIds: [],
  directorIds: [],
  ...overrides,
});

describe('getDirectorSliceStatus', () => {
  it('returns incomplete when a project has a pending token', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'pending' }],
      submissions: [],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('returns complete when all tokens are non-pending and no conflicts on the project', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('returns incomplete when a submission-level conflict on the project is pending', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'pending', source: 'submission' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('ignores resolved conflicts on the project', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'resolved', source: 'submission' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('ignores pending director_flag conflicts (defensive — should not block re-check)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] })],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [{ projectRecordId: 'p1', status: 'pending', source: 'director_flag' }],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('excludes projects with zero submissions (no team to sign off on)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [
        baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] }),
        baseProject('p2', { directorIds: ['recDirector1'], associateIds: [] }),  // no team
      ],
      tokens: [{ projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' }],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });

  it('returns incomplete when director has multiple projects and one has a pending token', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [
        baseProject('p1', { directorIds: ['recDirector1'], associateIds: ['recA'] }),
        baseProject('p2', { directorIds: ['recDirector1'], associateIds: ['recB'] }),
      ],
      tokens: [
        { projectRecordId: 'p1', fellowRecordId: 'recA', status: 'submitted' },
        { projectRecordId: 'p2', fellowRecordId: 'recB', status: 'pending' },
      ],
      submissions: [{ id: 'sub1', projectRecordId: 'p1', fellowRecordId: 'recA' }],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('incomplete');
  });

  it('returns complete when director has no projects in scope (vacuous)', () => {
    const input: SliceInput = {
      directorFellowId: 'recDirector1',
      projects: [baseProject('p1', { directorIds: ['recOther'] })],  // different director
      tokens: [],
      submissions: [],
      conflicts: [],
    };
    expect(getDirectorSliceStatus(input)).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// createSignoffIfReady — DB integration tests (skipped until integration infra exists)
// ---------------------------------------------------------------------------

vi.mock('../src/lib/email', () => ({
  sendDirectorSignoffEmail: vi.fn().mockResolvedValue('msg_test_123'),
  sendDirectorFlagResolutionEmail: vi.fn().mockResolvedValue('msg_flag_123'),
}));

describe('createSignoffIfReady — DB integration', () => {
  it.skip('inserts a signoff row + sends email when slice is complete', async () => {
    // Setup: insert cycle, director fellow, project, submissions with all tokens submitted
    // Call createSignoffIfReady(cycleId, directorFellowId)
    // Assert: 1 row in director_signoffs, status='email_sent', emailMessageId='msg_test_123'
  });

  it.skip('does nothing when slice is incomplete (pending token exists)', async () => {
    // Setup: insert pending token for a fellow on the director's project
    // Call createSignoffIfReady
    // Assert: 0 rows in director_signoffs
  });

  it.skip('idempotency: second call returns { created: false } and does not double-send', async () => {
    // Setup: pre-insert signoff row
    // Call createSignoffIfReady
    // Assert: still 1 row, sendDirectorSignoffEmail not called
  });
});

// ---------------------------------------------------------------------------
// submitFlags — DB integration tests (skipped until integration infra exists)
// ---------------------------------------------------------------------------

describe('submitFlags — DB integration', () => {
  it.skip('inserts conflict rows + flips signoff to flagged within a single transaction', async () => {
    // Setup: signoff row in email_sent + submissions in director's slice
    // Call submitFlags({ signoffToken, flags: [{ submissionId, proposedHoursPerDay: 2 }] })
    // Assert: signoff.status='flagged', 1 conflicts row with source='director_flag'
  });

  it.skip('rejects empty flags array', async () => {
    // Call submitFlags({ signoffToken: 'x', flags: [] })
    // Expect: thrown error 'At least one flag required'
  });

  it.skip('rejects flag with neither proposedHoursPerDay nor comment', async () => {
    // Expect: thrown error about proposed value or comment required
  });

  it.skip('rejects duplicate submissionIds in the flags array', async () => {
    // Expect: thrown error about duplicate flag
  });

  it.skip('rejects submission from outside the director slice', async () => {
    // Expect: thrown error about not in director slice
  });

  it.skip('sends resolution email per flag and stores emailMessageId on conflict row', async () => {
    // Assert: conflicts row has emailMessageId set after submitFlags
  });
});

// ---------------------------------------------------------------------------
// transitionToFlaggedResolved + confirmSignoff — integration tests (skipped)
// ---------------------------------------------------------------------------

describe('transitionToFlaggedResolved — DB integration', () => {
  it.skip('flips signoff to flagged_resolved when last child conflict resolves', async () => {
    // Setup: signoff in flagged + 1 pending conflict row
    // Resolve the conflict
    // Call transitionToFlaggedResolved(signoffId)
    // Assert: signoff.status='flagged_resolved', resolvedAt set
  });

  it.skip('returns false when pending child conflicts still exist', async () => {
    // Setup: signoff in flagged + 2 pending conflict rows
    // Resolve 1 of them
    // Call transitionToFlaggedResolved
    // Assert: returns false, signoff still flagged
  });
});

describe('confirmSignoff — DB integration', () => {
  it.skip('flips email_sent signoff to confirmed', async () => {
    // Setup: signoff in email_sent
    // Call confirmSignoff(token)
    // Assert: { confirmed: true }, confirmedAt set, confirmedBy='director'
  });

  it.skip('returns { confirmed: false } when signoff already confirmed', async () => {
    // Setup: signoff in confirmed
    // Call confirmSignoff again
    // Assert: { confirmed: false }
  });
});
