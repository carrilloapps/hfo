import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useTerminalSize, useNow } from './hooks.js';
import { checkOllama, type OllamaStatus } from './ollama.js';
import { detectHardware, type HardwareProfile } from './hardware.js';
import { loadSettings, saveSettings, type Settings } from './settings.js';
import { getTheme } from './theme.js';
import { setLang, t } from './i18n.js';
import DashboardTab from './tabs/DashboardTab.js';
import ModelsTab from './tabs/ModelsTab.js';
import InstallTab from './tabs/InstallTab.js';
import TuneTab from './tabs/TuneTab.js';
import HelpTab from './tabs/HelpTab.js';
import SettingsTab from './tabs/SettingsTab.js';
import { formatBytes } from './format.js';
import { icon } from './icons.js';
import type { LaunchSelection } from './components/LaunchMenu.js';
import { APP } from './about.js';
import { openUrl } from './platform.js';

export type TabKey = 'dashboard' | 'models' | 'install' | 'tune' | 'help' | 'settings';

const TAB_ORDER: TabKey[] = ['dashboard', 'models', 'install', 'tune', 'help', 'settings'];

interface Props {
  initialTab?: TabKey;
  initialUrl?: string;
  baseDir: string;
  token?: string;
  codeModel: boolean;
  contextSize?: number;
  onLaunch: (sel: LaunchSelection) => void;
}

export default function Shell(props: Props) {
  const { exit } = useApp();
  const size = useTerminalSize();
  const now = useNow(1000);
  const [active, setActive] = useState<TabKey>(props.initialTab ?? 'dashboard');
  const [hw, setHw] = useState<HardwareProfile | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [installLocked, setInstallLocked] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    (async () => {
      const [h, o, s] = await Promise.all([detectHardware(), checkOllama(), loadSettings()]);
      setHw(h);
      setOllama(o);
      setSettings(s);
    })();
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      setOllama(await checkOllama());
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(id);
  }, [flash]);

  const theme = settings ? getTheme(settings.theme) : getTheme('dark');

  const labels: Record<TabKey, string> = {
    dashboard: t('tab.dashboard'),
    models: t('tab.models'),
    install: t('tab.install'),
    tune: t('tab.tune'),
    help: t('tab.help'),
    settings: t('tab.settings'),
  };
  const hotkey: Record<TabKey, string> = {
    dashboard: '1',
    models: '2',
    install: '3',
    tune: '4',
    help: '5',
    settings: '6',
  };

  const handleLaunch = (sel: LaunchSelection) => {
    props.onLaunch(sel);
    exit();
  };

  useInput((input, key) => {
    if (installLocked) return;
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (key.tab && !key.shift) {
      const idx = TAB_ORDER.indexOf(active);
      setActive(TAB_ORDER[(idx + 1) % TAB_ORDER.length]);
    } else if (key.tab && key.shift) {
      const idx = TAB_ORDER.indexOf(active);
      setActive(TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
    } else if (input >= '1' && input <= '6') {
      const t = TAB_ORDER[Number(input) - 1];
      if (t) setActive(t);
    } else if (input === '?') {
      setActive('help');
    } else if (input === ',') {
      setActive('settings');
    } else if (input === 'h' && key.ctrl) {
      // Ctrl+H opens the author's homepage if present
      const url = APP.author.url || APP.homepage;
      if (url) {
        void openUrl(url);
        setFlash(`Opened ${url}`);
      }
    }
  });

  const updateSettings = async (next: Settings) => {
    // Switch language synchronously so the next render sees the new catalog.
    setLang(next.language);
    setSettings(next);
    try {
      await saveSettings(next);
    } catch {
      /* no-op */
    }
  };

  const cols = size.cols;
  const rows = size.rows;
  const bodyRows = Math.max(5, rows - 4);

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box width={cols} paddingX={1}>
        <Header hw={hw} ollama={ollama} now={now} theme={theme} />
      </Box>
      <Box width={cols}>
        <TabBar active={active} labels={labels} hotkey={hotkey} theme={theme} />
      </Box>
      <Box flexDirection="column" width={cols} height={bodyRows} paddingX={1}>
        {hw == null || ollama == null || settings == null ? (
          <Text color={theme.primary as any}>Initializing...</Text>
        ) : active === 'dashboard' ? (
          <DashboardTab
            hw={hw}
            ollama={ollama}
            theme={theme}
            refreshIntervalMs={settings.refreshIntervalMs}
            bodyRows={bodyRows}
            onFlash={setFlash}
          />
        ) : active === 'models' ? (
          <ModelsTab theme={theme} onFlash={setFlash} onLaunch={handleLaunch} />
        ) : active === 'install' ? (
          <InstallTab
            baseDir={props.baseDir}
            token={props.token}
            codeModel={props.codeModel || settings.defaultCodeMode}
            contextSize={props.contextSize}
            hw={hw}
            initialUrl={props.initialUrl}
            theme={theme}
            onLock={setInstallLocked}
            onFlash={setFlash}
            onLaunch={handleLaunch}
          />
        ) : active === 'tune' ? (
          <TuneTab hw={hw} onFlash={setFlash} />
        ) : active === 'help' ? (
          <HelpTab />
        ) : (
          <SettingsTab settings={settings} onChange={updateSettings} onFlash={setFlash} />
        )}
      </Box>
      <Box width={cols} paddingX={1}>
        <Footer active={active} flash={flash} installLocked={installLocked} theme={theme} />
      </Box>
    </Box>
  );
}

function Header({
  hw,
  ollama,
  now,
  theme,
}: {
  hw: HardwareProfile | null;
  ollama: OllamaStatus | null;
  now: Date;
  theme: ReturnType<typeof getTheme>;
}) {
  const clock = now.toTimeString().slice(0, 8);
  const ollamaBadge =
    ollama?.status === 'ok'
      ? { text: `${icon.on} ollama`, color: theme.success }
      : ollama?.status === 'no-server'
        ? { text: `${icon.partial} ollama down`, color: theme.warning }
        : ollama?.status === 'no-binary'
          ? { text: `${icon.off} ollama missing`, color: theme.danger }
          : { text: `${icon.pending} probing`, color: theme.muted };

  const authorLink = APP.author.url || APP.homepage;
  return (
    <Box width="100%" justifyContent="space-between">
      <Box>
        <Text bold color={theme.primary as any}>{APP.binary} </Text>
        <Text color={theme.accent as any}>v{APP.version} </Text>
        <Text color={theme.muted as any}>· </Text>
        <Text color={theme.success as any}>{APP.license} </Text>
        <Text color={theme.muted as any}>· </Text>
        <Text color={theme.text as any}>{APP.author.name}</Text>
        {authorLink && <Text color={theme.muted as any}> ({authorLink})</Text>}
        {hw && (
          <Text color={theme.muted as any}>
            {'  '}· {hw.gpuName?.replace(/NVIDIA GeForce /, '') ?? 'no GPU'}
            {hw.vramMiB > 0 ? ` · ${formatBytes(hw.vramMiB * 1024 * 1024)} VRAM` : ''} · {formatBytes(hw.ramMiB * 1024 * 1024)} RAM · {hw.cpuCores}c
          </Text>
        )}
      </Box>
      <Box>
        <Text color={ollamaBadge.color as any}>{ollamaBadge.text}</Text>
        <Text color={theme.muted as any}>  {clock}</Text>
      </Box>
    </Box>
  );
}

function TabBar({
  active,
  labels,
  hotkey,
  theme,
}: {
  active: TabKey;
  labels: Record<TabKey, string>;
  hotkey: Record<TabKey, string>;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <Box>
      {TAB_ORDER.map((k) => {
        const isActive = k === active;
        return (
          <Box key={k} marginRight={1}>
            <Text
              backgroundColor={isActive ? (theme.bgActive as any) : undefined}
              color={isActive ? (theme.bgActiveFg as any) : (theme.muted as any)}
              bold={isActive}
            >
              {' '}
              [{hotkey[k]}] {labels[k]}{' '}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function Footer({
  active,
  flash,
  installLocked,
  theme,
}: {
  active: TabKey;
  flash: string | null;
  installLocked: boolean;
  theme: ReturnType<typeof getTheme>;
}) {
  if (flash) return <Text color={theme.success as any}>{flash}</Text>;
  if (installLocked) return <Text color={theme.warning as any}>Install flow has focus — use its keys until it completes or cancels.</Text>;
  const hints: Record<TabKey, string> = {
    dashboard: t('hints.dashboard.grid'),
    models: t('hints.models'),
    install: t('hints.install'),
    tune: t('hints.tune'),
    help: t('hints.help'),
    settings: t('hints.settings'),
  };
  return <Text color={theme.muted as any}>{hints[active]}   ·   {t('hints.global')}</Text>;
}
