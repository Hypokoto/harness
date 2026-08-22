import type { Message } from '@harness/model';
import type { Tool } from '@harness/tools';
import type { ContextProvider } from '../types.js';

export interface DynamicContextProviderOptions {
  name?: string;
  getSystemPrompt?: () => Promise<string | undefined> | string | undefined;
  getMessages?: () => Promise<Message[] | undefined> | Message[] | undefined;
  getTools?: () => Promise<Tool[] | undefined> | Tool[] | undefined;
  getMetadata?: () => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

export class DynamicContextProvider implements ContextProvider {
  public readonly name: string;
  private readonly systemPromptFn?: () => Promise<string | undefined> | string | undefined;
  private readonly messagesFn?: () => Promise<Message[] | undefined> | Message[] | undefined;
  private readonly toolsFn?: () => Promise<Tool[] | undefined> | Tool[] | undefined;
  private readonly metadataFn?: () => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;

  constructor(options: DynamicContextProviderOptions = {}) {
    this.name = options.name ?? 'dynamic';
    this.systemPromptFn = options.getSystemPrompt;
    this.messagesFn = options.getMessages;
    this.toolsFn = options.getTools;
    this.metadataFn = options.getMetadata;
  }

  public async getSystemPrompt(): Promise<string | undefined> {
    if (!this.systemPromptFn) return undefined;
    return this.systemPromptFn();
  }

  public async getMessages(): Promise<Message[] | undefined> {
    if (!this.messagesFn) return undefined;
    return this.messagesFn();
  }

  public async getTools(): Promise<Tool[] | undefined> {
    if (!this.toolsFn) return undefined;
    return this.toolsFn();
  }

  public async getMetadata(): Promise<Record<string, unknown> | undefined> {
    if (!this.metadataFn) return undefined;
    return this.metadataFn();
  }
}
