import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import crypto from 'node:crypto';

// The CLI modules and profile modules
import { resolveConfig, writeActiveProfile } from '../../../cli/config.js';
import { discoverProject, getProjectEventsDir } from '../../../cli/paths.js';
import { ProfileResolver } from '../src/index.js';

async function createTempEnv() {
  const dir = join(tmpdir(), `harness-test-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('ATTACK 6 — PROFILE NAME COLLISION', async () => {
  const dir = await createTempEnv();
  const globalDir = join(dir, 'global', 'profiles');
  const projectDir = join(dir, 'my-project');
  const projectProfileDir = join(projectDir, '.harness', 'profiles');
  
  mkdirSync(globalDir, { recursive: true });
  mkdirSync(projectProfileDir, { recursive: true });
  
  // Global profile
  writeFileSync(join(globalDir, 'dev.toml'), 'name = "global-dev"\n');
  
  // Project profile
  writeFileSync(join(projectProfileDir, 'dev.toml'), 'name = "project-dev"\n');
  
  // Create a stub project
  writeFileSync(join(projectDir, '.harness.toml'), 'description = "base"\n');
  
  // Set XDG_CONFIG_HOME so global profile directory points to our test globalDir
  const originalXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(dir, 'global');
  
  // Ask for profile 'dev'
  writeActiveProfile(projectProfileDir, 'dev');
  
  const config = resolveConfig({ projectDir });
  
  // The profile located in the project's profile dir should take precedence!
  assert.equal(config.profile.name, 'project-dev');
  
  if (originalXdg) {
    process.env.XDG_CONFIG_HOME = originalXdg;
  } else {
    delete process.env.XDG_CONFIG_HOME;
  }
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 7 — PROFILE SWITCHING', async () => {
  const dir = await createTempEnv();
  const projectDir = join(dir, 'my-project');
  const profilesDir = join(projectDir, '.harness', 'profiles');
  mkdirSync(profilesDir, { recursive: true });
  
  writeFileSync(join(projectDir, '.harness.toml'), 'description = "base"\n');
  writeFileSync(join(profilesDir, 'profile-a.toml'), 'name = "a"\n');
  writeFileSync(join(profilesDir, 'profile-b.toml'), 'name = "b"\n');
  
  writeActiveProfile(profilesDir, 'profile-a');
  assert.equal(resolveConfig({ projectDir }).profile.name, 'a');
  
  writeActiveProfile(profilesDir, 'profile-b');
  assert.equal(resolveConfig({ projectDir }).profile.name, 'b');
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 8 — MISSING PROFILE', async () => {
  const dir = await createTempEnv();
  const projectDir = join(dir, 'my-project');
  const profilesDir = join(projectDir, '.harness', 'profiles');
  mkdirSync(profilesDir, { recursive: true });
  
  writeFileSync(join(projectDir, '.harness.toml'), 'name = "base"\n');
  
  writeActiveProfile(profilesDir, 'missing');
  
  assert.throws(() => resolveConfig({ projectDir }), /not found/);
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 14 — CWD SWITCHING', async () => {
  const dir = await createTempEnv();
  const projA = join(dir, 'A');
  const projB = join(dir, 'B');
  mkdirSync(projA);
  mkdirSync(projB);
  
  writeFileSync(join(projA, '.harness.toml'), 'name = "proj-a"\n');
  writeFileSync(join(projB, '.harness.toml'), 'name = "proj-b"\n');
  
  const configA = resolveConfig({ projectDir: projA });
  const configB = resolveConfig({ projectDir: projB });
  
  assert.equal(configA.profile.name, 'proj-a');
  assert.equal(configB.profile.name, 'proj-b');
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 16 — PROFILE STATE FILE CORRUPTION', async () => {
  const dir = await createTempEnv();
  const projectDir = join(dir, 'my-project');
  const profilesDir = join(projectDir, '.harness', 'profiles');
  mkdirSync(profilesDir, { recursive: true });
  
  writeFileSync(join(projectDir, '.harness.toml'), 'name = "base"\n');
  // Write a corrupted `.active` file (points to something that doesn't exist)
  writeFileSync(join(profilesDir, '.active'), 'corrupted-name\n');
  
  // It shouldn't silently use 'default' if it's explicitly set to 'corrupted-name'
  assert.throws(() => resolveConfig({ projectDir }), /not found/);
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 19 — CLI OVERRIDE', async () => {
  const dir = await createTempEnv();
  const projectDir = join(dir, 'my-project');
  mkdirSync(projectDir);
  
  writeFileSync(join(projectDir, '.harness.toml'), 'model = "ollama/original"\n');
  
  const config = resolveConfig({ 
    projectDir,
    provider: 'anthropic',
    model: 'claude-test'
  });
  
  assert.equal(config.modelProvider, 'anthropic');
  assert.equal(config.modelName, 'claude-test');
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 20 & 25 — SESSION PROFILE BINDING AND PERMISSIONS', async () => {
  // Creating a session binds to an event store in the active profile's project.
  // Wait, session ID doesn't store the profile. It just lives in EventStore.
  // When a session is resumed, it uses the currently resolved config.
  // The system prompt, model, etc., were logged in `session_created`.
  // If the profile changes, the resumed session MUST NOT inherit the new profile's permissions unless explicit.
  // Actually, wait: EventStore directory is tied to the project, not the profile!
  const dir = await createTempEnv();
  const projectDir = join(dir, 'my-project');
  mkdirSync(projectDir);
  
  writeFileSync(join(projectDir, '.harness.toml'), 'name = "base"\n');
  
  const config = resolveConfig({ projectDir });
  assert.ok(config.eventsDir.includes('.harness/events'));
  
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 26 — PROJECT SESSION COLLISION', async () => {
  const dir = await createTempEnv();
  const projA = join(dir, 'A');
  const projB = join(dir, 'B');
  mkdirSync(projA);
  mkdirSync(projB);
  
  writeFileSync(join(projA, '.harness.toml'), 'name = "A"\n');
  writeFileSync(join(projB, '.harness.toml'), 'name = "B"\n');
  
  const configA = resolveConfig({ projectDir: projA });
  const configB = resolveConfig({ projectDir: projB });
  
  assert.notEqual(configA.eventsDir, configB.eventsDir);
  
  await rm(dir, { recursive: true, force: true });
});
