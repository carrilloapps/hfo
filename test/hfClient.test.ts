import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchRepoInfo, downloadFile, fileDownloadUrl } from '../src/core/hf.js';

// The HF API and the CDN are the only network hfo touches. Stub fetch so the
// suite asserts our request shape and error mapping without leaving the box.
let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-hf-test-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(sandbox, { recursive: true, force: true });
});

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('fetchRepoInfo', () => {
  it('requests the recursive tree and splits out the GGUF files', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { type: 'file', path: 'README.md', size: 100, oid: 'a' },
      { type: 'file', path: 'model-Q4_K_M.gguf', size: 4000, oid: 'b' },
      { type: 'directory', path: 'sub', size: 0, oid: 'c' },
      { type: 'file', path: 'sub/model-Q8_0.GGUF', size: 8000, oid: 'd' },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const info = await fetchRepoInfo('org/repo');
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://huggingface.co/api/models/org/repo/tree/main?recursive=true');
    expect(info.id).toBe('org/repo');
    expect(info.files).toHaveLength(3);               // the directory is dropped
    expect(info.ggufFiles.map((f) => f.path)).toEqual([
      'model-Q4_K_M.gguf',
      'sub/model-Q8_0.GGUF',                          // matched case-insensitively
    ]);
  });

  it('sends a User-Agent and no Authorization when no token is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await fetchRepoInfo('org/repo');
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['User-Agent']).toMatch(/^hfo\//);
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends a bearer token when one is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await fetchRepoInfo('org/repo', 'secret-token');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-token');
  });

  it.each([401, 403])('maps HTTP %i to a gated-repo message', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status })));
    await expect(fetchRepoInfo('org/private')).rejects.toThrow(/gated or private/);
  });

  it('maps HTTP 404 to a not-found message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 404 })));
    await expect(fetchRepoInfo('org/ghost')).rejects.toThrow(/not found on HuggingFace/);
  });

  it('surfaces the status and body for any other error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'upstream exploded',
    }));
    await expect(fetchRepoInfo('org/repo')).rejects.toThrow(/HF API 500: upstream exploded/);
  });

  it('returns empty lists for a repo with no files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));
    const info = await fetchRepoInfo('org/empty');
    expect(info.files).toEqual([]);
    expect(info.ggufFiles).toEqual([]);
  });
});

describe('downloadFile', () => {
  function bodyResponse(chunks: string[], headers: Record<string, string>, init: { ok?: boolean; status?: number } = {}) {
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      text: async () => 'error body',
      body: new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      }),
    };
  }

  it('writes the streamed body to disk and reports progress', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      bodyResponse(['hello ', 'world'], { 'content-length': '11' }),
    ));
    const dest = join(sandbox, 'nested', 'out.gguf');
    const seen: Array<[number, number]> = [];
    await downloadFile('https://example/f', dest, undefined, (b, t) => seen.push([b, t]));

    expect(await readFile(dest, 'utf8')).toBe('hello world');
    expect(seen.at(-1)).toEqual([11, 11]);
  });

  it('creates the parent directory when it does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bodyResponse(['x'], { 'content-length': '1' })));
    const dest = join(sandbox, 'a', 'b', 'c', 'out.bin');
    await downloadFile('https://example/f', dest, undefined, () => {});
    expect(await readFile(dest, 'utf8')).toBe('x');
  });

  it('resumes with a Range header and appends when a partial file exists', async () => {
    const dest = join(sandbox, 'partial.gguf');
    await writeFile(dest, 'AAAA');
    const fetchMock = vi.fn().mockResolvedValue(
      bodyResponse(['BBBB'], { 'content-length': '4' }, { ok: false, status: 206 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const seen: Array<[number, number]> = [];
    await downloadFile('https://example/f', dest, undefined, (b, t) => seen.push([b, t]));

    expect(fetchMock.mock.calls[0][1].headers.Range).toBe('bytes=4-');
    expect(await readFile(dest, 'utf8')).toBe('AAAABBBB');
    // total is content-length plus what was already on disk
    expect(seen.at(-1)).toEqual([8, 8]);
  });

  it('sends the bearer token when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bodyResponse(['x'], { 'content-length': '1' }));
    vi.stubGlobal('fetch', fetchMock);
    await downloadFile('https://example/f', join(sandbox, 'o'), 'tok', () => {});
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('reports total 0 when the server omits content-length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bodyResponse(['abc'], {})));
    const seen: Array<[number, number]> = [];
    await downloadFile('https://example/f', join(sandbox, 'o'), undefined, (b, t) => seen.push([b, t]));
    expect(seen.at(-1)).toEqual([3, 0]);
  });

  it('throws with the status and body on a failed download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, text: async () => 'server said no', body: null,
    }));
    await expect(downloadFile('https://example/f', join(sandbox, 'o'), undefined, () => {}))
      .rejects.toThrow(/Download failed 500: server said no/);
  });

  it('throws when the response carries no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null }, text: async () => '', body: null,
    }));
    await expect(downloadFile('https://example/f', join(sandbox, 'o'), undefined, () => {}))
      .rejects.toThrow('Empty response body');
  });
});

describe('fileDownloadUrl', () => {
  it('builds the resolve URL', () => {
    expect(fileDownloadUrl('org/repo', 'model.gguf'))
      .toBe('https://huggingface.co/org/repo/resolve/main/model.gguf');
  });

  it('percent-encodes each path segment but keeps the separators', () => {
    expect(fileDownloadUrl('org/repo', 'sub dir/my model.gguf'))
      .toBe('https://huggingface.co/org/repo/resolve/main/sub%20dir/my%20model.gguf');
  });
});
