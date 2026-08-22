import { AnthropicModel } from './anthropic.js';
import { OllamaModel } from './ollama.js';
import { ModelOptions, Model } from './types.js';
import { ModelError } from './errors.js';

export function createModel(config: ModelOptions & { provider?: string }): Model {
  if (process.env.HARNESS_MODEL) {
    config.provider = process.env.HARNESS_MODEL;
  }
  if (process.env.HARNESS_MODEL_NAME) {
    config.model = process.env.HARNESS_MODEL_NAME;
  }
  
  const provider = config.provider || 'anthropic';
  
  switch (provider.toLowerCase()) {
    case 'anthropic':
      return new AnthropicModel(config);
    case 'ollama':
      return new OllamaModel(config);
    default:
      throw new ModelError(`Unknown model provider: ${provider}`, { kind: 'provider', provider });
  }
}
