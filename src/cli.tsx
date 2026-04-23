#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import { resolve } from 'node:path';
import Shell from './Shell.js';
import { loadSettings } from './settings.js';
import { runLaunch, findTarget, type LaunchId } from './launch.js';
import type { LaunchSelection } from './components/LaunchMenu.js';
import {
  cmdView,
  cmdList,
  cmdTune,
  cmdBackup,
  cmdRestore,
  cmdDelete,
  cmdVersion,
} from './headless.js';

const cli = meow(
  `
  Usage
    $ hfo                                  # open the fullscreen TUI
    $ hfo <hf-url-or-repo-id>              # open TUI pre-filled on the Install tab

  Headless actions (run and exit without the TUI)
    $ hfo --view                           # print hardware, capacity, picks, HF search URLs
    $ hfo --list                           # list installed + orphan models
    $ hfo --tune                           # apply the ~90% capacity Ollama env profile
    $ hfo --backup <tag>                   # create a .zip backup of the model's folder
    $ hfo --restore <zip>                  # extract a backup and re-register with Ollama
    $ hfo --delete <tag>                   # remove the tag from Ollama
    $ hfo --delete <tag> --deep            # remove tag AND delete its folder on disk
    $ hfo --launch <integration>           # run ollama launch <integration> after optional TUI

  Other flags
    --dir, -d        Base dir for the install file browser (default: settings.modelDir)
    --token, -t      HuggingFace token for gated/private repos (also HF_TOKEN env)
    --code, -c       Mark installs as code-specialized (SYSTEM prompt tweak)
    --ctx            Force context size (default: auto)
    --tab            Open on a specific tab: dashboard | models | install | tune | help | settings
    --model          Model tag to pass through to --launch
    --no-fullscreen  Disable the alternate-screen buffer
    --version        Print version info
    -h, --help       Show this help

  Examples
    $ hfo
    $ hfo bartowski/Llama-3.2-3B-Instruct-GGUF
    $ hfo --view
    $ hfo --list
    $ hfo --backup opus4-7-codex:4b-q8
    $ hfo --restore ~/.config/hfo/backups/2026-04-23_11-48-25/opus4-7-codex_4b-q8.zip
    $ hfo --launch claude --model llama3.1:8b
`,
  {
    importMeta: import.meta,
    flags: {
      dir: { type: 'string', shortFlag: 'd' },
      token: { type: 'string', shortFlag: 't' },
      code: { type: 'boolean', shortFlag: 'c', default: false },
      ctx: { type: 'number' },
      fullscreen: { type: 'boolean', default: true },
      tab: { type: 'string' },
      launch: { type: 'string' },
      model: { type: 'string' },
      view: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      tune: { type: 'boolean', default: false },
      backup: { type: 'string' },
      restore: { type: 'string' },
      delete: { type: 'string' },
      deep: { type: 'boolean', default: false },
    },
  },
);

// ─── Headless dispatch (no TUI) ──────────────────────────────────────────
try {
  if (cli.flags.view) { await cmdView(); process.exit(0); }
  if (cli.flags.list) { await cmdList(); process.exit(0); }
  if (cli.flags.tune) { await cmdTune(); process.exit(0); }
  if (cli.flags.backup) { await cmdBackup(cli.flags.backup); process.exit(0); }
  if (cli.flags.restore) { await cmdRestore(cli.flags.restore); process.exit(0); }
  if (cli.flags.delete) { await cmdDelete(cli.flags.delete, { deep: cli.flags.deep }); process.exit(process.exitCode ?? 0); }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

// Fallback for `hfo --launch` without any TUI step
if (cli.flags.launch && !cli.input[0] && !cli.flags.tab) {
  const target = findTarget(cli.flags.launch);
  if (!target) {
    console.error(`Unknown --launch target "${cli.flags.launch}".`);
    cmdVersion();
    process.exit(2);
  }
  const code = await runLaunch(target.id as LaunchId, { model: cli.flags.model });
  process.exit(code);
}

// ─── Fullscreen TUI ──────────────────────────────────────────────────────
const settings = await loadSettings();
const defaultBase =
  settings.modelDir ??
  (process.platform === 'win32' ? 'D:/Desarrollo/AI/LLMs' : resolve(process.env.HOME ?? '.', 'AI/LLMs'));

const baseDir = resolve(cli.flags.dir ?? defaultBase);
const token = cli.flags.token ?? process.env.HF_TOKEN;
const initialUrl = cli.input[0];
const initialTab = (cli.flags.tab as any) ?? (initialUrl ? 'install' : 'dashboard');

const useAltScreen =
  cli.flags.fullscreen !== false && settings.useAltScreen && process.stdout.isTTY;

const restoreAltScreen = () => {
  if (useAltScreen) {
    try {
      process.stdout.write('\x1b[?1049l');
    } catch {}
  }
};

if (useAltScreen) {
  process.stdout.write('\x1b[?1049h\x1b[H');
  process.on('exit', restoreAltScreen);
  process.on('SIGINT', () => { restoreAltScreen(); process.exit(130); });
  process.on('SIGTERM', () => { restoreAltScreen(); process.exit(143); });
}

let pendingLaunch: LaunchSelection | null = null;

if (cli.flags.launch) {
  const target = findTarget(cli.flags.launch);
  if (!target) {
    restoreAltScreen();
    console.error(`Unknown --launch target "${cli.flags.launch}".`);
    process.exit(2);
  }
  pendingLaunch = { id: target.id, model: cli.flags.model ?? null, configOnly: false };
}

const instance = render(
  <Shell
    initialTab={initialTab}
    initialUrl={initialUrl}
    baseDir={baseDir}
    token={token}
    codeModel={cli.flags.code}
    contextSize={cli.flags.ctx}
    onLaunch={(sel) => { pendingLaunch = sel; }}
  />,
  { patchConsole: true },
);

await instance.waitUntilExit();
restoreAltScreen();

if (pendingLaunch) {
  const { id, model, configOnly } = pendingLaunch;
  console.log(`\n> ollama launch ${id}${model ? ` --model ${model}` : ''}${configOnly ? ' --config' : ''}\n`);
  try {
    const code = await runLaunch(id as LaunchId, { model: model ?? undefined, config: configOnly });
    process.exitCode = code;
  } catch (err) {
    process.exitCode = 1;
    console.error(err instanceof Error ? err.message : err);
  }
}
