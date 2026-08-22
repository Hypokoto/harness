/**
 * @harness/permissions
 * Phase 8 — Capability-based permission system.
 *
 * Public API:
 *   - Capability type + parseCapability, parseCapabilities, capabilityEquals
 *   - PermissionRequest, PermissionDecision, PermissionPolicy
 *   - StaticCapabilityPolicy
 *   - DefaultDenyPolicy
 *   - PermissionDeniedError
 *   - buildPolicyFromProfile
 */
export {
  parseCapability,
  parseCapabilities,
  capabilityEquals,
  DefaultDenyPolicy,
  PermissionDeniedError,
} from '@harness/tools';
export type {
  Capability,
  PermissionDecision,
  PermissionPolicy,
  PermissionRequest,
} from '@harness/tools';
export { buildPolicyFromProfile } from './profile-policy.js';
export { StaticCapabilityPolicy } from './static-policy.js';
