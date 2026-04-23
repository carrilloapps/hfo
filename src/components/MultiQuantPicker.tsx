import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { QuantScore } from '../core/scoring.js';
import { scoreColor } from '../core/scoring.js';
import { formatBytes } from '../ui/format.js';
import { describeQuant } from '../core/describe.js';
import { icon } from '../ui/icons.js';

interface Props {
  items: QuantScore[];           // already sorted desc by score
  onConfirm: (selected: QuantScore[]) => void;
}

export default function MultiQuantPicker({ items, onConfirm }: Props) {
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set([items[0]?.file.path].filter(Boolean) as string[]));

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (input === ' ') {
      const path = items[cursor].file.path;
      setPicked((s) => {
        const n = new Set(s);
        if (n.has(path)) n.delete(path); else n.add(path);
        return n;
      });
    } else if (input === 'a') {
      // toggle all
      setPicked((s) =>
        s.size === items.length ? new Set() : new Set(items.map((i) => i.file.path)),
      );
    } else if (key.return) {
      const selected = items.filter((i) => picked.has(i.file.path));
      if (selected.length > 0) onConfirm(selected);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Quants (sorted by compatibility — highest first)</Text>
      <Text color="gray">space: toggle · a: toggle all · ↑↓: move · enter: confirm selection</Text>
      <Box flexDirection="column" marginTop={1}>
        {items.map((item, idx) => {
          const isCursor = idx === cursor;
          const isPicked = picked.has(item.file.path);
          const checkbox = isPicked ? icon.checkOn : icon.checkOff;
          const desc = describeQuant(item.quant);
          return (
            <Box key={item.file.path} flexDirection="column">
              <Box>
                <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                  {isCursor ? `${icon.pointer} ` : '  '}
                  {checkbox} {item.quant.padEnd(8)}
                </Text>
                <Text color={scoreColor(item.score)}>
                  {' '}{String(item.score).padStart(3)}%
                </Text>
                <Text color="gray">
                  {' '}· {formatBytes(item.file.size).padStart(8)} · {item.label}
                  {item.note ? ` · ${item.note}` : ''}
                </Text>
              </Box>
              <Box marginLeft={6}>
                <Text color="gray">
                  {desc.summary}{' '}
                  <Text color="gray">
                    · quality: <Text color={desc.quality === 'near-lossless' ? 'green' : desc.quality === 'high' ? 'green' : desc.quality === 'medium' ? 'yellow' : 'red'}>{desc.quality}</Text>
                  </Text>
                  <Text color="gray">
                    {' '}· speed: <Text color="cyan">{desc.relativeSpeed}</Text>
                  </Text>
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">
          {picked.size === 0
            ? '(no variants selected — pick at least one)'
            : `${picked.size} variant${picked.size > 1 ? 's' : ''} queued — press Enter to proceed`}
        </Text>
      </Box>
    </Box>
  );
}
