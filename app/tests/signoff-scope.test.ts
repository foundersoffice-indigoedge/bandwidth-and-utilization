import { describe, it, expect } from 'vitest';
import { getExpectedDirectorIds } from '../src/lib/signoff-scope';

// Minimal project shape: only the fields the scope check reads.
const mk = (vpAvpIds: string[], associateIds: string[], directorIds: string[]) => ({
  vpAvpIds,
  associateIds,
  directorIds,
});

describe('getExpectedDirectorIds', () => {
  it('includes a current director on a staffed project', () => {
    const projects = [mk(['rV'], ['rA'], ['rD1'])];
    const res = getExpectedDirectorIds(projects, new Set(['rD1', 'rD2']));
    expect([...res]).toEqual(['rD1']);
  });

  it('excludes a director whose only project has no team members', () => {
    const projects = [mk([], [], ['rD1'])];
    const res = getExpectedDirectorIds(projects, new Set(['rD1']));
    expect(res.size).toBe(0);
  });

  it('excludes a director-field id that is not a current director (ex-director / VP in director slot)', () => {
    const projects = [mk(['rV'], [], ['rEX'])];
    const res = getExpectedDirectorIds(projects, new Set(['rD1']));
    expect(res.size).toBe(0);
  });

  it('dedupes a director who staffs multiple projects', () => {
    const projects = [mk(['rV'], [], ['rD1']), mk([], ['rA'], ['rD1'])];
    const res = getExpectedDirectorIds(projects, new Set(['rD1']));
    expect([...res]).toEqual(['rD1']);
  });
});
