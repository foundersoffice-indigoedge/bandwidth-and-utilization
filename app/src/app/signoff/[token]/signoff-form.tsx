'use client';
import React, { useState } from 'react';
import type { SignoffProjectGroup } from '@/types';

interface FlagState {
  submissionId: string;
  enabled: boolean;
  proposedHoursPerDay: string;
  comment: string;
}

export function SignoffForm({ token, groups }: { token: string; groups: SignoffProjectGroup[] }) {
  const [flags, setFlags] = useState<Record<string, FlagState>>(() => {
    const init: Record<string, FlagState> = {};
    for (const g of groups) {
      for (const l of g.lines) {
        init[l.submissionId] = {
          submissionId: l.submissionId,
          enabled: false,
          proposedHoursPerDay: '',
          comment: '',
        };
      }
    }
    return init;
  });

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'confirming' | 'flagging' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const enabledFlags = Object.values(flags).filter(f => f.enabled);
  const validFlags = enabledFlags.filter(f => {
    const parsed = Number(f.proposedHoursPerDay);
    return f.proposedHoursPerDay !== '' && !Number.isNaN(parsed) && parsed > 0;
  });

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setStatus('confirming');
    try {
      const res = await fetch('/api/signoff/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg((err as { error?: string }).error ?? 'Confirm failed');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFlag() {
    if (submitting || validFlags.length === 0) return;
    setSubmitting(true);
    setStatus('flagging');
    try {
      const payload = {
        token,
        flags: validFlags.map(f => ({
          submissionId: f.submissionId,
          proposedHoursPerDay:
            f.proposedHoursPerDay !== '' ? Number(f.proposedHoursPerDay) : undefined,
          comment: f.comment.trim() || undefined,
        })),
      };
      const res = await fetch('/api/signoff/flag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg((err as { error?: string }).error ?? 'Flag failed');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'done') {
    return (
      <div style={{ padding: 24, background: '#dcfce7', borderRadius: 8 }}>
        <h2>Thanks — recorded.</h2>
        <p>You can close this tab.</p>
      </div>
    );
  }

  return (
    <div>
      {status === 'error' && (
        <div
          style={{
            background: '#fee2e2',
            padding: 12,
            borderRadius: 6,
            marginBottom: 16,
            color: '#991b1b',
          }}
        >
          {errorMsg}
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={submitting}
        style={{
          background: '#16a34a',
          color: 'white',
          padding: '16px 32px',
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 600,
          border: 'none',
          cursor: submitting ? 'not-allowed' : 'pointer',
          width: '100%',
          marginBottom: 24,
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {status === 'confirming' ? 'Confirming...' : '✅ Confirm all accurate'}
      </button>

      <p style={{ color: '#6b7280', textAlign: 'center', margin: '24px 0' }}>
        or flag specific lines below ↓
      </p>

      {groups.map(g => (
        <section key={g.projectRecordId} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>
            {g.projectName}{' '}
            <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 400 }}>
              ({g.projectType})
            </span>
          </h2>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              border: '1px solid #e5e7eb',
            }}
          >
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ padding: 8, textAlign: 'left', fontSize: 13 }}>Person</th>
                <th style={{ padding: 8, textAlign: 'left', fontSize: 13 }}>Designation</th>
                <th style={{ padding: 8, textAlign: 'right', fontSize: 13 }}>Hrs/day</th>
                <th style={{ padding: 8, textAlign: 'right', fontSize: 13 }}>Hrs/week</th>
                <th style={{ padding: 8, textAlign: 'center', fontSize: 13 }}>Flag</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map(line => {
                const f = flags[line.submissionId];
                return (
                  <React.Fragment key={line.submissionId}>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: 8 }}>{line.fellowName}</td>
                      <td style={{ padding: 8, color: '#6b7280', fontSize: 13 }}>
                        {line.designation}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        {line.hoursPerDay.toFixed(2)}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        {line.hoursPerWeek.toFixed(1)}
                      </td>
                      <td style={{ padding: 8, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          onChange={e =>
                            setFlags(prev => ({
                              ...prev,
                              [line.submissionId]: {
                                ...prev[line.submissionId],
                                enabled: e.target.checked,
                              },
                            }))
                          }
                        />
                      </td>
                    </tr>
                    {f.enabled && (
                      <tr style={{ background: '#fef9c3' }}>
                        <td colSpan={5} style={{ padding: 12 }}>
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 13, marginRight: 8 }}>
                              Proposed correct value:
                            </label>
                            <input
                              type="number"
                              step="0.25"
                              min="0.01"
                              required
                              value={f.proposedHoursPerDay}
                              onChange={e =>
                                setFlags(prev => ({
                                  ...prev,
                                  [line.submissionId]: {
                                    ...prev[line.submissionId],
                                    proposedHoursPerDay: e.target.value,
                                  },
                                }))
                              }
                              placeholder="hrs/day"
                              style={{ padding: 4, borderRadius: 4, border: '1px solid #d1d5db', width: 90 }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                              Comment (optional):
                            </label>
                            <textarea
                              value={f.comment}
                              onChange={e =>
                                setFlags(prev => ({
                                  ...prev,
                                  [line.submissionId]: {
                                    ...prev[line.submissionId],
                                    comment: e.target.value,
                                  },
                                }))
                              }
                              rows={2}
                              style={{
                                width: '100%',
                                padding: 4,
                                borderRadius: 4,
                                border: '1px solid #d1d5db',
                                fontSize: 13,
                                boxSizing: 'border-box',
                              }}
                              placeholder="Optional context for the resolver"
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <div style={{ position: 'sticky', bottom: 0, background: 'white', paddingTop: 12, paddingBottom: 12 }}>
        <button
          onClick={handleFlag}
          disabled={submitting || validFlags.length === 0}
          style={{
            background: validFlags.length === 0 ? '#9ca3af' : '#dc2626',
            color: 'white',
            padding: '14px 28px',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            border: 'none',
            cursor: submitting || validFlags.length === 0 ? 'not-allowed' : 'pointer',
            width: '100%',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {status === 'flagging'
            ? 'Submitting...'
            : `Submit ${validFlags.length} flag${validFlags.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
