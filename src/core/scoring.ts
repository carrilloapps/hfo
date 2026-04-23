import type { HfFile } from './hf.js';
import type { HardwareProfile } from './hardware.js';
import { extractQuant } from './hf.js';

export interface QuantScore {
  file: HfFile;
  quant: string;
  fileMiB: number;
  score: number;              // 0-100
  label: string;              // human label: "Full GPU" | "Partial 75%" | "CPU-heavy" | ...
  verdict: 'excellent' | 'good' | 'ok' | 'heavy' | 'risky';
  fitsFully: boolean;
  gpuLayerRatio: number;      // 0-1, approx fraction that fits in VRAM
  note?: string;              // extra hint (e.g. "may page to disk")
}

const KV_OVERHEAD_MIB = 350;      // rough 8K ctx + flash attn + buffers
const SYSTEM_VRAM_RESERVE = 600;  // windows/driver/display

function usableVramMiB(hw: HardwareProfile): number {
  if (hw.vramMiB <= 0) return 0;
  return Math.max(0, hw.vramMiB - SYSTEM_VRAM_RESERVE);
}

export function scoreQuant(file: HfFile, hw: HardwareProfile): QuantScore {
  const fileMiB = file.size / (1024 * 1024);
  const needed = fileMiB + KV_OVERHEAD_MIB;
  const usableVram = usableVramMiB(hw);
  const usableRam = Math.max(0, hw.ramMiB - 2048); // leave 2 GB for OS

  let score = 0;
  let label = '';
  let verdict: QuantScore['verdict'] = 'ok';
  let note: string | undefined;
  const fitsFully = usableVram > 0 && needed <= usableVram;
  const gpuLayerRatio = usableVram > 0 ? Math.min(1, usableVram / needed) : 0;

  if (fitsFully) {
    // even when it fits, penalize tiny headroom slightly
    const headroomRatio = (usableVram - needed) / usableVram;
    score = headroomRatio > 0.2 ? 100 : 95;
    label = 'Full GPU';
    verdict = 'excellent';
  } else if (usableVram === 0) {
    // No GPU path
    if (usableRam >= needed * 1.3) {
      score = 45;
      label = 'CPU only';
      verdict = 'heavy';
      note = 'slow — no GPU';
    } else {
      score = 20;
      label = 'RAM tight';
      verdict = 'risky';
      note = 'may swap to disk';
    }
  } else {
    // Partial offload
    const ratio = gpuLayerRatio;
    if (ratio >= 0.9) { score = 88; label = `Partial ${Math.round(ratio * 100)}%`; verdict = 'good'; }
    else if (ratio >= 0.75) { score = 78; label = `Partial ${Math.round(ratio * 100)}%`; verdict = 'good'; }
    else if (ratio >= 0.6) { score = 68; label = `Partial ${Math.round(ratio * 100)}%`; verdict = 'ok'; }
    else if (ratio >= 0.45) { score = 56; label = `Partial ${Math.round(ratio * 100)}%`; verdict = 'ok'; }
    else if (ratio >= 0.3) { score = 46; label = `Mostly CPU ${Math.round(ratio * 100)}%`; verdict = 'heavy'; }
    else if (ratio >= 0.15) { score = 36; label = `Mostly CPU ${Math.round(ratio * 100)}%`; verdict = 'heavy'; }
    else { score = 26; label = `CPU-heavy`; verdict = 'risky'; }
  }

  // RAM sanity check: if file is > 70% of usable RAM, penalize
  if (fileMiB > usableRam * 0.7) {
    score = Math.max(15, score - 20);
    note = note ?? 'file approaches RAM capacity — risk of paging';
    if (verdict === 'good' || verdict === 'ok') verdict = 'heavy';
  }

  // Bonus: well-balanced quants
  if (/^Q4_K(_M|_S)?$/i.test(extractQuant(file.path))) score = Math.min(100, score + 2);

  return {
    file,
    quant: extractQuant(file.path),
    fileMiB,
    score,
    label,
    verdict,
    fitsFully,
    gpuLayerRatio,
    note,
  };
}

export interface RepoScore {
  best: number;
  worst: number;
  avg: number;
  perQuant: QuantScore[];
}

export function scoreRepo(files: HfFile[], hw: HardwareProfile): RepoScore {
  const perQuant = files.map((f) => scoreQuant(f, hw)).sort((a, b) => b.score - a.score);
  if (perQuant.length === 0) {
    return { best: 0, worst: 0, avg: 0, perQuant: [] };
  }
  const scores = perQuant.map((q) => q.score);
  return {
    best: Math.max(...scores),
    worst: Math.min(...scores),
    avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    perQuant,
  };
}

export function scoreColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 55) return 'yellow';
  return 'red';
}
