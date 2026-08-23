/**
 * CLI Bootstrap
 *
 * Responsibilities (in order):
 *   1. Parse arguments
 *   2. Route to command
 *   3. Handle exit codes
 *   4. Handle uncaught errors
 *
 * This file is the application-level entry point.
 * It does NOT contain business logic.
 */

import { ExitCode } from './exit-codes.js';
import type { CliFlags } from './config.js';

// ── Argument Parsing ────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: CliFlags;
  raw: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node and script
  const flags: CliFlags = {};
  const positional: string[] = [];
  let command = 'run'; // default command

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Flags
    if (arg === '--profile' && args[i + 1]) {
      flags.profile = args[++i];
    } else if (arg === '--model' && args[i + 1]) {
      flags.model = args[++i];
    } else if (arg === '--provider' && args[i + 1]) {
      flags.provider = args[++i];
    } else if (arg === '--session' && args[i + 1]) {
      flags.session = args[++i];
    } else if (arg === '--project-dir' && args[i + 1]) {
      flags.projectDir = args[++i];
    } else if (arg === '--non-interactive' || arg === '-n') {
      flags.nonInteractive = true;
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--help' || arg === '-h') {
      command = 'help';
    } else if (arg === '--version' || arg === '-v') {
      command = 'version';
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }

    i++;
  }

  // First positional is the command (if recognized)
  if (positional.length > 0) {
    const recognized = [
      'run', 'init', 'use', 'list', 'install', 'update',
      'doctor', 'plugins', 'skills', 'help',
    ];
    if (recognized.includes(positional[0])) {
      command = positional.shift()!;
    }
  }

  return { command, positional, flags, raw: args };
}

// ── Command Router ──────────────────────────────────────────────────────────

async function routeCommand(parsed: ParsedArgs): Promise<number> {
  const { command, positional, flags } = parsed;

  switch (command) {
    case 'help': {
      const { helpCommand } = await import('./commands/help.js');
      return helpCommand();
    }

    case 'version': {
      const { readFileSync } = await import('node:fs');
      const { getInstallRoot } = await import('./paths.js');
      const path = await import('node:path');
      try {
        const pkg = JSON.parse(
          readFileSync(path.join(getInstallRoot(), 'package.json'), 'utf8')
        );
        console.log(`harness ${pkg.version || '0.0.0-dev'}`);
      } catch {
        console.log('harness 0.0.0-dev');
      }
      return ExitCode.SUCCESS;
    }

    case 'init': {
      const { initCommand } = await import('./commands/init.js');
      return initCommand(flags);
    }

    case 'use': {
      if (!positional[0]) {
        console.error('Usage: harness use <profile>');
        return ExitCode.VALIDATION_ERROR;
      }
      const { useCommand } = await import('./commands/use.js');
      return useCommand(positional[0], flags);
    }

    case 'list': {
      const { listCommand } = await import('./commands/list.js');
      return listCommand(flags);
    }

    case 'install': {
      if (!positional[0]) {
        console.error('Usage: harness install <package>');
        return ExitCode.VALIDATION_ERROR;
      }
      const { installCommand } = await import('./commands/install.js');
      return installCommand(positional[0], flags);
    }

    case 'doctor': {
      const { doctorCommand } = await import('./commands/doctor.js');
      return doctorCommand(flags);
    }

    case 'plugins': {
      const { pluginsCommand } = await import('./commands/plugins.js');
      return pluginsCommand(flags);
    }

    case 'skills': {
      const { skillsCommand } = await import('./commands/skills.js');
      return skillsCommand(flags);
    }

    case 'run':
    default: {
      const { runCommand } = await import('./commands/run.js');
      return runCommand(flags);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function main(): Promise<never> {
  // Global error handlers
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(ExitCode.GENERIC_ERROR);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error.message);
    process.exit(ExitCode.GENERIC_ERROR);
  });

  const parsed = parseArgs(process.argv);
  let exitCode: number;

  try {
    exitCode = await routeCommand(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);

    // Map known error types to exit codes
    if (message.includes('config') || message.includes('Config')) {
      exitCode = ExitCode.CONFIG_ERROR;
    } else if (message.includes('permission') || message.includes('Permission')) {
      exitCode = ExitCode.PERMISSION_DENIED;
    } else if (message.includes('unavailable') || message.includes('connect')) {
      exitCode = ExitCode.PROVIDER_UNAVAILABLE;
    } else {
      exitCode = ExitCode.GENERIC_ERROR;
    }
  }

  process.exit(exitCode);
}
