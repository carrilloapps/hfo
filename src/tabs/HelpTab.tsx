import React from 'react';
import { Box, Text } from 'ink';
import { icon } from '../ui/icons.js';

export default function HelpTab() {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">runllama — reference</Text>
        <Text color="gray"> · fullscreen TUI for local LLMs via Ollama</Text>
      </Box>

      <Box flexDirection="row" gap={1}>
        <KeybindColumn />
        <FeaturesColumn />
      </Box>

      <Box marginTop={1} flexDirection="row" gap={1}>
        <FilesColumn />
        <AboutColumn />
      </Box>
    </Box>
  );
}

function Panel({
  title,
  color,
  children,
  width,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color as any}
      paddingX={1}
      width={width}
    >
      <Text bold color={color as any}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function Row({ k, v, color = 'white' }: { k: string; v: string; color?: string }) {
  return (
    <Box>
      <Text color="cyan">{k.padEnd(22)}</Text>
      <Text color={color as any}>{v}</Text>
    </Box>
  );
}

function KeybindColumn() {
  return (
    <Panel title="Keybindings" color="cyan" width="50%">
      <Text color="gray">Global</Text>
      <Row k="1 2 3 4 5" v="jump to tab" />
      <Row k="Tab / Shift+Tab" v="cycle tabs" />
      <Row k="?" v="open this help" />
      <Row k="q · Ctrl+C" v="quit and restore scrollback" />
      <Text />
      <Text color="gray">Dashboard (tab 1)</Text>
      <Text color="gray">  (read-only · live refresh every 2s)</Text>
      <Text />
      <Text color="gray">Models (tab 2)</Text>
      <Row k={`${icon.arrowUp} ${icon.arrowDown}`} v="navigate table" />
      <Row k="r" v="refresh now" />
      <Row k="d" v="remove selected (confirm y/n)" />
      <Text />
      <Text color="gray">Install (tab 3)</Text>
      <Row k="enter" v="submit URL / repo-id" />
      <Text color="gray">  (flow keys: space toggle quants, arrows nav, etc)</Text>
      <Text />
      <Text color="gray">Tune (tab 4)</Text>
      <Row k={`${icon.arrowUp} ${icon.arrowDown}`} v="navigate rows" />
      <Row k={`${icon.arrowLeft} ${icon.arrowRight}`} v="cycle enum values" />
      <Row k="e" v="free-text edit" />
      <Row k="d · s" v="row → default | suggested" />
      <Row k="x · R" v="all → defaults | suggested" />
      <Row k="a" v="apply + restart Ollama" />
    </Panel>
  );
}

function FeaturesColumn() {
  return (
    <Panel title="Tabs overview" color="yellow" width="50%">
      <Text color="cyan">Dashboard</Text>
      <Text color="gray">Live GPU/RAM meters · loaded-model list · hardware tier score · picks · pre-filtered HF search URLs.</Text>
      <Text />
      <Text color="cyan">Models</Text>
      <Text color="gray">Every tag in your Ollama registry with idle/loaded state. Delete, see size + modified time. Auto-refresh 3s.</Text>
      <Text />
      <Text color="cyan">Install</Text>
      <Text color="gray">
        Paste a HF URL or `org/repo` slug. Full flow: hardware-aware compatibility score per quant · multi-select picker · file
        browser (with suggested folder name · create/delete folders) · conflict review (rename/overwrite/skip) · HF-card-aware
        param editor · resumable downloads · automatic `ollama create`.
      </Text>
      <Text />
      <Text color="cyan">Tune</Text>
      <Text color="gray">
        Side-by-side Ollama default / ~90%-capacity suggestion / your current value for each key env var. Edit per-row, or
        bulk-reset. Persists via setx (Windows) · launchctl + ~/.zprofile (macOS) · ~/.profile + systemd override (Linux).
      </Text>
    </Panel>
  );
}

function FilesColumn() {
  return (
    <Panel title="Files generated per install" color="green" width="50%">
      <Text color="gray">When a model installs, runllama writes:</Text>
      <Text />
      <Text>
        <Text color="cyan">{'<dir>/<repo>/<quant>/'}</Text>
      </Text>
      <Text>  <Text color="cyan">{'<filename>.gguf'}</Text>  <Text color="gray">· downloaded artifact (resumable)</Text></Text>
      <Text>  <Text color="cyan">Modelfile</Text>          <Text color="gray">· tuned + commented for editing</Text></Text>
      <Text />
      <Text color="gray">Re-run{' '}
        <Text color="white">ollama create &lt;tag&gt; -f Modelfile</Text>
        {' '}after editing to apply.
      </Text>
    </Panel>
  );
}

function AboutColumn() {
  return (
    <Panel title="Project" color="magenta" width="50%">
      <Row k="Written in" v="TypeScript + ink (React for terminals)" />
      <Row k="Icons" v="figures package (ASCII fallback on legacy terms)" />
      <Row k="Live metrics" v="nvidia-smi + systeminformation + ollama ps" />
      <Row k="Cross-OS" v="Windows · macOS · Linux" />
      <Row k="Cost" v="free · HF public API + OSS deps" />
      <Text />
      <Text color="gray">CLI flags (from shell):</Text>
      <Text color="gray">  --dir, --token, --code, --ctx, --tab, --no-fullscreen</Text>
    </Panel>
  );
}
