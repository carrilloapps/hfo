import AdmZip from 'adm-zip';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { ollamaCreate } from './ollama.js';
import { recordInstallation } from './settings.js';
import { inspectInstallDir, reinstallInstallation } from './reinstall.js';
import type { HardwareProfile } from './hardware.js';

export interface BackupManifest {
  tag: string;
  repoId?: string | null;
  quant?: string | null;
  sourceDir: string;
  zipPath: string;
  originalBytes: number;
  compressedBytes: number;
  compressionRatio: number;
  timestamp: string;
  createdAtIso: string;
  tool: string;
}

export interface RestoreResult {
  tag: string;
  restoredTo: string;
  modelfileGenerated: boolean;
  manifest: BackupManifest | null;
}

export interface RestoreOpts {
  targetDir?: string;      // where to extract; defaults to manifest.sourceDir
  overwrite?: boolean;     // if target already has files, wipe first
  registerWithOllama?: boolean; // default true — call ollama create after extraction
  token?: string;
  isCodeModel?: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function findMetadataEntryInZip(zip: AdmZip): AdmZip.IZipEntry | null {
  return zip.getEntries().find((e) => e.entryName.endsWith('.metadata.json') && !e.isDirectory) ?? null;
}

/**
 * Parse the sidecar `*.metadata.json` that hfo's backup routine writes. If it
 * lives inside the zip (newer backups) we read it from there; if it sits next
 * to the zip on disk (older layout), we fall back to reading the filesystem.
 */
export async function readBackupManifest(zipPath: string): Promise<BackupManifest | null> {
  const sibling = join(
    dirname(zipPath),
    `${basename(zipPath, '.zip')}.metadata.json`,
  );
  if (await pathExists(sibling)) {
    try {
      const text = await readFile(sibling, 'utf8');
      return JSON.parse(text) as BackupManifest;
    } catch {
      /* fall through */
    }
  }
  try {
    const zip = new AdmZip(zipPath);
    const entry = findMetadataEntryInZip(zip);
    if (entry) {
      return JSON.parse(entry.getData().toString('utf8')) as BackupManifest;
    }
  } catch {
    /* corrupt zip, return null */
  }
  return null;
}

/**
 * Inverse of backup.ts#backupDirectory: extract the archive to a target dir
 * (manifest's original sourceDir by default) and optionally re-register the
 * model with Ollama. When the archive is missing a Modelfile (e.g. user
 * hand-zipped only the GGUF), we defer to reinstallInstallation() which
 * synthesizes one from the hardware + HF card pipeline.
 */
export async function restoreBackup(
  zipPath: string,
  hw: HardwareProfile,
  opts: RestoreOpts = {},
): Promise<RestoreResult> {
  const manifest = await readBackupManifest(zipPath);

  const defaultTarget = manifest?.sourceDir ?? join(dirname(zipPath), basename(zipPath, '.zip'));
  const target = resolve(opts.targetDir ?? defaultTarget);

  await mkdir(target, { recursive: true });

  const zip = new AdmZip(zipPath);
  // adm-zip overwriting via third arg (true); if caller wants a clean slate
  // they must pass overwrite + handle the filesystem wipe externally.
  zip.extractAllTo(target, opts.overwrite ?? true);

  // The zip preserves the top-level folder (archive.directory(src, basename(src))).
  // Find the single top-level entry we just extracted so downstream tooling sees
  // the "real" model directory.
  const topLevelGuess = manifest ? join(target, basename(manifest.sourceDir)) : target;
  const restoredTo = (await pathExists(topLevelGuess)) ? topLevelGuess : target;

  if (!opts.registerWithOllama && opts.registerWithOllama !== undefined) {
    return { tag: manifest?.tag ?? 'unknown', restoredTo, modelfileGenerated: false, manifest };
  }

  if (!manifest?.tag) {
    // No tag to re-register against; leave files extracted for the user
    return { tag: 'unknown', restoredTo, modelfileGenerated: false, manifest };
  }

  const inspection = await inspectInstallDir(restoredTo);
  if (inspection.kind === 'ready') {
    await ollamaCreate(manifest.tag, join(restoredTo, 'Modelfile'), restoredTo);
    await recordInstallation({
      tag: manifest.tag,
      dir: restoredTo,
      repoId: manifest.repoId ?? 'restored',
      quant: manifest.quant ?? 'unknown',
    });
    return { tag: manifest.tag, restoredTo, modelfileGenerated: false, manifest };
  }

  // needs-generation / missing-gguf / missing-dir: delegate to reinstall pipeline
  const result = await reinstallInstallation(
    {
      tag: manifest.tag,
      dir: restoredTo,
      repoId: manifest.repoId ?? 'restored',
      quant: manifest.quant ?? 'unknown',
      installedAt: manifest.createdAtIso,
    },
    hw,
    { token: opts.token, isCodeModel: opts.isCodeModel },
  );

  return {
    tag: result.tag,
    restoredTo: result.dir,
    modelfileGenerated: result.modelfileGenerated,
    manifest,
  };
}
