import type { ProfileConfig } from './types.js';

export const BUILTIN_DEFAULT_PROFILE: Required<Omit<ProfileConfig, 'description'>> & { description: string } = {
  name: 'default',
  description: 'Built-in default harness profile',
  model: 'anthropic/claude-3-5-sonnet',
  systemPrompt: 'You are a helpful AI assistant running in the Harness agent runtime.',
  maxSteps: 10,
  temperature: 0.7,
  allowedTools: [],
  deniedTools: [],
  plugins: [],
  env: {},
  settings: {},
  metadata: {},
};
