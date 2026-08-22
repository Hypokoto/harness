import readline from 'node:readline';
import fs from 'node:fs';

const log = fs.createWriteStream('mcp-debug.log', { flags: 'a' });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  log.write('IN: ' + line + '\n');
  try {
    const req = JSON.parse(line);
    let res = null;
    if (req.method === 'initialize') {
      res = {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "test-mcp", version: "1.0.0" }
        }
      };
    } else if (req.method === 'tools/list') {
      res = {
        jsonrpc: "2.0",
        id: req.id,
        result: { tools: [] }
      };
    } else if (req.method === 'notifications/initialized') {
      // do nothing
    } else {
      res = {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: "Method not found" }
      };
    }
    
    if (res) {
      const out = JSON.stringify(res);
      log.write('OUT: ' + out + '\n');
      console.log(out);
    }
  } catch (e) {
    log.write('ERR: ' + e + '\n');
  }
});
