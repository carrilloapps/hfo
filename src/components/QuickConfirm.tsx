import React from 'react';
import { Box, Text, useInput } from 'ink';
import { icon } from '../ui/icons.js';
import type { Theme } from '../ui/theme.js';
import { t } from '../ui/i18n.js';
import { formatBytes } from '../ui/format.js';
import type { QuantScore } from '../core/scoring.js';
import type { CardInfo } from '../core/readme.js';

export type QuickAction = 'install-now' | 'change-dir' | 'customize' | 'cancel';

interface Props {
  theme: Theme;
  quant: QuantScore;
  repoId: string;
  suggestedTag: string;
  suggestedDir: string;
  card: CardInfo;
  hasConflicts: boolean;
  onChoose: (action: QuickAction) => void;
}

/**
 * One-screen summary of everything we inferred for an install. The default
 * action (Enter) installs immediately with hardware-tuned + HF-card-aware
 * defaults. A couple of single-key escape hatches open the file browser or
 * parameter editor when the user wants more control.
 */
export default function QuickConfirm({
  theme,
  quant,
  repoId,
  suggestedTag,
  suggestedDir,
  card,
  hasConflicts,
  onChoose,
}: Props) {
  useInput((input, key) => {
    if (key.return) onChoose('install-now');
    else if (input === 'o' || input === 'O') onChoose('change-dir');
    else if (input === 'c' || input === 'C') onChoose('customize');
    else if (key.escape || input === 'q' || input === 'Q') onChoose('cancel');
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.accent as any}>
          {t('quick.title')}
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor={theme.border as any} paddingX={1}>
        <Summary label={t('quick.repo')} value={repoId} theme={theme} />
        <Summary label={t('quick.quant')} value={`${quant.quant}  ·  ${formatBytes(quant.file.size)}  ·  ${quant.label}`} theme={theme} />
        <Summary
          label={t('quick.score')}
          value={
            <Text color={quant.score >= 80 ? (theme.success as any) : quant.score >= 55 ? (theme.warning as any) : (theme.danger as any)}>
              {quant.score}/100
            </Text>
          }
          theme={theme}
        />
        <Summary label={t('quick.tag')} value={suggestedTag} theme={theme} />
        <Summary label={t('quick.dir')} value={suggestedDir} theme={theme} />
        <Summary
          label={t('quick.params')}
          value={
            card.foundKeys.length > 0
              ? `${t('quick.hardware')} + ${t('quick.card')} (${card.foundKeys.join(', ')})`
              : `${t('quick.hardware')}`
          }
          theme={theme}
        />
      </Box>

      {hasConflicts && (
        <Box marginTop={1} borderStyle="single" borderColor={theme.warning as any} paddingX={1}>
          <Text color={theme.warning as any}>{icon.warning} {t('quick.conflictsHint')}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>{t('quick.choose')}</Text>
        <Text>
          <Text color={theme.success as any}>[Enter]</Text>
          <Text> </Text>
          <Text>{t('quick.installNow')}</Text>
        </Text>
        <Text color={theme.muted as any}>
          {icon.bullet} {t('quick.installNowHint')}
        </Text>
        <Text>
          <Text color={theme.accent as any}>[O]</Text>
          <Text> </Text>
          <Text>{t('quick.changeDir')}</Text>
        </Text>
        <Text>
          <Text color={theme.accent as any}>[C]</Text>
          <Text> </Text>
          <Text>{t('quick.customize')}</Text>
        </Text>
        <Text>
          <Text color={theme.muted as any}>[Esc]</Text>
          <Text> </Text>
          <Text color={theme.muted as any}>{t('quick.cancel')}</Text>
        </Text>
      </Box>
    </Box>
  );
}

function Summary({
  label,
  value,
  theme,
}: {
  label: string;
  value: React.ReactNode;
  theme: Theme;
}) {
  return (
    <Box>
      <Text color={theme.muted as any}>{label.padEnd(18)}</Text>
      {typeof value === 'string' ? <Text color={theme.primary as any}>{value}</Text> : value}
    </Box>
  );
}
