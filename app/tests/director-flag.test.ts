import { describe, it, expect } from 'vitest';
import { computeResolverForFlag, type FlagResolverInput } from '../src/lib/director-flag';

const fellow = (id: string, designation: string, email = `${id}@indigoedge.com`, name = id) => ({
  recordId: id, designation, email, name,
});

describe('computeResolverForFlag', () => {
  it('routes to the flagged VP themselves when a VP is flagged', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recVP1', 'VP'),
      projectVpAvpIds: ['recVP1'],
      allFellows: [fellow('recVP1', 'VP')],
    };
    const r = computeResolverForFlag(input);
    expect(r.resolverFellowId).toBe('recVP1');
    expect(r.resolverEmail).toBe('recVP1@indigoedge.com');
  });

  it('treats AVP same as VP — flagged AVP resolves themselves', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recAVP', 'AVP'),
      projectVpAvpIds: ['recAVP'],
      allFellows: [fellow('recAVP', 'AVP')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recAVP');
  });

  it('routes to first VP on project when an associate is flagged and a VP exists', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recA1', 'Associate 2'),
      projectVpAvpIds: ['recVP1', 'recVP2'],
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
      allFellows: [fellow('recA1', 'Associate 1')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recA1');
  });

  it('routes to analyst themselves when no VP/AVP is on the project', () => {
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recAn', 'Analyst'),
      projectVpAvpIds: [],
      allFellows: [fellow('recAn', 'Analyst')],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recAn');
  });

  it('skips non-VP entries in vpAvpIds when picking first VP', () => {
    // Defensive: vpAvpIds should only contain VP/AVPs, but the matrix verifies designation
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recA1', 'Associate 3'),
      projectVpAvpIds: ['recOther', 'recVP1'],
      allFellows: [
        fellow('recA1', 'Associate 3'),
        fellow('recOther', 'Associate 1'),    // mis-tagged on the project
        fellow('recVP1', 'VP'),
      ],
    };
    expect(computeResolverForFlag(input).resolverFellowId).toBe('recVP1');
  });

  it('falls back to admin when no resolver derivable', () => {
    // Edge case: flagged fellow not in allFellows and no VPs on project
    const input: FlagResolverInput = {
      flaggedFellow: fellow('recGhost', 'Associate 1'),
      projectVpAvpIds: [],
      allFellows: [],
      adminEmail: 'ajder@indigoedge.com',
    };
    const r = computeResolverForFlag(input);
    expect(r.resolverEmail).toBe('ajder@indigoedge.com');
    expect(r.resolverFellowId).toBeNull();
  });
});
