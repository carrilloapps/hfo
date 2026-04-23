import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { APP } from '../infra/about.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import type { Theme } from '../ui/theme.js';

/**
 * ASCII rendition of the logo mark: a rounded square containing three
 * connected nodes (Hugging Face · Modelfile · Ollama). Lines are kept to
 * exactly the same width so the centering is stable regardless of terminal
 * width. Box-drawing characters are plain Unicode and fall back to ASCII
 * on legacy Windows consoles via the same terminal that already renders
 * the rest of the TUI.
 */
const LOGO_LINES = [
  '   ╭──────────────╮   ',
  '   │              │   ',
  '   │   ●──○──●    │   ',
  '   │              │   ',
  '   ╰──────────────╯   ',
];

export interface BootScreenProps {
  theme: Theme;
  /** Primary status line under the brand. */
  message?: string;
  /** Optional second status line for richer progress. */
  detail?: string;
  /** Hide the spinner (e.g. during the shutdown splash). */
  spinner?: boolean;
  /** Color override for the logo's accent strokes; defaults to theme.accent. */
  tone?: 'primary' | 'accent' | 'muted';
}

export default function BootScreen({
  theme,
  message,
  detail,
  spinner = true,
  tone = 'accent',
}: BootScreenProps) {
  const statusMessage = message ?? t('boot.initializing');
  const logoColor =
    tone === 'primary' ? theme.primary :
    tone === 'muted'   ? theme.muted   :
    theme.accent;
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={2}>
      {LOGO_LINES.map((line, i) => (
        <Text key={i} color={logoColor as any} bold>{line}</Text>
      ))}
      <Box marginTop={1}>
        <Text bold color={theme.text as any}>{APP.binary}</Text>
        <Text color={theme.muted as any}>  v{APP.version}  ·  {APP.license}  ·  {APP.author.name}</Text>
      </Box>
      <Box marginTop={1}>
        {spinner ? (
          <>
            <Text color={theme.primary as any}><Spinner type="dots" /></Text>
            <Text color={theme.muted as any}>  {statusMessage}</Text>
          </>
        ) : (
          <Text color={theme.muted as any}>{icon.tick}  {statusMessage}</Text>
        )}
      </Box>
      {detail && (
        <Box marginTop={1}>
          <Text color={theme.muted as any}>{detail}</Text>
        </Box>
      )}
    </Box>
  );
}
