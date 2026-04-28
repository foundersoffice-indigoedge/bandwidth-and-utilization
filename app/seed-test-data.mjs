/**
 * Seed script: inserts realistic test data for dashboard preview.
 * Creates 13 biweekly cycles (Oct 2025 - Apr 2026) with snapshots
 * for 10 real IE fellows (using rec_test_ prefixed IDs for safe cleanup).
 *
 * Run:   node seed-test-data.mjs
 * Clean: node seed-test-data.mjs --clean
 *
 * ALL test data uses fellowRecordId starting with 'rec_test_' so cleanup
 * is a single DELETE WHERE fellow_record_id LIKE 'rec_test_%'.
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';

// Load .env.local manually (no dotenv dependency)
const envFile = readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
}

const sql = neon(process.env.DATABASE_URL);

const CLEAN = process.argv.includes('--clean');

const WEEKLY_CAPACITY_HOURS = 84;
const WORKING_DAYS_PER_WEEK = 6;

// ─── Fellow profiles (real names/designations from Airtable) ───

const FELLOWS = [
  { id: 'rec_test_mitul',    name: 'Mitul Gupta',        designation: 'VP' },
  { id: 'rec_test_nihar',    name: 'Nihar Dighe',        designation: 'Associate 3' },
  { id: 'rec_test_vishnu',   name: 'Vishnu Ramesh',      designation: 'VP' },
  { id: 'rec_test_tanya',    name: 'Tanya Shahi',        designation: 'AVP' },
  { id: 'rec_test_harshal',  name: 'Harshal Bhatia',     designation: 'Associate 3' },
  { id: 'rec_test_aditi',    name: 'Aditi Thakur',       designation: 'Associate 2' },
  { id: 'rec_test_shan',     name: 'Shan T',             designation: 'VP' },
  { id: 'rec_test_murali',   name: 'Murali Dhananjey',   designation: 'AVP' },
  { id: 'rec_test_gitansh',  name: 'Gitansh Aggarwal',   designation: 'Associate 2' },
  { id: 'rec_test_manjeet',  name: 'Manjeet Singh',      designation: 'Associate 1' },
];

// ─── Scoring (matches app/src/lib/scoring.ts for mandate type) ───

function scoreMandate(hpd) {
  if (hpd < 1.5) return 1;
  if (hpd < 3.0) return 2;
  if (hpd < 5.0) return 3;
  if (hpd < 7.0) return 4;
  return 5;
}

function getLoadTag(util) {
  if (util < 0.30) return 'Free';
  if (util < 0.60) return 'Comfortable';
  if (util < 0.85) return 'Busy';
  if (util <= 1.00) return 'At Capacity';
  return 'Overloaded';
}

// ─── Cycle dates (biweekly Mondays, Oct 2025 - Apr 2026) ───

const CYCLE_DATES = [
  '2025-10-06', '2025-10-20',
  '2025-11-03', '2025-11-17',
  '2025-12-01', '2025-12-15',
  '2026-01-05', '2026-01-19',
  '2026-02-02', '2026-02-16',
  '2026-03-02', '2026-03-16',
  '2026-04-06',
];

// ─── Per-fellow workloads across 13 cycles ───
// Each fellow has an array of 13 workloads (one per cycle).
// Each workload is an array of { name, type, hpd } objects.

const WORKLOADS = {
  rec_test_mitul: [
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 3.0 }, { name: 'HomeRun', type: 'mandate', hpd: 2.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 3.0 }, { name: 'HomeRun', type: 'mandate', hpd: 2.0 }, { name: 'Wint Wealth', type: 'mandate', hpd: 1.5 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 4.0 }, { name: 'HomeRun', type: 'mandate', hpd: 2.5 }, { name: 'Wint Wealth', type: 'mandate', hpd: 2.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 4.0 }, { name: 'HomeRun', type: 'mandate', hpd: 3.0 }, { name: 'Wint Wealth', type: 'mandate', hpd: 2.5 }, { name: 'Pepper Content', type: 'dde', hpd: 1.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 5.0 }, { name: 'HomeRun', type: 'mandate', hpd: 3.0 }, { name: 'Wint Wealth', type: 'mandate', hpd: 2.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 2.0 }, { name: 'HomeRun', type: 'mandate', hpd: 3.0 }, { name: 'Wint Wealth', type: 'mandate', hpd: 2.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 3.0 }, { name: 'Wint Wealth', type: 'mandate', hpd: 2.0 }, { name: 'Chargebee', type: 'pitch', hpd: 1.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.5 }, { name: 'Wint Wealth', type: 'mandate', hpd: 2.0 }, { name: 'Rocketlane', type: 'dde', hpd: 2.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 4.0 }, { name: 'Wint Wealth', type: 'mandate', hpd: 3.0 }, { name: 'Univest', type: 'mandate', hpd: 2.0 }, { name: 'Rocketlane', type: 'dde', hpd: 1.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 3.5 }, { name: 'Wint Wealth', type: 'mandate', hpd: 3.0 }, { name: 'Univest', type: 'mandate', hpd: 2.5 }, { name: 'Rocketlane', type: 'dde', hpd: 1.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.0 }, { name: 'Univest', type: 'mandate', hpd: 3.0 }, { name: 'MoEngage', type: 'pitch', hpd: 1.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 3.0 }, { name: 'MoEngage', type: 'pitch', hpd: 1.5 }],
    [{ name: 'Univest', type: 'mandate', hpd: 4.0 }, { name: 'BrowserStack', type: 'mandate', hpd: 2.0 }, { name: 'Toplyne', type: 'dde', hpd: 1.0 }],
  ],
  rec_test_nihar: [
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 2.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 2.5 }, { name: 'Pepper Content', type: 'dde', hpd: 1.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 3.0 }, { name: 'Pepper Content', type: 'dde', hpd: 1.5 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 3.5 }, { name: 'Pepper Content', type: 'dde', hpd: 2.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 4.0 }, { name: 'Pepper Content', type: 'dde', hpd: 2.5 }, { name: 'Chargebee', type: 'pitch', hpd: 1.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 3.0 }, { name: 'Pepper Content', type: 'dde', hpd: 2.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.0 }, { name: 'Rocketlane', type: 'dde', hpd: 1.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.5 }, { name: 'Rocketlane', type: 'dde', hpd: 2.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 3.0 }, { name: 'Univest', type: 'mandate', hpd: 2.0 }, { name: 'Rocketlane', type: 'dde', hpd: 2.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 3.5 }, { name: 'Univest', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 2.5 }, { name: 'MoEngage', type: 'pitch', hpd: 1.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 3.0 }, { name: 'BrowserStack', type: 'mandate', hpd: 1.5 }, { name: 'Toplyne', type: 'dde', hpd: 1.0 }],
  ],
  rec_test_vishnu: [
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.5 }, { name: 'Yellow.ai', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 4.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 4.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }, { name: 'CleverTap', type: 'pitch', hpd: 1.5 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 5.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 3.5 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 4.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }, { name: 'Haptik', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.5 }, { name: 'Haptik', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 4.0 }, { name: 'Haptik', type: 'mandate', hpd: 3.0 }, { name: 'Toplyne', type: 'dde', hpd: 1.0 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.5 }, { name: 'Haptik', type: 'mandate', hpd: 3.0 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 4.0 }, { name: 'CleverTap', type: 'pitch', hpd: 2.0 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 3.0 }, { name: 'Wint Wealth', type: 'mandate', hpd: 1.5 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 3.5 }, { name: 'Wint Wealth', type: 'mandate', hpd: 2.0 }, { name: 'MoEngage', type: 'pitch', hpd: 1.0 }],
  ],
  rec_test_tanya: [
    [{ name: 'Pepper Content', type: 'dde', hpd: 2.0 }],
    [{ name: 'Pepper Content', type: 'dde', hpd: 2.5 }, { name: 'Chargebee', type: 'pitch', hpd: 1.0 }],
    [{ name: 'Pepper Content', type: 'dde', hpd: 3.0 }, { name: 'Chargebee', type: 'pitch', hpd: 1.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.0 }, { name: 'Pepper Content', type: 'dde', hpd: 2.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 3.0 }, { name: 'Pepper Content', type: 'dde', hpd: 2.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.5 }, { name: 'Rocketlane', type: 'dde', hpd: 1.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 3.0 }, { name: 'Rocketlane', type: 'dde', hpd: 2.0 }, { name: 'MoEngage', type: 'pitch', hpd: 1.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 4.0 }, { name: 'Rocketlane', type: 'dde', hpd: 2.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 4.5 }, { name: 'Rocketlane', type: 'dde', hpd: 3.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 3.0 }, { name: 'Univest', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 3.0 }, { name: 'Toplyne', type: 'dde', hpd: 1.5 }],
    [{ name: 'Univest', type: 'mandate', hpd: 2.5 }, { name: 'Toplyne', type: 'dde', hpd: 2.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 3.0 }, { name: 'BrowserStack', type: 'mandate', hpd: 1.5 }, { name: 'Toplyne', type: 'dde', hpd: 1.5 }],
  ],
  rec_test_harshal: [
    [{ name: 'Zuddl', type: 'mandate', hpd: 2.5 }, { name: 'CleverTap', type: 'pitch', hpd: 1.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.0 }, { name: 'CleverTap', type: 'pitch', hpd: 1.5 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.5 }, { name: 'CleverTap', type: 'pitch', hpd: 2.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 4.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 1.5 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.5 }, { name: 'Yellow.ai', type: 'mandate', hpd: 2.0 }, { name: 'Pepper Content', type: 'dde', hpd: 1.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 2.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }, { name: 'Rocketlane', type: 'dde', hpd: 1.0 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.5 }, { name: 'Rocketlane', type: 'dde', hpd: 1.5 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }, { name: 'Haptik', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 3.0 }, { name: 'MoEngage', type: 'pitch', hpd: 2.0 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 2.5 }, { name: 'MoEngage', type: 'pitch', hpd: 1.5 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 3.0 }, { name: 'BrowserStack', type: 'mandate', hpd: 1.5 }],
  ],
  rec_test_aditi: [
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 2.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 2.5 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 3.0 }, { name: 'Chargebee', type: 'pitch', hpd: 1.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 3.5 }, { name: 'Chargebee', type: 'pitch', hpd: 1.5 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 4.0 }, { name: 'Pepper Content', type: 'dde', hpd: 1.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 2.0 }, { name: 'Rocketlane', type: 'dde', hpd: 1.5 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 2.5 }, { name: 'Rocketlane', type: 'dde', hpd: 2.0 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 3.0 }, { name: 'Univest', type: 'mandate', hpd: 1.5 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 3.5 }, { name: 'Univest', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Univest', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 3.0 }, { name: 'Toplyne', type: 'dde', hpd: 1.0 }],
  ],
  rec_test_shan: [
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 3.0 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 3.5 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 4.0 }, { name: 'CleverTap', type: 'pitch', hpd: 1.0 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 3.0 }, { name: 'SaaS Labs', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 3.5 }, { name: 'SaaS Labs', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 2.0 }, { name: 'SaaS Labs', type: 'mandate', hpd: 1.5 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 2.0 }],
    [{ name: 'SaaS Labs', type: 'mandate', hpd: 2.5 }, { name: 'Toplyne', type: 'dde', hpd: 1.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.0 }, { name: 'Toplyne', type: 'dde', hpd: 1.5 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.5 }, { name: 'Toplyne', type: 'dde', hpd: 2.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.0 }, { name: 'BrowserStack', type: 'mandate', hpd: 1.5 }],
  ],
  rec_test_murali: [
    [{ name: 'Haptik', type: 'mandate', hpd: 2.0 }, { name: 'Pepper Content', type: 'dde', hpd: 1.5 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 2.5 }, { name: 'Pepper Content', type: 'dde', hpd: 2.0 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 3.0 }, { name: 'Pepper Content', type: 'dde', hpd: 2.5 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 3.0 }, { name: 'Rocketlane', type: 'dde', hpd: 2.0 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 2.5 }, { name: 'Rocketlane', type: 'dde', hpd: 2.5 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 2.0 }, { name: 'Rocketlane', type: 'dde', hpd: 1.5 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 2.0 }, { name: 'Toplyne', type: 'dde', hpd: 2.0 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 2.5 }, { name: 'Toplyne', type: 'dde', hpd: 2.5 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }, { name: 'Toplyne', type: 'dde', hpd: 2.0 }, { name: 'CleverTap', type: 'pitch', hpd: 1.0 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.5 }, { name: 'Toplyne', type: 'dde', hpd: 2.0 }],
    [{ name: 'BrowserStack', type: 'mandate', hpd: 2.0 }, { name: 'Toplyne', type: 'dde', hpd: 1.5 }],
    [{ name: 'BrowserStack', type: 'mandate', hpd: 2.5 }, { name: 'Toplyne', type: 'dde', hpd: 1.0 }],
    [{ name: 'BrowserStack', type: 'mandate', hpd: 3.0 }, { name: 'Wint Wealth', type: 'mandate', hpd: 1.5 }],
  ],
  rec_test_gitansh: [
    [{ name: 'Zuddl', type: 'mandate', hpd: 2.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 1.5 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 2.5 }, { name: 'Yellow.ai', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 2.5 }, { name: 'CleverTap', type: 'pitch', hpd: 1.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 3.5 }, { name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 4.0 }, { name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }],
    [{ name: 'Zuddl', type: 'mandate', hpd: 2.5 }, { name: 'Yellow.ai', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 3.0 }, { name: 'Haptik', type: 'mandate', hpd: 1.5 }],
    [{ name: 'Yellow.ai', type: 'mandate', hpd: 2.5 }, { name: 'Haptik', type: 'mandate', hpd: 2.0 }, { name: 'Rocketlane', type: 'dde', hpd: 1.0 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 3.0 }, { name: 'Univest', type: 'mandate', hpd: 2.0 }, { name: 'MoEngage', type: 'pitch', hpd: 1.5 }],
    [{ name: 'Haptik', type: 'mandate', hpd: 3.5 }, { name: 'Univest', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Univest', type: 'mandate', hpd: 3.0 }, { name: 'BrowserStack', type: 'mandate', hpd: 1.0 }],
    [{ name: 'Univest', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Univest', type: 'mandate', hpd: 3.0 }, { name: 'BrowserStack', type: 'mandate', hpd: 2.0 }],
  ],
  rec_test_manjeet: [
    [{ name: 'HomeRun', type: 'mandate', hpd: 1.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.0 }, { name: 'Pepper Content', type: 'dde', hpd: 1.0 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 2.5 }, { name: 'Pepper Content', type: 'dde', hpd: 1.5 }],
    [{ name: 'HomeRun', type: 'mandate', hpd: 1.5 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 2.0 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 2.5 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 3.0 }, { name: 'Toplyne', type: 'dde', hpd: 1.0 }],
    [{ name: 'Wint Wealth', type: 'mandate', hpd: 2.5 }],
    [{ name: 'BrowserStack', type: 'mandate', hpd: 1.5 }],
    [{ name: 'BrowserStack', type: 'mandate', hpd: 2.0 }],
    [{ name: 'BrowserStack', type: 'mandate', hpd: 2.5 }, { name: 'Zuddl', type: 'mandate', hpd: 1.0 }],
  ],
};

// ─── Build snapshot from fellow + workload ───

function buildSnapshot(fellow, cycleId, cycleDate, workload) {
  const breakdown = workload.map(w => ({
    projectName: w.name,
    projectType: w.type,
    score: scoreMandate(w.hpd),
    hoursPerDay: w.hpd,
    hoursPerWeek: w.hpd * WORKING_DAYS_PER_WEEK,
  }));

  const totalHpw = breakdown.reduce((sum, b) => sum + b.hoursPerWeek, 0);
  const utilPct = totalHpw / WEEKLY_CAPACITY_HOURS;

  return {
    id: randomUUID(),
    cycleId,
    fellowRecordId: fellow.id,
    fellowName: fellow.name,
    designation: fellow.designation,
    projectBreakdown: JSON.stringify(breakdown),
    snapshotDate: cycleDate,
    totalHoursPerWeek: totalHpw,
    hoursUtilizationPct: utilPct,
    hoursLoadTag: getLoadTag(utilPct),
  };
}

// ─── Clean ───

async function clean() {
  console.log('Cleaning test data...');
  const snapResult = await sql`DELETE FROM snapshots WHERE fellow_record_id LIKE 'rec_test_%'`;
  console.log(`  Deleted ${snapResult.length || 'all matching'} snapshot rows`);
  const cycleResult = await sql`DELETE FROM cycles WHERE start_date = ANY(${CYCLE_DATES}::date[])`;
  console.log(`  Deleted ${cycleResult.length || 'all matching'} cycle rows`);
  console.log('Done. Database is clean.');
}

// ─── Seed ───

async function seed() {
  console.log(`Seeding test data for ${FELLOWS.length} fellows across ${CYCLE_DATES.length} cycles...\n`);

  const cycleIds = [];
  for (const d of CYCLE_DATES) {
    const id = randomUUID();
    await sql`INSERT INTO cycles (id, start_date, status) VALUES (${id}, ${d}, 'complete')`;
    cycleIds.push(id);
  }
  console.log(`Created ${cycleIds.length} cycles (${CYCLE_DATES[0]} to ${CYCLE_DATES.at(-1)})`);

  let totalSnapshots = 0;
  for (const fellow of FELLOWS) {
    const workloads = WORKLOADS[fellow.id];
    let fellowSnaps = 0;
    for (let i = 0; i < CYCLE_DATES.length; i++) {
      const s = buildSnapshot(fellow, cycleIds[i], CYCLE_DATES[i], workloads[i]);
      await sql`INSERT INTO snapshots (id, cycle_id, fellow_record_id, fellow_name, designation, project_breakdown, snapshot_date, total_hours_per_week, hours_utilization_pct, hours_load_tag)
        VALUES (${s.id}, ${s.cycleId}, ${s.fellowRecordId}, ${s.fellowName}, ${s.designation}, ${s.projectBreakdown}::jsonb, ${s.snapshotDate}, ${s.totalHoursPerWeek}, ${s.hoursUtilizationPct}, ${s.hoursLoadTag})`;
      fellowSnaps++;
    }
    console.log(`  ${fellow.name} (${fellow.designation}) - ${fellowSnaps} snapshots`);
    totalSnapshots += fellowSnaps;
  }

  console.log(`\nTotal: ${totalSnapshots} snapshots seeded.`);
  console.log('Dashboard: https://bandwidth-and-utilization.vercel.app/dashboard');
  console.log('\nCleanup: node seed-test-data.mjs --clean');
}

if (CLEAN) {
  await clean();
} else {
  await clean();
  await seed();
}
