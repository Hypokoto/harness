import type { Message } from '@harness/model';
import type { Tool } from '@harness/tools';
import { ContextCompositionError, ContextProviderError } from './errors.js';
import { ToolIndex } from './tool-index.js';
import type {
  ComposedContext,
  ContextComposerOptions,
  ContextProvider,
  LazyToolConfig,
} from './types.js';

export class ContextComposer {
  private readonly providers: ContextProvider[] = [];
  private readonly staticTools: Tool[] = [];
  private lazyConfig: LazyToolConfig;
  private allowedTools?: Set<string>;
  private deniedTools?: Set<string>;
  private activeToolNames: Set<string> = new Set();

  constructor(options: ContextComposerOptions = {}) {
    if (options.providers) {
      this.providers.push(...options.providers);
    }
    if (options.tools) {
      this.staticTools.push(...options.tools);
    }
    this.lazyConfig = options.lazyTools ?? { enabled: false };

    if (options.allowedTools) {
      this.allowedTools = new Set(options.allowedTools);
    }
    if (options.deniedTools) {
      this.deniedTools = new Set(options.deniedTools);
    }

    if (this.lazyConfig.eagerTools) {
      for (const name of this.lazyConfig.eagerTools) {
        this.activeToolNames.add(name);
      }
    }
  }

  public addProvider(provider: ContextProvider): this {
    this.providers.push(provider);
    return this;
  }

  public addTool(tool: Tool): this {
    this.staticTools.push(tool);
    return this;
  }

  public activateTool(toolName: string): void {
    this.activeToolNames.add(toolName);
  }

  public isToolAllowed(name: string): boolean {
    if (this.deniedTools && this.deniedTools.has(name)) {
      return false;
    }
    if (this.allowedTools && this.allowedTools.size > 0 && !this.allowedTools.has(name)) {
      return false;
    }
    return true;
  }

  public async compose(): Promise<ComposedContext> {
    const systemPrompts: string[] = [];
    const messages: Message[] = [];
    const allToolsMap: Map<string, Tool> = new Map();
    const metadata: Record<string, unknown> = {};

    // Add static tools first
    for (const tool of this.staticTools) {
      if (this.isToolAllowed(tool.name)) {
        allToolsMap.set(tool.name, tool);
      }
    }

    // Aggregate from providers
    for (const provider of this.providers) {
      try {
        if (provider.getSystemPrompt) {
          const sys = await provider.getSystemPrompt();
          if (sys) {
            systemPrompts.push(sys);
          }
        }

        if (provider.getMessages) {
          const msgs = await provider.getMessages();
          if (msgs && msgs.length > 0) {
            messages.push(...msgs);
          }
        }

        if (provider.getTools) {
          const providerTools = await provider.getTools();
          if (providerTools) {
            for (const tool of providerTools) {
              if (this.isToolAllowed(tool.name)) {
                allToolsMap.set(tool.name, tool);
              }
            }
          }
        }

        if (provider.getMetadata) {
          const meta = await provider.getMetadata();
          if (meta) {
            Object.assign(metadata, meta);
          }
        }
      } catch (err) {
        throw new ContextProviderError(
          provider.name,
          err instanceof Error ? err.message : String(err),
          { cause: err }
        );
      }
    }

    const allTools = Array.from(allToolsMap.values());
    const toolIndex = new ToolIndex({
      tools: allTools,
      searchLimit: this.lazyConfig.searchLimit,
    });

    let activeTools: Tool[] = [];
    const isLazy = this.lazyConfig.enabled;

    if (isLazy) {
      const searchToolName = this.lazyConfig.searchToolName ?? 'search_tools';
      const searchTool = toolIndex.createSearchTool((names) => {
        for (const n of names) {
          this.activeToolNames.add(n);
        }
      }, searchToolName);

      // Start with search_tool + eager tools + any explicitly activated tools
      activeTools.push(searchTool);

      for (const tool of allTools) {
        if (this.activeToolNames.has(tool.name)) {
          activeTools.push(tool);
        }
      }
    } else {
      activeTools = allTools;
    }

    const systemPromptCombined = systemPrompts.filter(Boolean).join('\n\n');

    return {
      systemPrompt: systemPromptCombined,
      messages,
      activeTools,
      indexedTools: toolIndex.getAllEntries(),
      metadata,
      isLazy,
    };
  }
}
