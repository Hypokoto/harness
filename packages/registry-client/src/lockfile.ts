import fs from 'node:fs/promises';
import path from 'node:path';
import type { Lockfile, LockfilePackage } from './types.js';

export class LockfileManager {
  private readonly lockfilePath: string;

  constructor(lockfilePath: string) {
    this.lockfilePath = lockfilePath;
  }

  async read(): Promise<Lockfile> {
    try {
      const text = await fs.readFile(this.lockfilePath, 'utf8');
      return JSON.parse(text) as Lockfile;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { schemaVersion: 1, packages: {} };
      }
      throw err;
    }
  }

  async write(lockfile: Lockfile): Promise<void> {
    await fs.mkdir(path.dirname(this.lockfilePath), { recursive: true });
    await fs.writeFile(this.lockfilePath, JSON.stringify(lockfile, null, 2), 'utf8');
  }

  async addPackage(pkg: LockfilePackage): Promise<void> {
    const lockfile = await this.read();
    lockfile.packages[pkg.name] = pkg;
    await this.write(lockfile);
  }

  async getPackage(name: string): Promise<LockfilePackage | undefined> {
    const lockfile = await this.read();
    return lockfile.packages[name];
  }
}
