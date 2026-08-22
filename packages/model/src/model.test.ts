import assert from 'node:assert/strict';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import {
  AnthropicModel,
  AuthenticationError,
  InvalidRequestError,
  ModelError,
  NetworkError,
  ProviderError,
  RateLimitError,
  UnknownModelError,
  type ModelRequest,
} from './index.js';

test('1. AnthropicModel - initialization with default and custom model name', () => {
  const defaultModel = new AnthropicModel({ apiKey: 'test-key' });
  assert.equal(defaultModel.provider, 'anthropic');
  assert.equal(defaultModel.defaultModel, 'claude-3-5-sonnet-20241022');

  const customModel = new AnthropicModel({
    model: 'claude-3-haiku-20240307',
    apiKey: 'test-key',
  });
  assert.equal(customModel.defaultModel, 'claude-3-haiku-20240307');
});

test('2. AnthropicModel.complete - request mapping and successful response parsing', async () => {
  let capturedParams: any = null;

  const mockClient = {
    messages: {
      create: async (params: any) => {
        capturedParams = params;
        return {
          id: 'msg_test_123',
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: [
            { type: 'text', text: 'Hello! ' },
            { type: 'text', text: 'How can I help you today?' },
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 15, output_tokens: 8 },
        };
      },
    },
  } as unknown as Anthropic;

  const model = new AnthropicModel({ client: mockClient });

  const request: ModelRequest = {
    model: 'claude-3-5-sonnet-20241022',
    system: 'You are a helpful assistant.',
    messages: [
      { role: 'user', content: 'Hi there' },
    ],
    temperature: 0.7,
    maxTokens: 1000,
    topP: 0.9,
    stopSequences: ['STOP'],
  };

  const response = await model.complete(request);

  // Check captured SDK parameters
  assert.equal(capturedParams.model, 'claude-3-5-sonnet-20241022');
  assert.equal(capturedParams.system, 'You are a helpful assistant.');
  assert.equal(capturedParams.max_tokens, 1000);
  assert.equal(capturedParams.temperature, 0.7);
  assert.equal(capturedParams.top_p, 0.9);
  assert.deepEqual(capturedParams.stop_sequences, ['STOP']);
  assert.deepEqual(capturedParams.messages, [
    { role: 'user', content: 'Hi there' },
  ]);

  // Check mapped response
  assert.equal(response.id, 'msg_test_123');
  assert.equal(response.model, 'claude-3-5-sonnet-20241022');
  assert.equal(response.role, 'assistant');
  assert.equal(response.text, 'Hello! How can I help you today?');
  assert.equal(response.content.length, 2);
  assert.equal(response.stopReason, 'end_turn');
  assert.equal(response.usage.inputTokens, 15);
  assert.equal(response.usage.outputTokens, 8);
  assert.equal(response.usage.totalTokens, 23);
});

test('3. AnthropicModel.complete - handles system messages embedded in messages array', async () => {
  let capturedParams: any = null;

  const mockClient = {
    messages: {
      create: async (params: any) => {
        capturedParams = params;
        return {
          id: 'msg_sys_test',
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: [{ type: 'text', text: 'Acknowledged' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        };
      },
    },
  } as unknown as Anthropic;

  const model = new AnthropicModel({ client: mockClient });

  await model.complete({
    system: 'Initial system instruction.',
    messages: [
      { role: 'system', content: 'Secondary system rule.' },
      { role: 'user', content: 'Test prompt' },
    ],
  });

  assert.equal(capturedParams.system, 'Initial system instruction.\n\nSecondary system rule.');
  assert.deepEqual(capturedParams.messages, [
    { role: 'user', content: 'Test prompt' },
  ]);
});

test('4. AnthropicModel.complete - handles multi-block content (text and image)', async () => {
  let capturedParams: any = null;

  const mockClient = {
    messages: {
      create: async (params: any) => {
        capturedParams = params;
        return {
          id: 'msg_multi_block',
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: [{ type: 'text', text: 'I see an image' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 5 },
        };
      },
    },
  } as unknown as Anthropic;

  const model = new AnthropicModel({ client: mockClient });

  await model.complete({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
        ],
      },
    ],
  });

  assert.deepEqual(capturedParams.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
        },
      ],
    },
  ]);
});

test('5. AnthropicModel.completeStream - streams chunks correctly', async () => {
  const mockClient = {
    messages: {
      stream: (params: any) => {
        async function* generator() {
          yield { type: 'message_start', message: { id: 'stream_msg_1', model: params.model, role: 'assistant' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world!' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } };
          yield { type: 'message_stop' };
        }
        return generator();
      },
    },
  } as unknown as Anthropic;

  const model = new AnthropicModel({ client: mockClient });

  const events: any[] = [];
  for await (const event of model.completeStream({ messages: [{ role: 'user', content: 'Stream test' }] })) {
    events.push(event);
  }

  assert.equal(events.length, 5);
  assert.deepEqual(events[0], {
    type: 'message_start',
    id: 'stream_msg_1',
    model: 'claude-3-5-sonnet-20241022',
    role: 'assistant',
  });
  assert.deepEqual(events[1], { type: 'text_delta', text: 'Hello ' });
  assert.deepEqual(events[2], { type: 'text_delta', text: 'world!' });
  assert.deepEqual(events[3], {
    type: 'message_delta',
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 4, totalTokens: 4 },
  });
  assert.deepEqual(events[4], { type: 'message_stop' });
});

test('6. AnthropicModel - error normalization mappings', () => {
  const model = new AnthropicModel({ apiKey: 'test-key' });

  // 1. AuthenticationError (401 / 403)
  const authErr = model.normalizeError({ status: 401, message: 'Invalid API Key' });
  assert.ok(authErr instanceof AuthenticationError);
  assert.equal(authErr.kind, 'authentication');
  assert.equal(authErr.statusCode, 401);
  assert.equal(authErr.retryable, false);
  assert.equal(authErr.provider, 'anthropic');

  // 2. RateLimitError (429)
  const rateLimitErr = model.normalizeError({ status: 429, message: 'Rate limit exceeded' });
  assert.ok(rateLimitErr instanceof RateLimitError);
  assert.equal(rateLimitErr.kind, 'rate_limit');
  assert.equal(rateLimitErr.statusCode, 429);
  assert.equal(rateLimitErr.retryable, true);

  // 3. InvalidRequestError (400 / 422)
  const invalidErr = model.normalizeError({ status: 400, message: 'Invalid prompt parameters' });
  assert.ok(invalidErr instanceof InvalidRequestError);
  assert.equal(invalidErr.kind, 'invalid_request');
  assert.equal(invalidErr.statusCode, 400);
  assert.equal(invalidErr.retryable, false);

  // 4. ProviderError (500)
  const providerErr = model.normalizeError({ status: 500, message: 'Internal Server Error' });
  assert.ok(providerErr instanceof ProviderError);
  assert.equal(providerErr.kind, 'provider');
  assert.equal(providerErr.statusCode, 500);
  assert.equal(providerErr.retryable, true);

  // 5. NetworkError (APIConnectionError)
  const connErr = new Anthropic.APIConnectionError({ message: 'Connection refused' });
  const networkErr = model.normalizeError(connErr);
  assert.ok(networkErr instanceof NetworkError);
  assert.equal(networkErr.kind, 'network');
  assert.equal(networkErr.retryable, true);

  // 6. UnknownModelError
  const unknownErr = model.normalizeError(new Error('Unexpected exception'));
  assert.ok(unknownErr instanceof UnknownModelError);
  assert.equal(unknownErr.kind, 'unknown');
  assert.equal(unknownErr.retryable, false);

  // Pass through existing ModelError
  const existingErr = new AuthenticationError('Already normalized');
  assert.equal(model.normalizeError(existingErr), existingErr);
});

test('7. AnthropicModel.complete - handles API errors by throwing normalized ModelError', async () => {
  const mockClient = {
    messages: {
      create: async () => {
        throw { status: 429, message: 'Too many requests' };
      },
    },
  } as unknown as Anthropic;

  const model = new AnthropicModel({ client: mockClient });

  await assert.rejects(
    async () => model.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
    (err: any) => {
      assert.ok(err instanceof RateLimitError);
      assert.equal(err.kind, 'rate_limit');
      assert.equal(err.statusCode, 429);
      return true;
    }
  );
});
