import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ToolRegistry } from '@harness/tools';

export interface SandboxSpec {
  script: string;
  timeoutMs?: number;
  toolRegistry?: ToolRegistry;
}

export class SandboxRunner {
  async run(spec: SandboxSpec): Promise<string> {
    return new Promise((resolve, reject) => {
      const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.js');
      const child = fork(workerPath);
      
      let timeoutId: NodeJS.Timeout | undefined;
      if (spec.timeoutMs) {
        timeoutId = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Sandbox timeout exceeded'));
        }, spec.timeoutMs);
      }

      child.on('message', async (msg: any) => {
        if (msg.type === 'tool_call') {
          if (!spec.toolRegistry) {
            child.send({ type: 'tool_result', id: msg.id, error: 'No ToolRegistry attached to Sandbox' });
            return;
          }
          try {
            const res = await spec.toolRegistry.execute(msg.toolName, msg.args);
            child.send({ type: 'tool_result', id: msg.id, result: res });
          } catch (err: any) {
            child.send({ type: 'tool_result', id: msg.id, error: err.message });
          }
        } else {
          if (timeoutId) clearTimeout(timeoutId);
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            resolve(msg.result);
          }
          child.kill();
        }
      });

      child.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(err);
      });

      child.on('exit', (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (code !== 0 && signal !== 'SIGKILL') {
          reject(new Error(`Child exited with code ${code}`));
        }
      });

      child.send({ script: spec.script });
    });
  }
}
