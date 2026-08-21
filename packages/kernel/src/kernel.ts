import { resolveDependencyOrder } from './dependency-resolver.js';
import { DuplicatePluginError, KernelError, PluginLifecycleError } from './errors.js';
import { ServiceRegistry } from './service-registry.js';
import type { KernelContext, KernelState, Plugin } from './types.js';

/**
 * Core Kernel providing plugin lifecycle management and service registry.
 */
export class Kernel implements KernelContext {
  private readonly plugins = new Map<string, Plugin>();
  private readonly serviceRegistry = new ServiceRegistry();
  private state: KernelState = 'uninitialized';
  private startedPlugins: Plugin[] = [];

  /**
   * Returns current kernel state.
   */
  getState(): KernelState {
    return this.state;
  }

  /**
   * Registers a plugin with the kernel.
   *
   * @throws {DuplicatePluginError} If a plugin with the same name is already registered.
   * @throws {KernelError} If kernel is already starting or running.
   */
  registerPlugin(plugin: Plugin): void {
    if (this.state !== 'uninitialized' && this.state !== 'stopped') {
      throw new KernelError(`Cannot register plugin "${plugin.name}" while kernel is in state "${this.state}".`);
    }
    if (this.plugins.has(plugin.name)) {
      throw new DuplicatePluginError(plugin.name);
    }
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Registers a service with the service registry.
   */
  registerService<T>(name: string, service: T): void {
    this.serviceRegistry.registerService(name, service);
  }

  /**
   * Resolves a registered service from the service registry.
   */
  resolveService<T>(name: string): T {
    return this.serviceRegistry.resolveService<T>(name);
  }

  /**
   * Checks if a service exists in the service registry.
   */
  hasService(name: string): boolean {
    return this.serviceRegistry.hasService(name);
  }

  /**
   * Starts the kernel by resolving dependencies, executing plugin setup hooks,
   * and executing plugin start hooks in deterministic dependency order.
   */
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      throw new KernelError(`Kernel is already ${this.state}.`);
    }

    const orderedPlugins = resolveDependencyOrder(this.plugins);

    // Setup phase
    for (const plugin of orderedPlugins) {
      if (plugin.setup) {
        try {
          await plugin.setup(this);
        } catch (cause) {
          this.state = 'uninitialized';
          throw new PluginLifecycleError(plugin.name, 'setup', cause);
        }
      }
    }

    // Start phase
    this.state = 'starting';
    this.startedPlugins = [];

    for (const plugin of orderedPlugins) {
      if (plugin.start) {
        try {
          await plugin.start(this);
        } catch (cause) {
          await this.rollbackStartedPlugins();
          this.state = 'stopped';
          throw new PluginLifecycleError(plugin.name, 'start', cause);
        }
      }
      this.startedPlugins.push(plugin);
    }

    this.state = 'running';
  }

  /**
   * Stops the kernel by executing plugin stop hooks in reverse dependency order.
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'uninitialized') {
      return;
    }

    this.state = 'stopping';
    const reversePlugins = [...this.startedPlugins].reverse();
    const stopErrors: PluginLifecycleError[] = [];

    for (const plugin of reversePlugins) {
      if (plugin.stop) {
        try {
          await plugin.stop(this);
        } catch (cause) {
          stopErrors.push(new PluginLifecycleError(plugin.name, 'stop', cause));
        }
      }
    }

    this.startedPlugins = [];
    this.state = 'stopped';

    if (stopErrors.length > 0) {
      if (stopErrors.length === 1) {
        throw stopErrors[0];
      }
      throw new KernelError(
        `Failed to stop one or more plugins during kernel shutdown:\n` +
          stopErrors.map((e) => `- ${e.message}`).join('\n'),
        { cause: stopErrors },
      );
    }
  }

  /**
   * Rollback helper to stop plugins that were already started during a failed start procedure.
   */
  private async rollbackStartedPlugins(): Promise<void> {
    const reversePlugins = [...this.startedPlugins].reverse();
    for (const plugin of reversePlugins) {
      if (plugin.stop) {
        try {
          await plugin.stop(this);
        } catch {
          // Ignore secondary errors during rollback to preserve primary start failure
        }
      }
    }
    this.startedPlugins = [];
  }
}
