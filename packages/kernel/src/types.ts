/**
 * Kernel Context provided to plugins during lifecycle hooks.
 */
export interface KernelContext {
  registerService<T>(name: string, service: T): void;
  resolveService<T>(name: string): T;
  hasService(name: string): boolean;
}

/**
 * Plugin interface defining metadata and lifecycle hooks.
 */
export interface Plugin {
  /** Unique name of the plugin */
  name: string;
  /** Names of other plugins this plugin depends on */
  dependencies?: string[];
  /** Initialization hook called during kernel startup setup phase */
  setup?: (ctx: KernelContext) => Promise<void> | void;
  /** Operational hook called during kernel startup start phase */
  start?: (ctx: KernelContext) => Promise<void> | void;
  /** Teardown hook called during kernel shutdown */
  stop?: (ctx: KernelContext) => Promise<void> | void;
}

/**
 * Kernel lifecycle state.
 */
export type KernelState = 'uninitialized' | 'starting' | 'running' | 'stopping' | 'stopped';
