import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// buildPlans asks Ollama which tags already exist; stub it so the suite never
// depends on a daemon being installed.
const ollamaList = vi.hoisted(() => vi.fn<() => Promise<string[]>>());
vi.mock('../src/infra/ollama.js', () => ({ ollamaList }));

import { buildDefaultParams, buildPlans } from '../src/core/plan.js';
import type { QuantScore } from '../src/core/scoring.js';
import type { HardwareProfile } from '../src/core/hardware.js';
import type { HfRepoInfo } from '../src/core/hf.js';
import type { RecommendedParams } from '../src/core/readme.js';

const hw: HardwareProfile = {
  gpuName: 'RTX 4090',
  vramMiB: 24576,
  ramMiB: 65536,
  cpuCores: 16,
  platform: 'linux',
  unifiedMemory: false,
};

function quant(name: string, fitsFully: boolean): QuantScore {
  return {
    file: { path: `Model-${name}.gguf`, size: 4 * 1024 * 1024 * 1024, oid: '' },
    quant: name,
    fileMiB: 4096,
    score: fitsFully ? 96 : 50,
    label: fitsFully ? 'Full GPU' : 'Partial',
    verdict: fitsFully ? 'excellent' : 'heavy',
    fitsFully,
    gpuLayerRatio: fitsFully ? 1 : 0.5,
  };
}

const repo: HfRepoInfo = {
  id: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
  files: [],
  ggufFiles: [],
};

describe('buildDefaultParams', () => {
  const emptyCard: RecommendedParams = {};

  it('uses the roomy profile when the quant fits fully in VRAM', () => {
    expect(buildDefaultParams(quant('Q4_K_M', true), hw, emptyCard, false)).toEqual({
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
    });
  });

  it('halves context and batch and leaves numGpu on auto when it does not fit', () => {
    const p = buildDefaultParams(quant('Q8_0', false), hw, emptyCard, false);
    expect(p.numCtx).toBe(4096);
    expect(p.numBatch).toBe(256);
    expect(p.numGpu).toBeNull();
  });

  it('drops temperature for a code model', () => {
    expect(buildDefaultParams(quant('Q4_K_M', true), hw, emptyCard, true).temperature).toBe(0.4);
  });

  it('lets the model card override every sampling value', () => {
    const card: RecommendedParams = {
      temperature: 0.15,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.2,
      minP: 0.01,
    };
    expect(buildDefaultParams(quant('Q4_K_M', true), hw, card, false)).toMatchObject({
      temperature: 0.15,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.2,
      minP: 0.01,
    });
  });

  it('honours a card context size that sits below the cap', () => {
    expect(buildDefaultParams(quant('Q4_K_M', true), hw, { ctxSize: 16384 }, false).numCtx)
      .toBe(16384);
  });

  it('clamps an outsized card context to 32768 when the quant fits', () => {
    expect(buildDefaultParams(quant('Q4_K_M', true), hw, { ctxSize: 1_000_000 }, false).numCtx)
      .toBe(32768);
  });

  it('clamps harder — to 8192 — when the quant does not fit', () => {
    expect(buildDefaultParams(quant('Q8_0', false), hw, { ctxSize: 1_000_000 }, false).numCtx)
      .toBe(8192);
  });

  it('keeps a code model temperature when the card does not specify one', () => {
    expect(buildDefaultParams(quant('Q4_K_M', true), hw, { topK: 10 }, true).temperature).toBe(0.4);
  });
});

describe('buildPlans', () => {
  let dest: string;

  beforeEach(async () => {
    dest = await mkdtemp(join(tmpdir(), 'hfo-plan-test-'));
    ollamaList.mockReset();
    ollamaList.mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(dest, { recursive: true, force: true });
  });

  it('derives a folder, filenames and a tag for each quant', async () => {
    const plans = await buildPlans(repo, [quant('Q4_K_M', true)], dest);
    expect(plans).toHaveLength(1);
    const [p] = plans;
    expect(p.dir).toBe(join(dest, 'q4-k-m')); // underscores become dashes
    expect(p.destFile).toBe(join(dest, 'q4-k-m', 'Model-Q4_K_M.gguf'));
    expect(p.modelfilePath).toBe(join(dest, 'q4-k-m', 'Modelfile'));
    expect(p.action).toBe('install');
    expect(p.tag).toBeTruthy();
  });

  it('reports no existing file when the destination is empty', async () => {
    const [p] = await buildPlans(repo, [quant('Q4_K_M', true)], dest);
    expect(p.fileExistsBytes).toBeNull();
  });

  it('reports the byte size when the GGUF is already on disk', async () => {
    const dir = join(dest, 'q4-k-m');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'Model-Q4_K_M.gguf'), Buffer.alloc(2048));
    const [p] = await buildPlans(repo, [quant('Q4_K_M', true)], dest);
    expect(p.fileExistsBytes).toBe(2048);
  });

  it('flags a tag Ollama already has registered', async () => {
    const [probe] = await buildPlans(repo, [quant('Q4_K_M', true)], dest);
    ollamaList.mockResolvedValue([probe.tag]);
    const [p] = await buildPlans(repo, [quant('Q4_K_M', true)], dest);
    expect(p.tagExists).toBe(true);
  });

  it('leaves tagExists false for an unrelated tag', async () => {
    ollamaList.mockResolvedValue(['something:else']);
    const [p] = await buildPlans(repo, [quant('Q4_K_M', true)], dest);
    expect(p.tagExists).toBe(false);
  });

  it('plans every quant it is handed, in order', async () => {
    const plans = await buildPlans(
      repo,
      [quant('Q4_K_M', true), quant('Q6_K', true), quant('Q8_0', false)],
      dest,
    );
    expect(plans.map((p) => p.quant.quant)).toEqual(['Q4_K_M', 'Q6_K', 'Q8_0']);
  });

  it('returns an empty list when there are no quants', async () => {
    expect(await buildPlans(repo, [], dest)).toEqual([]);
  });
});
