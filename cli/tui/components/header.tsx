import React from 'react';
import { Box, Text } from 'ink';
import type { RuntimeInfo } from '../../runtime.js';

export interface HeaderProps {
  info: RuntimeInfo | null;
  project: string | null;
}

export function Header({ info, project }: HeaderProps) {
  const profile = info?.profile || 'unknown';
  const model = info?.model || 'unknown';
  const status = info?.status ? info.status.toUpperCase() : 'UNKNOWN';
  
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="blue" bold> HARNESS </Text>
        <Box>
          <Text dimColor>profile: </Text>
          <Text color="cyan">{profile}  </Text>
          <Text dimColor>model: </Text>
          <Text color="cyan">{model}  </Text>
          <Text dimColor>status: </Text>
          <Text color={status === 'ERROR' ? 'red' : status === 'RUNNING' ? 'yellow' : 'green'}>
            {status}
          </Text>
        </Box>
      </Box>
      {project && (
        <Box>
          <Text dimColor>project: </Text>
          <Text color="gray">{project}</Text>
        </Box>
      )}
    </Box>
  );
}
