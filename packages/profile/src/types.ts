export interface ProfileConfig {
  name?: string;
  description?: string;
  model?: string;
  systemPrompt?: string;
  maxSteps?: number;
  temperature?: number;
  allowedTools?: string[];
  deniedTools?: string[];
  plugins?: string[];
  env?: Record<string, string>;
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ProfileSourceInfo {
  globalConfigPath?: string;
  profileConfigPath?: string;
  projectConfigPath?: string;
}

export interface ResolvedProfile {
  name: string;
  config: ProfileConfig;
  sources: ProfileSourceInfo;
}

export interface ProfileResolverOptions {
  globalConfigPath?: string;
  profileDir?: string;
  profileName?: string;
  projectDir?: string;
  overrides?: Partial<ProfileConfig>;
}
