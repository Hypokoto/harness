/**
 * Path resolution for the harness CLI.
 *
 * Distinguishes:
 *   - CLI installation path (where the harness package is installed)
 *   - Global config path    (~/.config/harness/)
 *   - Global data path      (~/.local/share/harness/)
 *   - Global cache path     (~/.cache/harness/)
 *   - Project path           (discovered from cwd via .harness.toml or .harness/)
 *
 * NEVER stores project state in the CLI installation directory.
 * NEVER constructs paths relative to __dirname for user state.
 */

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProjectConfig } from '@harness/profile';

// ── Global Paths (XDG-ish on Linux, standard on macOS/Windows) ──────────────

function xdgOrDefault(envVar: string, fallback: string): string {
  return process.env[envVar] || path.join(os.homedir(), fallback);
}

/** ~/.config/harness/ — configuration, profiles, global config.toml */
export function getGlobalConfigDir(): string {
  return path.join(xdgOrDefault('XDG_CONFIG_HOME', '.config'), 'harness');
}

/** ~/.local/share/harness/ — persistent data (installed plugins, etc.) */
export function getGlobalDataDir(): string {
  return path.join(xdgOrDefault('XDG_DATA_HOME', path.join('.local', 'share')), 'harness');
}

/** ~/.cache/harness/ — cache data (model cache, etc.) */
export function getGlobalCacheDir(): string {
  return path.join(xdgOrDefault('XDG_CACHE_HOME', '.cache'), 'harness');
}

/** Global config.toml path */
export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), 'config.toml');
}

/** Global profiles directory */
export function getGlobalProfileDir(): string {
  return path.join(getGlobalConfigDir(), 'profiles');
}

// ── Install Paths ───────────────────────────────────────────────────────────

/** The root of the harness installation (where packages/ lives). */
export function getInstallRoot(): string {
  // cli/dist/bin.js → cli/dist/ → cli/ → <root>
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), '..', '..');
}

/** Path to the built-in profiles shipped with the harness installation. */
export function getBuiltinProfileDir(): string {
  return path.join(getInstallRoot(), 'config', 'profiles');
}

/** Path to the built-in config.toml shipped with the harness installation. */
export function getBuiltinConfigPath(): string {
  return path.join(getInstallRoot(), 'config', 'config.toml');
}

// ── Project Discovery ───────────────────────────────────────────────────────

export interface ProjectDiscovery {
  /** Absolute path to the project root, or null if no project found */
  projectRoot: string | null;
  /** Absolute path to .harness.toml, or null if not found */
  projectConfigPath: string | null;
  /** Absolute path to .harness/ directory, or null if not found */
  projectDir: string | null;
  /** The directory from which discovery started */
  startDir: string;
}

/**
 * Discover the project root by walking up from startDir.
 *
 * Looks for (in order):
 *   1. .harness.toml
 *   2. .harness/ directory
 *
 * Uses the existing findProjectConfig() from @harness/profile for .harness.toml.
 *
 * SAFETY: If the discovered path points inside the harness installation directory,
 * it is rejected to prevent accidentally treating the source repo as a user project.
 */
export function discoverProject(startDir?: string): ProjectDiscovery {
  const resolvedStart = path.resolve(startDir ?? process.cwd());
  const installRoot = getInstallRoot();

  const result: ProjectDiscovery = {
    projectRoot: null,
    projectConfigPath: null,
    projectDir: null,
    startDir: resolvedStart,
  };

  // Use existing findProjectConfig() from @harness/profile
  const configPath = findProjectConfig(resolvedStart);
  if (configPath) {
    const configDir = path.dirname(configPath);

    // SAFETY: Reject if this resolves inside the harness installation
    if (isInsideInstallRoot(configDir, installRoot)) {
      return result; // Return empty — don't silently use harness source repo
    }

    result.projectConfigPath = configPath;
    result.projectRoot = configDir;
  }

  // Also check for .harness/ directory (walk upward)
  let currDir = resolvedStart;
  while (true) {
    const harnessDir = path.join(currDir, '.harness');
    if (existsSync(harnessDir)) {
      // SAFETY check
      if (!isInsideInstallRoot(currDir, installRoot)) {
        result.projectDir = harnessDir;
        if (!result.projectRoot) {
          result.projectRoot = currDir;
        }
      }
      break;
    }

    const parent = path.dirname(currDir);
    if (parent === currDir) break;
    currDir = parent;
  }

  return result;
}

/**
 * Check if a path is inside the harness installation root.
 * This prevents accidentally resolving the harness source repo as the user's project.
 */
function isInsideInstallRoot(testPath: string, installRoot: string): boolean {
  const resolved = path.resolve(testPath);
  const resolvedInstall = path.resolve(installRoot);
  return resolved === resolvedInstall || resolved.startsWith(resolvedInstall + path.sep);
}

// ── Project State Paths ─────────────────────────────────────────────────────

/** Get the events directory for a project */
export function getProjectEventsDir(projectRoot: string): string {
  return path.join(projectRoot, '.harness', 'events');
}

/** Get the state directory for a project */
export function getProjectStateDir(projectRoot: string): string {
  return path.join(projectRoot, '.harness', 'state');
}
