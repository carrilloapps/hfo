import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// detectAvailableTargets probes `ollama launch --help` for the delegated
// targets and resolves a binary for the direct ones; runLaunch's ollama path
// shells out. Stub both so every branch is reachable without Ollama, `agy` or
// `kiro-cli` installed.
const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa }));

const resolveBinary = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/platform.js', async (orig) => {
  const actual = await orig<typeof import('../src/infra/platform.js')>();
  return { ...actual, resolveBinary };
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectAvailableTargets,
  runLaunch,
  LAUNCH_TARGETS,
  runnerFor,
} from '../src/core/launch.js';

const OLLAMA_IDS = LAUNCH_TARGETS
  .filter((t) => runnerFor(t).kind === 'ollama')
  .map((t) => t.id);
const DIRECT_IDS = LAUNCH_TARGETS
  .filter((t) => runnerFor(t).kind === 'direct')
  .map((t) => t.id);

const HELP = `Usage: ollama launch <integration>\n\n${OLLAMA_IDS.map((id) => `  ${id}   description`).join('\n')}\n`;

const saved: Record<string, string | undefined> = {};
let sandbox: string;

// runLaunch writes a launch manifest through configDir(). Point every variable
// configDir() consults at a temp sandbox for the whole file, so a manifest can
// never land in the working directory (which is the repo when tests run).
const CONFIG_ENV = ['APPDATA', 'HOME', 'XDG_CONFIG_HOME', 'USERPROFILE', 'OLLAMA_HOST'] as const;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-launchdetect-'));
  execa.mockReset().mockResolvedValue({ stdout: HELP, exitCode: 0 });
  resolveBinary.mockReset().mockResolvedValue(null);
  for (const k of CONFIG_ENV) saved[k] = process.env[k];
  for (const k of CONFIG_ENV) if (k !== 'OLLAMA_HOST') process.env[k] = sandbox;
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

describe('detectAvailableTargets', () => {
  it('lists the Ollama integrations named in the help output', async () => {
    const ids = await detectAvailableTargets();
    for (const id of OLLAMA_IDS) expect(ids, id).toContain(id);
  });

  it('omits an Ollama integration the installed version does not mention', async () => {
    execa.mockResolvedValue({ stdout: '  claude   Anthropic\n  codex   OpenAI\n' });
    const ids = await detectAvailableTargets();
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
    expect(ids).not.toContain('openclaw');
  });

  it('assumes every integration works when the help output is unparseable', async () => {
    execa.mockResolvedValue({ stdout: 'no recognisable target list here' });
    const ids = await detectAvailableTargets();
    for (const id of OLLAMA_IDS) expect(ids, id).toContain(id);
  });

  it('assumes every integration works when ollama is missing entirely', async () => {
    execa.mockRejectedValue(new Error('ENOENT'));
    const ids = await detectAvailableTargets();
    for (const id of OLLAMA_IDS) expect(ids, id).toContain(id);
  });

  it('excludes direct targets whose binary does not resolve', async () => {
    resolveBinary.mockResolvedValue(null);
    const ids = await detectAvailableTargets();
    for (const id of DIRECT_IDS) expect(ids, id).not.toContain(id);
  });

  it('includes direct targets whose binary resolves', async () => {
    resolveBinary.mockResolvedValue('/usr/local/bin/whatever');
    const ids = await detectAvailableTargets();
    for (const id of DIRECT_IDS) expect(ids, id).toContain(id);
  });

  it('probes direct targets even when Ollama is absent', async () => {
    execa.mockRejectedValue(new Error('ENOENT'));
    resolveBinary.mockResolvedValue('/usr/local/bin/agy');
    expect(await detectAvailableTargets()).toContain('antigravity');
  });

  it('returns ids in registry order, not probe order', async () => {
    resolveBinary.mockResolvedValue('/bin/x');
    const ids = await detectAvailableTargets();
    const registryOrder = LAUNCH_TARGETS.map((t) => t.id).filter((id) => ids.includes(id));
    expect(ids).toEqual(registryOrder);
  });
});

describe('runLaunch via the ollama runner', () => {
  it('delegates to `ollama launch <id>` and returns its exit code', async () => {
    execa.mockResolvedValue({ exitCode: 0 });
    expect(await runLaunch('claude')).toBe(0);
    expect(execa).toHaveBeenCalledWith(
      'ollama',
      ['launch', 'claude'],
      { stdio: 'inherit', reject: false },
    );
  });

  it('forwards the model flag', async () => {
    execa.mockResolvedValue({ exitCode: 0 });
    await runLaunch('codex', { model: 'llama3.1:8b' });
    expect(execa).toHaveBeenCalledWith(
      'ollama',
      ['launch', 'codex', '--model', 'llama3.1:8b'],
      expect.anything(),
    );
  });

  it('propagates a non-zero exit code', async () => {
    execa.mockResolvedValue({ exitCode: 3 });
    expect(await runLaunch('claude')).toBe(3);
  });

  it('maps a null exit code to -1', async () => {
    execa.mockResolvedValue({ exitCode: null });
    expect(await runLaunch('claude')).toBe(-1);
  });

  it('honours OLLAMA_HOST when building the hint', async () => {
    process.env.OLLAMA_HOST = 'http://10.0.0.5:11434';
    execa.mockResolvedValue({ exitCode: 0 });
    await runLaunch('claude');
    const printed = (process.stdout.write as unknown as { mock: { calls: string[][] } })
      .mock.calls.map((c) => c[0]).join('');
    expect(printed).toContain('http://10.0.0.5:11434');
  });

  it('still launches when the manifest cannot be written', async () => {
    // A config dir that cannot be created must not block the handoff. Point at
    // a child of a regular file, which mkdir refuses on every platform — and
    // which stays inside the sandbox, so nothing can land in the repo.
    await writeFile(join(sandbox, 'a-file'), 'x');
    const blocked = join(sandbox, 'a-file', 'nested');
    for (const k of ['APPDATA', 'HOME', 'XDG_CONFIG_HOME', 'USERPROFILE']) {
      process.env[k] = blocked;
    }
    execa.mockResolvedValue({ exitCode: 0 });
    expect(await runLaunch('claude')).toBe(0);
  });
});
