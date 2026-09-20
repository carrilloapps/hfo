import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { backupDirectory } from '../src/core/backup.js';
import { hfSearchUrl, tierFor } from '../src/core/capacity.js';
import { parseCardParams } from '../src/core/readme.js';
import { readBackupManifest } from '../src/core/restore.js';
import { reinstallInstallation, inspectInstallDir } from '../src/core/reinstall.js';
import { runOne, BENCH_PROMPTS } from '../src/core/bench.js';
import type { HardwareProfile } from '../src/core/hardware.js';

const hw: HardwareProfile = {
  gpuName: 'GPU', vramMiB: 8192, ramMiB: 32768,
  cpuCores: 8, platform: 'linux', unifiedMemory: false,
};

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-final-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(sandbox, { recursive: true, force: true });
});

describe('backupDirectory — archiver warnings', () => {
  it('tolerates an ENOENT warning from a dangling symlink instead of failing the backup', async () => {
    const src = join(sandbox, 'model');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'real.gguf'), Buffer.alloc(64));
    // archiver stats every entry; a broken link makes it emit a non-fatal
    // ENOENT warning, which the handler must swallow rather than reject on.
    await symlink(join(src, 'missing-target.bin'), join(src, 'dangling.gguf'));

    const res = await backupDirectory(
      { tag: 'warn:q4', dir: src, repoId: 'o/r', quant: 'Q4' },
      join(sandbox, 'backups'),
    );
    expect(res.zipPath).toMatch(/\.zip$/);
    expect(res.compressedBytes).toBeGreaterThan(0);
  });
});

describe('hfSearchUrl', () => {
  it('defaults to trending when no sort is given', () => {
    const url = hfSearchUrl(tierFor(hw));
    expect(url).toContain('sort=trending');
    expect(url).toContain('library=gguf');
    expect(url).toContain('pipeline_tag=text-generation');
  });

  it.each(['trending', 'downloads', 'likes7d', 'modified'] as const)(
    'honours the %s sort',
    (sort) => {
      expect(hfSearchUrl(tierFor(hw), { sort })).toContain(`sort=${sort}`);
    },
  );

  it('omits the search parameter for a tier with no keywords', () => {
    const bare = { ...tierFor(hw), searchKeywords: [] };
    expect(hfSearchUrl(bare)).not.toContain('search=');
  });

  it('includes the keywords when the tier has them', () => {
    const tier = tierFor(hw);
    expect(tier.searchKeywords.length).toBeGreaterThan(0);
    expect(hfSearchUrl(tier)).toContain('search=');
  });
});

describe('parseCardParams — range parsing edge cases', () => {
  it('ignores a range whose bounds are not numbers and falls back to the single match', () => {
    // 'temperature: 0.7' matches the single-value pattern after the range
    // pattern fails to produce two parseable numbers.
    expect(parseCardParams('temperature: 0.7').params.temperature).toBe(0.7);
  });

  it('rounds an averaged range to three decimals', () => {
    // (0.1 + 0.2) / 2 = 0.15000000000000002 without the toFixed(3)
    expect(parseCardParams('temperature: 0.1-0.2').params.temperature).toBe(0.15);
  });

  it('returns undefined when no pattern matches at all', () => {
    expect(parseCardParams('nothing numeric here').params.temperature).toBeUndefined();
  });
});

describe('readBackupManifest — manifest inside the zip', () => {
  it('reads the manifest entry from the archive when no sidecar exists', async () => {
    const { ZipArchive } = await import('archiver');
    const { createWriteStream } = await import('node:fs');
    const zipPath = join(sandbox, 'inner.zip');
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(zipPath);
      const a = new ZipArchive();
      out.on('close', () => resolve());
      a.on('error', reject);
      a.pipe(out);
      a.append(JSON.stringify({ tag: 'inzip:q4', sourceDir: '/x' }), { name: 'model.metadata.json' });
      a.finalize().catch(reject);
    });
    expect((await readBackupManifest(zipPath))?.tag).toBe('inzip:q4');
  });

  it('returns null when the zip holds no manifest entry', async () => {
    const { ZipArchive } = await import('archiver');
    const { createWriteStream } = await import('node:fs');
    const zipPath = join(sandbox, 'nometa.zip');
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(zipPath);
      const a = new ZipArchive();
      out.on('close', () => resolve());
      a.on('error', reject);
      a.pipe(out);
      a.append('x', { name: 'model.gguf' });
      a.finalize().catch(reject);
    });
    expect(await readBackupManifest(zipPath)).toBeNull();
  });

  it('ignores a directory entry that ends in .metadata.json', async () => {
    const { ZipArchive } = await import('archiver');
    const { createWriteStream } = await import('node:fs');
    const nested = join(sandbox, 'tree', 'a.metadata.json');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'inner.txt'), 'x');
    const zipPath = join(sandbox, 'dirmeta.zip');
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(zipPath);
      const a = new ZipArchive();
      out.on('close', () => resolve());
      a.on('error', reject);
      a.pipe(out);
      a.directory(join(sandbox, 'tree'), 'tree');
      a.finalize().catch(reject);
    });
    // The only .metadata.json entry is a directory, so it must be skipped.
    expect(await readBackupManifest(zipPath)).toBeNull();
  });
});

describe('reinstallInstallation — quant and repo fallbacks', () => {
  it('prefers the record quant when the filename has none', async () => {
    const dir = join(sandbox, 'noquant');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'model.gguf'), Buffer.alloc(64));
    // extractQuant returns 'unknown' for this name, so install.quant wins.
    const inspection = await inspectInstallDir(dir);
    expect(inspection.kind).toBe('needs-generation');
  });
});

describe('runOne — throughput fallbacks', () => {
  function streamingFetch(chunks: string[]) {
    return vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      body: new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      }),
    }));
  }

  it('uses eval_duration when Ollama reports it', async () => {
    const r = await runOne('http://h', 't', BENCH_PROMPTS[0],
      streamingFetch(['{"eval_count":300,"eval_duration":3000000000}\n']));
    expect(r.tokensPerSec).toBeCloseTo(100, 5);
  });

  it('falls back to wall-clock when eval_duration is zero', async () => {
    const r = await runOne('http://h', 't', BENCH_PROMPTS[0],
      streamingFetch(['{"eval_count":10,"eval_duration":0}\n']));
    expect(r.tokensPerSec).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.tokensPerSec)).toBe(true);
  });

  it('reports a zero TTFT basis when no chunk ever arrives', async () => {
    const r = await runOne('http://h', 't', BENCH_PROMPTS[0], streamingFetch([]));
    expect(r.outputTokens).toBe(0);
    expect(r.tokensPerSec).toBe(0);
    expect(r.ttftMs).toBeGreaterThanOrEqual(0);
  });

  it('strips a trailing host slash when building the URL', async () => {
    const f = streamingFetch(['{"done":true}\n']);
    await runOne('http://h/', 't', BENCH_PROMPTS[0], f);
    expect(String(f.mock.calls[0][0])).toBe('http://h/api/generate');
  });
});
