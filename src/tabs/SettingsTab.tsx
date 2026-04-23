import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { DEFAULT_SETTINGS, type Settings } from '../infra/settings.js';
import { THEME_LIST, getTheme, type ThemeName } from '../ui/theme.js';
import { LANGS, t, type Lang } from '../ui/i18n.js';
import { icon } from '../ui/icons.js';
import { settingsPath } from '../infra/platform.js';
import Dropdown, { type DropdownItem } from '../components/Dropdown.js';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onFlash: (msg: string) => void;
}

type RowKey =
  | 'theme'
  | 'language'
  | 'refreshIntervalMs'
  | 'defaultSort'
  | 'defaultCodeMode'
  | 'modelDir'
  | 'useAltScreen'
  | 'reset';

const ROWS: { key: RowKey; label: string; kind: 'dropdown' | 'toggle' | 'int' | 'text' | 'action' }[] = [
  { key: 'theme', label: 'settings.theme', kind: 'dropdown' },
  { key: 'language', label: 'settings.language', kind: 'dropdown' },
  { key: 'refreshIntervalMs', label: 'settings.refreshInterval', kind: 'int' },
  { key: 'defaultSort', label: 'settings.defaultSort', kind: 'dropdown' },
  { key: 'defaultCodeMode', label: 'settings.codeMode', kind: 'toggle' },
  { key: 'modelDir', label: 'settings.modelDir', kind: 'text' },
  { key: 'useAltScreen', label: 'settings.altScreen', kind: 'toggle' },
  { key: 'reset', label: 'settings.reset', kind: 'action' },
];

const SORT_OPTIONS = ['trending', 'downloads', 'likes7d', 'modified'] as const;

type Mode =
  | { kind: 'list' }
  | { kind: 'editing-text'; key: RowKey; value: string }
  | { kind: 'dropdown'; key: RowKey };

export default function SettingsTab({ settings, onChange, onFlash }: Props) {
  const theme = getTheme(settings.theme);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const toggle = (key: RowKey) => {
    const update: any = { ...settings };
    update[key] = !(settings as any)[key];
    onChange(update);
  };

  const themeItems: DropdownItem<ThemeName>[] = THEME_LIST.map((name) => {
    const th = getTheme(name);
    return {
      id: name,
      label: th.label,
      detail: th.isDark ? 'dark palette' : 'light palette',
      description: `Primary: ${th.primary}  ·  accent: ${th.accent}  ·  success/warning/danger pairs tuned for readable contrast.`,
    };
  });

  const languageItems: DropdownItem<Lang>[] = LANGS.map((l) => ({
    id: l.code,
    label: `${l.native}`,
    detail: l.label,
    description: `Translation catalog for ${l.label} (${l.code.toUpperCase()}). Rendered natively as ${l.native}.`,
  }));

  const sortItems: DropdownItem<(typeof SORT_OPTIONS)[number]>[] = SORT_OPTIONS.map((s) => ({
    id: s,
    label: s,
    detail:
      s === 'trending' ? 'currently popular' :
      s === 'downloads' ? 'all-time downloads' :
      s === 'likes7d' ? 'liked over the past 7 days' :
      'most recently modified',
  }));

  useInput((input, key) => {
    if (mode.kind !== 'list') return;
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(ROWS.length - 1, c + 1));
    else {
      const row = ROWS[cursor];
      if (row.kind === 'dropdown' && key.return) {
        setMode({ kind: 'dropdown', key: row.key });
      } else if (row.kind === 'toggle' && (key.return || input === ' ' || key.leftArrow || key.rightArrow)) {
        toggle(row.key);
      } else if (row.kind === 'int') {
        if (key.leftArrow) {
          const current = (settings as any)[row.key] as number;
          onChange({ ...settings, [row.key]: Math.max(500, current - 500) } as Settings);
        } else if (key.rightArrow) {
          const current = (settings as any)[row.key] as number;
          onChange({ ...settings, [row.key]: current + 500 } as Settings);
        } else if (key.return) {
          const cur = (settings as any)[row.key];
          setMode({ kind: 'editing-text', key: row.key, value: String(cur ?? '') });
        }
      } else if (row.kind === 'text') {
        if (key.return) {
          const cur = (settings as any)[row.key];
          setMode({ kind: 'editing-text', key: row.key, value: String(cur ?? '') });
        } else if (input === 'c' || input === 'C') {
          onChange({ ...settings, [row.key]: null } as Settings);
        }
      } else if (row.kind === 'action' && key.return) {
        onChange({ ...DEFAULT_SETTINGS });
        onFlash('All settings reset to defaults.');
      }
    }
  });

  if (mode.kind === 'editing-text') {
    const row = ROWS.find((r) => r.key === mode.key)!;
    return (
      <Box flexDirection="column">
        <Text bold color={theme.accent as any}>{t(row.label)}</Text>
        <Text color={theme.muted as any}>Enter confirm · Esc cancel</Text>
        <Box marginTop={1}>
          <Text color={theme.primary as any}>&gt; </Text>
          <TextInput
            value={mode.value}
            onChange={(v) => setMode({ kind: 'editing-text', key: mode.key, value: v })}
            onSubmit={(v) => {
              const update: any = { ...settings };
              if (row.kind === 'int') {
                const n = Number(v);
                if (isFinite(n) && n >= 250) update[row.key] = n;
              } else {
                update[row.key] = v.trim() === '' ? null : v.trim();
              }
              onChange(update);
              setMode({ kind: 'list' });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode.kind === 'dropdown') {
    if (mode.key === 'theme') {
      return (
        <Dropdown<ThemeName>
          theme={theme}
          title={t('settings.theme')}
          items={themeItems}
          value={settings.theme}
          onCancel={() => setMode({ kind: 'list' })}
          onSelect={(id) => {
            onChange({ ...settings, theme: id });
            setMode({ kind: 'list' });
          }}
        />
      );
    }
    if (mode.key === 'language') {
      return (
        <Dropdown<Lang>
          theme={theme}
          title={t('settings.language')}
          items={languageItems}
          value={settings.language}
          onCancel={() => setMode({ kind: 'list' })}
          onSelect={(id) => {
            onChange({ ...settings, language: id });
            setMode({ kind: 'list' });
          }}
        />
      );
    }
    if (mode.key === 'defaultSort') {
      return (
        <Dropdown<(typeof SORT_OPTIONS)[number]>
          theme={theme}
          title={t('settings.defaultSort')}
          items={sortItems}
          value={settings.defaultSort}
          onCancel={() => setMode({ kind: 'list' })}
          onSelect={(id) => {
            onChange({ ...settings, defaultSort: id });
            setMode({ kind: 'list' });
          }}
        />
      );
    }
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.accent as any}>{t('settings.title')}</Text>
        <Text color={theme.muted as any}>  ·  {settingsPath()}</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor={theme.border as any} paddingX={1}>
        {ROWS.map((row, i) => {
          const isCursor = i === cursor;
          const value = (settings as any)[row.key];
          let display: string;
          if (row.kind === 'action') {
            display = '[Enter to reset]';
          } else if (row.kind === 'toggle') {
            display = value ? `${icon.checkOn} ${t('common.on')}` : `${icon.checkOff} ${t('common.off')}`;
          } else if (row.key === 'theme') {
            display = `${getTheme(value as ThemeName).label}   ${icon.pointer}`;
          } else if (row.key === 'language') {
            const lang = LANGS.find((l) => l.code === value);
            display = lang ? `${lang.native} (${lang.label})   ${icon.pointer}` : String(value);
          } else if (row.key === 'defaultSort') {
            display = `${value}   ${icon.pointer}`;
          } else if (value === null || value === undefined || value === '') {
            display = '(platform default)';
          } else {
            display = String(value);
          }
          return (
            <Box key={row.key}>
              <Text color={isCursor ? (theme.accent as any) : undefined} bold={isCursor}>
                {(isCursor ? `${icon.pointer} ` : '  ') + t(row.label).padEnd(42)}
              </Text>
              <Text color={theme.primary as any}>{display}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted as any}>{t('hints.settings')}</Text>
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor={theme.primary as any} paddingX={1}>
        <ThemePreview name={settings.theme} />
      </Box>
    </Box>
  );
}

function ThemePreview({ name }: { name: ThemeName }) {
  const theme = getTheme(name);
  return (
    <Box flexDirection="column">
      <Text bold color={theme.primary as any}>Theme preview — {theme.label}</Text>
      <Text>
        <Text color={theme.primary as any}>primary</Text>  <Text color={theme.accent as any}>accent</Text>  <Text color={theme.success as any}>{icon.tick} success</Text>  <Text color={theme.warning as any}>{icon.warning} warning</Text>  <Text color={theme.danger as any}>{icon.cross} danger</Text>
      </Text>
      <Text color={theme.muted as any}>muted secondary text — used for hints, footers, units.</Text>
    </Box>
  );
}
