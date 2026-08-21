import { DuplicateServiceError, UnknownServiceError } from './errors.js';

/**
 * Registry for managing system and plugin services.
 */
export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  /**
   * Registers a service by name.
   */
  registerService<T>(name: string, service: T): void {
    if (this.services.has(name)) {
      throw new DuplicateServiceError(name);
    }
    this.services.set(name, service);
  }

  /**
   * Resolves a registered service by name.
   */
  resolveService<T>(name: string): T {
    if (!this.services.has(name)) {
      throw new UnknownServiceError(name);
    }
    return this.services.get(name) as T;
  }

  /**
   * Checks whether a service is registered.
   */
  hasService(name: string): boolean {
    return this.services.has(name);
  }
}
