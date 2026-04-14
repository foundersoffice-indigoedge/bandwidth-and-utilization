import { Resend } from 'resend';
import type { ProjectAssignment, Fellow } from '@/types';

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.EMAIL_FROM || 'bandwidth@indigoedge.com';
const testEmailOverride = process.env.TEST_EMAIL_OVERRIDE;

/** When TEST_EMAIL_OVERRIDE is set, redirect all recipients to that address. */
function overrideTo(email: string): string {
  return testEmailOverride || email;
}
function overrideCc(emails: string[]): string[] {
  return testEmailOverride ? emails.map(() => testEmailOverride) : emails;
}

function formatDateRange(startDate: string): string {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return `${start.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// --- Collection Email ---
export async function sendCollectionEmail(
  fellow: Fellow,
  projects: ProjectAssignment[],
  token: string,
  cycleStartDate: string
) {
  const dateRange = formatDateRange(cycleStartDate);
  const projectRows = projects
    .map(p => `<tr><td style="padding:8px;border:1px solid #ddd">${p.projectName}</td><td style="padding:8px;border:1px solid #ddd">${p.projectType.toUpperCase()}</td><td style="padding:8px;border:1px solid #ddd">${p.stage}</td></tr>`)
    .join('');

  await resend.emails.send({
    from,
    to: overrideTo(fellow.email),
    subject: `Bandwidth Update — ${dateRange}`,
    html: `
      <p>Hi ${fellow.name},</p>
      <p>Please submit your bandwidth update for the current cycle (${dateRange}).</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr style="background:#f3f4f6"><th style="padding:8px;border:1px solid #ddd;text-align:left">Project</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Type</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Stage</th></tr>
        ${projectRows}
      </table>
      <a href="${process.env.APP_URL}/submit/${token}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Submit Your Bandwidth</a>
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

  await resend.emails.send({
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
) {
  const appUrl = process.env.APP_URL;

  await resend.emails.send({
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

// --- Completion Report Email ---
export async function sendCompletionEmail(
  cycleStartDate: string,
  submissionCount: number,
  conflictCount: number,
  projectCount: number,
  failures: Array<{ projectName: string; error: string }>
) {
  const dateRange = formatDateRange(cycleStartDate);

  const failureHtml = failures.length > 0
    ? `<p style="color:#dc2626"><strong>Failures:</strong></p><ul>${failures.map(f => `<li>${f.projectName}: ${f.error}</li>`).join('')}</ul>`
    : '';

  await resend.emails.send({
    from,
    to: process.env.ADMIN_EMAIL!,
    subject: `Bandwidth Cycle ${dateRange} — Complete`,
    html: `
      <p>${submissionCount} submissions processed, ${conflictCount} conflicts resolved.</p>
      <p>All ${projectCount} project bandwidth fields updated on Airtable${failures.length > 0 ? ' with some failures' : ' successfully'}.</p>
      ${failureHtml}
    `,
  });
}
