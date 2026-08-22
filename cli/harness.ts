#!/usr/bin/env node
/**
 * Harness CLI Entrypoint Placeholder
 * Phase 0 scaffolding — no commands implemented.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

if (args[0] === 'mcp' && args[1] === 'list') {
  const configPath = path.join(process.cwd(), 'config', 'mcp.json');
  if (fs.existsSync(configPath)) {
    console.log("Configured MCP Servers:");
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      for (const srv of config.servers || []) {
        console.log(`- ${srv.name} (command: ${srv.command})`);
      }
    } catch (err) {
      console.error("Failed to parse config/mcp.json:", err);
    }
  } else {
    console.log("No MCP servers configured locally (config/mcp.json missing).");
  }
  process.exit(0);
}

console.log("Phase 0 scaffolding — no commands implemented.");
