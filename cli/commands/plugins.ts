import fs from 'node:fs';
import path from 'node:path';
import type { CliFlags } from '../config.js';
import { ExitCode } from '../exit-codes.js';
import { getGlobalConfigDir, discoverProject } from '../paths.js';
import { outputResult, header, dimText } from '../formatter.js';

export async function pluginsCommand(flags?: CliFlags): Promise<number> {
  const project = discoverProject();
  let lockfilePath = path.join(getGlobalConfigDir(), 'installed', 'lock.json');
  if (project.projectRoot) {
    const projLock = path.join(project.projectRoot, '.harness', 'installed', 'lock.json');
    if (fs.existsSync(projLock)) {
      lockfilePath = projLock;
    }
  }

  let plugins: string[] = [];
  if (fs.existsSync(lockfilePath)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
      plugins = Object.keys(lockData.packages || {});
    } catch {
      // ignore
    }
  }

  outputResult(
    () => {
      const parts = [header('Installed Plugins'), '────────────────────'];
      if (plugins.length === 0) {
        parts.push(dimText('  (none installed)'));
      } else {
        plugins.forEach(p => parts.push(`  ${p}`));
      }
      return parts.join('\n');
    },
    { plugins },
    { json: flags?.json }
  );

  return ExitCode.SUCCESS;
}
