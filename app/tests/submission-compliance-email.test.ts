import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.APP_URL = 'https://util.test';
  process.env.EMAIL_FROM = 'bandwidth@indigoedge.com';
  process.env.ADMIN_EMAIL = 'ajder@indigoedge.com';
  process.env.CC_EMAIL = 'pai@indigoedge.com';
  process.env.RESEND_API_KEY = 're_test';
});

const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ payload: Record<string, unknown>; options?: Record<string, unknown> }> }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        sent.push({ payload, options });
        return { data: { id: 'msg_compliance' }, error: null };
      },
    };
  },
}));

import {
  buildSubmissionComplianceReportHtml,
  sendSubmissionComplianceReport,
} from '@/lib/email';

const PEOPLE = [
  {
    name: 'Asha',
    designation: 'Associate 2',
    classification: 'both' as const,
    totalMisses: 7,
    category1Streaks: [['2026-08-24', '2026-08-31', '2026-09-07']],
    category2Episodes: [
      ['2026-08-24', '2026-08-31', '2026-09-07'],
      ['2026-09-21', '2026-09-28'],
      ['2026-10-12', '2026-10-19'],
    ],
    currentCheckpointStatus: 'Pending at deadline',
  },
  {
    name: 'Ravi',
    designation: 'AVP',
    classification: 'category_1' as const,
    totalMisses: 3,
    category1Streaks: [['2026-08-24', '2026-08-31', '2026-09-07']],
    category2Episodes: [['2026-08-24', '2026-08-31', '2026-09-07']],
    currentCheckpointStatus: 'Submitted late at 1:04 pm',
  },
  {
    name: 'Mira',
    designation: 'Associate 1',
    classification: 'category_2' as const,
    totalMisses: 6,
    category1Streaks: [],
    category2Episodes: [
      ['2026-08-24', '2026-08-31'],
      ['2026-09-14', '2026-09-21'],
      ['2026-10-05', '2026-10-12'],
    ],
    currentCheckpointStatus: 'Pending at deadline',
  },
];

describe('submission compliance report email', () => {
  it('renders the three exclusive sections in severity order', () => {
    const html = buildSubmissionComplianceReportHtml({ cycleStartDate: '2026-10-19', people: PEOPLE });
    expect(html.replace(/[ \t]+$/gm, '')).toMatchInlineSnapshot(`
      "
          <p>Hi Ajder,</p>
          <p>These people reached a new bandwidth-submission compliance classification at the Monday 1:00 p.m. IST checkpoint on <strong>19 Oct 2026</strong>.</p>

            <h2 style="font-size:16px;margin:28px 0 10px;color:#111827">Both violations</h2>
            <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
              <tr style="background:#f9fafb">
                <th style="padding:10px 12px;text-align:left;font-size:12px">Person</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px">Current position</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px">Violation detail</th>
              </tr>

            <tr>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
                <strong>Asha</strong><br />
                <span style="color:#6b7280;font-size:12px">Associate 2</span>
              </td>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px">
                <strong>7</strong> missed deadlines since cutover<br />
                <span style="color:#6b7280">Current checkpoint: Pending at deadline</span>
              </td>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px">
                <strong>Category 1 streak:</strong> 24 Aug 2026, 31 Aug 2026, 7 Sept 2026<br />
                <strong>Category 2 episodes:</strong> 24 Aug 2026, 31 Aug 2026, 7 Sept 2026 | 21 Sept 2026, 28 Sept 2026 | 12 Oct 2026, 19 Oct 2026
              </td>
            </tr>
            </table>
            <h2 style="font-size:16px;margin:28px 0 10px;color:#111827">Category 1 only</h2>
            <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
              <tr style="background:#f9fafb">
                <th style="padding:10px 12px;text-align:left;font-size:12px">Person</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px">Current position</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px">Violation detail</th>
              </tr>

            <tr>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
                <strong>Ravi</strong><br />
                <span style="color:#6b7280;font-size:12px">AVP</span>
              </td>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px">
                <strong>3</strong> missed deadlines since cutover<br />
                <span style="color:#6b7280">Current checkpoint: Submitted late at 1:04 pm</span>
              </td>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px">
                <strong>Category 1 streak:</strong> 24 Aug 2026, 31 Aug 2026, 7 Sept 2026<br />
                <strong>Category 2 episode:</strong> 24 Aug 2026, 31 Aug 2026, 7 Sept 2026
              </td>
            </tr>
            </table>
            <h2 style="font-size:16px;margin:28px 0 10px;color:#111827">Category 2 only</h2>
            <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
              <tr style="background:#f9fafb">
                <th style="padding:10px 12px;text-align:left;font-size:12px">Person</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px">Current position</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px">Violation detail</th>
              </tr>

            <tr>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
                <strong>Mira</strong><br />
                <span style="color:#6b7280;font-size:12px">Associate 1</span>
              </td>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px">
                <strong>6</strong> missed deadlines since cutover<br />
                <span style="color:#6b7280">Current checkpoint: Pending at deadline</span>
              </td>
              <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px">

                <strong>Category 2 episodes:</strong> 24 Aug 2026, 31 Aug 2026 | 14 Sept 2026, 21 Sept 2026 | 5 Oct 2026, 12 Oct 2026
              </td>
            </tr>
            </table>
          <p style="font-size:12px;color:#6b7280;margin-top:28px">This report records deadline compliance from the configured cutover date. It sends only when somebody's classification changes.</p>
      "
    `);
  });

  it('sends Ajder one email with no CC and a deterministic retry key', async () => {
    sent.length = 0;
    await sendSubmissionComplianceReport({ cycleId: 'cycle-123', cycleStartDate: '2026-10-19', people: PEOPLE });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      payload: {
        to: 'ajder@indigoedge.com',
        subject: 'Bandwidth Submission Compliance Report: 19 Oct 2026',
      },
      options: { idempotencyKey: 'submission-compliance/cycle-123' },
    });
    expect(sent[0].payload.cc).toBeUndefined();
  });
});
