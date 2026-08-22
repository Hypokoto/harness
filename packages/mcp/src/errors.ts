/**
 * Error indicating that a connection to an MCP server failed or was lost.
 */
export class MCPConnectionError extends Error {
  constructor(public readonly serverName: string, message: string, public readonly cause?: unknown) {
    super(`MCP connection to server "${serverName}" failed: ${message}`);
    this.name = 'MCPConnectionError';
  }
}

/**
 * Error indicating a protocol-level failure with the MCP server.
 */
export class MCPProtocolError extends Error {
  constructor(public readonly serverName: string, message: string, public readonly cause?: unknown) {
    super(`MCP protocol error on server "${serverName}": ${message}`);
    this.name = 'MCPProtocolError';
  }
}

/**
 * Error indicating that a specific tool execution failed on the MCP server.
 */
export class MCPToolError extends Error {
  constructor(public readonly serverName: string, public readonly toolName: string, message: string, public readonly cause?: unknown) {
    super(`MCP tool "${toolName}" on server "${serverName}" failed: ${message}`);
    this.name = 'MCPToolError';
  }
}
