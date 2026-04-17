'use client';

import { useState } from 'react';
import type { SnapshotData, LiveCycleData, LiveFellowData } from './page';
import type { ProjectBreakdownItem } from '@/types';

const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function getLoadTag(util: number): string {
  if (util < 0.30) return 'Free';
  if (util < 0.60) return 'Comfortable';
  if (util < 0.85) return 'Busy';
  if (util <= 1.00) return 'At Capacity';
  return 'Overloaded';
}

function getLoadColor(tag: string): string {
  switch (tag) {
    case 'Free':
    case 'Comfortable':
      return 'bg-green-100 text-green-800';
    case 'Busy':
      return 'bg-yellow-100 text-yellow-800';
    case 'At Capacity':
      return 'bg-orange-100 text-orange-800';
    case 'Overloaded':
      return 'bg-red-100 text-red-800';
    default:
      return '';
  }
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  mandate: { label: 'Mandate', color: 'text-blue-700' },
  dde: { label: 'DDE', color: 'text-teal-700' },
  pitch: { label: 'Pitch', color: 'text-violet-700' },
};

/** Sort order: VP first, then AVP, Associate 3, 2, 1, Analyst. Alphabetical within each tier. */
const DESIGNATION_RANK: Record<string, number> = {
  VP: 0,
  AVP: 1,
  'Associate 3': 2,
  'Associate 2': 3,
  'Associate 1': 4,
  Analyst: 5,
};

function compareByDesignationThenName(
  aDesig: string, aName: string,
  bDesig: string, bName: string,
): number {
  const aRank = DESIGNATION_RANK[aDesig] ?? 99;
  const bRank = DESIGNATION_RANK[bDesig] ?? 99;
  if (aRank !== bRank) return aRank - bRank;
  return aName.localeCompare(bName);
}

/** Map a snapshot date to the IY month index (Jul=0, Aug=1, ... Jun=11). */
function toMonthIdx(dateStr: string): number {
  const d = new Date(dateStr);
  return (d.getMonth() + 6) % 12;
}

/**
 * For a given calendar month + year, define 4 week ranges.
 * Week 1 = days 1-7, Week 2 = 8-14, Week 3 = 15-21, Week 4 = 22-end.
 * Returns [start, end] date strings for each week.
 */
function getWeekRanges(monthIdx: number, iy: number): { label: string; start: Date; end: Date }[] {
  // Convert IY month index back to real month/year
  const realMonth = (monthIdx + 6) % 12; // Jul(idx=0) → month 6, Jan(idx=6) → month 0
  const year = monthIdx < 6 ? iy - 1 : iy; // Jul-Dec → iy-1, Jan-Jun → iy

  const daysInMonth = new Date(year, realMonth + 1, 0).getDate();

  return [
    { label: 'Week 1 (1–7)', start: new Date(year, realMonth, 1), end: new Date(year, realMonth, 7, 23, 59, 59) },
    { label: 'Week 2 (8–14)', start: new Date(year, realMonth, 8), end: new Date(year, realMonth, 14, 23, 59, 59) },
    { label: 'Week 3 (15–21)', start: new Date(year, realMonth, 15), end: new Date(year, realMonth, 21, 23, 59, 59) },
    { label: `Week 4 (22–${daysInMonth})`, start: new Date(year, realMonth, 22), end: new Date(year, realMonth, daysInMonth, 23, 59, 59) },
  ];
}

/**
 * Find which snapshot covers a given week.
 * A snapshot's cycle covers snapshotDate to snapshotDate + 13 days.
 * Match if the week and cycle overlap at all (not just midpoint).
 * If multiple cycles overlap, pick the latest one.
 */
function findSnapshotForWeek(
  weekStart: Date,
  weekEnd: Date,
  snaps: SnapshotData[]
): SnapshotData | null {
  let best: SnapshotData | null = null;

  for (const snap of snaps) {
    const cycleStart = new Date(snap.snapshotDate);
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setDate(cycleEnd.getDate() + 13);
    cycleEnd.setHours(23, 59, 59);

    // Week and cycle overlap if week starts before cycle ends AND week ends after cycle starts
    if (weekStart <= cycleEnd && weekEnd >= cycleStart) {
      if (!best || snap.snapshotDate > best.snapshotDate) {
        best = snap;
      }
    }
  }
  return best;
}

// --- Overview Grid ---

function OverviewGrid({
  fellowIds,
  fellowNames,
  fellowMonthSnaps,
  onSelectFellow,
}: {
  fellowIds: string[];
  fellowNames: Map<string, string>;
  fellowMonthSnaps: Map<string, Map<number, SnapshotData[]>>;
  onSelectFellow: (id: string) => void;
}) {
  if (fellowIds.length === 0) {
    return (
      <p className="text-gray-500 text-sm mt-8">No snapshot data for this IY yet.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="border p-2 text-left sticky left-0 bg-gray-50 z-10">Fellow</th>
            {MONTHS.map(m => (
              <th key={m} className="border p-2 text-center min-w-[100px]">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fellowIds.map(fid => {
            const months = fellowMonthSnaps.get(fid)!;
            return (
              <tr key={fid}>
                <td className="border p-2 font-medium sticky left-0 bg-white z-10">
                  <button
                    onClick={() => onSelectFellow(fid)}
                    className="text-blue-600 hover:underline text-left"
                  >
                    {fellowNames.get(fid)}
                  </button>
                </td>
                {MONTHS.map((_, idx) => {
                  const snaps = months.get(idx);
                  if (!snaps || snaps.length === 0) {
                    return <td key={idx} className="border p-2 text-center text-gray-300">—</td>;
                  }
                  const n = snaps.length;
                  const avgUtil = snaps.reduce((s, snap) => s + (snap.hoursUtilizationPct ?? snap.utilizationPct), 0) / n;
                  const avgHpw = snaps.reduce((s, snap) => s + (snap.totalHoursPerWeek ?? 0), 0) / n;
                  const tag = getLoadTag(avgUtil);
                  return (
                    <td
                      key={idx}
                      className={`border p-2 text-center text-xs ${getLoadColor(tag)}`}
                    >
                      <div className="font-medium">{Math.round(avgUtil * 100)}%</div>
                      <div className="text-[10px] opacity-75">
                        {avgHpw.toFixed(1)} / 84 hrs
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Project Breakdown Table ---

function ProjectBreakdownTable({ breakdown }: { breakdown: ProjectBreakdownItem[] }) {
  if (breakdown.length === 0) return null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50">
            <th className="p-2 text-left">Project</th>
            <th className="p-2 text-center">Type</th>
            <th className="p-2 text-center">Hrs/Day</th>
            <th className="p-2 text-center">Hrs/Week</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((b, i) => {
            const typeInfo = TYPE_LABELS[b.projectType] || { label: b.projectType, color: '' };
            return (
              <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                <td className="p-2">{b.projectName}</td>
                <td className={`p-2 text-center uppercase text-[11px] font-medium ${typeInfo.color}`}>
                  {typeInfo.label}
                </td>
                <td className="p-2 text-center">{b.hoursPerDay}</td>
                <td className="p-2 text-center">{b.hoursPerWeek != null ? b.hoursPerWeek.toFixed(1) : (b.hoursPerDay * 5).toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Drill Down View ---

function DrillDown({
  fellowId,
  fellowSnapshots,
  iy,
  onBack,
}: {
  fellowId: string;
  fellowSnapshots: SnapshotData[];
  iy: number;
  onBack: () => void;
}) {
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  if (fellowSnapshots.length === 0) {
    return (
      <div>
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline mb-4">
          ← Back to overview
        </button>
        <p className="text-gray-500">No data for this fellow.</p>
      </div>
    );
  }

  const fellowName = fellowSnapshots[0].fellowName;
  const designation = fellowSnapshots[0].designation;

  // Group snapshots by month for week mapping and monthly averages
  const monthSnapshots = new Map<number, SnapshotData[]>();

  for (const snap of fellowSnapshots) {
    const idx = toMonthIdx(snap.snapshotDate);
    const list = monthSnapshots.get(idx) || [];
    list.push(snap);
    monthSnapshots.set(idx, list);
  }

  function toggleMonth(idx: number) {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
        // Also collapse any expanded weeks in this month
        setExpandedWeeks(prevWeeks => {
          const nextWeeks = new Set(prevWeeks);
          for (const key of prevWeeks) {
            if (key.startsWith(`${idx}-`)) nextWeeks.delete(key);
          }
          return nextWeeks;
        });
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  function toggleWeek(monthIdx: number, weekIdx: number) {
    const key = `${monthIdx}-${weekIdx}`;
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
        ← Back to overview
      </button>

      <div className="mt-4 mb-6">
        <h2 className="text-xl font-bold">{fellowName}</h2>
        <p className="text-sm text-gray-500">
          {designation} · Capacity: 84 hrs/week · IY{iy}
        </p>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="border p-2 text-left">Month</th>
            <th className="border p-2 text-center">Utilization</th>
            <th className="border p-2 text-center">Hrs/Week</th>
            <th className="border p-2 text-center">Mandates</th>
            <th className="border p-2 text-center">DDEs</th>
            <th className="border p-2 text-center">Pitches</th>
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((monthName, idx) => {
            const isExpanded = expandedMonths.has(idx);
            const snaps = monthSnapshots.get(idx) || [];
            const weeks = getWeekRanges(idx, iy);

            if (snaps.length === 0) {
              return (
                <tr key={idx}>
                  <td className="border p-2 text-gray-400">{monthName}</td>
                  <td className="border p-2 text-center text-gray-300" colSpan={5}>—</td>
                </tr>
              );
            }

            // Average across all snapshots in this month
            const n = snaps.length;
            const avgUtil = snaps.reduce((s, snap) => s + (snap.hoursUtilizationPct ?? snap.utilizationPct), 0) / n;
            const avgHpw = snaps.reduce((s, snap) => s + (snap.totalHoursPerWeek ?? 0), 0) / n;
            const avgMandates = snaps.reduce((s, snap) => s + snap.projectBreakdown.filter(b => b.projectType === 'mandate').length, 0) / n;
            const avgDdes = snaps.reduce((s, snap) => s + snap.projectBreakdown.filter(b => b.projectType === 'dde').length, 0) / n;
            const avgPitches = snaps.reduce((s, snap) => s + snap.projectBreakdown.filter(b => b.projectType === 'pitch').length, 0) / n;
            const avgLoadTag = getLoadTag(avgUtil);

            const rows: React.ReactNode[] = [];

            // Month summary row (averages)
            rows.push(
              <tr
                key={idx}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => toggleMonth(idx)}
              >
                <td className="border p-2 font-medium">
                  <span className="mr-2 text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                  {monthName}
                </td>
                <td className={`border p-2 text-center font-medium ${getLoadColor(avgLoadTag)}`}>
                  {Math.round(avgUtil * 100)}%
                </td>
                <td className="border p-2 text-center">
                  {avgHpw.toFixed(1)} / 84
                </td>
                <td className="border p-2 text-center">{avgMandates % 1 === 0 ? avgMandates : avgMandates.toFixed(1)}</td>
                <td className="border p-2 text-center">{avgDdes % 1 === 0 ? avgDdes : avgDdes.toFixed(1)}</td>
                <td className="border p-2 text-center">{avgPitches % 1 === 0 ? avgPitches : avgPitches.toFixed(1)}</td>
              </tr>
            );

            // Week rows when expanded
            if (isExpanded) {
              weeks.forEach((week, wIdx) => {
                const weekSnap = findSnapshotForWeek(week.start, week.end, fellowSnapshots);
                const weekKey = `${idx}-${wIdx}`;
                const weekExpanded = expandedWeeks.has(weekKey);

                if (!weekSnap) {
                  rows.push(
                    <tr key={`${idx}-w${wIdx}`} className="bg-gray-50/50">
                      <td className="border p-2 pl-8 text-xs text-gray-400">{week.label}</td>
                      <td className="border p-2 text-center text-gray-300 text-xs" colSpan={5}>—</td>
                    </tr>
                  );
                  return;
                }

                const wb = weekSnap.projectBreakdown;
                const wMandates = wb.filter(b => b.projectType === 'mandate').length;
                const wDdes = wb.filter(b => b.projectType === 'dde').length;
                const wPitches = wb.filter(b => b.projectType === 'pitch').length;

                rows.push(
                  <tr
                    key={`${idx}-w${wIdx}`}
                    className="bg-gray-50/50 cursor-pointer hover:bg-gray-100"
                    onClick={(e) => { e.stopPropagation(); toggleWeek(idx, wIdx); }}
                  >
                    <td className="border p-2 pl-8 text-xs text-gray-600">
                      <span className="mr-1.5 text-gray-400 text-[10px]">{weekExpanded ? '▼' : '▶'}</span>
                      {week.label}
                    </td>
                    <td className={`border p-2 text-center text-xs ${getLoadColor(weekSnap.hoursLoadTag ?? weekSnap.loadTag)}`}>
                      {Math.round((weekSnap.hoursUtilizationPct ?? weekSnap.utilizationPct) * 100)}%
                    </td>
                    <td className="border p-2 text-center text-xs">
                      {(weekSnap.totalHoursPerWeek ?? 0).toFixed(1)} / 84
                    </td>
                    <td className="border p-2 text-center text-xs">{wMandates}</td>
                    <td className="border p-2 text-center text-xs">{wDdes}</td>
                    <td className="border p-2 text-center text-xs">{wPitches}</td>
                  </tr>
                );

                // Project breakdown when week is expanded
                if (weekExpanded) {
                  rows.push(
                    <tr key={`${idx}-w${wIdx}-breakdown`}>
                      <td colSpan={6} className="border p-3 bg-white">
                        <ProjectBreakdownTable breakdown={weekSnap.projectBreakdown} />
                      </td>
                    </tr>
                  );
                }
              });
            }

            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Live Cycle Section ---

function formatDateRange(startDate: string): string {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return `${start.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function LiveCycleSection({
  liveCycle,
  onSelectFellow,
}: {
  liveCycle: LiveCycleData;
  onSelectFellow: (id: string) => void;
}) {
  const { submittedFellows, pendingFellows, pendingConflicts, startDate } = liveCycle;
  const total = submittedFellows.length + pendingFellows.length;
  const dateRange = formatDateRange(startDate);

  // Sort by designation hierarchy, then alphabetically within each tier
  const sorted = [...submittedFellows].sort((a, b) =>
    compareByDesignationThenName(a.designation, a.fellowName, b.designation, b.fellowName)
  );

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold">Current Cycle</h2>
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
          Live
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        {dateRange} · {submittedFellows.length} of {total} submitted
        {pendingConflicts > 0 && ` · ${pendingConflicts} conflict${pendingConflicts !== 1 ? 's' : ''} pending`}
      </p>

      {sorted.length > 0 && (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="border p-2 text-left">Fellow</th>
                <th className="border p-2 text-left">Role</th>
                <th className="border p-2 text-center">Hrs/Week</th>
                <th className="border p-2 text-center">Utilization</th>
                <th className="border p-2 text-center">Load</th>
                <th className="border p-2 text-center">Mandates</th>
                <th className="border p-2 text-center">DDEs</th>
                <th className="border p-2 text-center">Pitches</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f, i) => {
                const mandates = f.projectBreakdown.filter(b => b.projectType === 'mandate').length;
                const ddes = f.projectBreakdown.filter(b => b.projectType === 'dde').length;
                const pitches = f.projectBreakdown.filter(b => b.projectType === 'pitch').length;
                return (
                  <tr key={f.fellowRecordId} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                    <td className="border p-2 font-medium">
                      <button
                        onClick={() => onSelectFellow(f.fellowRecordId)}
                        className="text-blue-600 hover:underline text-left"
                      >
                        {f.fellowName}
                      </button>
                      {f.hasConflict && (
                        <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded" title="Has pending conflict">
                          conflict
                        </span>
                      )}
                    </td>
                    <td className="border p-2 text-gray-600 text-xs">{f.designation}</td>
                    <td className="border p-2 text-center">{f.totalHoursPerWeek.toFixed(1)} / 84</td>
                    <td className={`border p-2 text-center font-medium ${getLoadColor(f.loadTag)}`}>
                      {Math.round(f.hoursUtilizationPct * 100)}%
                    </td>
                    <td className="border p-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getLoadColor(f.loadTag)}`}>
                        {f.loadTag}
                      </span>
                    </td>
                    <td className="border p-2 text-center">{mandates}</td>
                    <td className="border p-2 text-center">{ddes}</td>
                    <td className="border p-2 text-center">{pitches}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingFellows.length > 0 && (
        <details className="text-sm">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
            {pendingFellows.length} pending
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {pendingFellows
              .sort((a, b) => compareByDesignationThenName(a.designation, a.name, b.designation, b.name))
              .map(f => (
                <span key={f.name} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                  {f.name}
                </span>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}

// --- Live Fellow Drill-Down ---

function LiveDrillDown({
  fellow,
  onBack,
}: {
  fellow: LiveFellowData;
  onBack: () => void;
}) {
  return (
    <div>
      <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
        ← Back to overview
      </button>

      <div className="mt-4 mb-2 flex items-center gap-3">
        <h2 className="text-xl font-bold">{fellow.fellowName}</h2>
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
          Live
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {fellow.designation} · Capacity: 84 hrs/week ·{' '}
        <span className="font-medium">{fellow.totalHoursPerWeek.toFixed(1)} hrs/week</span> ·{' '}
        <span className={`font-medium ${getLoadColor(fellow.loadTag)} px-1.5 rounded`}>
          {Math.round(fellow.hoursUtilizationPct * 100)}% — {fellow.loadTag}
        </span>
        {fellow.hasConflict && (
          <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
            has pending conflict
          </span>
        )}
      </p>

      <ProjectBreakdownTable breakdown={fellow.projectBreakdown} />
    </div>
  );
}

// --- Main Dashboard View ---

export function DashboardView({
  snapshots,
  iy,
  liveCycle,
}: {
  snapshots: SnapshotData[];
  iy: number;
  liveCycle: LiveCycleData | null;
}) {
  const [selectedFellow, setSelectedFellow] = useState<string | null>(null);
  const [selectedLiveFellow, setSelectedLiveFellow] = useState<string | null>(null);

  // Build overview data structures
  const fellowMonthSnaps = new Map<string, Map<number, SnapshotData[]>>();
  const fellowNames = new Map<string, string>();
  const fellowDesignations = new Map<string, string>();
  const fellowAllSnapshots = new Map<string, SnapshotData[]>();

  for (const snap of snapshots) {
    const monthIdx = toMonthIdx(snap.snapshotDate);

    // For overview: collect all snapshots per fellow per month
    if (!fellowMonthSnaps.has(snap.fellowRecordId)) {
      fellowMonthSnaps.set(snap.fellowRecordId, new Map());
    }
    const monthMap = fellowMonthSnaps.get(snap.fellowRecordId)!;
    const list = monthMap.get(monthIdx) || [];
    list.push(snap);
    monthMap.set(monthIdx, list);

    fellowNames.set(snap.fellowRecordId, snap.fellowName);
    fellowDesignations.set(snap.fellowRecordId, snap.designation);

    // For drill-down: keep all snapshots per fellow
    const all = fellowAllSnapshots.get(snap.fellowRecordId) || [];
    all.push(snap);
    fellowAllSnapshots.set(snap.fellowRecordId, all);
  }

  const fellowIds = Array.from(fellowMonthSnaps.keys()).sort((a, b) =>
    compareByDesignationThenName(
      fellowDesignations.get(a) || '', fellowNames.get(a) || '',
      fellowDesignations.get(b) || '', fellowNames.get(b) || '',
    )
  );

  // Live fellow drill-down
  if (selectedLiveFellow && liveCycle) {
    const liveFellow = liveCycle.submittedFellows.find(f => f.fellowRecordId === selectedLiveFellow);
    if (liveFellow) {
      return (
        <LiveDrillDown
          fellow={liveFellow}
          onBack={() => setSelectedLiveFellow(null)}
        />
      );
    }
  }

  // Finalized fellow drill-down
  if (selectedFellow) {
    return (
      <DrillDown
        fellowId={selectedFellow}
        fellowSnapshots={fellowAllSnapshots.get(selectedFellow) || []}
        iy={iy}
        onBack={() => setSelectedFellow(null)}
      />
    );
  }

  return (
    <>
      {liveCycle && liveCycle.submittedFellows.length > 0 && (
        <LiveCycleSection
          liveCycle={liveCycle}
          onSelectFellow={(id) => setSelectedLiveFellow(id)}
        />
      )}
      <OverviewGrid
        fellowIds={fellowIds}
        fellowNames={fellowNames}
        fellowMonthSnaps={fellowMonthSnaps}
        onSelectFellow={setSelectedFellow}
      />
    </>
  );
}
