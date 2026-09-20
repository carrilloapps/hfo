import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchReadme, loadCardParams, parseCardParams } from '../src/core/readme.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchReadme', () => {
  it('fetches the raw README from the main branch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '# hi' });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchReadme('org/repo')).toBe('# hi');
    expect(fetchMock.mock.calls[0][0]).toBe('https://huggingface.co/org/repo/raw/main/README.md');
  });

  it('sends a bearer token when one is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await fetchReadme('org/repo', 'tok');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('omits Authorization when no token is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await fetchReadme('org/repo');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }));
    expect(await fetchReadme('org/missing')).toBeNull();
  });

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchReadme('org/repo')).toBeNull();
  });
});

describe('parseCardParams — temperature', () => {
  it('reads a plain value', () => {
    const r = parseCardParams('Use temperature: 0.6 for best results');
    expect(r.params.temperature).toBe(0.6);
    expect(r.foundKeys).toContain('temperature');
  });

  it('averages a range', () => {
    expect(parseCardParams('temperature: 0.5-0.7').params.temperature).toBe(0.6);
  });

  it('accepts "to" and en-dash ranges', () => {
    expect(parseCardParams('temperature: 0.2 to 0.4').params.temperature).toBe(0.3);
    expect(parseCardParams('temperature: 0.2–0.4').params.temperature).toBe(0.3);
  });

  it('accepts the short "temp" spelling', () => {
    expect(parseCardParams('temp = 0.8').params.temperature).toBe(0.8);
  });

  it('accepts an equals sign', () => {
    expect(parseCardParams('temperature = 1.0').params.temperature).toBe(1);
  });

  it('rejects a value above the sane ceiling', () => {
    const r = parseCardParams('temperature: 9');
    expect(r.params.temperature).toBeUndefined();
    expect(r.foundKeys).not.toContain('temperature');
  });

  it('rejects a negative value', () => {
    expect(parseCardParams('temperature: -1').params.temperature).toBeUndefined();
  });
});

describe('parseCardParams — top_p, top_k, min_p', () => {
  it.each(['top_p: 0.9', 'top-p: 0.9', 'top p: 0.9', 'topp: 0.9'])('reads %s', (line) => {
    expect(parseCardParams(line).params.topP).toBe(0.9);
  });

  it('averages a top_p range', () => {
    expect(parseCardParams('top_p: 0.8-1.0').params.topP).toBe(0.9);
  });

  it('rejects a top_p of 0 or above 1', () => {
    expect(parseCardParams('top_p: 0').params.topP).toBeUndefined();
    expect(parseCardParams('top_p: 1.5').params.topP).toBeUndefined();
  });

  it('reads and rounds top_k', () => {
    expect(parseCardParams('top_k: 40').params.topK).toBe(40);
    expect(parseCardParams('top_k: 39.6').params.topK).toBe(40);
  });

  it('rejects an out-of-range top_k', () => {
    expect(parseCardParams('top_k: 0').params.topK).toBeUndefined();
    expect(parseCardParams('top_k: 900').params.topK).toBeUndefined();
  });

  it('reads min_p', () => {
    expect(parseCardParams('min_p: 0.05').params.minP).toBe(0.05);
  });

  it('rejects a min_p above 1', () => {
    expect(parseCardParams('min_p: 2').params.minP).toBeUndefined();
  });
});

describe('parseCardParams — repeat penalty', () => {
  it.each(['repeat_penalty: 1.1', 'repeat-penalty: 1.1', 'rep_penalty: 1.1', 'repetition penalty is not matched'])(
    'handles %s',
    (line) => {
      const r = parseCardParams(line);
      if (line.includes('not matched')) expect(r.params.repeatPenalty).toBeUndefined();
      else expect(r.params.repeatPenalty).toBe(1.1);
    },
  );

  it('averages a range', () => {
    expect(parseCardParams('repeat_penalty: 1.0-1.2').params.repeatPenalty).toBe(1.1);
  });

  it('rejects values outside 0.5-2', () => {
    expect(parseCardParams('repeat_penalty: 0.1').params.repeatPenalty).toBeUndefined();
    expect(parseCardParams('repeat_penalty: 5').params.repeatPenalty).toBeUndefined();
  });
});

describe('parseCardParams — context size', () => {
  it.each([
    'ctx_size: 8192',
    'context length: 8192',
    'context_size: 8192',
    'context window: 8192',
  ])('reads %s', (line) => {
    expect(parseCardParams(line).params.ctxSize).toBe(8192);
  });

  it('reads the llama.cpp flag form', () => {
    expect(parseCardParams('run with --ctx-size 4096').params.ctxSize).toBe(4096);
  });

  it('reads a value with no separator', () => {
    expect(parseCardParams('context length 32768').params.ctxSize).toBe(32768);
  });

  it('rejects a context below 512 or absurdly large', () => {
    expect(parseCardParams('ctx_size: 128').params.ctxSize).toBeUndefined();
    expect(parseCardParams('ctx_size: 99999999').params.ctxSize).toBeUndefined();
  });
});

describe('parseCardParams — overall', () => {
  it('returns empty params and the raw text for a card with nothing to find', () => {
    const r = parseCardParams('# Just a title\n\nNo settings here.');
    expect(r.params).toEqual({});
    expect(r.foundKeys).toEqual([]);
    expect(r.raw).toContain('Just a title');
  });

  it('collects every key it recognises', () => {
    const card = [
      'temperature: 0.7',
      'top_p: 0.95',
      'top_k: 40',
      'repeat_penalty: 1.05',
      'min_p: 0.05',
      'ctx_size: 8192',
    ].join('\n');
    const r = parseCardParams(card);
    expect(r.foundKeys.sort()).toEqual(
      ['ctx_size', 'min_p', 'repeat_penalty', 'temperature', 'top_k', 'top_p'],
    );
  });

  it('is case-insensitive', () => {
    expect(parseCardParams('TEMPERATURE: 0.3').params.temperature).toBe(0.3);
  });

  it('keeps the raw card text', () => {
    expect(parseCardParams('hello').raw).toBe('hello');
  });
});

describe('loadCardParams', () => {
  it('parses the fetched card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: async () => 'temperature: 0.42',
    }));
    const r = await loadCardParams('org/repo');
    expect(r.params.temperature).toBe(0.42);
    expect(r.raw).toBe('temperature: 0.42');
  });

  it('returns an empty card when the README cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }));
    expect(await loadCardParams('org/missing')).toEqual({ params: {}, foundKeys: [], raw: null });
  });

  it('passes the token through to the fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await loadCardParams('org/repo', 'tok');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
});
