#!/usr/bin/env node
/**
 * Harness CLI Entrypoint Placeholder
 * Phase 0 scaffolding — Phase 10 install implemented.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Using dynamic imports for modules that might not be built in earlier phases,
// or we just import them and rely on tsx. Since it's Phase 10, these exist.
import { RegistryClient, Installer, LockfileManager } from '../packages/registry-client/dist/index.js';
import { McpServerManager } from '../packages/mcp/dist/index.js';

const args = process.argv.slice(2);
const cwd = process.cwd();

async function runMcpList() {
  const configPath = path.join(cwd, 'config', 'mcp.json');
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
}

async function runInstall(pkgRef: string) {
  let name = pkgRef;
  let requestedVersion: string | undefined = undefined;
  
  if (pkgRef.includes('@')) {
    const parts = pkgRef.split('@');
    name = parts[0];
    requestedVersion = parts[1];
  }

  // Determine registry URL
  let registryUrl = 'file://' + path.join(cwd, 'test-fixtures', 'registry'); // Default for tests
  const configTomlPath = path.join(cwd, 'config', 'config.toml');
  if (fs.existsSync(configTomlPath)) {
    const toml = fs.readFileSync(configTomlPath, 'utf8');
    const match = toml.match(/url\s*=\s*"([^"]+)"/);
    if (match) {
      registryUrl = match[1];
    }
  }

  const client = new RegistryClient(registryUrl);
  const installDir = path.join(cwd, 'config', 'installed');
  const lockfilePath = path.join(installDir, 'lock.json');
  
  const installer = new Installer({ installDir });
  const lockfileManager = new LockfileManager(lockfilePath);

  try {
    console.log(`Resolving package...`);
    const resolvedVersion = await client.resolvePackage(name, requestedVersion);
    console.log(`Resolved version ${resolvedVersion}`);

    // Check if already installed
    const existing = await lockfileManager.getPackage(name);
    if (existing && existing.version === resolvedVersion) {
      console.log(`${name}@${resolvedVersion} is already installed.`);
      process.exit(0);
    }

    console.log(`Fetching manifest...`);
    const manifest = await client.fetchManifest(name, resolvedVersion);

    console.log(`Fetching artifact...`);
    const artifactBuffer = await client.fetchArtifact(manifest.artifact.url);

    console.log(`Verifying checksum and installing...`);
    const lockPackage = await installer.install(manifest, artifactBuffer, registryUrl);

    await lockfileManager.addPackage(lockPackage);

    console.log(`Capabilities requested:`);
    for (const cap of lockPackage.requestedCapabilities || []) {
      console.log(`- ${cap}`);
    }

    console.log(`\nInstalled successfully.`);
  } catch (err: any) {
    console.error(`Installation failed: ${err.message}`);
    process.exit(1);
  }
}

async function run() {
  if (args[0] === 'mcp' && args[1] === 'list') {
    await runMcpList();
    process.exit(0);
  }

  if (args[0] === 'install') {
    if (!args[1]) {
      console.error('Usage: harness install <package>');
      process.exit(1);
    }
    await runInstall(args[1]);
    process.exit(0);
  }

  // Mock `harness run` starting MCP server from installed packages
  if (args[0] === 'run') {
    console.log('Starting runtime...');
    const lockfilePath = path.join(cwd, 'config', 'installed', 'lock.json');
    if (fs.existsSync(lockfilePath)) {
      const { ToolRegistry } = await import('../packages/tools/dist/index.js');
      const { ContextComposer } = await import('../packages/context/dist/index.js');
      const { PermissionPolicy } = await import('../packages/permissions/dist/index.js');
      
      const { SkillRegistry, SkillProvider } = await import('../packages/skills/dist/index.js');
      
      const manager = new McpServerManager();
      const registry = new ToolRegistry();
      const skillRegistry = new SkillRegistry();
      
      const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
      for (const pkg of Object.values<any>(lockfile.packages)) {
        if (pkg.type === 'mcp') {
          console.log(`Initializing MCP package: ${pkg.name}`);
          const manifestPath = path.join(pkg.installedPath, 'manifest.json');
          const manifest = fs.existsSync(manifestPath) 
            ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) 
            : null;
            
          const cmd = manifest?.mcp?.command || 'node';
          const cmdArgs = manifest?.mcp?.args || [];
          
          try {
            await manager.initializeServer({
              name: pkg.name,
              command: cmd,
              args: cmdArgs.map((a: string) => path.join(pkg.installedPath, a))
            }, registry);
            console.log(`Successfully initialized ${pkg.name}`);
          } catch (e: any) {
            console.warn(`Failed to initialize MCP package (expected if using dummy server): ${e.message}`);
          }
        } else if (pkg.type === 'skill') {
          console.log(`Initializing Skill package: ${pkg.name}`);
          try {
            await skillRegistry.registerFromDirectory(pkg.installedPath);
            console.log(`Successfully registered skill ${pkg.name}`);
          } catch (e: any) {
            console.warn(`Failed to register skill ${pkg.name}: ${e.message}`);
          }
        }
      }
      
      const skillProvider = new SkillProvider(skillRegistry);
      const composer = new ContextComposer({
        providers: [skillProvider]
      });
      
      // The skills themselves belong to the context system, but the search/load tools
      // must be registered in the ToolRegistry so the AgentLoop can execute them.
      for (const tool of skillProvider.getTools()) {
        registry.register(tool);
      }
      
      console.log('Registered Tools:', registry.list().map((t: any) => t.name));
      const composedContext = await composer.compose();
      console.log('Composed Context active tools:', composedContext.activeTools.map(t => t.name));
      await manager.closeAll();
    }
    process.exit(0);
  }

  console.log("Phase 0 scaffolding — no commands implemented.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
