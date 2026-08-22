import type { Message } from '@harness/model';
import type { Tool } from '@harness/tools';

export interface ToolIndexEntry {
  name: string;
  description: string;
  category?: string;
  keywords?: string[];
  inputSchema?: Record<string, unknown>;
}

export interface ContextProvider {
  readonly name: string;
  getSystemPrompt?(): Promise<string | undefined> | string | undefined;
  getMessages?(): Promise<Message[] | undefined> | Message[] | undefined;
  getTools?(): Promise<Tool[] | undefined> | Tool[] | undefined;
  getMetadata?(): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

export interface LazyToolConfig {
  enabled: boolean;
  eagerTools?: string[];
  searchToolName?: string;
  searchLimit?: number;
}

export interface ComposedContext {
  systemPrompt: string;
  messages: Message[];
  activeTools: Tool[];
  indexedTools: ToolIndexEntry[];
  metadata: Record<string, unknown>;
  isLazy: boolean;
}

export interface ContextComposerOptions {
  providers?: ContextProvider[];
  tools?: Tool[];
  lazyTools?: LazyToolConfig;
  allowedTools?: string[];
  deniedTools?: string[];
}
