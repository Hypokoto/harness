export type SandboxMessage =
  | { type: 'ready' }
  | { type: 'register_tool'; payload: { name: string; description: string; inputSchema: any; requiredCapabilities: string[] } }
  | { type: 'execute_tool'; id: string; payload: { name: string; input: any } }
  | { type: 'execute_tool_result'; id: string; result?: any; error?: string }
  | { type: 'error'; message: string };
