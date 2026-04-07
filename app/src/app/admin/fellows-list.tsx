'use client';

import { useState } from 'react';

interface FellowToken {
  tokenId: string;
  name: string;
  designation: string;
  status: string;
  submittedAt: string | null;
}

export function FellowsList({ fellows: initial }: { fellows: FellowToken[] }) {
  const [fellows, setFellows] = useState(initial);

  async function toggle(tokenId: string, currentStatus: string) {
    const newStatus = currentStatus === 'not_needed' ? 'pending' : 'not_needed';
    const res = await fetch('/api/admin/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId, status: newStatus }),
    });
    if (res.ok) {
      setFellows(prev =>
        prev.map(f => (f.tokenId === tokenId ? { ...f, status: newStatus } : f))
      );
    }
  }

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    submitted: 'bg-green-100 text-green-800',
    not_needed: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-2">
      {fellows.map(f => (
        <div key={f.tokenId} className="flex items-center justify-between border rounded-lg p-3">
          <div>
            <span className="font-medium">{f.name}</span>
            <span className="text-xs text-gray-500 ml-2">{f.designation}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${statusColor[f.status] || ''}`}>
              {f.status}
            </span>
            {f.status !== 'submitted' && (
              <button
                onClick={() => toggle(f.tokenId, f.status)}
                className="text-xs text-blue-600 hover:underline"
              >
                {f.status === 'not_needed' ? 'Re-enable' : 'Mark not needed'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
