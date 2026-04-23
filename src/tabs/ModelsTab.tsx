import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { execa } from 'execa';
import { rm } from 'node:fs/promises';
import { sampleOllamaList, sampleOllamaPs, type RegisteredModel, type LoadedModel } from '../live.js';
import { useInterval } from '../hooks.js';
import { icon } from '../icons.js';
import LaunchMenu, { type LaunchSelection } from '../components/LaunchMenu.js';
import type { Theme } from '../theme.js';
import { t } from '../i18n.js';
import {
  findInstallation,
  forgetInstallation,
  loadSettings,
  type Installation,
} from '../settings.js';
import { detectHardware, type HardwareProfile } from '../hardware.js';
import { inspectInstallDir, reinstallInstallation, type DirInspection } from '../reinstall.js';
import { backupDirectory, resolveBackupRoot, type BackupProgress } from '../backup.js';
import { formatBytes } from '../format.js';

interface Props {
  theme: Theme;
  onFlash: (msg: string) => void;
  onLaunch: (sel: LaunchSelection) => void;
}

type Row =
  | { kind: 'installed'; model: RegisteredModel; install: Installation | null }
  | { kind: 'orphan'; install: Installation; inspection: DirInspection };

type Mode =
  | { kind: 'list' }
  | { kind: 'confirm-delete'; row: Row }
  | { kind: 'confirm-deep-delete'; row: Row; install: Installation | null }
  | { kind: 'deleting'; tag: string; deep: boolean }
  | { kind: 'reinstalling'; install: Installation; step: string }
  | { kind: 'backing-up'; subject: { tag: string; dir: string; repoId?: string; quant?: string }; progress: BackupProgress | null }
  | { kind: 'launch-menu'; defaultModel: string | null };

export default function ModelsTab({ theme, onFlash, onLaunch }: Props) {
  const [registered, setRegistered] = useState<RegisteredModel[]>([]);
  const [loaded, setLoaded] = useState<LoadedModel[]>([]);
  const [orphans, setOrphans] = useState<{ install: Installation; inspection: DirInspection }[]>([]);
  const [installIndex, setInstallIndex] = useState<Installation[]>([]);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [loading, setLoading] = useState(true);
  const [hw, setHw] = useState<HardwareProfile | null>(null);

  const refresh = async () => {
    const [ms, ps, settings] = await Promise.all([sampleOllamaList(), sampleOllamaPs(), loadSettings()]);
    setRegistered(ms);
    setLoaded(ps);
    setInstallIndex(settings.installations);
    const registeredTags = new Set(ms.map((r) => r.name));
    const orphanCandidates = settings.installations.filter((i) => !registeredTags.has(i.tag));
    const inspected = await Promise.all(
      orphanCandidates.map(async (i) => ({ install: i, inspection: await inspectInstallDir(i.dir) })),
    );
    setOrphans(inspected);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    detectHardware().then(setHw);
  }, []);
  useInterval(refresh, 4000);

  const rows: Row[] = [
    ...registered.map<Row>((m) => ({
      kind: 'installed',
      model: m,
      install: installIndex.find((i) => i.tag === m.name) ?? null,
    })),
    ...orphans.map<Row>((o) => ({ kind: 'orphan', install: o.install, inspection: o.inspection })),
  ];

  const safeCursor = Math.min(cursor, Math.max(0, rows.length - 1));
  const activeRow = rows[safeCursor];

  const shallowDelete = async (tag: string) => {
    setMode({ kind: 'deleting', tag, deep: false });
    try {
      await execa('ollama', ['rm', tag]);
      await forgetInstallation(tag);
      onFlash(`Removed ${tag}`);
    } catch (err) {
      onFlash(`Failed to remove: ${err instanceof Error ? err.message : err}`);
    }
    setMode({ kind: 'list' });
    refresh();
  };

  const deepDelete = async (tag: string, install: Installation) => {
    setMode({ kind: 'deleting', tag, deep: true });
    try {
      await execa('ollama', ['rm', tag]);
      try {
        await rm(install.dir, { recursive: true, force: true });
      } catch {
        /* already gone */
      }
      await forgetInstallation(tag);
      onFlash(`${t('models.deepDelete.done')} (${install.dir})`);
    } catch (err) {
      onFlash(`Failed: ${err instanceof Error ? err.message : err}`);
    }
    setMode({ kind: 'list' });
    refresh();
  };

  const reinstall = async (install: Installation) => {
    if (!hw) return;
    setMode({ kind: 'reinstalling', install, step: t('models.reinstall.running') });
    try {
      const result = await reinstallInstallation(install, hw);
      onFlash(
        result.modelfileGenerated
          ? `${t('models.reinstall.done')} · ${result.tag} · Modelfile generated`
          : `${t('models.reinstall.done')} · ${result.tag}`,
      );
    } catch (err) {
      onFlash(`${t('models.reinstall.failed')}: ${err instanceof Error ? err.message : err}`);
    }
    setMode({ kind: 'list' });
    refresh();
  };

  const backup = async (subject: { tag: string; dir: string; repoId?: string; quant?: string }) => {
    const settings = await loadSettings();
    const backupsRoot = resolveBackupRoot((settings as any).backupsDir);
    setMode({ kind: 'backing-up', subject, progress: null });
    try {
      const result = await backupDirectory(subject, backupsRoot, (progress) =>
        setMode({ kind: 'backing-up', subject, progress }),
      );
      const ratio = result.originalBytes > 0 ? (result.compressedBytes / result.originalBytes) * 100 : 0;
      onFlash(
        `${t('models.backup.done')}: ${formatBytes(result.compressedBytes)} (${ratio.toFixed(0)}%) @ ${result.zipPath}`,
      );
    } catch (err) {
      onFlash(`${t('models.backup.failed')}: ${err instanceof Error ? err.message : err}`);
    }
    setMode({ kind: 'list' });
  };

  useInput(async (input, key) => {
    if (mode.kind === 'launch-menu' || mode.kind === 'deleting' || mode.kind === 'reinstalling' || mode.kind === 'backing-up') return;

    if (mode.kind === 'confirm-delete') {
      if (input === 'y' || input === 'Y' || key.return) {
        const tag = mode.row.kind === 'installed' ? mode.row.model.name : mode.row.install.tag;
        await shallowDelete(tag);
      } else if (input === 'n' || input === 'N' || key.escape) {
        setMode({ kind: 'list' });
      }
      return;
    }
    if (mode.kind === 'confirm-deep-delete') {
      if (input === 'y' || input === 'Y' || key.return) {
        const tag = mode.row.kind === 'installed' ? mode.row.model.name : mode.row.install.tag;
        if (mode.install) await deepDelete(tag, mode.install);
        else await shallowDelete(tag);
      } else if (input === 'n' || input === 'N' || key.escape) {
        setMode({ kind: 'list' });
      }
      return;
    }

    // list mode
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(Math.max(0, rows.length - 1), c + 1));
    else if ((input === 'd' || input === 'D') && key.meta) {
      if (!activeRow) return;
      const install = activeRow.kind === 'installed' ? (activeRow.install ?? (await findInstallation(activeRow.model.name))) : activeRow.install;
      setMode({ kind: 'confirm-deep-delete', row: activeRow, install });
    } else if (input === 'd' || input === 'D') {
      if (!activeRow) return;
      setMode({ kind: 'confirm-delete', row: activeRow });
    } else if (input === 'r' || input === 'R') {
      refresh();
      onFlash('Refreshed');
    } else if (input === 'l' || input === 'L') {
      if (!activeRow) return;
      const name = activeRow.kind === 'installed' ? activeRow.model.name : activeRow.install.tag;
      setMode({ kind: 'launch-menu', defaultModel: name });
    } else if (input === 'g' || input === 'G') {
      setMode({ kind: 'launch-menu', defaultModel: null });
    } else if (input === 'i' || input === 'I') {
      if (activeRow?.kind === 'orphan' && (activeRow.inspection.kind === 'ready' || activeRow.inspection.kind === 'needs-generation')) {
        await reinstall(activeRow.install);
      } else {
        onFlash('Select an orphan row (Available section) to reinstall.');
      }
    } else if (input === 'b' || input === 'B') {
      if (!activeRow) return;
      if (activeRow.kind === 'installed') {
        const i = activeRow.install;
        if (i) await backup({ tag: i.tag, dir: i.dir, repoId: i.repoId, quant: i.quant });
        else onFlash('This model was not installed via hfo — no directory known to back up.');
      } else {
        const i = activeRow.install;
        await backup({ tag: i.tag, dir: i.dir, repoId: i.repoId, quant: i.quant });
      }
    }
  });

  if (mode.kind === 'launch-menu') {
    return (
      <LaunchMenu
        theme={theme}
        defaultModel={mode.defaultModel}
        onCancel={() => setMode({ kind: 'list' })}
        onConfirm={(sel) => {
          setMode({ kind: 'list' });
          onLaunch(sel);
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.primary as any}>{t('models.title')}</Text>
        {loading && <Text color={theme.muted as any}> <Spinner type="dots" /></Text>}
        <Text color={theme.muted as any}>  ·  {registered.length} registered  ·  {loaded.length} loaded  ·  {orphans.length} available to reinstall</Text>
      </Box>

      {/* Installed table */}
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border as any} paddingX={1}>
        <Box>
          <Text bold color={theme.muted as any}>{'NAME'.padEnd(36)}</Text>
          <Text bold color={theme.muted as any}>{'SIZE'.padEnd(10)}</Text>
          <Text bold color={theme.muted as any}>{'MODIFIED'.padEnd(18)}</Text>
          <Text bold color={theme.muted as any}>STATE</Text>
        </Box>
        {registered.length === 0 && !loading && (
          <Text color={theme.muted as any}>  {t('models.empty')}</Text>
        )}
        {rows.map((row, idx) => {
          if (row.kind !== 'installed') return null;
          const m = row.model;
          const isCursor = idx === safeCursor;
          const live = loaded.find((l) => l.name === m.name);
          return (
            <Box key={m.name}>
              <Text color={isCursor ? (theme.accent as any) : undefined} bold={isCursor}>
                {(isCursor ? `${icon.pointer} ` : '  ') + m.name.padEnd(34)}
              </Text>
              <Text color={theme.text as any}>{m.size.padEnd(10)}</Text>
              <Text color={theme.muted as any}>{m.modified.padEnd(18)}</Text>
              <Text color={live ? (theme.success as any) : (theme.muted as any)}>
                {live ? `${icon.on} ${t('models.state.loaded')} · ${live.processor}` : `${icon.off} ${t('models.state.idle')}`}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Orphans section */}
      {orphans.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.warning as any}>{t('models.orphan.section')}</Text>
          <Box flexDirection="column" borderStyle="round" borderColor={theme.warning as any} paddingX={1}>
            <Box>
              <Text bold color={theme.muted as any}>{'TAG'.padEnd(36)}</Text>
              <Text bold color={theme.muted as any}>{'QUANT'.padEnd(10)}</Text>
              <Text bold color={theme.muted as any}>{'DIR'.padEnd(40)}</Text>
              <Text bold color={theme.muted as any}>STATE</Text>
            </Box>
            {rows.map((row, idx) => {
              if (row.kind !== 'orphan') return null;
              const { install, inspection } = row;
              const isCursor = idx === safeCursor;
              const stateLabel =
                inspection.kind === 'ready' ? t('models.orphan.state.ready') :
                inspection.kind === 'needs-generation' ? t('models.orphan.state.generate') :
                inspection.kind === 'missing-gguf' ? t('models.orphan.state.missingGguf') :
                t('models.orphan.state.missingDir');
              const stateColor =
                inspection.kind === 'ready' ? theme.success :
                inspection.kind === 'needs-generation' ? theme.info :
                theme.danger;
              return (
                <Box key={install.tag}>
                  <Text color={isCursor ? (theme.accent as any) : undefined} bold={isCursor}>
                    {(isCursor ? `${icon.pointer} ` : '  ') + install.tag.padEnd(34)}
                  </Text>
                  <Text color={theme.text as any}>{(install.quant || '—').padEnd(10)}</Text>
                  <Text color={theme.muted as any}>{shortenPath(install.dir, 38).padEnd(40)}</Text>
                  <Text color={stateColor as any}>{stateLabel}</Text>
                </Box>
              );
            })}
          </Box>
          <Text color={theme.muted as any}>{t('models.orphan.explain')}</Text>
        </Box>
      )}

      <Box marginTop={1} borderStyle="single" borderColor={theme.warning as any} paddingX={1}>
        <Text color={theme.warning as any}>{t('models.launch.explain')}</Text>
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor={theme.info as any} paddingX={1}>
        <Text color={theme.info as any}>{t('models.backup.explain')}</Text>
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor={theme.danger as any} paddingX={1}>
        <Text color={theme.danger as any}>{t('models.deepDelete.explain')}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted as any}>{t('hints.models')}</Text>
      </Box>

      {mode.kind === 'confirm-delete' && (
        <Box marginTop={1} borderStyle="round" borderColor={theme.danger as any} paddingX={1}>
          <Text color={theme.danger as any}>
            {icon.warning} {t('models.confirmDelete')}   {mode.row.kind === 'installed' ? mode.row.model.name : mode.row.install.tag}   (y/N)
          </Text>
        </Box>
      )}
      {mode.kind === 'confirm-deep-delete' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.danger as any} paddingX={1}>
          <Text color={theme.danger as any} bold>{icon.warning} {t('models.deepDelete.title')}</Text>
          <Text color={theme.text as any}>Tag: <Text bold>{mode.row.kind === 'installed' ? mode.row.model.name : mode.row.install.tag}</Text></Text>
          {mode.install ? (
            <>
              <Text color={theme.text as any}>Directory: <Text bold>{mode.install.dir}</Text></Text>
              <Text color={theme.muted as any}>Repo: {mode.install.repoId}  ·  Quant: {mode.install.quant}  ·  Installed {mode.install.installedAt.slice(0, 10)}</Text>
            </>
          ) : (
            <Text color={theme.warning as any}>{t('models.deepDelete.noRecord')}</Text>
          )}
          <Text color={theme.muted as any}>(y confirm / N cancel)</Text>
        </Box>
      )}
      {mode.kind === 'deleting' && (
        <Text color={theme.warning as any}>
          <Spinner type="dots" /> {mode.deep ? 'Removing tag + directory' : 'Removing tag'}: {mode.tag}
        </Text>
      )}
      {mode.kind === 'reinstalling' && (
        <Box marginTop={1} borderStyle="round" borderColor={theme.info as any} paddingX={1}>
          <Text color={theme.info as any}>
            <Spinner type="dots" /> {t('models.reinstall.running')}: {mode.install.tag}  ·  {mode.install.dir}
          </Text>
        </Box>
      )}
      {mode.kind === 'backing-up' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.info as any} paddingX={1}>
          <Text color={theme.info as any}>
            <Spinner type="dots" /> {t('models.backup.running')}: {mode.subject.tag}
          </Text>
          {mode.progress && (
            <Text color={theme.muted as any}>
              {t('models.backup.progress')}: {formatBytes(mode.progress.processedBytes)} / {formatBytes(mode.progress.totalBytes)}  ·  {mode.progress.fileCount} files  ·  {mode.progress.currentFile}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

function shortenPath(full: string, max: number): string {
  if (full.length <= max) return full;
  const keep = Math.floor((max - 3) / 2);
  return `${full.slice(0, keep)}...${full.slice(full.length - keep)}`;
}
