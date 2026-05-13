export interface FellowMinimal {
  recordId: string;
  designation: string;
  email: string;
  name: string;
}

export interface FlagResolverInput {
  flaggedFellow: FellowMinimal;
  projectVpAvpIds: string[];
  allFellows: FellowMinimal[];
  adminEmail?: string;
}

export interface ResolverResult {
  resolverFellowId: string | null;
  resolverEmail: string;
  resolverName: string | null;
}

function isVpOrAvp(designation: string): boolean {
  return designation === 'VP' || designation === 'AVP';
}

/**
 * Pick the resolver (TO recipient) for a director_flag conflict.
 *
 * Rules:
 *   - If the flagged fellow is VP or AVP → they resolve themselves.
 *   - Else if the project has at least one VP/AVP → first one on the project resolves.
 *   - Else → the flagged fellow resolves themselves.
 *   - Else (no resolver reachable) → fall back to adminEmail.
 */
export function computeResolverForFlag(input: FlagResolverInput): ResolverResult {
  const { flaggedFellow, projectVpAvpIds, allFellows, adminEmail } = input;

  if (isVpOrAvp(flaggedFellow.designation)) {
    return {
      resolverFellowId: flaggedFellow.recordId,
      resolverEmail: flaggedFellow.email,
      resolverName: flaggedFellow.name,
    };
  }

  // Find first VP/AVP among project's vpAvpIds (verified by designation lookup)
  for (const id of projectVpAvpIds) {
    const f = allFellows.find(x => x.recordId === id);
    if (f && isVpOrAvp(f.designation)) {
      return {
        resolverFellowId: f.recordId,
        resolverEmail: f.email,
        resolverName: f.name,
      };
    }
  }

  // No VP on project — flagged fellow resolves themselves if reachable
  const self = allFellows.find(x => x.recordId === flaggedFellow.recordId);
  if (self) {
    return {
      resolverFellowId: self.recordId,
      resolverEmail: self.email,
      resolverName: self.name,
    };
  }

  // Defensive fallback
  return {
    resolverFellowId: null,
    resolverEmail: adminEmail || 'admin@indigoedge.com',
    resolverName: null,
  };
}

export interface Recipients {
  to: string;
  cc: string[];
}

/**
 * Dedupe by email (case-insensitive). TO takes priority — any CC that matches TO is dropped.
 * CC order is preserved on first occurrence.
 */
export function dedupeRecipients(r: Recipients): Recipients {
  const toLower = r.to.toLowerCase();
  const seen = new Set<string>([toLower]);
  const cc: string[] = [];
  for (const addr of r.cc) {
    const lc = addr.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    cc.push(addr);
  }
  return { to: r.to, cc };
}
