export { Kernel } from './kernel.js';
export { ServiceRegistry } from './service-registry.js';
export { resolveDependencyOrder } from './dependency-resolver.js';
export type { Plugin, KernelContext, KernelState } from './types.js';
export {
  KernelError,
  UnknownServiceError,
  DuplicateServiceError,
  DuplicatePluginError,
  MissingPluginDependencyError,
  CircularPluginDependencyError,
  PluginLifecycleError,
} from './errors.js';
