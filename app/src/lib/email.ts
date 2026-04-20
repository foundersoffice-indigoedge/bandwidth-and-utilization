import { Resend } from 'resend';
import type { ProjectAssignment, Fellow, ProjectType } from '@/types';

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.EMAIL_FROM || 'bandwidth@indigoedge.com';
const testEmailOverride = process.env.TEST_EMAIL_OVERRIDE;

/** Send an email via Resend, throwing on failure. Returns the Resend message ID. */
async function sendEmail(params: Parameters<typeof resend.emails.send>[0]): Promise<string | undefined> {
  const { data, error } = await resend.emails.send(params);
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data?.id;
}

/** When TEST_EMAIL_OVERRIDE is set, redirect all recipients to that address. */
function overrideTo(email: string): string {
  return testEmailOverride || email;
}
function overrideCc(emails: string[]): string[] {
  return testEmailOverride ? emails.map(() => testEmailOverride) : emails;
}

/** Standard CC list: Pai + Ajder (filtered for blanks). */
function standardCc(): string[] {
  return overrideCc(
    [process.env.CC_EMAIL!, process.env.ADMIN_EMAIL!].filter(Boolean)
  );
}

function formatDateRange(startDate: string): string {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return `${start.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

const TYPE_ORDER: { type: ProjectType; label: string; color: string; bg: string }[] = [
  { type: 'mandate', label: 'Mandates', color: '#1e40af', bg: '#dbeafe' },
  { type: 'dde', label: 'DDEs', color: '#0f766e', bg: '#ccfbf1' },
  { type: 'pitch', label: 'Pitches', color: '#7c3aed', bg: '#ede9fe' },
];

function buildGroupedProjectsHtml(projects: ProjectAssignment[]): string {
  const grouped = new Map<ProjectType, ProjectAssignment[]>();
  for (const p of projects) {
    const list = grouped.get(p.projectType) || [];
    list.push(p);
    grouped.set(p.projectType, list);
  }

  return TYPE_ORDER
    .filter(({ type }) => grouped.has(type))
    .map(({ type, label, color, bg }) => {
      const rows = grouped.get(type)!
        .map((p, i) => {
          const rowBg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
          return `<tr style="background:${rowBg}"><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px">${p.projectName}</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${p.stage}</td></tr>`;
        })
        .join('');
      return `
        <div style="margin:24px 0 16px">
          <p style="font-weight:700;font-size:14px;margin:0 0 8px;color:${color};text-transform:uppercase;letter-spacing:0.5px">${label}</p>
          <table style="border-collapse:collapse;width:100%;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
            <tr style="background:${bg}"><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:${color};border-bottom:2px solid ${color}20">Project</th><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:${color};border-bottom:2px solid ${color}20">Stage</th></tr>
            ${rows}
          </table>
        </div>`;
    })
    .join('');
}

function buildProjectSummaryLine(projects: ProjectAssignment[]): string {
  const counts: Record<string, number> = {};
  for (const p of projects) counts[p.projectType] = (counts[p.projectType] || 0) + 1;
  const parts: string[] = [];
  if (counts.mandate) parts.push(`${counts.mandate} mandate${counts.mandate > 1 ? 's' : ''}`);
  if (counts.dde) parts.push(`${counts.dde} DDE${counts.dde > 1 ? 's' : ''}`);
  if (counts.pitch) parts.push(`${counts.pitch} pitch${counts.pitch > 1 ? 'es' : ''}`);
  return `You have <strong>${projects.length} active project${projects.length !== 1 ? 's' : ''}</strong>: ${parts.join(', ')}.`;
}

// --- Collection Email ---
export async function sendCollectionEmail(
  fellow: Fellow,
  projects: ProjectAssignment[],
  token: string,
  cycleStartDate: string
) {
  const dateRange = formatDateRange(cycleStartDate);
  const sectionsHtml = buildGroupedProjectsHtml(projects);
  const summaryLine = buildProjectSummaryLine(projects);

  await sendEmail({
    from,
    to: overrideTo(fellow.email),
    subject: `Bandwidth Update — ${dateRange}`,
    html: `
      <p>Hi ${fellow.name},</p>
      <p>Please submit your bandwidth update for the current cycle (${dateRange}).</p>
      <p style="background:#f0f9ff;padding:12px 16px;border-radius:8px;border-left:4px solid #2563eb;margin:16px 0">${summaryLine}</p>
      ${sectionsHtml}
      <a href="${process.env.APP_URL}/submit/${token}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px">Submit Your Bandwidth</a>
    `,
  });
}

// --- Reminder Email ---
export async function sendReminderEmail(
  fellow: Fellow,
  token: string,
  cycleStartDate: string
) {
  const dateRange = formatDateRange(cycleStartDate);

  await sendEmail({
    from,
    to: overrideTo(fellow.email),
    subject: 'Reminder: Bandwidth Update Pending',
    html: `
      <p>Hi ${fellow.name},</p>
      <p>Your bandwidth update for ${dateRange} is still pending. Please submit it at your earliest convenience.</p>
      <a href="${process.env.APP_URL}/submit/${token}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Submit Your Bandwidth</a>
    `,
  });
}

// --- Conflict Email ---
export async function sendConflictEmail(
  vpName: string,
  vpEmail: string,
  associateName: string,
  associateEmail: string,
  projectName: string,
  vpHours: number,
  associateHours: number,
  resolutionToken: string
): Promise<string | undefined> {
  const appUrl = process.env.APP_URL;

  return await sendEmail({
    from,
    to: overrideTo(vpEmail),
    cc: overrideCc([associateEmail, process.env.ADMIN_EMAIL!, process.env.CC_EMAIL!].filter(Boolean)),
    subject: `Bandwidth Conflict — ${projectName}`,
    html: `
      <p>Hi ${vpName},</p>
      <p>On <strong>${projectName}</strong>, you reported ${associateName} will spend <strong>${vpHours} hrs/day</strong>, but ${associateName} reported <strong>${associateHours} hrs/day</strong>.</p>
      <p>Please confirm the accurate number:</p>
      <div style="margin:16px 0">
        <a href="${appUrl}/resolve/${resolutionToken}?action=use_associate" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">${associateName}'s number (${associateHours} hrs/day)</a>
        <a href="${appUrl}/resolve/${resolutionToken}?action=use_vp" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">My number (${vpHours} hrs/day)</a>
        <a href="${appUrl}/resolve/${resolutionToken}?action=custom" style="display:inline-block;background:#6b7280;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Enter a different number</a>
      </div>
    `,
  });
}

// --- Conflict Resolution Email (threads with original conflict email) ---
export async function sendConflictResolutionEmail(
  vpName: string,
  vpEmail: string,
  associateName: string,
  associateEmail: string,
  projectName: string,
  resolvedHours: number,
  resolvedBy: string,
  originalMessageId?: string | null,
) {
  let resolverLabel: string;
  if (resolvedBy === 'associate_number') resolverLabel = `${associateName}'s number`;
  else if (resolvedBy === 'vp_number') resolverLabel = `${vpName}'s number`;
  else resolverLabel = 'a custom number';

  const headers: Record<string, string> = {};
  if (originalMessageId) {
    headers['In-Reply-To'] = originalMessageId;
    headers['References'] = originalMessageId;
  }

  await sendEmail({
    from,
    to: overrideTo(vpEmail),
    cc: overrideCc([associateEmail, process.env.ADMIN_EMAIL!, process.env.CC_EMAIL!].filter(Boolean)),
    subject: `Re: Bandwidth Conflict — ${projectName}`,
    headers,
    html: `
      <div style="background:#f0fdf4;padding:16px 20px;border-radius:8px;border-left:4px solid #16a34a;margin:16px 0">
        <p style="margin:0 0 8px;font-weight:600;color:#166534">Conflict Resolved</p>
        <p style="margin:0;font-size:14px">The bandwidth conflict on <strong>${projectName}</strong> has been resolved.</p>
        <p style="margin:8px 0 0;font-size:14px">Final value: <strong>${resolvedHours} hrs/day</strong> (${resolverLabel}).</p>
      </div>
    `,
  });
}

// --- Conflict Reminder Email (threads with original conflict email) ---
export async function sendConflictReminderEmail(
  vpName: string,
  vpEmail: string,
  associateName: string,
  associateEmail: string,
  projectName: string,
  vpHours: number,
  associateHours: number,
  resolutionToken: string,
  originalMessageId: string,
): Promise<string | undefined> {
  const appUrl = process.env.APP_URL;

  return await sendEmail({
    from,
    to: overrideTo(vpEmail),
    cc: overrideCc([associateEmail, process.env.ADMIN_EMAIL!, process.env.CC_EMAIL!].filter(Boolean)),
    subject: `Reminder: Bandwidth Conflict — ${projectName}`,
    headers: {
      'In-Reply-To': originalMessageId,
      'References': originalMessageId,
    },
    html: `
      <div style="background:#fef3c7;padding:16px 20px;border-radius:8px;border-left:4px solid #d97706;margin:16px 0">
        <p style="margin:0 0 8px;font-weight:600;color:#92400e">Conflict Still Pending</p>
        <p style="margin:0;font-size:14px">Hi ${vpName}, the bandwidth conflict on <strong>${projectName}</strong> is still unresolved.</p>
      </div>
      <p>On <strong>${projectName}</strong>, you reported ${associateName} will spend <strong>${vpHours} hrs/day</strong>, but ${associateName} reported <strong>${associateHours} hrs/day</strong>.</p>
      <p>Please resolve:</p>
      <div style="margin:16px 0">
        <a href="${appUrl}/resolve/${resolutionToken}?action=use_associate" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">${associateName}'s number (${associateHours} hrs/day)</a>
        <a href="${appUrl}/resolve/${resolutionToken}?action=use_vp" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">My number (${vpHours} hrs/day)</a>
        <a href="${appUrl}/resolve/${resolutionToken}?action=custom" style="display:inline-block;background:#6b7280;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Enter a different number</a>
      </div>
    `,
  });
}

// --- Completion Report Email ---
export interface FellowSummary {
  name: string;
  designation: string;
  utilizationPct: number;
  loadTag: string;
  projectCount: number;
  totalHoursPerWeek?: number;
}

const LOAD_TAG_COLORS: Record<string, { bg: string; text: string }> = {
  Free: { bg: '#dcfce7', text: '#166534' },
  Comfortable: { bg: '#dcfce7', text: '#166534' },
  Busy: { bg: '#fef9c3', text: '#854d0e' },
  'At Capacity': { bg: '#fed7aa', text: '#9a3412' },
  Overloaded: { bg: '#fecaca', text: '#991b1b' },
};

export async function sendCompletionEmail(
  cycleStartDate: string,
  submissionCount: number,
  conflictCount: number,
  projectCount: number,
  failures: Array<{ projectName: string; error: string }>,
  fellowSummaries: FellowSummary[] = []
) {
  const dateRange = formatDateRange(cycleStartDate);

  const failureHtml = failures.length > 0
    ? `<p style="color:#dc2626"><strong>Failures:</strong></p><ul>${failures.map(f => `<li>${f.projectName}: ${f.error}</li>`).join('')}</ul>`
    : '';

  const fellowRows = fellowSummaries
    .sort((a, b) => b.utilizationPct - a.utilizationPct)
    .map((f, i) => {
      const rowBg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      const pct = Math.round(f.utilizationPct * 100);
      const hpw = f.totalHoursPerWeek != null ? f.totalHoursPerWeek.toFixed(1) : '—';
      const tagColors = LOAD_TAG_COLORS[f.loadTag] || { bg: '#f3f4f6', text: '#374151' };
      return `<tr style="background:${rowBg}">
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:500">${f.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${f.designation}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${hpw} / 84</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:600;text-align:center">${pct}%</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center"><span style="background:${tagColors.bg};color:${tagColors.text};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${f.loadTag}</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">${f.projectCount}</td>
      </tr>`;
    })
    .join('');

  const fellowTableHtml = fellowSummaries.length > 0
    ? `
      <p style="font-weight:700;font-size:15px;margin:24px 0 8px;color:#1f2937">Fellow Utilization</p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <tr style="background:#f3f4f6">
          <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db">Fellow</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db">Role</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db">Hrs/Week</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db">Utilization</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db">Load</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db">Projects</th>
        </tr>
        ${fellowRows}
      </table>`
    : '';

  await sendEmail({
    from,
    to: overrideTo(process.env.ADMIN_EMAIL!),
    cc: standardCc(),
    subject: `Bandwidth Cycle ${dateRange} — Complete`,
    html: `
      <p style="font-size:16px;font-weight:600;margin-bottom:4px">Cycle Complete: ${dateRange}</p>
      <div style="background:#f0fdf4;padding:12px 16px;border-radius:8px;border-left:4px solid #16a34a;margin:16px 0">
        <p style="margin:0;font-size:14px"><strong>${submissionCount}</strong> submissions processed · <strong>${conflictCount}</strong> conflict${conflictCount !== 1 ? 's' : ''} resolved · <strong>${projectCount}</strong> project${projectCount !== 1 ? 's' : ''} written to Airtable${failures.length > 0 ? ' (with failures)' : ''}</p>
      </div>
      ${fellowTableHtml}
      ${failureHtml}
      <p style="margin-top:24px"><a href="${process.env.APP_URL}/dashboard" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">View Dashboard</a></p>
    `,
  });
}
