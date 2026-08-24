import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectConfig } from './cwd.js';
import { BUILTIN_DEFAULT_PROFILE } from './defaults.js';
import { ProfileNotFoundError } from './errors.js';
import { deepMergeProfiles } from './merge.js';
import { parseTOML } from './toml.js';
import type { ProfileConfig, ProfileResolverOptions, ResolvedProfile } from './types.js';
import { validateProfileConfig } from './validator.js';

export class ProfileResolver {
  public resolve(options: ProfileResolverOptions = {}): ResolvedProfile {
    const layers: Partial<ProfileConfig>[] = [];
    const sources: ResolvedProfile['sources'] = {};

    // Layer 1: Built-in defaults
    layers.push(BUILTIN_DEFAULT_PROFILE);

    // Layer 2: Global configuration
    if (options.globalConfigPath && existsSync(options.globalConfigPath)) {
      const globalConfig = this.loadTOMLFile(options.globalConfigPath);
      layers.push(globalConfig);
      sources.globalConfigPath = options.globalConfigPath;
    }

    // Layer 3: Selected Profile
    const requestedProfile = options.profileName ?? 'default';
    if (options.profileDir && existsSync(options.profileDir)) {
      const profilePath = join(options.profileDir, `${requestedProfile}.toml`);
      if (existsSync(profilePath)) {
        const profileConfig = this.loadTOMLFile(profilePath);
        layers.push(profileConfig);
        sources.profileConfigPath = profilePath;
      } else if (requestedProfile !== 'default') {
        throw new ProfileNotFoundError(requestedProfile, `Profile "${requestedProfile}" not found at ${profilePath}`);
      }
    }

    // Layer 4: Project Configuration (.harness.toml auto-detection)
    const projectConfigPath = findProjectConfig(options.projectDir);
    if (projectConfigPath && existsSync(projectConfigPath)) {
      const projectConfig = this.loadTOMLFile(projectConfigPath);
      layers.push(projectConfig);
      sources.projectConfigPath = projectConfigPath;
    }

    // Layer 5: Explicit CLI Overrides
    if (options.overrides) {
      const validatedOverrides = validateProfileConfig(options.overrides);
      layers.push(validatedOverrides);
    }

    // Deep merge all layers
    const mergedConfig = deepMergeProfiles(layers);
    
    // Explicitly defined name in config wins, otherwise the requested profile name, otherwise 'default'
    const finalName = mergedConfig.name ?? options.profileName ?? 'default';
    mergedConfig.name = finalName;

    return {
      name: finalName,
      config: validateProfileConfig(mergedConfig),
      sources,
    };
  }

  public loadTOMLFile(filePath: string): ProfileConfig {
    const content = readFileSync(filePath, 'utf8');
    const parsed = parseTOML(content);
    return validateProfileConfig(parsed);
  }

  public listProfiles(profileDir: string): string[] {
    if (!existsSync(profileDir)) {
      return [];
    }

    const files = readdirSync(profileDir);
    return files
      .filter((f) => f.endsWith('.toml'))
      .map((f) => f.slice(0, -5));
  }

  public saveProfile(name: string, config: ProfileConfig, profileDir: string): string {
    const targetPath = join(profileDir, `${name}.toml`);
    const lines: string[] = [];

    if (config.name) lines.push(`name = "${config.name}"`);
    if (config.description) lines.push(`description = "${config.description}"`);
    if (config.model) lines.push(`model = "${config.model}"`);
    if (config.systemPrompt) lines.push(`systemPrompt = "${config.systemPrompt}"`);
    if (config.maxSteps !== undefined) lines.push(`maxSteps = ${config.maxSteps}`);
    if (config.temperature !== undefined) lines.push(`temperature = ${config.temperature}`);

    if (config.allowedTools) {
      lines.push(`allowedTools = [${config.allowedTools.map((t) => `"${t}"`).join(', ')}]`);
    }
    if (config.deniedTools) {
      lines.push(`deniedTools = [${config.deniedTools.map((t) => `"${t}"`).join(', ')}]`);
    }
    if (config.plugins) {
      lines.push(`plugins = [${config.plugins.map((p) => `"${p}"`).join(', ')}]`);
    }
    if (config.grantedCapabilities && config.grantedCapabilities.length > 0) {
      lines.push(
        `grantedCapabilities = [${config.grantedCapabilities.map((c) => `"${c}"`).join(', ')}]`
      );
    }

    if (config.env && Object.keys(config.env).length > 0) {
      lines.push('\n[env]');
      for (const [k, v] of Object.entries(config.env)) {
        lines.push(`${k} = "${v}"`);
      }
    }

    if (config.settings && Object.keys(config.settings).length > 0) {
      lines.push('\n[settings]');
      for (const [k, v] of Object.entries(config.settings)) {
        lines.push(`${k} = ${JSON.stringify(v)}`);
      }
    }

    writeFileSync(targetPath, lines.join('\n') + '\n', 'utf8');
    return targetPath;
  }
}
