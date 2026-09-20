import { describe, it, expect, afterEach } from 'vitest';
import {
  appleGpuBudgetMiB,
  appleHeuristicBudgetMiB,
  estimateFitInVram,
} from '../src/core/hardware.js';
import type { HardwareProfile } from '../src/core/hardware.js';

const GB = 1024;

function mac(vramMiB: number, ramMiB: number): HardwareProfile {
  return {
    gpuName: 'Apple M3 Max',
    vramMiB,
    ramMiB,
    cpuCores: 14,
    platform: 'darwin',
    unifiedMemory: true,
  };
}

afterEach(() => {
  delete process.env.HFO_VRAM_MIB;
});

// The heuristic is asserted through the pure entry point on purpose. Going via
// appleGpuBudgetMiB would read `iogpu.wired_limit_mb`, which on a real Mac that
// has the sysctl set returns one fixed figure regardless of the ramMiB argument
// — so every scaling and range assertion below would flake on a tuned machine.
describe('appleDefaultGpuShare / appleHeuristicBudgetMiB', () => {
  it('gives a small Mac a conservative share, never zero', () => {
    const budget = appleHeuristicBudgetMiB(8 * GB);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(8 * GB);
  });

  it('scales the share up with total memory', () => {
    const small = appleHeuristicBudgetMiB(16 * GB) / (16 * GB);
    const mid = appleHeuristicBudgetMiB(64 * GB) / (64 * GB);
    const large = appleHeuristicBudgetMiB(128 * GB) / (128 * GB);
    expect(small).toBeLessThan(large);
    expect(mid).toBeLessThanOrEqual(large);
  });

  it('stays inside the range real machines report (60-80%)', () => {
    for (const ramGB of [8, 16, 24, 32, 36, 48, 64, 96, 128, 192, 512]) {
      const share = appleHeuristicBudgetMiB(ramGB * GB) / (ramGB * GB);
      // Budgets are whole MiB, so allow a hair of rounding slack either side.
      expect(share, `${ramGB}GB`).toBeGreaterThan(0.599);
      expect(share, `${ramGB}GB`).toBeLessThan(0.801);
    }
  });

  it('leaves real headroom for the OS on every size', () => {
    for (const ramGB of [8, 16, 64, 128]) {
      const budget = appleHeuristicBudgetMiB(ramGB * GB);
      expect(ramGB * GB - budget, `${ramGB}GB`).toBeGreaterThan(2 * GB);
    }
  });
});

describe('appleGpuBudgetMiB', () => {
  // Host-dependent by design: reads sysctl on macOS, falls back elsewhere.
  // Only assert what holds on every platform.
  it('always returns a usable positive budget', async () => {
    const budget = await appleGpuBudgetMiB(32 * GB);
    expect(budget).toBeGreaterThan(0);
    expect(Number.isInteger(budget)).toBe(true);
  });
});

describe('estimateFitInVram on unified memory', () => {
  it('fits a 7B Q4 on a 36 GB budget derived from a 48 GB Mac', () => {
    const hw = mac(Math.round(48 * GB * 0.72), 48 * GB);
    const sevenB = 4.4 * 1024 * 1024 * 1024;
    const res = estimateFitInVram(sevenB, hw);
    expect(res.fits).toBe(true);
    expect(res.ratio).toBe(1);
  });

  it('is the difference between "CPU-only" and "fits" — the 0-VRAM regression', () => {
    const broken = estimateFitInVram(4.4 * 1024 * 1024 * 1024, mac(0, 48 * GB));
    const fixed = estimateFitInVram(4.4 * 1024 * 1024 * 1024, mac(Math.round(48 * GB * 0.72), 48 * GB));
    expect(broken.fits).toBe(false);
    expect(broken.ratio).toBe(0);
    expect(fixed.fits).toBe(true);
  });

  it('still refuses a model larger than the GPU budget', () => {
    const hw = mac(Math.round(16 * GB * 0.65), 16 * GB);
    expect(estimateFitInVram(40 * 1024 * 1024 * 1024, hw).fits).toBe(false);
  });
});
