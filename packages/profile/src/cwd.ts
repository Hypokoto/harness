import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function findProjectConfig(startDir?: string): string | null {
  let currDir = resolve(startDir ?? process.cwd());

  while (true) {
    const candidate = join(currDir, '.harness.toml');
    if (existsSync(candidate)) {
      return candidate;
    }

    // Stop traversal if we hit a known project boundary
    if (existsSync(join(currDir, '.git')) || existsSync(join(currDir, 'package.json'))) {
      break;
    }

    const parent = dirname(currDir);
    if (parent === currDir) {
      break;
    }
    currDir = parent;
  }

  return null;
}
