import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HardwareProfile } from '../src/core/hardware.js';

// Real zips through archiver/adm-zip, but the Ollama registration and the
// settings index are stubbed — those are the only side effects that leave the
// sandbox.
const ollamaCreate = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/ollama.js', () => ({ ollamaCreate }));

const recordInstallation = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/settings.js', () => ({ recordInstallation }));

const reinstallInstallation = vi.hoisted(() => vi.fn());
vi.mock('../src/core/reinstall.js', async (orig) => {
  const actual = await orig<typeof import('../src/core/reinstall.js')>();
  return { ...actual, reinstallInstallation };
});

import { backupDirectory } from '../src/core/backup.js';
import { readBackupManifest, restoreBackup } from '../src/core/restore.js';

const hw: HardwareProfile = {
  gpuName: 'GPU', vramMiB: 8192, ramMiB: 32768,
  cpuCores: 8, platform: 'linux', unifiedMemory: false,
};

let sandbox: string;
let src: string;
let backups: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-restore-br-'));
  src = join(sandbox, 'my-model');
  backups = join(sandbox, 'backups');
  await mkdir(src, { recursive: true });
  ollamaCreate.mockReset().mockResolvedValue('ok');
  recordInstallation.mockReset().mockResolvedValue(undefined);
  reinstallInstallation.mockReset().mockResolvedValue({
    tag: 'roundtrip:q4', dir: 'X', modelfilePath: 'X/Modelfile', modelfileGenerated: true,
  });
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

// backupDirectory writes the zip and its sidecar into a timestamped subfolder
// of the backups root, so hand back both paths rather than recomputing them.
async function makeBackup(withModelfile = true): Promise<{ zipPath: string; metadataPath: string }> {
  await writeFile(join(src, 'model.gguf'), Buffer.alloc(1024, 7));
  if (withModelfile) await writeFile(join(src, 'Modelfile'), 'FROM ./model.gguf\n');
  const res = await backupDirectory(
    { tag: 'roundtrip:q4', dir: src, repoId: 'org/repo', quant: 'Q4_K_M' },
    backups,
  );
  return { zipPath: res.zipPath, metadataPath: res.metadataPath };
}

describe('readBackupManifest', () => {
  it('reads the sidecar JSON that sits next to the zip', async () => {
    const { zipPath: zip } = await makeBackup();
    expect((await readBackupManifest(zip))?.tag).toBe('roundtrip:q4');
  });

  it('returns null for a path that is not a zip at all', async () => {
    const bogus = join(sandbox, 'not-a-zip.zip');
    await writeFile(bogus, 'definitely not a zip');
    expect(await readBackupManifest(bogus)).toBeNull();
  });

  it('returns null when the sidecar is corrupt and the zip has no manifest entry', async () => {
    const { zipPath: zip, metadataPath } = await makeBackup();
    await writeFile(metadataPath, '{ broken json');
    expect(await readBackupManifest(zip)).toBeNull();
  });

  it('returns null when the zip is missing entirely', async () => {
    expect(await readBackupManifest(join(sandbox, 'absent.zip'))).toBeNull();
  });
});

describe('restoreBackup', () => {
  it('extracts and registers a ready directory with Ollama', async () => {
    const { zipPath: zip } = await makeBackup();
    const target = join(sandbox, 'out');
    const res = await restoreBackup(zip, hw, { targetDir: target });

    expect(res.tag).toBe('roundtrip:q4');
    expect(res.modelfileGenerated).toBe(false);
    expect(ollamaCreate).toHaveBeenCalledWith(
      'roundtrip:q4', join(target, 'my-model', 'Modelfile'), join(target, 'my-model'),
    );
    expect(recordInstallation).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'roundtrip:q4', repoId: 'org/repo', quant: 'Q4_K_M',
    }));
  });

  it('skips registration when registerWithOllama is explicitly false', async () => {
    const { zipPath: zip } = await makeBackup();
    const res = await restoreBackup(zip, hw, {
      targetDir: join(sandbox, 'out2'), registerWithOllama: false,
    });
    expect(res.tag).toBe('roundtrip:q4');
    expect(ollamaCreate).not.toHaveBeenCalled();
    expect(recordInstallation).not.toHaveBeenCalled();
  });

  it('delegates to the reinstall pipeline when the archive has no Modelfile', async () => {
    const { zipPath: zip } = await makeBackup(false);
    const target = join(sandbox, 'out3');
    reinstallInstallation.mockResolvedValue({
      tag: 'roundtrip:q4',
      dir: join(target, 'my-model'),
      modelfilePath: join(target, 'my-model', 'Modelfile'),
      modelfileGenerated: true,
    });
    const res = await restoreBackup(zip, hw, { targetDir: target, token: 'tok', isCodeModel: true });

    expect(res.modelfileGenerated).toBe(true);
    expect(reinstallInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'roundtrip:q4', repoId: 'org/repo', quant: 'Q4_K_M' }),
      hw,
      { token: 'tok', isCodeModel: true },
    );
    expect(ollamaCreate).not.toHaveBeenCalled();
  });

  it('returns an unknown tag and does not register when there is no manifest', async () => {
    const { zipPath: zip, metadataPath } = await makeBackup();
    await unlink(metadataPath);
    const res = await restoreBackup(zip, hw, { targetDir: join(sandbox, 'out4') });
    expect(res.tag).toBe('unknown');
    expect(ollamaCreate).not.toHaveBeenCalled();
  });

  it('defaults the target to the manifest source dir', async () => {
    const { zipPath: zip } = await makeBackup();
    await rm(src, { recursive: true, force: true });
    const res = await restoreBackup(zip, hw, { registerWithOllama: false });
    expect(res.restoredTo).toBe(join(src, 'my-model'));
  });

  it('falls back to the extraction root when the nested folder is absent', async () => {
    // A hand-rolled zip with no top-level folder, and no sidecar manifest.
    const { ZipArchive } = await import('archiver');
    const { createWriteStream } = await import('node:fs');
    const flat = join(sandbox, 'flat.zip');
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(flat);
      const a = new ZipArchive();
      out.on('close', () => resolve());
      a.on('error', reject);
      a.pipe(out);
      a.append('FROM ./m.gguf\n', { name: 'Modelfile' });
      a.finalize().catch(reject);
    });
    const target = join(sandbox, 'flatout');
    const res = await restoreBackup(flat, hw, { targetDir: target, registerWithOllama: false });
    expect(res.restoredTo).toBe(target);
  });

  it('records "restored"/"unknown" when the manifest omits repo and quant', async () => {
    const { zipPath: zip, metadataPath } = await makeBackup();
    await writeFile(metadataPath, JSON.stringify({
      tag: 'roundtrip:q4', repoId: null, quant: null,
      sourceDir: src, createdAtIso: '2026-01-01T00:00:00.000Z',
    }));
    await restoreBackup(zip, hw, { targetDir: join(sandbox, 'out5') });
    expect(recordInstallation).toHaveBeenCalledWith(expect.objectContaining({
      repoId: 'restored', quant: 'unknown',
    }));
  });
});
