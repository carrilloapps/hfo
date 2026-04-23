import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { detectAvailableTargets, LAUNCH_TARGETS, type LaunchId } from '../core/launch.js';
import { icon } from '../ui/icons.js';
import type { Theme } from '../ui/theme.js';

export interface LaunchSelection {
  id: LaunchId;
  model: string | null;
  configOnly: boolean;
}

interface Props {
  theme: Theme;
  defaultModel: string | null;
  onConfirm: (sel: LaunchSelection) => void;
  onCancel: () => void;
}

type Mode =
  | { kind: 'probing' }
  | { kind: 'picking'; cursor: number; model: string; configOnly: boolean }
  | { kind: 'editing-model'; cursor: number; value: string; configOnly: boolean };

export default function LaunchMenu({ theme, defaultModel, onConfirm, onCancel }: Props) {
  const [available, setAvailable] = useState<Set<LaunchId> | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'probing' });

  useEffect(() => {
    (async () => {
      const ids = await detectAvailableTargets();
      setAvailable(new Set(ids));
      setMode({ kind: 'picking', cursor: 0, model: defaultModel ?? '', configOnly: false });
    })();
  }, []);

  useInput((input, key) => {
    if (mode.kind !== 'picking') return;
    if (key.upArrow || input === 'k') setMode({ ...mode, cursor: Math.max(0, mode.cursor - 1) });
    else if (key.downArrow || input === 'j') setMode({ ...mode, cursor: Math.min(LAUNCH_TARGETS.length - 1, mode.cursor + 1) });
    else if (input === 'm' || input === 'M') setMode({ kind: 'editing-model', cursor: mode.cursor, value: mode.model, configOnly: mode.configOnly });
    else if (input === 'c' || input === 'C') setMode({ ...mode, configOnly: !mode.configOnly });
    else if (key.escape) onCancel();
    else if (key.return) {
      const target = LAUNCH_TARGETS[mode.cursor];
      onConfirm({ id: target.id, model: mode.model.trim() || null, configOnly: mode.configOnly });
    }
  });

  if (mode.kind === 'probing') {
    return (
      <Box>
        <Text color={theme.primary as any}>
          <Spinner type="dots" /> Probing `ollama launch --help`...
        </Text>
      </Box>
    );
  }

  if (mode.kind === 'editing-model') {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.accent as any}>Model override</Text>
        <Text color={theme.muted as any}>
          Leave empty to let Ollama pick the default; type a registered tag (run Models tab to list).
        </Text>
        <Box marginTop={1}>
          <Text color={theme.primary as any}>--model </Text>
          <TextInput
            value={mode.value}
            onChange={(v) => setMode({ ...mode, value: v })}
            onSubmit={(v) => setMode({ kind: 'picking', cursor: mode.cursor, model: v, configOnly: mode.configOnly })}
          />
        </Box>
      </Box>
    );
  }

  const active = available ?? new Set<LaunchId>();

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.accent as any}>Launch an Ollama integration</Text>
        <Text color={theme.muted as any}>  ·  {LAUNCH_TARGETS.length} targets · {active.size} available locally</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor={theme.border as any} paddingX={1}>
        {LAUNCH_TARGETS.map((t, i) => {
          const isCursor = i === mode.cursor;
          const supported = active.has(t.id);
          return (
            <Box key={t.id} flexDirection="column">
              <Box>
                <Text color={isCursor ? (theme.accent as any) : undefined} bold={isCursor}>
                  {(isCursor ? `${icon.pointer} ` : '  ') + t.id.padEnd(10)}
                </Text>
                <Text color={theme.text as any}>{t.name.padEnd(18)}</Text>
                <Text color={supported ? (theme.success as any) : (theme.muted as any)}>
                  {supported ? `${icon.tick} available` : `${icon.cross} unsupported by this Ollama`}
                </Text>
              </Box>
              {isCursor && (
                <Box marginLeft={4}>
                  <Text color={theme.muted as any}>
                    {t.description}
                    {t.aliases && t.aliases.length > 0 ? ` · aliases: ${t.aliases.join(', ')}` : ''}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text color={theme.muted as any}>Model: </Text>
          <Text color={theme.primary as any}>{mode.model || '(Ollama default)'}</Text>
          <Text color={theme.muted as any}>    ·    Config-only: </Text>
          <Text color={mode.configOnly ? (theme.warning as any) : (theme.muted as any)}>
            {mode.configOnly ? `${icon.checkOn} yes (no auto-launch)` : `${icon.checkOff} no`}
          </Text>
        </Text>
        <Text color={theme.muted as any}>
          {icon.arrowUp}{icon.arrowDown} nav · M edit model · C toggle --config · Enter launch · Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
