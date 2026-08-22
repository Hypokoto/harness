import type { ResolvedProfile, ProfileConfig } from '@harness/profile';
import type { ContextProvider } from '../types.js';

export class ProfileContextProvider implements ContextProvider {
  public readonly name: string;
  public readonly profile: ProfileConfig;
  public readonly profileName: string;

  constructor(profileInput: ResolvedProfile | ProfileConfig, nameOverride?: string) {
    if ('config' in profileInput && 'name' in profileInput) {
      this.profile = profileInput.config;
      this.profileName = profileInput.name;
    } else {
      this.profile = profileInput as ProfileConfig;
      this.profileName = (profileInput as ProfileConfig).name ?? nameOverride ?? 'profile';
    }
    this.name = `profile:${this.profileName}`;
  }

  public getSystemPrompt(): string | undefined {
    const parts: string[] = [];
    if (this.profile.systemPrompt) {
      parts.push(this.profile.systemPrompt);
    }
    if (this.profile.env && Object.keys(this.profile.env).length > 0) {
      const envStr = Object.entries(this.profile.env)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      parts.push(`[Environment: ${envStr}]`);
    }
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  public getMetadata(): Record<string, unknown> {
    return {
      profileName: this.profileName,
      model: this.profile.model,
      maxSteps: this.profile.maxSteps,
      temperature: this.profile.temperature,
      allowedTools: this.profile.allowedTools,
      deniedTools: this.profile.deniedTools,
      env: this.profile.env,
      settings: this.profile.settings,
    };
  }
}
