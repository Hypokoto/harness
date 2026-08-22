import crypto from 'node:crypto';
import type { PackageManifest } from './types.js';

export interface TrustStore {
  // mapping of key ID to public key PEM
  trustedKeys: Map<string, string>;
  // keys that have been revoked
  revokedKeys: Set<string>;
  // if true, packages without signatures are allowed (development)
  allowUnsigned: boolean;
}

export function getCanonicalPayload(manifest: PackageManifest): string {
  const payload = {
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    checksum: manifest.checksum
  };
  return JSON.stringify(payload, ['checksum', 'name', 'type', 'version']);
}

export function verifyManifestSignature(manifest: PackageManifest, trustStore: TrustStore): { verified: boolean; keyId?: string } {
  if (!manifest.signatures || manifest.signatures.length === 0) {
    if (trustStore.allowUnsigned) {
      console.warn('UNSIGNED PACKAGE ALLOWED BY TRUST STORE: ' + manifest.name);
      return { verified: false };
    }
    throw new Error('Unsigned packages are not allowed');
  }

  const payload = getCanonicalPayload(manifest);

  for (const sig of manifest.signatures) {
    if (trustStore.revokedKeys.has(sig.keyId)) {
      throw new Error(`Signature uses revoked key: ${sig.keyId}`);
    }

    const publicKeyPem = trustStore.trustedKeys.get(sig.keyId);
    if (!publicKeyPem) {
      // Unknown key
      continue;
    }

    try {
      const publicKey = crypto.createPublicKey(publicKeyPem);
      const isVerified = crypto.verify(
        undefined,
        Buffer.from(payload, 'utf8'),
        publicKey,
        Buffer.from(sig.signature, 'hex')
      );

      if (isVerified) {
        return { verified: true, keyId: sig.keyId };
      }
    } catch (err) {
      // Bad signature format, etc.
    }
  }

  throw new Error('No valid signature found for package');
}
