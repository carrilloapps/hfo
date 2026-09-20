import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAUNCH_TARGETS, runLaunch, type LaunchTarget } from '../src/core/launch.js';
import { agentManifestPath } from '../src/core/agentConfig.js';

/**
 * Proves the `direct` runner actually reaches execa with the argv
 * buildDirectArgs produced — the one link between the pure arg builder and a
 * real child process. A throwaway Node script stands in for the vendor CLI so
 * the test needs neither `agy` nor `kiro-cli` installed.
 */
let sandbox: string;
let argvDump: string;
let prevHome: string | undefined;
let prevAppData: string | undefined;
let prevXdg: string | undefined;

const STUB_ID = 'antigravity'; // reuse a real direct id so ollamaBackend/modelFlag apply

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-run-test-'));
  argvDump = join(sandbox, 'argv.json');

  // Manifest writes resolve through configDir() — keep them in the sandbox.
  prevHome = process.env.HOME; prevAppData = process.env.APPDATA; prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = sandbox; process.env.APPDATA = sandbox; process.env.XDG_CONFIG_HOME = sandbox;

  const stub = join(sandbox, 'stub.mjs');
  await writeFile(
    stub,
    `import { writeFileSync } from 'node:fs';\n` +
      `writeFileSync(${JSON.stringify(argvDump)}, JSON.stringify(process.argv.slice(2)));\n`,
    'utf8',
  );

  // Point the real target at `node <stub>` for the duration of the test.
  const target = LAUNCH_TARGETS.find((t) => t.id === STUB_ID) as LaunchTarget;
  (target as { runner?: unknown }).runner = {
    kind: 'direct',
    bin: process.execPath,
    args: [stub],
  };
});

afterEach(async () => {
  const target = LAUNCH_TARGETS.find((t) => t.id === STUB_ID) as LaunchTarget;
  (target as { runner?: unknown }).runner = {
    kind: 'direct',
    bin: 'agy',
    fallbackPaths: ['~/.local/bin/agy', '%LOCALAPPDATA%/agy/bin/agy.exe', '%LOCALAPPDATA%/agy/bin/agy'],
  };
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(sandbox, { recursive: true, force: true });
});

describe('runLaunch with a direct runner', () => {
  it('spawns the vendor binary and forwards a vendor model id', async () => {
    const code = await runLaunch(STUB_ID, { model: 'gemini-3.1-pro-high' });
    expect(code).toBe(0);
    expect(JSON.parse(await readFile(argvDump, 'utf8'))).toEqual([
      '--model', 'gemini-3.1-pro-high',
    ]);
  });

  it('drops an Ollama tag instead of forwarding it to the child', async () => {
    const code = await runLaunch(STUB_ID, { model: 'llama3.1:8b' });
    expect(code).toBe(0);
    expect(JSON.parse(await readFile(argvDump, 'utf8'))).toEqual([]);
  });

  it('records the dropped tag as an unbound launch in the manifest', async () => {
    await runLaunch(STUB_ID, { model: 'llama3.1:8b' });
    const manifest = JSON.parse(await readFile(agentManifestPath(STUB_ID), 'utf8'));
    expect(manifest.model).toBeNull();
  });

  it('keeps a vendor model id in the manifest', async () => {
    await runLaunch(STUB_ID, { model: 'gemini-3.1-pro-high' });
    const manifest = JSON.parse(await readFile(agentManifestPath(STUB_ID), 'utf8'));
    expect(manifest.model).toBe('gemini-3.1-pro-high');
  });

  it('exits 127 when the vendor binary cannot be resolved', async () => {
    const target = LAUNCH_TARGETS.find((t) => t.id === STUB_ID) as LaunchTarget;
    (target as { runner?: unknown }).runner = {
      kind: 'direct',
      bin: 'hfo-definitely-not-a-real-binary-xyz',
    };
    expect(await runLaunch(STUB_ID)).toBe(127);
  });
});
