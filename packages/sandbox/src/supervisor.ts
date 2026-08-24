import { fork, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as url from 'node:url';
import type { SandboxMessage } from './protocol.js';
import type { Plugin, KernelContext } from '@harness/kernel';
import type { ToolRegistry, Tool } from '@harness/tools';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export class PluginSupervisor {
  private child: ChildProcess | null = null;
  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: Error) => void }>();
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;

  constructor(
    private pluginPath: string,
    private pluginName: string,
    private ctx: KernelContext
  ) {
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  public async start(): Promise<void> {
    const workerScript = path.join(__dirname, 'worker.js');
    this.child = fork(workerScript, [], {
      env: {
        // Strip out host environment to prevent secret leakage
        HARNESS_PLUGIN_PATH: this.pluginPath,
      },
      execArgv: [],
    });

    this.child.on('message', (msg: SandboxMessage) => {
      this.handleMessage(msg);
    });

    this.child.on('error', (err) => {
      this.rejectReady(err);
    });

    this.child.on('exit', (code) => {
      // Reject all pending execution requests to prevent dangling promises
      for (const [id, req] of this.pendingRequests.entries()) {
        req.reject(new Error(`Plugin worker exited unexpectedly with code ${code}`));
      }
      this.pendingRequests.clear();
      
      if (code !== 0) {
        this.rejectReady(new Error(`Plugin worker exited with code ${code}`));
      }
    });

    await this.readyPromise;
  }

  public async stop(): Promise<void> {
    if (this.child) {
      if (this.child.connected) {
        this.child.disconnect();
      }
      this.child.unref();
      this.child.kill('SIGKILL');
      this.child = null;
    }
  }

  private handleMessage(msg: SandboxMessage) {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      console.warn('[Sandbox] Dropping malformed IPC message:', msg);
      return;
    }

    switch (msg.type) {
      case 'ready':
        this.resolveReady();
        break;
      case 'error':
        this.rejectReady(new Error(msg.message || 'Unknown sandbox error'));
        break;
      case 'register_tool':
        if (!msg.payload || typeof msg.payload !== 'object' || !msg.payload.name) {
          console.warn('[Sandbox] Dropping invalid register_tool payload:', msg.payload);
          return;
        }
        this.proxyToolRegistration(msg.payload as any);
        break;
      case 'execute_tool_result':
        if (!msg.id) return;
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
        break;
      default:
        console.warn('[Sandbox] Dropping unknown IPC message type:', (msg as any).type);
    }
  }

  private proxyToolRegistration(payload: { name: string; description: string; inputSchema: any; requiredCapabilities: string[] }) {
    if (!this.ctx.hasService('toolRegistry')) {
      console.warn(`[Sandbox] Cannot register tool ${payload.name} because toolRegistry is not available in host`);
      return;
    }
    const toolRegistry = this.ctx.resolveService<ToolRegistry>('toolRegistry');
    
    // Register a proxy tool in the host's registry
    const proxyTool: Tool = {
      name: payload.name,
      description: payload.description,
      inputSchema: payload.inputSchema,
      requiredCapabilities: payload.requiredCapabilities as any,
      execute: async (input: unknown) => {
        return this.executeRemoteTool(payload.name, input);
      },
    };

    toolRegistry.register(proxyTool);
  }

  private executeRemoteTool(name: string, input: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        return reject(new Error('Sandbox worker is not running'));
      }
      const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.pendingRequests.set(id, { resolve, reject });
      this.child.send({
        type: 'execute_tool',
        id,
        payload: { name, input },
      });
    });
  }
}

/**
 * Wraps an out-of-process sandboxed plugin into a standard Kernel Plugin.
 */
export function createSandboxedPlugin(pluginName: string, absolutePath: string): Plugin {
  let supervisor: PluginSupervisor;

  return {
    name: pluginName,
    dependencies: ['tools'], // Needs tools registry to register proxies
    async setup(ctx: KernelContext) {
      supervisor = new PluginSupervisor(absolutePath, pluginName, ctx);
      // We don't start the process until 'start' phase, but maybe we should start it now
      // because tools need to be registered during 'setup' hook.
      await supervisor.start();
    },
    async start(ctx: KernelContext) {
      // Already started in setup to allow tool registration
    },
    async stop(ctx: KernelContext) {
      if (supervisor) {
        await supervisor.stop();
      }
    }
  };
}
