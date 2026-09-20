import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

// openUrl and configDir both branch on platform(), and configDir also reads
// homedir(). Stub node:os so all three OS paths can be driven from any host —
// this is the one module allowed to branch on the platform, so it is the one
// module that has to be tested across all of them.
const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa }));

const state = vi.hoisted(() => ({ platform: 'linux' as NodeJS.Platform, home: '/home/u' }));
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, platform: () => state.platform, homedir: () => state.home };
});

import { openUrl, configDir, settingsPath, resolveBinary, expandHome } from '../src/infra/platform.js';

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  execa.mockReset();
  execa.mockResolvedValue({ exitCode: 0 });
  state.platform = 'linux';
  state.home = '/home/u';
  for (const k of ['APPDATA', 'XDG_CONFIG_HOME']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

describe('openUrl', () => {
  it('uses cmd start on Windows, with the empty title argument', async () => {
    state.platform = 'win32';
    expect(await openUrl('https://example.com')).toBe(true);
    expect(execa).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '', 'https://example.com'],
      { reject: false, detached: true },
    );
  });

  it('uses open on macOS', async () => {
    state.platform = 'darwin';
    expect(await openUrl('https://example.com')).toBe(true);
    expect(execa).toHaveBeenCalledWith('open', ['https://example.com'], { reject: false, detached: true });
  });

  it('uses xdg-open everywhere else', async () => {
    state.platform = 'linux';
    expect(await openUrl('https://example.com')).toBe(true);
    expect(execa).toHaveBeenCalledWith('xdg-open', ['https://example.com'], { reject: false, detached: true });
  });

  it('returns false rather than throwing when the opener is unavailable', async () => {
    execa.mockRejectedValue(new Error('no browser'));
    expect(await openUrl('https://example.com')).toBe(false);
  });
});

describe('configDir', () => {
  it('uses APPDATA on Windows when it is set', () => {
    state.platform = 'win32';
    process.env.APPDATA = 'C:/Users/x/AppData/Roaming';
    expect(configDir()).toBe(join('C:/Users/x/AppData/Roaming', 'hfo'));
  });

  it('falls back to the profile path on Windows when APPDATA is unset', () => {
    state.platform = 'win32';
    state.home = 'C:/Users/x';
    expect(configDir()).toBe(join('C:/Users/x', 'AppData', 'Roaming', 'hfo'));
  });

  it('uses Application Support on macOS', () => {
    state.platform = 'darwin';
    state.home = '/Users/x';
    expect(configDir()).toBe(join('/Users/x', 'Library', 'Application Support', 'hfo'));
  });

  it('honours XDG_CONFIG_HOME on Linux', () => {
    state.platform = 'linux';
    process.env.XDG_CONFIG_HOME = '/custom/config';
    expect(configDir()).toBe(join('/custom/config', 'hfo'));
  });

  it('falls back to ~/.config on Linux', () => {
    state.platform = 'linux';
    state.home = '/home/u';
    expect(configDir()).toBe(join('/home/u', '.config', 'hfo'));
  });
});

describe('settingsPath', () => {
  it('is settings.json inside the config dir', () => {
    expect(settingsPath()).toBe(join(configDir(), 'settings.json'));
  });
});

describe('resolveBinary — the PATH probe on each OS', () => {
  it('uses `where` on Windows', async () => {
    state.platform = 'win32';
    execa.mockResolvedValue({ exitCode: 0 });
    expect(await resolveBinary('somebin')).toBe('somebin');
    expect(execa).toHaveBeenCalledWith('where', ['somebin'], expect.anything());
  });

  it('runs `command -v` through sh elsewhere, passing the name as argv', async () => {
    state.platform = 'linux';
    execa.mockResolvedValue({ exitCode: 0 });
    expect(await resolveBinary('somebin')).toBe('somebin');
    // The name is an argv parameter, never interpolated into the script.
    expect(execa).toHaveBeenCalledWith(
      'sh',
      ['-c', 'command -v "$1"', 'sh', 'somebin'],
      expect.anything(),
    );
  });

  it('returns null when the probe reports a non-zero exit', async () => {
    state.platform = 'linux';
    execa.mockResolvedValue({ exitCode: 1 });
    expect(await resolveBinary('somebin')).toBeNull();
  });

  it('falls through to the candidates when the probe itself throws', async () => {
    state.platform = 'linux';
    execa.mockRejectedValue(new Error('no shell'));
    expect(await resolveBinary('somebin', [process.execPath])).toBe(process.execPath);
  });
});

describe('expandHome — variable forms', () => {
  it('expands a $VAR reference', () => {
    process.env.HFO_TEST_DOLLAR = 'DV';
    expect(expandHome('$HFO_TEST_DOLLAR/bin')).toBe('DV/bin');
    delete process.env.HFO_TEST_DOLLAR;
  });

  it('expands a ${VAR} reference', () => {
    process.env.HFO_TEST_BRACE = 'BV';
    expect(expandHome('${HFO_TEST_BRACE}/bin')).toBe('BV/bin');
    delete process.env.HFO_TEST_BRACE;
  });

  it('leaves an unset $VAR as written', () => {
    expect(expandHome('$HFO_UNSET_DOLLAR/bin')).toBe('$HFO_UNSET_DOLLAR/bin');
  });

  it('expands a leading tilde together with a variable', () => {
    process.env.HFO_TEST_MIX = 'M';
    state.home = '/home/u';
    expect(expandHome('~/$HFO_TEST_MIX')).toBe(join('/home/u', '/M'));
    delete process.env.HFO_TEST_MIX;
  });
});
