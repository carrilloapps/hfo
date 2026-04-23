import type { HardwareProfile } from './hardware.js';
import type { QuantScore } from './scoring.js';
import type { HfRepoInfo } from './hf.js';
import type { RecommendedParams } from './readme.js';
import { basename, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { ollamaList } from './ollama.js';
import { suggestTag } from './modelfile.js';

export interface ResolvedParams {
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  minP: number;
  numCtx: number;
  numBatch: number;
  numGpu: number | null;      // null = auto (commented in Modelfile)
  numThread: number | null;   // null = auto (Ollama picks)
  repeatLastN: number;
}

export interface PlannedInstall {
  quant: QuantScore;
  tag: string;
  dir: string;
  modelfilePath: string;
  destFile: string;
  action: 'install' | 'overwrite' | 'skip';
  fileExistsBytes: number | null;    // null if no existing file
  tagExists: boolean;
}

export function buildDefaultParams(
  score: QuantScore,
  hw: HardwareProfile,
  fromCard: RecommendedParams,
  isCodeModel: boolean,
): ResolvedParams {
  // start from hardware + code-model defaults
  const fits = score.fitsFully;
  const defaults: ResolvedParams = {
    temperature: isCodeModel ? 0.4 : 0.7,
    topP: 0.95,
    topK: 40,
    repeatPenalty: 1.05,
    minP: 0.05,
    numCtx: fits ? 8192 : 4096,
    numBatch: fits ? 512 : 256,
    numGpu: fits ? 99 : null,
    numThread: null,
    repeatLastN: 256,
  };
  // overlay values from HF model card if present
  if (fromCard.temperature !== undefined) defaults.temperature = fromCard.temperature;
  if (fromCard.topP !== undefined) defaults.topP = fromCard.topP;
  if (fromCard.topK !== undefined) defaults.topK = fromCard.topK;
  if (fromCard.repeatPenalty !== undefined) defaults.repeatPenalty = fromCard.repeatPenalty;
  if (fromCard.minP !== undefined) defaults.minP = fromCard.minP;
  if (fromCard.ctxSize !== undefined) {
    // don't allow card to exceed what fits in RAM
    defaults.numCtx = Math.min(fromCard.ctxSize, fits ? 32768 : 8192);
  }
  return defaults;
}

export async function buildPlans(
  repo: HfRepoInfo,
  quants: QuantScore[],
  destDir: string,
): Promise<PlannedInstall[]> {
  const existingTags = new Set(await ollamaList());
  const repoFolder = basename(destDir);
  void repoFolder; // reserved
  const plans: PlannedInstall[] = [];
  for (const q of quants) {
    const quantFolder = q.quant.toLowerCase().replace(/_/g, '-');
    const dir = join(destDir, quantFolder);
    const filename = basename(q.file.path);
    const destFile = join(dir, filename);
    const modelfilePath = join(dir, 'Modelfile');
    const tag = suggestTag(repo.id, q.quant);

    let fileExistsBytes: number | null = null;
    try {
      const s = await stat(destFile);
      fileExistsBytes = s.size;
    } catch {}

    plans.push({
      quant: q,
      tag,
      dir,
      modelfilePath,
      destFile,
      action: 'install',
      fileExistsBytes,
      tagExists: existingTags.has(tag),
    });
  }
  return plans;
}
