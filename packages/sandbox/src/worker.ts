import { runInNewContext } from 'node:vm';

process.on('message', (msg: any) => {
  if (!msg || typeof msg.script !== 'string') return;

  try {
    const sandbox = { 
      console: { log: () => {} },
      setTimeout, 
      clearTimeout 
    };
    const result = runInNewContext(msg.script, sandbox);
    
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
