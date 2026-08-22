export interface SkillMetadata {
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  category?: string;
  author?: string;
}

export interface SkillManifest extends SkillMetadata {
  type: 'skill';
  entry?: string; // default SKILL.md
}

export interface Skill {
  metadata: SkillMetadata;
  content: string; // The markdown content
}

export interface SkillIndexEntry {
  name: string;
  version: string;
  description: string;
  tags: string[];
  path: string;
}
