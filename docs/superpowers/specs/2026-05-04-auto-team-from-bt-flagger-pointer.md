# Auto-Team-Assign from BT Flagger Data — BT Side Pointer

**Date:** 2026-05-04
**Status:** Approved (brainstorming complete; ready for implementation plan)

This is a pointer document. The canonical design spec lives in the ie-checkin repo:

`Project Tracking System/ie-checkin/docs/specs/2026-05-04-auto-team-from-bt-flagger-design.md`

## What this means for BT (Utilization MIS)

A small, additive change is required in BT. Both pending-projects GET endpoints currently drop `createdByFellowId` from their SELECT and only return `createdByFellowName`. The ie-checkin drainer needs the record ID to look up the flagger's designation and place them in the correct Airtable Team slot.

## Files to change

- **`app/src/app/api/admin/pending-projects/route.ts`** — Add `createdByFellowId: pendingProjects.createdByFellowId` to the SELECT object in the `GET` handler.
- **`app/src/app/api/admin/pending-projects/[id]/route.ts`** — Same addition to the SELECT object in the single-row `GET` handler.

That's it. No schema migration (column already exists in `pending_projects`). No new endpoint. No breaking change — purely additive JSON field. `teammateRecordIds` is already returned by both endpoints today.

## Deployment ordering

BT must be deployed first so its responses include `createdByFellowId`. Then ie-checkin deploys, with its parser updated to read the new field. The interim period (BT deployed but ie-checkin still on old code) is safe — the existing ie-checkin parser will simply ignore the new field.

## Non-impacts

- No schema migration.
- No new BT endpoint.
- No change to the BT submit form (the data is already collected and stored).
- No change to any other BT consumer (dashboards, reports, the resolve endpoint, the awaiting-setup / confirming / finish endpoints).

## See also

- Canonical spec (cross-project): `Project Tracking System/ie-checkin/docs/specs/2026-05-04-auto-team-from-bt-flagger-design.md`
- Original drainer plan: `docs/superpowers/plans/2026-04-30-pending-projects-bt-endpoints.md`
- Related ie-checkin plan: `Project Tracking System/ie-checkin/docs/plans/2026-04-30-pending-projects-drainer.md`
