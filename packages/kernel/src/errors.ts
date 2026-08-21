/**
 * Base class for all Kernel-related errors.
 */
export class KernelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KernelError';
  }
}

/**
 * Thrown when attempting to resolve a service that has not been registered.
 */
export class UnknownServiceError extends KernelError {
  constructor(public readonly serviceName: string) {
    super(`Service "${serviceName}" is not registered.`);
    this.name = 'UnknownServiceError';
  }
}

/**
 * Thrown when attempting to register a service with a name that is already registered.
 */
export class DuplicateServiceError extends KernelError {
  constructor(public readonly serviceName: string) {
    super(`Service "${serviceName}" is already registered.`);
    this.name = 'DuplicateServiceError';
  }
}

/**
 * Thrown when attempting to register a plugin with a name that is already registered.
 */
export class DuplicatePluginError extends KernelError {
  constructor(public readonly pluginName: string) {
    super(`Plugin "${pluginName}" is already registered.`);
    this.name = 'DuplicatePluginError';
  }
}

/**
 * Thrown when a plugin depends on another plugin that is not registered.
 */
export class MissingPluginDependencyError extends KernelError {
  constructor(
    public readonly pluginName: string,
    public readonly dependencyName: string,
  ) {
    super(`Plugin "${pluginName}" depends on missing plugin "${dependencyName}".`);
    this.name = 'MissingPluginDependencyError';
  }
}

/**
 * Thrown when a circular dependency is detected among plugins.
 */
export class CircularPluginDependencyError extends KernelError {
  constructor(public readonly cyclePath: string[]) {
    super(`Circular plugin dependency detected:\n${cyclePath.join(' -> ')}`);
    this.name = 'CircularPluginDependencyError';
  }
}

/**
 * Thrown when a plugin lifecycle hook (setup, start, or stop) fails.
 */
export class PluginLifecycleError extends KernelError {
  constructor(
    public readonly pluginName: string,
    public readonly stage: 'setup' | 'start' | 'stop',
    cause: unknown,
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Plugin "${pluginName}" failed during ${stage}: ${causeMessage}`, { cause });
    this.name = 'PluginLifecycleError';
  }
}
