import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { HardwareProfile } from '../core/hardware.js';
import type { OllamaStatus } from '../infra/ollama.js';
import { formatBytes, progressBar } from '../ui/format.js';
import { hfSearchUrl, hfSearchUrlForKeyword, scoreHardware, tierFor } from '../core/capacity.js';
import { scoreColor } from '../core/scoring.js';
import { useInterval } from '../ui/hooks.js';
import { sampleGpu, sampleOllamaPs, sampleRam, type LiveGpu, type LiveRam, type LoadedModel } from '../core/live.js';
import { icon } from '../ui/icons.js';
import { openUrl } from '../infra/platform.js';
import type { Theme } from '../ui/theme.js';
import { t } from '../ui/i18n.js';

type PanelKey = 'live' | 'capacity' | 'picks' | 'browse';
const PANELS: PanelKey[] = ['live', 'capacity', 'picks', 'browse'];

interface Props {
  hw: HardwareProfile;
  ollama: OllamaStatus;
  theme: Theme;
  refreshIntervalMs: number;
  bodyRows: number;
  onFlash: (msg: string) => void;
}

export default function DashboardTab({ hw, ollama, theme, refreshIntervalMs, bodyRows, onFlash }: Props) {
  const tier = tierFor(hw);
  const power = scoreHardware(hw);

  const [gpu, setGpu] = useState<LiveGpu | null>(null);
  const [ram, setRam] = useState<LiveRam | null>(null);
  const [ps, setPs] = useState<LoadedModel[]>([]);
  const [focus, setFocus] = useState<PanelKey | null>(null);
  const [linkCursor, setLinkCursor] = useState(0);
  const [pickCursor, setPickCursor] = useState(0);

  const refreshLive = async () => {
    setGpu(await sampleGpu());
    setRam(await sampleRam());
    setPs(await sampleOllamaPs());
  };

  useEffect(() => {
    refreshLive();
  }, []);
  useInterval(refreshLive, refreshIntervalMs);

  const links = [
    { label: 'Trending · GGUF · text-generation', url: hfSearchUrl(tier, { sort: 'trending' }) },
    { label: 'Most downloaded', url: hfSearchUrl(tier, { sort: 'downloads' }) },
    { label: 'Most liked (7d)', url: hfSearchUrl(tier, { sort: 'likes7d' }) },
    ...tier.searchKeywords.slice(0, 3).map((kw) => ({ label: `Keyword: ${kw}`, url: hfSearchUrlForKeyword(kw) })),
  ];
  const pickLinks = tier.picks.map((p) => ({
    label: p.repoId,
    url: `https://huggingface.co/${p.repoId}`,
    note: p.note,
  }));

  useInput(async (input, key) => {
    if (key.meta && (key.upArrow || key.downArrow)) {
      const dir = key.downArrow ? 1 : -1;
      const curIdx = focus ? PANELS.indexOf(focus) : -1;
      const nextIdx = (curIdx + dir + PANELS.length) % PANELS.length;
      setFocus(PANELS[nextIdx]);
      setLinkCursor(0);
      setPickCursor(0);
      return;
    }
    if ((key.escape || input === 'b' || input === 'B') && focus) {
      setFocus(null);
      return;
    }
    if (input === 'r' || input === 'R') {
      refreshLive();
      onFlash(t('dashboard.flash.refreshed'));
      return;
    }
    if (focus === 'browse') {
      if (key.upArrow) setLinkCursor((c) => Math.max(0, c - 1));
      else if (key.downArrow) setLinkCursor((c) => Math.min(links.length - 1, c + 1));
      else if (key.return) {
        const chosen = links[linkCursor];
        const ok = await openUrl(chosen.url);
        onFlash(ok ? `Opened: ${chosen.label}` : `Failed to open URL — copy it manually.`);
      }
    } else if (focus === 'picks') {
      if (key.upArrow) setPickCursor((c) => Math.max(0, c - 1));
      else if (key.downArrow) setPickCursor((c) => Math.min(pickLinks.length - 1, c + 1));
      else if (key.return) {
        const chosen = pickLinks[pickCursor];
        const ok = await openUrl(chosen.url);
        onFlash(ok ? `Opened HF page for ${chosen.label}` : `Failed to open URL — copy it manually.`);
      }
    }
  });

  const gpuUsedRatio = gpu ? gpu.vramUsedMiB / gpu.vramTotalMiB : 0;
  const ramUsedRatio = ram ? ram.usedPct / 100 : 0;

  // Grid math — split bodyRows into 2 rows of fixed height so all 4 cards align.
  const gridRowHeight = Math.max(8, Math.floor((bodyRows - 1) / 2));

  if (focus) {
    const fullHeight = Math.max(8, bodyRows - 3);
    return (
      <Box flexDirection="column" height={bodyRows}>
        <Box marginBottom={1}>
          <Text color={theme.warning as any} bold>{t('dashboard.backHint')}</Text>
        </Box>
        {focus === 'live' && (
          <LivePanel theme={theme} gpu={gpu} ram={ram} ps={ps} gpuUsedRatio={gpuUsedRatio} ramUsedRatio={ramUsedRatio} expanded height={fullHeight} />
        )}
        {focus === 'capacity' && (
          <CapacityPanel theme={theme} tier={tier} power={power} ollama={ollama} expanded height={fullHeight} />
        )}
        {focus === 'picks' && (
          <PicksPanel theme={theme} picks={pickLinks} cursor={pickCursor} expanded height={fullHeight} />
        )}
        {focus === 'browse' && (
          <BrowsePanel theme={theme} links={links} cursor={linkCursor} expanded height={fullHeight} />
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={bodyRows}>
      <Box flexDirection="row" gap={1} height={gridRowHeight}>
        <Box width="50%" height={gridRowHeight}>
          <LivePanel theme={theme} gpu={gpu} ram={ram} ps={ps} gpuUsedRatio={gpuUsedRatio} ramUsedRatio={ramUsedRatio} height={gridRowHeight} />
        </Box>
        <Box width="50%" height={gridRowHeight}>
          <CapacityPanel theme={theme} tier={tier} power={power} ollama={ollama} height={gridRowHeight} />
        </Box>
      </Box>
      <Box flexDirection="row" gap={1} marginTop={1} height={gridRowHeight}>
        <Box width="50%" height={gridRowHeight}>
          <PicksPanel theme={theme} picks={pickLinks} cursor={pickCursor} height={gridRowHeight} />
        </Box>
        <Box width="50%" height={gridRowHeight}>
          <BrowsePanel theme={theme} links={links} cursor={linkCursor} height={gridRowHeight} />
        </Box>
      </Box>
    </Box>
  );
}

/* ─── Panels ──────────────────────────────────────────────────────────── */

function LivePanel(props: {
  theme: Theme;
  gpu: LiveGpu | null;
  ram: LiveRam | null;
  ps: LoadedModel[];
  gpuUsedRatio: number;
  ramUsedRatio: number;
  expanded?: boolean;
  height: number;
}) {
  const { theme, gpu, ram, ps, gpuUsedRatio, ramUsedRatio, expanded, height } = props;
  const barWidth = expanded ? 60 : 22;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary as any} paddingX={1} height={height} width="100%">
      <Text bold color={theme.primary as any}>{t('dashboard.live')}</Text>
      <Text>
        {t('dashboard.gpu')}:{' '}
        <Text color={gpu?.utilPct != null && gpu.utilPct > 70 ? (theme.warning as any) : (theme.success as any)}>
          {gpu?.utilPct != null ? `${gpu.utilPct.toString().padStart(3)}%` : '  --'}
        </Text>
        <Text color={theme.muted as any}>
          {'  '}
          {gpu?.tempC != null ? `${gpu.tempC}C` : ''}{' '}
          {gpu?.powerW != null ? `· ${Math.round(gpu.powerW)}W` : ''}
        </Text>
      </Text>
      <Text>
        {t('dashboard.vram')} [{progressBar(gpuUsedRatio, barWidth)}] {(gpuUsedRatio * 100).toFixed(0)}%
      </Text>
      {gpu && (
        <Text color={theme.muted as any}>
          {formatBytes(gpu.vramUsedMiB * 1024 * 1024)} / {formatBytes(gpu.vramTotalMiB * 1024 * 1024)}
        </Text>
      )}
      <Text>
        {t('dashboard.ram')}  [{progressBar(ramUsedRatio, barWidth)}] {(ramUsedRatio * 100).toFixed(0)}%
      </Text>
      {ram && (
        <Text color={theme.muted as any}>
          {formatBytes(ram.usedMiB * 1024 * 1024)} / {formatBytes(ram.totalMiB * 1024 * 1024)}
        </Text>
      )}
      <Text bold>{t('dashboard.loaded')} ({ps.length})</Text>
      {ps.length === 0 && <Text color={theme.muted as any}>  {t('dashboard.none')}</Text>}
      {ps.slice(0, expanded ? 10 : 2).map((m) => (
        <Text key={m.name} color={theme.text as any}>
          {icon.bullet} <Text color={theme.primary as any}>{m.name}</Text>{' '}
          <Text color={theme.muted as any}>{m.processor} · {m.size} · until {m.until}</Text>
        </Text>
      ))}
    </Box>
  );
}

function CapacityPanel(props: {
  theme: Theme;
  tier: ReturnType<typeof tierFor>;
  power: ReturnType<typeof scoreHardware>;
  ollama: OllamaStatus;
  expanded?: boolean;
  height: number;
}) {
  const { theme, tier, power, ollama, height } = props;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warning as any} paddingX={1} height={height} width="100%">
      <Text bold color={theme.warning as any}>{t('dashboard.capacity')}</Text>
      <Text>
        Overall{' '}
        <Text color={scoreColor(power.score)} bold>
          {power.score}/100
        </Text>
        <Text color={theme.muted as any}>  · </Text>
        <Text bold>{tier.label}</Text>
      </Text>
      <Text color={theme.muted as any}>
        GPU <Text color={scoreColor(power.gpuScore)}>{power.gpuScore}</Text>{' '}/ RAM{' '}
        <Text color={scoreColor(power.ramScore)}>{power.ramScore}</Text>{' '}/ CPU{' '}
        <Text color={scoreColor(power.cpuScore)}>{power.cpuScore}</Text>
      </Text>
      <Text color={theme.muted as any}>{tier.summary}</Text>
      <Text bold>{t('dashboard.what')}</Text>
      {tier.runs.map((r) => (
        <Text key={r.text}>
          {'  '}
          <Text color={r.level === 'ok' ? (theme.success as any) : r.level === 'warn' ? (theme.warning as any) : (theme.danger as any)}>
            {r.level === 'ok' ? icon.tick : r.level === 'warn' ? icon.warning : icon.cross}
          </Text>
          <Text> {r.text}</Text>
        </Text>
      ))}
      <Text bold>Ollama</Text>
      <Text color={theme.muted as any}>
        {ollama.status === 'ok'
          ? `${icon.tick} ${t('ollama.ready')} (${ollama.version})`
          : ollama.status === 'no-server'
            ? `${icon.warning} ${t('ollama.down')}`
            : `${icon.cross} ${t('ollama.missing')}`}
      </Text>
    </Box>
  );
}

function PicksPanel(props: {
  theme: Theme;
  picks: { label: string; url: string; note: string }[];
  cursor: number;
  expanded?: boolean;
  height: number;
}) {
  const { theme, picks, cursor, expanded, height } = props;
  const maxItems = expanded ? 20 : Math.max(2, height - 3);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.success as any} paddingX={1} height={height} width="100%">
      <Text bold color={theme.success as any}>
        {t('dashboard.picks')}
        {expanded && <Text color={theme.muted as any}>  ·  Alt+{icon.arrowUp}/{icon.arrowDown} cycle panels  ·  Enter opens selected</Text>}
      </Text>
      {picks.slice(0, maxItems).map((p, i) => {
        const isCursor = expanded && i === cursor;
        return (
          <Box key={p.url} flexDirection={expanded ? 'column' : 'row'}>
            <Text>
              <Text color={isCursor ? (theme.accent as any) : undefined} bold={isCursor}>
                {isCursor ? `${icon.pointer} ` : '  '}
              </Text>
              <Text color={theme.primary as any}>{p.label}</Text>
            </Text>
            {expanded && <Text color={theme.muted as any}>    {p.note}</Text>}
          </Box>
        );
      })}
      {!expanded && <Text color={theme.muted as any}>Alt+{icon.arrowDown} to focus this panel</Text>}
    </Box>
  );
}

function BrowsePanel(props: {
  theme: Theme;
  links: { label: string; url: string }[];
  cursor: number;
  expanded?: boolean;
  height: number;
}) {
  const { theme, links, cursor, expanded, height } = props;
  const maxItems = expanded ? 20 : Math.max(2, height - 3);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent as any} paddingX={1} height={height} width="100%">
      <Text bold color={theme.accent as any}>
        {t('dashboard.browse')}
        {expanded && <Text color={theme.muted as any}>  ·  Enter opens in default browser</Text>}
      </Text>
      {links.slice(0, maxItems).map((l, i) => {
        const isCursor = expanded && i === cursor;
        return (
          <Box key={l.url} flexDirection="column">
            <Text>
              <Text color={isCursor ? (theme.accent as any) : undefined} bold={isCursor}>
                {isCursor ? `${icon.pointer} ` : '  '}
              </Text>
              <Text color={theme.primary as any}>{l.label}</Text>
            </Text>
            {expanded && <Text color={theme.muted as any}>    {l.url}</Text>}
          </Box>
        );
      })}
      {!expanded && <Text color={theme.muted as any}>Alt+{icon.arrowDown} to focus · Enter opens a link</Text>}
    </Box>
  );
}
