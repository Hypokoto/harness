import type { Tool, ToolContext } from '@harness/tools';
import type { ToolIndexEntry } from './types.js';

export interface ToolIndexOptions {
  tools?: Tool[];
  searchLimit?: number;
}

export class ToolIndex {
  private readonly entries: Map<string, ToolIndexEntry> = new Map();
  private readonly toolMap: Map<string, Tool> = new Map();
  private readonly searchLimit: number;

  constructor(options: ToolIndexOptions = {}) {
    this.searchLimit = options.searchLimit ?? 10;
    if (options.tools) {
      for (const tool of options.tools) {
        this.addTool(tool);
      }
    }
  }

  public addTool(tool: Tool): void {
    if (this.toolMap.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    
    if (tool.inputSchema !== undefined && (typeof tool.inputSchema !== 'object' || tool.inputSchema === null)) {
      throw new Error(`Invalid inputSchema for tool ${tool.name}`);
    }

    this.toolMap.set(tool.name, tool);
    this.entries.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    });
  }

  public removeTool(name: string): void {
    this.toolMap.delete(name);
    this.entries.delete(name);
  }

  public getTool(name: string): Tool | undefined {
    return this.toolMap.get(name);
  }

  public getEntry(name: string): ToolIndexEntry | undefined {
    return this.entries.get(name);
  }

  public getAllEntries(): ToolIndexEntry[] {
    return Array.from(this.entries.values());
  }

  public getAllTools(): Tool[] {
    return Array.from(this.toolMap.values());
  }

  public search(query: string, limit?: number): ToolIndexEntry[] {
    const max = limit ?? this.searchLimit;
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) {
      return this.getAllEntries().slice(0, max);
    }

    const terms = lowerQuery.split(/\s+/);
    const scored: Array<{ entry: ToolIndexEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      let score = 0;
      const lowerName = entry.name.toLowerCase();
      const lowerDesc = entry.description.toLowerCase();

      for (const term of terms) {
        if (lowerName === term) {
          score += 10;
        } else if (lowerName.includes(term)) {
          score += 5;
        }

        if (lowerDesc.includes(term)) {
          score += 2;
        }
      }

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map((s) => s.entry);
  }

  /**
   * Creates a synthetic tool that allows searching and lazy-activating tools from the index.
   */
  public createSearchTool(
    onActivateTools?: (toolNames: string[]) => void,
    searchToolName = 'search_tools'
  ): Tool<Record<string, unknown>, { content: string }> {
    return {
      name: searchToolName,
      description:
        'Search available tools in the index by keyword or name. Returns tool definitions and activates them for usage.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword or query to search tools by name/description.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of tools to return.',
          },
          activate: {
            type: 'boolean',
            description: 'Whether to automatically activate the matching tools into active context tools (default: true).',
          },
        },
        required: ['query'],
      },
      execute: async (params: Record<string, unknown>, _context?: ToolContext): Promise<{ content: string }> => {
        const query = String(params.query ?? '');
        const limit = typeof params.limit === 'number' ? params.limit : this.searchLimit;
        const activate = params.activate !== false;

        const results = this.search(query, limit);

        if (activate && onActivateTools && results.length > 0) {
          onActivateTools(results.map((r) => r.name));
        }

        return {
          content: JSON.stringify(
            {
              found: results.length,
              tools: results,
            },
            null,
            2
          ),
        };
      },
    };
  }
}
