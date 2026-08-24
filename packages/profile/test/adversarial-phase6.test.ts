import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import crypto from 'node:crypto';

// The CLI modules and profile modules
import { resolveConfig } from '../../../cli/config.js';
import { discoverProject } from '../../../cli/paths.js';
import { ProfileResolver } from '../src/index.js';

async function createTempEnv() {
  const dir = join(tmpdir(), `harness-test-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('ATTACK 1 — BASIC PROFILE RESOLUTION', async () => {
  const dir = await createTempEnv();
  
  // Setup project
  const projectDir = join(dir, 'my-project');
  mkdirSync(projectDir);
  
  writeFileSync(join(projectDir, '.harness.toml'), 'name = "project-profile"\n');
  
  const config = resolveConfig({ projectDir });
  assert.equal(config.project.projectRoot, projectDir);
  
  // Clean up
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 2 — NESTED DIRECTORY DISCOVERY', async () => {
  const dir = await createTempEnv();
  const projectDir = join(dir, 'my-project');
  mkdirSync(join(projectDir, 'src', 'deep', 'module'), { recursive: true });
  
  writeFileSync(join(projectDir, '.harness.toml'), 'name = "nested"\n');
  
  const nestedDir = join(projectDir, 'src', 'deep', 'module');
  const project = discoverProject(nestedDir);
  assert.equal(project.projectRoot, projectDir);
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 3 — PARENT PROJECT COLLISION', async () => {
  const dir = await createTempEnv();
  const parentDir = join(dir, 'parent');
  const childDir = join(parentDir, 'child');
  mkdirSync(childDir, { recursive: true });
  
  writeFileSync(join(parentDir, '.harness.toml'), 'name = "parent"\n');
  writeFileSync(join(childDir, '.harness.toml'), 'name = "child"\n');
  
  const project = discoverProject(childDir);
  assert.equal(project.projectRoot, childDir);
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 4 — UNRELATED PARENT', async () => {
  const dir = await createTempEnv();
  const parentDir = join(dir, 'parent');
  const childDir = join(parentDir, 'child');
  // Child has NO config, but has .git or package.json
  mkdirSync(childDir, { recursive: true });
  writeFileSync(join(parentDir, '.harness.toml'), 'name = "malicious-parent"\n');
  
  // Usually tools use .git as a boundary
  mkdirSync(join(childDir, '.git'));
  
  const project = discoverProject(childDir);
  assert.equal(project.projectRoot, null, 'An unrelated parent should not hijack the intended project. Project root should be null.');
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 9 — MALFORMED TOML', async () => {
  const dir = await createTempEnv();
  const projectDir = join(dir, 'my-project');
  mkdirSync(projectDir);
  
  // Syntax error in TOML
  writeFileSync(join(projectDir, '.harness.toml'), 'name = "bad"\n[invalid');
  
  assert.throws(() => {
    resolveConfig({ projectDir });
  }, /TOML|Invalid/i);
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 11 — TYPE CONFUSION', async () => {
  const dir = await createTempEnv();
  const projectDir = join(dir, 'my-project');
  mkdirSync(projectDir);
  
  // Invalid schema types
  writeFileSync(join(projectDir, '.harness.toml'), 'model = 123\n');
  
  assert.throws(() => {
    resolveConfig({ projectDir });
  }, /ZodError|Invalid/i);
  
  await rm(dir, { recursive: true, force: true });
});
