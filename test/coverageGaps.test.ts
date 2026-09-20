import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listBackups, resolveBackupRoot, backupDirectory } from '../src/core/backup.js';
import { buildModelfile, suggestTag } from '../src/core/modelfile.js';
import { setLang, t } from '../src/ui/i18n.js';
import { scoreHardware, tierFor } from '../src/core/capacity.js';
import type { HardwareProfile } from '../src/core/hardware.js';
import type { ResolvedParams } from '../src/core/plan.js';

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-gaps-'));
});
afterEach(async () => {
  setLang('en');
  await rm(sandbox, { recursive: true, force: true });
});

function hw(over: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    gpuName: 'GPU', vramMiB: 8192, ramMiB: 32768,
    cpuCores: 8, platform: 'linux', unifiedMemory: false, ...over,
  };
}

describe('listBackups', () => {
  it('returns the timestamped subdirectories of the backups root', async () => {
    await mkdir(join(sandbox, '2026-01-01_10-00-00'), { recursive: true });
    await mkdir(join(sandbox, '2026-02-02_11-00-00'), { recursive: true });
    await writeFile(join(sandbox, 'stray.txt'), 'x');
    const found = await listBackups(sandbox);
    expect(found).toHaveLength(2);
    expect(found.every((p) => p.startsWith(sandbox))).toBe(true);
  });

  it('returns an empty list for a root that does not exist', async () => {
    expect(await listBackups(join(sandbox, 'absent'))).toEqual([]);
  });

  it('returns an empty list for an empty root', async () => {
    expect(await listBackups(sandbox)).toEqual([]);
  });
});

describe('resolveBackupRoot', () => {
  it('returns an explicit override untouched', () => {
    expect(resolveBackupRoot('/custom/backups')).toBe('/custom/backups');
  });
  it('falls back to the config dir when the override is null', () => {
    expect(resolveBackupRoot(null)).toMatch(/backups$/);
  });
  it('falls back when the override is undefined', () => {
    expect(resolveBackupRoot(undefined)).toMatch(/backups$/);
  });
  it('falls back when the override is an empty string', () => {
    expect(resolveBackupRoot('')).toMatch(/backups$/);
  });
});

describe('backupDirectory progress', () => {
  it('reports a growing byte count and the current file for each entry', async () => {
    const src = join(sandbox, 'model');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'a.gguf'), Buffer.alloc(2048));
    await writeFile(join(src, 'b.txt'), Buffer.alloc(512));

    const seen: Array<{ processedBytes: number; fileCount: number; currentFile: string }> = [];
    const res = await backupDirectory(
      { tag: 'p:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups'),
      (p) => seen.push({ ...p }),
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)!.fileCount).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)!.processedBytes).toBeGreaterThan(0);
    expect(seen.some((s) => s.currentFile.length > 0)).toBe(true);
    expect(res.originalBytes).toBeGreaterThan(0);
  });

  it('works without a progress callback', async () => {
    const src = join(sandbox, 'quiet');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'a.gguf'), Buffer.alloc(16));
    const res = await backupDirectory(
      { tag: 'q:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups2'),
    );
    expect(res.compressedBytes).toBeGreaterThan(0);
  });

  it('writes a zero compression ratio for an empty source directory', async () => {
    const src = join(sandbox, 'empty');
    await mkdir(src, { recursive: true });
    const res = await backupDirectory(
      { tag: 'e:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups3'),
    );
    expect(res.originalBytes).toBe(0);
    // The ratio lives in the sidecar manifest rather than the return value,
    // and must not come out as NaN from a 0/0 division.
    const meta = JSON.parse(await readFile(res.metadataPath, 'utf8'));
    expect(meta.compressionRatio).toBe(0);
  });

  it('accepts a subject with no repoId or quant', async () => {
    const src = join(sandbox, 'bare');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'm.gguf'), Buffer.alloc(8));
    const res = await backupDirectory({ tag: 'b:q4', dir: src }, join(sandbox, 'backups4'));
    expect(res.zipPath).toMatch(/\.zip$/);
  });
});

describe('t() interpolation', () => {
  it('substitutes a single placeholder', () => {
    setLang('en');
    expect(t('launch.countsBanner', { total: 13, available: 5 }))
      .toBe('13 targets · 5 available locally');
  });

  it('replaces every occurrence of a placeholder', () => {
    setLang('en');
    // navHint carries both {up} and {down}
    const out = t('launch.navHint', { up: 'U', down: 'D' });
    expect(out).toContain('U');
    expect(out).toContain('D');
    expect(out).not.toContain('{up}');
  });

  it('leaves the string alone when no params are given', () => {
    setLang('en');
    expect(t('launch.countsBanner')).toContain('{total}');
  });

  it('returns the key itself for an unknown lookup', () => {
    setLang('en');
    expect(t('totally.made.up.key')).toBe('totally.made.up.key');
  });

  it('falls back to English for a key missing from another catalog', () => {
    setLang('th');
    expect(t('launch.notInstalled')).toBe('not installed');
    setLang('en');
  });
});

describe('buildModelfile — optional lines', () => {
  const base: ResolvedParams = {
    temperature: 0.7, topP: 0.95, topK: 40, repeatPenalty: 1.05, minP: 0.05,
    numCtx: 8192, numBatch: 512, numGpu: 99, numThread: 8, repeatLastN: 256,
  };

  it('emits concrete num_gpu and num_thread lines when both are pinned', () => {
    const out = buildModelfile({
      ggufFilename: 'm.gguf', repoId: 'o/r', quant: 'Q4_K_M', hw: hw(), params: base,
    });
    expect(out).toContain('PARAMETER num_gpu 99');
    expect(out).toContain('PARAMETER num_thread 8');
    expect(out).not.toContain('# PARAMETER num_gpu');
  });

  it('comments both out when they are on auto', () => {
    const out = buildModelfile({
      ggufFilename: 'm.gguf', repoId: 'o/r', quant: 'Q4_K_M', hw: hw(),
      params: { ...base, numGpu: null, numThread: null },
    });
    expect(out).toContain('# PARAMETER num_gpu 99');
    expect(out).toContain('# PARAMETER num_thread 8');
  });

  it('notes which card keys were applied when there are any', () => {
    const out = buildModelfile({
      ggufFilename: 'm.gguf', repoId: 'o/r', quant: 'Q4_K_M', hw: hw(), params: base,
      cardSource: ['temperature', 'top_p'],
    });
    expect(out).toContain('HF model-card recommendations applied for: temperature, top_p');
  });

  it('omits the card note when the list is empty', () => {
    const out = buildModelfile({
      ggufFilename: 'm.gguf', repoId: 'o/r', quant: 'Q4_K_M', hw: hw(), params: base,
      cardSource: [],
    });
    expect(out).not.toContain('model-card recommendations');
  });

  it('falls back to n/a and none in the header', () => {
    const out = buildModelfile({
      ggufFilename: 'm.gguf', repoId: 'o/r', quant: 'Q4_K_M',
      hw: hw({ gpuName: null }), params: base,
    });
    expect(out).toContain('Compatibility: n/a');
    expect(out).toContain('Target GPU  : none');
  });
});

describe('suggestTag', () => {
  it('slugifies the repo and quant into an ollama-safe tag', () => {
    expect(suggestTag('bartowski/Llama-3.2-3B-Instruct-GGUF', 'Q4_K_M')).toMatch(/^[a-z0-9._-]+:[a-z0-9._-]+$/);
  });
  it('is stable for the same inputs', () => {
    expect(suggestTag('o/r', 'Q4_K_M')).toBe(suggestTag('o/r', 'Q4_K_M'));
  });
});

describe('capacity tiers across the range', () => {
  it.each([
    [48, 128, 'workstation'],
    [24, 64, undefined],
    [12, 32, undefined],
    [8, 32, undefined],
    [4, 16, undefined],
    [0, 8, undefined],
  ])('returns a coherent tier for %i GB VRAM / %i GB RAM', (vramGB, ramGB, key) => {
    const profile = hw({ vramMiB: vramGB * 1024, ramMiB: ramGB * 1024, gpuName: vramGB ? 'GPU' : null });
    const tier = tierFor(profile);
    expect(tier.label).toBeTruthy();
    expect(tier.summary).toBeTruthy();
    expect(tier.runs.length).toBeGreaterThan(0);
    expect(tier.picks.length).toBeGreaterThan(0);
    expect(tier.searchKeywords.length).toBeGreaterThan(0);
    if (key) expect(tier.key).toBe(key);
  });

  it('scores a no-GPU machine purely on RAM and CPU', () => {
    const s = scoreHardware(hw({ vramMiB: 0, gpuName: null }));
    expect(s.gpuScore).toBe(0);
    expect(s.score).toBeGreaterThan(0);
  });

  it('caps the GPU curve at the top of the range', () => {
    const huge = scoreHardware(hw({ vramMiB: 200 * 1024, ramMiB: 512 * 1024, cpuCores: 128 }));
    expect(huge.gpuScore).toBeLessThanOrEqual(100);
    expect(huge.cpuScore).toBe(100);
    expect(huge.score).toBeLessThanOrEqual(100);
  });

  it('treats sub-1GB VRAM as no GPU', () => {
    expect(scoreHardware(hw({ vramMiB: 512 })).gpuScore).toBe(0);
  });
});
