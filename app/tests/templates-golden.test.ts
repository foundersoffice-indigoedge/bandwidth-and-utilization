import { describe, it, expect, vi, beforeAll } from 'vitest';

// Golden-snapshot gate for the U5 template migration. We render every email and
// Slack message on fixed inputs and freeze the exact output. The migration that
// moves subjects / type labels / phrasing into the rules store must leave these
// byte-identical — any drift fails here.

// Stable env BEFORE the modules load (email.ts reads EMAIL_FROM at import).
vi.hoisted(() => {
  process.env.APP_URL = 'https://util.test';
  process.env.EMAIL_FROM = 'bandwidth@indigoedge.com';
  process.env.ADMIN_EMAIL = 'ajder@indigoedge.com';
  process.env.CC_EMAIL = 'pai@indigoedge.com';
  process.env.RESEND_API_KEY = 're_test';
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.test/x';
});

const { sent } = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (p: Record<string, unknown>) => {
        sent.push(p);
        return { data: { id: 'msg_test' }, error: null };
      },
    };
  },
}));

import * as email from '@/lib/email';
import * as slack from '@/lib/slack';
import type { Fellow, ProjectAssignment, SignoffProjectGroup } from '@/types';

const slackTexts: string[] = [];
beforeAll(() => {
  global.fetch = vi.fn(async (_url: unknown, opts: { body: string }) => {
    slackTexts.push(JSON.parse(opts.body).text);
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;
});

const FELLOW: Fellow = { recordId: 'recA', name: 'Asha', email: 'asha@indigoedge.com', designation: 'Associate 2' };
const CYCLE = '2026-05-04';
const PROJECTS: ProjectAssignment[] = [
  { projectRecordId: 'm1', projectName: 'Acme', projectType: 'mandate', stage: 'In Production', vpAvpIds: [], associateIds: [], directorIds: [] },
  { projectRecordId: 'd1', projectName: 'Beta', projectType: 'dde', stage: 'DDE In Progress', vpAvpIds: [], associateIds: [], directorIds: [] },
  { projectRecordId: 'p1', projectName: 'Gamma', projectType: 'pitch', stage: 'Pitch Work in Progress', vpAvpIds: [], associateIds: [], directorIds: [] },
];
const GROUPS: SignoffProjectGroup[] = [
  { projectRecordId: 'm1', projectName: 'Acme', projectType: 'mandate', lines: [{ submissionId: 's1', fellowName: 'Asha', designation: 'Associate 2', hoursPerDay: 4, hoursPerWeek: 24 }] },
  { projectRecordId: 'd1', projectName: 'Beta', projectType: 'dde', lines: [{ submissionId: 's2', fellowName: 'Ravi', designation: 'AVP', hoursPerDay: 1, hoursPerWeek: 6 }] },
  { projectRecordId: 'p1', projectName: 'Gamma', projectType: 'pitch', lines: [{ submissionId: 's3', fellowName: 'Mira', designation: 'Associate 1', hoursPerDay: 2, hoursPerWeek: 12 }] },
];

describe('U5 golden — email senders', () => {
  it('renders all email payloads byte-stable', async () => {
    sent.length = 0;
    await email.sendCollectionEmail(FELLOW, PROJECTS, 'tok1', CYCLE);
    await email.sendReminderEmail(FELLOW, 'tok1', CYCLE);
    await email.sendConflictEmail('Ravi', 'ravi@indigoedge.com', 'Asha', 'asha@indigoedge.com', 'Acme', 5, 3, 'rtok');
    await email.sendConflictResolutionEmail('Ravi', 'ravi@indigoedge.com', 'Asha', 'asha@indigoedge.com', 'Acme', 4, 'associate_number', 'orig1');
    await email.sendConflictResolutionEmail('Ravi', 'ravi@indigoedge.com', 'Asha', 'asha@indigoedge.com', 'Acme', 5, 'vp_number', 'orig1');
    await email.sendConflictResolutionEmail('Ravi', 'ravi@indigoedge.com', 'Asha', 'asha@indigoedge.com', 'Acme', 4.5, 'custom', 'orig1');
    await email.sendConflictReminderEmail('Ravi', 'ravi@indigoedge.com', 'Asha', 'asha@indigoedge.com', 'Acme', 5, 3, 'rtok', 'orig1');
    await email.sendDirectorSignoffEmail({ directorName: 'Dev', directorEmail: 'dev@indigoedge.com', cycleStartDate: CYCLE, signoffToken: 'stok', groups: GROUPS });
    await email.sendDirectorSignoffReminderEmail({ directorName: 'Dev', directorEmail: 'dev@indigoedge.com', cycleStartDate: CYCLE, signoffToken: 'stok', originalMessageId: 'orig1' });
    await email.sendDirectorFlagResolutionEmail({ resolverName: 'Ravi', resolverEmail: 'ravi@indigoedge.com', ccEmails: ['dev@indigoedge.com'], directorName: 'Dev', fellowName: 'Asha', fellowDesignation: 'Associate 2', projectName: 'Acme', projectType: 'mandate', originalHoursPerDay: 4, proposedHoursPerDay: 3, directorComment: 'too high', resolutionToken: 'ftok' });
    await email.sendDirectorFlagResolutionEmail({ resolverName: 'Ravi', resolverEmail: 'ravi@indigoedge.com', ccEmails: ['dev@indigoedge.com'], directorName: 'Dev', fellowName: 'Mira', fellowDesignation: 'Associate 1', projectName: 'Gamma', projectType: 'pitch', originalHoursPerDay: 2, proposedHoursPerDay: null, directorComment: null, resolutionToken: 'ftok' });
    await email.sendDirectorFlagResolutionConfirmationEmail({ resolverEmail: 'ravi@indigoedge.com', ccEmails: ['dev@indigoedge.com'], fellowName: 'Asha', projectName: 'Acme', finalHoursPerDay: 4, action: 'keep_original', originalMessageId: 'orig1' });
    await email.sendDirectorFlagResolutionConfirmationEmail({ resolverEmail: 'ravi@indigoedge.com', ccEmails: ['dev@indigoedge.com'], fellowName: 'Asha', projectName: 'Acme', finalHoursPerDay: 3, action: 'use_proposed', originalMessageId: 'orig1' });
    await email.sendDirectorFlagResolutionConfirmationEmail({ resolverEmail: 'ravi@indigoedge.com', ccEmails: ['dev@indigoedge.com'], fellowName: 'Asha', projectName: 'Acme', finalHoursPerDay: 4.5, action: 'custom', originalMessageId: 'orig1' });
    await email.sendCompletionEmail(CYCLE, 12, 2, [
      { name: 'Asha', designation: 'Associate 2', utilizationPct: 0.5, loadTag: 'Comfortable', projectCount: 3, totalHoursPerWeek: 42 },
      { name: 'Ravi', designation: 'AVP', utilizationPct: 0.95, loadTag: 'At Capacity', projectCount: 5, totalHoursPerWeek: 80 },
    ]);
    // Conflict email where the associate is a VP/AVP performing an associate role.
    await email.sendConflictEmail('Ravi', 'ravi@indigoedge.com', 'Asha', 'asha@indigoedge.com', 'Acme', 5, 3, 'rtok', 'acting as Associate');
    const labeled = sent[sent.length - 1];
    expect(labeled.html).toContain('acting as Associate');
    expect(sent).toMatchSnapshot();
  });
});

describe('U5 golden — slack senders', () => {
  it('renders all slack messages byte-stable', async () => {
    slackTexts.length = 0;
    await slack.postPendingList(['Asha', 'Ravi'], '4 May – 10 May 2026');
    await slack.postRemark('Asha', 'on leave Thursday');
    await slack.postDirectorFlagToSlack({
      directorName: 'Dev',
      cycleDateRange: '4 May – 10 May 2026',
      flags: [
        { projectName: 'Acme', projectType: 'mandate', fellowName: 'Asha', fellowDesignation: 'Associate 2', reportedHoursPerDay: 4, proposedHoursPerDay: 3, directorComment: 'too high', resolverName: 'Ravi' },
        { projectName: 'Gamma', projectType: 'pitch', fellowName: 'Mira', fellowDesignation: 'Associate 1', reportedHoursPerDay: 2, proposedHoursPerDay: null, directorComment: null, resolverName: 'Ravi' },
      ],
    });
    await slack.postNewProject('Delta', 'dde', 'Dev', ['Asha', 'Ravi'], 'Asha', '2026-05-04', 18, 0.21, [{ name: 'Ravi', hoursPerWeek: 12 }]);
    expect(slackTexts).toMatchSnapshot();
  });
});
