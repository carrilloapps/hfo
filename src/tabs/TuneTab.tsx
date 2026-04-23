import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import type { HardwareProfile } from '../core/hardware.js';
import {
  buildEnvProfile,
  defaultEnvProfile,
  ENV_VAR_META,
  persistEnv,
  readCurrentEnv,
  restartOllama,
  type EnvKey,
  type EnvProfile,
  type PersistResult,
} from '../infra/ollama.js';
import { icon } from '../ui/icons.js';

interface Props {
  hw: HardwareProfile;
  onFlash: (msg: string) => void;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; key: EnvKey; value: string }
  | { kind: 'applying' }
  | { kind: 'restarting' }
  | { kind: 'applied'; results: PersistResult[] };

const KEYS = Object.keys(ENV_VAR_META) as EnvKey[];

export default function TuneTab({ hw, onFlash }: Props) {
  const defaults = useMemo(() => defaultEnvProfile(), []);
  const suggested = useMemo(
    () => buildEnvProfile({ ramMiB: hw.ramMiB, vramMiB: hw.vramMiB, cpuCores: hw.cpuCores }),
    [hw.ramMiB, hw.vramMiB, hw.cpuCores],
  );
  const [current, setCurrent] = useState<EnvProfile>(suggested);
  const [initialCurrent, setInitialCurrent] = useState<Partial<EnvProfile>>({});
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  useEffect(() => {
    readCurrentEnv().then((env) => {
      setInitialCurrent(env);
      // Start with suggested, but honor what's already in the user's env
      setCurrent((c) => ({ ...c, ...env }));
    });
  }, []);

  const cycleValue = (k: EnvKey, dir: 1 | -1) => {
    const meta = ENV_VAR_META[k];
    const opts = meta.values ?? [];
    if (opts.length === 0) return;
    const idx = Math.max(0, opts.indexOf(current[k]));
    const next = opts[(idx + dir + opts.length) % opts.length];
    setCurrent((c) => ({ ...c, [k]: next }));
  };

  useInput((input, key) => {
    if (mode.kind === 'edit' || mode.kind === 'applying' || mode.kind === 'restarting') return;
    if (mode.kind === 'applied') {
      if (key.return || key.escape) setMode({ kind: 'list' });
      return;
    }
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(KEYS.length - 1, c + 1));
    else if (key.leftArrow || input === 'h') cycleValue(KEYS[cursor], -1);
    else if (key.rightArrow || input === 'l' || input === ' ') cycleValue(KEYS[cursor], 1);
    else if (input === 'e' || input === 'E' || key.return) {
      setMode({ kind: 'edit', key: KEYS[cursor], value: current[KEYS[cursor]] });
    } else if (input === 'd' || input === 'D') {
      const k = KEYS[cursor];
      setCurrent((c) => ({ ...c, [k]: defaults[k] }));
    } else if (input === 's' || input === 'S') {
      const k = KEYS[cursor];
      setCurrent((c) => ({ ...c, [k]: suggested[k] }));
    } else if (input === 'R') {
      // reset all to suggested
      setCurrent({ ...suggested });
    } else if (input === 'x' || input === 'X') {
      // reset all to defaults
      setCurrent({ ...defaults });
    } else if (input === 'a' || input === 'A') {
      setMode({ kind: 'applying' });
    }
  });

  useEffect(() => {
    if (mode.kind !== 'applying') return;
    (async () => {
      const results = await persistEnv(current);
      setMode({ kind: 'restarting' });
      await restartOllama();
      onFlash('Tuning applied. Ollama restarted.');
      setMode({ kind: 'applied', results });
    })();
  }, [mode.kind]);

  if (mode.kind === 'edit') {
    const meta = ENV_VAR_META[mode.key];
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">
          {icon.pointer} Editing {meta.label}
        </Text>
        <Text color="gray">{meta.description}</Text>
        <Text color="gray">
          Allowed shortcut values: {meta.values?.join(', ') ?? '(free text)'}
        </Text>
        <Box marginTop={1}>
          <Text color="cyan">{mode.key} = </Text>
          <TextInput
            value={mode.value}
            onChange={(v) => setMode({ kind: 'edit', key: mode.key, value: v })}
            onSubmit={(v) => {
              setCurrent((c) => ({ ...c, [mode.key]: v.trim() || c[mode.key] }));
              setMode({ kind: 'list' });
            }}
          />
        </Box>
        <Text color="gray">Enter to confirm, Esc to cancel.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Tune Ollama runtime</Text>
        <Text color="gray"> · compare Ollama defaults, our suggestion for your hardware, and what you want to apply</Text>
      </Box>

      <EnvTable
        current={current}
        defaults={defaults}
        suggested={suggested}
        initial={initialCurrent}
        cursor={cursor}
      />

      <Box marginTop={1}>
        <Text color="gray">
          {icon.arrowUp}{icon.arrowDown} nav   {icon.arrowLeft}{icon.arrowRight}/space cycle values   E edit   D use default   S use suggested   R reset all→suggested   X reset all→defaults   A apply + restart
        </Text>
      </Box>

      <DetailPane k={KEYS[cursor]} current={current[KEYS[cursor]]} />

      <Footer mode={mode} current={current} initial={initialCurrent} />
    </Box>
  );
}

function EnvTable({
  current,
  defaults,
  suggested,
  initial,
  cursor,
}: {
  current: EnvProfile;
  defaults: EnvProfile;
  suggested: EnvProfile;
  initial: Partial<EnvProfile>;
  cursor: number;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold color="gray">{'  '}{'Variable'.padEnd(26)}</Text>
        <Text bold color="gray">{'Default'.padEnd(10)}</Text>
        <Text bold color="gray">{'Suggested'.padEnd(12)}</Text>
        <Text bold color="gray">{'Current (editable)'.padEnd(22)}</Text>
        <Text bold color="gray">State</Text>
      </Box>
      {KEYS.map((k, i) => {
        const isCursor = i === cursor;
        const cur = current[k];
        const def = defaults[k];
        const sug = suggested[k];
        const init = initial[k];
        const matchesDefault = cur === def;
        const matchesSuggested = cur === sug;
        const changedVsInit = init !== undefined && init !== cur;
        const stateDots: React.ReactNode[] = [];
        stateDots.push(
          matchesDefault ? (
            <Text key="d" color="gray">{icon.off} default</Text>
          ) : matchesSuggested ? (
            <Text key="s" color="green">{icon.on} suggested</Text>
          ) : (
            <Text key="c" color="yellow">{icon.partial} custom</Text>
          ),
        );
        if (changedVsInit) {
          stateDots.push(<Text key="u"> {icon.warning} unsaved</Text>);
        }

        return (
          <Box key={k}>
            <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
              {(isCursor ? icon.pointer + ' ' : '  ') + ENV_VAR_META[k].label.padEnd(24)}
            </Text>
            <Text color="gray">{def.padEnd(10)}</Text>
            <Text color="green">{sug.padEnd(12)}</Text>
            <Text color={matchesDefault ? 'gray' : matchesSuggested ? 'green' : 'yellow'}>
              {cur.padEnd(22)}
            </Text>
            {stateDots}
          </Box>
        );
      })}
    </Box>
  );
}

function DetailPane({ k, current }: { k: EnvKey; current: string }) {
  const meta = ENV_VAR_META[k];
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">{k}</Text>
      <Text color="gray">{meta.description}</Text>
      <Text color="gray">
        Current value: <Text color="white">{current}</Text>
        {meta.values && (
          <Text color="gray">
            {'  '}· cycle with {icon.arrowLeft}{icon.arrowRight}: {meta.values.join(' | ')}
          </Text>
        )}
      </Text>
    </Box>
  );
}

function Footer({
  mode,
  current,
  initial,
}: {
  mode: Mode;
  current: EnvProfile;
  initial: Partial<EnvProfile>;
}) {
  const pending = KEYS.filter((k) => initial[k] !== current[k]).length;
  if (mode.kind === 'applying') {
    return (
      <Box marginTop={1}>
        <Text color="yellow">
          <Spinner type="dots" /> Persisting env vars via{' '}
          {process.platform === 'win32' ? 'setx' : process.platform === 'darwin' ? 'launchctl + ~/.zprofile' : '~/.profile + systemd override'}...
        </Text>
      </Box>
    );
  }
  if (mode.kind === 'restarting') {
    return (
      <Box marginTop={1}>
        <Text color="yellow">
          <Spinner type="dots" /> Restarting Ollama server so env takes effect...
        </Text>
      </Box>
    );
  }
  if (mode.kind === 'applied') {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green">{icon.ok} Applied. (Enter to return)</Text>
        {mode.results.map((r) => (
          <Text key={r.key} color={r.applied ? 'gray' : 'red'}>
            {r.applied ? `  ${icon.tick} ` : `  ${icon.cross} `}
            {r.key}={r.value}
            {r.note ? `  · ${r.note}` : ''}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box marginTop={1}>
      <Text color={pending > 0 ? 'yellow' : 'gray'}>
        {pending > 0 ? `${pending} var${pending > 1 ? 's' : ''} changed since launch · press A to apply.` : 'No changes to apply.'}
      </Text>
    </Box>
  );
}
