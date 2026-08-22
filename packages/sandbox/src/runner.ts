import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface SandboxSpec {
  script: string;
  timeoutMs?: number;
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

      child.on('message', (msg: any) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg.result);
        }
        child.kill();
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
