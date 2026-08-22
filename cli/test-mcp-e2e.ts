import { ToolRegistry } from '../packages/tools/src/index.js';
import { McpServerManager } from '../packages/mcp/src/index.js';

async function main() {
  console.log('Starting MCP e2e test with a real external MCP server...');
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  
  const config = {
    name: 'everything',
    command: 'node',
    args: ['./node_modules/@modelcontextprotocol/server-everything/dist/index.js']
  };
  
  try {
    console.log('Initializing server-everything...');
    await manager.initializeServer(config, registry);
    console.log('Server initialized!');
    
    const tools = registry.list();
    console.log(`Registered ${tools.length} tools:`, tools.map(t => t.name));
    
    console.log('Executing echo tool...');
    const result = await registry.execute('everything.echo', { message: 'hello from harness' });
    console.log('Echo result:', JSON.stringify(result, null, 2));
    
    await manager.closeAll();
    console.log('Test complete and successful.');
  } catch (err) {
    console.error('Test failed:', err);
    await manager.closeAll();
    process.exit(1);
  }
}

main().catch(console.error);
