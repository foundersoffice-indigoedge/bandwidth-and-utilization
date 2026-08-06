# Current State

> Single-file briefing for new sessions. Overwrite this file after each milestone.
> For historical context, decision rationale, or activity history, see MEMORY.md and PROGRESS TRACKER.md at the project root.
>
> **Last updated:** 2026-07-29 (project workspace setup)

## Current Phase

**Project setup and operating-model discovery.** The workspace exists and its source indexes are populated. No new application code, schema, infrastructure, migration, or production change exists yet.

### Before You Start Working

1. Read `../MEMORY.md`, `../PROGRESS TRACKER.md`, and this file.
2. Use `../DIRECTORY.md` to find sources and legacy references.
3. Treat `../../app/` as the current production system and preserve its behavior unless the user explicitly places a legacy change in scope.
4. Check the live source when a conclusion depends on current people, projects, stages, rules, data, deployment, or workflow state.

## What Exists

### Operational Scaffold

- Separate Claude Code and Codex entry points that share one memory, progress tracker, directory, and context layer.
- A dedicated Notion index containing the IY27 direction and the 2 supporting discussions most relevant to capacity and workload.
- An Obsidian index carrying forward the original MIS source note and the verified vault location.
- Explicit separation between this workspace and the live legacy application.

### Source Context Already Identified

- The IY27 direction expands structured workload beyond Mandates, DDEs, and Pitches to research, scoping, company outreach, fund outreach, and internal work.
- Hours show time consumed. MEUs are intended to represent workload intensity, complexity, or responsibility.
- The formation discussion introduces layer and person-specific mandate capacity, sponsored mandate leadership, and coverage targets.
- Team feedback says execution crowds out BD, staffing can ignore existing commitments, and allocation decisions need clearer context and feedback.

## Key Patterns

- **Parallel build:** develop the IY27 system inside this folder while the parent `app/` continues production operation.
- **Source-backed design:** trace each field, threshold, and decision gate to a controlling source and named owner.
- **Separate measures:** keep hours, mandate units, and MEUs distinct until their definitions and relationships are explicitly approved.
- **Cutover discipline:** preserve historical reporting, production continuity, cron ownership, and a rollback path before archiving the legacy version.

## Gotchas

- **IY convention:** IndigoEdge Investment Years run July to June.
- **Legacy MEU history:** the current application removed its old MEU model after moving to a flat weekly-hours benchmark. The IY27 definition needs a fresh decision before any restoration or migration.
- **Mixed time horizons:** weekly workload, monthly reporting, mandate-duration capacity, and quarterly coverage targets require an explicit aggregation model.
- **Root-relative paths:** references in this file start from `Context Files/`; the legacy app is therefore `../../app/`.

## Key Files Quick Reference

| File | What it does |
|---|---|
| `../CLAUDE.md` | Claude Code project context and boundary. |
| `../AGENTS.md` | Codex project context and boundary. |
| `../DIRECTORY.md` | Complete workspace and legacy-source map. |
| `../MEMORY.md` | Approved decisions, learnings, questions, and assumptions. |
| `../PROGRESS TRACKER.md` | Approved execution status. |
| `Notion Notes Index.md` | IY27 Notion source map. |
| `Obsidian Notes Index.md` | Obsidian source map. |
| `../../app/` | Current production application. |
| `../../Context Files/Scoring Table.pdf` | Original workload intensity and MEU reference. |

