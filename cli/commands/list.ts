import { ProfileResolver } from '@harness/profile';
import fs from 'node:fs';
import path from 'node:path';
import type { CliFlags } from '../config.js';
import { resolveConfig } from '../config.js';
import { ExitCode } from '../exit-codes.js';
import { getGlobalProfileDir, getGlobalConfigDir, getBuiltinProfileDir, discoverProject } from '../paths.js';
import { outputResult, header, dimText } from '../formatter.js';

export async function listCommand(flags?: CliFlags): Promise<number> {
  let config;
  try {
    config = resolveConfig(flags);
  } catch (err) {
    // If it fails to resolve, fallback to global
  }

  const resolver = new ProfileResolver();
  const builtinProfiles = resolver.listProfiles(getBuiltinProfileDir());
  const globalProfiles = resolver.listProfiles(getGlobalProfileDir());
  
  let projectProfiles: string[] = [];
  if (config?.project?.projectRoot) {
    projectProfiles = resolver.listProfiles(path.join(config.project.projectRoot, '.harness', 'profiles'));
  }

  const allProfiles = new Set([...builtinProfiles, ...globalProfiles, ...projectProfiles]);
  const profiles = Array.from(allProfiles).sort();
  
  const activeProfile = config?.profile?.name || 'default';

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

  const skills: string[] = [];

  const result = {
    profiles: profiles.map(p => ({ name: p, active: p === activeProfile })),
    plugins,
    skills,
  };

  outputResult(
    () => {
      const parts = [];
      
      parts.push(header('Profiles'));
      parts.push('────────────────────');
      if (profiles.length === 0) {
        parts.push(dimText('  (none)'));
      } else {
        profiles.forEach(p => {
          parts.push(p === activeProfile ? `* ${p}` : `  ${p}`);
        });
      }
      parts.push('');

      parts.push(header('Plugins'));
      parts.push('────────────────────');
      if (plugins.length === 0) {
        parts.push(dimText('  (none installed)'));
      } else {
        plugins.forEach(p => parts.push(`  ${p}`));
      }
      parts.push('');

      parts.push(header('Skills'));
      parts.push('────────────────────');
      if (skills.length === 0) {
        parts.push(dimText('  (none registered)'));
      } else {
        skills.forEach(s => parts.push(`  ${s}`));
      }

      return parts.join('\n');
    },
    result,
    { json: flags?.json }
  );

  return ExitCode.SUCCESS;
}
