import type { ContextProvider } from '@harness/context';
import type { Tool } from '@harness/tools';
import type { SkillRegistry } from './registry.js';

export class SkillProvider implements ContextProvider {
  public readonly name = 'SkillProvider';
  private activeSkills = new Set<string>();
  
  constructor(private registry: SkillRegistry) {}

  public async getSystemPrompt(): Promise<string> {
    const prompts: string[] = [];
    for (const name of this.activeSkills) {
      const skill = await this.registry.getSkill(name);
      if (skill) {
        // Carry provenance as requested: skill:<name>@<version>
        prompts.push(`[Skill: ${skill.metadata.name}@${skill.metadata.version}]\n${skill.content}`);
      }
    }
    return prompts.join('\n\n');
  }

  public getTools(): Tool[] {
    return [
      {
        name: 'search_skills',
        description: 'Search available skills by query to find useful knowledge or instructions.',
        inputSchema: { 
          type: 'object', 
          properties: { 
            query: { type: 'string', description: 'Search query' } 
          }, 
          required: ['query'] 
        },
        execute: async (input: any) => {
          const results = this.registry.search(input.query);
          return {
            content: JSON.stringify({
              found: results.length,
              skills: results.map(r => ({
                name: r.name,
                version: r.version,
                description: r.description,
                tags: r.tags
              }))
            })
          };
        }
      },
      {
        name: 'load_skill',
        description: 'Load a skill into context. The skill content will be available in the next turn.',
        inputSchema: { 
          type: 'object', 
          properties: { 
            name: { type: 'string', description: 'Name of the skill to load' } 
          }, 
          required: ['name'] 
        },
        execute: async (input: any) => {
          const skill = await this.registry.getSkill(input.name);
          if (!skill) {
            return `Error: Skill not found: ${input.name}`;
          }
          this.activeSkills.add(input.name);
          return `Skill ${input.name} loaded into context. It will be available in the next turn's system prompt.`;
        }
      }
    ];
  }
}
