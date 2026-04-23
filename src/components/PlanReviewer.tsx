import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { PlannedInstall } from '../core/plan.js';
import { formatBytes } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';

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
      <Text bold>{t('plan.title')}</Text>
      <Text color="gray">{t('plan.hint', { up: icon.arrowUp, down: icon.arrowDown })}</Text>

      <Box flexDirection="column" marginTop={1}>
        {plans.map((p, idx) => {
          const isCursor = idx === cursor;
          const flags: string[] = [];
          if (p.tagExists) flags.push(`${icon.warning} ${t('plan.tagExists')}`);
          if (p.fileExistsBytes != null) {
            const matches = p.fileExistsBytes === p.quant.file.size;
            flags.push(matches
              ? `${icon.tick} ${t('plan.fileReuse', { size: formatBytes(p.fileExistsBytes) })}`
              : `${icon.warning} ${t('plan.fileResume', { have: formatBytes(p.fileExistsBytes), total: formatBytes(p.quant.file.size) })}`);
          }
          const actionLabel =
            p.action === 'skip'
              ? <Text color="gray">[{t('plan.action.skip')}]</Text>
              : p.action === 'overwrite'
                ? <Text color="yellow">[{t('plan.action.overwrite')}]</Text>
                : <Text color="green">[{t('plan.action.install')}]</Text>;

          return (
            <Box key={idx} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                  {isCursor ? '❯ ' : '  '}
                  {p.quant.quant.padEnd(8)}
                </Text>
                <Text> {actionLabel} </Text>
                <Text color="gray">· {formatBytes(p.quant.file.size)} · {t('plan.scoreSuffix', { score: p.quant.score })}</Text>
              </Box>
              <Box marginLeft={4}>
                <Text color="gray">{t('plan.tagLabel')}</Text>
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
          {t('plan.queued', { active: plans.filter((p) => p.action !== 'skip').length, total: plans.length })}
        </Text>
      </Box>
    </Box>
  );
}
