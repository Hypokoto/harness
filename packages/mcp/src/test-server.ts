import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({
  name: 'test-server',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'echo',
        description: 'Echoes the input',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          },
          required: ['message']
        }
      },
      {
        name: 'restricted',
        description: 'Requires filesystem.read capability',
        inputSchema: {
          type: 'object',
          properties: {
            file: { type: 'string' }
          },
          required: ['file']
        }
      },
      {
        name: 'noisy',
        description: 'Writes to stderr then returns',
        inputSchema: {
          type: 'object',
          properties: {},
        }
      },
      {
        name: 'error_tool',
        description: 'Throws an error',
        inputSchema: {
          type: 'object',
          properties: {},
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  
  if (name === 'echo') {
    return {
      content: [
        { type: 'text', text: `echo: ${args.message}` }
      ]
    };
  }
  if (name === 'restricted') {
    return {
      content: [
        { type: 'text', text: `read: ${args.file}` }
      ]
    };
  }
  if (name === 'noisy') {
    console.error('This is a diagnostic message on stderr');
    return {
      content: [
        { type: 'text', text: 'noisy success' }
      ]
    };
  }
  if (name === 'error_tool') {
    throw new Error('This tool intentionally fails');
  }
  
  throw new Error(`Unknown tool: ${name}`);
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch(console.error);
