import { describe, it, expect } from 'vitest';
import { buildModelfile, suggestTag } from '../src/modelfile.js';
import type { HardwareProfile } from '../src/hardware.js';
import type { ResolvedParams } from '../src/plan.js';

const hw: HardwareProfile = {
  gpuName: 'RTX 3050',
  vramMiB: 4096,
  ramMiB: 65536,
  cpuCores: 12,
  platform: 'win32',
};

const params: ResolvedParams = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  repeatPenalty: 1.05,
  minP: 0.05,
  numCtx: 8192,
  numBatch: 512,
  numGpu: 99,
  numThread: null,
  repeatLastN: 256,
};

describe('buildModelfile', () => {
  it('includes the FROM line + all PARAMETER values', () => {
    const mf = buildModelfile({
      ggufFilename: 'foo.gguf',
      repoId: 'org/repo',
      quant: 'Q4_K_M',
      hw,
      params,
      isCodeModel: true,
      scoreLabel: '95/100 (Full GPU)',
    });
    expect(mf).toContain('FROM ./foo.gguf');
    expect(mf).toContain('PARAMETER temperature 0.7');
    expect(mf).toContain('PARAMETER num_gpu 99');
    expect(mf).toContain('SYSTEM');
    expect(mf).toContain('org/repo');
    expect(mf).toContain('Q4_K_M');
  });

  it('comments num_gpu when fitsFully is false (null)', () => {
    const mf = buildModelfile({
      ggufFilename: 'foo.gguf',
      repoId: 'org/repo',
      quant: 'Q8_0',
      hw,
      params: { ...params, numGpu: null },
      scoreLabel: '68/100 (Partial 68%)',
    });
    expect(mf).toMatch(/#\s*PARAMETER num_gpu 99/);
  });

  it('surfaces HF-card contributions in the header comment', () => {
    const mf = buildModelfile({
      ggufFilename: 'foo.gguf',
      repoId: 'org/repo',
      quant: 'Q4_K_M',
      hw,
      params,
      cardSource: ['temperature', 'top_p'],
    });
    expect(mf).toContain('HF model-card recommendations applied for: temperature, top_p');
  });
});

describe('suggestTag', () => {
  it('strips gguf/imatrix suffixes from repo names', () => {
    expect(suggestTag('org/Foo-Bar-GGUF', 'Q4_K_M')).toBe('foo-bar:q4-k-m');
    expect(suggestTag('org/Foo.GGUF', 'Q4_K_M')).toBe('foo:q4-k-m');
  });
  it('slugifies the tag to ollama-safe chars', () => {
    const tag = suggestTag('org/Foo.Bar v2!', 'Q5_K_M');
    expect(tag).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
  });
});
