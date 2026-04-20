'use client';
import { useState } from 'react';

const TYPE_LABELS: Record<string, string> = {
  mandate: 'Mandate',
  dde: 'DDE',
  pitch: 'Pitch',
};

interface AdHoc {
  id: string;
  name: string;
  type: string;
  directorName: string;
  teammateNames: string[];
  createdByFellowName: string;
  createdAt: string;
  submissionCount: number;
}

interface Suggestion {
  projectRecordId: string;
  projectName: string;
  score: number;
}

export function AdHocList({ adHocs }: { adHocs: AdHoc[] }) {
  const [linking, setLinking] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [alternatives, setAlternatives] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  async function openLinkModal(adHocId: string) {
    setLinking(adHocId);
    setLoading(true);
    setSuggestion(null);
    setAlternatives([]);
    const res = await fetch(`/api/ad-hoc-projects/suggest?adHocId=${adHocId}`);
    const data = await res.json();
    setSuggestion(data.topCandidate);
    setAlternatives(data.alternatives ?? []);
    setLoading(false);
  }

  async function confirmLink(adHocId: string, airtableRecordId: string) {
    await fetch('/api/ad-hoc-projects/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adHocId, airtableRecordId }),
    });
    window.location.reload();
  }

  if (adHocs.length === 0) {
    return <p className="text-sm text-gray-500 mt-8">No active ad-hoc projects.</p>;
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold mb-2">Active ad-hoc projects</h2>
      <table className="w-full text-sm border border-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-2 text-left">Name</th>
            <th className="p-2 text-left">Type</th>
            <th className="p-2 text-left">Director</th>
            <th className="p-2 text-left">Added by</th>
            <th className="p-2 text-center">Subs</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {adHocs.map(a => (
            <tr key={a.id} className="border-t">
              <td className="p-2">{a.name}</td>
              <td className="p-2">{TYPE_LABELS[a.type] ?? a.type}</td>
              <td className="p-2">{a.directorName}</td>
              <td className="p-2">{a.createdByFellowName}</td>
              <td className="p-2 text-center">{a.submissionCount}</td>
              <td className="p-2">
                <button className="px-3 py-1 text-xs bg-blue-600 text-white rounded" onClick={() => openLinkModal(a.id)}>
                  Link to Airtable
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {linking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-2">Link to Airtable</h3>
            {loading && <p className="text-sm text-gray-500">Searching matches…</p>}
            {!loading && !suggestion && <p className="text-sm text-gray-500">No candidates found.</p>}
            {!loading && suggestion && (
              <>
                <p className="mb-2 text-sm">
                  Suggested match: <strong>{suggestion.projectName}</strong> (score: {suggestion.score.toFixed(2)})
                </p>
                {alternatives.length > 0 && (
                  <details className="mb-3 text-xs text-gray-600">
                    <summary className="cursor-pointer">Other candidates</summary>
                    <ul className="pl-4 mt-1 space-y-1">
                      {alternatives.map(a => (
                        <li key={a.projectRecordId}>
                          <button
                            className="underline text-blue-600"
                            onClick={() => confirmLink(linking, a.projectRecordId)}
                          >
                            {a.projectName}
                          </button>
                          {' '}({a.score.toFixed(2)})
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 bg-green-600 text-white rounded"
                    onClick={() => confirmLink(linking, suggestion.projectRecordId)}
                  >
                    Confirm top match
                  </button>
                  <button
                    className="px-3 py-1 bg-gray-300 rounded"
                    onClick={() => { setLinking(null); setSuggestion(null); setAlternatives([]); }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
