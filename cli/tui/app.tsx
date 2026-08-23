import React, { useState, useEffect } from 'react';
import { render, Box, useApp, useInput } from 'ink';
import type { ResolvedConfig } from '../config.js';
import { HarnessRuntime } from '../runtime.js';
import type { RuntimeInfo, ToolEvent } from '../runtime.js';

import { Header } from './components/header.js';
import { Conversation, type ConversationMessage } from './components/conversation.js';
import { InputBox } from './components/input-box.js';
import { StatusBar } from './components/status-bar.js';
import { PermissionPrompt } from './components/permission-prompt.js';

function App({ config }: { config: ResolvedConfig }) {
  const { exit } = useApp();
  const [runtime, setRuntime] = useState<HarnessRuntime | null>(null);
  
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'ready' | 'running' | 'error' | 'stopped'>('ready');
  
  const [permissionReq, setPermissionReq] = useState<any | null>(null);
  const [permissionResolver, setPermissionResolver] = useState<((decision: any) => void) | null>(null);

  useEffect(() => {
    let activeRuntime: HarnessRuntime | null = null;

    const init = async () => {
      try {
        const rt = new HarnessRuntime({
          config,
          onTextDelta: (text: string) => {
            setStreamingText(prev => prev + text);
          },
          onToolEvent: (event: ToolEvent) => {
            setToolEvents(prev => [...prev, event]);
          },
          onPermissionRequest: (req: any) => {
            return new Promise((resolve) => {
              setPermissionReq(req);
              setPermissionResolver(() => resolve);
            });
          },
          onEvent: () => {}
        });
        
        await rt.boot();
        activeRuntime = rt;
        setRuntime(rt);
        setInfo(rt.getInfo());
        setStatus(rt.getInfo().status);
      } catch (err: any) {
        setError(err.message);
        setStatus('error');
      }
    };

    init();

    return () => {
      if (activeRuntime) {
        activeRuntime.shutdown().catch(console.error);
      }
    };
  }, [config]);

  const [cancelCount, setCancelCount] = useState(0);
  
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status === 'running') {
        runtime?.cancelCurrentRequest();
        setStatus('ready');
        setStreamingText('');
        setCancelCount(0);
      } else {
        if (cancelCount === 0) {
          setCancelCount(1);
          setTimeout(() => setCancelCount(0), 1000);
        } else {
          exit();
        }
      }
    } else if (key.ctrl && input === 'd') {
      exit();
    }
  });

  const handleSubmit = async (text: string) => {
    if (!runtime || status === 'running') return;
    
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setStatus('running');
    setStreamingText('');
    setError(null);
    setInfo(runtime.getInfo());

    try {
      const result = await runtime.runAgentStreaming(text);
      setMessages(prev => [
        ...prev, 
        { role: 'assistant', content: result?.finalResponse?.text || streamingText || 'Done.' }
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStatus('ready');
      setStreamingText('');
      setInfo(runtime.getInfo());
    }
  };

  const handlePermissionDecision = (decision: 'allow' | 'deny' | 'session') => {
    if (permissionResolver) {
      permissionResolver(decision);
      setPermissionReq(null);
      setPermissionResolver(null);
    }
  };

  return (
    <Box flexDirection="column" height="100%" minHeight={20}>
      <Header 
        info={info} 
        project={config.project?.projectDir || null} 
      />
      
      <Conversation 
        messages={messages} 
        streamingText={streamingText} 
      />
      
      <StatusBar 
        status={status} 
        toolEvents={toolEvents} 
        error={error} 
      />
      
      {permissionReq ? (
        <PermissionPrompt 
          request={permissionReq} 
          onDecision={handlePermissionDecision} 
        />
      ) : (
        <InputBox 
          onSubmit={handleSubmit} 
          isDisabled={status === 'running' || !runtime} 
        />
      )}
    </Box>
  );
}

export async function launchTui(config: ResolvedConfig): Promise<void> {
  const { waitUntilExit } = render(<App config={config} />);
  await waitUntilExit();
}
