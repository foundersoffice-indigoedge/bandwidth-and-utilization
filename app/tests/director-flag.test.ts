import { describe, it, expect } from 'vitest';
import { computeResolverForFlag, type FlagResolverInput, dedupeRecipients } from '../src/lib/director-flag';

const fellow = (id: string, designation: string, email = `${id}@indigoedge.com`, name = id) => ({
  recordId: id, designation, email, name,
});

describe('computeResolverForFlag', () => {
  it('routes to the flagged VP themselves when a VP is flagged (they are the senior)', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recVP1', 'VP'),
      projectVpAvpIds: ['recVP1'],
      projectDirectorIds: [],
      allFellows: [fellow('recVP1', 'VP')],
    };
    const r = computeResolverForFlag(input);
    expect(r.resolverFellowId).toBe('recVP1');
    expect(r.resolverEmail).toBe('recVP1@indigoedge.com');
  });

  it('flagged AVP who is the sole senior resolves themselves', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recAVP', 'AVP'),
      projectVpAvpIds: ['recAVP'],
      projectDirectorIds: [],
      allFellows: [fellow('recAVP', 'AVP')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recAVP');
  });

  it('routes to the senior (first VP) when an associate is flagged and a VP exists', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recA1', 'Associate 2'),
      projectVpAvpIds: ['recVP1', 'recVP2'],
      projectDirectorIds: [],
      allFellows: [
        fellow('recA1', 'Associate 2'),
        fellow('recVP1', 'VP'),
        fellow('recVP2', 'VP'),
      ],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recVP1');
  });

  it('routes to associate themselves when no VP/AVP is on the project', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recA1', 'Associate 1'),
      projectVpAvpIds: [],
      projectDirectorIds: [],
      allFellows: [fellow('recA1', 'Associate 1')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recA1');
  });

  it('routes to analyst themselves when no VP/AVP is on the project', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recAn', 'Analyst'),
      projectVpAvpIds: [],
      projectDirectorIds: [],
      allFellows: [fellow('recAn', 'Analyst')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recAn');
  });

  it('skips non-VP entries in vpAvpIds when picking the senior', () => {
    // Defensive: vpAvpIds should only contain VP/AVPs, but the resolver verifies designation
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recA1', 'Associate 3'),
      projectVpAvpIds: ['recOther', 'recVP1'],
      projectDirectorIds: [],
      allFellows: [
        fellow('recA1', 'Associate 3'),
        fellow('recOther', 'Associate 1'),    // mis-tagged on the project
        fellow('recVP1', 'VP'),
      ],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recVP1');
  });

  it('routes an AVP-in-associate-slot flag to the mandate senior, not the AVP', () => {
    // Adit (AVP) sits in the associate slot; Tanya is the senior in the VP/AVP slot.
    const adit = fellow('recAdit', 'AVP');
    const tanya = fellow('recTanya', 'AVP');
    const res = computeResolverForFlag({
      flaggedFellow: adit,
      projectVpAvpIds: ['recTanya'],
      projectDirectorIds: [],
      allFellows: [adit, tanya],
    });
    expect(res.resolverFellowId).toBe('recTanya');
  });

  it('lets an AVP who is the project senior resolve their own flag', () => {
    const adit = fellow('recAdit', 'AVP');
    const res = computeResolverForFlag({
      flaggedFellow: adit,
      projectVpAvpIds: ['recAdit'],
      projectDirectorIds: [],
      allFellows: [adit],
    });
    expect(res.resolverFellowId).toBe('recAdit');
  });

  it('falls back to an eligible VP/AVP in the director slot when no VP/AVP slot occupant', () => {
    const leadVp = fellow('recLeadVp', 'VP');
    const assoc = fellow('recA1', 'Associate 2');
    const res = computeResolverForFlag({
      flaggedFellow: assoc,
      projectVpAvpIds: [],
      projectDirectorIds: ['recLeadVp'],
      allFellows: [assoc, leadVp],
    });
    expect(res.resolverFellowId).toBe('recLeadVp');
  });

  it('falls back to admin when no resolver derivable', () => {
    // Edge case: flagged fellow not in allFellows and no senior on the project
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recGhost', 'Associate 1'),
      projectVpAvpIds: [],
      projectDirectorIds: [],
      allFellows: [],
      adminEmail: 'ajder@indigoedge.com',
    };
    const r = computeResolverForFlag(input);
    expect(r.resolverEmail).toBe('ajder@indigoedge.com');
    expect(r.resolverFellowId).toBeNull();
  });
});

describe('dedupeRecipients', () => {
  it('keeps TO, drops CC duplicates (case-insensitive)', () => {
    const r = dedupeRecipients({
      to: 'VP@indigoedge.com',
      cc: ['ajder@indigoedge.com', 'vp@INDIGOEDGE.com', 'pai@indigoedge.com'],
    });
    expect(r.to).toBe('VP@indigoedge.com');
    expect(r.cc).toEqual(['ajder@indigoedge.com', 'pai@indigoedge.com']);
  });

  it('dedupes within CC', () => {
    const r = dedupeRecipients({
      to: 'vp@indigoedge.com',
      cc: ['ajder@indigoedge.com', 'AJDER@indigoedge.com', 'pai@indigoedge.com'],
    });
    expect(r.cc).toEqual(['ajder@indigoedge.com', 'pai@indigoedge.com']);
  });

  it('handles empty CC', () => {
    const r = dedupeRecipients({ to: 'vp@indigoedge.com', cc: [] });
    expect(r.cc).toEqual([]);
  });

  it('preserves CC order after dedupe', () => {
    const r = dedupeRecipients({
      to: 'x@a.com',
      cc: ['c@a.com', 'b@a.com', 'a@a.com', 'B@a.com'],
    });
    expect(r.cc).toEqual(['c@a.com', 'b@a.com', 'a@a.com']);
  });
});
