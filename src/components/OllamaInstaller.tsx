import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { InstallPlan } from '../infra/ollama.js';
import { checkOllama, planInstall, runInstall } from '../infra/ollama.js';
import { icon } from '../ui/icons.js';

interface Props {
  missing: 'no-binary' | 'no-server';
  onReady: () => void;
  onSkip: () => void;
  onRestartOllama: () => Promise<void>;
}

type Stage =
  | { kind: 'ask-binary' }
  | { kind: 'installing'; plan: InstallPlan }
  | { kind: 'install-failed'; plan: InstallPlan; exitCode: number }
  | { kind: 'verifying' }
  | { kind: 'asking-start-server' }
  | { kind: 'starting-server' }
  | { kind: 'failed'; reason: string };

const MAX_LOG_LINES = 8;

export default function OllamaInstaller({ missing, onReady, onSkip, onRestartOllama }: Props) {
  const plan = planInstall();
  const [stage, setStage] = useState<Stage>(
    missing === 'no-binary' ? { kind: 'ask-binary' } : { kind: 'asking-start-server' },
  );
  const [log, setLog] = useState<string[]>([]);

  useInput(async (input, key) => {
    if (stage.kind === 'ask-binary') {
      if (input === 'y' || input === 'Y' || key.return) {
        setStage({ kind: 'installing', plan });
      } else if (input === 'n' || input === 'N' || key.escape) {
        onSkip();
      }
    } else if (stage.kind === 'install-failed') {
      if (key.return || key.escape) onSkip();
    } else if (stage.kind === 'asking-start-server') {
      if (input === 'y' || input === 'Y' || key.return) {
        setStage({ kind: 'starting-server' });
      } else if (input === 'n' || input === 'N' || key.escape) {
        onSkip();
      }
    } else if (stage.kind === 'failed') {
      if (key.return || key.escape) onSkip();
    }
  });

  useEffect(() => {
    if (stage.kind !== 'installing') return;
    (async () => {
      const result = await runInstall(stage.plan, ({ line }) => {
        setLog((l) => [...l.slice(-(MAX_LOG_LINES - 1)), line]);
      });
      if (!result.ok) {
        setStage({ kind: 'install-failed', plan: stage.plan, exitCode: result.exitCode });
        return;
      }
      setStage({ kind: 'verifying' });
    })();
  }, [stage.kind]);

  useEffect(() => {
    if (stage.kind !== 'verifying') return;
    let tries = 0;
    const interval = setInterval(async () => {
      tries++;
      const st = await checkOllama();
      if (st.status === 'ok') {
        clearInterval(interval);
        onReady();
      } else if (st.status === 'no-server') {
        clearInterval(interval);
        setStage({ kind: 'asking-start-server' });
      } else if (tries >= 20) {
        clearInterval(interval);
        setStage({ kind: 'failed', reason: 'Binary still not detected after install. Open a new terminal and run `ollama --version` to verify.' });
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [stage.kind]);

  useEffect(() => {
    if (stage.kind !== 'starting-server') return;
    (async () => {
      await onRestartOllama();
      let tries = 0;
      const interval = setInterval(async () => {
        tries++;
        const st = await checkOllama();
        if (st.status === 'ok') {
          clearInterval(interval);
          onReady();
        } else if (tries >= 15) {
          clearInterval(interval);
          setStage({
            kind: 'failed',
            reason: 'Server did not come up. Start Ollama from your OS (tray/app/systemd) and rerun runllama.',
          });
        }
      }, 1500);
    })();
  }, [stage.kind]);

  if (stage.kind === 'ask-binary') {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1}>
        <Text color="red" bold>{icon.warning} Ollama is not installed.</Text>
        <Text />
        <Text>runllama can install it for you using <Text color="cyan">{plan.method}</Text>:</Text>
        <Text color="cyan">  {plan.humanCommand}</Text>
        <Text color="gray">{plan.note}</Text>
        <Text color="gray">Fallback: {plan.fallbackUrl}</Text>
        <Text />
        <Text>Install now? <Text color="green">[Y]</Text> / <Text color="red">[N] skip</Text></Text>
      </Box>
    );
  }

  if (stage.kind === 'installing') {
    return (
      <Box flexDirection="column">
        <Text color="cyan">
          <Spinner type="dots" /> Installing Ollama via {stage.plan.method}... (this can take 1-3 minutes)
        </Text>
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          {log.length === 0 && <Text color="gray">(no output yet)</Text>}
          {log.map((line, i) => (
            <Text key={i} color="gray">{line}</Text>
          ))}
        </Box>
      </Box>
    );
  }

  if (stage.kind === 'install-failed') {
    return (
      <Box flexDirection="column">
        <Text color="red">{icon.cross} Install failed (exit {stage.exitCode}).</Text>
        <Text>Try manually:</Text>
        <Text color="cyan">  {stage.plan.humanCommand}</Text>
        <Text color="gray">Or download from: {stage.plan.fallbackUrl}</Text>
        <Text color="gray">(Enter to exit)</Text>
      </Box>
    );
  }

  if (stage.kind === 'verifying') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Verifying the install (checking `ollama --version` and server reachability)...
        </Text>
      </Box>
    );
  }

  if (stage.kind === 'asking-start-server') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow" bold>{icon.warning} Ollama server is not responding.</Text>
        <Text>Binary is installed but the API at http://127.0.0.1:11434 is unreachable.</Text>
        <Text>Start / restart it now? <Text color="green">[Y]</Text> / <Text color="red">[N] skip</Text></Text>
      </Box>
    );
  }

  if (stage.kind === 'starting-server') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Starting Ollama server...
        </Text>
      </Box>
    );
  }

  if (stage.kind === 'failed') {
    return (
      <Box flexDirection="column">
        <Text color="red">{icon.cross} {stage.reason}</Text>
        <Text color="gray">(Enter to exit)</Text>
      </Box>
    );
  }

  return null;
}
