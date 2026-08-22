import {
  DuplicateToolError,
  InvalidInputError,
  ToolExecutionError,
  UnknownToolError,
} from './errors.js';
import type { Tool, ToolContext, ToolMetadata } from './types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<any, any>>();

  public register(tool: Tool<any, any>): void {
    if (!tool || typeof tool.name !== 'string' || !tool.name.trim()) {
      throw new InvalidInputError('Tool must have a valid non-empty name.');
    }
    if (typeof tool.execute !== 'function') {
      throw new InvalidInputError(`Tool "${tool.name}" must provide an execute method.`);
    }
    if (this.tools.has(tool.name)) {
      throw new DuplicateToolError(tool.name);
    }
    this.tools.set(tool.name, tool);
  }

  public get(name: string): Tool<any, any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new UnknownToolError(name);
    }
    return tool;
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  public list(): ToolMetadata[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  public async execute(
    name: string,
    input: unknown,
    context: ToolContext = {}
  ): Promise<unknown> {
    const tool = this.get(name);

    let validatedInput = input;
    if (typeof tool.validateInput === 'function') {
      try {
        validatedInput = tool.validateInput(input);
      } catch (error) {
        if (error instanceof InvalidInputError) {
          throw error;
        }
        throw new InvalidInputError(
          `Input validation failed for tool "${name}": ${error instanceof Error ? error.message : String(error)}`,
          { toolName: name, cause: error }
        );
      }
    }

    try {
      return await tool.execute(validatedInput, context);
    } catch (error) {
      if (error instanceof InvalidInputError) {
        throw error;
      }
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(
        `Execution failed for tool "${name}": ${error instanceof Error ? error.message : String(error)}`,
        { toolName: name, cause: error }
      );
    }
  }
}
