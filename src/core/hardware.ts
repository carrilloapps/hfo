import { execa } from 'execa';
import si from 'systeminformation';

export interface HardwareProfile {
  gpuName: string | null;
  vramMiB: number;
  ramMiB: number;
  cpuCores: number;
  platform: NodeJS.Platform;
  /**
   * True on Apple Silicon, where `vramMiB` is the slice of unified memory the
   * GPU may wire rather than a separate pool. Consumers that print both VRAM
   * and RAM should say so, since the two overlap instead of adding up.
   */
  unifiedMemory: boolean;
}

/**
 * Share of total RAM macOS lets the Metal GPU wire by default.
 *
 * Apple does not publish this; measurements across machines land anywhere from
 * ~62% on small configs to ~78% on a 32 GiB M2 Max, and it shifts between OS
 * releases. These tiers sit at the conservative end of the observed range on
 * purpose: over-estimating makes hfo recommend a quant that then spills to swap
 * and crawls, which is a far worse failure than under-promising by a gigabyte.
 *
 * Anything set explicitly wins over this table — see `appleGpuBudgetMiB`.
 */
export function appleDefaultGpuShare(ramMiB: number): number {
  const ramGB = ramMiB / 1024;
  if (ramGB <= 8) return 0.60;
  if (ramGB <= 32) return 0.65;
  if (ramGB <= 64) return 0.72;
  return 0.75;
}

/** The heuristic budget alone, with no sysctl involved. Pure, so it is testable. */
export function appleHeuristicBudgetMiB(ramMiB: number): number {
  return Math.round(ramMiB * appleDefaultGpuShare(ramMiB));
}

/**
 * How much unified memory the GPU can actually use on this Mac.
 *
 * `iogpu.wired_limit_mb` is the macOS ceiling on GPU-wired memory (Sonoma and
 * later; `debug.iogpu.wired_limit` on older releases, in bytes). A non-zero
 * value means the user — or a tuning guide — set it deliberately, so it is
 * authoritative and we use it verbatim. Zero means "system default", which is
 * the only case where the heuristic table applies.
 */
export async function appleGpuBudgetMiB(ramMiB: number): Promise<number> {
  for (const [key, divisor] of [
    ['iogpu.wired_limit_mb', 1],
    ['debug.iogpu.wired_limit', 1024 * 1024],
  ] as const) {
    try {
      const { stdout } = await execa('sysctl', ['-n', key]);
      const raw = Number(stdout.trim());
      if (Number.isFinite(raw) && raw > 0) return Math.round(raw / divisor);
    } catch {
      /* key absent on this macOS version — try the next one */
    }
  }
  return appleHeuristicBudgetMiB(ramMiB);
}

/** Apple Silicon reports as arm64 darwin; Intel Macs keep a discrete/Iris GPU. */
function isAppleSilicon(): boolean {
  return process.platform === 'darwin' && process.arch === 'arm64';
}

export async function detectHardware(): Promise<HardwareProfile> {
  const [mem, cpu, graphics] = await Promise.all([si.mem(), si.cpu(), si.graphics()]);
  const ramMiB = Math.round(mem.total / (1024 * 1024));
  const cpuCores = cpu.physicalCores ?? cpu.cores ?? 4;

  let gpuName: string | null = null;
  let vramMiB = 0;
  let unifiedMemory = false;

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
    if (isAppleSilicon()) {
      // systeminformation reports 0 vram for Apple GPUs — there is no discrete
      // pool to report. Left as-is every model would score "CPU-only" on a
      // machine that can in fact run 70B on the GPU, so derive the real budget.
      unifiedMemory = true;
      vramMiB = await appleGpuBudgetMiB(ramMiB);
      gpuName =
        graphics.controllers.find((c) => /apple/i.test(c.vendor ?? c.model ?? ''))?.model ??
        cpu.brand ??
        'Apple Silicon GPU';
    } else {
      // The predicate already guarantees a positive vram, so no fallback here.
      const primary = graphics.controllers.find((c) => c.vram && c.vram > 0);
      if (primary) {
        gpuName = primary.model;
        vramMiB = primary.vram as number;
      }
    }
  }

  // Calibration escape hatch: no heuristic survives every machine, and a user
  // who knows their real budget (or wants to model a smaller one) should be
  // able to say so without editing code.
  const override = Number(process.env.HFO_VRAM_MIB);
  if (Number.isFinite(override) && override >= 0) vramMiB = Math.round(override);

  return { gpuName, vramMiB, ramMiB, cpuCores, platform: process.platform, unifiedMemory };
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
