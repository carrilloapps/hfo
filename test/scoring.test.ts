import { describe, it, expect } from 'vitest';
import { scoreQuant, scoreRepo, scoreColor } from '../src/core/scoring.js';
import type { HardwareProfile } from '../src/core/hardware.js';
import type { HfFile } from '../src/core/hf.js';

const hw: HardwareProfile = {
  gpuName: 'RTX 3050',
  vramMiB: 4096,
  ramMiB: 65536,
  cpuCores: 12,
  platform: 'win32',
};

function mkFile(path: string, sizeBytes: number): HfFile {
  return { path, size: sizeBytes, oid: '' };
}

describe('scoreQuant', () => {
  it('returns 95+ when file fits in VRAM', () => {
    const res = scoreQuant(mkFile('Foo-Q4_K_M.gguf', 2 * 1024 * 1024 * 1024), hw);
    expect(res.fitsFully).toBe(true);
    expect(res.score).toBeGreaterThanOrEqual(95);
    expect(res.verdict).toBe('excellent');
  });

  it('gives a partial score when file exceeds VRAM', () => {
    const res = scoreQuant(mkFile('Foo-Q8_0.gguf', 4.5 * 1024 * 1024 * 1024), hw);
    expect(res.fitsFully).toBe(false);
    expect(res.score).toBeLessThan(95);
    expect(res.score).toBeGreaterThan(30);
    expect(res.gpuLayerRatio).toBeGreaterThan(0);
    expect(res.gpuLayerRatio).toBeLessThanOrEqual(1);
  });

  it('returns a CPU-only verdict on no-GPU hardware', () => {
    const noGpu: HardwareProfile = { ...hw, gpuName: null, vramMiB: 0 };
    const res = scoreQuant(mkFile('Foo-Q4_K_M.gguf', 2 * 1024 * 1024 * 1024), noGpu);
    expect(res.fitsFully).toBe(false);
    expect(res.verdict === 'heavy' || res.verdict === 'risky').toBe(true);
  });
});

describe('scoreRepo', () => {
  it('aggregates per-quant scores', () => {
    const files = [
      mkFile('Foo-Q2_K.gguf', 1 * 1024 * 1024 * 1024),
      mkFile('Foo-Q4_K_M.gguf', 2 * 1024 * 1024 * 1024),
      mkFile('Foo-Q8_0.gguf', 4.5 * 1024 * 1024 * 1024),
    ];
    const score = scoreRepo(files, hw);
    expect(score.perQuant.length).toBe(3);
    expect(score.best).toBeGreaterThanOrEqual(score.avg);
    expect(score.avg).toBeGreaterThanOrEqual(score.worst);
    // Sorted desc
    for (let i = 1; i < score.perQuant.length; i++) {
      expect(score.perQuant[i - 1].score).toBeGreaterThanOrEqual(score.perQuant[i].score);
    }
  });

  it('returns zeros when there are no files', () => {
    const score = scoreRepo([], hw);
    expect(score.best).toBe(0);
    expect(score.avg).toBe(0);
  });
});

describe('scoreColor', () => {
  it('maps score into green/yellow/red bands', () => {
    expect(scoreColor(95)).toBe('green');
    expect(scoreColor(65)).toBe('yellow');
    expect(scoreColor(20)).toBe('red');
  });
});
