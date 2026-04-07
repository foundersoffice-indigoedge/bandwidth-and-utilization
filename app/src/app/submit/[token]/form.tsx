'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
}

interface HoursEntry {
  projectRecordId: string;
  targetFellowId: string | null;
  hoursValue: string;
  hoursUnit: 'per_day' | 'per_week';
}

export function SubmissionForm({
  token,
  fellowName,
  isVp,
  projects,
}: {
  token: string;
  fellowName: string;
  isVp: boolean;
  projects: Project[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<string, HoursEntry>>(() => {
    const init: Record<string, HoursEntry> = {};
    for (const project of projects) {
      init[`${project.projectRecordId}:self`] = {
        projectRecordId: project.projectRecordId,
        targetFellowId: null,
        hoursValue: '',
        hoursUnit: 'per_day',
      };
      if (isVp) {
        for (const assoc of project.associates) {
          init[`${project.projectRecordId}:${assoc.recordId}`] = {
            projectRecordId: project.projectRecordId,
            targetFellowId: assoc.recordId,
            hoursValue: '',
            hoursUnit: 'per_day',
          };
        }
      }
    }
    return init;
  });
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function update(key: string, field: 'hoursValue' | 'hoursUnit', value: string) {
    setEntries(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
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
    <form onSubmit={handleSubmit} className="space-y-8">
      {projects.map(project => (
        <div key={project.projectRecordId} className="border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold">{project.projectName}</h2>
            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded uppercase">
              {project.projectType}
            </span>
            {project.stage && (
              <span className="text-xs text-gray-500">{project.stage}</span>
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

      <div>
        <label className="block text-sm font-medium mb-1">Remarks (optional)</label>
        <textarea
          className="w-full border rounded-lg p-2 text-sm"
          rows={3}
          placeholder="Flag projects not in the system, other work, or concerns..."
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
