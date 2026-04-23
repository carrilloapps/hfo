import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { APP, appSignature } from '../src/infra/about.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as {
  name: string;
  version: string;
  license: string;
  author: { name: string };
  bin: Record<string, string>;
};

describe('APP metadata', () => {
  it('is populated from package.json', () => {
    expect(APP.packageName).toBeTruthy();
    expect(APP.binary).toBeTruthy();
    expect(APP.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP.license).toBeTruthy();
    expect(APP.author.name).toBeTruthy();
  });

  it('matches the canonical values in package.json (no silent fallback)', () => {
    // Guards against the dist/ regression where createRequire('../package.json')
    // resolved from the wrong directory and we shipped version '0.0.0' / license 'UNLICENSED'.
    expect(APP.packageName).toBe(pkg.name);
    expect(APP.version).toBe(pkg.version);
    expect(APP.license).toBe(pkg.license);
    expect(APP.author.name).toBe(pkg.author.name);
    expect(APP.binary).toBe(Object.keys(pkg.bin)[0]);
    expect(APP.version).not.toBe('0.0.0');
    expect(APP.license).not.toBe('UNLICENSED');
    expect(APP.author.name).not.toBe('unknown');
  });
});

describe('appSignature', () => {
  it('joins binary, version, license, author with middle dots', () => {
    const sig = appSignature();
    expect(sig).toContain(APP.version);
    expect(sig).toContain(APP.license);
    expect(sig).toContain(APP.author.name);
  });
});
