import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HardwareProfile } from '../src/core/hardware.js';
import type { Installation } from '../src/infra/settings.js';

// inspectInstallDir runs against a real temp tree — the filesystem is the
// thing under test there. Only the two side effects that reach outside the
// process (registering with Ollama, hitting the HF API, writing settings) are
// stubbed.
const ollamaCreate = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/ollama.js', () => ({ ollamaCreate }));

const recordInstallation = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/settings.js', () => ({ recordInstallation }));

const loadCardParams = vi.hoisted(() => vi.fn());
vi.mock('../src/core/readme.js', () => ({ loadCardParams }));

import { inspectInstallDir, reinstallInstallation } from '../src/core/reinstall.js';

const hw: HardwareProfile = {
  gpuName: 'RTX 4090',
  vramMiB: 24576,
  ramMiB: 65536,
  cpuCores: 16,
  platform: 'linux',
  unifiedMemory: false,
};

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-reinstall-test-'));
  ollamaCreate.mockReset().mockResolvedValue('created');
  recordInstallation.mockReset().mockResolvedValue(undefined);
  loadCardParams.mockReset().mockResolvedValue({ params: {}, foundKeys: [], raw: null });
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

async function makeDir(name: string, files: Record<string, string | Buffer>): Promise<string> {
  const dir = join(sandbox, name);
  await mkdir(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) await writeFile(join(dir, f), body);
  return dir;
}

describe('inspectInstallDir', () => {
  it('reports missing-dir when the path does not exist', async () => {
    expect(await inspectInstallDir(join(sandbox, 'nope'))).toEqual({ kind: 'missing-dir' });
  });

  it('reports missing-gguf for a directory with no model file', async () => {
    const dir = await makeDir('empty', { 'README.md': 'hi' });
    expect(await inspectInstallDir(dir)).toEqual({ kind: 'missing-gguf' });
  });

  it('reports ready when a GGUF and a Modelfile sit side by side', async () => {
    const dir = await makeDir('ready', {
      'model-Q4_K_M.gguf': Buffer.alloc(16),
      Modelfile: 'FROM ./model-Q4_K_M.gguf\n',
    });
    expect(await inspectInstallDir(dir)).toEqual({
      kind: 'ready', gguf: 'model-Q4_K_M.gguf', modelfile: 'Modelfile',
    });
  });

  it('reports needs-generation with the size and quant when only the GGUF is there', async () => {
    const dir = await makeDir('bare', { 'model-Q6_K.gguf': Buffer.alloc(2048) });
    expect(await inspectInstallDir(dir)).toEqual({
      kind: 'needs-generation', gguf: 'model-Q6_K.gguf', sizeBytes: 2048, quant: 'Q6_K',
    });
  });

  it('matches a .GGUF extension case-insensitively', async () => {
    const dir = await makeDir('upper', { 'MODEL-Q8_0.GGUF': Buffer.alloc(8) });
    const res = await inspectInstallDir(dir);
    expect(res.kind).toBe('needs-generation');
  });

  it('reports missing-dir when the path is a file rather than a directory', async () => {
    const dir = await makeDir('holder', { 'a.txt': 'x' });
    expect(await inspectInstallDir(join(dir, 'a.txt'))).toEqual({ kind: 'missing-dir' });
  });
});

describe('reinstallInstallation', () => {
  const base: Installation = {
    tag: 'demo:q4', dir: '', repoId: 'org/demo', quant: 'Q4_K_M', installedAt: '',
  };

  it('throws when the directory is gone', async () => {
    await expect(reinstallInstallation({ ...base, dir: join(sandbox, 'ghost') }, hw))
      .rejects.toThrow(/Directory is gone/);
  });

  it('throws when the directory holds no GGUF', async () => {
    const dir = await makeDir('nogguf', { 'notes.txt': 'x' });
    await expect(reinstallInstallation({ ...base, dir }, hw)).rejects.toThrow(/No .gguf file/);
  });

  it('registers a ready directory without regenerating the Modelfile', async () => {
    const dir = await makeDir('ready2', {
      'm-Q4_K_M.gguf': Buffer.alloc(16),
      Modelfile: 'FROM ./m-Q4_K_M.gguf\n',
    });
    const res = await reinstallInstallation({ ...base, dir }, hw);
    expect(res).toMatchObject({ tag: 'demo:q4', dir, modelfileGenerated: false });
    expect(ollamaCreate).toHaveBeenCalledWith('demo:q4', join(dir, 'Modelfile'), dir);
    expect(recordInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'demo:q4', dir, repoId: 'org/demo', quant: 'Q4_K_M' }),
    );
  });

  it('synthesizes a Modelfile when only the GGUF is present', async () => {
    const dir = await makeDir('gen', { 'm-Q6_K.gguf': Buffer.alloc(1024 * 1024) });
    const res = await reinstallInstallation({ ...base, dir }, hw);
    expect(res.modelfileGenerated).toBe(true);
    const body = await readFile(join(dir, 'Modelfile'), 'utf8');
    expect(body).toContain('FROM ./m-Q6_K.gguf');
    expect(body).toContain('reconstructed');
  });

  it('pulls recommended params from the HF card when a repoId is known', async () => {
    loadCardParams.mockResolvedValue({
      params: { temperature: 0.11 }, foundKeys: ['temperature'], raw: null,
    });
    const dir = await makeDir('card', { 'm-Q4_K_M.gguf': Buffer.alloc(1024) });
    await reinstallInstallation({ ...base, dir }, hw, { token: 'tok' });
    expect(loadCardParams).toHaveBeenCalledWith('org/demo', 'tok');
    expect(await readFile(join(dir, 'Modelfile'), 'utf8')).toContain('0.11');
  });

  it('carries on when the HF card lookup fails', async () => {
    loadCardParams.mockRejectedValue(new Error('offline'));
    const dir = await makeDir('cardfail', { 'm-Q4_K_M.gguf': Buffer.alloc(1024) });
    const res = await reinstallInstallation({ ...base, dir }, hw);
    expect(res.modelfileGenerated).toBe(true);
  });

  it('skips the card lookup entirely when there is no repoId', async () => {
    const dir = await makeDir('norepo', { 'm-Q4_K_M.gguf': Buffer.alloc(1024) });
    await reinstallInstallation({ ...base, dir, repoId: '' }, hw);
    expect(loadCardParams).not.toHaveBeenCalled();
    expect(await readFile(join(dir, 'Modelfile'), 'utf8')).toContain('local-directory');
  });

  it('applies the code-model system prompt when asked', async () => {
    const dir = await makeDir('code', { 'm-Q4_K_M.gguf': Buffer.alloc(1024) });
    await reinstallInstallation({ ...base, dir }, hw, { isCodeModel: true });
    expect(await readFile(join(dir, 'Modelfile'), 'utf8')).toBeTruthy();
  });

  it('falls back to the directory name when the record has no repoId', async () => {
    const dir = await makeDir('fallbackrepo', {
      'm-Q4_K_M.gguf': Buffer.alloc(16),
      Modelfile: 'FROM ./m-Q4_K_M.gguf\n',
    });
    await reinstallInstallation({ ...base, dir, repoId: undefined as unknown as string }, hw);
    expect(recordInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: 'fallbackrepo' }),
    );
  });

  it('falls back to the detected quant when the record has none', async () => {
    const dir = await makeDir('fallbackquant', { 'm-Q8_0.gguf': Buffer.alloc(1024) });
    await reinstallInstallation({ ...base, dir, quant: undefined as unknown as string }, hw);
    expect(recordInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ quant: 'Q8_0' }),
    );
  });

  it('records "unknown" when a ready dir has no quant on the record', async () => {
    const dir = await makeDir('unknownquant', {
      'm.gguf': Buffer.alloc(16),
      Modelfile: 'FROM ./m.gguf\n',
    });
    await reinstallInstallation({ ...base, dir, quant: undefined as unknown as string }, hw);
    expect(recordInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ quant: 'unknown' }),
    );
  });
});
