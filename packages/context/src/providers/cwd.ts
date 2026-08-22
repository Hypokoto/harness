import { isAbsolute, resolve } from 'node:path';
import type { ContextProvider } from '../types.js';

export interface CwdContextProviderOptions {
  cwd?: string;
  name?: string;
}

export class CwdContextProvider implements ContextProvider {
  public readonly name: string;
  public readonly cwd: string;

  constructor(options: CwdContextProviderOptions = {}) {
    this.name = options.name ?? 'cwd';
    const targetCwd = options.cwd ?? process.cwd();
    this.cwd = isAbsolute(targetCwd) ? targetCwd : resolve(process.cwd(), targetCwd);
  }

  public getSystemPrompt(): string {
    return `[Working Directory: ${this.cwd}]`;
  }

  public getMetadata(): Record<string, unknown> {
    return {
      cwd: this.cwd,
    };
  }
}
