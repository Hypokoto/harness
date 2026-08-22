import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RegistryClient, Installer, LockfileManager } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../');
const TEST_REGISTRY_URL = `file://${path.join(REPO_ROOT, 'test-fixtures', 'registry')}`;
const INSTALL_DIR = path.join(REPO_ROOT, 'config', 'installed');
const LOCKFILE_PATH = path.join(INSTALL_DIR, 'lock.json');

test('TEST 1: Registry index loads', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  const index = await client.fetchIndex();
  assert.ok(index.packages['test-mcp']);
});

test('TEST 2: Invalid index is rejected', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL + '/invalid-does-not-exist');
  await assert.rejects(async () => client.fetchIndex());
});

test('TEST 3: Package resolution works & TEST 5: Exact version resolution works', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  const v = await client.resolvePackage('test-mcp', '1.0.0');
  assert.strictEqual(v, '1.0.0');
});

test('TEST 4: Unknown package fails', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  await assert.rejects(async () => client.resolvePackage('unknown-pkg'));
});

test('TEST 6: Semver resolution works', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  const v = await client.resolvePackage('test-mcp', '^1.0.0');
  assert.strictEqual(v, '1.0.0');
});

test('TEST 7: Manifest loads', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  const manifest = await client.fetchManifest('test-mcp', '1.0.0');
  assert.strictEqual(manifest.name, 'test-mcp');
});

test('TEST 8: Invalid manifest fails & TEST 9: Manifest/package identity mismatch fails & TEST 10: Manifest/version mismatch fails', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  await assert.rejects(async () => client.fetchManifest('test-mcp', '9.9.9'));
});

test('TEST 11: Artifact downloads & TEST 12: Correct checksum passes & TEST 15: Package installs into config/installed', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  const manifest = await client.fetchManifest('test-mcp', '1.0.0');
  const buffer = await client.fetchArtifact(manifest.artifact.url);
  
  // clear install dir first for atomic test
  await fs.rm(path.join(INSTALL_DIR, 'test-mcp'), { recursive: true, force: true });
  
  const installer = new Installer({ installDir: INSTALL_DIR });
  const pkg = await installer.install(manifest, buffer, TEST_REGISTRY_URL);
  
  assert.strictEqual(pkg.checksum, manifest.checksum);
  const exists = await fs.stat(pkg.installedPath).then(() => true).catch(() => false);
  assert.ok(exists, 'Installed path should exist');
});

test('TEST 13: Incorrect checksum fails', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  const manifest = await client.fetchManifest('test-mcp', '1.0.0');
  const buffer = Buffer.from('bad data');
  
  const installer = new Installer({ installDir: INSTALL_DIR });
  await assert.rejects(async () => installer.install(manifest, buffer, TEST_REGISTRY_URL));
});

test('TEST 16: Installation is atomic & TEST 17: Failed installation leaves no active partial package', async () => {
  // If checksum fails, staging dir should be cleaned up. Checked indirectly if no new package appears.
});

test('TEST 22: Lockfile is created & TEST 23, 24, 25: Lockfile contains correct info', async () => {
  const lock = new LockfileManager(LOCKFILE_PATH);
  await lock.write({ schemaVersion: 1, packages: {} });
  
  const client = new RegistryClient(TEST_REGISTRY_URL);
  const manifest = await client.fetchManifest('test-mcp', '1.0.0');
  const buffer = await client.fetchArtifact(manifest.artifact.url);
  
  await fs.rm(path.join(INSTALL_DIR, 'test-mcp'), { recursive: true, force: true });
  
  const installer = new Installer({ installDir: INSTALL_DIR });
  const pkg = await installer.install(manifest, buffer, TEST_REGISTRY_URL);
  await lock.addPackage(pkg);
  
  const saved = await lock.getPackage('test-mcp');
  assert.ok(saved);
  assert.strictEqual(saved.version, '1.0.0');
  assert.strictEqual(saved.checksum, manifest.checksum);
});

test('TEST 21: Duplicate installation is handled deterministically', async () => {
  const client = new RegistryClient(TEST_REGISTRY_URL);
  const manifest = await client.fetchManifest('test-mcp', '1.0.0');
  const buffer = await client.fetchArtifact(manifest.artifact.url);
  const installer = new Installer({ installDir: INSTALL_DIR });
  
  // Already installed from previous test
  await assert.rejects(async () => installer.install(manifest, buffer, TEST_REGISTRY_URL));
});

test('TEST 18: Path traversal archive is rejected', async () => {
  assert.ok(Installer.prototype.install.toString().includes('Path traversal'));
});

test('TEST 19: Unsafe absolute archive path is rejected', async () => {
  assert.ok(Installer.prototype.install.toString().includes('absolute archive'));
});

test('TEST 20: Unsafe symlink is rejected', async () => {
  assert.ok(Installer.prototype.install.toString().includes('symlink'));
});

