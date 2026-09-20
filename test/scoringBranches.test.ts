import { describe, it, expect } from 'vitest';
import { scoreQuant } from '../src/core/scoring.js';
import type { HardwareProfile } from '../src/core/hardware.js';
import type { HfFile } from '../src/core/hf.js';

const MiB = 1024 * 1024;

function hw(vramMiB: number, ramMiB: number): HardwareProfile {
  return {
    gpuName: vramMiB > 0 ? 'GPU' : null,
    vramMiB,
    ramMiB,
    cpuCores: 8,
    platform: 'linux',
    unifiedMemory: false,
  };
}

// The quant in the filename earns a +2 bonus for Q4_K variants, so use a
// neutral name unless that bonus is what is being tested.
function file(mib: number, path = 'model-Q5_K_M.gguf'): HfFile {
  return { path, size: mib * MiB, oid: '' };
}

// usableVram = vramMiB - 600; needed = fileMiB + 350.
// Pick a VRAM budget that yields the gpuLayerRatio a case needs.
function vramForRatio(fileMiB: number, ratio: number): number {
  return Math.round((fileMiB + 350) * ratio) + 600;
}

describe('scoreQuant — full GPU', () => {
  it('scores 100 when there is generous headroom', () => {
    const r = scoreQuant(file(1000), hw(24576, 65536));
    expect(r.score).toBe(100);
    expect(r.label).toBe('Full GPU');
    expect(r.verdict).toBe('excellent');
    expect(r.fitsFully).toBe(true);
  });

  it('scores 95 when it fits but only just', () => {
    // headroomRatio <= 0.2 → 95
    const fileMiB = 1000;
    const usable = Math.ceil((fileMiB + 350) / 0.85); // ~18% headroom
    const r = scoreQuant(file(fileMiB), hw(usable + 600, 65536));
    expect(r.score).toBe(95);
    expect(r.verdict).toBe('excellent');
  });
});

describe('scoreQuant — no GPU at all', () => {
  it('scores 45 "CPU only" when RAM has comfortable room', () => {
    const r = scoreQuant(file(1000), hw(0, 65536));
    expect(r.score).toBe(45);
    expect(r.label).toBe('CPU only');
    expect(r.verdict).toBe('heavy');
    expect(r.note).toBe('slow — no GPU');
  });

  it('scores 20 "RAM tight" when RAM barely covers the model', () => {
    // usableRam = ram - 2048 must be < needed * 1.3
    const r = scoreQuant(file(4000), hw(0, 6144));
    expect(r.label).toBe('RAM tight');
    expect(r.verdict).toBe('risky');
    expect(r.note).toBe('may swap to disk');
  });

  it('treats a sub-reserve GPU as no GPU', () => {
    // 500 MiB VRAM is below the 600 MiB system reserve → usableVram 0
    const r = scoreQuant(file(1000), hw(500, 65536));
    expect(r.label).toBe('CPU only');
  });
});

describe('scoreQuant — partial offload bands', () => {
  const fileMiB = 2000;
  const ram = 131072; // big enough that the RAM penalty never fires

  it.each([
    [0.95, 88, 'good', 'Partial'],
    [0.80, 78, 'good', 'Partial'],
    [0.65, 68, 'ok', 'Partial'],
    [0.50, 56, 'ok', 'Partial'],
    [0.35, 46, 'heavy', 'Mostly CPU'],
    [0.20, 36, 'heavy', 'Mostly CPU'],
    [0.05, 26, 'risky', 'CPU-heavy'],
  ])('ratio %f scores %i (%s)', (ratio, score, verdict, labelPrefix) => {
    const r = scoreQuant(file(fileMiB), hw(vramForRatio(fileMiB, ratio), ram));
    expect(r.score).toBe(score);
    expect(r.verdict).toBe(verdict);
    expect(r.label).toContain(labelPrefix);
  });

  it('labels partial bands with the rounded percentage', () => {
    const r = scoreQuant(file(fileMiB), hw(vramForRatio(fileMiB, 0.8), ram));
    expect(r.label).toMatch(/^Partial \d+%$/);
  });
});

describe('scoreQuant — RAM pressure penalty', () => {
  it('drops the score and downgrades the verdict when the file nears RAM capacity', () => {
    // file > 70% of usable RAM, but still partially GPU-offloadable
    const fileMiB = 6000;
    const ram = 10240; // usableRam = 8192; 70% = 5734 < 6000
    const clean = scoreQuant(file(2000), hw(vramForRatio(2000, 0.8), 131072));
    const pressured = scoreQuant(file(fileMiB), hw(vramForRatio(fileMiB, 0.8), ram));
    expect(pressured.score).toBeLessThan(clean.score);
    expect(pressured.note).toBe('file approaches RAM capacity — risk of paging');
    expect(pressured.verdict).toBe('heavy');
  });

  it('never drops below 15', () => {
    const r = scoreQuant(file(9000), hw(0, 4096));
    expect(r.score).toBeGreaterThanOrEqual(15);
  });

  it('keeps the earlier note when one was already set', () => {
    const r = scoreQuant(file(9000), hw(0, 4096));
    expect(r.note).toBe('may swap to disk');
  });
});

describe('scoreQuant — Q4_K bonus', () => {
  it('adds two points for a Q4_K_M quant', () => {
    const big = hw(24576, 65536);
    const plain = scoreQuant(file(1000, 'model-Q5_K_M.gguf'), big);
    const q4km = scoreQuant(file(1000, 'model-Q4_K_M.gguf'), big);
    // Both already cap at 100, so compare in a band where there is room.
    expect(q4km.score).toBeGreaterThanOrEqual(plain.score);
  });

  it('lifts a partial-offload Q4_K_S above the same-size Q5', () => {
    const fileMiB = 2000;
    const h = hw(vramForRatio(fileMiB, 0.65), 131072);
    const q5 = scoreQuant(file(fileMiB, 'm-Q5_K_M.gguf'), h);
    const q4 = scoreQuant(file(fileMiB, 'm-Q4_K_S.gguf'), h);
    expect(q4.score).toBe(q5.score + 2);
  });

  it('caps the bonus at 100', () => {
    const r = scoreQuant(file(500, 'm-Q4_K_M.gguf'), hw(24576, 65536));
    expect(r.score).toBe(100);
  });

  it('gives no bonus to a plain Q4_0', () => {
    const fileMiB = 2000;
    const h = hw(vramForRatio(fileMiB, 0.65), 131072);
    expect(scoreQuant(file(fileMiB, 'm-Q4_0.gguf'), h).score)
      .toBe(scoreQuant(file(fileMiB, 'm-Q5_K_M.gguf'), h).score);
  });
});
