import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildApp, versionLines } from '../src/infra/about.js';
import {
  buildDirectArgs,
  LAUNCH_TARGETS,
  type LaunchTarget,
} from '../src/core/launch.js';
import { runOne, BENCH_PROMPTS } from '../src/core/bench.js';

const byId = (id: string) => {
  const t = LAUNCH_TARGETS.find((x) => x.id === id);
  if (!t) throw new Error(`no target ${id}`);
  return t;
};

let sandbox: string;
beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-100-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(sandbox, { recursive: true, force: true });
});

describe('buildApp — every documented fallback', () => {
  it('fills in all defaults for an empty manifest', () => {
    expect(buildApp({})).toEqual({
      packageName: 'hfo-cli',
      binary: 'hfo',
      version: '0.0.0',
      description: '',
      license: 'UNLICENSED',
      homepage: '',
      author: { name: 'unknown', email: undefined, url: undefined },
    });
  });

  it('falls back to "hfo" when the bin map is present but empty', () => {
    expect(buildApp({ bin: {} }).binary).toBe('hfo');
  });

  it('takes the first key of a multi-entry bin map', () => {
    expect(buildApp({ bin: { first: './a.js', second: './b.js' } }).binary).toBe('first');
  });

  it('passes every supplied field straight through', () => {
    expect(buildApp({
      name: 'n', version: 'v', description: 'd', license: 'l', homepage: 'h',
      bin: { b: './b' }, author: { name: 'A' },
    })).toEqual({
      packageName: 'n', binary: 'b', version: 'v', description: 'd',
      license: 'l', homepage: 'h',
      author: { name: 'A', email: undefined, url: undefined },
    });
  });
});

describe('buildDirectArgs — the non-direct guard', () => {
  it('returns no runner args for a target served by ollama launch', () => {
    // buildDirectArgs is only called for direct targets in production; the
    // guard exists so a mis-wired caller gets an empty argv, not a crash.
    expect(buildDirectArgs(byId('claude'))).toEqual([]);
  });

  it('still appends passthrough extras for a non-direct target', () => {
    expect(buildDirectArgs(byId('claude'), { extra: ['--x'] })).toEqual(['--x']);
  });

  it('ignores a model for a target with no model flag declared', () => {
    const target: LaunchTarget = { ...byId('claude'), modelFlag: undefined };
    expect(buildDirectArgs(target, { model: 'gemini-3.1-pro-high' })).toEqual([]);
  });

  it('forwards a model for a direct target that binds Ollama models', () => {
    // ollamaBackend defaults to true, so the tag guard does not apply.
    const target: LaunchTarget = {
      ...byId('antigravity'),
      ollamaBackend: undefined,
      modelFlag: '--model',
    };
    expect(buildDirectArgs(target, { model: 'llama3.1:8b' }))
      .toEqual(['--model', 'llama3.1:8b']);
  });
});

describe('runOne — zero elapsed time', () => {
  it('reports 0 tok/s when the clock does not advance at all', async () => {
    // Freeze performance.now so totalMs is exactly 0 and the last arm of the
    // throughput ternary is the one taken.
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const f = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"eval_count":5,"eval_duration":0}\n'));
          c.close();
        },
      }),
    }));
    const r = await runOne('http://h', 't', BENCH_PROMPTS[0], f);
    expect(r.totalMs).toBe(0);
    expect(r.tokensPerSec).toBe(0);
  });
});

describe('versionLines', () => {
  it('prefers the author url when there is one', () => {
    const [first, second] = versionLines(buildApp({
      name: 'n', version: '1.2.3', license: 'MIT', bin: { cli: './c' },
      homepage: 'https://home.example',
      author: { name: 'Ada', url: 'https://ada.example' },
    }));
    expect(first).toBe('cli v1.2.3');
    expect(second).toBe('MIT · Ada · https://ada.example');
  });

  it('falls back to the homepage when the author has no url', () => {
    const [, second] = versionLines(buildApp({
      name: 'n', version: '1.2.3', license: 'MIT',
      homepage: 'https://home.example',
      author: { name: 'Ada' },
    }));
    expect(second).toBe('MIT · Ada · https://home.example');
  });

  it('falls back to an empty tail when neither is present', () => {
    const [, second] = versionLines(buildApp({ name: 'n', version: '0.0.1' }));
    expect(second).toBe('UNLICENSED · unknown · ');
  });

  it('defaults to the real app metadata when called with no argument', () => {
    const [first] = versionLines();
    expect(first).toMatch(/^hfo v\d+\.\d+\.\d+$/);
  });
});
