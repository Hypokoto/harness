/**
 * Phase 8 — Permission System Tests
 *
 * Tests 1–27 per the Phase 8 specification.
 * Covers: capability model, policy enforcement, events, security boundaries,
 * profile integration, determinism, and regression for Phases 4–7.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EventBus } from '@harness/events';
import { ProfileResolver } from '@harness/profile';
import {
  DefaultDenyPolicy,
  PermissionDeniedError,
  StaticCapabilityPolicy,
  buildPolicyFromProfile,
  capabilityEquals,
  parseCapability,
  type Capability,
  type PermissionPolicy,
} from './index.js';



// ═══════════════════════════════════════════════════════════════════════════════
// Test Fixtures — Minimal fake Tool infrastructure
// (permissions package must not import from @harness/tools — avoids circularity;
//  we replicate the minimal interface inline for the security boundary tests)
// ═══════════════════════════════════════════════════════════════════════════════

interface MinimalTool {
  name: string;
  requiredCapabilities?: string[];
  executeCalled: boolean;
  execute(): Promise<string>;
}

function createFakeTool(name: string, requiredCapabilities?: string[]): MinimalTool {
  const tool: MinimalTool = {
    name,
    requiredCapabilities,
    executeCalled: false,
    async execute() {
      tool.executeCalled = true;
      return `${name}:executed`;
    },
  };
  return tool;
}

/**
 * A minimal permission-enforcing executor that mirrors what ToolRegistry does.
 * Used to test the enforcement logic in isolation without importing @harness/tools.
 */
async function permissionEnforce(
  tool: MinimalTool,
  policy: PermissionPolicy,
  grantedCapabilities: ReadonlySet<Capability>
): Promise<string> {
  const required = (tool.requiredCapabilities ?? []).map(parseCapability);
  const decision = policy.check({
    toolName: tool.name,
    requiredCapabilities: required,
    grantedCapabilities,
  });

  if (!decision.allowed) {
    throw new PermissionDeniedError(tool.name, decision.missingCapabilities);
  }

  return tool.execute();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: Capability equality works
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 1: Capability equality works', () => {
  const a = parseCapability('filesystem.read');
  const b = parseCapability('filesystem.read');
  const c = parseCapability('filesystem.write');

  assert.ok(capabilityEquals(a, b), 'Same capability strings must be equal');
  assert.ok(!capabilityEquals(a, c), 'Different capability strings must not be equal');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: Empty required capability list is allowed by default
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 2: Empty required capability list is allowed by default', () => {
  const policy = new DefaultDenyPolicy();
  const decision = policy.check({
    toolName: 'no-cap-tool',
    requiredCapabilities: [],
    grantedCapabilities: new Set(),
  });

  assert.ok(decision.allowed, 'Tool with no required capabilities must be allowed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: Required capability + granted capability → ALLOW
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 3: Required capability + granted capability → ALLOW', () => {
  const cap = parseCapability('filesystem.read');
  const policy = new StaticCapabilityPolicy([cap]);
  const decision = policy.check({
    toolName: 'read-test-file',
    requiredCapabilities: [cap],
    grantedCapabilities: policy.getGranted(),
  });

  assert.ok(decision.allowed, 'Required capability that is granted must be ALLOWED');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4: Required capability + missing grant → DENY
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 4: Required capability + missing grant → DENY', () => {
  const required = parseCapability('filesystem.write');
  const policy = new StaticCapabilityPolicy([]); // no grants
  const decision = policy.check({
    toolName: 'write-test-file',
    requiredCapabilities: [required],
    grantedCapabilities: policy.getGranted(),
  });

  assert.ok(!decision.allowed, 'Ungranted capability must be DENIED');
  if (!decision.allowed) {
    assert.equal(decision.missingCapabilities.length, 1);
    assert.equal(decision.missingCapabilities[0], required);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5: Tool requiring multiple capabilities is allowed only when ALL are granted
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 5: Tool requiring multiple capabilities is allowed only when ALL are granted', () => {
  const capA = parseCapability('filesystem.read');
  const capB = parseCapability('filesystem.write');

  // Only capA granted → DENY
  const partialPolicy = new StaticCapabilityPolicy([capA]);
  const denyDecision = partialPolicy.check({
    toolName: 'rw-tool',
    requiredCapabilities: [capA, capB],
    grantedCapabilities: partialPolicy.getGranted(),
  });
  assert.ok(!denyDecision.allowed, 'Must DENY when only subset of capabilities granted');

  // Both granted → ALLOW
  const fullPolicy = new StaticCapabilityPolicy([capA, capB]);
  const allowDecision = fullPolicy.check({
    toolName: 'rw-tool',
    requiredCapabilities: [capA, capB],
    grantedCapabilities: fullPolicy.getGranted(),
  });
  assert.ok(allowDecision.allowed, 'Must ALLOW when all capabilities are granted');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 6: Multiple missing capabilities are reported
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 6: Multiple missing capabilities are reported', () => {
  const capA = parseCapability('filesystem.read');
  const capB = parseCapability('filesystem.write');
  const capC = parseCapability('network.connect');

  // Only capA granted, B and C missing
  const policy = new StaticCapabilityPolicy([capA]);
  const decision = policy.check({
    toolName: 'multi-cap-tool',
    requiredCapabilities: [capA, capB, capC],
    grantedCapabilities: policy.getGranted(),
  });

  assert.ok(!decision.allowed);
  if (!decision.allowed) {
    assert.equal(decision.missingCapabilities.length, 2);
    assert.ok(
      decision.missingCapabilities.includes(capB),
      'filesystem.write must be in missing list'
    );
    assert.ok(
      decision.missingCapabilities.includes(capC),
      'network.connect must be in missing list'
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 7: Exact capability matching is enforced
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 7: Exact capability matching is enforced', () => {
  // Granting "filesystem" does NOT grant "filesystem.read"
  assert.throws(
    () => parseCapability('filesystem'),
    TypeError,
    'Single-segment identifier must be rejected'
  );

  const fsRead = parseCapability('filesystem.read');
  const policy = new StaticCapabilityPolicy([fsRead]);

  // Try to use a different but similar capability — must fail
  const fsWrite = parseCapability('filesystem.write');
  const decision = policy.check({
    toolName: 'write-test-file',
    requiredCapabilities: [fsWrite],
    grantedCapabilities: policy.getGranted(),
  });
  assert.ok(!decision.allowed, 'filesystem.read must not satisfy filesystem.write requirement');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 8: filesystem.read does NOT imply filesystem.write
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 8: filesystem.read does NOT imply filesystem.write', () => {
  const read = parseCapability('filesystem.read');
  const write = parseCapability('filesystem.write');

  const policy = new StaticCapabilityPolicy([read]);

  const decision = policy.check({
    toolName: 'write-test-file',
    requiredCapabilities: [write],
    grantedCapabilities: policy.getGranted(),
  });

  assert.ok(!decision.allowed, 'filesystem.read must not grant filesystem.write');
  if (!decision.allowed) {
    assert.ok(decision.missingCapabilities.includes(write));
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 9: Tool discovery does NOT grant permission
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 9: Tool discovery does NOT grant permission', async () => {
  const tool = createFakeTool('write-test-file', ['filesystem.write']);
  const policy = new StaticCapabilityPolicy([]); // no grants
  const granted = policy.getGranted();

  // Discovering/checking tool metadata does not change policy
  const _ = tool.name; // "discover" the tool
  const __ = tool.requiredCapabilities; // inspect capabilities

  // Execution must still be denied
  await assert.rejects(
    () => permissionEnforce(tool, policy, granted),
    (err: unknown) => {
      assert.ok(err instanceof PermissionDeniedError);
      return true;
    }
  );

  assert.ok(!tool.executeCalled, 'tool.execute() must NOT be called on denied tool');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 10: Model/tool request does NOT grant permission
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 10: Model/tool request does NOT grant permission', async () => {
  const tool = createFakeTool('write-test-file', ['filesystem.write']);
  const policy = new StaticCapabilityPolicy([]); // no grants

  // Simulating what a model might "request" — the tool name and input
  const _modelRequest = { tool: 'write-test-file', input: { path: '/tmp/out.txt' } };

  // The model request alone does not change the policy or grant anything
  const granted = policy.getGranted();

  await assert.rejects(
    () => permissionEnforce(tool, policy, granted),
    (err: unknown) => {
      assert.ok(err instanceof PermissionDeniedError);
      return true;
    }
  );

  assert.ok(!tool.executeCalled, 'tool.execute() must NOT be called based on model request alone');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 11: Denied execution does NOT call Tool.execute()
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 11: Denied execution does NOT call Tool.execute()', async () => {
  const tool = createFakeTool('write-test-file', ['filesystem.write']);
  const policy = new StaticCapabilityPolicy([]); // no grants

  await assert.rejects(
    () => permissionEnforce(tool, policy, policy.getGranted()),
    (err: unknown) => err instanceof PermissionDeniedError
  );

  assert.ok(!tool.executeCalled, 'execute() must never be called on a denied tool');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 12: Allowed execution DOES call Tool.execute()
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 12: Allowed execution DOES call Tool.execute()', async () => {
  const tool = createFakeTool('read-test-file', ['filesystem.read']);
  const policy = new StaticCapabilityPolicy(['filesystem.read']);

  const result = await permissionEnforce(tool, policy, policy.getGranted());

  assert.ok(tool.executeCalled, 'execute() must be called for an authorized tool');
  assert.equal(result, 'read-test-file:executed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 13: Default policy denies capability-requiring tools
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 13: Default policy denies capability-requiring tools', async () => {
  const tool = createFakeTool('network-test', ['network.connect']);
  const policy = new DefaultDenyPolicy();

  await assert.rejects(
    () => permissionEnforce(tool, policy, new Set()),
    (err: unknown) => {
      assert.ok(err instanceof PermissionDeniedError);
      return true;
    }
  );

  assert.ok(!tool.executeCalled);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 14: Profile grants are correctly converted into PermissionPolicy
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 14: Profile grants are correctly converted into PermissionPolicy', () => {
  const profileConfig = {
    name: 'coding',
    grantedCapabilities: ['filesystem.read', 'network.connect'],
  };

  const policy = buildPolicyFromProfile(profileConfig);
  assert.ok(policy instanceof StaticCapabilityPolicy, 'Must return StaticCapabilityPolicy');

  const fsRead = parseCapability('filesystem.read');
  const netConnect = parseCapability('network.connect');
  const fsWrite = parseCapability('filesystem.write');

  const allowed = policy.check({
    toolName: 'read-test-file',
    requiredCapabilities: [fsRead],
    grantedCapabilities: (policy as StaticCapabilityPolicy).getGranted(),
  });
  assert.ok(allowed.allowed);

  const denied = policy.check({
    toolName: 'write-test-file',
    requiredCapabilities: [fsWrite],
    grantedCapabilities: (policy as StaticCapabilityPolicy).getGranted(),
  });
  assert.ok(!denied.allowed);

  // network.connect was granted
  const netAllowed = policy.check({
    toolName: 'network-test',
    requiredCapabilities: [netConnect],
    grantedCapabilities: (policy as StaticCapabilityPolicy).getGranted(),
  });
  assert.ok(netAllowed.allowed);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 15: Project configuration follows Phase 6 precedence
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 15: Project configuration follows Phase 6 precedence', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-perm-test-'));
  try {
    const globalConfigPath = join(tmpDir, 'config.toml');
    writeFileSync(
      globalConfigPath,
      `model = "global-model"\ngrantedCapabilities = ["filesystem.read"]\n`
    );

    const profileDir = join(tmpDir, 'profiles');
    mkdirSync(profileDir);
    writeFileSync(
      join(profileDir, 'coding.toml'),
      `grantedCapabilities = ["filesystem.read", "filesystem.write"]\n`
    );

    const projectDir = join(tmpDir, 'project');
    mkdirSync(projectDir);
    writeFileSync(
      join(projectDir, '.harness.toml'),
      `grantedCapabilities = ["filesystem.read", "network.connect"]\n`
    );

    const resolver = new ProfileResolver();
    const resolved = resolver.resolve({
      globalConfigPath,
      profileDir,
      profileName: 'coding',
      projectDir,
    });

    // Project config (Layer 4) must override profile (Layer 3) — array replacement rule
    assert.deepEqual(
      resolved.config.grantedCapabilities,
      ['filesystem.read', 'network.connect'],
      'Project config must override profile config for grantedCapabilities'
    );

    // Build policy from resolved config
    const policy = buildPolicyFromProfile(resolved.config);
    assert.ok(policy instanceof StaticCapabilityPolicy);

    const netCap = parseCapability('network.connect');
    const fwCap = parseCapability('filesystem.write');

    // network.connect from project layer is granted
    const netDecision = policy.check({
      toolName: 'net-tool',
      requiredCapabilities: [netCap],
      grantedCapabilities: (policy as StaticCapabilityPolicy).getGranted(),
    });
    assert.ok(netDecision.allowed, 'network.connect must be granted from project layer');

    // filesystem.write from profile layer must NOT bleed through
    const fwDecision = policy.check({
      toolName: 'write-tool',
      requiredCapabilities: [fwCap],
      grantedCapabilities: (policy as StaticCapabilityPolicy).getGranted(),
    });
    assert.ok(!fwDecision.allowed, 'filesystem.write must NOT bleed from profile to project');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 16: Permission decisions are deterministic
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 16: Permission decisions are deterministic', () => {
  const fsRead = parseCapability('filesystem.read');
  const policy = new StaticCapabilityPolicy(['filesystem.read']);

  const request = {
    toolName: 'read-test-file',
    requiredCapabilities: [fsRead] as Capability[],
    grantedCapabilities: policy.getGranted(),
  };

  // Call 100 times — result must always be the same
  for (let i = 0; i < 100; i++) {
    const decision = policy.check(request);
    assert.ok(decision.allowed, `Decision must be ALLOW on iteration ${i}`);
  }

  const denyPolicy = new StaticCapabilityPolicy([]);
  const denyRequest = { ...request, grantedCapabilities: denyPolicy.getGranted() };

  for (let i = 0; i < 100; i++) {
    const decision = denyPolicy.check(denyRequest);
    assert.ok(!decision.allowed, `Decision must be DENY on iteration ${i}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 17: permission.allowed event is emitted
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 17: permission.allowed event is emitted', async () => {
  // Import ToolRegistry here — tests the real enforcement path
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');
  const bus = new EventBus();

  const emittedEvents: Array<{ type: string; payload: unknown }> = [];
  bus.onAny((e) => {
    emittedEvents.push({ type: e.type, payload: e.payload });
  });

  const policy = new StaticCapabilityPolicy(['filesystem.read']);
  const registry = new ToolRegistry({ policy, eventBus: bus });

  registry.register({
    name: 'read-test-file',
    description: 'Test read tool',
    requiredCapabilities: ['filesystem.read'],
    async execute() {
      return 'file-content';
    },
  });

  await registry.execute('read-test-file', {});

  const allowedEvent = emittedEvents.find((e) => e.type === 'permission.allowed');
  assert.ok(allowedEvent, 'permission.allowed event must be emitted');

  const payload = allowedEvent!.payload as Record<string, unknown>;
  assert.equal(payload.toolName, 'read-test-file');
  assert.ok(payload.allowed);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 18: permission.denied event is emitted
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 18: permission.denied event is emitted', async () => {
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');
  const bus = new EventBus();

  const emittedEvents: Array<{ type: string; payload: unknown }> = [];
  bus.onAny((e) => {
    emittedEvents.push({ type: e.type, payload: e.payload });
  });

  const policy = new StaticCapabilityPolicy([]); // no grants
  const registry = new ToolRegistry({ policy, eventBus: bus });

  registry.register({
    name: 'write-test-file',
    description: 'Test write tool',
    requiredCapabilities: ['filesystem.write'],
    async execute() {
      return 'written';
    },
  });

  await assert.rejects(
    () => registry.execute('write-test-file', {}),
    (err: unknown) => err instanceof PermissionDeniedError
  );

  const deniedEvent = emittedEvents.find((e) => e.type === 'permission.denied');
  assert.ok(deniedEvent, 'permission.denied event must be emitted');

  const payload = deniedEvent!.payload as Record<string, unknown>;
  assert.equal(payload.toolName, 'write-test-file');
  assert.ok(!payload.allowed);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 19: Denied event identifies missing capabilities
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 19: Denied event identifies missing capabilities', async () => {
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');
  const bus = new EventBus();

  const deniedPayloads: unknown[] = [];
  bus.on('permission.denied', (e) => {
    deniedPayloads.push(e.payload);
  });

  const policy = new StaticCapabilityPolicy(['filesystem.read']); // only read granted
  const registry = new ToolRegistry({ policy, eventBus: bus });

  registry.register({
    name: 'multi-cap-tool',
    description: 'Needs read + write + network',
    requiredCapabilities: ['filesystem.read', 'filesystem.write', 'network.connect'],
    async execute() {
      return 'done';
    },
  });

  await assert.rejects(() => registry.execute('multi-cap-tool', {}));

  assert.equal(deniedPayloads.length, 1);
  const payload = deniedPayloads[0] as Record<string, unknown>;
  const missing = payload.missingCapabilities as string[];

  assert.ok(Array.isArray(missing));
  assert.ok(missing.includes('filesystem.write'), 'filesystem.write must be in missing list');
  assert.ok(missing.includes('network.connect'), 'network.connect must be in missing list');
  assert.ok(!missing.includes('filesystem.read'), 'filesystem.read must NOT be missing (it is granted)');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 20: Permission events do not leak secrets
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 20: Permission events do not leak secrets', async () => {
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');
  const bus = new EventBus();

  const allPayloads: unknown[] = [];
  bus.onAny((e) => {
    if (e.type.startsWith('permission.')) {
      allPayloads.push(e.payload);
    }
  });

  const policy = new StaticCapabilityPolicy(['filesystem.read']);
  const registry = new ToolRegistry({ policy, eventBus: bus });

  const secretInput = { filePath: '/etc/passwd', apiKey: 'sk-secret-12345' };
  registry.register({
    name: 'read-test-file',
    description: 'Test read tool',
    requiredCapabilities: ['filesystem.read'],
    async execute(_input: unknown) {
      return 'content';
    },
  });

  await registry.execute('read-test-file', secretInput);

  // The allowed event payload must NOT contain the tool's raw input
  for (const payload of allPayloads) {
    const p = payload as Record<string, unknown>;
    const payloadStr = JSON.stringify(p);
    assert.ok(
      !payloadStr.includes('sk-secret-12345'),
      'Permission event must not contain raw tool input secrets'
    );
    assert.ok(
      !payloadStr.includes('/etc/passwd'),
      'Permission event must not contain raw tool input paths'
    );
    // Allowed payload shape: toolName, allowed, requiredCapabilities, missingCapabilities
    assert.ok('toolName' in p, 'Must have toolName');
    assert.ok('allowed' in p, 'Must have allowed');
    assert.ok('requiredCapabilities' in p, 'Must have requiredCapabilities');
    assert.ok('missingCapabilities' in p, 'Must have missingCapabilities');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 21: AgentLoop cannot execute an unauthorized tool
// (Security: even through the agent loop path, policy is enforced)
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 21: AgentLoop cannot execute an unauthorized tool', async () => {
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');
  // @ts-ignore
  const { AgentLoop, FakeModel, Session } = await import('@harness/agent');

  let toolExecuted = false;

  const restrictedTool = {
    name: 'write-test-file',
    description: 'Restricted tool requiring filesystem.write',
    requiredCapabilities: ['filesystem.write'] as string[],
    async execute() {
      toolExecuted = true;
      return 'written';
    },
  };

  // Registry with DefaultDenyPolicy (no capability grants)
  const policy = new DefaultDenyPolicy();
  const registry = new ToolRegistry({ policy });
  registry.register(restrictedTool);

  // FakeModel that immediately requests the restricted tool
  const fakeModel = new FakeModel({
    responses: [
      [
        {
          type: 'tool_use',
          id: 'call_security_test',
          name: 'write-test-file',
          input: { data: 'attack payload' },
        },
      ],
      'Done', // second response after tool result
    ],
  });

  const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Write to filesystem' });

  // AgentLoop runs but the tool should be denied — error is captured in tool result
  const result = await loop.run(session);
  assert.ok(result.completed);

  // tool.execute() must never have been called
  assert.ok(!toolExecuted, 'tool.execute() must NOT be called through AgentLoop without permission');

  // The tool result message must contain the permission denied error text
  const messages = session.getMessages();
  const toolResultMsg = messages.find(
    (m) => m.role === 'user' && Array.isArray(m.content)
  );
  assert.ok(toolResultMsg, 'Tool result message must be present');
  const blocks = toolResultMsg!.content as Array<{ isError?: boolean; content?: string }>;
  const errBlock = blocks.find((b) => b.isError);
  assert.ok(errBlock, 'Tool result must be an error block');
  assert.ok(
    errBlock.content?.includes('Permission denied') || errBlock.content?.includes('permission'),
    'Error must reference permission denial'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 22: ToolRegistry cannot bypass permission enforcement
// (Security: direct registry.execute() call also enforces policy)
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 22: ToolRegistry cannot bypass permission enforcement', async () => {
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');

  let executeCallCount = 0;

  const restrictedTool = {
    name: 'write-test-file',
    description: 'Restricted filesystem.write tool',
    requiredCapabilities: ['filesystem.write'] as string[],
    async execute() {
      executeCallCount++;
      return 'should never happen';
    },
  };

  const policy = new StaticCapabilityPolicy([]); // no grants
  const registry = new ToolRegistry({ policy });
  registry.register(restrictedTool);

  // Direct call to registry.execute() must be denied
  await assert.rejects(
    () => registry.execute('write-test-file', {}),
    (err: unknown) => {
      assert.ok(err instanceof PermissionDeniedError, 'Must throw PermissionDeniedError');
      assert.equal(
        (err as PermissionDeniedError).toolName,
        'write-test-file',
        'Error must identify the tool'
      );
      assert.ok(
        (err as PermissionDeniedError).missingCapabilities.includes(
          parseCapability('filesystem.write')
        ),
        'Error must identify missing capability'
      );
      return true;
    }
  );

  assert.equal(executeCallCount, 0, 'tool.execute() must NEVER be called by the registry without permission');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 23: A tool with zero required capabilities remains executable
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 23: A tool with zero required capabilities remains executable', async () => {
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');

  const noCap = {
    name: 'no-cap-tool',
    description: 'No capabilities required',
    // No requiredCapabilities field at all
    async execute() {
      return 'executed';
    },
  };

  // Even with DefaultDenyPolicy, zero-cap tools must be allowed
  const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
  registry.register(noCap);

  const result = await registry.execute('no-cap-tool', {});
  assert.equal(result, 'executed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 24: Existing Phase 4 tool tests still pass (regression check)
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 24: Existing Phase 4 tool tests still pass (regression check)', async () => {
  // @ts-ignore
  const { ToolRegistry, DuplicateToolError, UnknownToolError, InvalidInputError } = await import('@harness/tools');

  // Empty registry
  const registry = new ToolRegistry();
  assert.equal(registry.list().length, 0);

  // Register echo tool (no capabilities)
  const echoTool = {
    name: 'echo',
    description: 'Echo tool',
    async execute(input: { value: string }) {
      return { value: input.value };
    },
  };
  registry.register(echoTool);
  assert.ok(registry.has('echo'));

  // Execute (no capabilities = allowed by DefaultDenyPolicy)
  const result = await registry.execute('echo', { value: 'hello' });
  assert.deepEqual(result, { value: 'hello' });

  // Duplicate registration throws
  assert.throws(() => registry.register(echoTool), DuplicateToolError);

  // Unknown tool throws
  assert.throws(() => registry.get('nonexistent'), UnknownToolError);

  // list() returns metadata
  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'echo');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 25: Existing Phase 5 agent tests still pass (regression)
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 25: Existing Phase 5 agent tests still pass (regression)', async () => {
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');
  // @ts-ignore
  const { AgentLoop, FakeModel, Session } = await import('@harness/agent');

  const registry = new ToolRegistry(); // DefaultDenyPolicy
  registry.register({
    name: 'echo',
    description: 'Returns text',
    // No requiredCapabilities — will be allowed by DefaultDenyPolicy
    async execute(input: { text: string }) {
      return { text: input.text };
    },
  });

  const fakeModel = new FakeModel({
    responses: [
      [{ type: 'tool_use', id: 'call_1', name: 'echo', input: { text: 'Hello Phase 5!' } }],
      'Tool ran successfully.',
    ],
  });

  const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Run echo' });

  const result = await loop.run(session);
  assert.ok(result.completed);
  assert.equal(result.steps, 2);
  assert.equal(result.finalResponse?.text, 'Tool ran successfully.');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 26: Existing Phase 6 profile tests still pass (regression)
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 26: Existing Phase 6 profile tests still pass (regression)', () => {
  const resolver = new ProfileResolver();
  const resolved = resolver.resolve();

  // Default profile still returns sane values
  assert.equal(resolved.name, 'default');
  assert.ok(resolved.config.model);
  assert.ok(resolved.config.maxSteps && resolved.config.maxSteps > 0);

  // grantedCapabilities defaults to empty
  assert.deepEqual(resolved.config.grantedCapabilities, []);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 27: Existing Phase 7 context tests still pass (regression)
// ═══════════════════════════════════════════════════════════════════════════════
test('TEST 27: Existing Phase 7 context tests still pass (regression)', async () => {
  // @ts-ignore
  const { ContextComposer } = await import('@harness/context');

  const tool = {
    name: 'search',
    description: 'Searches documents',
    // No required capabilities — context discovery ≠ execution authority
    async execute() {
      return [];
    },
  };

  const composer = new ContextComposer({ tools: [tool] });
  const ctx = await composer.compose();

  // The tool appears in context — context discovery does NOT grant permissions
  assert.ok(ctx.activeTools.some((t) => t.name === 'search'));

  // Verifying context visibility ≠ execution authority
  const policy = new DefaultDenyPolicy();
  const searchCap = 'search.execute';

  // Even if tool is in context, trying to add a capability requirement and checking
  // with DefaultDenyPolicy must deny
  const restrictedTool = { ...tool, name: 'restricted-search', requiredCapabilities: [searchCap] };
  const composerWithRestricted = new ContextComposer({ tools: [restrictedTool] });
  const ctx2 = await composerWithRestricted.compose();

  // Tool is discoverable
  assert.ok(ctx2.activeTools.some((t) => t.name === 'restricted-search'));

  // But DefaultDenyPolicy still denies it
  const decision = policy.check({
    toolName: 'restricted-search',
    requiredCapabilities: [parseCapability(searchCap)],
    grantedCapabilities: new Set(),
  });
  assert.ok(!decision.allowed, 'Context visibility must NOT grant execution authority');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY NEGATIVE TESTS (8.27)
// ═══════════════════════════════════════════════════════════════════════════════

test('SECURITY: Restricted tool without grant is DENIED via all paths', async () => {
  // @ts-ignore
  const { ToolRegistry } = await import('@harness/tools');
  let executeCallCount = 0;

  const restrictedTool = {
    name: 'write-test-file',
    description: 'Restricted tool',
    requiredCapabilities: ['filesystem.write'] as string[],
    async execute() {
      executeCallCount++;
      return 'should not happen';
    },
  };

  // Path 1: Direct registry execution
  {
    const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
    registry.register(restrictedTool);
    await assert.rejects(
      () => registry.execute('write-test-file', {}),
      (err: unknown) => err instanceof PermissionDeniedError
    );
    assert.equal(executeCallCount, 0, 'Path 1: Direct registry must be DENIED');
  }

  // Path 2: Through AgentLoop
  {
    // @ts-ignore
    const { AgentLoop, FakeModel, Session } = await import('@harness/agent');
    executeCallCount = 0;

    const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
    registry.register(restrictedTool);

    const fakeModel = new FakeModel({
      responses: [
        [{ type: 'tool_use', id: 'call_x', name: 'write-test-file', input: {} }],
        'Done',
      ],
    });

    const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
    const session = new Session();
    session.addMessage({ role: 'user', content: 'Do restricted thing' });

    await loop.run(session); // Should complete but tool must not have executed
    assert.equal(executeCallCount, 0, 'Path 2: AgentLoop must be DENIED');
  }

  // Path 3: After context discovery
  {
    // @ts-ignore
    const { ContextComposer } = await import('@harness/context');
    executeCallCount = 0;

    const composer = new ContextComposer({ tools: [restrictedTool] });
    const ctx = await composer.compose();
    // Tool is discoverable in context
    assert.ok(ctx.activeTools.some((t) => t.name === 'write-test-file'));

    // But attempting to execute via registry must still be denied
    const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
    registry.register(restrictedTool);

    await assert.rejects(
      () => registry.execute('write-test-file', {}),
      (err: unknown) => err instanceof PermissionDeniedError
    );
    assert.equal(executeCallCount, 0, 'Path 3: Post-context-discovery must still be DENIED');
  }

  // Final assertion: tool.execute() was NEVER called across all paths
  assert.equal(
    executeCallCount,
    0,
    'SECURITY: tool.execute() must NEVER be called on a denied tool through ANY path'
  );
});

test('SECURITY: StaticCapabilityPolicy with empty grants denies all capability-requiring tools', () => {
  const policy = new StaticCapabilityPolicy([]);

  const caps: string[] = [
    'filesystem.read',
    'filesystem.write',
    'network.connect',
    'process.execute',
  ];

  for (const cap of caps) {
    const parsed = parseCapability(cap);
    const decision = policy.check({
      toolName: `tool-needing-${cap}`,
      requiredCapabilities: [parsed],
      grantedCapabilities: policy.getGranted(),
    });
    assert.ok(!decision.allowed, `${cap} must be DENIED with no grants`);
  }
});

test('SECURITY: PermissionDeniedError is distinguishable from ToolExecutionError', async () => {
  // @ts-ignore
  const { ToolRegistry, ToolExecutionError } = await import('@harness/tools');

  // A tool that throws ToolExecutionError internally
  const buggyTool = {
    name: 'buggy-tool',
    description: 'Bugs',
    async execute(): Promise<string> {
      throw new Error('Internal bug');
    },
  };

  const registry = new ToolRegistry(); // DefaultDenyPolicy, no caps needed
  registry.register(buggyTool);

  const restrictedTool = {
    name: 'restricted-tool',
    description: 'Restricted',
    requiredCapabilities: ['network.connect'] as string[],
    async execute(): Promise<string> {
      return 'done';
    },
  };
  registry.register(restrictedTool);

  // Permission error
  let caught: unknown;
  try {
    await registry.execute('restricted-tool', {});
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof PermissionDeniedError, 'Must be PermissionDeniedError');
  assert.ok(!(caught instanceof ToolExecutionError), 'Must NOT be ToolExecutionError');

  // Execution error
  let executionCaught: unknown;
  try {
    await registry.execute('buggy-tool', {});
  } catch (e) {
    executionCaught = e;
  }
  assert.ok(executionCaught instanceof ToolExecutionError, 'Must be ToolExecutionError');
  assert.ok(!(executionCaught instanceof PermissionDeniedError), 'Must NOT be PermissionDeniedError');
});
