import { execa } from 'execa';
import si from 'systeminformation';

export interface HardwareProfile {
  gpuName: string | null;
  vramMiB: number;
  ramMiB: number;
  cpuCores: number;
  platform: NodeJS.Platform;
}

export async function detectHardware(): Promise<HardwareProfile> {
  const [mem, cpu, graphics] = await Promise.all([si.mem(), si.cpu(), si.graphics()]);
  const ramMiB = Math.round(mem.total / (1024 * 1024));
  const cpuCores = cpu.physicalCores ?? cpu.cores ?? 4;

  let gpuName: string | null = null;
  let vramMiB = 0;

  try {
    const { stdout } = await execa('nvidia-smi', [
      '--query-gpu=name,memory.total',
      '--format=csv,noheader,nounits',
    ]);
    const line = stdout.trim().split('\n')[0];
    if (line) {
      const [name, mem] = line.split(',').map((s) => s.trim());
      gpuName = name;
      vramMiB = Number(mem);
    }
  } catch {
    const primary = graphics.controllers.find((c) => c.vram && c.vram > 0);
    if (primary) {
      gpuName = primary.model;
      vramMiB = primary.vram ?? 0;
    }
  }

  return { gpuName, vramMiB, ramMiB, cpuCores, platform: process.platform };
}

export function estimateFitInVram(fileBytes: number, hw: HardwareProfile): {
  fits: boolean;
  ratio: number;
  usableVramMiB: number;
} {
  const usableVramMiB = Math.max(0, hw.vramMiB - 600);
  const fileMiB = fileBytes / (1024 * 1024);
  const kvCacheOverheadMiB = 350;
  const needed = fileMiB + kvCacheOverheadMiB;
  const ratio = usableVramMiB > 0 ? Math.min(1, usableVramMiB / needed) : 0;
  return { fits: needed <= usableVramMiB, ratio, usableVramMiB };
}
