# Transition Analysis — Utilization MIS (`bandwidth-and-utilization`)

Pre-migration inventory of the Utilization MIS app ahead of extracting all hardcoded business rules into an external rules store (Notion DB read via a shared package). Goal: nothing is missed, nothing breaks.

- **App root:** `/Users/ajder/Documents/IndigoEdge/Utilization MIS/app`
- **Stack:** Next.js 16 (App Router), Drizzle ORM on Neon Postgres, Airtable (REST, by field *name*), Resend (email), Slack incoming webhook. Deployed on Vercel.
- **Airtable base:** `IndigoEdge Projects`, base id `appmsoOuN72RJ9Qho` (env `AIRTABLE_BASE_ID`). Shared with sibling app `ie-checkin`.
- **Sibling at risk of drift:** `/Users/ajder/Documents/IndigoEdge/Project Tracking System/ie-checkin` — keeps its OWN hardcoded Airtable contract in `src/lib/constants.ts` (by field *ID*).

All `file:line` references below are relative to the app root and were accurate at the time of writing.

---

## 1. Architecture Overview

### Entry points

**Public form/flow pages (App Router, token-gated, no auth):**
- `src/app/page.tsx` — landing.
- `src/app/submit/[token]/page.tsx` + `form.tsx` + `form-entries.ts` — fellow bandwidth submission form (the token from the collection email).
- `src/app/resolve/[token]/page.tsx` + `form.tsx` + `director-flag-form.tsx` — conflict / director-flag resolution.
- `src/app/signoff/[token]/page.tsx` + `signoff-form.tsx` — director sign-off (confirm or flag).
- `src/app/submitted/`, `src/app/resolved/` — confirmation pages.
- `src/app/dashboard/page.tsx` + `DashboardView.tsx` + `FellowProjectTab.tsx` — utilization dashboard (server component loads data, client renders). No auth gate.
- `src/app/admin/page.tsx` + `fellows-list.tsx` — admin view of cycle tokens.

### API routes (`src/app/api`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/submit` | POST | token (body) | Save fellow's per-project hours, score them, detect VP-vs-associate conflicts, send conflict emails, trigger sign-off readiness + cycle finalization. |
| `/api/add-project` | POST | token (body) | Add a project not on the prefilled list ("pending project"); save self + projected submissions, detect conflicts, post `:new:` Slack. |
| `/api/resolve` | POST | resolution token (body) | Resolve a conflict (submission-source: two-sided writeback; director_flag: one-sided). Re-score, email, transition sign-off, finalize. |
| `/api/signoff/confirm` | POST | signoff token (body) | Director confirms slice → status `confirmed`, finalize check. |
| `/api/signoff/flag` | POST | signoff token (body) | Director flags lines → creates `director_flag` conflicts, Slack post, resolution emails. |
| `/api/dashboard/fellow-project` | GET | none | Drill-down data (bootstrap / projects / timeline modes). |
| `/api/admin/toggle` | POST | none | Flip a token `pending`↔`not_needed`; finalize check. |
| `/api/admin/pending-projects` | GET | `BT_INTEGRATION_SECRET` Bearer | List `status='pending'` rows (consumed by ie-checkin). |
| `/api/admin/pending-projects/awaiting-setup` | GET | Bearer | List `status='awaiting_setup'` rows. |
| `/api/admin/pending-projects/[id]` | GET | Bearer | Single row by id (any status). |
| `/api/admin/pending-projects/[id]/confirming` | POST | Bearer | Atomic claim `pending → confirming` (worker lock for ie-checkin cron). |
| `/api/admin/pending-projects/[id]/awaiting-setup` | POST | Bearer | `→ awaiting_setup` + store `airtableRecordId`. |
| `/api/admin/pending-projects/[id]/finish` | POST | Bearer | `awaiting_setup → finished` with `completed`/`rejected`. |

The `pending-projects` family is the **integration handshake with ie-checkin**: a fellow adds an off-list project → ie-checkin's cron pulls it, creates the Airtable record, writes it back through these endpoints.

### Cron jobs (`vercel.json`, all auth via `CRON_SECRET` Bearer)

| Path | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/start-cycle` | `30 3 * * 1` (Mon 03:30 UTC = 09:00 IST) | If `isCycleMonday(today)` (or `?force=true`): finalize any stale `collecting` cycles, then `startCycle()` — create cycle, fetch eligible fellows + projects, mint a token per fellow with ≥1 project, send collection email. |
| `/api/cron/send-reminders` | `30 3 * * 2-5` (Tue–Fri) | If active `collecting` cycle and day is Tue/Wed/Thu/Fri (skips Sun/Sat/Mon): email reminders to fellows with `pending` tokens; on Wed+ also post the pending-list to Slack. |
| `/api/cron/conflict-reminders` | `30 4 * * *` (daily 04:30 UTC) | Latest cycle (if ≥ `2026-04-27` and not complete): once-per-IST-day reminder per pending conflict (submission + director_flag), plus daily director sign-off nudges (>24h). |

### Bi-weekly cycle flow

Note: despite the project's "bi-weekly" framing, the live cadence is **weekly** (`CYCLE_LENGTH_DAYS = 7`, `schedule.ts:3`). Earlier cycles before the `2026-04-27` anchor were bi-weekly; `getCycleEndDate` handles the transition.

1. **Collection** — `start-cycle` cron → `startCycle()` (`cycle.ts:14`). Creates a `cycles` row (`status='collecting'`), one `tokens` row per eligible fellow with ≥1 active project, sends the collection email with their prefilled project list.
2. **Submission** — fellow opens `/submit/[token]`, enters hrs/day or hrs/week per project (VPs also project hours for their associates). `/api/submit` scores each entry, burns the token, and cross-references VP projection vs associate self-report → inserts `conflicts` rows + sends conflict emails when `|diff| > 1 hr/day`.
3. **Conflict resolution** — recipients click a button in the email → `/resolve/[token]` → `/api/resolve` writes the agreed value back to both submissions, re-scores, sends a threaded "resolved" email.
4. **Director sign-off** — when a director's whole slice has submitted and has no pending conflicts (`getDirectorSliceStatus`), `createSignoffIfReady` inserts a `director_signoffs` row and emails the director. They either **confirm** (one click) or **flag** specific lines (→ `director_flag` conflicts routed to the VP/AVP resolver or admin).
5. **Finalization** — `checkAndFinalizeCycle` runs after every state-changing action. Three gates: (a) no `pending` tokens, (b) no `pending` conflicts, (c) every current director with an in-scope project has a terminal sign-off. When all pass → `finalizeCycle` writes per-fellow `snapshots` (utilization %, load tag, project breakdown), marks cycle `complete`, emails the completion report to admin. `finalizeStaleCycles` force-closes lingering cycles on the next Monday (VP-as-truth for conflicts, auto-confirm sign-offs).

### Postgres schema (`src/lib/db/schema.ts`)

| Table | Purpose |
|---|---|
| `cycles` | One row per collection cycle. `status: collecting \| complete`. |
| `tokens` | One per fellow per cycle. Carries fellow identity snapshot + `status: pending \| submitted \| not_needed`. Unique `token`. |
| `submissions` | One per (fellow, project, target). Raw `hoursValue`+`hoursUnit`, normalized `hoursPerDay`/`hoursPerWeek`, `autoScore`, `isSelfReport`, `targetFellowId` (projection target). |
| `conflicts` | VP-vs-associate (`source='submission'`) and director flags (`source='director_flag'`). Holds both sides' hours, `resolutionToken`, resolver routing, `signoffId`. `status: pending \| resolved`. |
| `directorSignoffs` | One per (cycle, director). `status: email_sent \| confirmed \| flagged \| flagged_resolved`. Unique `signoffToken` + unique (cycleId, directorFellowId). |
| `snapshots` | Per-fellow finalized result: `projectBreakdown` (jsonb), `totalHoursPerWeek`, `hoursUtilizationPct`, `hoursLoadTag`. The dashboard's historical source. |
| `pendingProjects` | Off-list projects added by fellows. `status: pending \| awaiting_setup \| confirming \| finished`. The ie-checkin integration queue; carries `airtableRecordId` after creation. |
| `conflictRemindersSent` | Audit log of conflict reminder sends. |

### Data read from Airtable

Read-only. Two tables read live on nearly every request: **Fellows List** (`fetchEligibleFellows`, `fetchDirectors`) and the three project tables **Mandates / DDEs / Pitches** (`fetchAllProjects`). The app **never writes to Airtable** — writes go to Postgres; project-record creation in Airtable is delegated to ie-checkin via the pending-projects handshake.

---

## 2. RULES & POLICY INVENTORY (most important)

Every hardcoded business rule, with `file:line` and current value, grouped by taxonomy. **Category counts:** Stages & Lifecycle 4 · Field Requirements 7 · Vocabularies & Allowed Values 9 · Routing & Recipients 8 · Cadence & Reminders 9 · Calculations & Scoring 10 · Escalation & Flags 5 · Templates & Messaging 14 · Data Freshness & Integrity 5 · Edge Cases & Exceptions 7. **Total: 78 rules.**

### Stages & Lifecycle (4)

| # | Rule | file:line | Value |
|---|---|---|---|
| S1 | Mandate active stages (project counts as active iff stage ∈ list) | `lib/airtable/config.ts:24-32` | `Not Started, In Production, In GTM, In Docs, Closing, Term Sheet Signed, DD Started` |
| S2 | DDE active stages | `lib/airtable/config.ts:42-45` | `Not Started, DDE In Progress` |
| S3 | Pitch active stages | `lib/airtable/config.ts:55-58` | `Pitch Work in Progress, Pitch Done - Awaiting Outcome` |
| S4 | Active-stage filter applied to project rows | `lib/airtable/projects.ts:31-34` | `cfg.activeStages.includes(stage)` — anything not listed is dropped from the whole pipeline |

### Field Requirements (7) — which Airtable fields each project type uses

| # | Rule | file:line | Value |
|---|---|---|---|
| F1 | Mandate name / stage fields | `config.ts:18-19` | `Mandate Name` / `Current Stage of Mandate` |
| F2 | Mandate VP·AVP / Associate / Director fields | `config.ts:20-22` | `[Mandate VP / AVP 1, Mandate VP / AVP 2]` / `[Mandate Associate 1, Mandate Associate 2]` / `[Mandate Director]` |
| F3 | Mandate VP-run flag field | `config.ts:23` | `Is this a VP run mandate?` |
| F4 | DDE name / stage / role fields | `config.ts:37-41` | `DDE Name` / `Current Stage of DDE` / `[DDE VP / AVP]` / `[DDE Associate]` / `[DDE Director]` |
| F5 | Pitch name / stage / role fields | `config.ts:50-54` | `Name` / `Pitch Status` / `[Pitch VP / AVP, Pitch VP / AVP 2]` / `[Pitch Associate 1, Pitch Associate 2]` / `[Pitch Director]` |
| F6 | Fellows table fields read | `fellows.ts:15-18` | `Name of Fellow, Email ID of Fellow, Designation of Fellow` |
| F7 | Fellows eligibility filter fields/values | `fellows.ts:9` | `Current Employee = 'Yes'` AND `Team = 'Investment Banking'` |

### Vocabularies & Allowed Values (9)

| # | Rule | file:line | Value |
|---|---|---|---|
| V1 | Eligible designations (get a bandwidth token) | `fellows.ts:5` | `['VP','AVP','Associate 3','Associate 2','Associate 1']` |
| V2 | Director detection | `fellows.ts:29` | `FIND('Director', {Designation of Fellow}) > 0` |
| V3 | VP/AVP detection | `fellows.ts:23`, `director-flag.ts:22` | `designation === 'VP' \|\| 'AVP'` (duplicated) |
| V4 | Tier mapping | `tiers.ts:5-11` | VP, AVP, `startsWith('Associate')`→Associate, else Analyst |
| V5 | Tier order | `tiers.ts:3` | `['VP','AVP','Associate','Analyst']` |
| V6 | Project types | `types.ts:1`, `config.ts`, schema enums | `mandate \| dde \| pitch` |
| V7 | Hours units | `types.ts:2` | `per_day \| per_week` |
| V8 | Load tags | `types.ts:3`, `utilization.ts:10-14` | `Free, Comfortable, Busy, At Capacity, Overloaded` |
| V9 | VP-run flag truthy value | `projects.ts:52` | mandate is VP-run iff field `=== 'Yes'` |

### Routing & Recipients (8)

| # | Rule | file:line | Value |
|---|---|---|---|
| R1 | Standard CC = Pai + Ajder | `email.ts:26-30` | `[CC_EMAIL, ADMIN_EMAIL]` |
| R2 | Conflict email TO=VP, CC=associate+admin+cc | `email.ts:138` | `to vpEmail`, `cc [assoc, ADMIN_EMAIL, CC_EMAIL]` |
| R3 | Director-flag resolver = flagged VP/AVP self; else first project VP/AVP; else flagged fellow; else admin | `director-flag.ts:34-73` | resolver routing ladder |
| R4 | Flag resolution CC base | `signoff.ts:421` | `[directorEmail, ADMIN_EMAIL, CC_EMAIL]` (+ flagged fellow if ≠ resolver) |
| R5 | Resolver fallback email | `director-flag.ts:71`, `signoff.ts:332` | `ADMIN_EMAIL ?? 'admin@indigoedge.com'` |
| R6 | Completion report TO=admin, CC=standard | `email.ts:474` | `to ADMIN_EMAIL`, `cc standardCc()` |
| R7 | Sign-off email TO=director, CC=standard | `email.ts:271-272` | director + Pai + Ajder |
| R8 | Slack target = single webhook (#team-allocation) | `slack.ts:2`, `.env.local.example:18` | `SLACK_WEBHOOK_URL` |

### Cadence & Reminders (9)

| # | Rule | file:line | Value |
|---|---|---|---|
| C1 | Cycle length | `schedule.ts:3` | `CYCLE_LENGTH_DAYS = 7` (weekly) |
| C2 | Weekly anchor / reference date | `schedule.ts:1` | `2026-04-27` (cycles before it were bi-weekly) |
| C3 | Cycle Monday gate | `schedule.ts:5-8` | only Mondays ≥ reference date |
| C4 | Start-cycle cron | `vercel.json` | `30 3 * * 1` |
| C5 | Reminder cron | `vercel.json` | `30 3 * * 2-5` |
| C6 | Reminder skip days | `send-reminders/route.ts:25` | skip Sun(0), Sat(6), Mon(1) |
| C7 | Slack pending-list day | `send-reminders/route.ts:47` | `dayOfWeek >= 3` (Wed onward) |
| C8 | Conflict-reminder cron | `vercel.json` | `30 4 * * *` |
| C9 | Conflict reminders start date / signoff nudge interval | `conflict-reminders/route.ts:9,157` | start `2026-04-27`; sign-off nudge every `>24h`; conflict reminder once per IST day (`:11-17`) |

### Calculations & Scoring (10)

| # | Rule | file:line | Value |
|---|---|---|---|
| K1 | Working days per week | `scoring.ts:3` | `WORKING_DAYS_PER_WEEK = 6` |
| K2 | hrs/week↔hrs/day conversion | `scoring.ts:5-11` | divide/multiply by 6 |
| K3 | Mandate hours→score | `scoring.ts:18-24` | `<1.5→1, <3→2, <6→3, <8→4, else 5` |
| K4 | DDE/Pitch hours→score | `scoring.ts:26-32` | `<0.5→1, <1→2, <2→3, <3→4, else 5` |
| K5 | Weekly capacity | `utilization.ts:3` | `WEEKLY_CAPACITY_HOURS = 84` |
| K6 | Utilization = totalHpw / 84 | `utilization.ts:5-7` | ratio |
| K7 | Load-tag thresholds | `utilization.ts:9-14` | `<0.30 Free, <0.60 Comfortable, <0.85 Busy, ≤1.00 At Capacity, else Overloaded` |
| K8 | Conflict threshold | `conflicts.ts:1-4` | `> 1` hr/day absolute difference |
| K9 | IY boundary (investment year) | `fellow-project-timeline.ts:28-31`, `dashboard/page.tsx:13-18` | IY rolls at month index ≥ 6 (July); range `(IY-1)-07-01`…`IY-06-30` |
| K10 | Score-table label (MEU/score 1–5 scale) | `scoring.ts` return shape; `submissions.autoScore` | integer 1–5; no separate score→MEU table exists in code (capacity expressed in hours, not mandate-equivalents) |

> Note on MEU: the problem statement frames capacity as "mandate equivalent units," but the shipped code expresses capacity purely in **hours** (84 hrs/week). There is no hours→MEU or score→MEU table in the codebase. If the rules store is expected to carry MEU, it is currently absent here.

### Escalation & Flags (5)

| # | Rule | file:line | Value |
|---|---|---|---|
| E1 | Director-flag requires a positive proposed value | `signoff.ts:275-283` | `proposedHoursPerDay > 0` required; comment optional |
| E2 | No duplicate flags per submission | `signoff.ts:285-290` | rejected |
| E3 | Stale-cycle conflict auto-resolve = VP-as-truth | `cycle.ts:125-135` | `resolvedHoursPerDay = vpHoursPerDay` |
| E4 | Stale director_flag auto-resolve = keep original | `cycle.ts:169-178` | `flaggedOriginalHoursPerDay ?? vpHoursPerDay` |
| E5 | Stale sign-off auto-confirm | `cycle.ts:143-153` | `email_sent → confirmed`, `confirmedBy='system_stale_close'` |

### Templates & Messaging (14)

All HTML/text strings + their inline brand colors are hardcoded.

| # | Template | file:line |
|---|---|---|
| T1 | Collection email (subject `Bandwidth Update — {range}`, grouped project table) | `email.ts:78-100` |
| T2 | Reminder email | `email.ts:103-120` |
| T3 | Conflict email (3 action buttons) | `email.ts:123-151` |
| T4 | Conflict resolution email (threaded) | `email.ts:154-189` |
| T5 | Conflict reminder email (threaded) | `email.ts:192-228` |
| T6 | Director sign-off email + "reminder daily until responded" copy | `email.ts:231-285` |
| T7 | Sign-off reminder email | `email.ts:288-319` |
| T8 | Director-flag resolution email (keep/proposed/custom buttons) | `email.ts:322-376` |
| T9 | Flag resolution confirmation email | `email.ts:379-410` |
| T10 | Completion report email + load-tag color map | `email.ts:413-486` (colors `422-428`) |
| T11 | Project-type labels + colors (email) | `email.ts:32-36` |
| T12 | Slack: pending list, remark, director-flag block, new-project `:new:` | `slack.ts:16-105` |
| T13 | Dashboard: type labels, load colors, month list `Jul…Jun` | `DashboardView.tsx:10,20-40` |
| T14 | Resolver-label / action-label phrasing | `email.ts:165-167,389-392` |

### Data Freshness & Integrity (5)

| # | Rule | file:line | Value |
|---|---|---|---|
| D1 | Projects re-fetched live from Airtable on every submit/resolve/signoff | `projects.ts:22`, called throughout | no caching layer |
| D2 | Self-report preferred over projection (dedupe) | `signoff.ts:96-104`, `fellow-project-timeline.ts:52-56` | self wins |
| D3 | Sign-off slice "in scope" = ≥1 team member OR ≥1 submission | `signoff.ts:40-44`, `cycle.ts:89` | empty projects excluded |
| D4 | Finalization gate over *current* directors only | `cycle.ts:82-106` | ex-directors / mis-tagged VPs ignored |
| D5 | `keep_original` re-reads submission fresh, not the snapshot | `resolve/route.ts:42-51` | avoids stale snapshot |

### Edge Cases & Exceptions (7)

| # | Rule | file:line | Value |
|---|---|---|---|
| X1 | VP-led mandate → no director (directorIds = []) | `projects.ts:9`, `extractDirectorIds:7-10` | `type==='mandate' && isVpRun` returns `[]` |
| X2 | VP-led mandate lead = first `Mandate VP / AVP 1` id | `projects.ts:52-56` | leadFellowRecordId |
| X3 | VP/AVP in Director slot still reports (DDE lead case) | `projects.ts:101-112` | director-slot inclusion gated on `isVpOrAvp` |
| X4 | Director-slot inclusion only for VP/AVP, never true Directors | `projects.ts:106-111` | designation guard |
| X5 | Pending project id prefix | `submit/route.ts:48`, `add-project/route.ts:55` | `pending_` |
| X6 | Sign-off feature flag by cycle date | `signoff.ts:142-148` | `SIGNOFF_ENABLED_FROM` env gate |
| X7 | IST offset for "same day" reminder check | `conflict-reminders/route.ts:13` | `5.5 * 60 * 60 * 1000` |

---

## 3. Airtable Dependency Map

**Access pattern:** raw REST (`lib/airtable/client.ts`), reads by **field NAME** (no `returnFieldsByFieldId`). Auth `AIRTABLE_API_KEY`, base `AIRTABLE_BASE_ID`. **Read-only.** Auto-paginates.

### Tables and fields read

| Table | id (in `config.ts`) | Fields read (by name) |
|---|---|---|
| Fellows List | `tbl2EquvDVwvSaGVy` (`config.ts:3`) | `Name of Fellow`, `Email ID of Fellow`, `Designation of Fellow`, `Current Employee`, `Team` |
| Mandates | `tblETYHFy9FnXG9TH` | `Mandate Name`, `Current Stage of Mandate`, `Mandate VP / AVP 1`, `Mandate VP / AVP 2`, `Mandate Associate 1`, `Mandate Associate 2`, `Mandate Director`, `Is this a VP run mandate?` |
| DDEs | `tblxyEcXA5piBJKyP` | `DDE Name`, `Current Stage of DDE`, `DDE VP / AVP`, `DDE Associate`, `DDE Director` |
| Pitches | `tblOMIyzJZYUMrJ2N` | `Name`, `Pitch Status`, `Pitch VP / AVP`, `Pitch VP / AVP 2`, `Pitch Associate 1`, `Pitch Associate 2`, `Pitch Director` |

### Stage values depended on (the active-stage gate)

- Mandate: `Not Started, In Production, In GTM, In Docs, Closing, Term Sheet Signed, DD Started`
- DDE: `Not Started, DDE In Progress`
- Pitch: `Pitch Work in Progress, Pitch Done - Awaiting Outcome`

Any stage value not in these lists silently removes the project from the entire pipeline (no error). The VP-run flag depends on the literal string `'Yes'`.

### How it reads (field IDs vs names)

Utilization MIS reads by **field name**. Rename any field in Airtable → the lookup returns `undefined` and the project/fellow silently drops out. This is the opposite of the sibling (field IDs), which is the core of the drift risk in section 4.

---

## 4. Cross-App Shared Contract (with `ie-checkin`)

Both apps point at base `appmsoOuN72RJ9Qho` and at the same Mandates/DDEs/Pitches tables. The shared, drift-prone surface:

| Shared element | This app (Utilization MIS) | Sibling (ie-checkin) |
|---|---|---|
| Table ids | `config.ts:17,36,49` (`tblETY…`, `tblxyE…`, `tblOMI…`) | `constants.ts:3-5` (same ids) |
| Stage values (read gate) | hardcoded stage-name strings in `config.ts:24-58` | **writes** these exact strings: `'In Production'` (`project-agent.ts:464`), `'DDE In Progress'` (`:282`, `reactivate-dde.ts:17`), `'Pitch Work in Progress'` (`:331`), `'Pitch Done - Awaiting Outcome'` (`projects.ts:47`) |
| Team-role fields | by **name** (`Mandate VP / AVP 1`, `DDE Director`, etc.) | by **field ID** (`MANDATE_FIELDS.vpAvp1 = 'fldUbJ6zwCOTpTEg1'`, etc. `constants.ts:31-113`) |
| VP-run flag | reads `Is this a VP run mandate?` `=== 'Yes'` (`projects.ts:52`) | writes field id `isVPRun='fldmfZ66MlyEZBmvd'` with values `'Yes'`/`'No'` (`mandate-setup-dm.ts:85,97`; `project-agent.ts:473`) |
| Active-stage definition | inline `activeStages` lists | implicit in what ie-checkin sets stages to; no shared source |

### Why this breaks

1. **Two hardcoded copies, two encodings.** Utilization MIS keys off field **names**; ie-checkin keys off field **IDs**. A rename in Airtable breaks Utilization MIS but not ie-checkin (IDs survive renames). Field IDs and names can drift independently with no compile-time link.
2. **Stage-string coupling with no shared constant.** ie-checkin *sets* stage strings that Utilization MIS *gates* on. If ie-checkin (or an admin) introduces a new active stage, or renames `'In Production'` → `'Production'`, Utilization MIS silently drops those projects from collection — no error, just missing people on forms and in utilization.
3. **VP-run flag value coupling.** Both hardcode `'Yes'`. Change the option label in Airtable and Utilization MIS stops treating VP-led mandates correctly (directors reappear, sign-offs get mis-routed).
4. **Pending-projects handshake** (`/api/admin/pending-projects/*`, `BT_INTEGRATION_SECRET`) is a live cross-app API contract: status enum (`pending/confirming/awaiting_setup/finished`) and `airtableRecordId` field are shared with ie-checkin's cron. A schema/status-name change here breaks the sibling's worker.

**Flag for migration:** the rules store should become the single source for stage lists, team-role field mappings, table ids, and the VP-run flag value — consumed by *both* apps through the shared package, so the two hardcoded copies collapse into one. Until then, treat `config.ts` (this app) and `constants.ts` (sibling) as a pair that must be edited together.

---

## 5. External Integrations

| Integration | Where | Credential / config (env) |
|---|---|---|
| **Postgres (Neon + Drizzle)** | `lib/db/index.ts`, `schema.ts`; `@neondatabase/serverless` | `DATABASE_URL`. **Note:** neon-http driver has no transactions — `signoff.ts` uses manual insert-then-guarded-update + rollback. |
| **Airtable** | `lib/airtable/*` | `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID` (=`appmsoOuN72RJ9Qho`). Read-only. |
| **Resend (email)** | `lib/email.ts` | `RESEND_API_KEY`, `EMAIL_FROM` (default `bandwidth@indigoedge.com`), `TEST_EMAIL_OVERRIDE` (redirect all mail in test). |
| **Slack** | `lib/slack.ts` | `SLACK_WEBHOOK_URL` (single #team-allocation webhook; silently no-ops if unset). |
| **App URLs in emails** | `email.ts` (many) | `APP_URL`. |
| **Recipient config** | `email.ts`, `signoff.ts` | `ADMIN_EMAIL` (Ajder, default `ajder@indigoedge.com`), `CC_EMAIL` (Pai). |
| **Cron auth** | all `api/cron/*` | `CRON_SECRET` (Bearer). |
| **ie-checkin integration auth** | `lib/integration-auth.ts` | `BT_INTEGRATION_SECRET` (Bearer; absent secret ⇒ all requests rejected). |
| **Sign-off feature flag** | `signoff.ts:143` | `SIGNOFF_ENABLED_FROM` (YYYY-MM-DD). |

No OAuth, no user-session auth anywhere — all flows are bearer-token (cron/integration) or opaque-UUID-token (public pages).

---

## 6. Test Coverage

**Runner:** Vitest (`vitest.config.ts`, globals on, `@`→`src` alias). **Run:** `pnpm test` (watch) or `pnpm test:run` (CI). 16 test files, ~189 cases.

**Well covered (pure logic):**
- `scoring.test.ts` (25) — full hours→score boundary table for both mandate and DDE/pitch curves, incl. exact thresholds (1.5, 3, 0.5, etc.).
- `utilization.test.ts` (10) — capacity=84, all 5 load-tag boundaries.
- `conflicts.test.ts` (7) — threshold exactly 1 hr.
- `tiers.test.ts` (5), `similarity.test.ts` (3), `schedule.test.ts` (5).
- `director-flag.test.ts` (11) — resolver routing ladder + dedupe.
- `signoff.test.ts` (13), `fellow-project-timeline.test.ts` (18), `form-entries.test.ts` (20), `projects-for-fellow.test.ts` (10), `projects-director.test.ts` (6).
- `hours-integration.test.ts` (24), `integration-auth.test.ts` (5), `api-pending-projects.test.ts` (25), `api-signoff.test.ts` (2).

**Notable gaps:**
- **No test asserts the active-stage lists** in `config.ts` (S1–S3) — the single most drift-prone rule and the cross-app coupling point is untested. A stage rename would pass CI.
- **No test asserts the team-role field-name mappings** (F1–F5) or the `'Yes'` VP-run value (V9).
- `config.ts` itself is never imported by a test (no fixture pins these strings).
- Email/Slack template bodies are not snapshot-tested.
- No test exercises the live Airtable read path (mocked everywhere), so a field rename in the real base is invisible to the suite.
- `finalizeStaleCycles` auto-resolution semantics (E3–E5) have limited direct coverage.
- The dashboard's **duplicated** `getLoadTag` (`DashboardView.tsx:12-18`) is not tied to the tested one in `utilization.ts`, so it can drift undetected.

---

## 7. Breakage-Risk Map (ranked, for rule extraction)

Ranked most-to-least fragile.

1. **Hardcoded Airtable contract duplicated across two apps, in two encodings.** `config.ts:17-60` (names) vs ie-checkin `constants.ts:3-113` (field IDs) + stage-string writes (`project-agent.ts:282,331,464`, `reactivate-dde.ts:17`). No shared source, no test. A field rename or new stage in Airtable breaks Utilization MIS silently (projects vanish from collection). **Extract first.** Top priority for the rules store.

2. **Active-stage lists are a silent filter with no fallback.** `projects.ts:31-34` drops any project whose stage isn't listed, no log, no error. Combined with #1, the most likely "people mysteriously missing from forms" failure. Untested (`config.ts:24-58`).

3. **VP-run flag string coupling.** `projects.ts:52` (`=== 'Yes'`) drives director derivation, lead detection, and sign-off routing (`extractDirectorIds`, `projects.ts:7-10`). A changed option label cascades into mis-routed sign-offs and reappearing directors. Shared with ie-checkin.

4. **Duplicated business logic that can drift within this app.**
   - `getLoadTag` thresholds exist twice: `utilization.ts:9-14` (tested) and `DashboardView.tsx:12-18` (untested). Already a latent drift bug.
   - `isVpOrAvp` defined twice: `fellows.ts:22-24` and `director-flag.ts:21-23`.
   - `WORKING_DAYS_PER_WEEK` (=6) is imported in most places but **inlined as literal `6`** at `signoff.ts:113` and as literal `* 6`/`/ 6` and `84` in `DashboardView.tsx:280,216,369,425,469,647,711` and `add-project/route.ts:165` (`/ 84`). Extracting the constant to the rules store will miss these inlined copies unless each is hunted down.

5. **Scoring tables and thresholds are scattered policy.** Two separate hours→score curves (`scoring.ts:18-32`), capacity 84 (`utilization.ts:3`), conflict threshold 1 (`conflicts.ts:1`), load-tag bands (`utilization.ts:9-14`). All are policy that belongs in the store; they're currently constants imported widely, so extraction must preserve every import site.

6. **Cadence/date anchors hardcoded in multiple files.** `REFERENCE_DATE=2026-04-27` (`schedule.ts:1`), `REMINDERS_START_DATE='2026-04-27'` (`conflict-reminders/route.ts:9`), cron schedules in `vercel.json`, reminder skip-days (`send-reminders/route.ts:25`), IST offset (`conflict-reminders/route.ts:13`), IY July boundary (`fellow-project-timeline.ts:30`, `dashboard/page.tsx:13-18`). Same date `2026-04-27` is written in two places — change one, forget the other.

7. **Recipient policy hardcoded around env vars.** Who gets CC'd (Pai+Ajder), the resolver routing ladder (`director-flag.ts:34-73`), and the `'admin@indigoedge.com'` literal fallbacks (`director-flag.ts:71`, `signoff.ts:332`, `resolve/route.ts:112`). The fallbacks bypass env config and would send to a possibly-wrong address.

8. **Eligibility & vocabulary literals.** `ELIGIBLE_DESIGNATIONS` (`fellows.ts:5`), the `Team='Investment Banking'` filter (`fellows.ts:9,29`), the `FIND('Director', …)` director test (`fellows.ts:29`), tier mapping (`tiers.ts`). Adding a new designation (e.g. "Associate 4") requires editing code in several spots.

9. **Pending-projects status enum is a live API contract with ie-checkin.** `schema.ts:109`. Renaming a status or the `airtableRecordId` field breaks the sibling's cron worker; no shared type guards this.

10. **No-transaction DB writes rely on manual rollback.** `signoff.ts:348-393` and the conflict insert/update pairs assume the guarded-update pattern holds. Not a rule-extraction risk per se, but any refactor that moves rule evaluation between the insert and the guard could open a race window. Worth noting before touching `signoff.ts`.

**Also flag (lower severity):** the "bi-weekly" naming in CLAUDE.md / problem-statement vs the live **weekly** cadence (`CYCLE_LENGTH_DAYS=7`) — a documentation/rules mismatch that could mislead whoever defines the cadence rule in Notion. And the absent **MEU / mandate-equivalent** table: the spec calls for it, the code expresses capacity only in hours, so the rules store design should decide whether MEU is in scope.
