# Utilization MIS — System Design Spec

> Automated bandwidth collection, cross-referencing, and utilization reporting for IndigoEdge.
> **Created:** 2026-04-07

---

## 1. Problem

Bandwidth tracking at IndigoEdge runs on bi-weekly meetings where ~30 fellows verbally report their workload. Ajder manually normalizes the data into scores, writes narratives on each project in Airtable, and the existing rollup/formula/AI pipeline generates per-person summaries. This is slow, manual, and produces no historical utilization view.

## 2. Solution Overview

Replace the meeting-based collection with an automated email-driven system. Fellows receive a personalized email, click through to a web form, enter their hours, and the system handles scoring, cross-referencing, conflict resolution, Airtable updates, and historical reporting.

### Architecture

**Vercel Full-Stack:** A single Next.js application on Vercel (IE Pro account) with:
- Vercel Marketplace Postgres for submissions, cycle state, and historical snapshots
- Airtable as the source of truth for projects, fellows, and team assignments (read) and bandwidth situation fields (write)
- Resend or SendGrid for transactional email
- Slack webhook for #team-allocation notifications
- Vercel Crons for scheduling

### Data Stores

| Store | Role |
|-------|------|
| **Postgres (Vercel)** | Submissions, tokens, cycles, conflicts, historical snapshots |
| **Airtable (existing)** | Projects (Mandates/DDEs/Pitches), Fellows List, team assignments. Receives final bandwidth updates |

---

## 3. Who Participates

**Submitters:** All current IB employees with designation VP, AVP, Associate 3, Associate 2, or Associate 1. Pulled from the Fellows List table (`tbl2EquvDVwvSaGVy`) where `Current Employee = Yes` and `Team = Investment Banking`.

**Excluded:** Directors, Analysts, Founder's Office, Secondaries, Pixel Sky.

**VP/AVP form:** Reports their own hours per project AND their projection for each associate assigned to that project.

**Associate form:** Reports their own hours per project only.

---

## 4. Collection Cycle

### Cadence

Every other Monday, starting April 20, 2026. Sequence: Apr 20, May 4, May 18, Jun 1, Jun 15, etc.

### Timeline per Cycle

| Day | Action |
|-----|--------|
| Monday | Collection emails sent to all fellows |
| Tuesday | Email reminder to anyone who hasn't submitted |
| Wednesday | Email reminder + Slack list of pending names in #team-allocation |
| Thursday | Email reminder + Slack list of pending names in #team-allocation |
| Friday | Email reminder + Slack list of pending names in #team-allocation |
| Until complete | Window stays open until everyone submits or Ajder marks stragglers as "not needed" |

### "Not Needed" Toggle

Ajder can mark any fellow's token status as `not_needed` for a cycle (e.g., someone on leave). That fellow is excluded from the pending list and the system doesn't wait for their submission. This is done via a simple admin page on the Vercel app (accessible at `/admin`) that lists all fellows for the current cycle with a toggle button next to each name.

---

## 5. Email Design (Option E: Hybrid)

### Collection Email

- **Subject:** "Bandwidth Update — [Date Range]"
- **Body:** HTML table showing all projects the fellow is assigned to (project name, type, current stage). For VP/AVPs, associates on each project are also listed beneath each project row.
- **Button:** "Submit Your Bandwidth" — links to the personalized web form on Vercel
- **Link contains:** A one-time token identifying the fellow and cycle

### Reminder Email

- **Subject:** "Reminder: Bandwidth Update Pending"
- **Body:** Short nudge with the same button/link as the original
- **Sent to:** Only fellows with `token.status = pending`

### Conflict Resolution Email

- **Subject:** "Bandwidth Conflict — [Project Name]"
- **To:** VP/AVP on the mandate
- **CC:** The associate, Ajder (ajder@indigoedge.com), Pai (pai's email — to be configured as an env var)
- **Body:** "On [Project Name], you reported [Associate Name] will spend [X hrs/day], but [Associate Name] reported [Y hrs/day]. Please confirm the accurate number."
- **Three buttons:**
  - "[Associate]'s number is correct ([Y] hrs/day)" — one-click link with resolution token
  - "My number is correct ([X] hrs/day)" — one-click link with resolution token
  - "Enter a different number" — links to a mini-form with one input field
- Each button records the resolution server-side and shows a confirmation page

### Completion Report Email

- **To:** Ajder
- **Subject:** "Bandwidth Cycle [Date] — Complete"
- **Body:** "[X] submissions processed, [Y] conflicts resolved. All [Z] project bandwidth fields updated on Airtable successfully." If any Airtable writes failed, lists which projects and why.

---

## 6. Web Form

Hosted on Vercel. No authentication — personalized via token in the URL.

### Form Structure

**For VP/AVP:**

For each project they're assigned to:
- Project name and type (Mandate/DDE/Pitch) shown as a header
- **Their own bandwidth:** Unit selector (hrs/day or hrs/week) + numeric input
- **For each associate on the project:** Associate name shown, unit selector + numeric input
- All fields mandatory — no blanks, no "Unclear" option

**For Associates:**

For each project they're assigned to:
- Project name and type shown as a header
- **Their own bandwidth:** Unit selector (hrs/day or hrs/week) + numeric input
- All fields mandatory

**Remarks section (bottom):**

Free-text field for flagging projects not in the system, other work, or concerns. Optional.

**Submit button:** One-time. After submission, the token is burned. Revisiting the link shows a "Already submitted" confirmation.

### Data Source

Projects and team assignments are fetched live from Airtable at form load time (not from the email snapshot). This ensures the form reflects the latest state even if assignments changed between email send and form open.

---

## 7. Auto-Scoring Engine

### Step 1: Normalize to hours/day

If the fellow entered hrs/week, divide by 5.

### Step 2: Map hours/day to score

**Mandates:**

| Hours/Day | Score | MEU |
|-----------|-------|-----|
| 0–1.5 | 1 | 0.25 |
| 1.5–3 | 2 | 0.75 |
| 3–6 | 3 | 1.00 |
| 6–8 | 4 | 1.25 |
| 8+ | 5 | 1.50 |

**DDEs and Pitches (1/3 intensity):**

| Hours/Day | Score | MEU |
|-----------|-------|-----|
| 0–0.5 | 1 | 0.10 |
| 0.5–1 | 2 | 0.20 |
| 1–2 | 3 | 0.30 |
| 2–3 | 4 | 0.40 |
| 3+ | 5 | 0.50 |

### Step 3: Calculate utilization

Sum all MEUs for a fellow across all projects. Divide by their `Capacity [MEU]` from Airtable.

**Load tag thresholds:**

| Utilization | Tag |
|-------------|-----|
| < 0.30 | Free |
| 0.30–0.60 | Comfortable |
| 0.60–0.85 | Busy |
| 0.85–1.00 | At Capacity |
| > 1.00 | Overloaded |

---

## 8. Cross-Referencing

### When it runs

Real-time, triggered on each submission. When a submission arrives, the engine checks all project-associate pairs where both a VP/AVP projection and an associate self-report now exist for that cycle.

### Threshold

A conflict is flagged when the difference between the VP/AVP's projection and the associate's self-report exceeds **2 hours per day** (after normalizing units to hrs/day).

### What happens

1. Conflict recorded in the `conflicts` table with status `pending`
2. Resolution email sent to the VP/AVP (see Section 5)
3. VP/AVP clicks one of the 3 buttons to resolve
4. Resolution recorded, conflict status set to `resolved`

### Scope

Only VP/AVP vs Associate cross-referencing. No Associate-to-Associate checks. If a project has only Associates and no VP/AVP, there is nothing to cross-reference.

---

## 9. Airtable Write-Back

### Trigger

Automatic. Fires when ALL of the following are true:
1. Every fellow has submitted or been marked "not needed"
2. Every conflict has been resolved

### What gets written

For each project, the system generates a narrative block matching the existing format:

```
[Project Name]
Current Bandwidth Situation for [Project Name] as on [Date]

- [Fellow Name] – Score [X]; [Y] hrs/day. [Stage context]
- [Fellow Name] – Score [X]; [Y] hrs/day.
```

Written to:
- `Mandate Bandwidth Situation` field on Mandates table
- `DDE Bandwidth Situation` field on DDEs table
- `Pitch Bandwidth Situation` field on Pitches table

This triggers the existing Airtable pipeline: rollups → formula combos → AI text field → load tag.

### Completion report

After all writes complete, an email is sent to Ajder with the cycle summary and confirmation that Airtable updates succeeded (or details of any failures).

### Historical snapshot

Simultaneously, the system writes a snapshot to the Postgres `snapshots` table for each fellow: total MEU, utilization %, load tag, and per-project breakdown (as jsonb).

---

## 10. Slack Integration

All messages go to **#team-allocation** via Slack webhook.

### Pending submissions list (Wed–Fri)

"The following people have not submitted their bandwidth update for [Date Range]:"
- Bulleted list of names
- Posted alongside the email reminder

### Fellow remarks/flags

Posted in real-time as submissions arrive. Only when a fellow writes something in the remarks section.
- Format: "[Fellow Name] flagged: [remark text]"
- One message per flag

---

## 11. Dashboard Views

Two pages on the same Vercel app. No authentication — accessible to anyone with the link.

### Utilization View (Month-by-Month)

- **Rows:** All IB fellows (VP/AVP/Associates)
- **Columns:** Months of the selected IY (Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb, Mar, Apr, May, Jun)
- **Each cell shows:** Utilization % and absolute MEU (e.g., "75% — 2.25/3.0")
- **Color-coded:** Green (Free/Comfortable), Yellow (Busy), Orange (At Capacity), Red (Overloaded)
- **IY selector dropdown** at the top, defaulting to current IY
- **Data source:** `snapshots` table. Latest cycle per month is shown.

### Per-Person Drill-Down

- **Fellow selector dropdown** + **IY selector dropdown**
- Per month:
  - Utilization %
  - Absolute MEU
  - Number of projects by type (Mandate / DDE / Pitch)
  - List of project names with individual scores and MEU
- Trend visualization (bar chart or line) showing utilization over the IY
- **Data source:** `snapshots` table, `project_breakdown` jsonb field

### IY Definition

IY runs July to June. IY26 = Jul 2025 – Jun 2026. The IY of a mandate is determined by its `Closure IY` field. For DDEs and Pitches, the IY is determined by the project's start date.

---

## 12. Database Schema

### `cycles`

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| start_date | date | Monday the cycle starts |
| status | enum | `collecting`, `complete` |
| created_at | timestamp | |

### `tokens`

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| cycle_id | FK → cycles | |
| fellow_record_id | text | Airtable record ID |
| fellow_name | text | Denormalized |
| fellow_email | text | |
| fellow_designation | text | VP/AVP/Associate 1/2/3 |
| token | text (unique) | URL token |
| status | enum | `pending`, `submitted`, `not_needed` |
| submitted_at | timestamp | Null until submitted |

### `submissions`

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| cycle_id | FK → cycles | |
| fellow_record_id | text | Who submitted |
| project_record_id | text | Airtable record ID of project |
| project_name | text | Denormalized |
| project_type | enum | `mandate`, `dde`, `pitch` |
| hours_value | decimal | Raw number entered |
| hours_unit | enum | `per_day`, `per_week` |
| hours_per_day | decimal | Normalized |
| auto_score | integer | From scoring table |
| auto_meu | decimal | From score-to-MEU mapping |
| is_self_report | boolean | True = own bandwidth. False = VP projecting for associate |
| target_fellow_id | text | If is_self_report=false, who is the VP projecting for |
| remarks | text | Optional free-text |

### `conflicts`

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| cycle_id | FK → cycles | |
| project_record_id | text | Which project |
| vp_submission_id | FK → submissions | VP's projection |
| associate_submission_id | FK → submissions | Associate's self-report |
| vp_hours_per_day | decimal | VP said |
| associate_hours_per_day | decimal | Associate said |
| difference | decimal | Absolute difference |
| status | enum | `pending`, `resolved` |
| resolved_hours_per_day | decimal | Final number |
| resolved_by | text | `vp_number`, `associate_number`, or `custom` |
| resolution_token | text | One-time token in email buttons |

### `snapshots`

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| cycle_id | FK → cycles | |
| fellow_record_id | text | |
| fellow_name | text | |
| designation | text | |
| capacity_meu | decimal | Capacity at snapshot time |
| total_meu | decimal | Sum of all project MEUs |
| utilization_pct | decimal | total_meu / capacity_meu |
| load_tag | text | Free/Comfortable/Busy/At Capacity/Overloaded |
| project_breakdown | jsonb | Array of {project_name, type, score, meu, hours_per_day} |
| snapshot_date | date | |

---

## 13. External Integrations

| Service | Purpose | Credentials Needed |
|---------|---------|-------------------|
| **Airtable API** | Read projects/fellows, write bandwidth fields | API key (existing) |
| **Resend or SendGrid** | Send collection, reminder, and conflict emails | API key |
| **Slack Webhook** | Post to #team-allocation | Webhook URL |
| **Vercel Crons** | Trigger cycle start and daily reminders | Configured in vercel.json/vercel.ts |
| **Vercel Marketplace Postgres** | Operational database | Provisioned via Vercel dashboard |

---

## 14. Reference Documents

| Document | Path |
|----------|------|
| Current process documentation | `Context Files/Current Process - Bandwidth Tracking.md` |
| Scoring table (PDF) | `Context Files/Scoring Table.pdf` |
| Problem statement | `problem-statement.md` |
| Airtable schema | `../Project Tracking System/Context Files/Airtable Schema/` |
| Recent bandwidth notes (Word) | `../Bandwidth & Allocations/Bandwidth Notes/` |
| Airtable base | `appmsoOuN72RJ9Qho` |
| Fellows List table | `tbl2EquvDVwvSaGVy` |
| Mandates table | `tblETYHFy9FnXG9TH` |
| DDEs table | `tblxyEcXA5piBJKyP` |
| Pitches table | `tblOMIyzJZYUMrJ2N` |
| Notion meeting tracker | `94452c05-0821-4579-aeae-4a277b0609e9` |
