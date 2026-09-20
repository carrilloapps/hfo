import { describe, it, expect } from 'vitest';
import { resolveBinary, expandHome } from '../src/infra/platform.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('resolveBinary', () => {
  it('finds a binary that is genuinely on PATH', async () => {
    // `node` is necessarily present — it is running this test.
    expect(await resolveBinary('node')).toBe('node');
  });

  it('returns null when nothing matches and no fallback hits', async () => {
    expect(await resolveBinary('hfo-definitely-not-a-real-binary-xyz')).toBeNull();
  });

  it('ignores fallback candidates that do not exist on disk', async () => {
    const missing = await resolveBinary('hfo-definitely-not-a-real-binary-xyz', [
      '~/nowhere/hfo-nope',
      '/var/empty/hfo-nope',
    ]);
    expect(missing).toBeNull();
  });

  it('accepts a bin that is already an absolute path, spaces and all', async () => {
    // `where` on Windows rejects a full path, and `command -v` will not find
    // one either, so this has to be checked as a file rather than a lookup.
    expect(await resolveBinary(process.execPath)).toBe(process.execPath);
  });

  it('returns null for an absolute path that does not exist', async () => {
    expect(await resolveBinary(join(homedir(), 'no-such-hfo-binary-xyz'))).toBeNull();
  });

  it('falls back to an absolute path when PATH misses but the file is there', async () => {
    // Point a fake name at the real node binary so the X_OK check succeeds.
    const found = await resolveBinary('hfo-definitely-not-a-real-binary-xyz', [process.execPath]);
    expect(found).toBe(process.execPath);
  });

  it('does not fall back to a PATH lookup for a path-like name', async () => {
    // './node' must never resolve to the node on PATH — a separator means the
    // caller asked for that exact file. Also keeps Windows from scanning PATH
    // for a name it can never match, which is slow enough to look like a hang.
    const start = Date.now();
    expect(await resolveBinary('./node')).toBeNull();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('expandHome', () => {
  it('expands a leading tilde', () => {
    expect(expandHome('~/foo')).toBe(join(homedir(), '/foo'));
  });

  it('leaves an absolute path untouched', () => {
    expect(expandHome('/usr/local/bin/agy')).toBe('/usr/local/bin/agy');
  });

  it('substitutes %VAR% style references', () => {
    process.env.HFO_TEST_VAR = 'XYZ';
    expect(expandHome('%HFO_TEST_VAR%/bin')).toBe('XYZ/bin');
    delete process.env.HFO_TEST_VAR;
  });

  it('leaves an unset variable as written rather than emptying the path', () => {
    expect(expandHome('%HFO_UNSET_VAR_ABC%/bin')).toBe('%HFO_UNSET_VAR_ABC%/bin');
  });
});
