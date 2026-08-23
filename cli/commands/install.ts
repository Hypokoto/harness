import { RegistryClient, Installer, LockfileManager } from '@harness/registry-client';
import type { CliFlags } from '../config.js';
import { ExitCode } from '../exit-codes.js';
import { resolveConfig } from '../config.js';
import { output, outputResult, success, failure } from '../formatter.js';
import path from 'node:path';
import fs from 'node:fs';

export async function installCommand(pkgRef: string, flags: CliFlags = {}): Promise<number> {
  let name = pkgRef;
  let requestedVersion: string | undefined;

  if (pkgRef.includes('@')) {
    const parts = pkgRef.split('@');
    name = parts[0];
    requestedVersion = parts[1];
  }

  // Determine install directory from config
  let installDir: string;
  try {
    const config = resolveConfig(flags);
    if (config.project.projectRoot) {
      installDir = path.join(config.project.projectRoot, '.harness', 'installed');
    } else {
      const { getGlobalDataDir } = await import('../paths.js');
      installDir = path.join(getGlobalDataDir(), 'installed');
    }
  } catch {
    const { getGlobalDataDir } = await import('../paths.js');
    installDir = path.join(getGlobalDataDir(), 'installed');
  }

  // Determine registry URL
  const registryUrl = process.env.HARNESS_REGISTRY_URL
    || 'file://' + path.join(path.dirname(path.dirname(import.meta.url.replace('file://', ''))), 'test-fixtures', 'registry');

  if (!fs.existsSync(installDir)) {
    fs.mkdirSync(installDir, { recursive: true });
  }

  const lockfilePath = path.join(installDir, 'lock.json');

  try {
    const client = new RegistryClient({ registryUrl });
    output(`Resolving ${name}...`, { json: flags.json });
    const resolvedVersion = await client.resolvePackage(name, requestedVersion);

    output(`Fetching manifest for ${name}@${resolvedVersion}...`, { json: flags.json });
    const manifest = await client.fetchManifest(name, resolvedVersion);

    output(`Downloading artifact...`, { json: flags.json });
    const artifactBuffer = await client.fetchArtifact(manifest.artifact.url);

    output(`Verifying checksum and installing...`, { json: flags.json });
    const installer = new Installer({ installDir });
    const lockPkg = await installer.install(manifest, artifactBuffer, registryUrl);

    const lockfile = new LockfileManager(lockfilePath);
    await lockfile.addPackage(lockPkg);

    outputResult(
      () => success(`Successfully installed ${name}@${resolvedVersion}`),
      { name, version: resolvedVersion, installedPath: lockPkg.installedPath },
      { json: flags.json }
    );

    return ExitCode.SUCCESS;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    outputResult(
      () => failure(`Failed to install ${pkgRef}: ${msg}`),
      { error: msg },
      { json: flags.json }
    );
    return ExitCode.GENERIC_ERROR;
  }
}
