/**
 * Preview the bandwidth submission form end-to-end.
 *
 * Creates a real cycle + token tied to a VP who has a mix of project types,
 * then emails ajder@indigoedge.com with the live submission link. The form
 * works exactly as it does in production (real DB, real Airtable project
 * data). Submissions will land in the DB — run `cleanup-preview.mjs <cycleId>`
 * afterwards to delete everything.
 *
 * Does NOT call finalizeStaleCycles, so the real Apr 17 cycle is untouched.
 * Does NOT write to Airtable (no project records changed).
 *
 * Run: node preview-bandwidth-form.mjs
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';

const env = readFileSync('.env.vercel-prod', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    v = v.replace(/\\n$/, '').replace(/\\n/g, '');
    process.env[m[1].trim()] = v;
  }
}

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL;
const PREVIEW_TO = 'ajder@indigoedge.com';

const FELLOWS_TABLE = 'tbl2EquvDVwvSaGVy';
const TABLE_CONFIG = {
  mandate: {
    tableId: 'tblETYHFy9FnXG9TH',
    nameField: 'Mandate Name',
    stageField: 'Current Stage of Mandate',
    vpAvpFields: ['Mandate VP / AVP 1', 'Mandate VP / AVP 2'],
    associateFields: ['Mandate Associate 1', 'Mandate Associate 2'],
    activeStages: ['Not Started', 'In Production', 'In GTM', 'In Docs', 'Closing', 'Term Sheet Signed', 'DD Started'],
  },
  dde: {
    tableId: 'tblxyEcXA5piBJKyP',
    nameField: 'DDE Name',
    stageField: 'Current Stage of DDE',
    vpAvpFields: ['DDE VP / AVP'],
    associateFields: ['DDE Associate'],
    activeStages: ['Not Started', 'DDE In Progress'],
  },
  pitch: {
    tableId: 'tblOMIyzJZYUMrJ2N',
    nameField: 'Name',
    stageField: 'Pitch Status',
    vpAvpFields: ['Pitch VP / AVP', 'Pitch VP / AVP 2'],
    associateFields: ['Pitch Associate 1', 'Pitch Associate 2'],
    activeStages: ['Pitch Work in Progress', 'Pitch Done - Awaiting Outcome'],
  },
};

async function fetchAirtable(tableId, params = {}) {
  const results = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}`);
    if (offset) url.searchParams.set('offset', offset);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
    if (!res.ok) throw new Error(`Airtable ${tableId}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    results.push(...data.records);
    offset = data.offset;
  } while (offset);
  return results;
}

async function fetchFellows() {
  const records = await fetchAirtable(FELLOWS_TABLE, {
    filterByFormula: "AND({Current Employee} = 'Yes', {Team} = 'Investment Banking')",
  });
  return records
    .filter(r => ['VP', 'AVP', 'Associate 3', 'Associate 2', 'Associate 1'].includes(r.fields['Designation of Fellow']))
    .map(r => ({
      recordId: r.id,
      name: r.fields['Name of Fellow'],
      email: r.fields['Email ID of Fellow'],
      designation: r.fields['Designation of Fellow'],
    }));
}

async function fetchProjectsByType(type) {
  const cfg = TABLE_CONFIG[type];
  const records = await fetchAirtable(cfg.tableId);
  return records
    .filter(r => cfg.activeStages.includes(r.fields[cfg.stageField] || ''))
    .map(r => {
      const vpAvpIds = cfg.vpAvpFields.flatMap(f => r.fields[f] || []);
      const associateIds = cfg.associateFields.flatMap(f => r.fields[f] || []);
      return {
        recordId: r.id,
        name: r.fields[cfg.nameField],
        stage: r.fields[cfg.stageField] || '',
        type,
        vpAvpIds,
        associateIds,
      };
    });
}

function buildGroupedHtml(projects) {
  const order = [
    { type: 'mandate', label: 'Mandates', color: '#1e40af', bg: '#dbeafe' },
    { type: 'dde', label: 'DDEs', color: '#0f766e', bg: '#ccfbf1' },
    { type: 'pitch', label: 'Pitches', color: '#7c3aed', bg: '#ede9fe' },
  ];
  return order
    .filter(({ type }) => projects.some(p => p.type === type))
    .map(({ type, label, color, bg }) => {
      const rows = projects
        .filter(p => p.type === type)
        .map((p, i) => {
          const rowBg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
          return `<tr style="background:${rowBg}"><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px">${p.name}</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${p.stage}</td></tr>`;
        })
        .join('');
      return `<div style="margin:24px 0 16px"><p style="font-weight:700;font-size:14px;margin:0 0 8px;color:${color};text-transform:uppercase;letter-spacing:0.5px">${label}</p><table style="border-collapse:collapse;width:100%;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb"><tr style="background:${bg}"><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:${color};border-bottom:2px solid ${color}20">Project</th><th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:${color};border-bottom:2px solid ${color}20">Stage</th></tr>${rows}</table></div>`;
    })
    .join('');
}

function buildSummaryLine(projects) {
  const counts = {};
  for (const p of projects) counts[p.type] = (counts[p.type] || 0) + 1;
  const parts = [];
  if (counts.mandate) parts.push(`${counts.mandate} mandate${counts.mandate > 1 ? 's' : ''}`);
  if (counts.dde) parts.push(`${counts.dde} DDE${counts.dde > 1 ? 's' : ''}`);
  if (counts.pitch) parts.push(`${counts.pitch} pitch${counts.pitch > 1 ? 'es' : ''}`);
  return `You have <strong>${projects.length} active project${projects.length !== 1 ? 's' : ''}</strong>: ${parts.join(', ')}.`;
}

function formatDateRange(startDate) {
  const start = new Date(startDate);
  const refMonday = new Date('2026-04-27');
  const nextStart = start.getTime() < refMonday.getTime()
    ? refMonday
    : new Date(start.getTime() + 7 * 86400000);
  const end = new Date(nextStart.getTime() - 86400000);
  const fmt = (d, y) => d.toLocaleDateString('en-IN', y ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'bandwidth@indigoedge.com',
      to,
      subject,
      html,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Resend: ${JSON.stringify(body)}`);
  return body.id;
}

// ─── main ───

const fellows = await fetchFellows();
const [mandates, ddes, pitches] = await Promise.all([
  fetchProjectsByType('mandate'),
  fetchProjectsByType('dde'),
  fetchProjectsByType('pitch'),
]);
const allProjects = [...mandates, ...ddes, ...pitches];

// Pick a VP with a good mix of project types so the form shows everything.
const candidates = fellows
  .filter(f => f.designation === 'VP')
  .map(f => {
    const theirs = allProjects.filter(p => p.vpAvpIds.includes(f.recordId) || p.associateIds.includes(f.recordId));
    const typeCount = new Set(theirs.map(p => p.type)).size;
    return { fellow: f, projects: theirs, typeCount, total: theirs.length };
  })
  .filter(c => c.total >= 2)
  .sort((a, b) => b.typeCount - a.typeCount || b.total - a.total);

if (candidates.length === 0) {
  console.error('No VP candidate with multiple projects found. Aborting.');
  process.exit(1);
}

const { fellow, projects } = candidates[0];
console.log(`Chosen fellow for preview: ${fellow.name} (${fellow.designation}) with ${projects.length} projects across ${new Set(projects.map(p => p.type)).size} type(s)`);

const sql = neon(process.env.DATABASE_URL);

const today = new Date().toISOString().split('T')[0];
const [cycle] = await sql`INSERT INTO cycles (start_date) VALUES (${today}) RETURNING id, start_date`;
console.log(`Created preview cycle: ${cycle.id} (start_date=${cycle.start_date})`);

const token = randomUUID();
await sql`
  INSERT INTO tokens (cycle_id, fellow_record_id, fellow_name, fellow_email, fellow_designation, token)
  VALUES (${cycle.id}, ${fellow.recordId}, ${fellow.name}, ${PREVIEW_TO}, ${fellow.designation}, ${token})
`;
console.log(`Created token: ${token}`);

const dateRange = formatDateRange(today);
const html = `
  <p>Hi ${fellow.name} (preview for Ajder),</p>
  <p>Please submit your bandwidth update for the current cycle (${dateRange}).</p>
  <p style="background:#fef3c7;padding:10px 14px;border-radius:8px;border-left:4px solid #d97706;margin:12px 0;font-size:13px">
    <strong>This is a preview.</strong> The form is fully functional (real projects, real DB).
    All data will be deleted after you're done.
  </p>
  <p style="background:#f0f9ff;padding:12px 16px;border-radius:8px;border-left:4px solid #2563eb;margin:16px 0">${buildSummaryLine(projects)}</p>
  ${buildGroupedHtml(projects.map(p => ({ name: p.name, stage: p.stage, type: p.type })))}
  <a href="${APP_URL}/submit/${token}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px">Submit Your Bandwidth</a>
`;

const messageId = await sendEmail(PREVIEW_TO, `[PREVIEW] Bandwidth Update — ${dateRange}`, html);
console.log(`Email sent to ${PREVIEW_TO}. Message ID: ${messageId}`);
console.log('');
console.log('=== Preview ready ===');
console.log(`Form URL: ${APP_URL}/submit/${token}`);
console.log(`Cycle ID (keep this for cleanup): ${cycle.id}`);
console.log('');
console.log(`When done, run:  node cleanup-preview.mjs ${cycle.id}`);
