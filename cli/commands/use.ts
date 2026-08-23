import { ProfileResolver } from '@harness/profile';
import type { CliFlags } from '../config.js';
import { resolveConfig, writeActiveProfile } from '../config.js';
import { ExitCode } from '../exit-codes.js';
import { getGlobalProfileDir, getBuiltinProfileDir } from '../paths.js';
import { outputResult, success, failure } from '../formatter.js';
import path from 'node:path';

export async function useCommand(profileName: string, flags?: CliFlags): Promise<number> {
  let config;
  try {
    config = resolveConfig(flags);
  } catch (err) {
    // If it fails to resolve, fallback to global
  }

  const profileDir = config?.profileDir || getGlobalProfileDir();
  
  const resolver = new ProfileResolver();
  const builtinProfiles = resolver.listProfiles(getBuiltinProfileDir());
  const globalProfiles = resolver.listProfiles(getGlobalProfileDir());
  
  let projectProfiles: string[] = [];
  if (config?.project?.projectDir) {
    projectProfiles = resolver.listProfiles(path.join(config.project.projectDir, 'profiles'));
  }

  const allProfiles = new Set([...builtinProfiles, ...globalProfiles, ...projectProfiles]);

  if (!allProfiles.has(profileName)) {
    outputResult(
      () => failure(`Profile '${profileName}' not found`),
      { error: `Profile '${profileName}' not found` },
      { json: flags?.json }
    );
    return ExitCode.GENERIC_ERROR;
  }

  writeActiveProfile(profileDir, profileName);

  outputResult(
    () => success(`Active profile set to '${profileName}'`),
    { profile: profileName, success: true },
    { json: flags?.json }
  );

  return ExitCode.SUCCESS;
}
