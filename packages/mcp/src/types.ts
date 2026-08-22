import type { Capability } from '@harness/permissions';

export interface McpServerConfig {
  /** Uniquely identifies this MCP server instance. */
  name: string;
  /** Command to execute (e.g. "npx", "node", "python"). */
  command: string;
  /** Arguments to pass to the command. */
  args?: string[];
  /** Environment variables to pass to the process (in addition to inherited env). */
  env?: Record<string, string>;
  /** Required capabilities for tools exposed by this server. */
  requiredCapabilities?: Capability[];
}
