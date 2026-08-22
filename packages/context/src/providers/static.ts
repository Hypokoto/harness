import type { Message } from '@harness/model';
import type { Tool } from '@harness/tools';
import type { ContextProvider } from '../types.js';

export interface StaticContextProviderOptions {
  name?: string;
  systemPrompt?: string;
  messages?: Message[];
  tools?: Tool[];
  metadata?: Record<string, unknown>;
}

export class StaticContextProvider implements ContextProvider {
  public readonly name: string;
  private readonly systemPrompt?: string;
  private readonly messages?: Message[];
  private readonly tools?: Tool[];
  private readonly metadata?: Record<string, unknown>;

  constructor(options: StaticContextProviderOptions = {}) {
    this.name = options.name ?? 'static';
    this.systemPrompt = options.systemPrompt;
    this.messages = options.messages;
    this.tools = options.tools;
    this.metadata = options.metadata;
  }

  public getSystemPrompt(): string | undefined {
    return this.systemPrompt;
  }

  public getMessages(): Message[] | undefined {
    return this.messages ? [...this.messages] : undefined;
  }

  public getTools(): Tool[] | undefined {
    return this.tools ? [...this.tools] : undefined;
  }

  public getMetadata(): Record<string, unknown> | undefined {
    return this.metadata ? { ...this.metadata } : undefined;
  }
}
