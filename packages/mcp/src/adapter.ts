import type { Capability } from '@harness/permissions';
import { ToolExecutionError, type Tool, type ToolContext } from '@harness/tools';
import { MCPToolError } from './errors.js';

export interface McpClientAdapter {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export class McpTool implements Tool<any, any> {
  public readonly name: string;
  public readonly description: string;
  public readonly inputSchema: Record<string, unknown>;
  public readonly requiredCapabilities?: readonly Capability[];
  
  private readonly mcpToolName: string;
  private readonly serverName: string;
  private readonly client: McpClientAdapter;

  constructor(
    serverName: string,
    mcpToolName: string,
    description: string,
    inputSchema: Record<string, unknown>,
    requiredCapabilities: readonly Capability[] | undefined,
    client: McpClientAdapter
  ) {
    this.serverName = serverName;
    this.mcpToolName = mcpToolName;
    
    // Namespacing strategy: serverName.toolName
    this.name = `${serverName}.${mcpToolName}`;
    this.description = description || `MCP Tool ${mcpToolName} from ${serverName}`;
    this.inputSchema = inputSchema;
    this.requiredCapabilities = requiredCapabilities;
    this.client = client;
  }

  public async execute(input: any, context?: ToolContext): Promise<any> {
    try {
      const result = await this.client.callTool(this.mcpToolName, input || {});
      return this.normalizeResult(result);
    } catch (error) {
      if (error instanceof Error && error.name === 'MCPConnectionError') {
        throw error;
      }
      throw new ToolExecutionError(
        `MCP Tool execution failed for ${this.name}: ${error instanceof Error ? error.message : String(error)}`,
        { toolName: this.name, cause: new MCPToolError(this.serverName, this.mcpToolName, error instanceof Error ? error.message : String(error), error) }
      );
    }
  }

  private normalizeResult(result: any): any {
    // If the result is an MCP content array (which is the standard return),
    // normalize it into a structure or plain object.
    // For now, if it has `content` array, just pass it through or format it.
    if (result && Array.isArray(result.content)) {
      // Return the content array as the result directly, or just pass the whole result.
      return result.content;
    }
    return result;
  }
}
