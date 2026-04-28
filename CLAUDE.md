# Utilization MIS

Building a people-focused reporting layer that gives leadership persistent visibility into team capacity and workload at IndigoEdge.

## What This Is

An internal MIS project for IndigoEdge. Replaces weekly bandwidth meetings with automated data collection from VPs and associates, produces a month-by-month utilization view calibrated to each person's capacity, and provides drill-down detail per person.

For the full problem breakdown, objectives, and proposed solutions, see `problem-statement.md` (read on first session, reference as needed after).

## Project Layers

Three deliverables, in priority order:

1. **Automated bandwidth collection** — Replace weekly meetings with async VP/associate submissions. Cross-check, flag discrepancies, summarize for Founder's Office sign-off (currently Ajder).
2. **Month-by-month utilization view** (Pai's ask) — Per-person utilization across the current IY, calibrated to actual capacity. Display both percentage of calibrated capacity and absolute values (bandwidth score / mandate equivalents). Exact absolute format TBD.
3. **Person drill-down view** (Shiv's ask) — Select a fellow and see their month-by-month breakdown: % utilization, absolute bandwidth score, number of projects by type, and what those projects are.

## Key Concept: Capacity Calibration

Raw mandate counts are misleading. An Associate 3 can handle ~3 mandates while an Associate 1 can handle ~1. Utilization must be expressed as a percentage of each person's calibrated capacity (using the existing bandwidth scoring table converted to mandate equivalent units).

## Key People

- **Pai** — wants the month-by-month utilization view
- **Shiv** — wants the person drill-down view
- **VPs and Associates** — submit bandwidth updates
- **Ajder (FO)** — reviews and signs off on summarized data

## Project Memory & Progress (Foundational — Read Every Session)

These two files are the living foundation of this project. **Read both at the start of every session** before doing any work.

- **[MEMORY.md](MEMORY.md)** — Institutional memory. Decisions (with rationale), learnings, open questions, and assumptions.
- **[PROGRESS TRACKER.md](PROGRESS%20TRACKER.md)** — Operational status. Current focus, workstream status, activity log, upcoming milestones, blockers.

### Update Protocol

- **Never write to either file without explicit user approval.** No exceptions.
- **Flag potential updates at the logical end of a workstream.** When a piece of work concludes — a decision is made, a task is completed, something is learned, a question is resolved — collect all relevant updates and present them to the user in a single batch.
- **Present updates clearly before writing.** Show the exact proposed additions/changes to each file (which section, what content) and wait for explicit approval before making any edit.
- **Do not update mid-stream.** Accumulate potential updates as the work progresses, then present them together at the natural conclusion point.
- **Each file has its own instructions at the top** — follow those in addition to this protocol.

## Context Files

All supporting context documents live in the `Context Files/` subfolder. Refer to these as needed:

- **[Obsidian Notes Index.md](Context%20Files/Obsidian%20Notes%20Index.md)** — Index of Obsidian vault notes relevant to this project with descriptions. For deeper context on strategy, people, or prior work, read the referenced notes from the vault.

## Obsidian Vault

Source documents and related notes live in the Obsidian vault (see `~/.claude/CLAUDE.md` for the current path on this device). When working with vault files, use the `obsidian:obsidian-markdown` skill.
