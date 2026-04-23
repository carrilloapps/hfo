import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import App from '../App.js';
import type { HardwareProfile } from '../core/hardware.js';
import { icon } from '../ui/icons.js';
import LaunchMenu, { type LaunchSelection } from '../components/LaunchMenu.js';
import type { Theme } from '../ui/theme.js';

interface Props {
  baseDir: string;
  token?: string;
  codeModel: boolean;
  contextSize?: number;
  hw: HardwareProfile;
  initialUrl?: string;
  theme: Theme;
  onLock: (locked: boolean) => void;
  onFlash: (msg: string) => void;
  onLaunch: (sel: LaunchSelection) => void;
}

type Stage =
  | { kind: 'idle'; url: string }
  | { kind: 'running'; url: string }
  | { kind: 'done'; summary: string; tag: string | null }
  | { kind: 'launching'; tag: string | null };

export default function InstallTab(props: Props) {
  const [stage, setStage] = useState<Stage>(
    props.initialUrl ? { kind: 'running', url: props.initialUrl } : { kind: 'idle', url: '' },
  );

  useEffect(() => {
    props.onLock(stage.kind === 'running' || stage.kind === 'launching');
  }, [stage.kind]);

  useInput((input, key) => {
    if (stage.kind === 'done') {
      if (key.return || key.escape) setStage({ kind: 'idle', url: '' });
      else if (input === 'l' || input === 'L') setStage({ kind: 'launching', tag: stage.tag });
    }
  });

  if (stage.kind === 'running') {
    return (
      <App
        input={stage.url}
        baseDir={props.baseDir}
        token={props.token}
        codeModel={props.codeModel}
        contextSize={props.contextSize}
        skipTune={true}
        embedded={true}
        onComplete={(tag) => {
          const summary = tag
            ? `Installed. Ready to launch ${tag} with an Ollama integration.`
            : 'Install flow finished.';
          props.onFlash(summary);
          setStage({ kind: 'done', summary, tag });
        }}
      />
    );
  }

  if (stage.kind === 'launching') {
    return (
      <LaunchMenu
        theme={props.theme}
        defaultModel={stage.tag}
        onCancel={() => setStage({ kind: 'done', summary: 'Launch cancelled.', tag: stage.tag })}
        onConfirm={(sel) => {
          props.onLaunch(sel);
        }}
      />
    );
  }

  if (stage.kind === 'done') {
    return (
      <Box flexDirection="column">
        <Text color={props.theme.success as any} bold>{icon.tick} {stage.summary}</Text>
        {stage.tag && (
          <Text color={props.theme.muted as any}>
            Tag: <Text color={props.theme.primary as any}>{stage.tag}</Text>
          </Text>
        )}
        <Box marginTop={1}>
          <Text>
            <Text color={props.theme.accent as any}>L</Text> launch an integration
            <Text color={props.theme.muted as any}>   ·   </Text>
            <Text color={props.theme.accent as any}>Enter / Esc</Text> install another
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={props.theme.primary as any}>Install a model from Hugging Face</Text>
      <Text color={props.theme.muted as any}>Paste a Hugging Face URL or `org/repo` slug, then press Enter.</Text>
      <Text color={props.theme.muted as any}>Examples:</Text>
      <Text color={props.theme.muted as any}>  bartowski/Llama-3.2-3B-Instruct-GGUF</Text>
      <Text color={props.theme.muted as any}>  https://huggingface.co/HauhauCS/Gemma-4-E2B-Uncensored-HauhauCS-Aggressive</Text>
      <Box marginTop={1}>
        <Text color={props.theme.primary as any}>URL / repo-id: </Text>
        <TextInput
          value={stage.url}
          onChange={(v) => setStage({ kind: 'idle', url: v })}
          onSubmit={(v) => {
            const trimmed = v.trim();
            if (!trimmed) return;
            setStage({ kind: 'running', url: trimmed });
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={props.theme.muted as any}>
          Hardware target: {props.hw.gpuName ?? 'no GPU'} · {props.hw.vramMiB} MiB VRAM · {props.hw.ramMiB} MiB RAM
        </Text>
      </Box>
    </Box>
  );
}
