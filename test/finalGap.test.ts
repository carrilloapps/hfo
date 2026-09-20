import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

import { buildLaunchArgs } from '../src/core/launch.js';
import { findPackageJson, normalizeAuthor } from '../src/infra/about.js';

let sandbox: string;
beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-gap-'));
});
afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('buildLaunchArgs — every flag combination', () => {
  it('emits --yes', () => {
    expect(buildLaunchArgs('claude', { yes: true }))
      .toEqual(['launch', 'claude', '--yes']);
  });

  it('emits all flags together in order', () => {
    expect(buildLaunchArgs('codex', {
      model: 'm:1b', config: true, yes: true, extra: ['--sandbox'],
    })).toEqual([
      'launch', 'codex', '--model', 'm:1b', '--config', '--yes', '--', '--sandbox',
    ]);
  });

  it('ignores an empty extras array rather than emitting a bare --', () => {
    expect(buildLaunchArgs('claude', { extra: [] })).toEqual(['launch', 'claude']);
  });

  it('ignores an empty model string', () => {
    expect(buildLaunchArgs('claude', { model: '' })).toEqual(['launch', 'claude']);
  });

  it('ignores config and yes when explicitly false', () => {
    expect(buildLaunchArgs('claude', { config: false, yes: false }))
      .toEqual(['launch', 'claude']);
  });
});

describe('findPackageJson — walking to the filesystem root', () => {
  it('stops at the root and returns an empty shape when nothing matches', () => {
    // The root of the current volume has no package.json above it, so the
    // `parent === dir` guard is what ends the walk.
    const root = parse(process.cwd()).root;
    expect(findPackageJson(root)).toEqual({});
  });

  it('finds a manifest that sits exactly at the start directory', async () => {
    await writeFile(join(sandbox, 'package.json'), JSON.stringify({ name: 'at-start', version: '1' }));
    expect(findPackageJson(sandbox).name).toBe('at-start');
  });
});

describe('normalizeAuthor — unparseable string', () => {
  it('falls back to the raw string when the pattern does not match', () => {
    // A string that is only bracket syntax leaves group 1 unmatched, so the
    // raw value is used instead.
    const out = normalizeAuthor('<only@email.com>');
    expect(out.name).toBe('<only@email.com>');
    expect(out.email).toBeUndefined();
  });

  it('trims whitespace around a matched name', () => {
    expect(normalizeAuthor('   Spaced Name   <a@b.c>').name).toBe('Spaced Name');
  });
});

describe('restoreBackup — extraction root fallback', () => {
  it('uses the target root when the manifest names a folder the zip does not contain', async () => {
    const { backupDirectory } = await import('../src/core/backup.js');
    const { restoreBackup } = await import('../src/core/restore.js');

    const src = join(sandbox, 'real-name');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'model.gguf'), Buffer.alloc(64));
    const res = await backupDirectory(
      { tag: 'g:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups'),
    );

    // Point sourceDir at a folder name the archive never contained, so the
    // nested-folder guess misses and the extraction root is used instead.
    await writeFile(res.metadataPath, JSON.stringify({
      tag: 'g:q4', repoId: 'o/r', quant: 'Q4',
      sourceDir: join(sandbox, 'a-different-folder'),
      createdAtIso: '2026-01-01T00:00:00.000Z',
    }));

    const target = join(sandbox, 'out');
    const out = await restoreBackup(res.zipPath, {
      gpuName: null, vramMiB: 0, ramMiB: 1024,
      cpuCores: 1, platform: 'linux', unifiedMemory: false,
    }, { targetDir: target, registerWithOllama: false });

    expect(out.restoredTo).toBe(target);
    expect(await readFile(join(target, 'real-name', 'model.gguf'))).toHaveLength(64);
  });
});
