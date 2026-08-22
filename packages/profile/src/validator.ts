import { InvalidProfileError } from './errors.js';
import type { ProfileConfig } from './types.js';

export function validateProfileConfig(config: unknown): ProfileConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new InvalidProfileError('Profile config must be an object.');
  }

  const obj = config as Record<string, unknown>;
  const errors: string[] = [];

  if (obj.name !== undefined && typeof obj.name !== 'string') {
    errors.push('name must be a string');
  }

  if (obj.description !== undefined && typeof obj.description !== 'string') {
    errors.push('description must be a string');
  }

  if (obj.model !== undefined && typeof obj.model !== 'string' && typeof obj.model !== 'object') {
    errors.push('model must be a string or object');
  }

  if (obj.systemPrompt !== undefined && typeof obj.systemPrompt !== 'string') {
    errors.push('systemPrompt must be a string');
  }

  if (obj.maxSteps !== undefined) {
    if (typeof obj.maxSteps !== 'number' || !Number.isInteger(obj.maxSteps) || obj.maxSteps <= 0) {
      errors.push('maxSteps must be a positive integer');
    }
  }

  if (obj.temperature !== undefined) {
    if (typeof obj.temperature !== 'number' || obj.temperature < 0 || obj.temperature > 2) {
      errors.push('temperature must be a number between 0.0 and 2.0');
    }
  }

  if (obj.allowedTools !== undefined) {
    if (!Array.isArray(obj.allowedTools) || !obj.allowedTools.every((t) => typeof t === 'string')) {
      errors.push('allowedTools must be an array of strings');
    }
  }

  if (obj.deniedTools !== undefined) {
    if (!Array.isArray(obj.deniedTools) || !obj.deniedTools.every((t) => typeof t === 'string')) {
      errors.push('deniedTools must be an array of strings');
    }
  }

  if (obj.plugins !== undefined) {
    if (!Array.isArray(obj.plugins) || !obj.plugins.every((p) => typeof p === 'string')) {
      errors.push('plugins must be an array of strings');
    }
  }

  if (obj.grantedCapabilities !== undefined) {
    if (
      !Array.isArray(obj.grantedCapabilities) ||
      !obj.grantedCapabilities.every((c) => typeof c === 'string')
    ) {
      errors.push('grantedCapabilities must be an array of strings');
    }
  }

  if (obj.env !== undefined) {
    if (typeof obj.env !== 'object' || obj.env === null || Array.isArray(obj.env)) {
      errors.push('env must be an object of key-value string pairs');
    } else {
      for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          errors.push(`env key "${k}" must have a string value`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new InvalidProfileError(`Invalid profile configuration: ${errors.join(', ')}`, errors);
  }

  return obj as ProfileConfig;
}
