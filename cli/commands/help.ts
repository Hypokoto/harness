import { ExitCode } from '../exit-codes.js';
import { output } from '../formatter.js';

export async function helpCommand(): Promise<number> {
  const helpText = `Harness AI Agent Runtime

Usage: harness [command] [options]

Commands:
  run              Start an interactive session (default)
  init             Initialize a harness project
  use <profile>    Set the active profile
  list             List profiles, plugins, and skills
  install <name>   Install a package from the registry
  doctor           Check system health
  plugins          List installed plugins
  skills           List available skills
  help             Show this help message

Options:
  --profile <name>      Use a specific profile
  --model <name>        Override model name
  --provider <name>     Override model provider
  --session <id>        Resume a session
  --non-interactive     Run without TUI
  --json                Output as JSON
  --version             Show version
  --help                Show help`;

  output(helpText);
  return ExitCode.SUCCESS;
}
