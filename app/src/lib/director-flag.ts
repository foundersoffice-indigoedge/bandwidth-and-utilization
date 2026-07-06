import { getStringList } from 'ie-ai-rulebook';
import { determineSeniorId } from '@/lib/project-role';

export interface FellowMinimal {
  recordId: string;
  designation: string;
  email: string;
  name: string;
}

export interface FlagResolverInput {
  flaggedFellow: FellowMinimal;
  projectVpAvpIds: string[];
  projectDirectorIds: string[];
  allFellows: FellowMinimal[];
  adminEmail?: string;
}

export interface ResolverResult {
  resolverFellowId: string | null;
  resolverEmail: string;
  resolverName: string | null;
}

function isVpOrAvp(designation: string): boolean {
  return getStringList('utilization-mis.vocab.vp-avp').includes(designation);
}

/**
 * Pick the resolver (TO recipient) for a director_flag conflict.
 *
 * Placement-aware: the mandate's senior owns resolution, regardless of the flagged
 * fellow's own title. Senior = first eligible VP/AVP in slot order, then an eligible
 * VP/AVP leading from the director slot (see determineSeniorId).
 *   - If the project has a senior → the senior resolves (even if the flagged fellow
 *     is an AVP sitting in an associate slot). If the flagged fellow IS the senior,
 *     they resolve themselves.
 *   - Else (no senior on the project) → the flagged fellow resolves themselves.
 *   - Else (not reachable) → fall back to adminEmail.
 */
export function computeResolverForFlag(input: FlagResolverInput): ResolverResult {
  const { flaggedFellow, projectVpAvpIds, projectDirectorIds, allFellows, adminEmail } = input;
  const byId = new Map(allFellows.map(f => [f.recordId, f]));
  const isEligible = (id: string) => {
    const f = byId.get(id);
    return !!f && isVpOrAvp(f.designation);
  };

  const seniorId = determineSeniorId(projectVpAvpIds, projectDirectorIds, isEligible);

  // The senior resolves. If the flagged fellow IS the senior, they resolve themselves.
  if (seniorId) {
    const s = byId.get(seniorId)!;
    return { resolverFellowId: s.recordId, resolverEmail: s.email, resolverName: s.name };
  }

  // No senior on the project — flagged fellow resolves themselves if reachable.
  const self = byId.get(flaggedFellow.recordId);
  if (self) return { resolverFellowId: self.recordId, resolverEmail: self.email, resolverName: self.name };

  return { resolverFellowId: null, resolverEmail: adminEmail || 'admin@indigoedge.com', resolverName: null };
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
