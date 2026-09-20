import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PkgShape {
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

/**
 * Walk up from `startDir` looking for the nearest usable package.json.
 *
 * Exported so the walk and its fallbacks can be tested directly; re-importing
 * this module against a planted manifest is not an option, because the value
 * is resolved once at import time.
 */
export function findPackageJson(startDir?: string): PkgShape {
  const here = startDir ?? dirname(fileURLToPath(import.meta.url));
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

/** Accepts npm's two author shapes: a string or an object. Exported for tests. */
export function normalizeAuthor(a: PkgShape['author']) {
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

/**
 * Project the manifest onto the shape the UI consumes, filling in a documented
 * default for anything the manifest omits.
 *
 * Exported separately from APP because APP is resolved once at import time
 * against this package's own manifest — the only way to exercise the fallbacks
 * is to call this with a sparse object.
 */
export function buildApp(p: PkgShape) {
  return {
    packageName: p.name ?? 'hfo-cli',
    binary: Object.keys(p.bin ?? {})[0] ?? 'hfo',
    version: p.version ?? '0.0.0',
    description: p.description ?? '',
    license: p.license ?? 'UNLICENSED',
    homepage: p.homepage ?? '',
    author: normalizeAuthor(p.author),
  } as const;
}

export const APP = buildApp(pkg);

/**
 * The two lines `hfo --version` prints. Takes the metadata so the url/homepage
 * fallback is reachable from a test — APP itself is fixed at import time.
 */
export function versionLines(app: ReturnType<typeof buildApp> = APP): [string, string] {
  return [
    `${app.binary} v${app.version}`,
    `${app.license} · ${app.author.name} · ${app.author.url ?? app.homepage}`,
  ];
}

export function appSignature(): string {
  // "hfo v0.1.0 · MIT · José Carrillo"
  const parts = [
    `${APP.binary} v${APP.version}`,
    APP.license,
    APP.author.name,
  ];
  return parts.join(' · ');
}
