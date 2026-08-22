import type { ProfileConfig } from '@harness/profile';
import { parseCapability, DefaultDenyPolicy, type PermissionPolicy } from '@harness/tools';
import { StaticCapabilityPolicy } from './static-policy.js';

/**
 * Build a PermissionPolicy from a resolved ProfileConfig.
 *
 * Reads the `grantedCapabilities` field (or `permissions.granted`) from profile config.
 * - If present and non-empty: returns a StaticCapabilityPolicy with those grants.
 * - If absent or empty: returns a DefaultDenyPolicy.
 *
 * Precedence is determined entirely by the profile resolver (Phase 6).
 * Capability values are validated via parseCapability upfront.
 */
export function buildPolicyFromProfile(config: ProfileConfig): PermissionPolicy {
  const raw = config.grantedCapabilities;

  if (!raw || raw.length === 0) {
    return new DefaultDenyPolicy();
  }

  // Validate all capabilities upfront — fail fast on misconfiguration.
  for (const cap of raw) {
    parseCapability(cap);
  }

  return new StaticCapabilityPolicy(raw);
}
