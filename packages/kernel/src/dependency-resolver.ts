import { CircularPluginDependencyError, MissingPluginDependencyError } from './errors.js';
import type { Plugin } from './types.js';

/**
 * Resolves registered plugins into a deterministic startup order based on dependencies.
 *
 * If plugin A depends on plugin B, B will appear BEFORE A in the returned array.
 *
 * @throws {MissingPluginDependencyError} If a plugin depends on a non-existent plugin.
 * @throws {CircularPluginDependencyError} If a cycle is detected in plugin dependencies.
 */
export function resolveDependencyOrder(plugins: Map<string, Plugin>): Plugin[] {
  // First, check that all dependencies exist across all registered plugins
  for (const plugin of plugins.values()) {
    if (plugin.dependencies) {
      for (const depName of plugin.dependencies) {
        if (!plugins.has(depName)) {
          throw new MissingPluginDependencyError(plugin.name, depName);
        }
      }
    }
  }

  const state = new Map<string, 'unvisited' | 'visiting' | 'visited'>();
  for (const name of plugins.keys()) {
    state.set(name, 'unvisited');
  }

  const ordered: Plugin[] = [];

  function visit(name: string, currentPath: string[]): void {
    const currentState = state.get(name);

    if (currentState === 'visiting') {
      const cycleStartIndex = currentPath.indexOf(name);
      const cyclePath = [...currentPath.slice(cycleStartIndex), name];
      throw new CircularPluginDependencyError(cyclePath);
    }

    if (currentState === 'unvisited') {
      state.set(name, 'visiting');
      currentPath.push(name);

      const plugin = plugins.get(name)!;
      if (plugin.dependencies) {
        for (const depName of plugin.dependencies) {
          visit(depName, currentPath);
        }
      }

      state.set(name, 'visited');
      currentPath.pop();
      ordered.push(plugin);
    }
  }

  for (const name of plugins.keys()) {
    if (state.get(name) === 'unvisited') {
      visit(name, []);
    }
  }

  return ordered;
}
