import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { HardwareProfile } from './hardware.js';
import type { Installation } from './settings.js';
import { scoreQuant } from './scoring.js';
import { buildDefaultParams } from './plan.js';
import { buildModelfile, writeModelfile } from './modelfile.js';
import { ollamaCreate } from './ollama.js';
import { extractQuant, type HfFile } from './hf.js';
import { loadCardParams } from './readme.js';
import { recordInstallation } from './settings.js';

export type DirInspection =
  | { kind: 'ready'; gguf: string; modelfile: string }
  | { kind: 'needs-generation'; gguf: string; sizeBytes: number; quant: string }
  | { kind: 'missing-gguf' }
  | { kind: 'missing-dir' };

/**
 * Inspect a directory that (used to) host an installed model and figure out
 * what we need to do to reinstall it with Ollama:
 *
 *  - `ready` – a `.gguf` and a `Modelfile` sit side-by-side, just run ollama create
 *  - `needs-generation` – only the GGUF is there, we must synthesize a Modelfile
 *  - `missing-gguf` – the directory has no .gguf, nothing we can do
 *  - `missing-dir` – the directory itself is gone (ghost entry in settings)
 */
export async function inspectInstallDir(dir: string): Promise<DirInspection> {
  try {
    await stat(dir);
  } catch {
    return { kind: 'missing-dir' };
  }

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return { kind: 'missing-dir' };
  }

  const gguf = files.find((f) => f.toLowerCase().endsWith('.gguf'));
  if (!gguf) return { kind: 'missing-gguf' };

  const hasModelfile = files.some((f) => f === 'Modelfile');
  if (hasModelfile) {
    return { kind: 'ready', gguf, modelfile: 'Modelfile' };
  }

  const ggufStat = await stat(join(dir, gguf));
  return {
    kind: 'needs-generation',
    gguf,
    sizeBytes: ggufStat.size,
    quant: extractQuant(gguf),
  };
}

export interface ReinstallResult {
  tag: string;
  dir: string;
  modelfilePath: string;
  modelfileGenerated: boolean;
}

export interface ReinstallOpts {
  token?: string;
  isCodeModel?: boolean;
}

/**
 * Given a (possibly orphan) installation record, re-register it with Ollama.
 * When no Modelfile is present, we synthesize one from the GGUF alone using
 * the same hardware-scoring + HF-card + defaults pipeline that powers fresh
 * installs, so the user gets a Modelfile just as good as the original.
 */
export async function reinstallInstallation(
  install: Installation,
  hw: HardwareProfile,
  opts: ReinstallOpts = {},
): Promise<ReinstallResult> {
  const inspection = await inspectInstallDir(install.dir);

  if (inspection.kind === 'missing-dir') {
    throw new Error(`Directory is gone: ${install.dir}`);
  }
  if (inspection.kind === 'missing-gguf') {
    throw new Error(`No .gguf file in ${install.dir}`);
  }

  const modelfilePath = join(install.dir, 'Modelfile');
  let generated = false;

  if (inspection.kind === 'needs-generation') {
    const mockFile: HfFile = {
      path: inspection.gguf,
      size: inspection.sizeBytes,
      oid: '',
    };
    const score = scoreQuant(mockFile, hw);
    const card = install.repoId
      ? await loadCardParams(install.repoId, opts.token).catch(() => ({ params: {}, foundKeys: [], raw: null }))
      : { params: {}, foundKeys: [], raw: null };
    const params = buildDefaultParams(score, hw, card.params, !!opts.isCodeModel);
    const content = buildModelfile({
      ggufFilename: inspection.gguf,
      repoId: install.repoId || 'local-directory',
      quant: inspection.quant || install.quant || 'unknown',
      hw,
      params,
      cardSource: card.foundKeys,
      isCodeModel: opts.isCodeModel,
      scoreLabel: `${score.score}/100 (${score.label}) · reconstructed`,
    });
    await writeModelfile(modelfilePath, content);
    generated = true;
  }

  await ollamaCreate(install.tag, modelfilePath, install.dir);
  await recordInstallation({
    tag: install.tag,
    dir: install.dir,
    repoId: install.repoId ?? basename(install.dir),
    quant: install.quant ?? (inspection.kind === 'needs-generation' ? inspection.quant : 'unknown'),
  });

  return {
    tag: install.tag,
    dir: install.dir,
    modelfilePath,
    modelfileGenerated: generated,
  };
}
