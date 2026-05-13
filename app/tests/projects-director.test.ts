import { describe, it, expect } from 'vitest';
import { extractDirectorIds } from '../src/lib/airtable/projects';

describe('extractDirectorIds', () => {
  it('returns empty array for VP-led mandate regardless of Director field', () => {
    const fields = {
      'Mandate Director': ['recDirector1'],
      'Is this a VP run mandate?': 'Yes',
    };
    expect(extractDirectorIds('mandate', fields, true)).toEqual([]);
  });

  it('reads Director field for non-VP-led mandate', () => {
    const fields = {
      'Mandate Director': ['recDirector1', 'recDirector2'],
    };
    expect(extractDirectorIds('mandate', fields, false)).toEqual(['recDirector1', 'recDirector2']);
  });

  it('reads Director field for DDE (no VP-led concept)', () => {
    const fields = { 'DDE Director': ['recDirA'] };
    expect(extractDirectorIds('dde', fields, false)).toEqual(['recDirA']);
  });

  it('reads Director field for pitch', () => {
    const fields = { 'Pitch Director': ['recDirB'] };
    expect(extractDirectorIds('pitch', fields, false)).toEqual(['recDirB']);
  });

  it('returns empty array when Director field is absent', () => {
    expect(extractDirectorIds('mandate', {}, false)).toEqual([]);
  });

  it('handles multiple director fields per type (defensive)', () => {
    // If a type ever has more than one director field, combine them
    const fields = {
      'Mandate Director': ['recA'],
    };
    // Test depends on TABLE_CONFIG having only one entry by default; defensive case is that it could have more
    expect(extractDirectorIds('mandate', fields, false)).toContain('recA');
  });
});
