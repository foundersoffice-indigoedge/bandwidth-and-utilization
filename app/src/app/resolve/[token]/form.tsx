'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function ResolutionView({
  resolutionToken,
  vpHours,
  associateHours,
  initialAction,
}: {
  resolutionToken: string;
  vpHours: number;
  associateHours: number;
  initialAction?: 'use_associate' | 'use_vp' | 'custom';
}) {
  const router = useRouter();
  const [customHours, setCustomHours] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto-resolve for one-click actions
  useEffect(() => {
    if (initialAction === 'use_associate' || initialAction === 'use_vp') {
      resolve(initialAction === 'use_associate' ? 'associate_number' : 'vp_number');
    }
  }, [initialAction]);

  async function resolve(action: string, hours?: number) {
    setSubmitting(true);
    setError('');

    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolutionToken, action, customHours: hours }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Resolution failed.');
      setSubmitting(false);
      return;
    }

    router.push('/resolved');
  }

  if (initialAction === 'use_associate' || initialAction === 'use_vp') {
    return <p className="text-gray-600">{submitting ? 'Processing...' : error || 'Redirecting...'}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        VP reported <strong>{vpHours} hrs/day</strong>, Associate reported{' '}
        <strong>{associateHours} hrs/day</strong>.
      </p>

      <div className="space-y-2">
        <button
          onClick={() => resolve('associate_number')}
          disabled={submitting}
          className="w-full bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
        >
          Use Associate's number ({associateHours} hrs/day)
        </button>
        <button
          onClick={() => resolve('vp_number')}
          disabled={submitting}
          className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Use VP's number ({vpHours} hrs/day)
        </button>
      </div>

      <div className="border-t pt-4">
        <label className="block text-sm font-medium mb-1">Or enter a different number:</label>
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
