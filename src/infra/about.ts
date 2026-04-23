import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Static metadata read from the project's package.json at load time. Bundled
 * as a dedicated module so every consumer (header, Help tab, CLI --version,
 * etc.) sees the same canonical values.
 */
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

const pkg: PkgShape = (() => {
  try {
    return require('../package.json') as PkgShape;
  } catch {
    return {};
  }
})();

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
