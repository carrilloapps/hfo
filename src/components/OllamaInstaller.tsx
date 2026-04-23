import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { InstallPlan } from '../infra/ollama.js';
import { checkOllama, planInstall, runInstall } from '../infra/ollama.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';

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
        setStage({ kind: 'failed', reason: t('ollamaInstaller.binaryNotDetected') });
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [stage.kind]);

  useEffect(() => {
    if (stage.kind !== 'starting-server') return;
    // Interval lives outside the IIFE so the effect's cleanup can clear it.
    // Without this the interval would keep firing after the component unmounts.
    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    (async () => {
      await onRestartOllama();
      if (cancelled) return;
      let tries = 0;
      interval = setInterval(async () => {
        tries++;
        const st = await checkOllama();
        if (st.status === 'ok') {
          if (interval) clearInterval(interval);
          onReady();
        } else if (tries >= 15) {
          if (interval) clearInterval(interval);
          setStage({ kind: 'failed', reason: t('ollamaInstaller.serverNotUp') });
        }
      }, 1500);
    })();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [stage.kind]);

  if (stage.kind === 'ask-binary') {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1}>
        <Text color="red" bold>{icon.warning} {t('ollamaInstaller.notInstalled')}</Text>
        <Text />
        <Text>{t('ollamaInstaller.canInstall', { method: plan.method })}</Text>
        <Text color="cyan">  {plan.humanCommand}</Text>
        <Text color="gray">{plan.note}</Text>
        <Text color="gray">{t('ollamaInstaller.fallback')} {plan.fallbackUrl}</Text>
        <Text />
        <Text>{t('ollamaInstaller.installNow')} <Text color="green">[Y]</Text> / <Text color="red">{t('ollamaInstaller.skipOption')}</Text></Text>
      </Box>
    );
  }

  if (stage.kind === 'installing') {
    return (
      <Box flexDirection="column">
        <Text color="cyan">
          <Spinner type="dots" /> {t('ollamaInstaller.installing', { method: stage.plan.method })}
        </Text>
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          {log.length === 0 && <Text color="gray">{t('ollamaInstaller.noOutput')}</Text>}
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
        <Text color="red">{icon.cross} {t('ollamaInstaller.failed', { code: stage.exitCode })}</Text>
        <Text>{t('ollamaInstaller.tryManually')}</Text>
        <Text color="cyan">  {stage.plan.humanCommand}</Text>
        <Text color="gray">{t('ollamaInstaller.orDownload')} {stage.plan.fallbackUrl}</Text>
        <Text color="gray">{t('common.enterContinue')}</Text>
      </Box>
    );
  }

  if (stage.kind === 'verifying') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> {t('ollamaInstaller.verifying')}
        </Text>
      </Box>
    );
  }

  if (stage.kind === 'asking-start-server') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow" bold>{icon.warning} {t('ollamaInstaller.serverDown')}</Text>
        <Text>{t('ollamaInstaller.binaryPresent')}</Text>
        <Text>{t('ollamaInstaller.startNow')} <Text color="green">[Y]</Text> / <Text color="red">{t('ollamaInstaller.skipOption')}</Text></Text>
      </Box>
    );
  }

  if (stage.kind === 'starting-server') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> {t('ollamaInstaller.starting')}
        </Text>
      </Box>
    );
  }

  if (stage.kind === 'failed') {
    return (
      <Box flexDirection="column">
        <Text color="red">{icon.cross} {stage.reason}</Text>
        <Text color="gray">{t('common.enterContinue')}</Text>
      </Box>
    );
  }

  return null;
}
