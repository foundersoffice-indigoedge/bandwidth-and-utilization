'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface Fellow {
  fellowRecordId: string;
  name: string;
  designation: string;
}

interface ProjectOption {
  projectRecordId: string;
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
}

interface TimelinePoint {
  cycleId: string;
  cycleStart: string;
  projectName: string;
  projectType: 'mandate' | 'dde' | 'pitch';
  hoursPerWeek: number;
  capacityPct: number;
  autoScore: number;
  source: 'self' | 'projection';
}

type YAxisMode = 'hours' | 'capacity';

const TYPE_BADGE: Record<string, string> = {
  mandate: 'bg-blue-100 text-blue-800',
  dde: 'bg-teal-100 text-teal-800',
  pitch: 'bg-violet-100 text-violet-800',
};

function formatCycleDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function ChartTooltip({
  active,
  payload,
  yMode,
}: {
  active?: boolean;
  payload?: Array<{ payload: TimelinePoint }>;
  yMode: YAxisMode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{formatCycleDate(p.cycleStart)}</div>
      <div className="text-gray-600 mt-1">
        {yMode === 'hours'
          ? `${p.hoursPerWeek.toFixed(1)} hrs/week`
          : `${Math.round(p.capacityPct * 100)}% of capacity`}
      </div>
      <div className="text-gray-500 text-[10px] mt-1">
        {p.source === 'self' ? 'Self-reported' : 'VP projection (no self-report)'}
      </div>
    </div>
  );
}

export function FellowProjectTab() {
  const [fellows, setFellows] = useState<Fellow[]>([]);
  const [availableIys, setAvailableIys] = useState<number[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);

  const [selectedFellow, setSelectedFellow] = useState<string>('');
  const [selectedIys, setSelectedIys] = useState<Set<number>>(new Set());
  const [selectedProject, setSelectedProject] = useState<string>('');

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const [yMode, setYMode] = useState<YAxisMode>('hours');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/dashboard/fellow-project?mode=bootstrap')
      .then(r => r.json())
      .then((data: { fellows: Fellow[]; iys: number[] }) => {
        if (cancelled) return;
        setFellows(data.fellows);
        setAvailableIys(data.iys);
        if (data.iys.length > 0) {
          setSelectedIys(new Set([data.iys[0]]));
        }
        setBootstrapping(false);
      })
      .catch(() => {
        if (!cancelled) setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedFellow || selectedIys.size === 0) {
      setProjects([]);
      setSelectedProject('');
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    const iysQuery = Array.from(selectedIys).join(',');
    fetch(`/api/dashboard/fellow-project?mode=projects&fellow=${encodeURIComponent(selectedFellow)}&iys=${iysQuery}`)
      .then(r => r.json())
      .then((data: { projects: ProjectOption[] }) => {
        if (cancelled) return;
        setProjects(data.projects);
        setProjectsLoading(false);
        // Clear project selection if not in new list
        if (data.projects.length > 0 && !data.projects.find(p => p.projectRecordId === selectedProject)) {
          setSelectedProject('');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          setProjectsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // selectedProject intentionally omitted — we only reset on fellow/IY change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFellow, selectedIys]);

  useEffect(() => {
    if (!selectedFellow || !selectedProject) {
      setTimeline([]);
      return;
    }
    let cancelled = false;
    setTimelineLoading(true);
    fetch(`/api/dashboard/fellow-project?mode=timeline&fellow=${encodeURIComponent(selectedFellow)}&project=${encodeURIComponent(selectedProject)}`)
      .then(r => r.json())
      .then((data: { points: TimelinePoint[] }) => {
        if (cancelled) return;
        setTimeline(data.points);
        setTimelineLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setTimeline([]);
          setTimelineLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFellow, selectedProject]);

  const chartData = useMemo(() => {
    return timeline.map(p => ({
      ...p,
      label: formatCycleDate(p.cycleStart),
      yValue: yMode === 'hours' ? p.hoursPerWeek : p.capacityPct * 100,
    }));
  }, [timeline, yMode]);

  const selectedFellowName = fellows.find(f => f.fellowRecordId === selectedFellow)?.name;
  const selectedProjectMeta = projects.find(p => p.projectRecordId === selectedProject);

  function toggleIy(iy: number) {
    setSelectedIys(prev => {
      const next = new Set(prev);
      if (next.has(iy)) {
        if (next.size > 1) next.delete(iy);
      } else {
        next.add(iy);
      }
      return next;
    });
  }

  if (bootstrapping) {
    return <div className="text-sm text-gray-500 py-8">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fellow</label>
          <select
            value={selectedFellow}
            onChange={e => {
              setSelectedFellow(e.target.value);
              setSelectedProject('');
            }}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="">Select a fellow…</option>
            {fellows.map(f => (
              <option key={f.fellowRecordId} value={f.fellowRecordId}>
                {f.name} ({f.designation})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">IY (multi-select)</label>
          <div className="flex flex-wrap gap-1">
            {availableIys.map(iy => (
              <button
                key={iy}
                type="button"
                onClick={() => toggleIy(iy)}
                className={`px-3 py-1 text-xs rounded border ${
                  selectedIys.has(iy)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                }`}
              >
                IY{iy}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            disabled={!selectedFellow || projectsLoading || projects.length === 0}
          >
            <option value="">
              {projectsLoading
                ? 'Loading projects…'
                : !selectedFellow
                ? 'Select a fellow first'
                : projects.length === 0
                ? 'No projects in selected IYs'
                : 'Select a project…'}
            </option>
            {projects.map(p => (
              <option key={p.projectRecordId} value={p.projectRecordId}>
                {p.projectName} ({p.projectType === 'dde' ? 'DDE' : p.projectType === 'mandate' ? 'Mandate' : 'Pitch'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedFellow && selectedProject && (
        <div className="border rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm text-gray-500">{selectedFellowName}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-medium">{selectedProjectMeta?.projectName}</span>
                {selectedProjectMeta && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${TYPE_BADGE[selectedProjectMeta.projectType]}`}>
                    {selectedProjectMeta.projectType === 'dde' ? 'DDE' : selectedProjectMeta.projectType === 'mandate' ? 'Mandate' : 'Pitch'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => setYMode('hours')}
                className={`px-2 py-1 rounded ${yMode === 'hours' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                Hours/week
              </button>
              <button
                onClick={() => setYMode('capacity')}
                className={`px-2 py-1 rounded ${yMode === 'capacity' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                % of capacity
              </button>
            </div>
          </div>

          {timelineLoading ? (
            <div className="text-sm text-gray-500 py-8">Loading timeline…</div>
          ) : chartData.length === 0 ? (
            <div className="text-sm text-gray-500 py-8">No submissions found for this fellow on this project.</div>
          ) : chartData.length === 1 ? (
            <div className="text-sm text-gray-600 py-4">
              Only one data point: <span className="font-medium">{chartData[0].label}</span> —{' '}
              {yMode === 'hours'
                ? `${chartData[0].hoursPerWeek.toFixed(1)} hrs/week`
                : `${Math.round(chartData[0].capacityPct * 100)}% of capacity`}
              .
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    domain={yMode === 'capacity' ? [0, 'auto'] : [0, 'auto']}
                    label={{
                      value: yMode === 'hours' ? 'Hours / week' : '% of capacity',
                      angle: -90,
                      position: 'insideLeft',
                      style: { fontSize: 11, fill: '#6b7280' },
                    }}
                    tickFormatter={v => (yMode === 'capacity' ? `${v}%` : `${v}`)}
                  />
                  <Tooltip content={<ChartTooltip yMode={yMode} />} />
                  {yMode === 'capacity' && (
                    <ReferenceLine y={100} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'Capacity', fontSize: 10, fill: '#f97316' }} />
                  )}
                  <Line
                    type="monotone"
                    dataKey="yValue"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#2563eb' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {chartData.length > 0 && (
            <div className="mt-4 text-xs text-gray-500">
              {chartData.length} cycle{chartData.length === 1 ? '' : 's'} shown.
              {timeline.some(p => p.source === 'projection') && (
                <span className="ml-2">
                  <span className="inline-block w-2 h-2 bg-amber-400 rounded-full mr-1"></span>
                  Some points use VP projections where no self-report was submitted.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!selectedFellow && (
        <div className="text-sm text-gray-500 border rounded p-6 bg-gray-50">
          Select a fellow and a project to see how their weekly bandwidth on that project has changed over time.
        </div>
      )}
    </div>
  );
}
