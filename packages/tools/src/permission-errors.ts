import type { Capability } from './permission-types.js';

/**
 * Structured error thrown when a tool execution is denied by PermissionPolicy.
 * Identifies the tool name and all missing capabilities required for execution.
 */
export class PermissionDeniedError extends Error {
  readonly toolName: string;
  readonly missingCapabilities: readonly Capability[];

  constructor(toolName: string, missingCapabilities: readonly Capability[]) {
    const missingStr = missingCapabilities.join(', ');
    super(
      `Permission denied: tool "${toolName}" requires missing capability/capabilities: [${missingStr}].`
    );
    this.name = 'PermissionDeniedError';
    this.toolName = toolName;
    this.missingCapabilities = [...missingCapabilities];
  }
}
