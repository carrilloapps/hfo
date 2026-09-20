#!/usr/bin/env node
/**
 * Rewrite the version/date facts that the Pages site in `docs/` repeats by
 * hand, from `package.json`. Run it as part of cutting a release:
 *
 *   node scripts/sync-site.mjs            # rewrite docs/ in place
 *   node scripts/sync-site.mjs --check    # fail (exit 1) if anything drifted
 *
 * `--check` runs in `pnpm run ci`, so a version bump that forgets the site
 * breaks the build instead of shipping a homepage that advertises the
 * previous release. Only facts derivable from package.json live here —
 * anything else (feature copy, flags, keybindings) is still hand-written.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const check = process.argv.includes('--check');

/** Version facts — enforced by --check. */
const versionRules = [
  ['docs/index.html', /("softwareVersion": ")[^"]+(")/g, `$1${version}$2`],
  ['docs/index.html', /(<strong>Stable<\/strong>&nbsp;·&nbsp;v)[\d.]+/g, `$1${version}`],
  ['docs/index.html', /(<span class="stat-val">v)[\d.]+(<\/span>)/g, `$1${version}$2`],
  ['docs/install/index.html', /(hfo v)[\d.]+( · MIT)/g, `$1${version}$2`],
  ['docs/benchmarks/index.html', /("hfoVersion": ")[^"]+(")/g, `$1${version}$2`],
  ['docs/humans.txt', /(Version: {7})[\d.]+/g, `$1${version}`],
  ['docs/llms.txt', /(Version )[\d.]+\./g, `$1${version}.`],
  ['docs/llms-full.txt', /(Version )[\d.]+\./g, `$1${version}.`],
  // Rasterised into og-image.png by scripts/generate-favicons.mjs on deploy.
  ['docs/assets/og-image.svg', /(>v)[\d.]+(<\/text>)/g, `$1${version}$2`],
];

/** Date facts — refreshed on write, not enforced (they'd go stale daily). */
const dateRules = [
  ['docs/humans.txt', /(Last updated: {2})[\d-]+/g, `$1${today}`],
  ['docs/sitemap.xml', /<lastmod>[\d-]+<\/lastmod>/g, `<lastmod>${today}</lastmod>`],
];

const stale = [];
for (const [file, re, to] of check ? versionRules : [...versionRules, ...dateRules]) {
  const path = join(root, file);
  const before = await readFile(path, 'utf8');
  const after = before.replace(re, to);
  if (before === after) continue;
  if (check) stale.push(file);
  else await writeFile(path, after);
}

if (check && stale.length) {
  console.error(`docs/ is out of sync with package.json v${version}: ${[...new Set(stale)].join(', ')}`);
  console.error('Run `node scripts/sync-site.mjs` and commit the result.');
  process.exit(1);
}
console.log(check ? `docs/ in sync with v${version}` : `docs/ synced to v${version} (${today})`);
