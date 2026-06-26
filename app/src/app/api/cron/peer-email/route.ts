import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cycles, tokens, conflicts, submissions } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { fetchEligibleFellows, fetchDirectors } from '@/lib/airtable/fellows';
import { fetchAllProjects } from '@/lib/airtable/projects';
import { getSignoffState } from '@/lib/cycle';
import { sendPeerBandwidthEmails } from '@/lib/email';
import { istDayOfWeek, currentCycleStartDate, decidePeerEmail } from '@/lib/peer-email-schedule';

/**
 * Peer bandwidth email — time trigger (decoupled from cycle finalization / director
 * sign-off). Scheduled at Tue 10:00 / 14:00 / 17:00 IST (conditional: all submitted
 * AND no open conflicts) and Wed 09:00 IST (unconditional fallback). Exactly one
 * email per cycle, enforced by an atomic claim on cycles.peerEmailsSent.
 *
 * Manual run: append ?force=true to send now regardless of weekday/readiness
 * (still respects the rollout gate and the once-per-cycle claim).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rollout gate: feature is off until this env is set.
  const enabledFrom = process.env.PEER_EMAIL_ENABLED_FROM;
  if (!enabledFrom) {
    return NextResponse.json({ message: 'Peer emails disabled (PEER_EMAIL_ENABLED_FROM unset)' });
  }

  const now = new Date();
  const force = req.nextUrl.searchParams.get('force') === 'true';
  const weekStart = currentCycleStartDate(now);

  // Look the cycle up by this IST week's Monday — not the latest DB row, which
  // could be a stale or test cycle. orderBy(createdAt desc) makes the pick
  // deterministic if a duplicate cycle exists for the same Monday (force/test runs).
  const [cycle] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.startDate, weekStart))
    .orderBy(desc(cycles.createdAt))
    .limit(1);

  if (!cycle) {
    return NextResponse.json({ message: `No cycle for week of ${weekStart}` });
  }
  if (cycle.startDate < enabledFrom) {
    return NextResponse.json({ message: `Cycle ${cycle.startDate} predates PEER_EMAIL_ENABLED_FROM` });
  }
  if (cycle.peerEmailsSent) {
    return NextResponse.json({ message: 'Peer emails already sent for this cycle' });
  }

  // Decide whether to send now (skipped under ?force=true).
  const istDay = istDayOfWeek(now);
  let trigger: string;
  if (force) {
    trigger = 'manual';
  } else {
    const [pendingTokens, pendingConflicts] = await Promise.all([
      db.select().from(tokens).where(and(eq(tokens.cycleId, cycle.id), eq(tokens.status, 'pending'))),
      db.select().from(conflicts).where(and(eq(conflicts.cycleId, cycle.id), eq(conflicts.status, 'pending'))),
    ]);
    const decision = decidePeerEmail({
      istDay,
      pendingTokens: pendingTokens.length,
      pendingConflicts: pendingConflicts.length,
    });
    if (!decision.send) {
      return NextResponse.json({ message: `Holding: ${decision.reason}`, istDay });
    }
    trigger = decision.trigger;
  }

  // Atomic claim: only the invocation that flips false→true proceeds. Guards
  // against concurrent crons / retries double-sending.
  const claimed = await db
    .update(cycles)
    .set({ peerEmailsSent: true })
    .where(and(eq(cycles.id, cycle.id), eq(cycles.peerEmailsSent, false)))
    .returning({ id: cycles.id });

  if (claimed.length === 0) {
    return NextResponse.json({ message: 'Peer emails already claimed by a concurrent run' });
  }

  try {
    const [allSubmissions, fellows, allProjects, currentDirectors, cycleTokens, openConflicts] = await Promise.all([
      db.select().from(submissions).where(eq(submissions.cycleId, cycle.id)),
      fetchEligibleFellows(),
      fetchAllProjects(),
      fetchDirectors(),
      db.select().from(tokens).where(eq(tokens.cycleId, cycle.id)),
      db.select().from(conflicts).where(and(eq(conflicts.cycleId, cycle.id), eq(conflicts.status, 'pending'))),
    ]);

    // Source of truth for "not yet submitted": tokens still pending (not absence of
    // submissions, which would wrongly flag no-project / not_needed fellows).
    const pendingFellowIds = new Set(
      cycleTokens.filter(t => t.status === 'pending').map(t => t.fellowRecordId),
    );

    const signoffState = await getSignoffState(cycle.id, allProjects, currentDirectors);

    const result = await sendPeerBandwidthEmails(
      allSubmissions,
      fellows,
      allProjects,
      cycle.startDate,
      pendingFellowIds,
      { signoffPending: signoffState === 'pending', conflictsPending: openConflicts.length > 0 },
    );

    // Every send failed → release the claim so a later checkpoint can retry
    // (e.g. Resend was down). Partial failures keep the claim to avoid re-emailing
    // the recipients who already got it.
    if (result.attempted > 0 && result.sent === 0) {
      await db.update(cycles).set({ peerEmailsSent: false }).where(eq(cycles.id, cycle.id));
      return NextResponse.json(
        { error: 'All peer emails failed; claim released for retry', trigger, ...result },
        { status: 500 },
      );
    }

    // No recipients is a legitimate state (nobody shares a project) but also what a
    // broken assemble/Airtable shape would produce — surface it distinctly rather
    // than as a silent "sent: 0" success.
    if (result.attempted === 0) {
      return NextResponse.json({
        message: 'No peer-email recipients (no fellows share a project); marked sent',
        trigger,
        signoffState,
        ...result,
      });
    }

    return NextResponse.json({
      message: `Peer emails sent (${trigger})`,
      trigger,
      signoffState,
      pendingCount: pendingFellowIds.size,
      conflictsPending: openConflicts.length > 0,
      ...result,
    });
  } catch (err) {
    // Unexpected failure before/around sending → release the claim.
    await db.update(cycles).set({ peerEmailsSent: false }).where(eq(cycles.id, cycle.id));
    console.error('peer bandwidth emails failed', err);
    return NextResponse.json({ error: 'Peer emails failed; claim released for retry' }, { status: 500 });
  }
}
