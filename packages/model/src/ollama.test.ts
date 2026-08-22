import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OllamaModel } from './ollama.js';
import { ModelError, ProviderError, NetworkError } from './errors.js';

test('OllamaModel - Model unavailable produces ProviderError', async () => {
  const model = new OllamaModel({ baseUrl: 'http://127.0.0.1:54321' }); // Wrong port
  await assert.rejects(
    () => model.complete({ messages: [{ role: 'user', content: 'test' }] }),
    (err: any) => err instanceof ProviderError
  );
});

test('OllamaModel - Timeout works', async () => {
  // Use a delay proxy or just give it 1ms to fail
  const model = new OllamaModel({});
  await assert.rejects(
    () => model.complete({ messages: [{ role: 'user', content: 'test' }], timeoutMs: 1 }),
    (err: any) => err instanceof ModelError && err.message.includes('timeout')
  );
});

test('OllamaModel - Cancellation works', async () => {
  const model = new OllamaModel({});
  const controller = new AbortController();
  const promise = model.complete({ messages: [{ role: 'user', content: 'test' }], signal: controller.signal });
  controller.abort();
  await assert.rejects(
    () => promise,
    (err: any) => err instanceof ModelError && err.message.includes('timeout or cancelled')
  );
});

test('OllamaModel - Malformed response produces structured ModelError', async () => {
  const model = new OllamaModel({ model: 'invalid_model_name' });
  await assert.rejects(
    () => model.complete({ messages: [{ role: 'user', content: 'test' }] }),
    (err: any) => err instanceof ModelError && err.message.includes('Ollama API error')
  );
});

test('OllamaModel - Valid completion works', async () => {
  const model = new OllamaModel({ model: 'qwen2.5:0.5b' });
  try {
    const res = await model.complete({ messages: [{ role: 'user', content: 'Say strictly the word "Hello"' }] });
    assert.ok(res.content.length > 0);
    assert.ok(res.usage);
    assert.ok(res.usage.totalTokens > 0);
  } catch (e: any) {
    if (e instanceof ProviderError || e instanceof NetworkError) {
      console.warn('Ollama unavailable, skipping valid completion test');
      return;
    }
    throw e;
  }
});

test('OllamaModel - Streaming works', async () => {
  const model = new OllamaModel({ model: 'qwen2.5:0.5b' });
  try {
    const chunks: any[] = [];
    for await (const event of model.completeStream({ messages: [{ role: 'user', content: 'Say hello' }] })) {
      chunks.push(event);
    }
    assert.ok(chunks.length > 0, 'Should receive at least one stream event');
    assert.equal(chunks[0].type, 'message_start');
    assert.equal(chunks[chunks.length - 1].type, 'message_stop');
    assert.ok(chunks.some((c) => c.type === 'text_delta'), 'Should contain text deltas');
  } catch (e: any) {
    if (e instanceof ProviderError || e instanceof NetworkError) {
      console.warn('Ollama unavailable, skipping streaming test');
      return;
    }
    throw e;
  }
});
