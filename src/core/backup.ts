import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { configDir } from '../infra/platform.js';

export interface BackupResult {
  zipPath: string;
  metadataPath: string;
  originalBytes: number;
  compressedBytes: number;
  fileCount: number;
  timestamp: string;
}

export interface BackupSubject {
  tag: string;
  dir: string;
  repoId?: string;
  quant?: string;
}

export interface BackupProgress {
  processedBytes: number;
  totalBytes: number;
  fileCount: number;
  currentFile: string;
}

/**
 * Build a filesystem-safe slug from a tag like "some-repo:q4-k-m" → "some-repo_q4-k-m".
 */
function slugFromTag(tag: string): string {
  return tag.replace(/[:\\/]+/g, '_').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export function resolveBackupRoot(override: string | null | undefined): string {
  if (override && override.trim()) return override;
  return join(configDir(), 'backups');
}

async function computeTotalBytes(dir: string): Promise<number> {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const entries = await readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          const s = await stat(full);
          total += s.size;
        } catch {}
      }
    }
  }
  return total;
}

/**
 * Zip a directory using store-quality streaming compression (level 9). Safe to
 * run on multi-GB GGUFs — it streams chunks through the zlib deflater without
 * buffering the whole file in memory. Writes a `metadata.json` next to the
 * `.zip` with tag + repo + byte counts so backups can be audited later.
 */
export async function backupDirectory(
  subject: BackupSubject,
  backupsRoot: string,
  onProgress?: (p: BackupProgress) => void,
): Promise<BackupResult> {
  const ts = timestamp();
  const targetFolder = join(backupsRoot, ts);
  await mkdir(targetFolder, { recursive: true });

  const zipName = `${slugFromTag(subject.tag)}.zip`;
  const zipPath = join(targetFolder, zipName);
  const metadataPath = join(targetFolder, `${slugFromTag(subject.tag)}.metadata.json`);

  const totalBytes = await computeTotalBytes(subject.dir);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    let processedBytes = 0;
    let fileCount = 0;
    let currentFile = '';

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') reject(err);
    });
    archive.on('entry', (entry) => {
      const size = Number((entry.stats as { size?: number } | undefined)?.size ?? 0);
      processedBytes += size;
      fileCount += 1;
      currentFile = entry.name as string;
      if (onProgress) {
        onProgress({ processedBytes, totalBytes, fileCount, currentFile });
      }
    });

    archive.pipe(output);
    archive.directory(subject.dir, basename(subject.dir));
    archive.finalize();
  });

  const finalStat = await stat(zipPath);

  const metadata = {
    tag: subject.tag,
    repoId: subject.repoId ?? null,
    quant: subject.quant ?? null,
    sourceDir: subject.dir,
    zipPath,
    originalBytes: totalBytes,
    compressedBytes: finalStat.size,
    compressionRatio: totalBytes > 0 ? finalStat.size / totalBytes : 0,
    timestamp: ts,
    createdAtIso: new Date().toISOString(),
    tool: 'hfo-cli',
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  return {
    zipPath,
    metadataPath,
    originalBytes: totalBytes,
    compressedBytes: finalStat.size,
    fileCount: 0,
    timestamp: ts,
  };
}

export async function listBackups(backupsRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(backupsRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => join(backupsRoot, e.name));
  } catch {
    return [];
  }
}

export { dirname };
