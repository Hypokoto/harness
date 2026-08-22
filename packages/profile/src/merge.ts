import type { ProfileConfig } from './types.js';

export function deepMergeProfiles(layers: Partial<ProfileConfig>[]): ProfileConfig {
  const result: ProfileConfig = {};

  for (const layer of layers) {
    if (!layer) continue;

    // Scalars
    if (layer.name !== undefined) result.name = layer.name;
    if (layer.description !== undefined) result.description = layer.description;
    if (layer.model !== undefined) result.model = layer.model;
    if (layer.systemPrompt !== undefined) result.systemPrompt = layer.systemPrompt;
    if (layer.maxSteps !== undefined) result.maxSteps = layer.maxSteps;
    if (layer.temperature !== undefined) result.temperature = layer.temperature;

    // Arrays (replacement rule)
    if (layer.allowedTools !== undefined) {
      result.allowedTools = [...layer.allowedTools];
    }
    if (layer.deniedTools !== undefined) {
      result.deniedTools = [...layer.deniedTools];
    }
    if (layer.plugins !== undefined) {
      result.plugins = [...layer.plugins];
    }

    // Dictionaries (deep merge rule)
    if (layer.env !== undefined) {
      result.env = { ...(result.env ?? {}), ...layer.env };
    }
    if (layer.settings !== undefined) {
      result.settings = deepMergeObjects(result.settings ?? {}, layer.settings);
    }
    if (layer.metadata !== undefined) {
      result.metadata = deepMergeObjects(result.metadata ?? {}, layer.metadata);
    }
  }

  return result;
}

function deepMergeObjects(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const output = { ...target };

  for (const key of Object.keys(source)) {
    const sVal = source[key];
    const tVal = output[key];

    if (
      sVal !== null &&
      typeof sVal === 'object' &&
      !Array.isArray(sVal) &&
      tVal !== null &&
      typeof tVal === 'object' &&
      !Array.isArray(tVal)
    ) {
      output[key] = deepMergeObjects(
        tVal as Record<string, unknown>,
        sVal as Record<string, unknown>
      );
    } else if (Array.isArray(sVal)) {
      output[key] = [...sVal];
    } else if (sVal !== undefined) {
      output[key] = sVal;
    }
  }

  return output;
}
