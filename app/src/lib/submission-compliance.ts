/**
 * Forward-only bandwidth-submission compliance rules.
 *
 * The cron route records one immutable check per required form at the Monday
 * deadline, then passes those checks here. Keeping the evaluator free of I/O
 * makes the streak rules easy to test and protects the historical audit trail.
 */

export type DeadlineOutcome = 'on_time' | 'missed';
export type ComplianceClassification = 'none' | 'category_1' | 'category_2' | 'both';

export interface DeadlineCheck {
  cycleStartDate: string;
  outcome: DeadlineOutcome;
}

export interface ComplianceEvidence {
  classification: ComplianceClassification;
  totalMisses: number;
  category1Streaks: string[][];
  category2Episodes: string[][];
}

export interface ClassificationTransition extends ComplianceEvidence {
  previousClassification: ComplianceClassification;
  changed: boolean;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Monday 13:00 IST as a UTC instant for a cycle's YYYY-MM-DD start date. */
export function deadlineAt(cycleStartDate: string): Date {
  return new Date(`${cycleStartDate}T07:30:00.000Z`);
}

/** Calendar day in IST, kept here so the cron never relies on server timezone. */
export function istDate(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * A token marked not_needed before the checkpoint is exempt. A missing timestamp
 * is deliberately a miss even if the status says submitted: it cannot prove the
 * form met the deadline.
 */
export function deadlineOutcome(params: {
  status: 'pending' | 'submitted' | 'not_needed';
  submittedAt: Date | null;
  notNeededAt?: Date | null;
  statusUpdatedAt?: Date | null;
  deadline: Date;
}): DeadlineOutcome | null {
  // A late cron run must respect an exemption that was active at the deadline,
  // even if an admin re-enabled the token later that afternoon.
  const exemptionWasActive = !!params.notNeededAt
    && params.notNeededAt.getTime() <= params.deadline.getTime()
    && (params.status === 'not_needed'
      || !params.statusUpdatedAt
      || params.statusUpdatedAt.getTime() > params.deadline.getTime());
  if (exemptionWasActive) return null;
  // Legacy rows have no status timestamp. They predate the forward-only cutover,
  // but retain the prior admin meaning if one is inspected manually.
  if (params.status === 'not_needed' && !params.notNeededAt) return null;
  if (!params.submittedAt) return 'missed';
  return params.submittedAt.getTime() <= params.deadline.getTime() ? 'on_time' : 'missed';
}

function toUtcMidnight(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getTime();
}

function areConsecutiveMondays(previous: string, current: string): boolean {
  return toUtcMidnight(current) - toUtcMidnight(previous) === WEEK_MS;
}

/**
 * Return maximal calendar-Monday miss runs. An on-time check, a week without a
 * required form, or any non-consecutive date ends the current run.
 */
export function missedEpisodes(checks: DeadlineCheck[]): string[][] {
  const ordered = [...checks].sort((a, b) => a.cycleStartDate.localeCompare(b.cycleStartDate));
  const episodes: string[][] = [];
  let current: string[] = [];
  let previous: DeadlineCheck | null = null;

  for (const check of ordered) {
    const continues = check.outcome === 'missed'
      && previous?.outcome === 'missed'
      && areConsecutiveMondays(previous.cycleStartDate, check.cycleStartDate);

    if (check.outcome === 'missed') {
      if (continues) current.push(check.cycleStartDate);
      else {
        if (current.length > 0) episodes.push(current);
        current = [check.cycleStartDate];
      }
    } else if (current.length > 0) {
      episodes.push(current);
      current = [];
    }

    previous = check;
  }

  if (current.length > 0) episodes.push(current);
  return episodes;
}

export function evaluateCompliance(checks: DeadlineCheck[]): ComplianceEvidence {
  const episodes = missedEpisodes(checks);
  const category1Streaks = episodes.filter(episode => episode.length >= 3);
  const category2Episodes = episodes.filter(episode => episode.length >= 2);
  const category1 = category1Streaks.length > 0;
  const category2 = category2Episodes.length >= 3;

  const classification: ComplianceClassification = category1 && category2
    ? 'both'
    : category1
      ? 'category_1'
      : category2
        ? 'category_2'
        : 'none';

  return {
    classification,
    totalMisses: checks.filter(check => check.outcome === 'missed').length,
    category1Streaks,
    category2Episodes,
  };
}

/**
 * Qualification is permanent once earned. A report is needed only when this
 * week's immutable check changes a person from no flag/single flag to a new
 * classification.
 */
export function evaluateTransition(
  checks: DeadlineCheck[],
  currentCycleStartDate: string,
): ClassificationTransition {
  const current = evaluateCompliance(checks);
  const previous = evaluateCompliance(
    checks.filter(check => check.cycleStartDate < currentCycleStartDate),
  );

  return {
    ...current,
    previousClassification: previous.classification,
    changed: current.classification !== 'none' && current.classification !== previous.classification,
  };
}

export function formatComplianceDate(cycleStartDate: string): string {
  return new Date(`${cycleStartDate}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
