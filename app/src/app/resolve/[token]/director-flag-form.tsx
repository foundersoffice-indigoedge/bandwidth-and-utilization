'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function DirectorFlagResolveForm({
  resolutionToken,
  originalHoursPerDay,
  proposedHoursPerDay,
  directorComment,
  initialAction,
}: {
  resolutionToken: string;
  originalHoursPerDay: number;
  proposedHoursPerDay: number | null;
  directorComment: string | null;
  initialAction?: string;
}) {
  const router = useRouter();
  const [customHours, setCustomHours] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto-resolve for one-click actions from the email link
  useEffect(() => {
    if (initialAction === 'keep_original') {
      resolve('keep_original');
    } else if (initialAction === 'use_proposed' && proposedHoursPerDay !== null) {
      resolve('use_proposed');
    }
    // 'custom' requires manual input — no auto-resolve
  }, [initialAction]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolve(action: string, customHoursValue?: number) {
    setSubmitting(true);
    setError('');

    const body: Record<string, unknown> = { resolutionToken, action };
    if (action === 'custom' && customHoursValue !== undefined) {
      body.customHours = customHoursValue;
    }

    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? 'Resolution failed.');
      setSubmitting(false);
      return;
    }

    router.push('/resolved');
  }

  // Auto-resolving state
  if (initialAction === 'keep_original' || (initialAction === 'use_proposed' && proposedHoursPerDay !== null)) {
    return (
      <p className="text-gray-600">
        {submitting ? 'Processing...' : error || 'Redirecting...'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 space-y-1">
        <p>
          <span className="font-medium">Original value:</span>{' '}
          <strong>{originalHoursPerDay} hrs/day</strong>
        </p>
        {proposedHoursPerDay !== null && (
          <p>
            <span className="font-medium">Director&apos;s proposed value:</span>{' '}
            <strong>{proposedHoursPerDay} hrs/day</strong>
          </p>
        )}
        {directorComment && (
          <p>
            <span className="font-medium">Director&apos;s comment:</span>{' '}
            &ldquo;{directorComment}&rdquo;
          </p>
        )}
      </div>

      <div className="space-y-2">
        <button
          onClick={() => resolve('keep_original')}
          disabled={submitting}
          className="w-full bg-gray-600 text-white py-2 rounded-lg text-sm hover:bg-gray-700 disabled:opacity-50"
        >
          Keep original ({originalHoursPerDay} hrs/day)
        </button>

        {proposedHoursPerDay !== null && (
          <button
            onClick={() => resolve('use_proposed')}
            disabled={submitting}
            className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Use director&apos;s proposed value ({proposedHoursPerDay} hrs/day)
          </button>
        )}
      </div>

      <div className="border-t pt-4">
        <label className="block text-sm font-medium mb-1">Or provide a custom value:</label>
        <div className="flex gap-2">
          <input
            type="number"
            step="0.5"
            min="0"
            className="border rounded px-2 py-1 w-24 text-sm"
            value={customHours}
            onChange={e => setCustomHours(e.target.value)}
            placeholder="hrs/day"
          />
          <button
            onClick={() => {
              const val = parseFloat(customHours);
              if (isNaN(val) || val < 0) {
                setError('Enter a valid number.');
                return;
              }
              resolve('custom', val);
            }}
            disabled={submitting}
            className="bg-gray-600 text-white px-4 py-1 rounded-lg text-sm hover:bg-gray-700 disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
