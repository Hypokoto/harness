import type { Event, EventListener } from './types.js';

export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener<any>>>();
  private readonly wildcardListeners = new Set<EventListener<any>>();

  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on<T = unknown>(type: string, listener: EventListener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as EventListener<any>);

    return () => {
      this.off(type, listener);
    };
  }

  /**
   * Subscribe to all events regardless of type.
   * Returns an unsubscribe function.
   */
  onAny(listener: EventListener<any>): () => void {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  /**
   * Subscribe to a specific event type for a single emission.
   * Returns an unsubscribe function.
   */
  once<T = unknown>(type: string, listener: EventListener<T>): () => void {
    const wrapper: EventListener<T> = async (event: Event<T>) => {
      this.off(type, wrapper);
      await listener(event);
    };
    return this.on(type, wrapper);
  }

  /**
   * Unsubscribe a listener from an event type.
   */
  off<T = unknown>(type: string, listener: EventListener<T>): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(listener as EventListener<any>);
      if (set.size === 0) {
        this.listeners.delete(type);
      }
    }
  }

  /**
   * Remove all listeners for a given event type, or all listeners if no type provided.
   */
  removeAllListeners(type?: string): void {
    if (type !== undefined) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
      this.wildcardListeners.clear();
    }
  }

  /**
   * Count subscribers for a given type, or total subscribers across types.
   */
  listenerCount(type?: string): number {
    if (type !== undefined) {
      return (this.listeners.get(type)?.size ?? 0);
    }
    let total = this.wildcardListeners.size;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Emit an event to all matching listeners and wildcard listeners.
   */
  async emit<T = unknown>(event: Event<T>): Promise<void> {
    const typeListeners = Array.from(this.listeners.get(event.type) ?? []);
    const wildcards = Array.from(this.wildcardListeners);

    const allListeners = [...typeListeners, ...wildcards];

    for (const listener of allListeners) {
      await listener(event);
    }
  }
}
