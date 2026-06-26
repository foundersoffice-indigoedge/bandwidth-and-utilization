/**
 * peer-bandwidth.ts — pure (no I/O), unit-testable.
 *
 * Assembles per-recipient email models describing teammates' projected load,
 * and builds the HTML for each email. Called from email.ts after a cycle finalizes.
 */

import type { Fellow, ProjectAssignment, ProjectType, LoadTag } from '@/types';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import { WEEKLY_CAPACITY_HOURS, calculateHoursUtilization, getLoadTag } from '@/lib/utilization';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeerProjectRow {
  projectRecordId: string;
  projectName: string;
  projectType: ProjectType;
  stage: string;
  hoursPerWeek: number;
  /** True when the recipient is also on this project. */
  shared: boolean;
}

export type SubmissionStatus = 'submitted' | 'pending';

export interface PeerTeammateModel {
  recordId: string;
  name: string;
  designation: string;
  totalHoursPerWeek: number;
  utilization: number;
  tag: LoadTag;
  projects: PeerProjectRow[];
  /** 'pending' when this fellow has not yet submitted bandwidth for the cycle. */
  submissionStatus: SubmissionStatus;
}

export interface PeerEmailModel {
  recipient: {
    recordId: string;
    name: string;
    email: string;
    totalHoursPerWeek: number;
    utilization: number;
    tag: LoadTag;
    /** 'pending' when the recipient themselves has not yet submitted. */
    submissionStatus: SubmissionStatus;
  };
  teammates: PeerTeammateModel[];
  /** Cycle-level list of eligible fellows who have not submitted (sorted by name). Same on every model. */
  pendingFellowNames: string[];
  dateRange: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a submission's hours to per-week. */
function normalizeHpw(hoursPerWeek: number | null, hoursPerDay: number): number {
  return hoursPerWeek ?? hoursPerDay * WORKING_DAYS_PER_WEEK;
}

/** DB submission row shape (only the fields we consume). */
interface SubmissionRow {
  fellowRecordId: string;
  projectRecordId: string;
  projectName: string;
  projectType: string;
  hoursPerWeek: number | null;
  hoursPerDay: number;
  isSelfReport: boolean;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build per-recipient email models from raw submission + Airtable data.
 *
 * @param allSubmissions  All `submissions` rows for the cycle (any shape with the right fields).
 * @param fellows         Eligible fellows (director-free; from fetchEligibleFellows).
 * @param allProjects     All ProjectAssignment rows (from fetchAllProjects).
 * @param dateRange       Human-readable date string, e.g. "Apr 27 – May 3, 2026".
 * @param pendingFellowIds Record IDs of fellows whose cycle token is still 'pending'.
 *   This is the source of truth for "not yet submitted" — NOT the absence of
 *   submissions — so fellows with no token (no active projects) or marked
 *   `not_needed` are never falsely flagged. Defaults to empty (nobody pending).
 */
export function assemblePeerBandwidthData(
  allSubmissions: SubmissionRow[],
  fellows: Fellow[],
  allProjects: ProjectAssignment[],
  dateRange: string,
  pendingFellowIds: Set<string> = new Set(),
): PeerEmailModel[] {
  const fellowMap = new Map(fellows.map(f => [f.recordId, f]));
  const eligibleIds = new Set(fellows.map(f => f.recordId));

  // --- Build per-fellow load data ---
  interface FellowLoad {
    totalHoursPerWeek: number;
    utilization: number;
    tag: LoadTag;
    projectRecordIds: Set<string>;
    projects: PeerProjectRow[];
    submissionStatus: SubmissionStatus;
  }

  const fellowLoads = new Map<string, FellowLoad>();

  for (const fellow of fellows) {
    const selfSubs = allSubmissions.filter(
      s => s.isSelfReport && s.fellowRecordId === fellow.recordId,
    );
    const submissionStatus: SubmissionStatus = pendingFellowIds.has(fellow.recordId) ? 'pending' : 'submitted';

    const projects: PeerProjectRow[] = selfSubs.map(s => {
      const proj = allProjects.find(p => p.projectRecordId === s.projectRecordId);
      return {
        projectRecordId: s.projectRecordId,
        projectName: s.projectName,
        projectType: s.projectType as ProjectType,
        stage: proj?.stage ?? '',
        hoursPerWeek: normalizeHpw(s.hoursPerWeek, s.hoursPerDay),
        shared: false, // placeholder; filled per-recipient below
      };
    });

    const total = projects.reduce((sum, p) => sum + p.hoursPerWeek, 0);
    const util = calculateHoursUtilization(total);

    fellowLoads.set(fellow.recordId, {
      totalHoursPerWeek: total,
      utilization: util,
      tag: getLoadTag(util),
      projectRecordIds: new Set(projects.map(p => p.projectRecordId)),
      projects,
      submissionStatus,
    });
  }

  // Cycle-level list of eligible fellows with a pending token (sorted by name).
  const pendingFellowNames = fellows
    .filter(f => pendingFellowIds.has(f.recordId))
    .map(f => f.name)
    .sort((a, b) => a.localeCompare(b));

  // --- Build teammate graph ---
  // Two eligible fellows are teammates iff they co-occur in (vpAvpIds ∪ associateIds)
  // of the SAME project. Director slots excluded.
  const teammateMap = new Map<string, Set<string>>();
  for (const fellow of fellows) {
    teammateMap.set(fellow.recordId, new Set());
  }

  for (const proj of allProjects) {
    const participants = [
      ...proj.vpAvpIds.filter(id => eligibleIds.has(id)),
      ...proj.associateIds.filter(id => eligibleIds.has(id)),
    ];
    // deduplicate
    const unique = [...new Set(participants)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        teammateMap.get(unique[i])!.add(unique[j]);
        teammateMap.get(unique[j])!.add(unique[i]);
      }
    }
  }

  // --- Assemble per-recipient models ---
  const models: PeerEmailModel[] = [];

  for (const fellow of fellows) {
    const teammates = [...(teammateMap.get(fellow.recordId) ?? [])];
    if (teammates.length === 0) continue;

    const recipientLoad = fellowLoads.get(fellow.recordId)!;
    const recipientProjectIds = recipientLoad.projectRecordIds;

    const teammateModels: PeerTeammateModel[] = teammates.map(tmId => {
      const tm = fellowMap.get(tmId)!;
      const tmLoad = fellowLoads.get(tmId)!;

      // Build projects with shared flag; shared first, then name asc
      const tmProjects: PeerProjectRow[] = tmLoad.projects
        .map(p => ({ ...p, shared: recipientProjectIds.has(p.projectRecordId) }))
        .sort((a, b) => {
          if (a.shared !== b.shared) return a.shared ? -1 : 1;
          return a.projectName.localeCompare(b.projectName);
        });

      return {
        recordId: tmId,
        name: tm.name,
        designation: tm.designation,
        totalHoursPerWeek: tmLoad.totalHoursPerWeek,
        utilization: tmLoad.utilization,
        tag: tmLoad.tag,
        projects: tmProjects,
        submissionStatus: tmLoad.submissionStatus,
      };
    });

    // Sort teammates: busiest first, tie-break by name asc
    teammateModels.sort((a, b) => {
      if (b.utilization !== a.utilization) return b.utilization - a.utilization;
      return a.name.localeCompare(b.name);
    });

    models.push({
      recipient: {
        recordId: fellow.recordId,
        name: fellow.name,
        email: fellow.email,
        totalHoursPerWeek: recipientLoad.totalHoursPerWeek,
        utilization: recipientLoad.utilization,
        tag: recipientLoad.tag,
        submissionStatus: recipientLoad.submissionStatus,
      },
      teammates: teammateModels,
      pendingFellowNames,
      dateRange,
    });
  }

  return models;
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

const LOAD_TAG_COLORS: Record<string, { bg: string; text: string }> = {
  Free: { bg: '#dcfce7', text: '#166534' },
  Comfortable: { bg: '#dcfce7', text: '#166534' },
  Busy: { bg: '#fef9c3', text: '#854d0e' },
  'At Capacity': { bg: '#fed7aa', text: '#9a3412' },
  Overloaded: { bg: '#fecaca', text: '#991b1b' },
};

function tagBadge(tag: string): string {
  const colors = LOAD_TAG_COLORS[tag] ?? { bg: '#f3f4f6', text: '#374151' };
  return `<span style="background:${colors.bg};color:${colors.text};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${tag}</span>`;
}

const TYPE_LABELS: Record<string, string> = {
  mandate: 'Mandate',
  dde: 'DDE',
  pitch: 'Pitch',
};

/**
 * Build inline-HTML email for a single recipient's peer bandwidth snapshot.
 * Per-week numbers only.
 *
 * @param opts.signoffPending   When true, prepend a "director sign-off pending"
 *   banner (figures are self-reported and may change). Set by the time-trigger
 *   when the email goes out before directors have signed off.
 * @param opts.conflictsPending When true, prepend a "figures still under
 *   resolution" banner — used on the Wednesday fallback, which can send while
 *   VP/self bandwidth conflicts are still open.
 */
export function buildPeerBandwidthEmailHtml(
  model: PeerEmailModel,
  dateRange: string,
  opts: { signoffPending?: boolean; conflictsPending?: boolean } = {},
): string {
  const { recipient, teammates, pendingFellowNames } = model;

  // Banners (sign-off pending + open conflicts + still-awaiting-submissions), shown when relevant.
  const banners: string[] = [];
  if (opts.signoffPending) {
    banners.push(`
    <div style="background:#fffbeb;padding:12px 16px;border-radius:8px;border-left:4px solid #d97706;margin:16px 0">
      <p style="margin:0;font-size:13px;color:#92400e"><strong>Director sign-off still pending.</strong> These figures are self-reported and may change once directors review.</p>
    </div>`);
  }
  if (opts.conflictsPending) {
    banners.push(`
    <div style="background:#fffbeb;padding:12px 16px;border-radius:8px;border-left:4px solid #d97706;margin:16px 0">
      <p style="margin:0;font-size:13px;color:#92400e">Some bandwidth figures are still under resolution and may change.</p>
    </div>`);
  }
  if (pendingFellowNames.length > 0) {
    banners.push(`
    <div style="background:#fef2f2;padding:12px 16px;border-radius:8px;border-left:4px solid #dc2626;margin:16px 0">
      <p style="margin:0;font-size:13px;color:#991b1b">Still awaiting bandwidth from: <strong>${pendingFellowNames.join(', ')}</strong>. Their load isn't reflected below yet.</p>
    </div>`);
  }
  const bannerBlock = banners.join('');

  // Recipient load strip — or a "you haven't submitted" notice if they're pending.
  const recipientStrip = recipient.submissionStatus === 'pending'
    ? `
    <div style="background:#fef2f2;padding:14px 18px;border-radius:8px;border-left:4px solid #dc2626;margin:16px 0">
      <p style="margin:0;font-size:14px;font-weight:600;color:#991b1b">${recipient.name}</p>
      <p style="margin:6px 0 0;font-size:14px;color:#991b1b">You haven't submitted your bandwidth for this week yet.</p>
    </div>`
    : `
    <div style="background:#f0f9ff;padding:14px 18px;border-radius:8px;border-left:4px solid #2563eb;margin:16px 0">
      <p style="margin:0;font-size:14px;font-weight:600;color:#1e40af">${recipient.name}</p>
      <p style="margin:6px 0 0;font-size:14px;color:#374151">
        ${recipient.totalHoursPerWeek.toFixed(1)} hrs/wk &middot; ${Math.round(recipient.utilization * 100)}% of ${WEEKLY_CAPACITY_HOURS}h &middot; ${tagBadge(recipient.tag)}
      </p>
    </div>`;

  // Teammate blocks
  const teammateBlocks = teammates.map(tm => {
    // Pending teammate: compact "not yet submitted" card, no fabricated load/table.
    if (tm.submissionStatus === 'pending') {
      return `
      <div style="margin:24px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#f9fafb;padding:12px 16px">
          <p style="margin:0;font-size:14px;font-weight:600;color:#111827">${tm.name} <span style="font-size:12px;color:#6b7280;font-weight:400">(${tm.designation})</span></p>
          <p style="margin:4px 0 0;font-size:13px;color:#991b1b">Not yet submitted</p>
        </div>
      </div>`;
    }

    const tmPct = Math.round(tm.utilization * 100);
    const tmHpw = tm.totalHoursPerWeek.toFixed(1);

    const projectRows = tm.projects.map((p, i) => {
      const rowBg = p.shared ? '#eff6ff' : (i % 2 === 0 ? '#ffffff' : '#f9fafb');
      const sharedBadge = p.shared
        ? `<span style="background:#dbeafe;color:#1e40af;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:600;margin-left:6px">shared</span>`
        : '';
      const typeLabel = TYPE_LABELS[p.projectType] ?? p.projectType;
      return `<tr style="background:${rowBg}">
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${p.projectName}${sharedBadge}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">${typeLabel} &middot; ${p.stage || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:500">${p.hoursPerWeek.toFixed(1)} h/wk</td>
      </tr>`;
    }).join('');

    return `
      <div style="margin:24px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#f9fafb;padding:12px 16px;border-bottom:1px solid #e5e7eb">
          <p style="margin:0;font-size:14px;font-weight:600;color:#111827">${tm.name} <span style="font-size:12px;color:#6b7280;font-weight:400">(${tm.designation})</span></p>
          <p style="margin:4px 0 0;font-size:13px;color:#374151">
            ${tmHpw} hrs/wk &middot; ${tmPct}% of ${WEEKLY_CAPACITY_HOURS}h &middot; ${tagBadge(tm.tag)}
          </p>
        </div>
        <table style="border-collapse:collapse;width:100%">
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Project</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Type &middot; Stage</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb">Hrs/wk</th>
          </tr>
          ${projectRows}
        </table>
      </div>`;
  }).join('');

  return `
    <p>Hi ${recipient.name},</p>
    <p>Here's a snapshot of your teammates' projected load for the week of <strong>${dateRange}</strong>. Shared projects are highlighted.</p>
    ${bannerBlock}
    <p style="font-weight:700;font-size:14px;margin:24px 0 4px;color:#1f2937">Your projected load</p>
    ${recipientStrip}
    <p style="font-weight:700;font-size:14px;margin:24px 0 4px;color:#1f2937">Your teammates this week</p>
    ${teammateBlocks}
    <p style="font-size:12px;color:#9ca3af;margin-top:32px">This is a read-only snapshot — no action required.</p>
  `;
}
