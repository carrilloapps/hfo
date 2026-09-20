import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa }));

const state = vi.hoisted(() => ({ platform: 'win32' as NodeJS.Platform, home: '' }));
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, platform: () => state.platform, homedir: () => state.home };
});

import { restartOllama, runInstall, planInstall } from '../src/infra/ollama.js';
import { backupDirectory } from '../src/core/backup.js';

let sandbox: string;
const savedLocalAppData = process.env.LOCALAPPDATA;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-closeout-'));
  state.home = sandbox;
  state.platform = 'win32';
  execa.mockReset().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

afterEach(async () => {
  if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = savedLocalAppData;
  await rm(sandbox, { recursive: true, force: true });
});

describe('restartOllama — Windows tray path without LOCALAPPDATA', () => {
  it('still builds a candidate path when LOCALAPPDATA is unset', async () => {
    delete process.env.LOCALAPPDATA;
    const res = await restartOllama();
    expect(res.ok).toBe(true);
    // The candidate is rooted at '' rather than throwing on undefined.
    const startCall = execa.mock.calls.find(([bin]) => bin === 'cmd');
    expect(startCall).toBeDefined();
    expect(String(startCall![1][3])).toContain('Ollama');
  });
});

describe('runInstall — stream handlers', () => {
  it('forwards nothing when the child produces no output at all', async () => {
    const handlers: Record<string, ((d: Buffer) => void)[]> = { stdout: [], stderr: [] };
    const mk = (k: string) => ({ on: (_e: string, cb: (d: Buffer) => void) => handlers[k].push(cb) });
    execa.mockReturnValue(Object.assign(
      new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0 }), 0)),
      { stdout: mk('stdout'), stderr: mk('stderr') },
    ));
    const seen: unknown[] = [];
    expect(await runInstall(planInstall(), (p) => seen.push(p))).toEqual({ ok: true, exitCode: 0 });
    expect(seen).toEqual([]);
  });

  it('drops blank lines from a chunk that is only newlines', async () => {
    const handlers: Record<string, ((d: Buffer) => void)[]> = { stdout: [], stderr: [] };
    const mk = (k: string) => ({ on: (_e: string, cb: (d: Buffer) => void) => handlers[k].push(cb) });
    execa.mockReturnValue(Object.assign(
      new Promise((resolve) => setTimeout(() => {
        handlers.stdout.forEach((cb) => cb(Buffer.from('\r\n\r\n')));
        handlers.stderr.forEach((cb) => cb(Buffer.from('\n')));
        resolve({ exitCode: 0 });
      }, 0)),
      { stdout: mk('stdout'), stderr: mk('stderr') },
    ));
    const seen: unknown[] = [];
    await runInstall(planInstall(), (p) => seen.push(p));
    expect(seen).toEqual([]);
  });
});

describe('backupDirectory — directory walk and entry stats', () => {
  it('descends into nested directories when totalling bytes', async () => {
    const src = join(sandbox, 'nested-src');
    await mkdir(join(src, 'a', 'b'), { recursive: true });
    await writeFile(join(src, 'top.gguf'), Buffer.alloc(100));
    await writeFile(join(src, 'a', 'mid.bin'), Buffer.alloc(50));
    await writeFile(join(src, 'a', 'b', 'deep.bin'), Buffer.alloc(25));

    const res = await backupDirectory(
      { tag: 'n:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups'),
    );
    expect(res.originalBytes).toBe(175);
  });

  it('skips entries that are neither files nor directories', async () => {
    const src = join(sandbox, 'linky');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'real.gguf'), Buffer.alloc(80));
    // A symlink is neither isFile() nor isDirectory() to readdir withFileTypes,
    // so the byte walk must skip it rather than double count or throw.
    await symlink(join(src, 'real.gguf'), join(src, 'alias.gguf'));

    const res = await backupDirectory(
      { tag: 'l:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups2'),
    );
    expect(res.originalBytes).toBe(80);
  });

  it('counts an entry whose stats the archiver omits as zero bytes', async () => {
    const { ZipArchive } = await import('archiver');
    const src = join(sandbox, 'nostats');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'm.gguf'), Buffer.alloc(32));

    const seen: number[] = [];
    await backupDirectory(
      { tag: 's:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups3'),
      (p) => seen.push(p.processedBytes),
      () => {
        const a = new ZipArchive({ zlib: { level: 9 } });
        // Emit an entry with no stats at all, exercising the `?? 0` fallback.
        setTimeout(() => a.emit('entry', { name: 'ghost', stats: undefined }), 0);
        return a;
      },
    );
    expect(seen[0]).toBe(0);
  });
});
