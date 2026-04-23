import React from 'react';
import { Box, Text } from 'ink';
import type { HardwareProfile } from '../core/hardware.js';
import { scoreColor } from '../core/scoring.js';
import { formatBytes } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';

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
        <Text bold color="cyan">{t('hardwareReport.hardware')}</Text>
        <Text>
          {t('hardwareReport.gpu')}: <Text color="white">{hw.gpuName ?? t('hardwareReport.noneDetected')}</Text>
          {hw.vramMiB > 0 && <Text color="gray">  ·  {t('hardwareReport.vram')} {formatBytes(hw.vramMiB * 1024 * 1024)}</Text>}
        </Text>
        <Text>
          {t('hardwareReport.ram')}: <Text color="white">{formatBytes(hw.ramMiB * 1024 * 1024)}</Text>
          <Text color="gray">  ·  {t('hardwareReport.cpu')} {t('hardwareReport.cores', { n: hw.cpuCores })}  ·  {t('hardwareReport.os')} {hw.platform}</Text>
        </Text>
      </Box>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" marginTop={1}>
        <Text bold color="cyan">{t('hardwareReport.compatibilityFor')} <Text color="white">{repoId}</Text></Text>
        <Text>
          {t('hardwareReport.bestQuant')}{' '}
          <Text color={scoreColor(repoScore)} bold>
            {repoScore}/100
          </Text>
          <Text color="gray">  ·  {t('hardwareReport.avgAcross', { n: quantCount })} </Text>
          <Text color={scoreColor(avgScore)}>{avgScore}/100</Text>
        </Text>
        <Text color="gray">
          {repoScore >= 80
            ? `${icon.tick} ${t('hardwareReport.great')}`
            : repoScore >= 55
              ? `${icon.warning} ${t('hardwareReport.partial')}`
              : `${icon.cross} ${t('hardwareReport.marginal')}`}
        </Text>
      </Box>
    </Box>
  );
}
