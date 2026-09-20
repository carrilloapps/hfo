import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { backupDirectory } from '../src/core/backup.js';
import { readBackupManifest, restoreBackup } from '../src/core/restore.js';
import type { HardwareProfile } from '../src/core/hardware.js';

const SANDBOX = join(tmpdir(), 'hfo-restore-test');
const SRC = join(SANDBOX, 'my-model');
const BACKUPS = join(SANDBOX, 'backups');
const TARGET = join(SANDBOX, 'restored');

const HW = {} as HardwareProfile;

let zipPath = '';

describe('restore', () => {
  beforeAll(async () => {
    await rm(SANDBOX, { recursive: true, force: true });
    await mkdir(SRC, { recursive: true });
    await writeFile(join(SRC, 'model.gguf'), Buffer.alloc(2048, 0x5a));
    await writeFile(join(SRC, 'Modelfile'), 'FROM ./model.gguf\nPARAMETER temperature 0.7\n');
    const result = await backupDirectory(
      { tag: 'roundtrip:q4', dir: SRC, repoId: 'org/repo', quant: 'Q4_K_M' },
      BACKUPS,
    );
    zipPath = result.zipPath;
  });

  afterAll(async () => {
    await rm(SANDBOX, { recursive: true, force: true });
  });

  it('reads the sidecar manifest back off a freshly written backup', async () => {
    const manifest = await readBackupManifest(zipPath);
    expect(manifest?.tag).toBe('roundtrip:q4');
    expect(manifest?.sourceDir).toBe(SRC);
  });

  it('extracts the archive back to disk byte-for-byte', async () => {
    const result = await restoreBackup(zipPath, HW, {
      targetDir: TARGET,
      registerWithOllama: false,
    });

    // backup.ts nests the source under its own basename, restore unwraps to it
    expect(result.restoredTo).toBe(join(TARGET, basename(SRC)));
    expect(result.tag).toBe('roundtrip:q4');

    const gguf = await readFile(join(result.restoredTo, 'model.gguf'));
    expect(gguf.length).toBe(2048);
    expect(gguf.every((b) => b === 0x5a)).toBe(true);

    const modelfile = await readFile(join(result.restoredTo, 'Modelfile'), 'utf8');
    expect(modelfile).toContain('FROM ./model.gguf');
  });
});
