import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipArchive } from 'archiver';
import { backupDirectory, isFatalArchiveWarning } from '../src/core/backup.js';

let sandbox: string;
let src: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-warn-'));
  src = join(sandbox, 'model');
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'model.gguf'), Buffer.alloc(256, 9));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('isFatalArchiveWarning', () => {
  it('treats a vanished entry (ENOENT) as survivable', () => {
    expect(isFatalArchiveWarning(Object.assign(new Error('gone'), { code: 'ENOENT' })))
      .toBe(false);
  });

  it('treats any other code as fatal', () => {
    expect(isFatalArchiveWarning(Object.assign(new Error('denied'), { code: 'EACCES' })))
      .toBe(true);
  });

  it('treats a warning with no code at all as fatal', () => {
    expect(isFatalArchiveWarning(new Error('mystery'))).toBe(true);
  });

  it('treats undefined as fatal rather than silently ignoring it', () => {
    expect(isFatalArchiveWarning(undefined)).toBe(true);
  });
});

describe('backupDirectory — warning wiring', () => {
  /**
   * archiver only emits `warning` for conditions that are impractical to
   * provoke from the filesystem (it swallows dangling symlinks outright), so
   * the factory seam is used to emit one against a real archive and assert the
   * handler's decision rather than just the predicate's.
   */
  function emittingArchive(err: unknown) {
    return () => {
      const archive = new ZipArchive({ zlib: { level: 9 } });
      // Emit once the caller has attached its listeners.
      setTimeout(() => archive.emit('warning', err), 0);
      return archive;
    };
  }

  it('survives an ENOENT warning and still produces the archive', async () => {
    const res = await backupDirectory(
      { tag: 'w:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups'),
      undefined,
      emittingArchive(Object.assign(new Error('vanished'), { code: 'ENOENT' })),
    );
    expect(res.zipPath).toMatch(/\.zip$/);
    expect(res.compressedBytes).toBeGreaterThan(0);
  });

  it('rejects the backup on a non-ENOENT warning', async () => {
    await expect(backupDirectory(
      { tag: 'w:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups2'),
      undefined,
      emittingArchive(Object.assign(new Error('permission denied'), { code: 'EACCES' })),
    )).rejects.toThrow('permission denied');
  });

  it('uses a real level-9 zip archive by default', async () => {
    const res = await backupDirectory(
      { tag: 'd:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups3'),
    );
    expect(res.compressedBytes).toBeGreaterThan(0);
    expect(res.originalBytes).toBe(256);
  });
});
