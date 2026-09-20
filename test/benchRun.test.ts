import { describe, it, expect, vi, afterEach } from 'vitest';
import { runOne, runBench, BENCH_PROMPTS } from '../src/core/bench.js';
import type { HardwareProfile } from '../src/core/hardware.js';

const hw: HardwareProfile = {
  gpuName: 'GPU', vramMiB: 8192, ramMiB: 32768,
  cpuCores: 8, platform: 'linux', unifiedMemory: false,
};

afterEach(() => vi.unstubAllGlobals());

/**
 * A fetch stub that streams the given NDJSON chunks back as the body.
 *
 * Builds a fresh Response and ReadableStream per call: runBench walks the
 * whole prompt suite, and a stream can only be consumed once.
 */
function streamingFetch(chunks: string[], init: { ok?: boolean; status?: number } = {}) {
  return vi.fn().mockImplementation(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => 'error body',
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
  }));
}

describe('runOne', () => {
  const prompt = BENCH_PROMPTS[0];

  it('derives tok/s from eval_count and eval_duration', async () => {
    const f = streamingFetch([
      '{"response":"a"}\n',
      '{"response":"b","eval_count":200,"eval_duration":2000000000}\n',
      '{"done":true}\n',
    ]);
    const r = await runOne('http://h', 'demo:q4', prompt, f);
    expect(r.id).toBe(prompt.id);
    expect(r.outputTokens).toBe(200);
    // 200 tokens / 2s = 100 tok/s
    expect(r.tokensPerSec).toBeCloseTo(100, 5);
  });

  it('falls back to wall-clock throughput when eval_duration is absent', async () => {
    const f = streamingFetch(['{"response":"a","eval_count":50}\n']);
    const r = await runOne('http://h', 'demo:q4', prompt, f);
    expect(r.outputTokens).toBe(50);
    expect(r.tokensPerSec).toBeGreaterThanOrEqual(0);
  });

  it('reports zero throughput when nothing was generated', async () => {
    const f = streamingFetch(['{"done":true}\n']);
    const r = await runOne('http://h', 'demo:q4', prompt, f);
    expect(r.outputTokens).toBe(0);
    expect(r.tokensPerSec).toBe(0);
  });

  it('skips blank and malformed NDJSON lines', async () => {
    const f = streamingFetch([
      '\n',
      'not json at all\n',
      '{"response":"x","eval_count":10,"eval_duration":1000000000}\n',
    ]);
    const r = await runOne('http://h', 'demo:q4', prompt, f);
    expect(r.outputTokens).toBe(10);
  });

  it('handles a chunk split across two reads', async () => {
    const f = streamingFetch(['{"response":"x","eval_c', 'ount":7,"eval_duration":1000000000}\n']);
    const r = await runOne('http://h', 'demo:q4', prompt, f);
    expect(r.outputTokens).toBe(7);
  });

  it('records a TTFT no greater than the total', async () => {
    const f = streamingFetch(['{"response":"a"}\n', '{"eval_count":1,"eval_duration":1000000}\n']);
    const r = await runOne('http://h', 'demo:q4', prompt, f);
    expect(r.ttftMs).toBeLessThanOrEqual(r.totalMs);
    expect(r.ttftMs).toBeGreaterThanOrEqual(0);
  });

  it('posts to /api/generate with streaming enabled', async () => {
    const f = streamingFetch(['{"done":true}\n']);
    await runOne('http://h', 'demo:q4', prompt, f);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain('/api/generate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'demo:q4', stream: true });
  });

  it('throws when Ollama rejects the request', async () => {
    const f = streamingFetch([], { ok: false, status: 404 });
    await expect(runOne('http://h', 'missing:q4', prompt, f)).rejects.toThrow();
  });
});

describe('runBench', () => {
  it('runs the whole prompt suite and aggregates it', async () => {
    const f = streamingFetch(['{"response":"x","eval_count":100,"eval_duration":1000000000}\n']);
    const report = await runBench('demo:q4', {
      hardware: hw, hfoVersion: '0.2.0', ollamaVersion: 'v1', fetchImpl: f,
    });

    expect(report.tag).toBe('demo:q4');
    expect(report.runs).toHaveLength(BENCH_PROMPTS.length);
    expect(report.ollamaVersion).toBe('v1');
    expect(report.hfoVersion).toBe('0.2.0');
    expect(report.hardware).toMatchObject({ gpuName: 'GPU', vramMiB: 8192, platform: 'linux' });
    expect(report.aggregate.totalTokens).toBe(100 * BENCH_PROMPTS.length);
    expect(report.aggregate.tokensPerSec).toBeGreaterThan(0);
  });

  it('defaults ollamaVersion to null when not supplied', async () => {
    const f = streamingFetch(['{"eval_count":1,"eval_duration":1000000}\n']);
    const report = await runBench('demo:q4', { hardware: hw, hfoVersion: '0.2.0', fetchImpl: f });
    expect(report.ollamaVersion).toBeNull();
  });

  it('honours an explicit host', async () => {
    const f = streamingFetch(['{"done":true}\n']);
    await runBench('demo:q4', {
      hardware: hw, hfoVersion: '0.2.0', host: 'http://10.0.0.9:11434', fetchImpl: f,
    });
    expect(String(f.mock.calls[0][0])).toContain('10.0.0.9');
  });

  it('falls back to OLLAMA_HOST then localhost', async () => {
    const prev = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = 'http://envhost:11434';
    try {
      const f = streamingFetch(['{"done":true}\n']);
      await runBench('demo:q4', { hardware: hw, hfoVersion: '0.2.0', fetchImpl: f });
      expect(String(f.mock.calls[0][0])).toContain('envhost');
    } finally {
      if (prev === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = prev;
    }
  });
});
