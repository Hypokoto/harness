import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Tool } from '@harness/tools';
import type { Message } from '@harness/model';
import type { ResolvedProfile } from '@harness/profile';

import {
  ContextComposer,
  ContextProviderError,
  CwdContextProvider,
  DynamicContextProvider,
  ProfileContextProvider,
  StaticContextProvider,
  ToolIndex,
} from './index.js';

describe('Context Engine (Phase 7)', () => {
  describe('StaticContextProvider', () => {
    it('provides fixed system prompt, messages, tools, and metadata', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'a test tool',
        execute: async () => ({ content: 'ok' }),
      };
      const mockMessage: Message = { role: 'user', content: 'hello' };

      const provider = new StaticContextProvider({
        name: 'custom_static',
        systemPrompt: 'You are helpful.',
        messages: [mockMessage],
        tools: [mockTool],
        metadata: { env: 'test' },
      });

      assert.equal(provider.name, 'custom_static');
      assert.equal(await provider.getSystemPrompt(), 'You are helpful.');
      assert.deepEqual(await provider.getMessages(), [mockMessage]);
      assert.equal((await provider.getTools())?.length, 1);
      assert.deepEqual(await provider.getMetadata(), { env: 'test' });
    });
  });

  describe('ProfileContextProvider', () => {
    it('extracts system prompt, env, and metadata from ResolvedProfile', async () => {
      const mockResolvedProfile: ResolvedProfile = {
        name: 'dev-profile',
        sources: { profileConfigPath: '/path/to/profile.toml' },
        config: {
          name: 'dev-profile',
          systemPrompt: 'Be concise.',
          model: 'claude-3-5-sonnet',
          env: { DEBUG: 'true' },
          allowedTools: ['read_file', 'write_file'],
        },
      };

      const provider = new ProfileContextProvider(mockResolvedProfile);

      assert.equal(provider.name, 'profile:dev-profile');
      const prompt = await provider.getSystemPrompt();
      assert.ok(prompt?.includes('Be concise.'));
      assert.ok(prompt?.includes('[Environment: DEBUG=true]'));

      const metadata = (await provider.getMetadata()) as Record<string, unknown>;
      assert.equal(metadata.profileName, 'dev-profile');
      assert.equal(metadata.model, 'claude-3-5-sonnet');
      assert.deepEqual(metadata.allowedTools, ['read_file', 'write_file']);
    });
  });

  describe('CwdContextProvider', () => {
    it('provides absolute working directory prompt and metadata', async () => {
      const provider = new CwdContextProvider({ cwd: '/tmp/my-project' });

      assert.equal(provider.name, 'cwd');
      assert.equal(provider.cwd, '/tmp/my-project');
      assert.equal(await provider.getSystemPrompt(), '[Working Directory: /tmp/my-project]');
      assert.deepEqual(await provider.getMetadata(), { cwd: '/tmp/my-project' });
    });
  });

  describe('DynamicContextProvider', () => {
    it('calls async factories for context data', async () => {
      const provider = new DynamicContextProvider({
        name: 'dynamic_provider',
        getSystemPrompt: async () => 'Dynamic prompt',
        getTools: async () => [
          {
            name: 'dynamic_tool',
            description: 'dynamic tool desc',
            execute: async () => ({ content: 'done' }),
          },
        ],
      });

      assert.equal(provider.name, 'dynamic_provider');
      assert.equal(await provider.getSystemPrompt(), 'Dynamic prompt');
      const tools = await provider.getTools();
      assert.equal(tools?.length, 1);
      assert.equal(tools[0].name, 'dynamic_tool');
    });
  });

  describe('ToolIndex & Lazy Tool Search', () => {
    it('indexes tools and performs keyword scoring', () => {
      const tools: Tool[] = [
        {
          name: 'read_file',
          description: 'Read contents of a file from disk',
          execute: async () => ({ content: '' }),
        },
        {
          name: 'write_file',
          description: 'Write content to a file on disk',
          execute: async () => ({ content: '' }),
        },
        {
          name: 'execute_command',
          description: 'Run shell bash command in terminal',
          execute: async () => ({ content: '' }),
        },
      ];

      const index = new ToolIndex({ tools });
      assert.equal(index.getAllEntries().length, 3);

      const fileResults = index.search('file');
      assert.equal(fileResults.length, 2);
      assert.ok(fileResults.some((t) => t.name === 'read_file'));
      assert.ok(fileResults.some((t) => t.name === 'write_file'));

      const bashResults = index.search('shell bash');
      assert.equal(bashResults.length, 1);
      assert.equal(bashResults[0].name, 'execute_command');
    });

    it('executes synthetic search_tools tool and activates tools', async () => {
      let activated: string[] = [];
      const index = new ToolIndex({
        tools: [
          {
            name: 'git_status',
            description: 'Check git working tree status',
            execute: async () => ({ content: '' }),
          },
        ],
      });

      const searchTool = index.createSearchTool((names) => {
        activated = names;
      });

      assert.equal(searchTool.name, 'search_tools');

      const result = (await searchTool.execute({ query: 'git' }, {})) as { content: string };
      const parsed = JSON.parse(result.content);

      assert.equal(parsed.found, 1);
      assert.equal(parsed.tools[0].name, 'git_status');
      assert.deepEqual(activated, ['git_status']);
    });
  });

  describe('ContextComposer & Tool Bloat Reduction', () => {
    it('composes full context without lazy loading when lazy = false', async () => {
      const staticProvider = new StaticContextProvider({
        systemPrompt: 'System instructions.',
        tools: [
          {
            name: 'tool_a',
            description: 'Tool A',
            execute: async () => ({ content: '' }),
          },
        ],
      });

      const composer = new ContextComposer({
        providers: [staticProvider],
        tools: [
          {
            name: 'tool_b',
            description: 'Tool B',
            execute: async () => ({ content: '' }),
          },
        ],
      });

      const context = await composer.compose();

      assert.equal(context.systemPrompt, 'System instructions.');
      assert.equal(context.activeTools.length, 2);
      assert.equal(context.indexedTools.length, 2);
      assert.equal(context.isLazy, false);
    });

    it('enforces lazy loading to reduce token bloat when lazyTools is enabled', async () => {
      const manyTools: Tool[] = Array.from({ length: 50 }, (_, i) => ({
        name: `mcp_tool_${i}`,
        description: `MCP Tool ${i} description`,
        execute: async () => ({ content: '' }),
      }));

      const eagerTool: Tool = {
        name: 'always_active_tool',
        description: 'Eagerly loaded tool',
        execute: async () => ({ content: '' }),
      };

      const composer = new ContextComposer({
        tools: [...manyTools, eagerTool],
        lazyTools: {
          enabled: true,
          eagerTools: ['always_active_tool'],
        },
      });

      const context = await composer.compose();

      // 51 tools in total
      assert.equal(context.indexedTools.length, 51);
      assert.equal(context.isLazy, true);

      // Active tools should only be search_tools + eager tool = 2 tools
      assert.equal(context.activeTools.length, 2);
      assert.equal(context.activeTools[0].name, 'search_tools');
      assert.equal(context.activeTools[1].name, 'always_active_tool');

      // Now execute search_tools to lazy load mcp_tool_5
      const searchTool = context.activeTools[0];
      await searchTool.execute({ query: 'mcp_tool_5' }, {});

      // Re-compose context to see newly activated tool
      const updatedContext = await composer.compose();
      assert.equal(updatedContext.activeTools.length, 3);
      assert.ok(updatedContext.activeTools.some((t) => t.name === 'mcp_tool_5'));
    });

    it('filters allowed and denied tools correctly', async () => {
      const tools: Tool[] = [
        { name: 'allowed_1', description: '', execute: async () => ({ content: '' }) },
        { name: 'allowed_2', description: '', execute: async () => ({ content: '' }) },
        { name: 'denied_1', description: '', execute: async () => ({ content: '' }) },
      ];

      const composer = new ContextComposer({
        tools,
        allowedTools: ['allowed_1', 'allowed_2'],
        deniedTools: ['denied_1'],
      });

      const context = await composer.compose();
      assert.equal(context.activeTools.length, 2);
      assert.ok(context.activeTools.every((t) => t.name.startsWith('allowed')));
    });

    it('wraps provider failures in ContextProviderError', async () => {
      const failingProvider = new DynamicContextProvider({
        name: 'faulty',
        getSystemPrompt: () => {
          throw new Error('Database connection failed');
        },
      });

      const composer = new ContextComposer({ providers: [failingProvider] });

      await assert.rejects(
        async () => composer.compose(),
        (err: unknown) => {
          assert.ok(err instanceof ContextProviderError);
          assert.equal(err.providerName, 'faulty');
          assert.ok(err.message.includes('Database connection failed'));
          return true;
        }
      );
    });
  });

  describe('Two-Profile Isolation', () => {
    it('ensures distinct profiles generate isolated context without cross-contamination', async () => {
      const devProfile: ResolvedProfile = {
        name: 'dev',
        sources: { profileConfigPath: '/dev/profile.toml' },
        config: {
          name: 'dev',
          systemPrompt: 'Development Environment Mode',
          env: { ROLE: 'developer' },
          allowedTools: ['git_commit', 'run_test'],
        },
      };

      const prodProfile: ResolvedProfile = {
        name: 'prod',
        sources: { profileConfigPath: '/prod/profile.toml' },
        config: {
          name: 'prod',
          systemPrompt: 'Production Guarded Mode',
          env: { ROLE: 'deployer' },
          deniedTools: ['git_commit'],
        },
      };

      const devComposer = new ContextComposer({
        providers: [new ProfileContextProvider(devProfile)],
        allowedTools: devProfile.config.allowedTools,
      });

      const prodComposer = new ContextComposer({
        providers: [new ProfileContextProvider(prodProfile)],
        deniedTools: prodProfile.config.deniedTools,
      });

      const devContext = await devComposer.compose();
      const prodContext = await prodComposer.compose();

      // Check Dev Context
      assert.ok(devContext.systemPrompt.includes('Development Environment Mode'));
      assert.equal(devContext.metadata.profileName, 'dev');
      assert.deepEqual((devContext.metadata.env as Record<string, string>).ROLE, 'developer');

      // Check Prod Context
      assert.ok(prodContext.systemPrompt.includes('Production Guarded Mode'));
      assert.equal(prodContext.metadata.profileName, 'prod');
      assert.deepEqual((prodContext.metadata.env as Record<string, string>).ROLE, 'deployer');

      // Verify no cross contamination
      assert.notEqual(devContext.systemPrompt, prodContext.systemPrompt);
      assert.notDeepEqual(devContext.metadata, prodContext.metadata);
    });
  });
});
