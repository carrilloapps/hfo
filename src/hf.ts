import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface HfFile {
  path: string;
  size: number;
  oid: string;
}

export interface HfRepoInfo {
  id: string;
  files: HfFile[];
  ggufFiles: HfFile[];
}

export interface QuantInfo {
  file: HfFile;
  quant: string;
  label: string;
  fitsInVram: boolean;
  gpuLayerRatio: number;
}

export function parseRepoId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/huggingface\.co\/([^\/\s?#]+\/[^\/\s?#]+)/i);
  if (urlMatch) return urlMatch[1];
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return trimmed;
  throw new Error(`Not a valid HF repo id or URL: ${input}`);
}

export async function fetchRepoInfo(repoId: string, token?: string): Promise<HfRepoInfo> {
  const headers: Record<string, string> = { 'User-Agent': 'runllama/0.1' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const treeUrl = `https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`;
  const res = await fetch(treeUrl, { headers });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Repo "${repoId}" is gated or private. Set HF_TOKEN or pass --token.`);
    }
    if (res.status === 404) throw new Error(`Repo "${repoId}" not found on HuggingFace.`);
    throw new Error(`HF API ${res.status}: ${await res.text()}`);
  }
  const entries = (await res.json()) as Array<{ type: string; path: string; size: number; oid: string }>;
  const files: HfFile[] = entries
    .filter((e) => e.type === 'file')
    .map((e) => ({ path: e.path, size: e.size, oid: e.oid }));
  const ggufFiles = files.filter((f) => f.path.toLowerCase().endsWith('.gguf'));
  return { id: repoId, files, ggufFiles };
}

const QUANT_PATTERN = /(IQ\d+(?:_[A-Z0-9]+)*|Q\d+(?:_[A-Z0-9]+)*|F16|F32|BF16)/i;

export function extractQuant(filename: string): string {
  const match = filename.match(QUANT_PATTERN);
  return match ? match[1].toUpperCase() : 'unknown';
}

export function fileDownloadUrl(repoId: string, filePath: string): string {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${repoId}/resolve/main/${encoded}`;
}

export async function downloadFile(
  url: string,
  destPath: string,
  token: string | undefined,
  onProgress: (bytes: number, total: number) => void,
): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });

  let startByte = 0;
  try {
    const existing = await stat(destPath);
    startByte = existing.size;
  } catch {}

  const headers: Record<string, string> = { 'User-Agent': 'runllama/0.1' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (startByte > 0) headers.Range = `bytes=${startByte}-`;

  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Download failed ${res.status}: ${await res.text()}`);
  }
  if (!res.body) throw new Error('Empty response body');

  const totalHeader = res.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) + startByte : 0;

  let received = startByte;
  const passthrough = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      onProgress(received, total);
      controller.enqueue(chunk);
    },
  });

  const stream = res.body.pipeThrough(passthrough);
  const nodeReadable = Readable.fromWeb(stream as any);
  const out = createWriteStream(destPath, { flags: startByte > 0 ? 'a' : 'w' });
  await pipeline(nodeReadable, out);
}
