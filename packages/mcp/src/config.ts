import { InvalidInputError } from '@harness/tools';
import type { McpServerConfig } from './types.js';

/**
 * Validates MCP server configuration.
 * Must have a name and a command.
 */
export function validateServerConfig(config: unknown): McpServerConfig {
  if (!config || typeof config !== 'object') {
    throw new InvalidInputError('MCP server config must be an object.');
  }

  const c = config as Record<string, unknown>;

  if (typeof c.name !== 'string' || !c.name.trim()) {
    throw new InvalidInputError('MCP server config must include a valid non-empty "name" string.');
  }

  if (typeof c.command !== 'string' || !c.command.trim()) {
    throw new InvalidInputError(`MCP server "${c.name}" config must include a valid non-empty "command" string.`);
  }

  if (c.args !== undefined) {
    if (!Array.isArray(c.args) || c.args.some((a) => typeof a !== 'string')) {
      throw new InvalidInputError(`MCP server "${c.name}" config "args" must be an array of strings if provided.`);
    }
  }

  if (c.env !== undefined) {
    if (typeof c.env !== 'object' || c.env === null || Array.isArray(c.env)) {
      throw new InvalidInputError(`MCP server "${c.name}" config "env" must be an object map if provided.`);
    }
    for (const [k, v] of Object.entries(c.env)) {
      if (typeof v !== 'string') {
        throw new InvalidInputError(`MCP server "${c.name}" config "env" values must be strings. Key "${k}" is invalid.`);
      }
    }
  }

  return c as unknown as McpServerConfig;
}
