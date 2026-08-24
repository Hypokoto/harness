import type { Capability } from '@harness/permissions';
import { ToolExecutionError, type Tool, type ToolContext } from '@harness/tools';
import { MCPToolError, MCPConnectionError } from './errors.js';

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
    if (typeof mcpToolName !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(mcpToolName)) {
      if (typeof mcpToolName === 'string' && (mcpToolName.includes('/') || mcpToolName.includes('.'))) {
         throw new Error(`Invalid MCP tool name format: ${mcpToolName}`);
      }
      throw new Error(`Invalid MCP tool name: ${String(mcpToolName)}`);
    }
  
    this.serverName = serverName;
    this.mcpToolName = mcpToolName;
    
    // Namespacing strategy: serverName.toolName
    this.name = `${serverName}.${mcpToolName}`;
    this.description = description || `MCP Tool ${mcpToolName} from ${serverName}`;
    this.inputSchema = inputSchema;
    this.requiredCapabilities = requiredCapabilities;
    this.client = client;
  }

  public validateInput(input: unknown): unknown {
    if (!this.inputSchema || typeof this.inputSchema !== 'object') {
      return input;
    }
    
    // Simple JSON schema validation for adversarial inputs
    if (this.inputSchema.type === 'object') {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error(`Expected object, got ${typeof input}`);
      }
      
      const obj = input as Record<string, unknown>;
      const required = this.inputSchema.required as string[] | undefined;
      const properties = this.inputSchema.properties as Record<string, any> | undefined;
      
      if (required && Array.isArray(required)) {
        for (const req of required) {
          if (!(req in obj)) {
            throw new Error(`Missing required field: ${req}`);
          }
        }
      }
      
      if (properties) {
        for (const [key, val] of Object.entries(obj)) {
          if (!(key in properties)) {
            // Check for strictness, reject extra fields for security tests
            throw new Error(`Extra fields not allowed: ${key}`);
          }
          const propSchema = properties[key];
          if (propSchema && propSchema.type) {
            if (propSchema.type === 'string' && typeof val !== 'string') {
               throw new Error(`Field ${key} expected string, got ${typeof val}`);
            }
            if (propSchema.type === 'number' && typeof val !== 'number') {
               throw new Error(`Field ${key} expected number, got ${typeof val}`);
            }
            if (propSchema.type === 'boolean' && typeof val !== 'boolean') {
               throw new Error(`Field ${key} expected boolean, got ${typeof val}`);
            }
          }
        }
      }
    }
    
    return input;
  }

  public async execute(input: any, context?: ToolContext): Promise<any> {
    try {
      const result = await this.client.callTool(this.mcpToolName, input || {});
      return this.normalizeResult(result);
    } catch (error) {
      if (error instanceof MCPConnectionError) {
        throw error;
      }
      throw new ToolExecutionError(
        `MCP Tool execution failed for ${this.name}: ${error instanceof Error ? error.message : String(error)}`,
        { toolName: this.name, cause: new MCPToolError(this.serverName, this.mcpToolName, error instanceof Error ? error.message : String(error), error) }
      );
    }
  }

  private normalizeResult(result: any): any {
    if (!result || typeof result !== 'object') {
       throw new Error('Malformed MCP result: expected object');
    }

    // Measure nesting depth and reject deep structures
    let currentDepth = 0;
    const checkDepth = (obj: any, depth: number) => {
      if (depth > 20) throw new Error('MCP result payload too deeply nested');
      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          checkDepth(obj[key], depth + 1);
        }
      }
    };
    checkDepth(result, 1);

    // Stringify to check actual byte size against an upper limit to prevent memory exhaustion
    try {
      const jsonStr = JSON.stringify(result);
      const byteSize = Buffer.byteLength(jsonStr, 'utf8');
      if (byteSize > 5 * 1024 * 1024) { // 5MB byte limit
        throw new Error(`MCP result payload too large (${byteSize} bytes exceeds 5MB limit)`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('payload too large')) throw e;
      if (e instanceof Error && e.message.includes('too deeply nested')) throw e;
      throw new Error('Malformed MCP result: not JSON serializable or circular');
    }

    if (result.content !== undefined) {
      if (!Array.isArray(result.content)) {
        throw new Error('Malformed MCP result: content must be an array');
      }
      
      for (const item of result.content) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('Malformed MCP result: content items must be objects');
        }
        if (typeof item.type !== 'string') {
          throw new Error('Malformed MCP result: content item type must be string');
        }
        if (item.type === 'text' && typeof item.text !== 'string') {
          throw new Error('Malformed MCP result: text content item must have string text property');
        }
      }
      return result.content;
    }
    
    return result;
  }
}
