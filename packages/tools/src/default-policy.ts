import type { PermissionDecision, PermissionPolicy, PermissionRequest } from './permission-types.js';

/**
 * Safe default permission policy.
 *
 * If no permission policy is explicitly supplied:
 * - Tools with zero requiredCapabilities: ALLOWED
 * - Tools requiring any capability: DENIED
 */
export class DefaultDenyPolicy implements PermissionPolicy {
  public check(request: PermissionRequest): PermissionDecision {
    if (request.requiredCapabilities.length === 0) {
      return { allowed: true };
    }

    return {
      allowed: false,
      missingCapabilities: [...request.requiredCapabilities],
    };
  }
}
