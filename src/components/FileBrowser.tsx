import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { readdir, mkdir, rm, stat } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';

interface Props {
  initialPath: string;
  onSelect: (absolutePath: string) => void;
  onCancel?: () => void;
  defaultFolderName?: string;
}

type Entry = { name: string; isDir: boolean };
type Mode =
  | { kind: 'browse' }
  | { kind: 'new-folder'; value: string }
  | { kind: 'confirm-delete'; target: string }
  | { kind: 'error'; message: string };

const MAX_VISIBLE = 14;

export default function FileBrowser({ initialPath, onSelect, onCancel, defaultFolderName }: Props) {
  const [cwd, setCwd] = useState(resolve(initialPath));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [scroll, setScroll] = useState(0);

  const loadEntries = async (path: string) => {
    try {
      const names = await readdir(path);
      const list: Entry[] = [];
      for (const n of names) {
        try {
          const s = await stat(join(path, n));
          list.push({ name: n, isDir: s.isDirectory() });
        } catch {
          // skip broken symlinks / permission denied
        }
      }
      list.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      setEntries(list);
      setCursor(0);
      setScroll(0);
    } catch (err) {
      setMode({
        kind: 'error',
        message: `Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  useEffect(() => {
    ensurePath(cwd).then(() => loadEntries(cwd));
  }, [cwd]);

  useEffect(() => {
    if (cursor < scroll) setScroll(cursor);
    if (cursor >= scroll + MAX_VISIBLE) setScroll(cursor - MAX_VISIBLE + 1);
  }, [cursor]);

  useInput((input, key) => {
    if (mode.kind === 'new-folder') {
      // handled by TextInput
      return;
    }
    if (mode.kind === 'confirm-delete') {
      if (input === 'y' || input === 'Y') {
        rm(join(cwd, mode.target), { recursive: true, force: true })
          .then(() => {
            setMode({ kind: 'browse' });
            loadEntries(cwd);
          })
          .catch((err) =>
            setMode({ kind: 'error', message: `Delete failed: ${err instanceof Error ? err.message : err}` }),
          );
      } else if (input === 'n' || input === 'N' || key.escape) {
        setMode({ kind: 'browse' });
      }
      return;
    }
    if (mode.kind === 'error') {
      if (key.return || key.escape) setMode({ kind: 'browse' });
      return;
    }

    // browse mode
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(entries.length - 1, c + 1));
    else if (key.return || key.rightArrow) {
      const entry = entries[cursor];
      if (entry && entry.isDir) setCwd(join(cwd, entry.name));
    } else if (key.leftArrow || key.backspace || input === '..' || input === 'h') {
      const parent = parse(cwd).dir;
      if (parent && parent !== cwd) setCwd(parent);
    } else if (input === 's' || input === 'S') {
      onSelect(cwd);
    } else if (input === 'n' || input === 'N') {
      setMode({ kind: 'new-folder', value: defaultFolderName ?? '' });
    } else if (input === 'd' || input === 'D') {
      const entry = entries[cursor];
      if (entry && entry.isDir) setMode({ kind: 'confirm-delete', target: entry.name });
    } else if (key.escape) {
      onCancel?.();
    }
  });

  const visible = entries.slice(scroll, scroll + MAX_VISIBLE);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>{icon.pointer} </Text>
        <Text color="white">{cwd}</Text>
      </Box>
      <Text color="gray">
        {t('filebrowser.hints', { up: icon.arrowUp, down: icon.arrowDown, left: icon.arrowLeft, right: icon.arrowRight })}
      </Text>

      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        {visible.length === 0 && <Text color="gray">{t('filebrowser.empty')}</Text>}
        {visible.map((entry, i) => {
          const idx = i + scroll;
          const isCursor = idx === cursor;
          return (
            <Text key={entry.name} color={isCursor ? 'cyan' : entry.isDir ? 'white' : 'gray'} bold={isCursor}>
              {isCursor ? '❯ ' : '  '}
              {entry.isDir ? `${icon.pointerSmall} ` : `${icon.bullet} `}
              {entry.name}
            </Text>
          );
        })}
        {entries.length > MAX_VISIBLE && (
          <Text color="gray">
            {t('filebrowser.showing', { from: scroll + 1, to: Math.min(scroll + MAX_VISIBLE, entries.length), total: entries.length })}
          </Text>
        )}
      </Box>

      {mode.kind === 'new-folder' && (
        <Box flexDirection="column" marginTop={1}>
          {defaultFolderName && (
            <Text color="gray">{t('filebrowser.suggested')}</Text>
          )}
          <Box>
            <Text color="yellow">{t('filebrowser.newFolder')} </Text>
            <TextInput
              value={mode.value}
            onChange={(v) => setMode({ kind: 'new-folder', value: v })}
              onSubmit={async (v) => {
                const name = v.trim();
                if (!name) {
                  setMode({ kind: 'browse' });
                  return;
                }
                try {
                  const newPath = join(cwd, name);
                  await mkdir(newPath, { recursive: true });
                  setMode({ kind: 'browse' });
                  setCwd(newPath);
                } catch (err) {
                  setMode({
                    kind: 'error',
                    message: `Cannot create folder: ${err instanceof Error ? err.message : err}`,
                  });
                }
              }}
            />
          </Box>
        </Box>
      )}

      {mode.kind === 'confirm-delete' && (
        <Box marginTop={1}>
          <Text color="red">{icon.warning} {t('filebrowser.confirmDelete', { name: mode.target })}</Text>
        </Box>
      )}

      {mode.kind === 'error' && (
        <Box marginTop={1}>
          <Text color="red">{icon.cross} {mode.message}  </Text>
          <Text color="gray">{t('common.enterContinue')}</Text>
        </Box>
      )}
    </Box>
  );
}

async function ensurePath(path: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    try {
      await mkdir(path, { recursive: true });
    } catch {
      // ignore — loadEntries will surface a proper error
    }
  }
}
