import React from 'react';
import { Box, Text } from 'ink';
import type { ToolEvent } from '../../runtime.js';

export interface StatusBarProps {
  status: string;
  toolEvents: ToolEvent[];
  error: string | null;
}

export function StatusBar({ status, toolEvents, error }: StatusBarProps) {
  const displayEvents = toolEvents.slice(-3); // Show last 3 events
  
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1} minHeight={4}>
      <Box marginBottom={1}>
        <Text dimColor>Status: </Text>
        <Text color={status === 'error' ? 'red' : status === 'running' ? 'yellow' : 'green'}>
          {status.toUpperCase()}
        </Text>
      </Box>
      
      {error && (
        <Box marginBottom={1}>
          <Text color="red" bold>Error: </Text>
          <Text color="red">{error}</Text>
        </Box>
      )}
      
      {displayEvents.map((evt, idx) => (
        <Box key={idx} flexDirection="row">
          <Text color="magenta" dimColor>{'🛠  '}</Text>
          <Text color={evt.type === 'tool_error' ? 'red' : evt.type === 'tool_completed' ? 'green' : 'yellow'}>
            {evt.toolName}
          </Text>
          <Text dimColor>
            {evt.type === 'tool_started' ? ' (started)' : evt.type === 'tool_completed' ? ` (completed in ${evt.durationMs}ms)` : ' (error)'}
          </Text>
        </Box>
      ))}
      {displayEvents.length === 0 && !error && (
        <Box>
          <Text dimColor italic>No recent tool activity</Text>
        </Box>
      )}
    </Box>
  );
}
