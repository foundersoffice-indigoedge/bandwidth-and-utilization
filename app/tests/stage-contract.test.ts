import { describe, it, expect } from 'vitest';
import { TABLE_CONFIG } from '@/lib/airtable/config';

// The mandate active-stage list is now derived from the shared rule
// (shared.stages.mandate in ie-agent-rules), not hardcoded here. This locks the
// derived values to exactly what Utilization MIS relied on before the migration,
// so a bad rule edit fails CI instead of silently changing utilization.
describe('shared mandate stage contract', () => {
  it('derives exactly the active mandate stages', () => {
    expect(new Set(TABLE_CONFIG.mandate.activeStages)).toEqual(
      new Set([
        'Not Started',
        'In Production',
        'In GTM',
        'In Docs',
        'Closing',
        'Term Sheet Signed',
        'DD Started',
      ]),
    );
  });

  it('derives exactly the active DDE stages', () => {
    expect(new Set(TABLE_CONFIG.dde.activeStages)).toEqual(
      new Set(['Not Started', 'DDE In Progress']),
    );
  });

  it('derives exactly the active Pitch stages', () => {
    expect(new Set(TABLE_CONFIG.pitch.activeStages)).toEqual(
      new Set(['Pitch Work in Progress', 'Pitch Done - Awaiting Outcome']),
    );
  });
});

// Team-role field names and the VP-run flag are now derived from the shared
// rules (shared.fields.team-roles, shared.flags.vp-run). Lock the resolved
// names to exactly what Utilization MIS hardcoded before the migration.
describe('shared team-role + VP-run field contract', () => {
  it('mandate role fields resolve unchanged', () => {
    expect(TABLE_CONFIG.mandate.directorFields).toEqual(['Mandate Director']);
    expect(TABLE_CONFIG.mandate.vpAvpFields).toEqual(['Mandate VP / AVP 1', 'Mandate VP / AVP 2']);
    expect(TABLE_CONFIG.mandate.associateFields).toEqual(['Mandate Associate 1', 'Mandate Associate 2']);
    expect(TABLE_CONFIG.mandate.isVpRunField).toBe('Is this a VP run mandate?');
  });

  it('dde role fields resolve unchanged', () => {
    expect(TABLE_CONFIG.dde.directorFields).toEqual(['DDE Director']);
    expect(TABLE_CONFIG.dde.vpAvpFields).toEqual(['DDE VP / AVP']);
    expect(TABLE_CONFIG.dde.associateFields).toEqual(['DDE Associate']);
  });

  it('pitch role fields resolve unchanged', () => {
    expect(TABLE_CONFIG.pitch.directorFields).toEqual(['Pitch Director']);
    expect(TABLE_CONFIG.pitch.vpAvpFields).toEqual(['Pitch VP / AVP', 'Pitch VP / AVP 2']);
    expect(TABLE_CONFIG.pitch.associateFields).toEqual(['Pitch Associate 1', 'Pitch Associate 2']);
  });
});
