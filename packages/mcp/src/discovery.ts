import type { ToolRegistry } from '@harness/tools';
import type { McpServerConfig } from './types.js';
import { McpClient } from './client.js';
import { McpTool } from './adapter.js';

export class McpServerManager {
  private clients = new Map<string, McpClient>();

  /**
   * Initializes a single MCP server, discovers its tools, and registers them in the given ToolRegistry.
   * If startup fails, it cleans up resources and throws an error.
   */
  public async initializeServer(config: McpServerConfig, registry: ToolRegistry): Promise<void> {
    const client = new McpClient(config);
    
    try {
      await client.start();
      
      const mcpTools = await client.listTools();
      
      for (const mcpTool of mcpTools) {
        // Adapt metadata
        const adapter = new McpTool(
          config.name,
          mcpTool.name,
          mcpTool.description || '',
          (mcpTool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
          config.requiredCapabilities,
          client
        );
        
        // Register in the existing ToolRegistry
        registry.register(adapter);
      }
      
      this.clients.set(config.name, client);
    } catch (error) {
      await client.close(); // Cleanup partially started resources
      throw error; // Rethrow to let the caller handle reporting
    }
  }

  /**
   * Starts multiple configured MCP servers and registers their tools.
   */
  public async initializeServers(configs: McpServerConfig[], registry: ToolRegistry): Promise<void> {
    const promises = configs.map(config => 
      this.initializeServer(config, registry)
        .catch(err => {
          // If one server fails, we do not want to break others immediately, but depending on requirements,
          // we might want to log it and continue.
          // Phase 9 rules: "A failure in one server must not corrupt unrelated local tools."
          // "If server A fails then server B remains usable."
          console.error(`Failed to initialize MCP server "${config.name}":`, err);
        })
    );
    await Promise.all(promises);
  }

  /**
   * Shuts down all active MCP clients.
   */
  public async closeAll(): Promise<void> {
    const promises = Array.from(this.clients.values()).map(client => client.close());
    await Promise.allSettled(promises);
    this.clients.clear();
  }
}
