import React from 'react';
import { Box, Text } from 'ink';
import type { HardwareProfile } from '../core/hardware.js';
import { scoreColor } from '../core/scoring.js';
import { formatBytes } from '../ui/format.js';
import { icon } from '../ui/icons.js';

interface Props {
  hw: HardwareProfile;
  repoId: string;
  repoScore: number;
  avgScore: number;
  quantCount: number;
}

export default function HardwareReport({ hw, repoId, repoScore, avgScore, quantCount }: Props) {
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text bold color="cyan">Hardware</Text>
        <Text>
          GPU: <Text color="white">{hw.gpuName ?? 'none detected'}</Text>
          {hw.vramMiB > 0 && <Text color="gray">  ·  VRAM {formatBytes(hw.vramMiB * 1024 * 1024)}</Text>}
        </Text>
        <Text>
          RAM: <Text color="white">{formatBytes(hw.ramMiB * 1024 * 1024)}</Text>
          <Text color="gray">  ·  CPU {hw.cpuCores} cores  ·  OS {hw.platform}</Text>
        </Text>
      </Box>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" marginTop={1}>
        <Text bold color="cyan">Compatibility for <Text color="white">{repoId}</Text></Text>
        <Text>
          Best quant:{' '}
          <Text color={scoreColor(repoScore)} bold>
            {repoScore}/100
          </Text>
          <Text color="gray">  ·  Avg across {quantCount} variants: </Text>
          <Text color={scoreColor(avgScore)}>{avgScore}/100</Text>
        </Text>
        <Text color="gray">
          {repoScore >= 80
            ? `${icon.tick} This model runs great on your hardware.`
            : repoScore >= 55
              ? `${icon.warning} Runnable with partial offload — pick a lower quant for best throughput.`
              : `${icon.cross} Marginal fit. Consider a smaller model or accept slow inference.`}
        </Text>
      </Box>
    </Box>
  );
}
