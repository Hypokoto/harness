import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as tar from 'tar';
import type { PackageManifest, LockfilePackage } from './types.js';

export interface InstallerOptions {
  installDir: string;
}

export class Installer {
  private readonly installDir: string;
  private readonly tmpDir: string;

  constructor(options: InstallerOptions) {
    this.installDir = options.installDir;
    this.tmpDir = path.join(this.installDir, '.tmp');
  }

  async install(manifest: PackageManifest, artifactBuffer: Buffer, registryUrl: string): Promise<LockfilePackage> {
    const hash = crypto.createHash('sha256').update(artifactBuffer).digest('hex');
    if (hash !== manifest.checksum) {
      throw new Error(`Checksum mismatch. Expected ${manifest.checksum}, got ${hash}`);
    }

    if (!/^[a-zA-Z0-9\-_\.]+$/.test(manifest.name)) {
      throw new Error(`Invalid package name: ${manifest.name}`);
    }
    
    if (!/^[a-zA-Z0-9\-_\.]+$/.test(manifest.version)) {
      throw new Error(`Invalid package version: ${manifest.version}`);
    }


    await fs.mkdir(this.tmpDir, { recursive: true });
    const stagingDir = path.join(this.tmpDir, `${manifest.name}-${manifest.version}-${Date.now()}`);
    
    // We will extract to stagingDir
    await fs.mkdir(stagingDir, { recursive: true });

    const archivePath = path.join(this.tmpDir, `archive-${Date.now()}.tar.gz`);
    await fs.writeFile(archivePath, artifactBuffer);

    try {
      await tar.extract({
        file: archivePath,
        cwd: stagingDir,
        strict: true,
        filter: (entryPath, entry) => {
          // Prevent absolute paths
          if (path.isAbsolute(entryPath)) {
            throw new Error(`Unsafe absolute archive path is rejected: ${entryPath}`);
          }
          // Prevent path traversal
          const normalized = path.normalize(entryPath);
          if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
            throw new Error(`Path traversal archive is rejected: ${entryPath}`);
          }
          // Reject symlinks
          const t = (entry as any).type;
          if (t === 'SymbolicLink' || t === 'Link') {
            throw new Error(`Unsafe symlink is rejected: ${entryPath}`);
          }
          return true;
        }
      });
    } catch (err: any) {
      // Cleanup on failure
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(archivePath, { force: true }).catch(() => {});
      throw new Error(`Extraction failed: ${err.message}`);
    }

    await fs.rm(archivePath, { force: true });

    // Validate if it is already installed
    const finalDir = path.join(this.installDir, manifest.name, manifest.version);
    const finalDirExists = await fs.stat(finalDir).then(() => true).catch(() => false);
    
    if (finalDirExists) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      throw new Error(`installation conflict: ${manifest.name}@${manifest.version} is already installed`);
    }

    await fs.mkdir(path.dirname(finalDir), { recursive: true });
    await fs.rename(stagingDir, finalDir);

    const lockPkg: LockfilePackage = {
      name: manifest.name,
      version: manifest.version,
      checksum: hash,
      source: registryUrl,
      installedPath: finalDir,
      requestedCapabilities: manifest.capabilities || [],
      type: manifest.type
    };

    if ((manifest as any)._verifiedKeyId) {
      lockPkg.signature = {
        keyId: (manifest as any)._verifiedKeyId,
        verified: true
      };
    } else if (manifest.signatures && manifest.signatures.length > 0) {
      lockPkg.signature = {
        keyId: manifest.signatures[0].keyId,
        verified: false
      };
    }

    return lockPkg;
  }
}
