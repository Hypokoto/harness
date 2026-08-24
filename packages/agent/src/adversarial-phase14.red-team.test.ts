import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { Session } from './session.js';
import { EventStore } from '../../events/src/event-store.js';
import { ToolRegistry } from '../../tools/src/registry.js';
import { EventBus } from '../../events/src/event-bus.js';
import { StaticCapabilityPolicy } from '../../permissions/src/static-policy.js';

test('Phase 14: Full-System Red Team Fuzzer', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-phase14-'));
  
  // State oracle
  let unauthorizedExecutionCount = 0;
  let staleExecutionCount = 0;
  
  const ITERATIONS = 100; // Attack budget
  const MAX_STEPS = 20;

  for (let i = 0; i < ITERATIONS; i++) {
    const sessionId = `fuzz-session-${i}`;
    let store = new EventStore(tmpDir);
    let session = new Session({ id: sessionId, eventStore: store });
    let bus = new EventBus();
    let registry = new ToolRegistry({ eventBus: bus });
    
    // Random granted capabilities
    const capabilities = ['fs.read', 'db.write', 'admin.shell'];
    const granted = capabilities.filter(() => Math.random() > 0.5);
    registry.setPolicy(new StaticCapabilityPolicy(granted));
    
    // We mock execution to track unauthorized runs
    const createTool = (name: string, required: string[]) => ({
      name,
      description: 'Fuzz tool',
      inputSchema: { type: 'object', properties: {} },
      requiredCapabilities: required,
      execute: async () => {
        // Oracle check at execution time!
        const currentGranted = registry.getGrantedSet();
        const hasAll = required.every(cap => currentGranted.includes(cap as any));
        if (!hasAll) {
          unauthorizedExecutionCount++; // SECURITY VIOLATION!
        }
        return 'success';
      }
    });

    // To test TOCTOU, sometimes we intercept authorization
    bus.onAny(async (event) => {
      if (event.type === 'permission.allowed' && Math.random() > 0.7) {
        // Attack: attempt to swap tool during auth
        const toolName = event.payload.toolName as string;
        if (registry.has(toolName)) {
           try {
             registry.replace(toolName, createTool(toolName, ['admin.shell'])); // escalation attempt
           } catch (e) {
             // replace might throw if identities don't match, etc.
           }
        }
      }
    });

    let pendingExecutions: Promise<any>[] = [];

    // Run random sequences
    for (let step = 0; step < MAX_STEPS; step++) {
      const action = Math.floor(Math.random() * 6);
      
      try {
        switch (action) {
          case 0: // REGISTER
            registry.register(createTool(`tool-${step}`, [capabilities[Math.floor(Math.random() * capabilities.length)]]));
            break;
          case 1: // EXECUTE
            const tools = ['tool-0', 'tool-1', 'tool-2', 'tool-3'];
            const target = tools[Math.floor(Math.random() * tools.length)];
            if (registry.has(target)) {
              pendingExecutions.push(
                registry.execute(target, {}).catch(e => {
                  if (e.message.includes('replaced or unregistered')) {
                    staleExecutionCount++; // System successfully blocked a TOCTOU
                  }
                })
              );
            }
            break;
          case 2: // REVOKE (Change policy)
            registry.setPolicy(new StaticCapabilityPolicy([])); // Revoke all
            break;
          case 3: // REPLACE
            const existing = ['tool-0', 'tool-1', 'tool-2'];
            const toReplace = existing[Math.floor(Math.random() * existing.length)];
            if (registry.has(toReplace)) {
               registry.replace(toReplace, createTool(toReplace, ['admin.shell']));
            }
            break;
          case 4: // UNREGISTER
            const toDel = `tool-${Math.floor(Math.random() * step)}`;
            if (registry.has(toDel)) {
               registry.unregister(toDel);
            }
            break;
          case 5: // CRASH & REPLAY
            // Simulate crash by creating a new session bound to same store
            await Promise.allSettled(pendingExecutions);
            pendingExecutions = [];
            session = await Session.replay(sessionId, store);
            break;
        }
      } catch (err) {
        // Expected to throw on invalid operations (e.g. unknown tool)
      }
    }
    
    await Promise.allSettled(pendingExecutions);
  }

  assert.equal(unauthorizedExecutionCount, 0, 'Zero-trust invariant violated: Unauthorized execution occurred');
});
