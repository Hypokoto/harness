import type { CliFlags } from '../config.js';
import { ExitCode } from '../exit-codes.js';
import { outputResult, header, dimText } from '../formatter.js';

export async function skillsCommand(flags?: CliFlags): Promise<number> {
  const skills: string[] = [];

  outputResult(
    () => {
      const parts = [header('Available Skills'), '────────────────────'];
      if (skills.length === 0) {
        parts.push(dimText('  (none registered)'));
      } else {
        skills.forEach(s => parts.push(`  ${s}`));
      }
      return parts.join('\n');
    },
    { skills },
    { json: flags?.json }
  );

  return ExitCode.SUCCESS;
}
