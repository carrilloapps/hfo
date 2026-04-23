import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { HardwareProfile } from '../core/hardware.js';
import { buildEnvProfile, persistEnv, restartOllama, type PersistResult } from '../infra/ollama.js';
import { icon } from '../ui/icons.js';

interface Props {
  hw: HardwareProfile;
  onDone: () => void;
  onSkip: () => void;
}

type Stage =
  | { kind: 'ask' }
  | { kind: 'applying' }
  | { kind: 'restarting' }
  | { kind: 'done'; results: PersistResult[] };

export default function OllamaTuner({ hw, onDone, onSkip }: Props) {
  const profile = buildEnvProfile({
    ramMiB: hw.ramMiB,
    vramMiB: hw.vramMiB,
    cpuCores: hw.cpuCores,
  });
  const entries = Object.entries(profile);
  const [stage, setStage] = useState<Stage>({ kind: 'ask' });
  const [results, setResults] = useState<PersistResult[]>([]);

  useInput((input, key) => {
    if (stage.kind === 'ask') {
      if (input === 'y' || input === 'Y' || key.return) {
        setStage({ kind: 'applying' });
      } else if (input === 'n' || input === 'N' || key.escape) {
        onSkip();
      }
    } else if (stage.kind === 'done') {
      if (key.return || key.escape) onDone();
    }
  });

  useEffect(() => {
    if (stage.kind !== 'applying') return;
    (async () => {
      const res = await persistEnv(profile);
      setResults(res);
      setStage({ kind: 'restarting' });
    })();
  }, [stage.kind]);

  useEffect(() => {
    if (stage.kind !== 'restarting') return;
    (async () => {
      await restartOllama();
      setStage({ kind: 'done', results });
    })();
  }, [stage.kind]);

  if (stage.kind === 'ask') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Tune Ollama to ~90% of your hardware capacity?</Text>
        <Text color="gray">Persists these env vars system-wide and restarts Ollama:</Text>
        <Box flexDirection="column" marginTop={1}>
          {entries.map(([k, v]) => (
            <Text key={k}>
              <Text color="cyan">{k.padEnd(28)}</Text>= <Text color="white">{v}</Text>
            </Text>
          ))}
        </Box>
        <Text />
        <Text color="gray">Flash attention + q8 KV cache reduce VRAM; keep-alive pins the model in memory;</Text>
        <Text color="gray">parallel/loaded-models sized to your {hw.vramMiB} MiB VRAM to avoid OOM.</Text>
        <Text />
        <Text>Apply now? <Text color="green">[Y]</Text> / <Text color="red">[N] skip</Text></Text>
      </Box>
    );
  }

  if (stage.kind === 'applying') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Persisting env vars ({process.platform === 'win32' ? 'setx' : process.platform === 'darwin' ? 'launchctl + rc file' : 'rc file + systemd override'})...
        </Text>
      </Box>
    );
  }

  if (stage.kind === 'restarting') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Restarting Ollama so the new env takes effect...
        </Text>
      </Box>
    );
  }

  if (stage.kind === 'done') {
    const failed = results.filter((r) => !r.applied);
    return (
      <Box flexDirection="column">
        <Text color="green" bold>{icon.tick} Tuning applied.</Text>
        {results.map((r) => (
          <Text key={r.key} color={r.applied ? 'gray' : 'red'}>
            {r.applied ? `  ${icon.tick} ` : `  ${icon.cross} `}
            {r.key}={r.value}
            {r.note ? ` (${r.note})` : ''}
          </Text>
        ))}
        {failed.length > 0 && (
          <Text color="yellow">Some vars could not be persisted — you may need elevated privileges.</Text>
        )}
        <Text color="gray">(Enter to continue)</Text>
      </Box>
    );
  }

  return null;
}
