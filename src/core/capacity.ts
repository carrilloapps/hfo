import type { HardwareProfile } from './hardware.js';

export type RunLevel = 'ok' | 'warn' | 'bad';
export interface RunHint {
  level: RunLevel;
  text: string;
}
export interface CapacityTier {
  key: 'workstation' | 'high' | 'enthusiast' | 'mid' | 'solid' | 'entry' | 'budget' | 'low-vram' | 'cpu-only';
  label: string;
  summary: string;
  runs: RunHint[];                // "what you can run", tagged for coloring
  searchKeywords: string[];       // free-text to plug into HF search
  picks: SuggestedRepo[];         // hand-picked GGUF repos
}

export interface SuggestedRepo {
  repoId: string;
  note: string;
}

export interface PowerScore {
  score: number;                  // 0-100 overall
  gpuScore: number;
  ramScore: number;
  cpuScore: number;
}

export function scoreHardware(hw: HardwareProfile): PowerScore {
  const vramGB = hw.vramMiB / 1024;
  const ramGB = hw.ramMiB / 1024;
  const cores = hw.cpuCores;

  // Non-linear: GPU matters most but its curve saturates at 48 GB. A rig with
  // zero discrete VRAM is scored 0 here (never via Math.max clamp) so consumers
  // can distinguish "no GPU" from "small GPU".
  const gpuScore = vramGB < 1 ? 0 : Math.round(Math.min(100, Math.log2(vramGB + 1) / Math.log2(49) * 100));
  const ramScore = Math.round(Math.min(100, Math.log2(Math.max(1, ramGB) + 1) / Math.log2(129) * 100));
  const cpuScore = Math.round(Math.min(100, (cores / 16) * 100));

  // Weighted aggregate: GPU 55 / RAM 25 / CPU 20. If no GPU, shift weights to RAM+CPU.
  let score: number;
  if (vramGB < 1) {
    score = Math.round(ramScore * 0.6 + cpuScore * 0.4);
  } else {
    score = Math.round(gpuScore * 0.55 + ramScore * 0.25 + cpuScore * 0.2);
  }
  return { score, gpuScore, ramScore, cpuScore };
}

export function tierFor(hw: HardwareProfile): CapacityTier {
  const vramGB = hw.vramMiB / 1024;
  const ramGB = hw.ramMiB / 1024;

  if (vramGB >= 48) {
    return {
      key: 'workstation',
      label: 'Workstation-class GPU',
      summary: `${vramGB.toFixed(0)} GB VRAM — run anything up to 70B locally.`,
      runs: [
        { level: 'ok', text: '70B Q4_K_M / Q5_K_M fully on GPU (15-30 t/s)' },
        { level: 'ok', text: '34B any quant, 7B in F16' },
        { level: 'ok', text: 'Multi-model serving with OLLAMA_NUM_PARALLEL up to 4' },
      ],
      searchKeywords: ['70B', '34B', 'mixtral'],
      picks: [
        { repoId: 'bartowski/Meta-Llama-3.1-70B-Instruct-GGUF', note: 'Llama 3.1 70B — flagship' },
        { repoId: 'bartowski/Qwen2.5-72B-Instruct-GGUF', note: 'Qwen2.5 72B' },
        { repoId: 'bartowski/Mistral-Large-Instruct-2407-GGUF', note: 'Mistral Large' },
      ],
    };
  }
  if (vramGB >= 24) {
    return {
      key: 'high',
      label: 'High-end GPU',
      summary: `${vramGB.toFixed(0)} GB VRAM — ideal for 30-34B locally, or 70B partial.`,
      runs: [
        { level: 'ok', text: '30-34B Q4_K_M / Q5_K_M fully on GPU' },
        { level: 'ok', text: '13B in any quant, 7B F16' },
        { level: 'warn', text: '70B Q2 with partial offload (~5-8 t/s)' },
      ],
      searchKeywords: ['34B', '32B', 'qwen2.5', 'codestral'],
      picks: [
        { repoId: 'bartowski/Qwen2.5-32B-Instruct-GGUF', note: 'Qwen2.5 32B general' },
        { repoId: 'bartowski/Qwen2.5-Coder-32B-Instruct-GGUF', note: 'Qwen2.5 Coder 32B' },
        { repoId: 'bartowski/Codestral-22B-v0.1-GGUF', note: 'Codestral 22B for coding' },
      ],
    };
  }
  if (vramGB >= 16) {
    return {
      key: 'enthusiast',
      label: 'Enthusiast GPU',
      summary: `${vramGB.toFixed(0)} GB VRAM — 13B fully, 30B partial.`,
      runs: [
        { level: 'ok', text: '13-14B Q5/Q6 fully on GPU (~40 t/s)' },
        { level: 'ok', text: '8B Q8 fully' },
        { level: 'warn', text: '30-34B Q3 partial offload' },
      ],
      searchKeywords: ['13B', '14B', '8B'],
      picks: [
        { repoId: 'bartowski/Qwen2.5-14B-Instruct-GGUF', note: 'Qwen2.5 14B' },
        { repoId: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', note: 'Llama 3.1 8B — strong baseline' },
        { repoId: 'bartowski/gemma-2-27b-it-GGUF', note: 'Gemma 2 27B (partial offload)' },
      ],
    };
  }
  if (vramGB >= 12) {
    return {
      key: 'mid',
      label: 'Mid-range GPU',
      summary: `${vramGB.toFixed(0)} GB VRAM — sweet spot for 8-13B.`,
      runs: [
        { level: 'ok', text: '8-13B Q4/Q5 fully on GPU (~35-50 t/s)' },
        { level: 'ok', text: '7B Q8' },
        { level: 'warn', text: '22B+ needs partial offload' },
      ],
      searchKeywords: ['13B', '8B', '7B'],
      picks: [
        { repoId: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', note: 'Llama 3.1 8B' },
        { repoId: 'bartowski/Qwen2.5-14B-Instruct-GGUF', note: 'Qwen2.5 14B' },
        { repoId: 'bartowski/Mistral-Nemo-Instruct-2407-GGUF', note: 'Mistral Nemo 12B' },
      ],
    };
  }
  if (vramGB >= 8) {
    return {
      key: 'solid',
      label: 'Solid GPU',
      summary: `${vramGB.toFixed(0)} GB VRAM — 7-8B fits comfortably.`,
      runs: [
        { level: 'ok', text: '7-8B Q4_K_M / Q5_K_M fully on GPU (~40-60 t/s)' },
        { level: 'ok', text: '3-4B Q8' },
        { level: 'warn', text: '13B partial offload' },
      ],
      searchKeywords: ['7B', '8B', '3B'],
      picks: [
        { repoId: 'bartowski/Qwen2.5-7B-Instruct-GGUF', note: 'Qwen2.5 7B' },
        { repoId: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', note: 'Llama 3.1 8B' },
        { repoId: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', note: 'Qwen2.5 Coder 7B' },
      ],
    };
  }
  if (vramGB >= 6) {
    return {
      key: 'entry',
      label: 'Entry GPU',
      summary: `${vramGB.toFixed(0)} GB VRAM — 3-4B fits, 7B needs partial offload.`,
      runs: [
        { level: 'ok', text: '3-4B Q8 fully on GPU (~70 t/s)' },
        { level: 'ok', text: '7B Q3/Q4 partial offload (~15-25 t/s)' },
        { level: 'warn', text: 'Larger models hit CPU' },
      ],
      searchKeywords: ['3B', '4B', '7B', 'phi'],
      picks: [
        { repoId: 'bartowski/Qwen2.5-7B-Instruct-GGUF', note: 'Qwen2.5 7B (partial offload)' },
        { repoId: 'bartowski/Llama-3.2-3B-Instruct-GGUF', note: 'Llama 3.2 3B (fully fits)' },
        { repoId: 'bartowski/Phi-3.5-mini-instruct-GGUF', note: 'Phi 3.5 mini 3.8B' },
      ],
    };
  }
  if (vramGB >= 4) {
    return {
      key: 'budget',
      label: 'Budget GPU',
      summary: `${vramGB.toFixed(0)} GB VRAM + ${ramGB.toFixed(0)} GB RAM — 3B Q8 or 7B partial.`,
      runs: [
        { level: 'ok', text: '3B Q4-Q8 fully on GPU (~50-80 t/s)' },
        { level: 'warn', text: '4B Q4 fully, Q8 partial' },
        { level: 'warn', text: '7B Q4 partial offload (~10-15 t/s)' },
      ],
      searchKeywords: ['3B', '4B', 'phi', 'qwen'],
      picks: [
        { repoId: 'bartowski/Llama-3.2-3B-Instruct-GGUF', note: 'Llama 3.2 3B — best fit' },
        { repoId: 'bartowski/Qwen2.5-3B-Instruct-GGUF', note: 'Qwen2.5 3B' },
        { repoId: 'bartowski/Qwen2.5-Coder-3B-Instruct-GGUF', note: 'Qwen2.5 Coder 3B' },
        { repoId: 'bartowski/Phi-3.5-mini-instruct-GGUF', note: 'Phi 3.5 mini — 7B partial' },
      ],
    };
  }
  if (vramGB >= 2) {
    return {
      key: 'low-vram',
      label: 'Low VRAM',
      summary: `${vramGB.toFixed(0)} GB VRAM — stick to 1-3B.`,
      runs: [
        { level: 'ok', text: '1-3B Q4 fully' },
        { level: 'warn', text: 'Larger models dominated by CPU' },
      ],
      searchKeywords: ['1B', '3B', 'tinyllama', 'phi'],
      picks: [
        { repoId: 'bartowski/Llama-3.2-1B-Instruct-GGUF', note: 'Llama 3.2 1B — fastest' },
        { repoId: 'bartowski/gemma-2-2b-it-GGUF', note: 'Gemma 2 2B' },
        { repoId: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF', note: 'Qwen2.5 1.5B' },
      ],
    };
  }
  // CPU only
  if (ramGB >= 32) {
    return {
      key: 'cpu-only',
      label: 'CPU-only (abundant RAM)',
      summary: `No GPU — but ${ramGB.toFixed(0)} GB RAM supports up to 13B at a slow pace.`,
      runs: [
        { level: 'ok', text: '7B Q4 on CPU (~3-5 t/s)' },
        { level: 'warn', text: '13B Q4 on CPU (slow, ~1-2 t/s)' },
        { level: 'bad', text: 'Realtime use needs a GPU' },
      ],
      searchKeywords: ['3B', '7B', 'phi'],
      picks: [
        { repoId: 'bartowski/Llama-3.2-3B-Instruct-GGUF', note: 'Llama 3.2 3B — fastest on CPU' },
        { repoId: 'bartowski/Qwen2.5-7B-Instruct-GGUF', note: 'Qwen2.5 7B (patient)' },
      ],
    };
  }
  return {
    key: 'cpu-only',
    label: 'CPU-only (limited RAM)',
    summary: `No GPU, ${ramGB.toFixed(0)} GB RAM — stick to 1-3B quanted.`,
    runs: [
      { level: 'ok', text: '1-3B Q4 on CPU' },
      { level: 'warn', text: '7B will be painful' },
    ],
    searchKeywords: ['1B', '3B', 'phi', 'tinyllama'],
    picks: [
      { repoId: 'bartowski/Llama-3.2-1B-Instruct-GGUF', note: 'Llama 3.2 1B' },
      { repoId: 'bartowski/gemma-2-2b-it-GGUF', note: 'Gemma 2 2B' },
    ],
  };
}

export function hfSearchUrl(tier: CapacityTier, opts?: { sort?: 'trending' | 'downloads' | 'likes7d' | 'modified' }): string {
  const sort = opts?.sort ?? 'trending';
  const params = new URLSearchParams();
  params.set('library', 'gguf');
  params.set('pipeline_tag', 'text-generation');
  params.set('sort', sort);
  if (tier.searchKeywords.length > 0) {
    params.set('search', tier.searchKeywords.join(' '));
  }
  return `https://huggingface.co/models?${params.toString()}`;
}

export function hfSearchUrlForKeyword(keyword: string): string {
  const params = new URLSearchParams();
  params.set('library', 'gguf');
  params.set('pipeline_tag', 'text-generation');
  params.set('sort', 'trending');
  params.set('search', keyword);
  return `https://huggingface.co/models?${params.toString()}`;
}
