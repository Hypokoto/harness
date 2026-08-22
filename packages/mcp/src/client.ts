import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from './types.js';
import { MCPConnectionError, MCPProtocolError } from './errors.js';
import type { McpClientAdapter } from './adapter.js';

export class McpClient implements McpClientAdapter {
  private client: Client;
  private transport?: StdioClientTransport;
  private connected = false;

  constructor(public readonly config: McpServerConfig) {
    this.client = new Client(
      {
        name: 'harness-mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );
  }

  public async start(): Promise<void> {
    if (this.connected) return;

    try {
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: { ...process.env, ...this.config.env },
        stderr: 'pipe',
      });

      // Handle stderr separately to not pollute stdout protocol stream.
      // Depending on the version of the SDK, stderr might be available on the transport or the spawned process.
      // But we just pass stderr: 'pipe' above, the transport handles it if supported, or we let the SDK deal with it.

      await this.client.connect(this.transport);
      this.connected = true;
    } catch (error) {
      throw new MCPConnectionError(
        this.config.name,
        error instanceof Error ? error.message : String(error),
        error
      );
    }
  }

  public async listTools(): Promise<any[]> {
    this.ensureConnected();
    try {
      const response = await this.client.listTools();
      return response.tools || [];
    } catch (error) {
      throw new MCPProtocolError(
        this.config.name,
        `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  public async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.ensureConnected();
    try {
      const response = await this.client.callTool({
        name,
        arguments: args,
      });
      return response;
    } catch (error) {
      // Re-throw to be caught by adapter and wrapped in ToolExecutionError -> MCPToolError
      throw error;
    }
  }

  public async close(): Promise<void> {
    if (!this.connected) return;
    try {
      if (this.transport) {
        await this.transport.close();
      }
      this.connected = false;
    } catch (error) {
      // Best effort shutdown
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new MCPConnectionError(this.config.name, 'Client is not connected');
    }
  }
}
