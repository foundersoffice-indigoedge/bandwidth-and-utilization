/**
 * signoff-scope.ts — pure (no I/O), unit-testable.
 *
 * Determines which directors are *expected* to sign off on a cycle: current
 * directors who have at least one staffed (≥1 team member) project. Shared by the
 * finalize gate (cycle.ts) and the peer-email sign-off banner so both agree on
 * who counts. Kept out of cycle.ts because that module imports the Resend client.
 */

interface ProjectScope {
  vpAvpIds: string[];
  associateIds: string[];
  directorIds: string[];
}

/**
 * @param allProjects        All project assignments for the cycle.
 * @param currentDirectorIds Record IDs of people who are currently directors.
 *                           Filters out ex-directors and VPs that happen to sit
 *                           in a project's director field — neither produces a
 *                           sign-off, so neither should be "expected".
 */
export function getExpectedDirectorIds(
  allProjects: ProjectScope[],
  currentDirectorIds: Set<string>,
): Set<string> {
  const expected = new Set<string>();
  for (const p of allProjects) {
    if (p.vpAvpIds.length + p.associateIds.length === 0) continue; // unstaffed → out of scope
    for (const dirId of p.directorIds) {
      if (currentDirectorIds.has(dirId)) expected.add(dirId);
    }
  }
  return expected;
}
