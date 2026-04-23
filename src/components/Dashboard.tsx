import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { detectHardware, type HardwareProfile } from '../hardware.js';
import { checkOllama } from '../ollama.js';
import { hfSearchUrl, hfSearchUrlForKeyword, scoreHardware, tierFor, type CapacityTier, type PowerScore } from '../capacity.js';
import { formatBytes } from '../format.js';
import { scoreColor } from '../scoring.js';
import { icon } from '../icons.js';

interface Props {
  onExit: () => void;
}

interface Ready {
  hw: HardwareProfile;
  tier: CapacityTier;
  power: PowerScore;
  ollamaReady: boolean;
  ollamaVersion?: string;
}

export default function Dashboard({ onExit }: Props) {
  const [state, setState] = useState<Ready | null>(null);

  useEffect(() => {
    (async () => {
      const [hw, ollama] = await Promise.all([detectHardware(), checkOllama()]);
      const tier = tierFor(hw);
      const power = scoreHardware(hw);
      setState({
        hw,
        tier,
        power,
        ollamaReady: ollama.status === 'ok',
        ollamaVersion: ollama.version,
      });
      setTimeout(onExit, 50);
    })();
  }, []);

  if (!state) {
    return (
      <Box>
        <Text color="cyan"><Spinner type="dots" /> Scanning your device...</Text>
      </Box>
    );
  }

  const { hw, tier, power, ollamaReady, ollamaVersion } = state;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">runllama — local LLM planner</Text>
      </Box>
      <Text color="gray">No HF URL provided. Here's what your rig can do, and a few places to start.</Text>

      {/* Hardware */}
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" marginTop={1}>
        <Text bold color="cyan">Hardware profile</Text>
        <Text>
          GPU: <Text color="white">{hw.gpuName ?? '— (no discrete GPU detected)'}</Text>
          {hw.vramMiB > 0 && <Text color="gray">  ·  VRAM {formatBytes(hw.vramMiB * 1024 * 1024)}</Text>}
        </Text>
        <Text>
          RAM: <Text color="white">{formatBytes(hw.ramMiB * 1024 * 1024)}</Text>
          <Text color="gray">  ·  CPU {hw.cpuCores} cores  ·  OS {hw.platform}</Text>
        </Text>
        <Text>
          Ollama:{' '}
          {ollamaReady ? (
            <Text color="green">{icon.tick} ready ({ollamaVersion ?? 'running'})</Text>
          ) : (
            <Text color="yellow">{icon.warning} not running — runllama can install/start it for you</Text>
          )}
        </Text>
      </Box>

      {/* Power */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" marginTop={1}>
        <Text bold color="cyan">Total power</Text>
        <Text>
          Overall:{' '}
          <Text color={scoreColor(power.score)} bold>{power.score}/100</Text>
          <Text color="gray">  ·  tier: </Text>
          <Text color="white" bold>{tier.label}</Text>
        </Text>
        <Text color="gray">
          Breakdown — GPU <Text color={scoreColor(power.gpuScore)}>{power.gpuScore}</Text>
          {' / '}RAM <Text color={scoreColor(power.ramScore)}>{power.ramScore}</Text>
          {' / '}CPU <Text color={scoreColor(power.cpuScore)}>{power.cpuScore}</Text>
        </Text>
        <Text color="gray">{tier.summary}</Text>
      </Box>

      {/* Capabilities */}
      <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column" marginTop={1}>
        <Text bold color="green">What you can run locally</Text>
        {tier.runs.map((r) => (
          <Text key={r.text}>
            {'  '}
            <Text color={r.level === 'ok' ? 'green' : r.level === 'warn' ? 'yellow' : 'red'}>
              {r.level === 'ok' ? icon.tick : r.level === 'warn' ? icon.warning : icon.cross}
            </Text>
            <Text> {r.text}</Text>
          </Text>
        ))}
      </Box>

      {/* Suggestions */}
      <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column" marginTop={1}>
        <Text bold color="yellow">Hand-picked GGUF repos for your tier</Text>
        {tier.picks.map((p) => (
          <Box key={p.repoId} flexDirection="column">
            <Text>  · <Text color="cyan">{p.repoId}</Text></Text>
            <Text color="gray">      {p.note}</Text>
          </Box>
        ))}
      </Box>

      {/* HF search link */}
      <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" marginTop={1}>
        <Text bold color="magenta">Browse more on HuggingFace (pre-filtered)</Text>
        <Text color="gray">GGUF · text-generation · sorted by trending:</Text>
        <Text color="cyan">  {hfSearchUrl(tier, { sort: 'trending' })}</Text>
        <Text color="gray">Same filter, sorted by most downloads:</Text>
        <Text color="cyan">  {hfSearchUrl(tier, { sort: 'downloads' })}</Text>
        {tier.searchKeywords.length > 1 && (
          <>
            <Text color="gray">Dial in a specific size:</Text>
            {tier.searchKeywords.slice(0, 3).map((kw) => (
              <Text key={kw} color="cyan">  · {kw}: {hfSearchUrlForKeyword(kw)}</Text>
            ))}
          </>
        )}
      </Box>

      {/* Usage hint */}
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">Install any of the above with:</Text>
        <Text color="white">  runllama &lt;hf-url-or-repo-id&gt;</Text>
        <Text color="gray">Example:</Text>
        <Text color="white">  runllama {tier.picks[0]?.repoId ?? 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF'}</Text>
      </Box>
    </Box>
  );
}
