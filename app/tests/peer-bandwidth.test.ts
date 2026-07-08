import { describe, it, expect } from 'vitest';
import { assemblePeerBandwidthData } from '../src/lib/peer-bandwidth';
import type { Fellow } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fellowA: Fellow = { recordId: 'rA', name: 'Alice', email: 'alice@ie.com', designation: 'VP' };
const fellowB: Fellow = { recordId: 'rB', name: 'Bob', email: 'bob@ie.com', designation: 'Associate 2' };
const fellowC: Fellow = { recordId: 'rC', name: 'Carol', email: 'carol@ie.com', designation: 'Associate 3' };
const directorId = 'rDIR'; // not in the eligible fellows list

const fellows = [fellowA, fellowB, fellowC];

const projects = [
  {
    projectRecordId: 'p1',
    projectName: 'Proj Alpha',
    projectType: 'mandate' as const,
    stage: 'Shortlisting',
    vpAvpIds: ['rA'],
    associateIds: ['rB'],
    directorIds: [directorId],
    isVpRun: false,
  },
  {
    projectRecordId: 'p2',
    projectName: 'Proj Beta',
    projectType: 'dde' as const,
    stage: 'In Progress',
    vpAvpIds: ['rA'],
    associateIds: ['rC'],
    directorIds: [directorId],
    isVpRun: false,
  },
  {
    projectRecordId: 'p3',
    projectName: 'Proj Gamma',
    projectType: 'pitch' as const,
    stage: 'Drafting',
    vpAvpIds: [],
    associateIds: ['rB', 'rC'],
    directorIds: [directorId],
    isVpRun: false,
  },
];

// Submissions: self-reports for each fellow
// Alice: p1=10h/wk, p2=20h/wk → 30h/wk → util = 30/84 ≈ 0.357 → Comfortable
// Bob:   p1=42h/wk, p3=42h/wk → 84h/wk → util = 1.0 → At Capacity
// Carol: p2=6h/day (no hoursPerWeek), p3=12h/wk
//        normalize p2: 6 * 6 = 36h/wk; total = 36+12 = 48h/wk → util = 48/84 ≈ 0.571 → Comfortable
const submissions = [
  { fellowRecordId: 'rA', projectRecordId: 'p1', projectName: 'Proj Alpha', projectType: 'mandate', hoursPerWeek: 10, hoursPerDay: 10 / 6, isSelfReport: true },
  { fellowRecordId: 'rA', projectRecordId: 'p2', projectName: 'Proj Beta',  projectType: 'dde',     hoursPerWeek: 20, hoursPerDay: 20 / 6, isSelfReport: true },
  { fellowRecordId: 'rB', projectRecordId: 'p1', projectName: 'Proj Alpha', projectType: 'mandate', hoursPerWeek: 42, hoursPerDay: 7,       isSelfReport: true },
  { fellowRecordId: 'rB', projectRecordId: 'p3', projectName: 'Proj Gamma', projectType: 'pitch',   hoursPerWeek: 42, hoursPerDay: 7,       isSelfReport: true },
  { fellowRecordId: 'rC', projectRecordId: 'p2', projectName: 'Proj Beta',  projectType: 'dde',     hoursPerWeek: null, hoursPerDay: 6,     isSelfReport: true },
  { fellowRecordId: 'rC', projectRecordId: 'p3', projectName: 'Proj Gamma', projectType: 'pitch',   hoursPerWeek: 12, hoursPerDay: 2,       isSelfReport: true },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assemblePeerBandwidthData', () => {
  it('excludes fellows with 0 teammates from output', () => {
    // Only fellowD has no shared projects with anyone
    const fellowD: Fellow = { recordId: 'rD', name: 'Dave', email: 'dave@ie.com', designation: 'Associate 1' };
    const soloFellows = [...fellows, fellowD];
    const result = assemblePeerBandwidthData(submissions, soloFellows, projects, 'Apr 27 – May 3, 2026');
    const recipientIds = result.map(m => m.recipient.recordId);
    expect(recipientIds).not.toContain('rD');
  });

  it('returns models for all fellows with teammates', () => {
    const result = assemblePeerBandwidthData(submissions, fellows, projects, 'Apr 27 – May 3, 2026');
    const ids = result.map(m => m.recipient.recordId).sort();
    // Alice is teammates with Bob (p1) and Carol (p2); Bob with Alice+Carol; Carol with Alice+Bob
    expect(ids).toEqual(['rA', 'rB', 'rC'].sort());
  });

  it('marks shared projects correctly', () => {
    const result = assemblePeerBandwidthData(submissions, fellows, projects, 'Apr 27 – May 3, 2026');
    const aliceModel = result.find(m => m.recipient.recordId === 'rA')!;
    // Alice shares p1 with Bob
    const bobAsTeammate = aliceModel.teammates.find(t => t.recordId === 'rB')!;
    const sharedProject = bobAsTeammate.projects.find(p => p.projectRecordId === 'p1');
    expect(sharedProject?.shared).toBe(true);
    // Alice does NOT share p3 with Bob
    const notSharedProject = bobAsTeammate.projects.find(p => p.projectRecordId === 'p3');
    expect(notSharedProject?.shared).toBe(false);
  });

  it('sorts teammates busiest-first', () => {
    const result = assemblePeerBandwidthData(submissions, fellows, projects, 'Apr 27 – May 3, 2026');
    const aliceModel = result.find(m => m.recipient.recordId === 'rA')!;
    // Bob: 84h/wk (At Capacity), Carol: 48h/wk (Comfortable)
    expect(aliceModel.teammates[0].recordId).toBe('rB');
    expect(aliceModel.teammates[1].recordId).toBe('rC');
  });

  it('never treats a director-only participant as a teammate', () => {
    // directorId appears only in directorIds[], not in vpAvpIds or associateIds
    const result = assemblePeerBandwidthData(submissions, fellows, projects, 'Apr 27 – May 3, 2026');
    for (const model of result) {
      for (const tm of model.teammates) {
        expect(tm.recordId).not.toBe(directorId);
      }
    }
  });

  it('normalizes per-day hours to per-week when hoursPerWeek is null', () => {
    // Carol's p2 submission: hoursPerWeek=null, hoursPerDay=6 → 6*6=36h/wk
    const result = assemblePeerBandwidthData(submissions, fellows, projects, 'Apr 27 – May 3, 2026');
    // Find Carol as a teammate in someone's model
    const aliceModel = result.find(m => m.recipient.recordId === 'rA')!;
    const carolAsTeammate = aliceModel.teammates.find(t => t.recordId === 'rC')!;
    const p2 = carolAsTeammate.projects.find(p => p.projectRecordId === 'p2')!;
    expect(p2.hoursPerWeek).toBeCloseTo(36, 1);
    expect(carolAsTeammate.totalHoursPerWeek).toBeCloseTo(48, 1);
  });

  it('sorts a teammate projects shared-first then by name', () => {
    const result = assemblePeerBandwidthData(submissions, fellows, projects, 'Apr 27 – May 3, 2026');
    const aliceModel = result.find(m => m.recipient.recordId === 'rA')!;
    const bobAsTeammate = aliceModel.teammates.find(t => t.recordId === 'rB')!;
    // Bob's projects: p1 (shared with Alice) and p3 (not shared)
    expect(bobAsTeammate.projects[0].shared).toBe(true);
    expect(bobAsTeammate.projects[1].shared).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Submission status + pending list (Wednesday fallback: mark who hasn't filled)
// ---------------------------------------------------------------------------

describe('assemblePeerBandwidthData submission status', () => {
  const fellowP: Fellow = { recordId: 'rP', name: 'Priya', email: 'priya@ie.com', designation: 'VP' };
  const fellowQ: Fellow = { recordId: 'rQ', name: 'Quentin', email: 'quentin@ie.com', designation: 'Associate 1' };
  const statusFellows = [fellowP, fellowQ];

  const statusProjects = [
    {
      projectRecordId: 'pX',
      projectName: 'Proj Xray',
      projectType: 'mandate' as const,
      stage: 'Shortlisting',
      vpAvpIds: ['rP'],
      associateIds: ['rQ'],
      directorIds: ['rDIR'],
      isVpRun: false,
    },
  ];

  // Only Priya self-reports; Quentin never submitted.
  const statusSubmissions = [
    { fellowRecordId: 'rP', projectRecordId: 'pX', projectName: 'Proj Xray', projectType: 'mandate', hoursPerWeek: 20, hoursPerDay: 20 / 6, isSelfReport: true },
  ];

  // Status is driven by the cycle's pending TOKENS (passed as a Set of fellow ids),
  // NOT by absence of submissions — so people with no active projects (no token) or
  // toggled `not_needed` are never falsely flagged "Not yet submitted".
  const pendingQuentin = new Set(['rQ']);

  it("marks a fellow with a pending token as 'pending'", () => {
    const result = assemblePeerBandwidthData(statusSubmissions, statusFellows, statusProjects, 'Apr 27 – May 3, 2026', pendingQuentin);
    const priyaModel = result.find(m => m.recipient.recordId === 'rP')!;
    const quentinAsTeammate = priyaModel.teammates.find(t => t.recordId === 'rQ')!;
    expect(quentinAsTeammate.submissionStatus).toBe('pending');
  });

  it("marks a fellow without a pending token as 'submitted'", () => {
    const result = assemblePeerBandwidthData(statusSubmissions, statusFellows, statusProjects, 'Apr 27 – May 3, 2026', pendingQuentin);
    const quentinModel = result.find(m => m.recipient.recordId === 'rQ')!;
    const priyaAsTeammate = quentinModel.teammates.find(t => t.recordId === 'rP')!;
    expect(priyaAsTeammate.submissionStatus).toBe('submitted');
  });

  it('marks the recipient pending when the recipient has a pending token', () => {
    const result = assemblePeerBandwidthData(statusSubmissions, statusFellows, statusProjects, 'Apr 27 – May 3, 2026', pendingQuentin);
    const quentinModel = result.find(m => m.recipient.recordId === 'rQ')!;
    expect(quentinModel.recipient.submissionStatus).toBe('pending');
    const priyaModel = result.find(m => m.recipient.recordId === 'rP')!;
    expect(priyaModel.recipient.submissionStatus).toBe('submitted');
  });

  it('exposes pendingFellowNames from the pending-token set', () => {
    const result = assemblePeerBandwidthData(statusSubmissions, statusFellows, statusProjects, 'Apr 27 – May 3, 2026', pendingQuentin);
    expect(result[0].pendingFellowNames).toEqual(['Quentin']);
  });

  it('leaves pendingFellowNames empty when no token is pending', () => {
    const result = assemblePeerBandwidthData(statusSubmissions, statusFellows, statusProjects, 'Apr 27 – May 3, 2026', new Set());
    expect(result[0].pendingFellowNames).toEqual([]);
  });

  it('does not flag a teammate with no submission but no pending token (e.g. not_needed)', () => {
    // Quentin has no submission, but is NOT in the pending set → treated as submitted.
    const result = assemblePeerBandwidthData(statusSubmissions, statusFellows, statusProjects, 'Apr 27 – May 3, 2026', new Set());
    const priyaModel = result.find(m => m.recipient.recordId === 'rP')!;
    const quentinAsTeammate = priyaModel.teammates.find(t => t.recordId === 'rQ')!;
    expect(quentinAsTeammate.submissionStatus).toBe('submitted');
    expect(priyaModel.pendingFellowNames).toEqual([]);
  });
});

describe('assemblePeerBandwidthData — performed-role label', () => {
  it('labels a VP/AVP in an associate slot "Performing Associate role" without changing designation', () => {
    const otherVp: Fellow = { recordId: 'recOtherVp', name: 'Vik', email: 'vik@ie.com', designation: 'VP' };
    const teammate: Fellow = { recordId: 'recTeammate', name: 'Adit', email: 'adit@ie.com', designation: 'AVP' };
    const localFellows = [otherVp, teammate];
    const localProjects = [
      {
        projectRecordId: 'recShared',
        projectName: 'Shared Mandate',
        projectType: 'mandate' as const,
        stage: 'In Progress',
        vpAvpIds: ['recOtherVp'],       // eligible VP/AVP senior
        associateIds: ['recTeammate'],  // AVP sitting in the associate slot
        directorIds: [],
        isVpRun: false,
      },
    ];
    const subs = [
      { fellowRecordId: 'recOtherVp', projectRecordId: 'recShared', projectName: 'Shared Mandate', projectType: 'mandate', hoursPerWeek: 20, hoursPerDay: 20 / 6, isSelfReport: true },
      { fellowRecordId: 'recTeammate', projectRecordId: 'recShared', projectName: 'Shared Mandate', projectType: 'mandate', hoursPerWeek: 15, hoursPerDay: 15 / 6, isSelfReport: true },
    ];
    const models = assemblePeerBandwidthData(subs, localFellows, localProjects, 'Jul 6 – Jul 12, 2026', new Set());

    const teammateRow = models
      .flatMap(m => m.teammates)
      .find(t => t.recordId === 'recTeammate')!
      .projects.find(p => p.projectRecordId === 'recShared')!;
    expect(teammateRow.performedRoleLabel).toBe('Performing Associate role');

    const tm = models.flatMap(m => m.teammates).find(t => t.recordId === 'recTeammate')!;
    expect(tm.designation).toBe('AVP'); // designation label unchanged

    // The senior (VP in the VP/AVP slot) is NOT acting-as-associate:
    const vpRow = models
      .flatMap(m => m.teammates)
      .find(t => t.recordId === 'recOtherVp')!
      .projects.find(p => p.projectRecordId === 'recShared')!;
    expect(vpRow.performedRoleLabel).toBeNull();
  });

  it('does NOT label a VP/AVP whose project is missing from allProjects (pending / stage-excluded)', () => {
    // Regression: a self-report whose projectRecordId is absent from allProjects
    // (a mid-cycle "pending_" project, or a real project filtered out by the active-stage
    // gate) must NOT be treated as an associate role. The role is unknown, not associate.
    const vp: Fellow = { recordId: 'recVP', name: 'Mitul', email: 'm@ie.com', designation: 'VP' };
    const otherVp: Fellow = { recordId: 'recOther', name: 'Peer', email: 'p@ie.com', designation: 'VP' };
    const localFellows = [vp, otherVp];
    // Only the shared project is in allProjects; the pending + stage-excluded ones are NOT.
    const sharedProj = {
      projectRecordId: 'recShared', projectName: 'Shared', projectType: 'mandate' as const,
      stage: 'In GTM', vpAvpIds: ['recVP', 'recOther'], associateIds: [], directorIds: [], isVpRun: false,
    };
    const subs = [
      { fellowRecordId: 'recVP', projectRecordId: 'recShared', projectName: 'Shared', projectType: 'mandate', hoursPerWeek: 10, hoursPerDay: 10 / 6, isSelfReport: true },
      { fellowRecordId: 'recVP', projectRecordId: 'pending_abc', projectName: 'PlatinumRx', projectType: 'pitch', hoursPerWeek: 5, hoursPerDay: 5 / 6, isSelfReport: true },
      { fellowRecordId: 'recVP', projectRecordId: 'recStaleXYZ', projectName: 'Foxtale', projectType: 'mandate', hoursPerWeek: 3, hoursPerDay: 3 / 6, isSelfReport: true },
      { fellowRecordId: 'recOther', projectRecordId: 'recShared', projectName: 'Shared', projectType: 'mandate', hoursPerWeek: 8, hoursPerDay: 8 / 6, isSelfReport: true },
    ];
    const models = assemblePeerBandwidthData(subs, localFellows, [sharedProj], 'range', new Set());
    const vpProjects = models
      .flatMap(m => m.teammates)
      .filter(t => t.recordId === 'recVP')
      .flatMap(t => t.projects);
    const pending = vpProjects.find(p => p.projectRecordId === 'pending_abc')!;
    const stale = vpProjects.find(p => p.projectRecordId === 'recStaleXYZ')!;
    expect(pending.performedRoleLabel).toBeNull();
    expect(stale.performedRoleLabel).toBeNull();
  });

  it('does NOT label a VP/AVP who was swapped off the project team mid-cycle (found, but not in associateIds)', () => {
    // Regression for the PlatinumRx Pitch case: Murali (VP) reported on the project when he
    // was its VP; the Airtable team was then edited (he was replaced). At peer-email time the
    // project IS found, but he is in neither the VP nor the associate column. resolveProjectRole
    // returns 'associate' by elimination — the label must NOT fire, because he isn't actually
    // in the associate slot.
    const swappedVp: Fellow = { recordId: 'recMurali', name: 'Murali', email: 'mu@ie.com', designation: 'VP' };
    const peer: Fellow = { recordId: 'recPeer', name: 'Peer', email: 'pe@ie.com', designation: 'VP' };
    const localFellows = [swappedVp, peer];
    // Murali is NOT on recPlatinum anymore (a different VP + associate hold the slots), but he
    // co-occurs with `peer` on recShared so he shows up as a teammate.
    const projects = [
      { projectRecordId: 'recShared', projectName: 'Shared', projectType: 'mandate' as const, stage: 'In GTM', vpAvpIds: ['recMurali', 'recPeer'], associateIds: [], directorIds: [], isVpRun: false },
      { projectRecordId: 'recPlatinum', projectName: 'PlatinumRx Pitch', projectType: 'pitch' as const, stage: 'Pitch Work in Progress', vpAvpIds: ['recNewVp'], associateIds: ['recYajur'], directorIds: [], isVpRun: false },
    ];
    const subs = [
      { fellowRecordId: 'recMurali', projectRecordId: 'recShared', projectName: 'Shared', projectType: 'mandate', hoursPerWeek: 10, hoursPerDay: 10 / 6, isSelfReport: true },
      { fellowRecordId: 'recMurali', projectRecordId: 'recPlatinum', projectName: 'PlatinumRx Pitch', projectType: 'pitch', hoursPerWeek: 0, hoursPerDay: 0, isSelfReport: true },
      { fellowRecordId: 'recPeer', projectRecordId: 'recShared', projectName: 'Shared', projectType: 'mandate', hoursPerWeek: 8, hoursPerDay: 8 / 6, isSelfReport: true },
    ];
    const models = assemblePeerBandwidthData(subs, localFellows, projects, 'range', new Set());
    const platinumRow = models
      .flatMap(m => m.teammates)
      .filter(t => t.recordId === 'recMurali')
      .flatMap(t => t.projects)
      .find(p => p.projectRecordId === 'recPlatinum')!;
    expect(platinumRow.performedRoleLabel).toBeNull();
  });
});
