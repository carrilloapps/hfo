#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section for one version, for use as GitHub Release
 * notes.
 *
 *   node scripts/changelog-section.mjs 0.2.0
 *   node scripts/changelog-section.mjs v0.2.0   # a leading v is tolerated
 *
 * Exits 1 when the version has no section, so a release job fails loudly
 * rather than publishing an empty body.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) {
  console.error('usage: changelog-section.mjs <version>');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = await readFile(join(root, 'CHANGELOG.md'), 'utf8');

// Headings look like:  ## [0.2.0] — 2026-09-19
const lines = text.split('\n');
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`No CHANGELOG section for ${version}`);
  process.exit(1);
}
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i].startsWith('## ')) { end = i; break; }
}

const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`CHANGELOG section for ${version} is empty`);
  process.exit(1);
}
process.stdout.write(body + '\n');
