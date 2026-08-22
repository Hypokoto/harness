import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { verifyManifestSignature, getCanonicalPayload, type TrustStore } from './trust.js';
import type { PackageManifest } from './types.js';

test('Signature Verification', async (t) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

  const manifest: PackageManifest = {
    name: 'test-pkg',
    version: '1.0.0',
    type: 'mcp',
    checksum: 'abc123hash',
    artifact: { type: 'tarball', url: 'test.tgz' }
  };

  const payload = getCanonicalPayload(manifest);
  const signature = crypto.sign(undefined, Buffer.from(payload, 'utf8'), privateKey).toString('hex');

  manifest.signatures = [{ keyId: 'key-1', signature }];

  const trustStore: TrustStore = {
    trustedKeys: new Map([['key-1', pubPem]]),
    revokedKeys: new Set(),
    allowUnsigned: false
  };

  await t.test('TEST 1: Valid signature passes', () => {
    const res = verifyManifestSignature(manifest, trustStore);
    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.keyId, 'key-1');
  });

  await t.test('TEST 3: Modified manifest fails signature', () => {
    const altered: PackageManifest = { ...manifest, version: '1.0.1' };
    assert.throws(() => verifyManifestSignature(altered, trustStore), /No valid signature found/);
  });

  await t.test('TEST 4: Wrong public key fails', () => {
    const wrongKeys = crypto.generateKeyPairSync('ed25519');
    const wrongPub = wrongKeys.publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const store: TrustStore = { ...trustStore, trustedKeys: new Map([['key-1', wrongPub]]) };
    assert.throws(() => verifyManifestSignature(manifest, store), /No valid signature found/);
  });

  await t.test('TEST 5: Unknown key ID fails', () => {
    const store: TrustStore = { ...trustStore, trustedKeys: new Map([['key-2', pubPem]]) };
    assert.throws(() => verifyManifestSignature(manifest, store), /No valid signature found/);
  });

  await t.test('TEST 6: Revoked key fails', () => {
    const store: TrustStore = { ...trustStore, revokedKeys: new Set(['key-1']) };
    assert.throws(() => verifyManifestSignature(manifest, store), /Signature uses revoked key/);
  });

  await t.test('TEST 7: Unsigned marketplace package fails', () => {
    const unsigned: PackageManifest = { ...manifest, signatures: [] };
    assert.throws(() => verifyManifestSignature(unsigned, trustStore), /Unsigned packages are not allowed/);
  });

  await t.test('TEST 8: Explicit development unsigned mode works', () => {
    const unsigned: PackageManifest = { ...manifest, signatures: [] };
    const devStore: TrustStore = { ...trustStore, allowUnsigned: true };
    const res = verifyManifestSignature(unsigned, devStore);
    assert.strictEqual(res.verified, false);
  });
});
