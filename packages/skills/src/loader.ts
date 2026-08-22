import fs from 'node:fs/promises';
import path from 'node:path';
import type { Skill, SkillManifest } from './types.js';

export const MAX_SKILL_SIZE = 10 * 1024 * 1024; // 10MB

export async function loadSkill(skillDir: string): Promise<Skill> {
  const manifestPath = path.join(skillDir, 'manifest.json');
  let manifestText: string;
  try {
    manifestText = await fs.readFile(manifestPath, 'utf8');
  } catch (err: any) {
    throw new Error(`Failed to read manifest.json in ${skillDir}: ${err.message}`);
  }

  let manifest: SkillManifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err: any) {
    throw new Error(`Invalid manifest.json in ${skillDir}`);
  }

  if (manifest.type !== 'skill') {
    throw new Error(`Package is not a skill: type is ${manifest.type}`);
  }

  if (!manifest.name || !manifest.version) {
    throw new Error(`Manifest missing name or version in ${skillDir}`);
  }

  const entry = manifest.entry || 'SKILL.md';
  const resolvedDir = path.resolve(skillDir);
  const entryPath = path.resolve(skillDir, entry);

  if (!entryPath.startsWith(resolvedDir + path.sep)) {
    throw new Error(`Entry path traverses outside skill directory: ${entry}`);
  }

  let stat;
  try {
    stat = await fs.stat(entryPath);
  } catch (err: any) {
    throw new Error(`Missing skill entry: ${entry}`);
  }

  if (stat.size > MAX_SKILL_SIZE) {
    throw new Error(`Skill entry exceeds maximum size limit of ${MAX_SKILL_SIZE} bytes`);
  }

  let content: string;
  try {
    content = await fs.readFile(entryPath, 'utf8');
  } catch (err: any) {
    throw new Error(`Failed to read skill entry: ${err.message}`);
  }

  // Parse frontmatter
  let metadata = { ...manifest };
  if (content.startsWith('---')) {
    let endIdx = content.indexOf('\n---', 3);
    let actualEnd = endIdx;
    let newlineLen = 4;
    
    if (endIdx === -1) {
      endIdx = content.indexOf('\r\n---', 3);
      if (endIdx !== -1) {
        actualEnd = endIdx;
        newlineLen = 5;
      }
    }
    
    if (actualEnd !== -1) {
      const fmText = content.substring(3, actualEnd).trim();
      const fmData: any = {};
      for (const line of fmText.split('\n')) {
        const colon = line.indexOf(':');
        if (colon !== -1) {
          const key = line.substring(0, colon).trim();
          const val = line.substring(colon + 1).trim();
          fmData[key] = val;
        }
      }
      // Check for conflicts
      if (fmData.name && fmData.name !== manifest.name) {
        throw new Error(`Frontmatter name conflicts with manifest name`);
      }
      if (fmData.version && fmData.version !== manifest.version) {
        throw new Error(`Frontmatter version conflicts with manifest version`);
      }
      if (fmData.type && fmData.type !== 'skill') {
        throw new Error(`Frontmatter type conflicts with manifest type`);
      }
      
      // Update metadata with non-conflicting frontmatter
      if (fmData.description && !metadata.description) metadata.description = fmData.description;
      if (fmData.tags) {
        metadata.tags = fmData.tags.split(',').map((s: string) => s.trim());
      }
      
      content = content.substring(actualEnd + newlineLen).trimStart();
    }
  }

  return {
    metadata,
    content
  };
}
