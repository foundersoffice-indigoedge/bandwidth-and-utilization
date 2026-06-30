# Rules rationalization — progress (scratch)

> Survives compaction. Full plan: `~/.claude/plans/oh-phase-1-step-twinkling-sonnet.md`.
> Task list (TaskList) tracks phase status. Working style: orchestrate via sub-agents
> (Sonnet for edits), reserve Opus for decisions + diff review. See memory feedback note.

## Branches (LOCAL ONLY — nothing pushed, nothing deployed)
- **Util MIS** — worktree `util-mis-phase-d`, branch `cleanup/rules-rationalization`
  - `1aa4dbf` Phase 1b: dead score-curve removal
  - `31b709d` Phase 1a: re-inline workflow rules (cadence/templates/IY params) → `src/lib/templates.ts`
  - Gate: tsc clean, 183 tests pass.
- **ie-checkin** — repo `Project Tracking System/ie-checkin`, branch `cleanup/rules-rationalization` (off live `main`)
  - `66c1625` Phase 1c: re-inline workflow rules (templates/cadence/freshness/routing/stage-date) → `src/lib/templates.ts`
  - Gate: tsc clean, 326 tests pass. Only KEEP import left: `constants.ts:10`.

## Done — Phase 1 COMPLETE
- Sunday auto-deploy neutralized (Util MIS `main`, pushed `d421de9`).
- Phase 1a, 1b (Util) and 1c (ie-checkin) — all verified.
- **Phase 1d (Notion) DONE** — hard-deleted (trashed) 51 non-business rules via Notion API.
  Live DB now 21 Active = 20 business rules + 1 stray `collection.parse.example.cr-lakh-units`
  (NOT in any snapshot; left untouched, flagged to user). Recoverable from Notion trash ~30d.
  Token used from `IE AI Rulebook Project/ie-agent-rules/.env.local`.

## CRITICAL Util deploy caveat (from 1b)
Code stopped writing `auto_score`, but the live column is still `NOT NULL`. Apply
migration `app/drizzle/0006_autoscore_nullable.sql` (`auto_score DROP NOT NULL`)
DIRECTLY to the DB before/with deploying (drizzle journal drift → don't trust `drizzle-kit migrate`).

## Next (Phase 1 fully done)
- **Phase 2** peer bandwidth email — build on Util `cleanup/rules-rationalization` branch; render a sample for approval before any send (gated by env flag + no deploy).
- **Phase 3** ie-checkin Jobs A-E (E trivial, A/B medium, C/D need own plan).
- **Phase 4** engine migration old→new + auto-bump — now UNBLOCKED (Notion trimmed to 20). Sync 20 business rules into ie-ai-rulebook's empty slices, repoint apps, retire old engine.
- Open: stray `collection.parse.example.cr-lakh-units` Active rule — decide keep/retire.

## Standing rules
- No deploys until user green-lights the live steps.
- Never write user data (Notion/ops bases) without showing content + explicit approval.
- Don't break Monday Util cron (`/api/cron/start-cycle`). ie-checkin: off-cycle deploys only.
- Commit local branches only; never `git add -A` in ie-checkin (untracked docs/scripts).
