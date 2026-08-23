import React from 'react';
import { Box, Text } from 'ink';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ConversationProps {
  messages: ConversationMessage[];
  streamingText: string;
}

export function Conversation({ messages, streamingText }: ConversationProps) {
  // Take last 20 messages to prevent overflowing buffer
  const displayMessages = messages.slice(-20);
  
  return (
    <Box flexDirection="column" flexGrow={1} paddingY={1} paddingX={1} borderStyle="single" borderColor="gray">
      {displayMessages.map((msg, idx) => (
        <Box key={idx} flexDirection="row" marginBottom={1}>
          {msg.role === 'user' ? (
            <Text color="white" bold>{'> '}</Text>
          ) : msg.role === 'system' ? (
            <Text color="gray" dimColor>{'⚙ '}</Text>
          ) : (
            <Text color="green" bold>{'● '}</Text>
          )}
          <Box flexDirection="column">
            <Text color={msg.role === 'user' ? 'white' : msg.role === 'system' ? 'gray' : 'green'}>
              {msg.content}
            </Text>
          </Box>
        </Box>
      ))}
      
      {streamingText && (
        <Box flexDirection="row" marginBottom={1}>
          <Text color="green" bold>{'● '}</Text>
          <Box flexDirection="column">
            <Text color="green">{streamingText}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
