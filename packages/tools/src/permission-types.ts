export type Capability = string;

/**
 * Validates and parses a raw capability string.
 * Must follow namespace convention "<domain>.<action>" (e.g. "filesystem.read").
 * Throws a TypeError if the capability string is invalid.
 */
export function parseCapability(raw: unknown): Capability {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new TypeError('Capability must be a non-empty string.');
  }

  const trimmed = raw.trim().toLowerCase();
  const parts = trimmed.split('.');

  if (parts.length < 2 || parts.some((part) => !part.trim())) {
    throw new TypeError(
      `Invalid capability format "${raw}". Must follow namespace convention "<domain>.<action>" (e.g. "filesystem.read").`
    );
  }

  return trimmed as Capability;
}

export function parseCapabilities(raw: Iterable<string>): Capability[] {
  const result: Capability[] = [];
  for (const item of raw) {
    result.push(parseCapability(item));
  }
  return result;
}

export function capabilityEquals(a: string, b: string): boolean {
  return a === b;
}

/**
 * The information needed to evaluate a single permission check.
 * Contains only what is necessary — no agent internals, no secrets.
 */
export interface PermissionRequest {
  /** The name of the tool being executed. */
  readonly toolName: string;
  /** Capabilities the tool has declared it requires. */
  readonly requiredCapabilities: readonly Capability[];
  /** Capabilities that have been explicitly granted by the active policy. */
  readonly grantedCapabilities: ReadonlySet<Capability>;
}

/**
 * The outcome of a permission check.
 * Discriminated union: check `allowed` to branch.
 */
export type PermissionDecision =
  | {
      readonly allowed: true;
      readonly missingCapabilities?: undefined;
    }
  | {
      readonly allowed: false;
      /** Every capability that was required but not granted. Non-empty. */
      readonly missingCapabilities: readonly Capability[];
    };

/**
 * A permission policy evaluates a PermissionRequest and returns an explicit decision.
 *
 * Implementations must be:
 * - deterministic (same inputs → same output)
 * - side-effect free
 * - fast (no I/O, no network)
 * - independently testable
 */
export interface PermissionPolicy {
  check(request: PermissionRequest): PermissionDecision;
}
