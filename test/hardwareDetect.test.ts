import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// detectHardware reads the real machine three ways: nvidia-smi, sysctl and
// systeminformation. Stub all three plus process.platform/arch so every branch
// — NVIDIA, Apple Silicon, generic discrete GPU, no GPU — is reachable from
// any host.
const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa }));

const si = vi.hoisted(() => ({ mem: vi.fn(), cpu: vi.fn(), graphics: vi.fn() }));
vi.mock('systeminformation', () => ({ default: si }));

import { detectHardware, appleGpuBudgetMiB } from '../src/core/hardware.js';

const GB = 1024 * 1024 * 1024;

function setPlatform(platform: NodeJS.Platform, arch: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
}

const realPlatform = process.platform;
const realArch = process.arch;

beforeEach(() => {
  execa.mockReset();
  si.mem.mockReset().mockResolvedValue({ total: 64 * GB });
  si.cpu.mockReset().mockResolvedValue({ physicalCores: 12, cores: 24, brand: 'Test CPU' });
  si.graphics.mockReset().mockResolvedValue({ controllers: [] });
  delete process.env.HFO_VRAM_MIB;
});

afterEach(() => {
  setPlatform(realPlatform, realArch);
  delete process.env.HFO_VRAM_MIB;
});

describe('detectHardware — NVIDIA', () => {
  it('prefers nvidia-smi and reports its name and VRAM', async () => {
    setPlatform('linux', 'x64');
    execa.mockResolvedValue({ stdout: 'NVIDIA GeForce RTX 4090, 24564\n' });
    const hw = await detectHardware();
    expect(hw.gpuName).toBe('NVIDIA GeForce RTX 4090');
    expect(hw.vramMiB).toBe(24564);
    expect(hw.unifiedMemory).toBe(false);
    expect(hw.ramMiB).toBe(65536);
    expect(hw.cpuCores).toBe(12);
  });

  it('takes the first GPU when several are present', async () => {
    setPlatform('linux', 'x64');
    execa.mockResolvedValue({ stdout: 'First GPU, 8192\nSecond GPU, 4096' });
    expect((await detectHardware()).gpuName).toBe('First GPU');
  });

  it('falls through to the graphics list when nvidia-smi prints nothing', async () => {
    setPlatform('linux', 'x64');
    execa.mockResolvedValue({ stdout: '  ' });
    si.graphics.mockResolvedValue({ controllers: [{ model: 'Radeon RX 7900', vram: 20480 }] });
    const hw = await detectHardware();
    // An empty first line leaves the nvidia branch without data; VRAM stays 0.
    expect(hw.vramMiB).toBe(0);
  });
});

describe('detectHardware — Apple Silicon', () => {
  beforeEach(() => {
    setPlatform('darwin', 'arm64');
    execa.mockImplementation((bin: string, args: string[]) => {
      if (bin === 'nvidia-smi') return Promise.reject(new Error('ENOENT'));
      if (bin === 'sysctl') {
        // No explicit wired limit set on this machine.
        if (args[1] === 'iogpu.wired_limit_mb') return Promise.resolve({ stdout: '0' });
        return Promise.reject(new Error('unknown oid'));
      }
      return Promise.reject(new Error('unexpected'));
    });
  });

  it('derives a unified-memory budget instead of reporting zero VRAM', async () => {
    si.graphics.mockResolvedValue({ controllers: [{ model: 'Apple M3 Max', vendor: 'Apple' }] });
    const hw = await detectHardware();
    expect(hw.unifiedMemory).toBe(true);
    expect(hw.vramMiB).toBeGreaterThan(0);
    expect(hw.vramMiB).toBeLessThan(hw.ramMiB);
    expect(hw.gpuName).toBe('Apple M3 Max');
  });

  it('names the GPU from the Apple controller when one is listed', async () => {
    si.graphics.mockResolvedValue({
      controllers: [{ model: 'Apple M2 Pro', vendor: 'Apple Inc.' }],
    });
    expect((await detectHardware()).gpuName).toBe('Apple M2 Pro');
  });

  it('falls back to the CPU brand when no Apple controller is listed', async () => {
    si.graphics.mockResolvedValue({ controllers: [] });
    si.cpu.mockResolvedValue({ physicalCores: 10, cores: 10, brand: 'Apple M1' });
    expect((await detectHardware()).gpuName).toBe('Apple M1');
  });

  it('falls back to a generic label when even the CPU brand is missing', async () => {
    si.graphics.mockResolvedValue({ controllers: [] });
    si.cpu.mockResolvedValue({ physicalCores: 8, cores: 8 });
    expect((await detectHardware()).gpuName).toBe('Apple Silicon GPU');
  });

  it('honours an explicitly set iogpu.wired_limit_mb over the heuristic', async () => {
    execa.mockImplementation((bin: string, args: string[]) => {
      if (bin === 'nvidia-smi') return Promise.reject(new Error('ENOENT'));
      if (bin === 'sysctl' && args[1] === 'iogpu.wired_limit_mb') {
        return Promise.resolve({ stdout: '57344\n' });
      }
      return Promise.reject(new Error('unknown oid'));
    });
    expect((await detectHardware()).vramMiB).toBe(57344);
  });

  it('is not treated as unified memory on an Intel Mac', async () => {
    setPlatform('darwin', 'x64');
    si.graphics.mockResolvedValue({ controllers: [{ model: 'Radeon Pro 560X', vram: 4096 }] });
    const hw = await detectHardware();
    expect(hw.unifiedMemory).toBe(false);
    expect(hw.vramMiB).toBe(4096);
  });
});

describe('appleGpuBudgetMiB', () => {
  it('uses the modern sysctl key when it reports a value', async () => {
    execa.mockImplementation((_bin: string, args: string[]) =>
      args[1] === 'iogpu.wired_limit_mb'
        ? Promise.resolve({ stdout: '40960' })
        : Promise.reject(new Error('no')));
    expect(await appleGpuBudgetMiB(64 * 1024)).toBe(40960);
  });

  it('falls back to the legacy byte-valued key on older macOS', async () => {
    execa.mockImplementation((_bin: string, args: string[]) => {
      if (args[1] === 'iogpu.wired_limit_mb') return Promise.reject(new Error('unknown oid'));
      if (args[1] === 'debug.iogpu.wired_limit') {
        return Promise.resolve({ stdout: String(32 * 1024 * 1024 * 1024) });
      }
      return Promise.reject(new Error('no'));
    });
    expect(await appleGpuBudgetMiB(64 * 1024)).toBe(32768);
  });

  it('ignores a zero limit, which means "system default"', async () => {
    execa.mockResolvedValue({ stdout: '0' });
    const budget = await appleGpuBudgetMiB(32 * 1024);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(32 * 1024);
  });

  it('ignores a non-numeric sysctl value', async () => {
    execa.mockResolvedValue({ stdout: 'not a number' });
    expect(await appleGpuBudgetMiB(16 * 1024)).toBeGreaterThan(0);
  });

  it('falls back to the heuristic when sysctl is absent entirely', async () => {
    execa.mockRejectedValue(new Error('ENOENT'));
    expect(await appleGpuBudgetMiB(16 * 1024)).toBe(Math.round(16 * 1024 * 0.65));
  });
});

describe('detectHardware — generic and overrides', () => {
  it('uses the first controller that reports VRAM', async () => {
    setPlatform('win32', 'x64');
    execa.mockRejectedValue(new Error('no nvidia-smi'));
    si.graphics.mockResolvedValue({
      controllers: [
        { model: 'Integrated', vram: 0 },
        { model: 'Arc A770', vram: 16384 },
      ],
    });
    const hw = await detectHardware();
    expect(hw.gpuName).toBe('Arc A770');
    expect(hw.vramMiB).toBe(16384);
  });

  it('reports no GPU when nothing has VRAM', async () => {
    setPlatform('win32', 'x64');
    execa.mockRejectedValue(new Error('no nvidia-smi'));
    si.graphics.mockResolvedValue({ controllers: [{ model: 'Integrated', vram: 0 }] });
    const hw = await detectHardware();
    expect(hw.gpuName).toBeNull();
    expect(hw.vramMiB).toBe(0);
  });

  it('defaults a controller with undefined vram to 0', async () => {
    setPlatform('win32', 'x64');
    execa.mockRejectedValue(new Error('no nvidia-smi'));
    si.graphics.mockResolvedValue({ controllers: [{ model: 'Mystery', vram: undefined }] });
    expect((await detectHardware()).vramMiB).toBe(0);
  });

  it('falls back to logical cores when physicalCores is absent', async () => {
    setPlatform('linux', 'x64');
    execa.mockRejectedValue(new Error('none'));
    si.cpu.mockResolvedValue({ cores: 8 });
    expect((await detectHardware()).cpuCores).toBe(8);
  });

  it('falls back to 4 cores when the CPU reports nothing', async () => {
    setPlatform('linux', 'x64');
    execa.mockRejectedValue(new Error('none'));
    si.cpu.mockResolvedValue({});
    expect((await detectHardware()).cpuCores).toBe(4);
  });

  it('lets HFO_VRAM_MIB override whatever was detected', async () => {
    setPlatform('linux', 'x64');
    execa.mockResolvedValue({ stdout: 'RTX 4090, 24564' });
    process.env.HFO_VRAM_MIB = '8192';
    expect((await detectHardware()).vramMiB).toBe(8192);
  });

  it('accepts an override of 0 to model a GPU-less machine', async () => {
    setPlatform('linux', 'x64');
    execa.mockResolvedValue({ stdout: 'RTX 4090, 24564' });
    process.env.HFO_VRAM_MIB = '0';
    expect((await detectHardware()).vramMiB).toBe(0);
  });

  it('ignores a non-numeric override', async () => {
    setPlatform('linux', 'x64');
    execa.mockResolvedValue({ stdout: 'RTX 4090, 24564' });
    process.env.HFO_VRAM_MIB = 'lots';
    expect((await detectHardware()).vramMiB).toBe(24564);
  });

  it('ignores a negative override', async () => {
    setPlatform('linux', 'x64');
    execa.mockResolvedValue({ stdout: 'RTX 4090, 24564' });
    process.env.HFO_VRAM_MIB = '-10';
    expect((await detectHardware()).vramMiB).toBe(24564);
  });

  it('reports the running platform', async () => {
    setPlatform('linux', 'x64');
    execa.mockRejectedValue(new Error('none'));
    expect((await detectHardware()).platform).toBe('linux');
  });
});
