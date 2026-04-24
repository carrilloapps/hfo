import { describe, it, expect } from 'vitest';
import {
  BENCH_PROMPTS,
  aggregate,
  runOne,
  runBench,
  type BenchRun,
} from '../src/core/bench.js';

describe('BENCH_PROMPTS', () => {
  it('exposes warmup + at least 3 scoring prompts', () => {
    expect(BENCH_PROMPTS.length).toBeGreaterThanOrEqual(4);
    expect(BENCH_PROMPTS[0]?.id).toBe('warmup');
    const ids = BENCH_PROMPTS.map((p) => p.id);
    expect(ids).toContain('code');
    expect(ids).toContain('reasoning');
  });
  it('every prompt sets a positive token budget', () => {
    for (const p of BENCH_PROMPTS) {
      expect(p.expectTokens).toBeGreaterThan(0);
    }
  });
});

describe('aggregate', () => {
  const make = (id: string, outputTokens: number, tps: number, ttft: number, total: number): BenchRun => ({
    id, prompt: id, outputTokens, tokensPerSec: tps, ttftMs: ttft, totalMs: total,
  });

  it('returns zeros when only warmup is present', () => {
    const agg = aggregate([make('warmup', 16, 80, 100, 200)]);
    expect(agg.tokensPerSec).toBe(0);
    expect(agg.ttftMs).toBe(0);
  });

  it('averages tok/s + TTFT across non-warmup runs', () => {
    const runs: BenchRun[] = [
      make('warmup', 16, 1, 1, 10),
      make('code', 100, 80, 120, 1500),
      make('reasoning', 200, 60, 180, 4000),
    ];
    const agg = aggregate(runs);
    expect(agg.tokensPerSec).toBeCloseTo(70, 5);
    expect(agg.ttftMs).toBeCloseTo(150, 5);
  });

  it('sums totalTokens and totalMs across ALL runs (warmup included)', () => {
    const runs: BenchRun[] = [
      make('warmup', 16, 1, 1, 10),
      make('code',  100, 80, 120, 1500),
    ];
    const agg = aggregate(runs);
    expect(agg.totalTokens).toBe(116);
    expect(agg.totalMs).toBe(1510);
  });
});

describe('runOne (with mocked fetch)', () => {
  // Builds a fake streaming fetch that emits NDJSON chunks. Final chunk
  // carries eval_count + eval_duration so runOne can compute tok/s from
  // the server report rather than wall clock.
  function mockFetch(chunks: string[]): typeof fetch {
    return (async () => {
      const encoded = chunks.map((c) => new TextEncoder().encode(c));
      let i = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(ctrl) {
          if (i < encoded.length) {
            ctrl.enqueue(encoded[i++]);
          } else {
            ctrl.close();
          }
        },
      });
      return {
        ok: true,
        status: 200,
        body: stream,
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('reports outputTokens from the final eval_count and derives tok/s from eval_duration', async () => {
    const chunks = [
      '{"response":"a","done":false}\n',
      '{"response":"b","done":false}\n',
      // Final chunk with eval_count=50 tokens in eval_duration=1_000_000_000 ns (= 1s)
      '{"response":"","done":true,"eval_count":50,"eval_duration":1000000000}\n',
    ];
    const run = await runOne(
      'http://localhost:11434',
      'llama3.1:8b',
      BENCH_PROMPTS[1]!,
      mockFetch(chunks),
    );
    expect(run.outputTokens).toBe(50);
    // 50 tokens in 1 second -> 50 tok/s (± floating point)
    expect(run.tokensPerSec).toBeCloseTo(50, 5);
    expect(run.ttftMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to wall-clock when eval_duration is missing', async () => {
    const chunks = [
      '{"response":"x","done":false}\n',
      '{"response":"","done":true,"eval_count":20}\n',
    ];
    const run = await runOne(
      'http://localhost:11434',
      'tinyllama:latest',
      BENCH_PROMPTS[0]!,
      mockFetch(chunks),
    );
    expect(run.outputTokens).toBe(20);
    // Wall-clock based -> > 0 tok/s, can't assert exact value
    expect(run.tokensPerSec).toBeGreaterThan(0);
  });

  it('throws when Ollama returns a non-OK status', async () => {
    const fake: typeof fetch = (async () => ({ ok: false, status: 500, body: null })) as unknown as typeof fetch;
    await expect(
      runOne('http://localhost:11434', 'nope', BENCH_PROMPTS[0]!, fake),
    ).rejects.toThrow(/500/);
  });
});

describe('runBench', () => {
  it('produces an hfo-bench-v1 report covering every prompt', async () => {
    const chunks = ['{"response":"ok","done":true,"eval_count":10,"eval_duration":500000000}\n'];
    const fake: typeof fetch = (async () => {
      const encoded = new TextEncoder().encode(chunks[0]!);
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(ctrl) {
          if (!sent) { ctrl.enqueue(encoded); sent = true; } else { ctrl.close(); }
        },
      });
      return { ok: true, status: 200, body: stream } as unknown as Response;
    }) as unknown as typeof fetch;

    const report = await runBench('tinyllama:latest', {
      host: 'http://localhost:11434',
      ollamaVersion: '0.21.0',
      hfoVersion: '0.1.0',
      hardware: {
        gpuName: 'Test GPU',
        vramMiB: 8192,
        ramMiB: 32768,
        cpuCores: 8,
        platform: 'linux',
      },
      fetchImpl: fake,
    });

    expect(report.schema).toBe('hfo-bench-v1');
    expect(report.tag).toBe('tinyllama:latest');
    expect(report.ollamaVersion).toBe('0.21.0');
    expect(report.hfoVersion).toBe('0.1.0');
    expect(report.hardware.gpuName).toBe('Test GPU');
    expect(report.runs).toHaveLength(BENCH_PROMPTS.length);
    expect(report.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.aggregate.tokensPerSec).toBeGreaterThan(0);
  });
});
