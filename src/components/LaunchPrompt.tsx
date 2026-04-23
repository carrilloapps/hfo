import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { InstalledModel } from './Processor.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';

interface Props {
  installed: InstalledModel[];
  onChoose: (tag: string | null) => void;
}

export default function LaunchPrompt({ installed, onChoose }: Props) {
  const sorted = [...installed].sort((a, b) => b.score - a.score);
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(sorted.length - 1, c + 1));
    else if (key.return) onChoose(sorted[cursor].tag);
    else if (input === 'n' || input === 'N' || key.escape) onChoose(null);
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{icon.play} {t('launchPrompt.title')}</Text>
      <Text color="gray">{t('launchPrompt.hint', { up: icon.arrowUp, down: icon.arrowDown })}</Text>
      <Box flexDirection="column" marginTop={1}>
        {sorted.map((m, i) => (
          <Text key={m.tag} color={i === cursor ? 'cyan' : undefined} bold={i === cursor}>
            {i === cursor ? '❯ ' : '  '}
            {m.tag} <Text color="gray">· score {m.score}/100 · {m.quant}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
