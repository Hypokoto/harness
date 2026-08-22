import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BUILTIN_DEFAULT_PROFILE,
  InvalidProfileError,
  parseTOML,
  ProfileNotFoundError,
  ProfileResolver,
  TOMLParseError,
  findProjectConfig,
  deepMergeProfiles,
  validateProfileConfig,
} from './index.js';

test('TEST 1: Default resolution returns built-in profile when no config files exist', () => {
  const resolver = new ProfileResolver();
  const resolved = resolver.resolve();

  assert.equal(resolved.name, 'default');
  assert.equal(resolved.config.model, BUILTIN_DEFAULT_PROFILE.model);
  assert.equal(resolved.config.systemPrompt, BUILTIN_DEFAULT_PROFILE.systemPrompt);
  assert.equal(resolved.config.maxSteps, BUILTIN_DEFAULT_PROFILE.maxSteps);
  assert.equal(resolved.config.temperature, BUILTIN_DEFAULT_PROFILE.temperature);
  assert.deepEqual(resolved.sources, {});
});

test('TEST 2: TOML parser correctly parses key-values, sections, numbers, booleans, and arrays', () => {
  const tomlContent = `
# Global Config
name = "custom-global"
model = "anthropic/claude-3-opus"
maxSteps = 15
temperature = 0.2

[env]
API_KEY = "secret_123"
DEBUG = "true"

[settings]
theme = "dark"
timeout = 3000

allowedTools = ["echo", "web_search"]
`;

  const parsed = parseTOML(tomlContent) as any;
  assert.equal(parsed.name, 'custom-global');
  assert.equal(parsed.model, 'anthropic/claude-3-opus');
  assert.equal(parsed.maxSteps, 15);
  assert.equal(parsed.temperature, 0.2);
  assert.equal(parsed.env?.API_KEY, 'secret_123');
  assert.equal(parsed.env?.DEBUG, 'true');
  assert.equal(parsed.settings?.theme, 'dark');
  assert.equal(parsed.settings?.timeout, 3000);
  assert.deepEqual(parsed.allowedTools, ['echo', 'web_search']);
});

test('TEST 3: TOML parser throws TOMLParseError on invalid syntax', () => {
  const invalidToml = `
name = "bad
missing_equals
`;
  assert.throws(
    () => parseTOML(invalidToml),
    (err: any) => {
      assert.ok(err instanceof TOMLParseError);
      return true;
    }
  );
});

test('TEST 4: Global configuration layer (Layer 2) overrides built-in defaults', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-profile-test-'));
  try {
    const globalConfigPath = join(tmpDir, 'config.toml');
    writeFileSync(
      globalConfigPath,
      `
model = "global-model"
maxSteps = 25
`
    );

    const resolver = new ProfileResolver();
    const resolved = resolver.resolve({ globalConfigPath });

    assert.equal(resolved.config.model, 'global-model');
    assert.equal(resolved.config.maxSteps, 25);
    assert.equal(resolved.config.systemPrompt, BUILTIN_DEFAULT_PROFILE.systemPrompt); // Unchanged fallback
    assert.equal(resolved.sources.globalConfigPath, globalConfigPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 5: Selected profile layer (Layer 3) overrides global configuration and built-in defaults', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-profile-test-'));
  try {
    const globalConfigPath = join(tmpDir, 'config.toml');
    writeFileSync(globalConfigPath, `model = "global-model"\ntemperature = 0.5`);

    const profileDir = join(tmpDir, 'profiles');
    mkdirSync(profileDir);
    const profilePath = join(profileDir, 'coding.toml');
    writeFileSync(
      profilePath,
      `
model = "profile-coding-model"
temperature = 0.1
systemPrompt = "You are an expert coder."
`
    );

    const resolver = new ProfileResolver();
    const resolved = resolver.resolve({
      globalConfigPath,
      profileDir,
      profileName: 'coding',
    });

    assert.equal(resolved.name, 'coding');
    assert.equal(resolved.config.model, 'profile-coding-model');
    assert.equal(resolved.config.temperature, 0.1);
    assert.equal(resolved.config.systemPrompt, 'You are an expert coder.');
    assert.equal(resolved.sources.profileConfigPath, profilePath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 6: Missing profile name in profile directory throws ProfileNotFoundError', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-profile-test-'));
  try {
    const profileDir = join(tmpDir, 'profiles');
    mkdirSync(profileDir);

    const resolver = new ProfileResolver();
    assert.throws(
      () => resolver.resolve({ profileDir, profileName: 'nonexistent' }),
      (err: any) => {
        assert.ok(err instanceof ProfileNotFoundError);
        assert.equal(err.profileName, 'nonexistent');
        return true;
      }
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 7: CWD auto-detection finds .harness.toml in project directory (Layer 4)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-profile-test-'));
  try {
    const projectConfigPath = join(tmpDir, '.harness.toml');
    writeFileSync(projectConfigPath, `model = "project-model"\nmaxSteps = 50`);

    const found = findProjectConfig(tmpDir);
    assert.equal(found, projectConfigPath);

    const resolver = new ProfileResolver();
    const resolved = resolver.resolve({ projectDir: tmpDir });

    assert.equal(resolved.config.model, 'project-model');
    assert.equal(resolved.config.maxSteps, 50);
    assert.equal(resolved.sources.projectConfigPath, projectConfigPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 8: CWD auto-detection searches parent directories until finding .harness.toml', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-profile-test-'));
  try {
    const subDir = join(tmpDir, 'nested', 'deep', 'subfolder');
    mkdirSync(subDir, { recursive: true });

    const projectConfigPath = join(tmpDir, '.harness.toml');
    writeFileSync(projectConfigPath, `model = "parent-project-model"`);

    const found = findProjectConfig(subDir);
    assert.equal(found, projectConfigPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 9: Explicit CLI overrides (Layer 5) override all previous layers', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-profile-test-'));
  try {
    const globalConfigPath = join(tmpDir, 'config.toml');
    writeFileSync(globalConfigPath, `model = "global-model"`);

    const profileDir = join(tmpDir, 'profiles');
    mkdirSync(profileDir);
    writeFileSync(join(profileDir, 'coding.toml'), `model = "profile-model"`);

    const projectDir = join(tmpDir, 'project');
    mkdirSync(projectDir);
    writeFileSync(join(projectDir, '.harness.toml'), `model = "project-model"`);

    const resolver = new ProfileResolver();
    const resolved = resolver.resolve({
      globalConfigPath,
      profileDir,
      profileName: 'coding',
      projectDir,
      overrides: {
        model: 'cli-override-model',
        maxSteps: 99,
      },
    });

    assert.equal(resolved.config.model, 'cli-override-model');
    assert.equal(resolved.config.maxSteps, 99);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 10: Deep merge rule merges env/settings objects key-by-key', () => {
  const layer1 = {
    env: { KEY_A: 'val1', KEY_B: 'val2' },
    settings: { featureA: true, inner: { a: 1, b: 2 } },
  };

  const layer2 = {
    env: { KEY_B: 'override_b', KEY_C: 'val3' },
    settings: { featureB: false, inner: { b: 20, c: 30 } },
  };

  const merged = deepMergeProfiles([layer1 as any, layer2 as any]);

  assert.deepEqual(merged.env, {
    KEY_A: 'val1',
    KEY_B: 'override_b',
    KEY_C: 'val3',
  });

  assert.deepEqual(merged.settings, {
    featureA: true,
    featureB: false,
    inner: { a: 1, b: 20, c: 30 },
  });
});

test('TEST 11: Array replacement rule overwrites allowedTools/deniedTools/plugins arrays entirely', () => {
  const layer1 = {
    allowedTools: ['toolA', 'toolB'],
    deniedTools: ['danger1'],
    plugins: ['pluginX'],
  };

  const layer2 = {
    allowedTools: ['toolC'],
    deniedTools: ['danger2'],
    plugins: ['pluginY', 'pluginZ'],
  };

  const merged = deepMergeProfiles([layer1, layer2]);

  assert.deepEqual(merged.allowedTools, ['toolC']);
  assert.deepEqual(merged.deniedTools, ['danger2']);
  assert.deepEqual(merged.plugins, ['pluginY', 'pluginZ']);
});

test('TEST 12: Validator enforces strict type limits and throws InvalidProfileError on invalid data', () => {
  assert.throws(
    () => validateProfileConfig({ maxSteps: -5 }),
    (err: any) => {
      assert.ok(err instanceof InvalidProfileError);
      assert.ok(err.validationErrors.some((e: string) => e.includes('maxSteps')));
      return true;
    }
  );

  assert.throws(
    () => validateProfileConfig({ temperature: 3.5 }),
    (err: any) => {
      assert.ok(err instanceof InvalidProfileError);
      assert.ok(err.validationErrors.some((e: string) => e.includes('temperature')));
      return true;
    }
  );

  assert.throws(
    () => validateProfileConfig({ allowedTools: 'not-an-array' }),
    (err: any) => {
      assert.ok(err instanceof InvalidProfileError);
      return true;
    }
  );
});

test('TEST 13: ProfileResolver.listProfiles returns available profile names in profileDir', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-profile-list-test-'));
  try {
    const profileDir = join(tmpDir, 'profiles');
    mkdirSync(profileDir);

    writeFileSync(join(profileDir, 'coding.toml'), 'name = "coding"');
    writeFileSync(join(profileDir, 'pentest.toml'), 'name = "pentest"');
    writeFileSync(join(profileDir, 'default.toml'), 'name = "default"');
    writeFileSync(join(profileDir, 'README.txt'), 'Not a profile');

    const resolver = new ProfileResolver();
    const profiles = resolver.listProfiles(profileDir);

    assert.equal(profiles.length, 3);
    assert.ok(profiles.includes('coding'));
    assert.ok(profiles.includes('pentest'));
    assert.ok(profiles.includes('default'));
    assert.equal(profiles.includes('README'), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 14: Profile package does not depend on Phase 7+ packages', () => {
  const pkgJsonPath = process.cwd().endsWith('packages/profile')
    ? join(process.cwd(), 'package.json')
    : join(process.cwd(), 'packages/profile/package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const deps = Object.keys(pkgJson.dependencies || {});
  const devDeps = Object.keys(pkgJson.devDependencies || {});
  const allDeps = [...deps, ...devDeps];

  const forbidden = [
    '@harness/context',
    '@harness/permissions',
    '@harness/mcp',
    '@harness/registry-client',
    '@harness/skills',
    '@harness/memory',
  ];
  for (const f of forbidden) {
    assert.equal(allDeps.includes(f), false, `Package must not depend on ${f}`);
  }
});
