import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import type { RegistryIndex, PackageManifest, ResolveResult } from './types.js';

export class RegistryClient {
  constructor(private readonly baseUrl: string) {}

  private async fetchText(url: string): Promise<string> {
    if (url.startsWith('file://')) {
      const path = fileURLToPath(url);
      return fs.readFile(path, 'utf8');
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    return res.text();
  }

  private async fetchBuffer(url: string): Promise<Buffer> {
    if (url.startsWith('file://')) {
      const path = fileURLToPath(url);
      return fs.readFile(path);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async fetchIndex(): Promise<RegistryIndex> {
    const text = await this.fetchText(`${this.baseUrl}/index.json`);
    const index = JSON.parse(text) as RegistryIndex;
    if (!index || !index.schemaVersion || !index.packages) {
      throw new Error('Invalid registry index schema');
    }
    return index;
  }

  async resolvePackage(name: string, requestedVersion?: string): Promise<string> {
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error('Invalid package name');
    }

    const index = await this.fetchIndex();
    const pkg = index.packages[name];
    if (!pkg) {
      throw new Error(`Package not found: ${name}`);
    }

    if (requestedVersion) {
      const valid = semver.valid(requestedVersion) || semver.validRange(requestedVersion);
      if (!valid) {
        throw new Error('Malformed version requested');
      }
      const resolved = semver.maxSatisfying(pkg.versions, requestedVersion);
      if (!resolved) {
        throw new Error(`Version ${requestedVersion} not found for package ${name}`);
      }
      return resolved;
    } else {
      // Default to latest
      const latest = semver.maxSatisfying(pkg.versions, '*');
      if (!latest) {
        throw new Error(`No valid versions found for package ${name}`);
      }
      return latest;
    }
  }

  async fetchManifest(name: string, version: string): Promise<PackageManifest> {
    if (name.includes('/') || name.includes('\\') || name.includes('..') || version.includes('/') || version.includes('\\') || version.includes('..')) {
      throw new Error('Invalid package name or version');
    }

    const url = `${this.baseUrl}/packages/${name}/${version}/manifest.json`;
    const text = await this.fetchText(url);
    const manifest = JSON.parse(text) as PackageManifest;

    if (!manifest.name || !manifest.version || !manifest.type || !manifest.artifact || !manifest.checksum) {
      throw new Error('Invalid manifest schema');
    }

    if (manifest.name !== name) {
      throw new Error('Manifest/package identity mismatch');
    }
    if (manifest.version !== version) {
      throw new Error('Manifest/version mismatch');
    }
    if (manifest.type !== 'mcp' && manifest.type !== 'skill') {
      throw new Error(`Unsupported package type: ${manifest.type}`);
    }

    return manifest;
  }

  async fetchArtifact(url: string): Promise<Buffer> {
    // Determine absolute URL if relative
    const artifactUrl = url.startsWith('http') || url.startsWith('file://') 
      ? url 
      : `${this.baseUrl}/${url}`;

    return this.fetchBuffer(artifactUrl);
  }
}
