import { HarnessRuntime } from '../runtime.js';
import type { CliFlags } from '../config.js';
import { resolveConfig } from '../config.js';
import { ExitCode } from '../exit-codes.js';
import readline from 'node:readline';

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
  });
}

export async function runCommand(flags: CliFlags): Promise<number> {
  let config;
  try {
    config = resolveConfig(flags);
  } catch (err) {
    console.error('Failed to resolve config:', err);
    return ExitCode.CONFIG_ERROR;
  }
  
  const runtime = new HarnessRuntime({
    config,
    onTextDelta: (flags.nonInteractive && !flags.json) ? (text: string) => process.stdout.write(text) : undefined,
  });

  try {
    await runtime.boot();
  } catch (err) {
    console.error('Failed to boot runtime:', err);
    return ExitCode.GENERIC_ERROR;
  }

  let sigintCount = 0;
  let lastSigint = 0;

  const handleSigint = () => {
    const now = Date.now();
    if (now - lastSigint < 1000) {
      sigintCount++;
    } else {
      sigintCount = 1;
    }
    lastSigint = now;

    if (sigintCount === 1) {
      console.log('\nCancelling current request... (Press Ctrl+C again to force exit)');
      runtime.cancelCurrentRequest();
    } else {
      console.log('\nExiting...');
      runtime.shutdown().then(() => {
        process.exit(ExitCode.SUCCESS);
      });
    }
  };

  process.on('SIGINT', handleSigint);

  if (flags.nonInteractive) {
    const input = await readStdin();
    if (!input.trim()) {
      console.error('No input provided. Pipe text to stdin for non-interactive mode.');
      await runtime.shutdown();
      return ExitCode.GENERIC_ERROR;
    }
    
    try {
      const result = await runtime.runAgentStreaming(input.trim());
      if (!flags.json) {
        process.stdout.write('\n');
      }
      
      if (flags.json) {
        console.log(JSON.stringify({
          sessionId: result.sessionId,
          steps: result.steps,
          completed: result.completed,
          response: result.finalResponse?.text ?? '',
        }, null, 2));
      }
    } catch (err) {
      console.error('Runtime error:', err);
      await runtime.shutdown();
      return ExitCode.GENERIC_ERROR;
    }
    
    await runtime.shutdown();
    return ExitCode.SUCCESS;
  }

  // Interactive mode — TUI manages its own runtime instance
  await runtime.shutdown(); // Release headless runtime; TUI will create its own
  try {
    const { launchTui } = await import('../tui/app.js');
    await launchTui(config);
  } catch (err) {
    console.error('Failed to load TUI, falling back to readline mode:', err);
    await runReadlineMode(runtime);
  }

  await runtime.shutdown();
  process.removeListener('SIGINT', handleSigint);
  return ExitCode.SUCCESS;
}

async function runReadlineMode(runtime: HarnessRuntime): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log('Interactive Mode (Readline Fallback). Type "exit" to quit.');

  while (true) {
    const input = await question('> ');
    if (input.trim() === 'exit') break;
    if (!input.trim()) continue;

    try {
      await runtime.runAgentStreaming(input.trim());
      console.log();
    } catch (err) {
      console.error('Error running agent:', err);
    }
  }

  rl.close();
}
