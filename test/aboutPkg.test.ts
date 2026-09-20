import { describe, it, expect, afterEach } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP, appSignature, findPackageJson, normalizeAuthor } from '../src/infra/about.js';

describe('APP metadata', () => {
  it('matches the real package.json rather than the fallbacks', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(APP.packageName).toBe(pkg.name);
    expect(APP.version).toBe(pkg.version);
    expect(APP.license).toBe(pkg.license);
    expect(APP.homepage).toBe(pkg.homepage);
    expect(APP.description).toBe(pkg.description);
  });

  it('takes the binary name from the bin map', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(APP.binary).toBe(Object.keys(pkg.bin)[0]);
  });

  it('normalises the object-form author from the real manifest', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(APP.author.name).toBe(pkg.author.name);
    expect(APP.author.email).toBe(pkg.author.email);
    expect(APP.author.url).toBe(pkg.author.url);
  });

  it('never leaves a field undefined', () => {
    for (const [k, v] of Object.entries(APP)) expect(v, k).toBeDefined();
  });
});

describe('appSignature', () => {
  it('joins binary, version, licence and author with middots', () => {
    expect(appSignature())
      .toBe(`${APP.binary} v${APP.version} · ${APP.license} · ${APP.author.name}`);
  });
});

describe('normalizeAuthor', () => {
  it('parses the "Name <email> (url)" string form', () => {
    expect(normalizeAuthor('Ada Lovelace <ada@example.com> (https://ada.example)')).toEqual({
      name: 'Ada Lovelace', email: 'ada@example.com', url: 'https://ada.example',
    });
  });

  it('parses a name with an email but no url', () => {
    expect(normalizeAuthor('Ada <ada@example.com>')).toEqual({
      name: 'Ada', email: 'ada@example.com', url: undefined,
    });
  });

  it('parses a name with a url but no email', () => {
    expect(normalizeAuthor('Ada (https://ada.example)')).toEqual({
      name: 'Ada', email: undefined, url: 'https://ada.example',
    });
  });

  it('parses a bare name and trims it', () => {
    expect(normalizeAuthor('  Solo Maintainer  ')).toEqual({
      name: 'Solo Maintainer', email: undefined, url: undefined,
    });
  });

  it('passes the object form straight through', () => {
    expect(normalizeAuthor({ name: 'A', email: 'a@b.c', url: 'https://a' })).toEqual({
      name: 'A', email: 'a@b.c', url: 'https://a',
    });
  });

  it('defaults a nameless object to "unknown"', () => {
    expect(normalizeAuthor({ email: 'x@y.z' })).toEqual({
      name: 'unknown', email: 'x@y.z', url: undefined,
    });
  });

  it('returns the unknown triple when there is no author at all', () => {
    expect(normalizeAuthor(undefined)).toEqual({
      name: 'unknown', email: undefined, url: undefined,
    });
  });

  it('returns the unknown triple for an empty string', () => {
    expect(normalizeAuthor('')).toEqual({
      name: 'unknown', email: undefined, url: undefined,
    });
  });
});

describe('findPackageJson', () => {
  let sandbox: string;

  afterEach(async () => {
    if (sandbox) await rm(sandbox, { recursive: true, force: true });
  });

  it('finds the manifest sitting in the start directory', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'hfo-findpkg-'));
    await writeFile(join(sandbox, 'package.json'), JSON.stringify({ name: 'here', version: '1.0.0' }));
    expect(findPackageJson(sandbox).name).toBe('here');
  });

  it('walks up to a parent directory', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'hfo-findpkg-'));
    const deep = join(sandbox, 'a', 'b', 'c');
    await mkdir(deep, { recursive: true });
    await writeFile(join(sandbox, 'package.json'), JSON.stringify({ name: 'above', version: '2.0.0' }));
    expect(findPackageJson(deep).name).toBe('above');
  });

  it('keeps walking past an unreadable manifest', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'hfo-findpkg-'));
    const deep = join(sandbox, 'inner');
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'package.json'), '{ not json');
    await writeFile(join(sandbox, 'package.json'), JSON.stringify({ name: 'valid', version: '3.0.0' }));
    expect(findPackageJson(deep).name).toBe('valid');
  });

  it('keeps walking past a manifest with neither name nor version', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'hfo-findpkg-'));
    const deep = join(sandbox, 'inner');
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'package.json'), JSON.stringify({ private: true }));
    await writeFile(join(sandbox, 'package.json'), JSON.stringify({ name: 'real', version: '4.0.0' }));
    expect(findPackageJson(deep).name).toBe('real');
  });

  it('gives up after six levels and returns an empty shape', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'hfo-findpkg-'));
    const deep = join(sandbox, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
    await mkdir(deep, { recursive: true });
    await writeFile(join(sandbox, 'package.json'), JSON.stringify({ name: 'too-far', version: '1' }));
    expect(findPackageJson(deep)).toEqual({});
  });

  it('returns an empty shape when nothing is found before the filesystem root', async () => {
    // A path that cannot contain a manifest within six hops of the root.
    expect(findPackageJson(join(tmpdir(), 'hfo-definitely-absent-dir'))).toBeTypeOf('object');
  });
});
