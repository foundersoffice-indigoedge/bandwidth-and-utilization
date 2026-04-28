'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTier, TIER_ORDER, type Tier } from '@/lib/tiers';
import { deriveEntries, type HoursEntry } from './form-entries';

interface Associate {
  recordId: string;
  name: string;
}

interface Project {
  projectRecordId: string;
  projectName: string;
  projectType: string;
  stage: string;
  associates: Associate[];
  isVpRun?: boolean;
  leadFellowName?: string;
  isNew?: boolean;
}

interface Director {
  recordId: string;
  name: string;
}

interface FellowOption {
  recordId: string;
  name: string;
  designation: string;
}

const TYPE_SECTIONS: { type: string; label: string; color: string; border: string; bg: string }[] = [
  { type: 'mandate', label: 'Mandates', color: 'text-blue-800', border: 'border-l-blue-600', bg: 'bg-blue-50' },
  { type: 'dde', label: 'DDEs', color: 'text-teal-800', border: 'border-l-teal-600', bg: 'bg-teal-50' },
  { type: 'pitch', label: 'Pitches', color: 'text-violet-800', border: 'border-l-violet-600', bg: 'bg-violet-50' },
];

const TYPE_LABELS: Record<'mandate' | 'dde' | 'pitch', string> = {
  mandate: 'Mandate',
  dde: 'DDE',
  pitch: 'Pitch',
};

export function SubmissionForm({
  token,
  fellowName,
  isVp,
  projects,
  directors,
  fellowOptions,
  initialEntries = {},
}: {
  token: string;
  fellowName: string;
  isVp: boolean;
  projects: Project[];
  directors: Director[];
  fellowOptions: FellowOption[];
  initialEntries?: Record<string, { hoursValue: string; hoursUnit: 'per_day' | 'per_week' }>;
}) {
  const router = useRouter();
  const [userInput, setUserInput] = useState<Record<string, HoursEntry>>({});
  const entries = useMemo(
    () => deriveEntries(projects, isVp, userInput, initialEntries),
    [projects, isVp, userInput, initialEntries],
  );
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  function update(key: string, field: 'hoursValue' | 'hoursUnit', value: string) {
    setUserInput(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? entries[key]), [field]: value },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const list = Object.values(entries).map(entry => ({
      ...entry,
      hoursValue: parseFloat(entry.hoursValue),
    }));

    if (list.some(e => isNaN(e.hoursValue) || e.hoursValue < 0)) {
      setError('Fill in all hours fields with valid numbers.');
      setSubmitting(false);
      return;
    }

    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, entries: list, remarks }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Submission failed.');
      setSubmitting(false);
      return;
    }

    router.push('/submitted');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      {[...TYPE_SECTIONS, { type: 'new', label: 'New projects', color: 'text-amber-800', border: 'border-l-amber-600', bg: 'bg-amber-50' }].map(({ type, label, color, border, bg }) => {
        const group = type === 'new'
          ? projects.filter(p => p.isNew)
          : projects.filter(p => p.projectType === type && !p.isNew);
        if (group.length === 0) return null;
        return (
          <section key={type}>
            <div className={`flex items-center gap-3 mb-4 ${bg} -mx-2 px-3 py-2 rounded-lg`}>
              <h2 className={`text-base font-bold uppercase tracking-wide ${color}`}>{label}</h2>
              <div className="flex-1 h-px bg-gray-300" />
              <span className="text-xs text-gray-500 font-medium">{group.length} project{group.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-4">
              {group.map(project => (
                <div key={project.projectRecordId} className={`border rounded-lg p-4 border-l-4 ${border}`}>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <h3 className="text-base font-semibold">{project.projectName}</h3>
                    {project.stage && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{project.stage}</span>
                    )}
                    {project.isVpRun && (
                      <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-medium">
                        VP-run{project.leadFellowName ? ` · Led by ${project.leadFellowName}` : ''}
                      </span>
                    )}
                  </div>

                  <HoursInput
                    label={`Your bandwidth (${fellowName})`}
                    entry={entries[`${project.projectRecordId}:self`]}
                    onChange={(field, val) => update(`${project.projectRecordId}:self`, field, val)}
                  />

                  {isVp &&
                    project.associates.map(assoc => (
                      <HoursInput
                        key={assoc.recordId}
                        label={assoc.name}
                        entry={entries[`${project.projectRecordId}:${assoc.recordId}`]}
                        onChange={(field, val) =>
                          update(`${project.projectRecordId}:${assoc.recordId}`, field, val)
                        }
                      />
                    ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <div className="border-t pt-4">
        {showAddForm ? (
          <AddProjectBlock
            token={token}
            isVp={isVp}
            directors={directors}
            fellowOptions={fellowOptions}
            onDone={() => {
              setShowAddForm(false);
              router.refresh();
            }}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            + Add a project not listed
          </button>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Remarks (optional)</label>
        <textarea
          className="w-full border rounded-lg p-2 text-sm"
          rows={3}
          placeholder="any sector scoping, outreach or other threads you are working on"
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit Bandwidth Update'}
      </button>
    </form>
  );
}

function HoursInput({
  label,
  entry,
  onChange,
}: {
  label: string;
  entry: HoursEntry;
  onChange: (field: 'hoursValue' | 'hoursUnit', value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <span className="text-sm min-w-[160px]">{label}</span>
      <input
        type="number"
        step="0.5"
        min="0"
        required
        className="border rounded px-2 py-1 w-20 text-sm"
        value={entry.hoursValue}
        onChange={e => onChange('hoursValue', e.target.value)}
      />
      <select
        className="border rounded px-2 py-1 text-sm"
        value={entry.hoursUnit}
        onChange={e => onChange('hoursUnit', e.target.value)}
      >
        <option value="per_day">hrs/day</option>
        <option value="per_week">hrs/week</option>
      </select>
    </div>
  );
}

function AddProjectBlock({
  token,
  isVp,
  directors,
  fellowOptions,
  onDone,
  onCancel,
}: {
  token: string;
  isVp: boolean;
  directors: Director[];
  fellowOptions: FellowOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'mandate' | 'dde' | 'pitch'>('mandate');
  const [name, setName] = useState('');
  const [directorId, setDirectorId] = useState('');
  const [teammateIds, setTeammateIds] = useState<string[]>([]);
  const [selfValue, setSelfValue] = useState('');
  const [selfUnit, setSelfUnit] = useState<'per_day' | 'per_week'>('per_day');
  const [teammateBandwidth, setTeammateBandwidth] = useState<Record<string, { value: string; unit: 'per_day' | 'per_week' }>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    if (!name.trim() || !directorId || !selfValue) {
      setErr('Fill in project name, director, and your bandwidth.');
      return;
    }
    const director = directors.find(d => d.recordId === directorId);
    if (!director) {
      setErr('Invalid director.');
      return;
    }
    if (isVp && teammateIds.length > 0) {
      const missing = teammateIds.filter(id => {
        const v = teammateBandwidth[id]?.value;
        return !v || v.trim() === '';
      });
      if (missing.length > 0) {
        setErr('Enter bandwidth for every teammate you added.');
        return;
      }
    }
    setBusy(true);
    const res = await fetch('/api/add-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        type,
        name: name.trim(),
        directorRecordId: director.recordId,
        directorName: director.name,
        teammateRecordIds: teammateIds,
        selfBandwidth: { value: parseFloat(selfValue), unit: selfUnit },
        teammateBandwidth: isVp
          ? teammateIds.map(id => ({
              recordId: id,
              value: parseFloat(teammateBandwidth[id].value),
              unit: teammateBandwidth[id].unit,
            }))
          : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json();
      setErr(data.error || 'Failed to add project.');
      return;
    }
    onDone();
  }

  function toggleTeammate(id: string) {
    setTeammateIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    if (!teammateBandwidth[id]) {
      setTeammateBandwidth(prev => ({ ...prev, [id]: { value: '', unit: 'per_day' } }));
    }
  }

  return (
    <div className="border rounded-lg p-4 bg-amber-50 space-y-3">
      <h3 className="text-sm font-semibold">Add a project not listed</h3>

      <div>
        <label className="block text-xs font-medium mb-1">Type</label>
        <div className="flex gap-3 text-sm">
          {(['mandate', 'dde', 'pitch'] as const).map(t => (
            <label key={t} className="flex items-center gap-1">
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} />
              <span>{TYPE_LABELS[t]}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Project name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full border rounded px-2 py-1 text-sm"
          placeholder="e.g. Acme Corp Fundraise"
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Director</label>
        <select value={directorId} onChange={e => setDirectorId(e.target.value)} className="w-full border rounded px-2 py-1 text-sm">
          <option value="">Select director...</option>
          {directors.map(d => (
            <option key={d.recordId} value={d.recordId}>{d.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Teammates (optional)</label>
        <TeammateSearchSelect
          fellowOptions={fellowOptions}
          selectedIds={teammateIds}
          onToggle={toggleTeammate}
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Your bandwidth</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.5"
            min="0"
            value={selfValue}
            onChange={e => setSelfValue(e.target.value)}
            className="border rounded px-2 py-1 w-20 text-sm"
          />
          <select
            value={selfUnit}
            onChange={e => setSelfUnit(e.target.value as 'per_day' | 'per_week')}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="per_day">hrs/day</option>
            <option value="per_week">hrs/week</option>
          </select>
        </div>
      </div>

      {isVp && teammateIds.length > 0 && (
        <div>
          <label className="block text-xs font-medium mb-1">Teammate bandwidth</label>
          {teammateIds.map(id => {
            const f = fellowOptions.find(x => x.recordId === id);
            const tb = teammateBandwidth[id] || { value: '', unit: 'per_day' as const };
            return (
              <div key={id} className="flex items-center gap-2 mt-1">
                <span className="text-xs min-w-[140px]">{f?.name ?? id}</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={tb.value}
                  onChange={e => setTeammateBandwidth(prev => ({ ...prev, [id]: { ...tb, value: e.target.value } }))}
                  className="border rounded px-2 py-1 w-20 text-sm"
                />
                <select
                  value={tb.unit}
                  onChange={e => setTeammateBandwidth(prev => ({ ...prev, [id]: { ...tb, unit: e.target.value as 'per_day' | 'per_week' } }))}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value="per_day">hrs/day</option>
                  <option value="per_week">hrs/week</option>
                </select>
              </div>
            );
          })}
        </div>
      )}

      {err && <p className="text-xs text-red-600">{err}</p>}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Adding...' : 'Add project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm bg-gray-200 rounded hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function TeammateSearchSelect({
  fellowOptions,
  selectedIds,
  onToggle,
}: {
  fellowOptions: FellowOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = useMemo(
    () => selectedIds
      .map(id => fellowOptions.find(f => f.recordId === id))
      .filter((f): f is FellowOption => Boolean(f)),
    [selectedIds, fellowOptions],
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = fellowOptions.filter(f => !selectedIds.includes(f.recordId));
    const matches = q ? pool.filter(f => f.name.toLowerCase().includes(q)) : pool;
    const g: Record<Tier, FellowOption[]> = { VP: [], AVP: [], Associate: [], Analyst: [] };
    for (const f of matches) g[getTier(f.designation)].push(f);
    for (const t of TIER_ORDER) g[t].sort((a, b) => a.name.localeCompare(b.name));
    return g;
  }, [query, fellowOptions, selectedIds]);

  const hasResults = TIER_ORDER.some(t => grouped[t].length > 0);

  return (
    <div ref={wrapperRef} className="relative">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selected.map(f => (
            <span
              key={f.recordId}
              className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full"
            >
              {f.name}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onToggle(f.recordId)}
                className="text-blue-600 hover:text-blue-900 leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        placeholder="Search teammates by name..."
        onChange={e => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        className="w-full border rounded px-2 py-1 text-sm"
      />

      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border rounded shadow-sm text-sm">
          {!hasResults && (
            <div className="px-3 py-2 text-xs text-gray-500">No matches.</div>
          )}
          {TIER_ORDER.map(tier => {
            const list = grouped[tier];
            if (list.length === 0) return null;
            return (
              <div key={tier}>
                <div className="sticky top-0 bg-gray-50 text-[11px] uppercase tracking-wide font-semibold text-gray-500 px-3 py-1 border-b">
                  {tier}
                </div>
                {list.map(f => (
                  <button
                    key={f.recordId}
                    type="button"
                    onClick={() => {
                      onToggle(f.recordId);
                      setQuery('');
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-blue-50"
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
