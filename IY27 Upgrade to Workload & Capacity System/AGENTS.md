# IY27 Upgrade to Workload & Capacity System

Rebuild IndigoEdge's bandwidth system for IY27 into a complete workload, capacity, and staffing operating system. The new system will cover execution, business development, hours, mandate units, MEUs, decision gates, and allocation learning.

## Scope and Boundary

- Keep all new discovery, design, code, tests, and operating documentation inside this folder.
- The current production system remains at `../app/` and continues operating until the IY27 system completes cutover verification.
- Preserve the legacy system as a rollback path throughout the build.
- Archive legacy version files only after production cutover, historical-data verification, cron handover, and explicit user approval.

## Current Phase

Project setup and operating-model discovery. No application architecture, technology stack, schema, or migration approach has been approved yet.

## Commands

No application commands exist yet. Add verified install, development, test, build, and deployment commands here after the application scaffold is chosen.

## Project Memory & Progress (Foundational, Read Every Session)

These two files are the living foundation of this project. Read both at the start of every session before doing any work.

- **[MEMORY.md](MEMORY.md)**: decisions with rationale, learnings, open questions, and assumptions.
- **[PROGRESS TRACKER.md](PROGRESS%20TRACKER.md)**: current focus, workstreams, activity log, milestones, and blockers.

### Update Protocol

- Never write to either file without explicit user approval.
- Flag potential updates at the logical end of a workstream.
- Show the exact proposed change, its section, and its wording before editing.
- Collect related updates and present them together at the natural conclusion point.
- Follow the instructions at the top of each file.

## Project Directory

**[DIRECTORY.md](DIRECTORY.md)** maps every file and folder in this project, including the legacy references that matter during the upgrade. Read it when orienting or locating a source.

## Context Files

- **[Current State.md](Context%20Files/Current%20State.md)**: current phase, boundaries, established patterns, gotchas, and key files. Read after MEMORY.md and PROGRESS TRACKER.md each session.
- **[Notion Notes Index.md](Context%20Files/Notion%20Notes%20Index.md)**: source Notion pages for the IY27 direction, formation, capacity, and team feedback.
- **[Obsidian Notes Index.md](Context%20Files/Obsidian%20Notes%20Index.md)**: relevant vault notes and the verified vault path.

## Legacy System References

- `../app/`: current production application.
- `../MEMORY.md`: decisions and technical learnings from the legacy system.
- `../PROGRESS TRACKER.md`: legacy release history and operational status.
- `../problem-statement.md`: original Utilization MIS problem statement.
- `../Context Files/Scoring Table.pdf`: original bandwidth intensity and MEU reference.

Treat these as evidence and migration context. Decisions for the IY27 system belong in this folder's MEMORY.md after user confirmation.

## Working Principles

- Use July to June Investment Year boundaries.
- Keep hours, mandate units, and MEUs distinct until their exact relationship is approved.
- Define the operating model, measurement semantics, source ownership, and decision rights before implementation.
- Verify claims against the current repository, live data, or controlling source.
- Preserve historical reporting and rollback paths through cutover.
- Apply changes to the legacy production system only when the user explicitly places them in scope.

