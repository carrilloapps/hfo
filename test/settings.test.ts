import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  settingsEqual,
  recordInstallation,
  forgetInstallation,
  findInstallation,
  type Settings,
} from '../src/infra/settings.js';
import { settingsPath } from '../src/infra/platform.js';

// settingsPath() resolves through configDir(), which reads APPDATA on Windows,
// XDG_CONFIG_HOME on Linux and HOME on macOS. Override all three so the suite
// never touches the real user config, and ask for the path rather than
// rebuilding it — the layout differs per OS.
let sandbox: string;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-settings-test-'));
  for (const key of ['APPDATA', 'HOME', 'XDG_CONFIG_HOME', 'USERPROFILE']) {
    saved[key] = process.env[key];
    process.env[key] = sandbox;
  }
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(sandbox, { recursive: true, force: true });
});

async function writeRaw(body: unknown): Promise<void> {
  const p = settingsPath();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
}

describe('loadSettings', () => {
  it('returns the defaults when no settings file exists', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults when the file is unparseable', async () => {
    await writeRaw('{ not json at all');
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial file over the defaults', async () => {
    await writeRaw({ refreshIntervalMs: 5000 });
    const s = await loadSettings();
    expect(s.refreshIntervalMs).toBe(5000);
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.installations).toEqual([]);
  });

  it('keeps a valid theme and language', async () => {
    await writeRaw({ theme: 'dracula', language: 'es' });
    const s = await loadSettings();
    expect(s.theme).toBe('dracula');
    expect(s.language).toBe('es');
  });

  it('falls back to the default theme when the stored one is unknown', async () => {
    await writeRaw({ theme: 'neon-vaporwave' });
    expect((await loadSettings()).theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('falls back to the default language when the stored one is unknown', async () => {
    await writeRaw({ language: 'xx' });
    expect((await loadSettings()).language).toBe(DEFAULT_SETTINGS.language);
  });
});

describe('saveSettings', () => {
  it('creates the config directory and writes indented JSON', async () => {
    const next: Settings = { ...DEFAULT_SETTINGS, refreshIntervalMs: 1234 };
    await saveSettings(next);
    const raw = await readFile(settingsPath(), 'utf8');
    expect(JSON.parse(raw).refreshIntervalMs).toBe(1234);
    expect(raw).toContain('\n  '); // pretty-printed, not minified
  });

  it('round-trips through loadSettings', async () => {
    const next: Settings = { ...DEFAULT_SETTINGS, theme: 'nord', defaultCodeMode: true };
    await saveSettings(next);
    expect(await loadSettings()).toEqual(next);
  });
});

describe('settingsEqual', () => {
  it('is true for identical objects', () => {
    expect(settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(true);
  });
  it('is false when any field differs', () => {
    expect(settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, theme: 'nord' })).toBe(false);
  });
});

describe('installations index', () => {
  const entry = { tag: 'demo:q4', dir: '/models/demo', repoId: 'org/demo', quant: 'Q4_K_M' };

  it('records an installation with an ISO timestamp', async () => {
    await recordInstallation(entry);
    const found = await findInstallation('demo:q4');
    expect(found).toMatchObject(entry);
    expect(new Date(found!.installedAt).toString()).not.toBe('Invalid Date');
  });

  it('replaces the previous record for the same tag rather than duplicating', async () => {
    await recordInstallation(entry);
    await recordInstallation({ ...entry, dir: '/models/moved' });
    const all = (await loadSettings()).installations;
    expect(all).toHaveLength(1);
    expect(all[0].dir).toBe('/models/moved');
  });

  it('keeps unrelated records when adding a new tag', async () => {
    await recordInstallation(entry);
    await recordInstallation({ ...entry, tag: 'other:q8' });
    expect((await loadSettings()).installations.map((i) => i.tag).sort())
      .toEqual(['demo:q4', 'other:q8']);
  });

  it('forgets only the named tag', async () => {
    await recordInstallation(entry);
    await recordInstallation({ ...entry, tag: 'other:q8' });
    await forgetInstallation('demo:q4');
    expect((await loadSettings()).installations.map((i) => i.tag)).toEqual(['other:q8']);
  });

  it('forgetting an unknown tag is a no-op, not an error', async () => {
    await recordInstallation(entry);
    await forgetInstallation('never-installed:q2');
    expect((await loadSettings()).installations).toHaveLength(1);
  });

  it('findInstallation returns null for an unknown tag', async () => {
    expect(await findInstallation('nope:q1')).toBeNull();
  });
});
