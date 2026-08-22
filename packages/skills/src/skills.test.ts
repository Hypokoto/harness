import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { loadSkill } from './loader.js';
import { SkillRegistry } from './registry.js';
import { SkillProvider } from './provider.js';

describe('Skills Engine (Phase 11)', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-skills-test-'));
    
    // Create a mock skill directory
    const skill1Dir = path.join(tmpDir, 'git-expert');
    await fs.mkdir(skill1Dir, { recursive: true });
    
    await fs.writeFile(path.join(skill1Dir, 'manifest.json'), JSON.stringify({
      name: 'git-expert',
      version: '1.0.0',
      type: 'skill',
      description: 'Provides git workflows',
      entry: 'SKILL.md'
    }));

    await fs.writeFile(path.join(skill1Dir, 'SKILL.md'), `---
tags: git, vcs
category: devtools
---
# Git Expert
You are a git expert. Use \`git status\` often.
`);

    // Create a malicious skill with path traversal
    const badSkillDir = path.join(tmpDir, 'bad-skill');
    await fs.mkdir(badSkillDir, { recursive: true });
    await fs.writeFile(path.join(badSkillDir, 'manifest.json'), JSON.stringify({
      name: 'bad-skill',
      version: '1.0.0',
      type: 'skill',
      entry: '../git-expert/SKILL.md'
    }));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Skill Loader', () => {
    it('loads a valid skill and parses frontmatter', async () => {
      const skillDir = path.join(tmpDir, 'git-expert');
      const skill = await loadSkill(skillDir);
      
      assert.equal(skill.metadata.name, 'git-expert');
      assert.equal(skill.metadata.version, '1.0.0');
      assert.equal(skill.metadata.description, 'Provides git workflows');
      assert.deepEqual(skill.metadata.tags, ['git', 'vcs']);
      assert.ok(skill.content.includes('You are a git expert.'));
      assert.ok(!skill.content.includes('tags: git')); // frontmatter removed
    });

    it('rejects path traversal in entry', async () => {
      const badSkillDir = path.join(tmpDir, 'bad-skill');
      await assert.rejects(
        async () => loadSkill(badSkillDir),
        /Entry path traverses outside skill directory/
      );
    });
  });

  describe('Skill Registry', () => {
    it('registers and searches skills deterministically', async () => {
      const registry = new SkillRegistry();
      await registry.registerFromDirectory(path.join(tmpDir, 'git-expert'));
      
      const results = registry.search('git');
      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'git-expert');
      
      const loaded = await registry.getSkill('git-expert');
      assert.equal(loaded?.metadata.name, 'git-expert');
    });
  });

  describe('Skill Provider', () => {
    it('exposes search_skills and load_skill tools', async () => {
      const registry = new SkillRegistry();
      await registry.registerFromDirectory(path.join(tmpDir, 'git-expert'));
      const provider = new SkillProvider(registry);
      
      const tools = provider.getTools();
      assert.equal(tools.length, 2);
      
      const searchTool = tools.find(t => t.name === 'search_skills')!;
      const result = await searchTool.execute({ query: 'git' }, {});
      const parsed = JSON.parse((result as any).content);
      
      assert.equal(parsed.found, 1);
      assert.equal(parsed.skills[0].name, 'git-expert');
      
      const loadTool = tools.find(t => t.name === 'load_skill')!;
      await loadTool.execute({ name: 'git-expert' }, {});
      
      const prompt = await provider.getSystemPrompt();
      assert.ok(prompt.includes('[Skill: git-expert@1.0.0]'));
      assert.ok(prompt.includes('You are a git expert.'));
    });
  });
});
