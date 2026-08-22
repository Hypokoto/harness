import { createContext, runInContext } from 'node:vm';

const pendingCalls = new Map<number, { resolve: Function, reject: Function }>();
let callId = 0;

process.on('message', (msg: any) => {
  if (msg.type === 'tool_result') {
    const p = pendingCalls.get(msg.id);
    if (p) {
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
      pendingCalls.delete(msg.id);
    }
    return;
  }

  if (!msg || typeof msg.script !== 'string') return;

  try {
    const sandbox = Object.create(null);
    sandbox.console = { log: () => {} };
    sandbox.setTimeout = setTimeout;
    sandbox.clearTimeout = clearTimeout;
    sandbox.callTool = (toolName: string, args: any) => {
      return new Promise((resolve, reject) => {
        const id = callId++;
        pendingCalls.set(id, { resolve, reject });
        process.send?.({ type: 'tool_call', id, toolName, args });
      });
    };
    const context = createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    const result = runInContext(msg.script, context);

    
    // Handle promises returned by the script
    if (result && typeof result.then === 'function') {
      result.then((res: any) => {
        process.send?.({ result: String(res) });
      }).catch((err: any) => {
        process.send?.({ error: String(err) });
      });
    } else {
      process.send?.({ result: String(result) });
    }
  } catch (err: any) {
    process.send?.({ error: String(err) });
  }
});
