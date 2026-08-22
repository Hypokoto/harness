import type { SkillIndexEntry, Skill } from './types.js';
import { loadSkill } from './loader.js';

export interface SkillRegistryOptions {
  disabledSkills?: string[];
}

export class SkillRegistry {
  private skills = new Map<string, SkillIndexEntry>();
  private disabledSkills: Set<string>;

  constructor(options: SkillRegistryOptions = {}) {
    this.disabledSkills = new Set(options.disabledSkills || []);
  }

  public async registerFromDirectory(dir: string): Promise<void> {
    const loaded = await loadSkill(dir);
    const entry: SkillIndexEntry = {
      name: loaded.metadata.name,
      version: loaded.metadata.version,
      description: loaded.metadata.description || '',
      tags: loaded.metadata.tags || [],
      path: dir
    };
    
    // Deterministic duplicate handling:
    // If we already have a skill with this name, we just overwrite it for now, 
    // or compare versions if we want to be fancy. We will overwrite.
    this.skills.set(entry.name, entry);
  }

  public search(query: string, limit: number = 5): SkillIndexEntry[] {
    const results = Array.from(this.skills.values())
      .filter(skill => !this.disabledSkills.has(skill.name))
      .map(skill => {
        let score = 0;
        const q = query.toLowerCase();
        const name = skill.name.toLowerCase();
        const desc = skill.description.toLowerCase();
        
        if (name === q) score += 100;
        else if (name.startsWith(q)) score += 50;
        else if (name.includes(q)) score += 20;
        else if (desc.includes(q)) score += 10;
        else if (skill.tags.some(t => t.toLowerCase().includes(q))) score += 5;
        
        return { skill, score };
      })
      .filter(r => r.score > 0);
    
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.skill.name.localeCompare(b.skill.name); // deterministic tiebreaker
    });
    
    return results.slice(0, limit).map(r => r.skill);
  }

  public getIndex(): SkillIndexEntry[] {
    return Array.from(this.skills.values()).filter(skill => !this.disabledSkills.has(skill.name));
  }

  public async getSkill(name: string): Promise<Skill | undefined> {
    if (this.disabledSkills.has(name)) return undefined;
    const entry = this.skills.get(name);
    if (!entry) return undefined;
    return loadSkill(entry.path);
  }
  
  public removeSkill(name: string): void {
    this.skills.delete(name);
  }
}
