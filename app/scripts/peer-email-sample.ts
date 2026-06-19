/**
 * peer-email-sample.ts
 *
 * Constructs fixture data and renders a sample peer bandwidth email to /tmp/peer-email-sample.html.
 * Pure functions only — no DB, Resend, or network calls.
 *
 * Run: npx tsx scripts/peer-email-sample.ts
 */

import { writeFileSync } from 'fs';
import { assemblePeerBandwidthData, buildPeerBandwidthEmailHtml } from '../src/lib/peer-bandwidth';
import type { Fellow, ProjectAssignment } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture data — ~4 eligible fellows, ~3 overlapping projects, realistic loads
// ---------------------------------------------------------------------------

const fellows: Fellow[] = [
  { recordId: 'f1', name: 'Priya Mehta',    email: 'priya@indigoedge.com',  designation: 'VP' },
  { recordId: 'f2', name: 'Arjun Sharma',   email: 'arjun@indigoedge.com',  designation: 'AVP' },
  { recordId: 'f3', name: 'Sneha Kapoor',   email: 'sneha@indigoedge.com',  designation: 'Associate 3' },
  { recordId: 'f4', name: 'Rohan Verma',    email: 'rohan@indigoedge.com',  designation: 'Associate 1' },
];

const projects: ProjectAssignment[] = [
  {
    projectRecordId: 'proj_alpha',
    projectName: 'Nexus Raise (Series C)',
    projectType: 'mandate',
    stage: 'Shortlisting',
    vpAvpIds: ['f1', 'f2'],
    associateIds: ['f3'],
    directorIds: ['dir1'],
    isVpRun: false,
  },
  {
    projectRecordId: 'proj_beta',
    projectName: 'Orion Tech DDE',
    projectType: 'dde',
    stage: 'Detailed Diligence',
    vpAvpIds: ['f2'],
    associateIds: ['f3', 'f4'],
    directorIds: ['dir1'],
    isVpRun: false,
  },
  {
    projectRecordId: 'proj_gamma',
    projectName: 'Vertex Capital Pitch',
    projectType: 'pitch',
    stage: 'Drafting',
    vpAvpIds: ['f1'],
    associateIds: ['f4'],
    directorIds: [],
    isVpRun: true,
  },
];

// Self-report submissions — realistic distribution:
// Priya: 42 + 36 = 78h/wk → ~93% → Overloaded
// Arjun: 24 + 30 = 54h/wk → ~64% → Busy
// Sneha: 18 + 24 = 42h/wk → 50% → Comfortable
// Rohan: 0h/wk (no isSelfReport subs that match) → actually 12+6=18 → ~21% → Free
const submissions = [
  // Priya
  { fellowRecordId: 'f1', projectRecordId: 'proj_alpha', projectName: 'Nexus Raise (Series C)', projectType: 'mandate', hoursPerWeek: 42,   hoursPerDay: 7,   isSelfReport: true },
  { fellowRecordId: 'f1', projectRecordId: 'proj_gamma', projectName: 'Vertex Capital Pitch',   projectType: 'pitch',   hoursPerWeek: 36,   hoursPerDay: 6,   isSelfReport: true },
  // Arjun
  { fellowRecordId: 'f2', projectRecordId: 'proj_alpha', projectName: 'Nexus Raise (Series C)', projectType: 'mandate', hoursPerWeek: 24,   hoursPerDay: 4,   isSelfReport: true },
  { fellowRecordId: 'f2', projectRecordId: 'proj_beta',  projectName: 'Orion Tech DDE',         projectType: 'dde',     hoursPerWeek: 30,   hoursPerDay: 5,   isSelfReport: true },
  // Sneha
  { fellowRecordId: 'f3', projectRecordId: 'proj_alpha', projectName: 'Nexus Raise (Series C)', projectType: 'mandate', hoursPerWeek: 18,   hoursPerDay: 3,   isSelfReport: true },
  { fellowRecordId: 'f3', projectRecordId: 'proj_beta',  projectName: 'Orion Tech DDE',         projectType: 'dde',     hoursPerWeek: null, hoursPerDay: 4,   isSelfReport: true },  // hoursPerDay=4 → 24h/wk
  // Rohan
  { fellowRecordId: 'f4', projectRecordId: 'proj_beta',  projectName: 'Orion Tech DDE',         projectType: 'dde',     hoursPerWeek: 12,   hoursPerDay: 2,   isSelfReport: true },
  { fellowRecordId: 'f4', projectRecordId: 'proj_gamma', projectName: 'Vertex Capital Pitch',   projectType: 'pitch',   hoursPerWeek: 6,    hoursPerDay: 1,   isSelfReport: true },
];

const DATE_RANGE = 'Jun 16 – Jun 22, 2026';

// ---------------------------------------------------------------------------
// Assemble + render for Arjun (a representative recipient with 3 teammates)
// ---------------------------------------------------------------------------

const models = assemblePeerBandwidthData(submissions, fellows, projects, DATE_RANGE);

const arjunModel = models.find(m => m.recipient.recordId === 'f2');
if (!arjunModel) {
  console.error('ERROR: No model found for Arjun (f2). Check fixture data.');
  process.exit(1);
}

const html = buildPeerBandwidthEmailHtml(arjunModel, DATE_RANGE);

const outputPath = '/tmp/peer-email-sample.html';
writeFileSync(outputPath, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Peer Bandwidth Sample — ${DATE_RANGE}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 680px; margin: 40px auto; color: #111827; line-height: 1.5; }
    p { margin: 0 0 12px; }
  </style>
</head>
<body>
${html}
</body>
</html>
`);

console.log(`Sample written to: ${outputPath}`);
console.log(`Models generated: ${models.length}`);
console.log('Recipients:', models.map(m => `${m.recipient.name} (${m.teammates.length} teammates)`).join(', '));
