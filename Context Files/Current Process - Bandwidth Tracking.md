# Current Process: Bandwidth Tracking at IndigoEdge

> Documents the as-is bandwidth tracking process. Written as a reference for designing the automated replacement.
> **Created:** 2026-04-06

---

## Overview

Bandwidth tracking at IndigoEdge is a bi-weekly, meeting-driven process led by Ajder (FO Operating Lead). It captures how much time each fellow (VP, AVP, Associate) is spending on each project, normalizes that into a common unit, and updates Airtable to produce a bandwidth calculation.

The process has been running since approximately August 2025, with 10+ meetings conducted to date.

---

## The Meeting

**Cadence:** Bi-weekly (Week 1 and Week 3 of each month)
**Led by:** Ajder
**Attendees:** All VPs, AVPs, and Associates

### How it works

1. Everyone gathers in a single meeting.
2. Ajder goes person by person, in no fixed order. Could start with a VP or an Associate.
3. Each person lists every project they're working on and gives a bandwidth outlook for the next 2 weeks.

### What gets reported

Each person reports their bandwidth in one of three formats (whichever feels natural):
- **Hours per day** (e.g., "4-5 hours per day for the next 1 week")
- **Hours per week** (e.g., "3-4 hours per week")
- **Percentage of bandwidth** (e.g., "50% of my bandwidth")

They also state:
- Which projects they're on (Mandates, DDEs, or Pitches)
- The expected duration of the current intensity level
- Any upcoming changes (e.g., "this drops after January 15th")

### VP vs Associate reporting

A VP reports on both themselves *and* the Associates working on their projects:
> "On Project A, I'll be spending 4-5 hours/day for the next week. The Associate will be spending 1-2 hours/day for the next 2 weeks."

The Associate independently reports their own view:
> "On Project A, I expect to spend 2-3 hours/day for the next 2 weeks."

This creates **two independent projections** for the same person-project combination when a VP and their Associate are on the same project.

### Cross-referencing and discrepancy resolution

If there's a material mismatch between the VP's projection for an Associate and the Associate's own projection, it gets resolved live in the meeting. This is one of the meeting's core functions: catching misalignment before it becomes a problem.

---

## The Scoring Table

After the meeting, Ajder normalizes all the raw time estimates into a standardized scoring system using the **Mandate Equivalent Unit (MEU)**. The scoring table converts the diverse time formats (hours/day, hours/week, % bandwidth) into comparable scores.

There are two scoring tables, reflecting the different intensity profiles of the two project types.

### Table A: Mandate Intensity Key

Used for all live mandate projects.

| Score | Level | Definition | Hours/Day (Avg) | % Bandwidth |
|-------|-------|------------|-----------------|-------------|
| 1 | On and Off | Monitoring phase. Minimal, periodic check-in/execution. No active workstreams. | ~1-1.5 hours | ~10% |
| 2 | Focused Contributor | **VP:** Managing specific, time-bound workstreams. **Associate:** Executing on specific, delegated tasks. | ~1-3 hours | ~25% |
| 3 | Active Involvement | **VP:** Consistently engaged, managing a major workstream. **Associate:** Consistently engaged, executing on a major workstream. | ~4-6 hours | ~50% |
| 4 | Primary Focus | **VP:** Driving multiple core workstreams. **Associate:** Executing on multiple core workstreams. | ~6-8 hours | ~70-80% |
| 5 | Critical | All-consuming. Full-time-plus commitment, typically during a deal closing or major launch. | ~8+ hours (or very critical work) | ~95%+ |

### Table B: DDE & Pitches Intensity Key

Used for all pre-mandate Deep Dive Evaluations or Pitches. General rule: **intensity is 1/3rd of Mandate intensity.**

| Score | Level | Definition | Hours/Day (Avg) | % Bandwidth |
|-------|-------|------------|-----------------|-------------|
| 1 | On and Off | Initial screening. Quick reviews and data gathering. No major workstreams. | <0.5 hours | ~3-5% |
| 2 | Low | Light analysis. Performing initial data crunching. | <1 hour | ~8-10% |
| 3 | Medium | Detailed review. Building a preliminary model or analysis. | ~1.5-2 hours | ~15-20% |
| 4 | High | Driving the evaluation. In-depth analysis or preparing for a pitch meeting. | ~2-3 hours | ~25-30% |
| 5 | Critical | Intense push. Finalizing all materials for an imminent pitch or meeting with a client. | ~2.5+ hours | ~40%+ |

**Source:** `Context Files/Scoring Table.pdf`

---

## Post-Meeting Processing

After the meeting, Ajder:

1. **Normalizes** all reported bandwidth into scores using the tables above
2. **Updates Airtable** with the normalized scores, which generates a bandwidth calculation per person

### Where it lands in Airtable

Project data lives in the **IndigoEdge Projects** Airtable base (`appmsoOuN72RJ9Qho`). The three project tables each have a dedicated bandwidth field:

| Table | Bandwidth Field | Type | Example Entry |
|-------|----------------|------|---------------|
| Mandates | `Mandate Bandwidth Situation` | richText | "Freshbus\nCurrent Bandwidth Situation for Freshbus as on January 7, 2026\n- Adit Kumar, Score 2; ~2 hours/day. Very less work happening now.\n- Aaron George, Score 2; ~2 hours/day." |
| DDEs | `DDE Bandwidth Situation` | richText | Same format, per-DDE |
| Pitches | `Pitch Bandwidth Situation` | richText | Same format, per-pitch |

Each entry is a narrative block listing every person on that project, their score, hours, and context.

Airtable also has specific views for bandwidth operations:
- **"For BW form"** view on Mandates, DDEs, and Pitches
- **"[Ops] Update Bandwidth"** view on DDEs

Team assignments in Airtable are per-project: Director, VP/AVP (1-2), Associate (1-2), all linked to the Fellows List.

**Full Airtable schema:** `../Project Tracking System/Context Files/Airtable Schema/`

---

## The Bandwidth Calculation Pipeline (Airtable)

The system that converts per-project bandwidth notes into per-person bandwidth summaries is built entirely within Airtable, using a chain of rollups, formulas, and an AI field on the **Fellows List** table (`tbl2EquvDVwvSaGVy`).

### Layer 1: Manual Input (Project Tables)

Ajder writes the bandwidth situation narrative on each project's bandwidth field after the meeting.

### Layer 2: Rollup Aggregation (Fellows List)

Rollup fields pull bandwidth notes from all projects where a fellow is assigned, grouped by role:

| Rollup Field | Pulls From | Role |
|-------------|-----------|------|
| `Mandate Bandwidth Notes Dump (as AVP/VP 1)` | Mandate Bandwidth Situation | VP/AVP 1 assignments |
| `Mandate Bandwidth Notes Dump (as AVP/VP 2)` | Mandate Bandwidth Situation | VP/AVP 2 assignments |
| `Mandate Bandwidth Notes Dump (as Associate 1)` | Mandate Bandwidth Situation | Associate 1 assignments |
| `Mandate Bandwidth Notes Dump (as Associate 2)` | Mandate Bandwidth Situation | Associate 2 assignments |
| `DDE Bandwidth Notes as AVP / VP Dump` | DDE Bandwidth Situation | VP/AVP on DDEs |
| `DDE Bandwidth Notes as Associate Dump` | DDE Bandwidth Situation | Associate on DDEs |
| `Pitch Bandwidth Note AVP / VP Dump` | Pitch Bandwidth Situation | VP/AVP on pitches |
| `Pitch Bandwidth Note Associate 1 Dump` | Pitch Bandwidth Situation | Associate 1 on pitches |
| `Pitch Bandwidth Note Associate 2 Dump` | Pitch Bandwidth Situation | Associate 2 on pitches |

There are also parallel rollups for Project Plans (9 more fields), pulling the `Complete Project Plan` formula from each project table.

### Layer 3: Formula Combination (Fellows List)

Formula fields combine the role-specific rollups into unified notes per project type:

- `Mandate Bandwidth Notes FINAL (Combined)` = combines all 4 mandate bandwidth dumps
- `DDE Bandwidth Note FINAL (Combined)` = combines the 2 DDE dumps
- `Pitch Bandwidth Note FINAL (Combined)` = combines the 3 pitch dumps
- `Mandate Project Plan FINAL (Combined)`, `DDE Project Plan Final (Combined)`, `Pitch Project Plan FINAL (Combined)` = same for project plans

### Layer 4: AI Generation (Fellows List)

The `Bandwidth of Fellow` field is an **Airtable AI Text** field. It reads 8 inputs:

1. Fellow Name
2. Capacity [MEU]
3. Mandate Plans (combined) + Mandate Notes (combined)
4. DDE Plans (combined) + DDE Notes (combined)
5. Pitch Plans (combined) + Pitch Notes (combined)

The AI prompt encodes the full MEU system and generates:

**1) Summary Note** — a bold load tag (Free / Comfortable / Busy / At Capacity / Overloaded) followed by qualitative narrative.

**2) Detailed Bandwidth Situation** — per-project breakdown with scores, assigned MEU values, and a final math line showing total MEU vs capacity.

### MEU Scoring Rules (from AI prompt)

**Score → MEU conversion:**

| Score | Mandate MEU | DDE/Pitch MEU |
|-------|-------------|---------------|
| 1 | 0.25 | 0.10 |
| 2 | 0.75 | 0.20 |
| 3 | 1.00 | 0.30 |
| 4 | 1.25 | 0.40 |
| 5 | 1.50 | 0.50 |

**Time windows:**
- "NOW" (0-4 weeks): weight = 1.0
- Near-term (4-8 weeks): weight = 0.15-0.20
- Beyond 8 weeks: ignored

**Utilization = Total MEU / Capacity MEU**

**Load intensity thresholds:**

| Utilization | Tag |
|-------------|-----|
| <0.30 | Free |
| 0.30-0.60 | Comfortable |
| 0.60-0.85 | Busy |
| 0.85-1.00 | At Capacity |
| >1.00 | Overloaded |

The `Load Intensity of Fellow` field (singleSelect) stores the tag separately for filtering/views.

### Layer 5: Capacity Reference

Each fellow has a `Capacity [MEU]` number field. The mapping by designation:

| Designation | Typical Capacity [MEU] | Notes |
|-------------|----------------------|-------|
| Director | (none) | Not tracked for bandwidth |
| VP | 3.0 | Exception: Shan T = 2.0 |
| AVP | 3.0 | Consistent across all AVPs |
| Associate 3 | 2.0-3.0 | Most at 3.0; Mahek Mall = 2.0 |
| Associate 2 | 2.0-3.0 | Varies: Gitansh/Derick = 3.0; most others = 2.0 |
| Associate 1 | 2.0 | Consistent across all Assoc 1s |
| Analyst / FO / Secondaries | (none) | Not tracked |

Capacity isn't purely designation-based. It's set per person, presumably reflecting individual capability or tenure.

### Current IB Fellows (50 on the roster, ~30 tracked for bandwidth)

The Investment Banking team members with Capacity [MEU] and current load:

| Name | Designation | Capacity | Load |
|------|------------|----------|------|
| Mitul Gupta | VP | 3.0 | Comfortable |
| Vishnu Ramesh | VP | 3.0 | Comfortable |
| Nakul Jain | VP | 3.0 | Comfortable |
| Yogesh Gidwani | VP | 3.0 | Busy |
| Shan T | VP | 2.0 | — |
| Tanya Shahi | AVP | 3.0 | Busy |
| Murali Dhananjey | AVP | 3.0 | Comfortable |
| Vasu Tada | AVP | 3.0 | Comfortable |
| Yogesh Porwal | AVP | 3.0 | Comfortable |
| Aviral Kotangle | AVP | 3.0 | Busy |
| Narayan Sharalaya | AVP | 3.0 | Free |
| Samridhi Singhania | AVP | 3.0 | Busy |
| Maris Maria Chacko | AVP | 3.0 | — |
| Harshal Bhatia | Assoc 3 | 3.0 | Busy |
| Adit Kumar | Assoc 3 | 3.0 | At Capacity |
| Anmol Verma | Assoc 3 | 3.0 | — |
| Nihar Dighe | Assoc 3 | 3.0 | Free |
| Mahek Mall | Assoc 3 | 2.0 | Overloaded |
| Gitansh Aggarwal | Assoc 2 | 3.0 | Busy |
| Derick Saldhana | Assoc 2 | 3.0 | Busy |
| Aditi Thakur | Assoc 2 | 2.0 | Busy |
| Pratiksha Kumar | Assoc 2 | 2.0 | Comfortable |
| Kanishka Gupta | Assoc 2 | 2.0 | Comfortable |
| Sadagoban S | Assoc 2 | 2.0 | Busy |
| Saahil Khanna | Assoc 2 | 2.0 | Overloaded |
| Manjeet Singh | Assoc 1 | 2.0 | Overloaded |
| Aaron George | Assoc 1 | 2.0 | Overloaded |
| Keshav Agrawal | Assoc 1 | 2.0 | Busy |

*Load data reflects the last Airtable update (based on Jan 7, 2026 meeting). Actual current load may differ.*

---

## Meeting Notes Format (Established)

Meeting notes are stored in Notion in the **IE Meeting Tracker** database, tagged with Type = "Bandwidth Discussion."

The format evolved over time. The established format (from approximately Discussion VI onward) is structured **per person**, with each project entry containing:

```
## [Person Name]
[Project Name] | [Type: Mandate/DDE] | Score: [X] ([Person]), Score: [Y] ([Other Person])
[Narrative: hours/day, duration, expectations, cross-references to other team members]
---
```

**Example from Bandwidth Discussion VIII (Nov 20, 2025):**

> ## Mitul
> XYXX | Mandate | Score: 1 (Aditi)
> The mandate is currently on pause with almost no bandwidth being allocated. Aditi is spending a maximum of 30 minutes per day maintaining minimal oversight of this project.
>
> Supertails | Mandate | Score: 2 (Mitul), Score: 2 (Gitansh)
> Mitul is spending approximately 2 hours per day on this mandate. Gitansh is contributing 3 hours per day to the project, executing on specific delegated tasks and workstreams.

Earlier meetings (I through IV) used a less structured format, mixing per-project and per-person organization with numbered lists and raw hour estimates without explicit scores.

### Meeting notes in Notion

| Meeting | Date | Notion Page ID |
|---------|------|----------------|
| Bandwidth Discussion Meeting I | Aug 21, 2025 | `2564c11f-c854-8057-9d70-c7afbd284d6d` |
| Bandwidth Discussion Meeting II | Sep 2, 2025 | `2624c11f-c854-8089-b5e5-dc9272d4b47c` |
| Bandwidth Meeting III | Sep 10, 2025 | `26a4c11f-c854-80bb-b702-c547822489c1` |
| Bandwidth Meeting IV | Sep 19, 2025 | `2734c11f-c854-8059-971b-f52010aefd64` |
| Bandwidth Discussion VI | Sep 26, 2025 | `27a4c11f-c854-8086-9eac-cc4dd512aa81` |
| Bandwidth Discussion VI | Oct 21, 2025 | `2934c11f-c854-805a-8f59-c27b2f7e3bf3` |
| Bandwidth Discussion VII | Nov 5, 2025 | `2a24c11f-c854-801b-ad1c-c9ca7c1f667e` |
| Bandwidth Discussion VIII | Nov 20, 2025 | `2b14c11f-c854-8097-98ba-c4bf8066178f` |
| Bandwidth Discussion Jan 7th | Jan 7, 2026 | `2e14c11f-c854-8094-ae4c-df6a4974da25` |
| Bandwidth Discussion Jan 22 | Jan 22, 2026 | `2f04c11f-c854-8059-8b73-e95ce5ea6ab2` |

### Supporting Notion pages

| Page | Purpose | Page ID |
|------|---------|---------|
| Bandwidth Tracking System | Parent page for all bandwidth infrastructure | `26c4c11f-c854-803d-ac9b-f2ccd4fe846a` |
| Template to Create Bandwidth Discussion Meeting Notes | Template for new meeting notes | `26c4c11f-c854-8073-94c6-dee59134d2b0` |
| Template to Create Per Project Bandwidth View | Template for project-level bandwidth output | `26c4c11f-c854-8016-997c-c28c9f7a061b` |
| Prompts Database for Bandwidth System | Prompt engineering for the bandwidth system | `2934c11f-c854-80d6-a55b-c2730b2e8130` |
| Latest Prompt for Bandwidth Meeting Note to Per Project | Most recent prompt for converting meeting notes to per-project view | `2e14c11f-c854-8045-a07e-d994a46ef982` |

**Notion database:** IE Meeting Tracker (`94452c05-0821-4579-aeae-4a277b0609e9`)

---

## Project Types

Fellows work on three types of projects, each tracked in a separate Airtable table:

| Type | What it is | Scoring Table | Typical Lifecycle |
|------|-----------|---------------|-------------------|
| **Mandate** | Signed advisory engagement (fundraising, M&A, secondaries). Revenue-generating. | Table A (Mandate Intensity) | Not Started → In Production → In GTM → TS Signed → DD Started → In Docs → Closing → Successful |
| **DDE** | Due Diligence Evaluation. Pre-mandate assessment of a company. | Table B (DDE/Pitch Intensity, ~1/3 of mandate) | Not Started → In Progress → Completed (Pass / Defer / Move to Pitch / Move to Mandate) |
| **Pitch** | Effort to win a mandate from a potential client. | Table B (DDE/Pitch Intensity, ~1/3 of mandate) | Work in Progress → Done (Secured / Failed / Passed / Awaiting) |

The pipeline flows: **DDE → Pitch → Mandate**, though not every project follows the full path.

---

## Current Status (as of April 2026)

Bandwidth meetings continue on the bi-weekly cadence. Since approximately January 2026, notes have been recorded in Word documents rather than Notion, following the same format. Airtable hasn't been updated recently because bandwidth has been tight across the board and the system would just show "overloaded" for most people. The underlying process and scoring system remain the same.

### Recent Meeting Notes (Word Documents)

Located at `/Users/ajder/Documents/IndigoEdge/Bandwidth & Allocations/Bandwidth Notes/`:

| File | Date |
|------|------|
| `Bandwidth Discussions - Feb 6 2026.docx` | Feb 6, 2026 |
| `Bandwidth Discussions - Mar 5 2026.docx` | Mar 5, 2026 |
| `Bandwidth Discussions - Mar 5 2026 (Structured).md` | Mar 5, 2026 (structured version) |
| `Bandwidth Discussions - Mar 5 2026 (Structured).docx` | Mar 5, 2026 (structured version) |
| `Bandwidth Discussions - Mar 25 2026.docx` | Mar 25, 2026 |

The structured Mar 5 notes evolved the format further: per-person tables with Project / Stage / Bandwidth / Notes columns. Cross-references between people are explicitly noted (e.g., "Populated from Yogesh Gidwani's entry"). Some entries note combined allocation exceeding 100%, flagging approximate figures.

---

## Pain Points with the Current Process

1. **Meeting is a bandwidth drain itself.** Bi-weekly meetings with all VPs and Associates are expensive in terms of collective time.
2. **No persistent visibility.** Between meetings, leadership has no way to check utilization without asking someone.
3. **Manual normalization.** Ajder manually converts raw time estimates to scores after every meeting. Error-prone and time-consuming.
4. **Manual Airtable updates.** Scores must be manually entered into the Airtable bandwidth fields after normalization.
5. **No historical utilization view.** Data exists only as meeting-to-meeting snapshots in Notion. No month-over-month trend or utilization percentage view.
6. **Discrepancy resolution is synchronous.** VP-Associate mismatches can only be caught and resolved when both are in the room, which means waiting for the next meeting if one is absent.
7. **No per-person drill-down.** Can't easily answer "What was X working on in October and how loaded were they?"

---

## Desired Future State: Requirements (as described by Ajder)

> These are the requirements as articulated so far. Not yet a complete design; further brainstorming needed.

### Guiding Principle

Make it as simple as possible for the fellows. Everything happens via email. No new apps, no logins, no pop-ups.

### 1. Data Collection

**Trigger:** Bi-weekly (Monday of Week 1 and Week 3, matching current cadence).

**Mechanism:** Each fellow receives an email that:
- Lists all projects they're currently assigned to (pulled live from Airtable)
- For each project, they select a **unit** (hours/day or hours/week) and enter a **value** representing their expected bandwidth for the next 2 weeks
- No option to leave anything blank. If they don't know, they select **"Unclear"** from a dropdown
- There's a section at the bottom for **remarks**: anything about projects not in the system, other work, or flags
- They fill it in and press submit. All within the email body if possible

**Data goes to:** A database (TBD) that stores all submissions with timestamps.

### 2. Cross-Referencing and Discrepancy Resolution

As submissions come in, the system cross-references:
- A VP's projection for an Associate on a project vs. the Associate's own projection for that same project
- If there's a material mismatch: **email is sent to the VP on the mandate** (or the senior Associate acting as VP if no VP exists)

**Discrepancy email:**
- **To:** VP on the mandate (or senior Associate)
- **CC:** The associate in question, Ajder (ajder@indigoedge.com), Pai
- **Content:** "On [Project], you reported [X] but [Associate] reported [Y]. Please sync up and send us the final number."
- **Resolution:** The VP enters the final number directly in the email (as simple as possible, no external links or pop-ups). Pressing a button/reply submits the resolved value.

**Edge case:** When there's no VP and two associates are on the project, the senior associate (functionally acting as VP) receives the discrepancy email. Same flow.

### 3. Airtable Update

Once all data is collected and discrepancies resolved, the final bandwidth data must be written back to Airtable:
- Update the `Mandate Bandwidth Situation`, `DDE Bandwidth Situation`, `Pitch Bandwidth Situation` fields on each project
- This triggers the existing rollup → formula → AI pipeline on the Fellows List table
- The `Bandwidth of Fellow` AI field and `Load Intensity of Fellow` get regenerated automatically

### 4. Reminders

| Day | Action |
|-----|--------|
| Monday | Collection email goes out to all fellows |
| Tuesday | Email reminder to anyone who hasn't submitted |
| Wednesday | Slack message in **team allocation channel** listing who hasn't filled + email reminder on the same thread. This lets FO push people in person |

### 5. Flag Forwarding

When a fellow adds a remark/flag in their submission (about projects not in the system, other work, concerns), each flag is forwarded to the **team allocation Slack channel** with:
- Who submitted it
- What the flag says

### 6. Utilization View (UI)

A month-by-month view for the current IY showing per-person utilization:
- **Percentage** of calibrated capacity
- **Absolute value** (bandwidth score / MEU)
- Must be accessible from any computer (not just Ajder's machine)
- Hosted on Vercel (IE has a Pro subscription)

### 7. Per-Person Drill-Down View (UI)

Select a fellow and see their month-by-month breakdown:
- % utilization (of calibrated capacity)
- Actual absolute bandwidth score
- Number of projects being worked on, broken down by type (Mandate / DDE / Pitch)
- What those projects are

Also hosted on Vercel alongside the utilization view.

### Decided: Auto-Scoring

The system auto-converts hours/day or hours/week submissions into scores using the scoring table. No manual review by Ajder. The scoring table and MEU conversion rules are the source of truth.

### Decided: Discrepancy Threshold

A discrepancy is flagged when the difference between VP/AVP's projection and the Associate's self-report exceeds **2 hours per day** (after normalizing units). Single check, no score-based comparison.

### Decided: Collection Mechanism — Option E (Hybrid Email + Web Form)

Email shows a read-only preview of the fellow's projects (snapshot from Airtable at send time). Below it, a single "Submit Your Bandwidth" button links to a personalized web form on Vercel. The form loads live data from Airtable, supports dropdowns (hrs/day, hrs/week, "Unclear"), validates no blanks, and includes a remarks section for flags. One click from email to form; no login needed (personalized token in the URL).

### Open Design Questions
- How does the system handle new projects that appear mid-cycle (not yet in Airtable)?
- How is historical data stored for the month-over-month utilization view?
- Authentication for the Vercel-hosted views (who can access these?)
- What does "senior associate" mean precisely for discrepancy routing when there's no VP? (Higher designation? Associate 1 on the project?)
