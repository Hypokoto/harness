import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface PermissionPromptProps {
  request: { toolName: string; requiredCapabilities: string[] } | null;
  onDecision: (decision: 'allow' | 'deny' | 'session') => void;
}

export function PermissionPrompt({ request, onDecision }: PermissionPromptProps) {
  useInput((input, key) => {
    if (!request) return;
    
    const keyLower = input.toLowerCase();
    if (keyLower === 'a') {
      onDecision('allow');
    } else if (keyLower === 'd') {
      onDecision('deny');
    } else if (keyLower === 'r') {
      onDecision('session');
    }
  }, { isActive: !!request });

  if (!request) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="red" padding={1}>
      <Text color="red" bold>Permission Required</Text>
      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text dimColor>Tool: </Text>
          <Text>{request.toolName}</Text>
        </Box>
        <Box>
          <Text dimColor>Capabilities: </Text>
          <Text>{request.requiredCapabilities.join(', ')}</Text>
        </Box>
      </Box>
      <Box>
        <Text bold color="green">[A]</Text><Text> Allow  </Text>
        <Text bold color="red">[D]</Text><Text> Deny  </Text>
        <Text bold color="yellow">[R]</Text><Text> Allow for session</Text>
      </Box>
    </Box>
  );
}
