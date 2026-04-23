import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PkgShape {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  homepage?: string;
  author?:
    | string
    | { name?: string; email?: string; url?: string };
  bin?: Record<string, string>;
}

function findPackageJson(): PkgShape {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(raw) as PkgShape;
        if (parsed && typeof parsed === 'object' && (parsed.name || parsed.version)) {
          return parsed;
        }
      } catch {
        // keep walking — unreadable JSON at this level doesn't mean we should stop
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

const pkg: PkgShape = findPackageJson();

function normalizeAuthor(a: PkgShape['author']) {
  if (!a) return { name: 'unknown', email: undefined as string | undefined, url: undefined as string | undefined };
  if (typeof a === 'string') {
    // "Name <email> (url)"
    const match = a.match(/^([^<(]+?)(?:\s*<([^>]+)>)?(?:\s*\(([^)]+)\))?\s*$/);
    return {
      name: (match?.[1] ?? a).trim(),
      email: match?.[2],
      url: match?.[3],
    };
  }
  return {
    name: a.name ?? 'unknown',
    email: a.email,
    url: a.url,
  };
}

export const APP = {
  packageName: pkg.name ?? 'hfo-cli',
  binary: Object.keys(pkg.bin ?? {})[0] ?? 'hfo',
  version: pkg.version ?? '0.0.0',
  description: pkg.description ?? '',
  license: pkg.license ?? 'UNLICENSED',
  homepage: pkg.homepage ?? '',
  author: normalizeAuthor(pkg.author),
} as const;

export function appSignature(): string {
  // "hfo v0.1.0 · MIT · José Carrillo"
  const parts = [
    `${APP.binary} v${APP.version}`,
    APP.license,
    APP.author.name,
  ];
  return parts.join(' · ');
}
