import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa }));

const resolveBinary = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/platform.js', async (orig) => {
  const actual = await orig<typeof import('../src/infra/platform.js')>();
  return { ...actual, resolveBinary };
});

import {
  runLaunch,
  detectAvailableTargets,
  LAUNCH_TARGETS,
  type LaunchId,
  type LaunchTarget,
} from '../src/core/launch.js';

let sandbox: string;
const CONFIG_ENV = ['APPDATA', 'HOME', 'XDG_CONFIG_HOME', 'USERPROFILE'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-defensive-'));
  for (const k of CONFIG_ENV) { saved[k] = process.env[k]; process.env[k] = sandbox; }
  execa.mockReset().mockResolvedValue({ exitCode: 0, stdout: '' });
  resolveBinary.mockReset().mockResolvedValue('/bin/stub');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  for (const k of CONFIG_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  vi.restoreAllMocks();
  await rm(sandbox, { recursive: true, force: true });
});

/**
 * These cover the guards that exist for ids arriving at runtime rather than
 * from the compile-time union — which is exactly what a user-supplied launch
 * target would be.
 */
describe('runLaunch — an id that is not in the registry', () => {
  it('falls back to the ollama runner and still launches', async () => {
    execa.mockResolvedValue({ exitCode: 0 });
    expect(await runLaunch('not-a-registered-id' as LaunchId)).toBe(0);
    expect(execa).toHaveBeenCalledWith(
      'ollama',
      ['launch', 'not-a-registered-id'],
      { stdio: 'inherit', reject: false },
    );
  });

  it('does not warn about an Ollama tag for an unknown id', async () => {
    execa.mockResolvedValue({ exitCode: 0 });
    await runLaunch('not-a-registered-id' as LaunchId, { model: 'llama3.1:8b' });
    // No target means no vendor-hosted constraint to enforce; the tag rides along.
    expect(execa).toHaveBeenCalledWith(
      'ollama',
      ['launch', 'not-a-registered-id', '--model', 'llama3.1:8b'],
      expect.anything(),
    );
  });
});

describe('runLaunch — direct target edge cases', () => {
  const original = new Map<string, LaunchTarget>();

  beforeEach(() => {
    for (const t of LAUNCH_TARGETS) original.set(t.id, { ...t });
  });
  afterEach(() => {
    // Restore the registry entries these tests mutate.
    for (const t of LAUNCH_TARGETS) {
      const o = original.get(t.id);
      if (o) Object.assign(t, o);
    }
  });

  it('omits the install hint when the target declares no docs URL', async () => {
    const target = LAUNCH_TARGETS.find((t) => t.id === 'kiro')!;
    target.docsUrl = undefined;
    resolveBinary.mockResolvedValue(null);

    expect(await runLaunch('kiro')).toBe(127);
    const printed = (process.stderr.write as unknown as { mock: { calls: string[][] } })
      .mock.calls.map((c) => c[0]).join('');
    expect(printed).toContain('is not installed');
    expect(printed).not.toContain('Install it from');
  });

  it('maps a null exit code from the vendor CLI to -1', async () => {
    resolveBinary.mockResolvedValue('/bin/agy');
    execa.mockResolvedValue({ exitCode: null });
    expect(await runLaunch('antigravity')).toBe(-1);
  });
});

describe('detectAvailableTargets — a direct target with no fallback paths', () => {
  const original = new Map<string, LaunchTarget>();

  beforeEach(() => {
    for (const t of LAUNCH_TARGETS) original.set(t.id, { ...t });
  });
  afterEach(() => {
    for (const t of LAUNCH_TARGETS) {
      const o = original.get(t.id);
      if (o) Object.assign(t, o);
    }
  });

  it('probes with an empty candidate list when the runner declares none', async () => {
    const target = LAUNCH_TARGETS.find((t) => t.id === 'kiro')!;
    // A user-supplied target need not list installer locations.
    target.runner = { kind: 'direct', bin: 'kiro-cli' };
    resolveBinary.mockResolvedValue('/usr/bin/kiro-cli');

    const ids = await detectAvailableTargets();
    expect(ids).toContain('kiro');
    expect(resolveBinary).toHaveBeenCalledWith('kiro-cli', []);
  });
});
