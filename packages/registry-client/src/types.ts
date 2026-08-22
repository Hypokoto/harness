export interface RegistryIndex {
  schemaVersion: number;
  packages: Record<string, {
    versions: string[];
  }>;
}

export interface PackageManifest {
  name: string;
  version: string;
  type: string; // e.g. "mcp"
  description?: string;
  artifact: {
    type: string; // e.g. "tarball" or "git-archive"
    url: string;
  };
  checksum: string; // SHA-256
  capabilities?: string[];
  // type-specific configurations
  mcp?: {
    command: string;
    args?: string[];
  };
}

export interface LockfilePackage {
  name: string;
  version: string;
  checksum: string;
  source: string;
  installedPath: string;
  requestedCapabilities?: string[];
  type: string;
}

export interface Lockfile {
  schemaVersion: number;
  packages: Record<string, LockfilePackage>;
}

export interface ResolveResult {
  manifest: PackageManifest;
  artifactUrl: string;
}
