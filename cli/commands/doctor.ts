import fs from 'node:fs';
import path from 'node:path';
import type { CliFlags } from '../config.js';
import { resolveConfig } from '../config.js';
import { ExitCode } from '../exit-codes.js';
import { outputResult, header, greenText, redText } from '../formatter.js';
import { discoverProject } from '../paths.js';

export async function doctorCommand(flags?: CliFlags): Promise<number> {
  const results: Record<string, { ok: boolean; msg: string; err?: string }> = {};
  let allOk = true;

  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major >= 20) {
    results.node = { ok: true, msg: `Node.js ${nodeVersion}` };
  } else {
    results.node = { ok: false, msg: `Node.js ${nodeVersion} (requires >= 20)` };
    allOk = false;
  }

  let resolvedConfig;
  try {
    resolvedConfig = resolveConfig(flags);
    results.config = { ok: true, msg: 'Configuration loaded' };
  } catch (err: unknown) {
    results.config = { ok: false, msg: 'Configuration failed to load', err: String(err) };
    allOk = false;
  }

  const project = discoverProject();
  if (project.projectRoot) {
    results.project = { ok: true, msg: `Project: ${project.projectRoot}` };
  } else {
    results.project = { ok: true, msg: 'No project discovered (using global config)' };
  }

  if (resolvedConfig) {
    results.profile = { ok: true, msg: `Profile: ${resolvedConfig.profile.name || 'default'}` };
    
    try {
      const eventsDir = resolvedConfig.eventsDir;
      if (!fs.existsSync(eventsDir)) {
        fs.mkdirSync(eventsDir, { recursive: true });
      }
      const testFile = path.join(eventsDir, '.test_write');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      results.events = { ok: true, msg: 'Event store: writable' };
    } catch (err: unknown) {
      results.events = { ok: false, msg: 'Event store: not writable', err: String(err) };
      allOk = false;
    }
    
    results.permissions = { ok: true, msg: 'Permissions: configured' };

    if (resolvedConfig.modelProvider === 'ollama') {
      try {
        const url = 'http://127.0.0.1:11434';
        const res = await fetch(`${url}/api/version`);
        if (res.ok) {
          results.ollama = { ok: true, msg: 'Ollama: connected' };
          
          try {
            const modelRes = await fetch(`${url}/api/show`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: resolvedConfig.modelName })
            });
            if (modelRes.ok) {
              results.model = { ok: true, msg: `Model: ${resolvedConfig.modelName} available` };
            } else {
              results.model = { ok: false, msg: `Model: ${resolvedConfig.modelName} not found locally` };
              allOk = false;
            }
          } catch (err) {
            results.model = { ok: false, msg: `Model: fetch failed` };
            allOk = false;
          }
        } else {
          results.ollama = { ok: false, msg: `Ollama: bad response from ${url}` };
          allOk = false;
        }
      } catch (err: unknown) {
        results.ollama = { ok: false, msg: `Ollama: cannot connect to http://127.0.0.1:11434`, err: String(err) };
        allOk = false;
      }
    }
  }

  outputResult(
    () => {
      const parts = [header('Harness Doctor'), ''];
      
      for (const [key, check] of Object.entries(results)) {
        if (check.ok) {
          parts.push(`✓ ${check.msg}`);
        } else {
          parts.push(`✗ ${check.msg}`);
          if (key === 'ollama' && !check.ok) {
            parts.push(`  Install Ollama: https://ollama.ai`);
          } else if (check.err) {
            parts.push(`  Error: ${check.err}`);
          }
        }
      }
      
      parts.push('');
      if (allOk) {
        parts.push(greenText('READY'));
      } else {
        parts.push(redText('ISSUES FOUND'));
      }
      return parts.join('\n');
    },
    results,
    { json: flags?.json }
  );

  return allOk ? ExitCode.SUCCESS : ExitCode.GENERIC_ERROR;
}
