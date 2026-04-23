import { execa } from 'execa';

export interface LiveGpu {
  name: string | null;
  vramTotalMiB: number;
  vramUsedMiB: number;
  vramFreeMiB: number;
  utilPct: number | null;
  tempC: number | null;
  powerW: number | null;
}

export async function sampleGpu(): Promise<LiveGpu | null> {
  try {
    const { stdout } = await execa('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw',
      '--format=csv,noheader,nounits',
    ]);
    const line = stdout.trim().split('\n')[0];
    if (!line) return null;
    const parts = line.split(',').map((s) => s.trim());
    return {
      name: parts[0] ?? null,
      vramTotalMiB: Number(parts[1]) || 0,
      vramUsedMiB: Number(parts[2]) || 0,
      vramFreeMiB: Number(parts[3]) || 0,
      utilPct: isFinite(Number(parts[4])) ? Number(parts[4]) : null,
      tempC: isFinite(Number(parts[5])) ? Number(parts[5]) : null,
      powerW: isFinite(Number(parts[6])) ? Number(parts[6]) : null,
    };
  } catch {
    return null;
  }
}

export interface LoadedModel {
  name: string;
  id: string;
  size: string;
  processor: string;
  until: string;
}

export async function sampleOllamaPs(): Promise<LoadedModel[]> {
  try {
    const { stdout } = await execa('ollama', ['ps']);
    const lines = stdout.split(/\r?\n/).slice(1).filter(Boolean);
    return lines.map((line) => {
      // name id size processor until_time...
      const parts = line.split(/\s{2,}/).map((p) => p.trim());
      return {
        name: parts[0] ?? '',
        id: parts[1] ?? '',
        size: parts[2] ?? '',
        processor: parts[3] ?? '',
        until: parts.slice(4).join(' ') ?? '',
      };
    });
  } catch {
    return [];
  }
}

export interface RegisteredModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

export async function sampleOllamaList(): Promise<RegisteredModel[]> {
  try {
    const { stdout } = await execa('ollama', ['list']);
    const lines = stdout.split(/\r?\n/).slice(1).filter(Boolean);
    return lines.map((line) => {
      const parts = line.split(/\s{2,}/).map((p) => p.trim());
      return {
        name: parts[0] ?? '',
        id: parts[1] ?? '',
        size: parts[2] ?? '',
        modified: parts.slice(3).join(' ') ?? '',
      };
    });
  } catch {
    return [];
  }
}

export interface LiveRam {
  totalMiB: number;
  freeMiB: number;
  usedMiB: number;
  usedPct: number;
}

export async function sampleRam(): Promise<LiveRam | null> {
  try {
    const mod = await import('systeminformation');
    const m = await mod.default.mem();
    const total = Math.round(m.total / (1024 * 1024));
    const used = Math.round(m.active / (1024 * 1024));
    return {
      totalMiB: total,
      usedMiB: used,
      freeMiB: total - used,
      usedPct: total > 0 ? (used / total) * 100 : 0,
    };
  } catch {
    return null;
  }
}
