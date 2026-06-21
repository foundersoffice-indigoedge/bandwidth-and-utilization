import { describe, it, expect } from 'vitest';
import { TABLE_CONFIG } from '@/lib/airtable/config';
import { isVpOrAvp } from '@/lib/airtable/fellows';
import { TIER_ORDER } from '@/lib/tiers';
import { CYCLE_LENGTH_DAYS } from '@/lib/schedule';
import { WORKING_DAYS_PER_WEEK } from '@/lib/scoring';
import { WEEKLY_CAPACITY_HOURS, INVESTMENT_YEAR_START_MONTH } from '@/lib/utilization';
import { CONFLICT_THRESHOLD_HOURS } from '@/lib/conflicts';

// Phase D contract lock tests. Every value below must equal the exact
// pre-migration literal. config.ts had no test before (the most drift-prone,
// cross-app coupling point); this closes that gap. Values now resolve from the
// rules store (shared.* + utilization-mis.*).

describe('Airtable contract — TABLE_CONFIG (U1)', () => {
  it('mandate fields + active stages', () => {
    const m = TABLE_CONFIG.mandate;
    expect(m.nameField).toBe('Mandate Name');
    expect(m.stageField).toBe('Current Stage of Mandate');
    expect(m.vpAvpFields).toEqual(['Mandate VP / AVP 1', 'Mandate VP / AVP 2']);
    expect(m.associateFields).toEqual(['Mandate Associate 1', 'Mandate Associate 2']);
    expect(m.directorFields).toEqual(['Mandate Director']);
    expect(m.isVpRunField).toBe('Is this a VP run mandate?');
    expect([...m.activeStages].sort()).toEqual(
      ['Not Started', 'In Production', 'In GTM', 'In Docs', 'Closing', 'Term Sheet Signed', 'DD Started'].sort(),
    );
  });
  it('dde fields + active stages', () => {
    const d = TABLE_CONFIG.dde;
    expect(d.nameField).toBe('DDE Name');
    expect(d.stageField).toBe('Current Stage of DDE');
    expect(d.vpAvpFields).toEqual(['DDE VP / AVP']);
    expect(d.associateFields).toEqual(['DDE Associate']);
    expect(d.directorFields).toEqual(['DDE Director']);
    expect([...d.activeStages].sort()).toEqual(['Not Started', 'DDE In Progress'].sort());
  });
  it('pitch fields + active stages', () => {
    const p = TABLE_CONFIG.pitch;
    expect(p.nameField).toBe('Name');
    expect(p.stageField).toBe('Pitch Status');
    expect(p.vpAvpFields).toEqual(['Pitch VP / AVP', 'Pitch VP / AVP 2']);
    expect(p.associateFields).toEqual(['Pitch Associate 1', 'Pitch Associate 2']);
    expect(p.directorFields).toEqual(['Pitch Director']);
    expect([...p.activeStages].sort()).toEqual(
      ['Pitch Work in Progress', 'Pitch Done - Awaiting Outcome'].sort(),
    );
  });
});

describe('Fellows vocab (U2)', () => {
  it('isVpOrAvp matches only VP/AVP', () => {
    expect(isVpOrAvp('VP')).toBe(true);
    expect(isVpOrAvp('AVP')).toBe(true);
    expect(isVpOrAvp('Associate 1')).toBe(false);
    expect(isVpOrAvp('Director')).toBe(false);
  });
  it('tier order', () => {
    expect(TIER_ORDER).toEqual(['VP', 'AVP', 'Associate', 'Analyst']);
  });
});

describe('Calculations & cadence scalars (U3/U4)', () => {
  it('match pre-migration constants', () => {
    expect(WORKING_DAYS_PER_WEEK).toBe(6);
    expect(WEEKLY_CAPACITY_HOURS).toBe(84);
    expect(CONFLICT_THRESHOLD_HOURS).toBe(1);
    expect(INVESTMENT_YEAR_START_MONTH).toBe(6);
    expect(CYCLE_LENGTH_DAYS).toBe(7);
  });
});
