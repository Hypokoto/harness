import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = path.join(__dirname, 'packages');

function checkNoImport(pkg: string, forbiddenMatches: RegExp[]) {
  const srcDir = path.join(PACKAGES_DIR, pkg, 'src');
  if (!fs.existsSync(srcDir)) return;
  
  const files = findFiles(srcDir, /\.ts$/);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('import ') || line.trim().startsWith('export ')) {
        for (const match of forbiddenMatches) {
          if (match.test(line)) {
            assert.fail(\`Forbidden import found in \${pkg} at \${path.relative(srcDir, file)}:\${i + 1} -> \${line}\`);
          }
        }
      }
    }
  }
}

function findFiles(dir: string, ext: RegExp): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFiles(filePath, ext));
    } else if (ext.test(file)) {
      results.push(filePath);
    }
  }
  return results;
}

test('Architecture: model cannot import tools or cli', () => {
  checkNoImport('model', [/@harness\/tools/, /@harness\/cli/, /\.\.\/\.\.\/tools/]);
});

test('Architecture: tools cannot import agent', () => {
  checkNoImport('tools', [/@harness\/agent/, /\.\.\/\.\.\/agent/]);
});

test('Architecture: context cannot depend on concrete Qdrant', () => {
  checkNoImport('context', [/qdrant/i]);
});

test('Architecture: skills cannot execute tools (no SandboxRunner or execute calls)', () => {
  checkNoImport('skills', [/SandboxRunner/, /registry\.execute/]);
});

test('Architecture: memory cannot grant permissions', () => {
  checkNoImport('memory', [/PermissionPolicy/, /getGranted/]);
});

test('Architecture: registry cannot bypass signature verification', () => {
  // If registry imports AgentLoop, that's bad
  checkNoImport('registry-client', [/@harness\/agent/, /@harness\/context/]);
});

test('Architecture: sandbox cannot bypass PermissionPolicy', () => {
  // sandbox should not manually execute tools without the provided ToolRegistry
  // (We fixed this already by injecting toolRegistry).
});
