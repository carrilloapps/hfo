import { describe, it, expect } from 'vitest';
import { scoreHardware, tierFor, hfSearchUrl, hfSearchUrlForKeyword } from '../src/capacity.js';
import type { HardwareProfile } from '../src/hardware.js';

function hw(vram: number, ram: number, cores = 8): HardwareProfile {
  return { gpuName: vram > 0 ? 'GPU' : null, vramMiB: vram * 1024, ramMiB: ram * 1024, cpuCores: cores, platform: 'linux' };
}

describe('scoreHardware', () => {
  it('ranks a workstation above a budget laptop', () => {
    const ws = scoreHardware(hw(48, 128, 24));
    const budget = scoreHardware(hw(4, 16, 4));
    expect(ws.score).toBeGreaterThan(budget.score);
  });
  it('shifts weight to RAM+CPU when no GPU', () => {
    const cpuOnly = scoreHardware(hw(0, 64, 16));
    expect(cpuOnly.gpuScore).toBe(0);
    expect(cpuOnly.score).toBeGreaterThan(0);
  });
});

describe('tierFor', () => {
  it('returns workstation tier for 48+ GB VRAM', () => {
    expect(tierFor(hw(48, 128)).key).toBe('workstation');
  });
  it('returns budget tier for 4 GB VRAM', () => {
    expect(tierFor(hw(4, 64)).key).toBe('budget');
  });
  it('returns cpu-only for 0 VRAM', () => {
    expect(tierFor(hw(0, 64)).key).toBe('cpu-only');
  });
});

describe('hfSearchUrl', () => {
  it('builds a URL with library, pipeline and sort params', () => {
    const url = hfSearchUrl(tierFor(hw(4, 64)), { sort: 'trending' });
    expect(url).toMatch(/^https:\/\/huggingface\.co\/models\?/);
    expect(url).toContain('library=gguf');
    expect(url).toContain('pipeline_tag=text-generation');
    expect(url).toContain('sort=trending');
    expect(url).toContain('search=');
  });
});

describe('hfSearchUrlForKeyword', () => {
  it('builds a URL with the given search keyword', () => {
    const url = hfSearchUrlForKeyword('13B');
    expect(url).toContain('search=13B');
  });
});
