/**
 * Configuration resolution for the harness CLI.
 *
 * Precedence (highest to lowest):
 *   1. CLI flags / explicit overrides
 *   2. Project config (.harness.toml)
 *   3. Selected profile
 *   4. Global config (~/.config/harness/config.toml)
 *   5. Built-in defaults
 *
 * This module does NOT own profile resolution.
 * It delegates to @harness/profile's ProfileResolver, which already implements
 * the merge semantics. This module's job is to provide the correct paths
 * and options to ProfileResolver.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ProfileResolver } from '@harness/profile';
import type { ProfileConfig, ProfileResolverOptions, ResolvedProfile } from '@harness/profile';
import {
  discoverProject,
  getBuiltinConfigPath,
  getBuiltinProfileDir,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getGlobalProfileDir,
  getProjectEventsDir,
  type ProjectDiscovery,
} from './paths.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CliFlags {
  profile?: string;
  model?: string;
  provider?: string;
  projectDir?: string;
  session?: string;
  nonInteractive?: boolean;
  json?: boolean;
}

export interface ResolvedConfig {
  /** The resolved profile (name + merged config + sources) */
  profile: ResolvedProfile;
  /** Project discovery results */
  project: ProjectDiscovery;
  /** Effective model provider name */
  modelProvider: string;
  /** Effective model name */
  modelName: string;
  /** Path to event store directory */
  eventsDir: string;
  /** CLI flags that were passed */
  flags: CliFlags;
  /** The profile directory that was used for resolution */
  profileDir: string;
}

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve the full configuration from all sources.
 *
 * This is the single entry point that CLI commands call.
 * It discovers the project, locates profile directories,
 * and delegates to ProfileResolver for the actual merge.
 */
export function resolveConfig(flags: CliFlags = {}): ResolvedConfig {
  // 1. Discover project
  const project = discoverProject(flags.projectDir);

  // 2. Determine active state directory (where .active is read/written)
  let activeStateDir = getGlobalProfileDir();
  if (project.projectRoot) {
    activeStateDir = path.join(project.projectRoot, '.harness', 'profiles');
  }

  // 3. Determine global config path
  const globalConfig = getGlobalConfigPath();

  // 4. Build CLI overrides from flags
  const overrides: Partial<ProfileConfig> = {};
  if (flags.model || flags.provider) {
    overrides.model = {};
    if (flags.provider) (overrides.model as Record<string, unknown>).provider = flags.provider;
    if (flags.model) (overrides.model as Record<string, unknown>).name = flags.model;
  }

  // 5. Determine profile name (from flags or activeStateDir or global)
  let profileName: string | undefined = flags.profile;
  if (!profileName) {
    profileName = readActiveProfile(activeStateDir) ?? undefined;
    if (!profileName && activeStateDir !== getGlobalProfileDir()) {
      profileName = readActiveProfile(getGlobalProfileDir()) ?? undefined;
    }
    profileName = profileName ?? 'default';
  }

  // 5b. Find which directory actually contains the profile TOML
  let tomlDir = activeStateDir;
  const searchDirs = [
    activeStateDir,
    getGlobalProfileDir(),
    getBuiltinProfileDir()
  ];
  for (const dir of searchDirs) {
    if (existsSync(path.join(dir, `${profileName}.toml`))) {
      tomlDir = dir;
      break;
    }
  }

  // 6. Delegate to ProfileResolver
  const resolver = new ProfileResolver();
  const resolverOptions: ProfileResolverOptions = {
    globalConfigPath: existsSync(globalConfig) ? globalConfig : undefined,
    profileDir: tomlDir,
    profileName: profileName,
    projectDir: project.projectRoot ?? undefined,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  };

  const resolved = resolver.resolve(resolverOptions);

  // 7. Extract model config from the resolved profile
  const { modelProvider, modelName } = extractModelConfig(resolved.config);

  // 8. Determine events directory
  const eventsDir = project.projectRoot
    ? getProjectEventsDir(project.projectRoot)
    : path.join(getGlobalConfigDir(), 'events');

  return {
    profile: resolved,
    project,
    modelProvider,
    modelName,
    eventsDir,
    flags,
    profileDir: activeStateDir,
  };
}

// ── Active Profile ──────────────────────────────────────────────────────────

/** Read the currently active profile name from the profile directory */
function readActiveProfile(profileDir: string): string | null {
  const activeFile = path.join(profileDir, '.active');
  if (existsSync(activeFile)) {
    return readFileSync(activeFile, 'utf8').trim() || null;
  }
  return null;
}

/** Write the active profile name */
export function writeActiveProfile(profileDir: string, name: string): void {
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(path.join(profileDir, '.active'), name + '\n', 'utf8');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine the effective profile directory.
 *
 * Priority:
 *   1. Project .harness/profiles/
 *   2. Global ~/.config/harness/profiles/
 *   3. Builtin <install>/config/profiles/
 */
function resolveProfileDir(project: ProjectDiscovery): string {
  // Project-local profiles
  if (project.projectRoot) {
    return path.join(project.projectRoot, '.harness', 'profiles');
  }

  // Global profiles
  const globalProfiles = getGlobalProfileDir();
  if (existsSync(globalProfiles)) {
    return globalProfiles;
  }

  // Builtin profiles (from the harness installation)
  return getBuiltinProfileDir();
}

/**
 * Extract model provider and name from the resolved profile config.
 *
 * The profile's `model` field can be:
 *   - A string like "anthropic/claude-3-5-sonnet" (provider/model format)
 *   - A string like "ollama" (just provider)
 *   - An object like { provider: "ollama", name: "qwen2.5:0.5b" }
 */
function extractModelConfig(config: ProfileConfig): { modelProvider: string; modelName: string } {
  const modelField = config.model;

  if (typeof modelField === 'object' && modelField !== null) {
    const obj = modelField as Record<string, unknown>;
    return {
      modelProvider: String(obj.provider ?? 'anthropic'),
      modelName: String(obj.name ?? obj.model ?? 'unknown'),
    };
  }

  if (typeof modelField === 'string') {
    if (modelField.includes('/')) {
      const [provider, ...rest] = modelField.split('/');
      return { modelProvider: provider, modelName: rest.join('/') };
    }
    return { modelProvider: modelField, modelName: modelField };
  }

  return { modelProvider: 'anthropic', modelName: 'claude-3-5-sonnet' };
}
