import * as path from 'node:path';
import * as url from 'node:url';

// Node's IPC process boundary
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

async function main() {
  if (!process.send) {
    throw new Error('Must be run as a child process via fork');
  }

  const pluginPath = process.env.HARNESS_PLUGIN_PATH;
  if (!pluginPath) {
    throw new Error('HARNESS_PLUGIN_PATH not provided');
  }

  let pluginModule;
  try {
    pluginModule = await import(pluginPath);
  } catch (err) {
    process.send({ type: 'error', message: `Failed to load plugin: ${err}` });
    return;
  }

  const plugin = pluginModule.default || pluginModule;
  const tools = new Map<string, any>();

  // Mock KernelContext for the worker
  const ctx = {
    resolveService: (name: string) => {
      if (name === 'toolRegistry') {
        return {
          register: (tool: any) => {
            tools.set(tool.name, tool);
            process.send!({
              type: 'register_tool',
              payload: {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                requiredCapabilities: tool.requiredCapabilities,
              },
            });
          }
        };
      }
      throw new Error(`Worker sandbox cannot resolve service: ${name}`);
    },
    registerService: () => {
      throw new Error('Worker sandbox cannot register arbitrary services');
    },
    hasService: (name: string) => name === 'toolRegistry',
    getState: () => 'running',
  };

  process.on('message', async (msg: any) => {
    if (msg.type === 'execute_tool') {
      const tool = tools.get(msg.payload.name);
      if (!tool) {
        process.send!({
          type: 'execute_tool_result',
          id: msg.id,
          error: `Tool ${msg.payload.name} not found in worker`,
        });
        return;
      }

      try {
        const result = await tool.execute(msg.payload.input, { signal: undefined });
        process.send!({
          type: 'execute_tool_result',
          id: msg.id,
          result,
        });
      } catch (err) {
        process.send!({
          type: 'execute_tool_result',
          id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  if (plugin.setup) {
    try {
      await plugin.setup(ctx);
    } catch (err) {
      process.send({ type: 'error', message: `Plugin setup failed: ${err}` });
      return;
    }
  }

  if (plugin.start) {
    try {
      await plugin.start(ctx);
    } catch (err) {
      process.send({ type: 'error', message: `Plugin start failed: ${err}` });
      return;
    }
  }

  process.send({ type: 'ready' });
}

main().catch(err => {
  if (process.send) {
    process.send({ type: 'error', message: err.message });
  }
});
