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

export interface PeerTeammateModel {
  recordId: string;
  name: string;
  designation: string;
  totalHoursPerWeek: number;
  utilization: number;
  tag: LoadTag;
  projects: PeerProjectRow[];
}

export interface PeerEmailModel {
  recipient: {
    recordId: string;
    name: string;
    email: string;
    totalHoursPerWeek: number;
    utilization: number;
    tag: LoadTag;
  };
  teammates: PeerTeammateModel[];
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
 */
export function assemblePeerBandwidthData(
  allSubmissions: SubmissionRow[],
  fellows: Fellow[],
  allProjects: ProjectAssignment[],
  dateRange: string,
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
  }

  const fellowLoads = new Map<string, FellowLoad>();

  for (const fellow of fellows) {
    const selfSubs = allSubmissions.filter(
      s => s.isSelfReport && s.fellowRecordId === fellow.recordId,
    );

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
    });
  }

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
      },
      teammates: teammateModels,
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
 */
export function buildPeerBandwidthEmailHtml(model: PeerEmailModel, dateRange: string): string {
  const { recipient, teammates } = model;
  const recipientPct = Math.round(recipient.utilization * 100);
  const recipientHpw = recipient.totalHoursPerWeek.toFixed(1);

  // Recipient load strip
  const recipientStrip = `
    <div style="background:#f0f9ff;padding:14px 18px;border-radius:8px;border-left:4px solid #2563eb;margin:16px 0">
      <p style="margin:0;font-size:14px;font-weight:600;color:#1e40af">${recipient.name}</p>
      <p style="margin:6px 0 0;font-size:14px;color:#374151">
        ${recipientHpw} hrs/wk &middot; ${recipientPct}% of ${WEEKLY_CAPACITY_HOURS}h &middot; ${tagBadge(recipient.tag)}
      </p>
    </div>`;

  // Teammate blocks
  const teammateBlocks = teammates.map(tm => {
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
    <p style="font-weight:700;font-size:14px;margin:24px 0 4px;color:#1f2937">Your projected load</p>
    ${recipientStrip}
    <p style="font-weight:700;font-size:14px;margin:24px 0 4px;color:#1f2937">Your teammates this week</p>
    ${teammateBlocks}
    <p style="font-size:12px;color:#9ca3af;margin-top:32px">This is a read-only snapshot — no action required.</p>
  `;
}
