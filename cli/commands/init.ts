import fs from 'node:fs';
import path from 'node:path';
import type { CliFlags } from '../config.js';
import { ExitCode } from '../exit-codes.js';
import { outputResult, success, dimText } from '../formatter.js';

export async function initCommand(flags?: CliFlags): Promise<number> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, '.harness.toml');
  const harnessDir = path.join(cwd, '.harness');
  const eventsDir = path.join(harnessDir, 'events');

  const result = {
    alreadyInitialized: false,
    created: [] as string[],
  };

  if (fs.existsSync(configPath) || fs.existsSync(harnessDir)) {
    result.alreadyInitialized = true;
    outputResult(
      () => dimText(`Project already initialized at ${cwd}`),
      result,
      { json: flags?.json }
    );
    return ExitCode.SUCCESS;
  }

  const tomlContent = `# Harness AI Agent Runtime Project Configuration

[model]
provider = "ollama"
name = "qwen2.5:0.5b"
`;

  fs.writeFileSync(configPath, tomlContent, 'utf-8');
  result.created.push('.harness.toml');

  fs.mkdirSync(harnessDir, { recursive: true });
  result.created.push('.harness/');

  fs.mkdirSync(eventsDir, { recursive: true });
  result.created.push('.harness/events/');

  outputResult(
    () => {
      return [
        success(`Initialized harness project in ${cwd}`),
        dimText('Created files:'),
        ...result.created.map(f => dimText(`  - ${f}`))
      ].join('\n');
    },
    result,
    { json: flags?.json }
  );

  return ExitCode.SUCCESS;
}
