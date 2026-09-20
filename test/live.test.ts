import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every sampler shells out (nvidia-smi, ollama) or reads the host via
// systeminformation. Stub both so the suite asserts the parsing, which is
// where the bugs actually live, rather than the machine it runs on.
const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa }));

const mem = vi.hoisted(() => vi.fn());
vi.mock('systeminformation', () => ({ default: { mem } }));

import {
  sampleGpu,
  sampleOllamaPs,
  sampleOllamaList,
  sampleRam,
} from '../src/core/live.js';

beforeEach(() => {
  execa.mockReset();
  mem.mockReset();
});

describe('sampleGpu', () => {
  it('parses a full nvidia-smi row', async () => {
    execa.mockResolvedValue({
      stdout: 'NVIDIA GeForce RTX 3050 Laptop GPU, 4096, 401, 3695, 12, 56, 3.14\n',
    });
    expect(await sampleGpu()).toEqual({
      name: 'NVIDIA GeForce RTX 3050 Laptop GPU',
      vramTotalMiB: 4096,
      vramUsedMiB: 401,
      vramFreeMiB: 3695,
      utilPct: 12,
      tempC: 56,
      powerW: 3.14,
    });
  });

  it('queries nvidia-smi in the nounits CSV form the parser expects', async () => {
    execa.mockResolvedValue({ stdout: 'GPU, 1, 1, 0, 0, 0, 0' });
    await sampleGpu();
    const [bin, args] = execa.mock.calls[0];
    expect(bin).toBe('nvidia-smi');
    expect(args[1]).toBe('--format=csv,noheader,nounits');
  });

  it('takes only the first GPU when several are present', async () => {
    execa.mockResolvedValue({ stdout: 'First, 8192, 0, 8192, 0, 40, 10\nSecond, 4096, 0, 4096, 0, 30, 5' });
    expect((await sampleGpu())?.name).toBe('First');
  });

  it('returns null when nvidia-smi prints nothing', async () => {
    execa.mockResolvedValue({ stdout: '   \n' });
    expect(await sampleGpu()).toBeNull();
  });

  it('returns null when nvidia-smi is absent', async () => {
    execa.mockRejectedValue(new Error('ENOENT'));
    expect(await sampleGpu()).toBeNull();
  });

  it('coerces unreadable numeric columns to 0 or null rather than NaN', async () => {
    execa.mockResolvedValue({ stdout: 'GPU, [N/A], [N/A], [N/A], [N/A], [N/A], [N/A]' });
    const gpu = await sampleGpu();
    expect(gpu).toEqual({
      name: 'GPU',
      vramTotalMiB: 0,
      vramUsedMiB: 0,
      vramFreeMiB: 0,
      utilPct: null,
      tempC: null,
      powerW: null,
    });
  });

  it('defaults a missing name column to null', async () => {
    execa.mockResolvedValue({ stdout: ',1,1,0,0,0,0' });
    expect((await sampleGpu())?.name).toBe('');
  });
});

describe('sampleOllamaPs', () => {
  it('parses the loaded-model table, dropping the header row', async () => {
    execa.mockResolvedValue({
      stdout: [
        'NAME            ID              SIZE      PROCESSOR    UNTIL',
        'llama3.1:8b     abc123          5.0 GB    100% GPU     4 minutes from now',
      ].join('\n'),
    });
    expect(await sampleOllamaPs()).toEqual([
      {
        name: 'llama3.1:8b',
        id: 'abc123',
        size: '5.0 GB',
        processor: '100% GPU',
        until: '4 minutes from now',
      },
    ]);
  });

  it('handles CRLF output from a Windows shell', async () => {
    execa.mockResolvedValue({ stdout: 'NAME  ID\r\nmodel:7b  xyz  1 GB  CPU  soon\r\n' });
    expect(await sampleOllamaPs()).toHaveLength(1);
  });

  it('returns an empty list when nothing is loaded', async () => {
    execa.mockResolvedValue({ stdout: 'NAME  ID  SIZE  PROCESSOR  UNTIL\n' });
    expect(await sampleOllamaPs()).toEqual([]);
  });

  it('returns an empty list when ollama is missing', async () => {
    execa.mockRejectedValue(new Error('ENOENT'));
    expect(await sampleOllamaPs()).toEqual([]);
  });

  it('fills absent trailing columns with empty strings', async () => {
    execa.mockResolvedValue({ stdout: 'HEADER\nonlyname' });
    expect(await sampleOllamaPs()).toEqual([
      { name: 'onlyname', id: '', size: '', processor: '', until: '' },
    ]);
  });
});

describe('sampleOllamaList', () => {
  it('parses the registered-model table, dropping the header row', async () => {
    execa.mockResolvedValue({
      stdout: [
        'NAME            ID          SIZE      MODIFIED',
        'qwen2.5:7b      def456      4.7 GB    2 days ago',
      ].join('\n'),
    });
    expect(await sampleOllamaList()).toEqual([
      { name: 'qwen2.5:7b', id: 'def456', size: '4.7 GB', modified: '2 days ago' },
    ]);
  });

  it('returns an empty list when nothing is registered', async () => {
    execa.mockResolvedValue({ stdout: 'NAME  ID  SIZE  MODIFIED\n' });
    expect(await sampleOllamaList()).toEqual([]);
  });

  it('returns an empty list when ollama is missing', async () => {
    execa.mockRejectedValue(new Error('ENOENT'));
    expect(await sampleOllamaList()).toEqual([]);
  });

  it('fills absent trailing columns with empty strings', async () => {
    execa.mockResolvedValue({ stdout: 'HEADER\njustatag' });
    expect(await sampleOllamaList()).toEqual([
      { name: 'justatag', id: '', size: '', modified: '' },
    ]);
  });
});

describe('sampleRam', () => {
  it('converts bytes to MiB and derives the used percentage', async () => {
    mem.mockResolvedValue({ total: 16 * 1024 * 1024 * 1024, active: 4 * 1024 * 1024 * 1024 });
    expect(await sampleRam()).toEqual({
      totalMiB: 16384,
      usedMiB: 4096,
      freeMiB: 12288,
      usedPct: 25,
    });
  });

  it('reports 0% rather than dividing by zero when total is 0', async () => {
    mem.mockResolvedValue({ total: 0, active: 0 });
    expect(await sampleRam()).toEqual({
      totalMiB: 0, usedMiB: 0, freeMiB: 0, usedPct: 0,
    });
  });

  it('returns null when systeminformation throws', async () => {
    mem.mockRejectedValue(new Error('no /proc'));
    expect(await sampleRam()).toBeNull();
  });
});
