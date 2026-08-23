import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface InputBoxProps {
  onSubmit: (text: string) => void;
  isDisabled: boolean;
}

export function InputBox({ onSubmit, isDisabled }: InputBoxProps) {
  const [text, setText] = useState('');

  useInput((input, key) => {
    if (isDisabled) return;
    
    if (key.return) {
      if (text.trim()) {
        onSubmit(text.trim());
        setText('');
      }
    } else if (key.backspace || key.delete) {
      setText(prev => prev.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta && !key.escape && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setText(prev => prev + input);
    }
  }, { isActive: !isDisabled });

  return (
    <Box flexDirection="row" borderStyle="single" borderColor={isDisabled ? "gray" : "white"} paddingX={1}>
      <Text color="cyan" bold>{'> '}</Text>
      {isDisabled ? (
        <Text color="gray" dimColor>Generating...</Text>
      ) : (
        <Text color="white">
          {text}
          <Text inverse>_</Text>
        </Text>
      )}
    </Box>
  );
}
