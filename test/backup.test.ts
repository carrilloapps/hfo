import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDirectory, resolveBackupRoot } from '../src/core/backup.js';

const SANDBOX = join(tmpdir(), 'hfo-backup-test');
const SRC = join(SANDBOX, 'src');
const BACKUPS = join(SANDBOX, 'backups');

describe('backup', () => {
  beforeAll(async () => {
    await rm(SANDBOX, { recursive: true, force: true });
    await mkdir(SRC, { recursive: true });
    await writeFile(join(SRC, 'model.gguf'), Buffer.alloc(1024, 0xab));
    await writeFile(join(SRC, 'Modelfile'), 'FROM ./model.gguf\nPARAMETER temperature 0.7\n');
  });

  afterAll(async () => {
    await rm(SANDBOX, { recursive: true, force: true });
  });

  it('produces a .zip plus a .metadata.json with expected fields', async () => {
    const result = await backupDirectory(
      { tag: 'test:q4', dir: SRC, repoId: 'org/repo', quant: 'Q4_K_M' },
      BACKUPS,
    );
    expect(result.zipPath).toMatch(/\.zip$/);
    expect(result.metadataPath).toMatch(/\.metadata\.json$/);
    const zipStat = await stat(result.zipPath);
    expect(zipStat.size).toBeGreaterThan(0);

    const meta = JSON.parse(await readFile(result.metadataPath, 'utf8'));
    expect(meta.tag).toBe('test:q4');
    expect(meta.repoId).toBe('org/repo');
    expect(meta.quant).toBe('Q4_K_M');
    expect(meta.tool).toBe('hfo-cli');
    expect(meta.originalBytes).toBeGreaterThan(0);
    expect(meta.compressedBytes).toBe(zipStat.size);
  });
});

describe('resolveBackupRoot', () => {
  it('returns override when provided', () => {
    expect(resolveBackupRoot('/tmp/foo')).toBe('/tmp/foo');
  });
  it('falls back to the hfo config dir when absent', () => {
    const root = resolveBackupRoot(null);
    expect(root).toMatch(/backups$/);
  });
});
