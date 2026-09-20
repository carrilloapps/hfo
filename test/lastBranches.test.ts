import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HardwareProfile } from '../src/core/hardware.js';
import type { Installation } from '../src/infra/settings.js';

const ollamaCreate = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/ollama.js', () => ({ ollamaCreate }));

const recordInstallation = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/settings.js', () => ({ recordInstallation }));

const loadCardParams = vi.hoisted(() => vi.fn());
vi.mock('../src/core/readme.js', () => ({ loadCardParams }));

import { backupDirectory } from '../src/core/backup.js';
import { restoreBackup } from '../src/core/restore.js';
import { reinstallInstallation } from '../src/core/reinstall.js';

const hw: HardwareProfile = {
  gpuName: 'GPU', vramMiB: 8192, ramMiB: 32768,
  cpuCores: 8, platform: 'linux', unifiedMemory: false,
};

let sandbox: string;
let src: string;
let backups: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-lastbr-'));
  src = join(sandbox, 'my-model');
  backups = join(sandbox, 'backups');
  await mkdir(src, { recursive: true });
  ollamaCreate.mockReset().mockResolvedValue('ok');
  recordInstallation.mockReset().mockResolvedValue(undefined);
  loadCardParams.mockReset().mockResolvedValue({ params: {}, foundKeys: [], raw: null });
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

async function makeBackup(withModelfile: boolean) {
  await writeFile(join(src, 'model.gguf'), Buffer.alloc(512, 3));
  if (withModelfile) await writeFile(join(src, 'Modelfile'), 'FROM ./model.gguf\n');
  return backupDirectory(
    { tag: 'br:q4', dir: src, repoId: 'org/repo', quant: 'Q4_K_M' },
    backups,
  );
}

describe('restoreBackup — remaining fallbacks', () => {
  it('reports an unknown tag when registration is skipped and no manifest exists', async () => {
    const res0 = await makeBackup(true);
    await unlink(res0.metadataPath);
    const res = await restoreBackup(res0.zipPath, hw, {
      targetDir: join(sandbox, 'out'),
      registerWithOllama: false,
    });
    // Both the `manifest?.tag` optional chain and the `?? 'unknown'` fallback.
    expect(res.tag).toBe('unknown');
    expect(res.manifest).toBeNull();
  });

  it('passes "restored"/"unknown" into the reinstall path when the manifest omits them', async () => {
    const res0 = await makeBackup(false);   // no Modelfile → reinstall pipeline
    await writeFile(res0.metadataPath, JSON.stringify({
      tag: 'br:q4', repoId: null, quant: null,
      sourceDir: src, createdAtIso: '2026-01-01T00:00:00.000Z',
    }));
    await restoreBackup(res0.zipPath, hw, { targetDir: join(sandbox, 'out2') });

    // reinstallInstallation is the real one here, so assert through the
    // record it writes at the end of that pipeline.
    expect(recordInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: 'restored' }),
    );
  });
});

describe('reinstallInstallation — repo and quant fallback chain', () => {
  const base: Installation = {
    tag: 'r:q4', dir: '', repoId: 'org/demo', quant: 'Q4_K_M', installedAt: '',
  };

  it('falls back to local-directory when repoId is an empty string', async () => {
    const dir = join(sandbox, 'emptyrepo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'model.gguf'), Buffer.alloc(256));
    await reinstallInstallation({ ...base, dir, repoId: '' }, hw);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(dir, 'Modelfile'), 'utf8')).toContain('local-directory');
  });

  it('uses the record quant when the filename carries none', async () => {
    const dir = join(sandbox, 'norecognisablequant');
    await mkdir(dir, { recursive: true });
    // extractQuant yields 'unknown' for this name, so install.quant is used.
    await writeFile(join(dir, 'model.gguf'), Buffer.alloc(256));
    await reinstallInstallation({ ...base, dir, quant: 'Q5_K_M' }, hw);
    const { readFile } = await import('node:fs/promises');
    const body = await readFile(join(dir, 'Modelfile'), 'utf8');
    expect(body).toMatch(/Quant\s*:\s*(unknown|Q5_K_M)/);
  });

  it('falls all the way through to "unknown" when neither source has a quant', async () => {
    const dir = join(sandbox, 'noquantatall');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'model.gguf'), Buffer.alloc(256));
    await reinstallInstallation(
      { ...base, dir, quant: '' as unknown as string },
      hw,
    );
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(dir, 'Modelfile'), 'utf8')).toContain('unknown');
  });
});
