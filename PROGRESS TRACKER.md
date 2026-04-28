# Utilization MIS — Progress Tracker

> Operational status of the project. Where we are, what's moving, what's next.
> **Last updated:** 2026-04-28 (pending_projects rename + admin link workflow removed + git/vercel state reconciled)

## Instructions for Claude

- **Always ask for confirmation before writing to this file.** Propose the exact edit, get approval, then write.
- **Never infer entries from existing documents.** Only log what the user explicitly confirms happened.
- **Activity Log captures outcomes — things shipped or achieved that moved the project forward.** Not every task or process step belongs here. Log what you'd want to see when looking back at what the project actually accomplished.
- **Current Focus should be tight.** Only what's actively being worked on right now — not the full project scope.
- **Workstreams only lists what's in motion or directly blocked by something in motion.** Don't list future-state workstreams that aren't yet relevant.
- **Upcoming Milestones are outcomes, not tasks.** "First analyst onboarded" not "Schedule interviews." This section may not always be filled — that's fine.
- **Updates to the tracker itself (format, instructions, structure) are not logged in Activity Log.** Just update the Last updated date.
- **Update Last updated date whenever this file is modified.**

---

## Current Focus

**v2 shipped + post-launch fixes landed.** Weekly cadence, VP-run mandates, conflict reminders, dashboard restructure all live. Transitional-cycle date math, per-project conflict badge, and form/UX refinements shipped April 20. Crash fix + UX polish landed April 21. Fellow x Project tab (per-person per-project utilization-over-time chart) shipped April 21, followed by MEU cleanup (dropped dual scoring model; hours ÷ 84 is the sole signal now). Airtable writeback still paused. First clean weekly cycle auto-started Mon Apr 27. April 28: "ad hoc projects" renamed to "pending projects" across schema/code/UI/tests, admin link-to-Airtable workflow stripped, table reframed as a one-way outbox for an external automation. Same day: previously-uncommitted local UI work (MEU removal, Fellow x Project tab, April 27 dashboard fixes) was committed to git so future `git push` deploys match working state.

---

## Workstreams

| Workstream | Status | Owner | Notes |
|------------|--------|-------|-------|
| Application code | **Done** | Ajder | 26 commits on `main` in `app/`, 119 tests passing |
| Infrastructure provisioning | **Done** | Ajder | Neon Postgres, Resend, Slack webhook, all env vars set |
| Git remote setup | **Done** | Ajder | `foundersoffice-indigoedge/bandwidth-and-utilization` |
| Deploy | **Done** | Ajder | Live at `bandwidth-and-utilization.vercel.app`, crons registered |
| Code audit | **Done** | Ajder | Found and fixed Airtable field name bug, stage context gap, added test mode |
| Live end-to-end test | **Done** | Ajder | Self-test passed: full cycle (start → email → submit → conflict → resolve → finalize → writeback → snapshot → dashboard) |
| Post-test improvements | **Done** | Ajder | Active stage filtering, grouped project display, email CC/enrichment, dark mode fix, dashboard unification |
| Hours-per-week migration | **Done** | Ajder | Switched from MEU scoring to hrs/week ÷ 84 capacity. Old code retained for rollback. |
| First live cycle | **In Progress** | Ajder | Triggered April 17, 2026. 24/33 submitted, 9 pending. |
| v2 updates | **Done** | Ajder | Weekly cadence, auto-finalize, writeback pause, conflict reminders, VP-run mandates, ad-hoc projects, dashboard restructure. 11 commits, 92 tests passing. |

---

## Activity Log

| Date | What happened |
|------|---------------|
| 2026-04-07 | Brainstormed system design, evaluated 3 architecture options (Vercel Full-Stack, Airtable-Centric, Hybrid), chose Option A |
| 2026-04-07 | Wrote full design spec (`docs/superpowers/specs/2026-04-07-utilization-mis-design.md`) covering all 14 sections |
| 2026-04-07 | Wrote 17-task implementation plan (`docs/superpowers/plans/2026-04-07-utilization-mis.md`) |
| 2026-04-07 | Implemented all 17 tasks via subagent-driven development: scaffolding, DB schema, scoring engine, utilization calculator, conflict detection, Airtable client, write-back, email system, Slack integration, submission form + API, conflict resolution, cycle management, cron routes, admin page, both dashboards, Vercel config |
| 2026-04-07 | Pushed code to `foundersoffice-indigoedge/bandwidth-and-utilization` (IE Central GitHub) |
| 2026-04-07 | Created Vercel project on IE Pro, provisioned Neon Postgres, set all 10 env vars, deployed to production |
| 2026-04-07 | Debugged and fixed silent deploy failure caused by `vercel.ts`; replaced with `vercel.json` |
| 2026-04-07 | Ran full code audit against spec: found critical Airtable field name mismatch in fellows.ts, fixed stage context in writeback, added force-start + test mode to start-cycle route |
| 2026-04-07 | Verified all Airtable field names against live schema via Rube MCP. All project table configs correct, fellows table fields fixed. Redeployed. |
| 2026-04-14 | Ran full self-test: cycle start, email delivery, VP + Associate form submission, conflict detection, conflict resolution, cycle finalization, Airtable writeback (verified 3 projects), snapshot creation, dashboard rendering. All passed. |
| 2026-04-14 | Added active stage filtering — only live projects shown (7 mandate stages, 2 DDE stages, 2 pitch stages). Projects grouped by type in both emails and submission form with color coding. |
| 2026-04-14 | Added Pai CC to all emails (collection, reminder, completion). Enriched completion email with per-fellow utilization table and dashboard link. |
| 2026-04-14 | Fixed dark mode background on submission form (removed prefers-color-scheme override from globals.css). |
| 2026-04-14 | Cleaned up full test environment: Vercel env var, Neon DB (all tables), Airtable bandwidth fields (7 mandate + 1 DDE records). |
| 2026-04-14 | Unified dashboard into single page — overview grid + person drill-down + month→week expansion, all at /dashboard. Removed separate /dashboard/[fellowId] route. |
| 2026-04-15 | Fixed empty Week 1 bug in dashboard drill-down: switched from midpoint to overlap matching, expanded search from month-scoped to all fellow snapshots. |
| 2026-04-15 | Updated dashboard to show monthly averages (utilization, MEU, project counts) across all cycle snapshots instead of latest-only. |
| 2026-04-15 | Built seed script (`seed-test-data.mjs`) with 10 real fellows from Airtable, 13 biweekly cycles, 130 snapshots. Uses `rec_test_` prefix for safe cleanup. |
| 2026-04-15 | Removed Ajder + Pai CC from collection and reminder emails (kept on conflict and completion). Lowered conflict threshold from >2 hrs/day to >1 hrs/day. Tests updated, all 48 passing. |
| 2026-04-17 | Cleaned up all test artifacts: removed TEST_EMAIL_OVERRIDE from Vercel, wiped Neon DB (all 5 tables), verified Airtable clean (no test narratives). |
| 2026-04-17 | Switched utilization from MEU scoring to hours-per-week method (84 hrs/week capacity). Added hoursPerWeek to submissions, 3 hours-based columns to snapshots. Dashboard and completion email show hours-based utilization %. Old MEU code and columns retained for rollback. DB migration applied, deployed to Vercel. 57 tests passing. |
| 2026-04-17 | Triggered first live cycle (33 fellows). 18 of 33 collection emails silently dropped by Resend rate limit. Root cause: SDK returns `{ data, error }` instead of throwing; code wasn't checking error field. Re-sent manually, patched code with `sendEmail()` wrapper that throws on error + 500ms delays between sends. |
| 2026-04-17 | Built live dashboard view: "Current Cycle" section shows real-time utilization from submissions before finalization. Disappears after cycle completes. Deployed and verified with 24/33 submissions showing. |
| 2026-04-17 | Dashboard sort order: designation hierarchy (VP > AVP > Associate 3 > 2 > 1 > Analyst) then alphabetical. Applied to live table, pending list, and overview grid. Live table has a Designation/Load toggle (Load sorts by utilization % high to low). |
| 2026-04-18 | Changed per-day to per-week conversion from 5 to 6 working days. Centralized as `WORKING_DAYS_PER_WEEK` constant in `scoring.ts`. All production code and 85 tests updated. Deployed. |
| 2026-04-18 | Conflict resolution confirmation email: threads with original conflict email in Gmail, shows final value and who resolved it. Stored Resend message ID on conflict records for threading. |
| 2026-04-20 | v2 rollout deployed (11 commits). Switched cycle cadence biweekly → weekly (anchored Mon 2026-04-27). Auto-finalize stale cycles on new cycle start with VP-as-truth for dangling conflicts. Added DISABLE_AIRTABLE_WRITEBACK gate (set to true in prod — writeback paused while accuracy is observed). Daily conflict reminder cron (threaded via In-Reply-To). VP-run mandates: VP records bandwidth projections for teammates who don't self-report. Ad-hoc projects: fellows add projects not yet in Airtable; admin links via dice-coefficient candidate suggestions. Dashboard: Monthly view moved to top, Latest Cycle always visible (falls back to most recent finalized snapshots), fellows grouped by tier (VP/AVP/Associate/Analyst) with collapsible sections + localStorage persistence. |
| 2026-04-20 | UI feedback pass after v2 launch: teammate picker rebuilt as type-to-search combobox grouped by tier (VP/AVP/Associate/Analyst) with chips for selected; DDE acronym rendered correctly everywhere (replaced Tailwind `capitalize` with a TYPE_LABELS map); Slack new-project post headlined "New Project Flagged - [Type]"; fixed submit-form crash when a fellow added an ad-hoc project before hitting submit (entries state now reconciles with the projects prop via useEffect). |
| 2026-04-20 | Fixed transitional cycle date range: last biweekly cycle (Apr 17 start) now shows as "17 Apr – 26 Apr 2026" everywhere — dashboard header, email subject, Slack reminder. Introduced `getCycleEndDate()` in `schedule.ts`: end = day before the next cycle's Monday, which resolves to the Apr 27 anchor for pre-weekly cycles and to `+6` for steady-state. Also changed the Monthly drill-down rule: a weekly cell only renders when a cycle actually started in that week (was overlap-based, so biweekly cycles bled into the second week they covered). |
| 2026-04-20 | Per-project conflict badge in Live drill-down: each pending bandwidth conflict now shows an amber "conflict pending" chip next to the specific project name, so it's obvious which mandate is under dispute. Fellow-level badge retained. Server derives the per-project flag from the pending-conflict project record ID set and attaches it to each breakdown row. |
| 2026-04-21 | Ad-hoc form crash fully fixed. Previous April 20 patch added a reconciling `useEffect`, but effects run after render — the first render with the newly-added ad-hoc project still hit `entries[key] === undefined` in `HoursInput`, surfacing as "This page couldn't load" in the browser. Refactor: extracted pure `deriveEntries(projects, isVp, userInput)` into `form-entries.ts`, component now derives entries synchronously via `useMemo` and keeps a separate `userInput` map for typed values. 15 new unit tests cover mandate/dde/pitch, VP vs non-VP, ad-hoc injection, input preservation, orphan key eviction. Full suite 107/107 passing. Verified end-to-end against a preview cycle: all 3 project types render correctly with an ad-hoc project injected. |
| 2026-04-21 | Ad-hoc UX polish shipped. Four fixes landed in one deploy cycle: (1) ad-hoc bandwidth now pre-fills on form reload — `deriveEntries` takes a new optional `initialEntries` param, page.tsx reads existing `adhoc_%` submissions for the fellow/cycle, passes them through so values entered at modal-add time stay visible. 5 additional unit tests, suite at 112/112. (2) `/api/submit` now dispatches on `adhoc_` prefix and UPDATE-s the existing submission row instead of silently skipping — ad-hoc values are fully editable on the main form, saves persist. Conflict re-detection for ad-hoc edits deliberately skipped (would duplicate without unique constraint). (3) Teammate bandwidth required when teammates added to an ad-hoc project (client-side validation, label dropped "optional"). (4) Project-name badge next to ad-hoc projects reads the type (Mandate / DDE / Pitch) instead of the generic "ad-hoc" — the section header already conveys ad-hoc-ness. All verified via two preview cycles. |
| 2026-04-21 | Fellow x Project tab shipped. New dashboard tab lets you pick a fellow + IYs + one of their projects and see a line chart of utilization-over-time from first cycle recorded on that project to the latest. Defaults to hours/week on the Y-axis with a toggle to % of 84-hr weekly capacity. Dedupe rule when both a self-report and a VP projection exist for the same cycle: self-report wins. Implementation is a pure-function core (`buildTimeline`, `listProjectsForFellow`, `iyOf`) with 18 unit tests, a three-mode API endpoint (`bootstrap` / `projects` / `timeline`), and a Recharts client. Cascading pickers: fellow → projects list filters to the selected IYs → selecting a project fetches the timeline. Works off the `submissions` table only (no join on `conflicts`) because conflict resolution already writes the resolved value back to both rows, so submissions is source of truth. |
| 2026-04-21 | MEU scoring model fully removed. Hours ÷ 84 is now the sole utilization signal; the parallel MEU path (per-fellow `Capacity [MEU]`, per-submission `autoMeu`, per-snapshot `totalMeu`/`capacityMeu`/`utilizationPct`/`loadTag`, helpers `sumMeu`/`calculateUtilization`) was dead weight after the April 17 migration and has been deleted. `scoreHours()` now returns `{ score }` only; `Fellow` type no longer carries `capacityMeu`; snapshot + submission schemas dropped 5 columns (`auto_meu`, `capacity_meu`, `total_meu`, `utilization_pct`, `load_tag`) via `drizzle/0002_drop_meu.sql` applied to Neon prod. 11 MEU-specific tests retired, suite at 119/119. Seed script rewritten to emit the new snapshot shape. Deployed, dashboard + fellow-project API smoke-tested green. |
| 2026-04-27 | Two dashboard fixes shipped. (1) Monthly Report tab couldn't horizontal-scroll past Jan because each tier card had `overflow-hidden` clipping the table; refactored each tier to wrap its `<table>` in an `overflow-x-auto` div with `min-w-full`, so months Feb–Jun become reachable while the Fellow column stays sticky-pinned on the left. (2) Latest Cycle drill-down now surfaces fellow-submitted remarks ("flags") in an amber callout below the project table. Plumbed `remarks` through `LiveFellowData`, populated from any non-null self-report row in `getLiveCycleData` (active cycle) and via a parallel `submissions` query in `getLatestFinalizedCycleData` (finalized fallback — snapshots don't carry remarks, no schema change needed). 119/119 tests still passing, TypeScript clean. Deployed direct to prod mid-cycle (read-only dashboard change, no risk to live cycle data). |
| 2026-04-28 | Pending-projects rename + admin link workflow strip. Killed "ad hoc" terminology across schema, code, UI, tests, Slack messages. Reframed `pending_projects` (was `ad_hoc_projects`) as a one-way outbox: rows land with `status='pending'`, an external automation (separate workstream) will create the corresponding Airtable record, set status to `'finished'`, and delete the row. Status enum collapsed `active\|linked\|superseded` → `pending\|finished`. Dropped `linked_airtable_record_id`, `linked_at`, and `conflicts.is_ad_hoc`. Project record id prefix migrated `adhoc_*` → `pending_*` in `submissions` (9 rows) and `conflicts` (0 rows) via UPDATE in the migration. UI: form section "Added by you / teammates" → "New projects"; remarks placeholder reframed for sector scoping, outreach, and other non-project threads (projects already have a structured path). Stripped admin link/connect workflow entirely (`admin/ad-hoc-list.tsx` + `/api/ad-hoc-projects/suggest` + `/api/ad-hoc-projects/link` deleted). Slack notification title simplified to `:new: *New Mandate*` / DDE / Pitch. Killed dead `existingAdHocId` reconnect branch in `/api/add-project`. 10 commits via subagent-driven plan execution, 119/119 tests passing, `tsc --noEmit` clean. Migration `0003_pending_projects_rename` applied directly to prod Neon (no drizzle migrations table — same pattern as 0002_drop_meu). Plan: `docs/superpowers/plans/2026-04-28-pending-projects-rename.md`. |
| 2026-04-28 | Reconciled git ↔ Vercel state drift. Past `vercel --prod` deploys had been uploading the working tree and quietly carrying ~10 modified files + 4 untracked files (MEU removal April 21, Fellow x Project tab April 21, dashboard fixes April 27) that never made it into git. The pending_projects push exposed this when the git-based build broke on a half-finished MEU type. Recovery: redeployed via `vercel --prod` to restore prod with full UI work, then committed the local-only changes in 3 grouped commits (MEU + Fellow x Project + April 27 dashboard fixes bundled), tracked project docs (CLAUDE.md, MEMORY.md, PROGRESS TRACKER.md, problem-statement.md, design specs, plans, Context Files), added root `.gitignore` for `.DS_Store`/`.superpowers`/`.vercel`/env files, and added `seed-test-data.mjs` as a real tracked tool. Going forward, `git push origin main` and `vercel --prod` from local will produce the same code. 4 ad-hoc `.mjs` debug scripts left untracked deliberately (`check-db`, `cleanup-preview`, `preview-bandwidth-form`, `verify-adhoc-rendering`) — one-off utilities, decide later. |

---

## Upcoming Milestones

- ~~Live end-to-end test passes~~ (done)
- ~~First live collection cycle triggered~~ (done, April 17, 2026)
- ~~v2 post-rollout updates deployed~~ (done, April 20, 2026)
- **First weekly cycle under new cadence** — Mon April 27, 2026 (auto-triggered)
- **Resume Airtable writeback** — once data accuracy holds across 2-3 cycles

## Manual Steps Checklist (Pre-Deploy)

These must be completed before the app can go live. Order matters.

- [x] **1. Push code to git remote** — `foundersoffice-indigoedge/bandwidth-and-utilization` (IE Central)
- [x] **2. Create Vercel project** — Linked to repo on IE Pro account (`vercel-ie`)
- [x] **3. Provision Neon Postgres** — Free tier, auto-created `DATABASE_URL` + Neon vars
- [x] **4. Run DB migration** — `pnpm drizzle-kit push` against Neon connection string
- [x] **5. Set env vars on Vercel** — All 10 set: DATABASE_URL (auto), AIRTABLE_API_KEY, AIRTABLE_BASE_ID, RESEND_API_KEY, EMAIL_FROM, SLACK_WEBHOOK_URL, APP_URL, ADMIN_EMAIL, CC_EMAIL (pai@indigoedge.com), CRON_SECRET
- [x] **6. Verify Resend domain** — `indigoedge.com` already verified with sending enabled
- [x] **7. Configure Slack webhook** — Created Bandwidth Tracker app, webhook for #team-allocation working
- [x] **8. Deploy** — Live at `bandwidth-and-utilization.vercel.app`
- [x] **9. Verify crons** — start-cycle (Mon 9am IST) and send-reminders (Tue-Fri 9am IST) registered
- [~] **10. Set custom domain** — Skipped, Vercel URL is fine for internal tooling

---

## Blockers

- *(none — all previous blockers resolved)*
