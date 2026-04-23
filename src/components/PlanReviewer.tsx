import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { PlannedInstall } from '../core/plan.js';
import { formatBytes } from '../ui/format.js';
import { icon } from '../ui/icons.js';

interface Props {
  initialPlans: PlannedInstall[];
  existingTags: Set<string>;
  onConfirm: (plans: PlannedInstall[]) => void;
  onCancel: () => void;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'edit-tag'; idx: number; value: string };

export default function PlanReviewer({ initialPlans, existingTags, onConfirm, onCancel }: Props) {
  const [plans, setPlans] = useState<PlannedInstall[]>(initialPlans);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const applyTag = (idx: number, newTag: string) => {
    const t = newTag.trim();
    if (!t) return;
    setPlans((ps) =>
      ps.map((p, i) =>
        i === idx
          ? {
              ...p,
              tag: t,
              tagExists: existingTags.has(t),
              action: p.action === 'skip' ? 'skip' : existingTags.has(t) ? 'overwrite' : 'install',
            }
          : p,
      ),
    );
  };

  const cycleAction = (idx: number) => {
    setPlans((ps) =>
      ps.map((p, i) => {
        if (i !== idx) return p;
        const next: PlannedInstall['action'] =
          p.action === 'install' ? 'skip' : p.action === 'skip' ? (p.tagExists ? 'overwrite' : 'install') : 'install';
        return { ...p, action: next };
      }),
    );
  };

  useInput((input, key) => {
    if (mode.kind === 'edit-tag') return;
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(plans.length - 1, c + 1));
    else if (input === 'e' || input === 'E') {
      setMode({ kind: 'edit-tag', idx: cursor, value: plans[cursor].tag });
    } else if (input === 't' || input === 'T') {
      cycleAction(cursor);
    } else if (input === 'o' || input === 'O') {
      setPlans((ps) => ps.map((p, i) => (i === cursor ? { ...p, action: 'overwrite' } : p)));
    } else if (input === 's' || input === 'S') {
      setPlans((ps) => ps.map((p, i) => (i === cursor ? { ...p, action: 'skip' } : p)));
    } else if (input === 'r' || input === 'R') {
      setMode({ kind: 'edit-tag', idx: cursor, value: plans[cursor].tag });
    } else if (input === 'a' || input === 'A' || key.return) {
      const actionable = plans.filter((p) => p.action !== 'skip');
      if (actionable.length > 0) onConfirm(plans);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Review &amp; customize installs</Text>
      <Text color="gray">↑↓ nav · E/R edit name · T cycle action · O overwrite · S skip · Enter/A apply · Esc cancel</Text>

      <Box flexDirection="column" marginTop={1}>
        {plans.map((p, idx) => {
          const isCursor = idx === cursor;
          const flags: string[] = [];
          if (p.tagExists) flags.push(`${icon.warning} tag already in Ollama`);
          if (p.fileExistsBytes != null) {
            const matches = p.fileExistsBytes === p.quant.file.size;
            flags.push(matches
              ? `${icon.tick} file on disk (${formatBytes(p.fileExistsBytes)}) — will reuse`
              : `${icon.warning} partial file (${formatBytes(p.fileExistsBytes)}/${formatBytes(p.quant.file.size)}) — will resume`);
          }
          const actionLabel =
            p.action === 'skip'
              ? <Text color="gray">[SKIP]</Text>
              : p.action === 'overwrite'
                ? <Text color="yellow">[OVERWRITE]</Text>
                : <Text color="green">[INSTALL]</Text>;

          return (
            <Box key={idx} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                  {isCursor ? '❯ ' : '  '}
                  {p.quant.quant.padEnd(8)}
                </Text>
                <Text> {actionLabel} </Text>
                <Text color="gray">· {formatBytes(p.quant.file.size)} · score {p.quant.score}/100</Text>
              </Box>
              <Box marginLeft={4}>
                <Text color="gray">tag:</Text>
                <Text> </Text>
                {mode.kind === 'edit-tag' && mode.idx === idx ? (
                  <TextInput
                    value={mode.value}
                    onChange={(v) => setMode({ kind: 'edit-tag', idx, value: v })}
                    onSubmit={(v) => {
                      applyTag(idx, v);
                      setMode({ kind: 'list' });
                    }}
                  />
                ) : (
                  <Text color={p.tagExists ? 'yellow' : 'cyan'}>{p.tag}</Text>
                )}
              </Box>
              {flags.length > 0 && (
                <Box marginLeft={4} flexDirection="column">
                  {flags.map((f) => (
                    <Text key={f} color={f.startsWith(icon.warning) ? 'yellow' : 'green'}>  {f}</Text>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">
          {plans.filter((p) => p.action !== 'skip').length} / {plans.length} queued — press Enter to proceed
        </Text>
      </Box>
    </Box>
  );
}
