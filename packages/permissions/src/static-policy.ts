import {
  parseCapability,
  type Capability,
  type PermissionDecision,
  type PermissionPolicy,
  type PermissionRequest,
} from '@harness/tools';

/**
 * A simple, deterministic capability policy backed by an explicit grant set.
 *
 * Semantics:
 * - ALL-OF: every required capability must appear in the grant set.
 * - EXACT: capability identifiers are compared with strict string equality.
 *   "filesystem" does NOT imply "filesystem.read" or "filesystem.write".
 * - NO wildcards.
 */
export class StaticCapabilityPolicy implements PermissionPolicy {
  private readonly granted: ReadonlySet<Capability>;

  /**
   * @param grantedCapabilities - An iterable of raw capability strings.
   *   Each value is validated via parseCapability on construction.
   */
  constructor(grantedCapabilities: Iterable<string>) {
    const parsed = new Set<Capability>();
    for (const raw of grantedCapabilities) {
      parsed.add(parseCapability(raw));
    }
    this.granted = parsed;
  }

  /**
   * Return the set of granted capabilities (read-only view).
   * Exposed so callers can inspect grants for display/audit purposes.
   */
  public getGranted(): ReadonlySet<Capability> {
    return this.granted;
  }

  public check(request: PermissionRequest): PermissionDecision {
    if (request.requiredCapabilities.length === 0) {
      return { allowed: true };
    }

    const missing: Capability[] = [];
    for (const cap of request.requiredCapabilities) {
      if (!this.granted.has(cap)) {
        missing.push(cap);
      }
    }

    if (missing.length > 0) {
      return { allowed: false, missingCapabilities: missing };
    }

    return { allowed: true };
  }
}
