import { test } from 'node:test';
import * as assert from 'node:assert';
import { ContextComposer, ContextOverflowError } from '../src/context.js';
import type { ModelMessage, ModelRequest } from '@harness/model';

const charsPerToken = 4;
const MB = 1024 * 1024;

test('ATTACK 1 - LARGE HISTORY', async () => {
  const composer = new ContextComposer({ maxTokens: 1000, charsPerToken });
  const req: ModelRequest = {
    messages: [
      { role: 'user', content: 'A'.repeat(500 * charsPerToken) }, // 500 tokens
      { role: 'assistant', content: 'B'.repeat(600 * charsPerToken) }, // 600 tokens
      { role: 'user', content: 'C'.repeat(100 * charsPerToken) }, // 100 tokens
    ]
  };

  const composed = composer.compose(req);
  assert.equal(composed.messages.length, 2, 'Should drop the oldest message');
  assert.equal(composed.messages[0].role, 'assistant');
  assert.equal(composed.messages[1].role, 'user');
});

test('ATTACK 2 - HUGE TOOL RESULT (10MB)', async () => {
  const composer = new ContextComposer({ maxTokens: 1000, charsPerToken });
  const req: ModelRequest = {
    messages: [
      { role: 'user', content: 'Do something' },
      { 
        role: 'assistant', 
        content: [{ type: 'tool_use', id: 'call_1', name: 'read', input: {} }] 
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'call_1', content: 'X'.repeat(10 * MB) }]
      }
    ]
  };

  const composed = composer.compose(req);
  assert.equal(composed.messages.length, 3, 'Must retain all three messages');
  const toolResultMsg = composed.messages[2];
  const toolResultBlock = toolResultMsg.content[0] as any;
  assert.ok(toolResultBlock.content.length < 10 * MB, 'Tool result must be truncated');
  assert.ok(toolResultBlock.content.includes('[TRUNCATED BY CONTEXT LIMIT]'), 'Truncation marker must be present');
});

test('ATTACK 3 - SYSTEM PROMPT PRESERVATION', async () => {
  const composer = new ContextComposer({ maxTokens: 1000, charsPerToken });
  const req: ModelRequest = {
    system: 'SYSTEM'.repeat(100 * charsPerToken), // 100 tokens
    messages: [
      { role: 'user', content: 'USER'.repeat(1500 * charsPerToken) }, // 1500 tokens
    ]
  };

  const composed = composer.compose(req);
  assert.ok(composed.system, 'System prompt must be preserved');
  assert.equal(composed.messages.length, 1);
  assert.ok((composed.messages[0].content as string).length < 1500 * charsPerToken, 'User message must be truncated');
});

test('ATTACK 13 - CONTEXT COMPACTION MUST NOT PERSIST', async () => {
  const originalMessages: ModelMessage[] = [
    { role: 'user', content: 'A' },
    { role: 'assistant', content: 'B' },
    { role: 'user', content: 'C'.repeat(5000) }
  ];
  
  // Clone to simulate Session state
  const sessionHistory = JSON.parse(JSON.stringify(originalMessages));
  
  const composer = new ContextComposer({ maxTokens: 100, charsPerToken });
  const req: ModelRequest = { messages: sessionHistory };
  
  const composed = composer.compose(req);
  
  assert.notDeepEqual(composed.messages, originalMessages, 'Composed context should be modified/trimmed');
  assert.deepEqual(sessionHistory, originalMessages, 'Canonical Session History MUST NOT be mutated');
});

test('ATTACK 14 - TOOL-CALL CONTEXT (Paired Dropping)', async () => {
  const composer = new ContextComposer({ maxTokens: 100, charsPerToken });
  const req: ModelRequest = {
    messages: [
      { role: 'user', content: 'Old message'.repeat(100) },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_1', content: 'Result'.repeat(100) }] },
      { role: 'assistant', content: 'Intermediate thoughts'.repeat(100) },
      { role: 'user', content: 'Current request' }
    ]
  };

  const composed = composer.compose(req);
  // It shouldn't drop the tool_use but keep the tool_result.
  // It should drop both if they don't fit.
  let hasToolUse = false;
  let hasToolResult = false;
  for (const m of composed.messages) {
    if (typeof m.content !== 'string') {
      if (m.content.some(b => b.type === 'tool_use')) hasToolUse = true;
      if (m.content.some(b => b.type === 'tool_result')) hasToolResult = true;
    }
  }
  
  assert.equal(hasToolUse, hasToolResult, 'Tool use and tool result must be dropped together if at all');
});

test('ATTACK 17 - HUGE SYSTEM PROMPT', async () => {
  const composer = new ContextComposer({ maxTokens: 1000, charsPerToken });
  const req: ModelRequest = {
    system: 'SYSTEM'.repeat(2000 * charsPerToken), // 2000 tokens
    messages: []
  };

  assert.throws(() => composer.compose(req), ContextOverflowError, 'Must explicitly fail if system prompt exceeds budget');
});
