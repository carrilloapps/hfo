import { writeFile } from 'node:fs/promises';
import type { HardwareProfile } from './hardware.js';
import type { ResolvedParams } from './plan.js';

export interface ModelfileOpts {
  ggufFilename: string;
  repoId: string;
  quant: string;
  hw: HardwareProfile;
  params: ResolvedParams;
  isCodeModel?: boolean;
  scoreLabel?: string;
  cardSource?: string[];   // list of params that came from the HF model card
  systemPrompt?: string;
}

export function buildModelfile(opts: ModelfileOpts): string {
  const { params } = opts;
  const systemPrompt =
    opts.systemPrompt ??
    (opts.isCodeModel
      ? `You are a code-specialized assistant. Prefer correctness and clarity. Use fenced blocks with the correct language tag.`
      : `You are a helpful assistant. Be concise and accurate.`);

  const numGpuLine =
    params.numGpu == null
      ? '# PARAMETER num_gpu 99   # commented: model > VRAM, Ollama auto-splits. Pin a number (e.g. 22) after benchmarking.'
      : `PARAMETER num_gpu ${params.numGpu}`;
  const numThreadLine =
    params.numThread == null ? '# PARAMETER num_thread 8   # uncomment to pin CPU threads (default: auto)' : `PARAMETER num_thread ${params.numThread}`;

  const cardTag = opts.cardSource && opts.cardSource.length > 0
    ? `\n# HF model-card recommendations applied for: ${opts.cardSource.join(', ')}`
    : '';

  const header = `# ═══════════════════════════════════════════════════════════════════
# runllama-generated Modelfile — safe to edit, then:
#     ollama create <tag> -f Modelfile
# ═══════════════════════════════════════════════════════════════════
# Source repo : ${opts.repoId}
# Quant       : ${opts.quant}
# Compatibility: ${opts.scoreLabel ?? 'n/a'}
# Target GPU  : ${opts.hw.gpuName ?? 'none'} (${opts.hw.vramMiB} MiB VRAM)
# Target RAM  : ${opts.hw.ramMiB} MiB · ${opts.hw.cpuCores} CPU cores · ${opts.hw.platform}${cardTag}
# ═══════════════════════════════════════════════════════════════════

# ─── Sampling (safe to tune) ─────────────────────────────────────────
# temperature: 0.0 = deterministic, 1.0 = creative. Code tasks: 0.2-0.4.
# top_p:       nucleus sampling. 0.9-0.95 standard.
# top_k:       cap on candidate tokens. Lower = more focused.
# repeat_penalty: 1.0-1.1. Higher = less looping but can hurt structured output.
# min_p:       filters low-prob tokens. 0.05 is a solid default.
`;

  const runtimeNotes = `
# ─── Runtime (adjust if you hit OOM or slow inference) ──────────────
# num_ctx:     context window. Each +1024 tokens = +~50-200 MiB VRAM.
# num_batch:   prompt processing batch. Lower if OOM during ingestion.
# num_gpu:     layers on GPU. 99 = all. Lower (e.g. 20) if OOM at load.
# num_thread:  CPU threads (auto by default; set to physical-core count).
# repeat_last_n: how many past tokens repeat_penalty looks at.
`;

  return `${header}FROM ./${opts.ggufFilename}

PARAMETER temperature ${params.temperature}
PARAMETER top_p ${params.topP}
PARAMETER top_k ${params.topK}
PARAMETER repeat_penalty ${params.repeatPenalty}
PARAMETER min_p ${params.minP}
${runtimeNotes}PARAMETER num_ctx ${params.numCtx}
PARAMETER num_batch ${params.numBatch}
PARAMETER repeat_last_n ${params.repeatLastN}
${numGpuLine}
${numThreadLine}

SYSTEM """${systemPrompt}"""
`;
}

export async function writeModelfile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8');
}

export function suggestTag(repoId: string, quant: string): string {
  const repoName = repoId.split('/').pop()!.toLowerCase();
  const clean = repoName
    .replace(/\.(gguf|ggml|safetensors)$/i, '')
    .replace(/[-_. ](gguf|ggml|imatrix|quants?|quantized)$/gi, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const quantTag = quant.toLowerCase().replace(/_/g, '-');
  return `${clean}:${quantTag}`;
}
