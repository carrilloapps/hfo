import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HardwareProfile } from '../src/core/hardware.js';

// headless.ts is the plain-text shell: it orchestrates the core modules and
// prints. Every collaborator is stubbed so the assertions are about what the
// user sees and which calls are made, not about the host machine.
const h = vi.hoisted(() => ({
  checkOllama: vi.fn(),
  detectHardware: vi.fn(),
  sampleGpu: vi.fn(),
  sampleRam: vi.fn(),
  sampleOllamaList: vi.fn(),
  sampleOllamaPs: vi.fn(),
  loadSettings: vi.fn(),
  findInstallation: vi.fn(),
  forgetInstallation: vi.fn(),
  inspectInstallDir: vi.fn(),
  backupDirectory: vi.fn(),
  resolveBackupRoot: vi.fn(),
  restoreBackup: vi.fn(),
  readBackupManifest: vi.fn(),
  persistEnv: vi.fn(),
  restartOllama: vi.fn(),
  execa: vi.fn(),
  runBench: vi.fn(),
  detectAvailableTargets: vi.fn(),
  allLaunchTargets: vi.fn(),
}));

vi.mock('../src/infra/ollama.js', async (orig) => {
  const actual = await orig<typeof import('../src/infra/ollama.js')>();
  return {
    ...actual,
    checkOllama: h.checkOllama,
    persistEnv: h.persistEnv,
    restartOllama: h.restartOllama,
  };
});
vi.mock('../src/core/hardware.js', async (orig) => {
  const actual = await orig<typeof import('../src/core/hardware.js')>();
  return { ...actual, detectHardware: h.detectHardware };
});
vi.mock('../src/core/live.js', () => ({
  sampleGpu: h.sampleGpu,
  sampleRam: h.sampleRam,
  sampleOllamaList: h.sampleOllamaList,
  sampleOllamaPs: h.sampleOllamaPs,
}));
vi.mock('../src/infra/settings.js', async (orig) => {
  const actual = await orig<typeof import('../src/infra/settings.js')>();
  return {
    ...actual,
    loadSettings: h.loadSettings,
    findInstallation: h.findInstallation,
    forgetInstallation: h.forgetInstallation,
  };
});
vi.mock('../src/core/reinstall.js', () => ({ inspectInstallDir: h.inspectInstallDir }));
vi.mock('../src/core/backup.js', () => ({
  backupDirectory: h.backupDirectory,
  resolveBackupRoot: h.resolveBackupRoot,
}));
vi.mock('../src/core/restore.js', () => ({
  restoreBackup: h.restoreBackup,
  readBackupManifest: h.readBackupManifest,
}));
vi.mock('execa', () => ({ execa: h.execa }));
vi.mock('../src/core/bench.js', () => ({ runBench: h.runBench }));
vi.mock('../src/core/launch.js', async (orig) => {
  const actual = await orig<typeof import('../src/core/launch.js')>();
  return {
    ...actual,
    detectAvailableTargets: h.detectAvailableTargets,
    allLaunchTargets: h.allLaunchTargets,
  };
});

import {
  cmdView,
  cmdList,
  cmdLaunchTargets,
  cmdTune,
  cmdBackup,
  cmdRestore,
  cmdDelete,
  cmdVersion,
  cmdBench,
} from '../src/headless.js';

const HW: HardwareProfile = {
  gpuName: 'RTX 4090',
  vramMiB: 24576,
  ramMiB: 65536,
  cpuCores: 16,
  platform: 'linux',
  unifiedMemory: false,
};

const MAC: HardwareProfile = {
  gpuName: 'Apple M3 Max',
  vramMiB: 49152,
  ramMiB: 65536,
  cpuCores: 14,
  platform: 'darwin',
  unifiedMemory: true,
};

let out: string[];
let err: string[];
let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-headless-test-'));
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  for (const fn of Object.values(h)) fn.mockReset();
  h.loadSettings.mockResolvedValue({ language: 'en', installations: [] });
  h.detectHardware.mockResolvedValue(HW);
  h.checkOllama.mockResolvedValue({ status: 'ok', version: 'ollama version is 0.21.3' });
  h.sampleGpu.mockResolvedValue(null);
  h.sampleRam.mockResolvedValue(null);
  h.sampleOllamaList.mockResolvedValue([]);
  h.sampleOllamaPs.mockResolvedValue([]);
  h.detectAvailableTargets.mockResolvedValue([]);
  h.allLaunchTargets.mockResolvedValue({
    targets: (await import('../src/core/launch.js')).LAUNCH_TARGETS,
    pluginErrors: [],
  });
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await rm(sandbox, { recursive: true, force: true });
});

const text = () => out.join('\n');

describe('cmdView', () => {
  it('prints hardware, capacity, picks and Ollama status', async () => {
    await cmdView();
    const s = text();
    expect(s).toContain('Hardware');
    expect(s).toContain('RTX 4090');
    expect(s).toContain('CPU cores  16');
    expect(s).toContain('Platform   linux');
    expect(s).toContain('Capacity');
    expect(s).toContain('Picks');
    expect(s).toContain('[+] ready');
  });

  it('marks unified memory with a footnote on Apple Silicon', async () => {
    h.detectHardware.mockResolvedValue(MAC);
    await cmdView();
    const s = text();
    expect(s).toContain('VRAM*');
    expect(s).toContain('unified memory shared with RAM');
  });

  it('prints a plain VRAM label on a discrete GPU', async () => {
    await cmdView();
    expect(text()).toContain('VRAM  ');
    expect(text()).not.toContain('VRAM*');
  });

  it('omits the VRAM line entirely when there is no GPU memory', async () => {
    h.detectHardware.mockResolvedValue({ ...HW, gpuName: null, vramMiB: 0 });
    await cmdView();
    expect(text()).toContain('(no discrete GPU)');
    expect(text()).not.toMatch(/^VRAM/m);
  });

  it('prints the live GPU block when a sample is available', async () => {
    h.sampleGpu.mockResolvedValue({
      name: 'RTX 4090', vramTotalMiB: 24576, vramUsedMiB: 1024,
      vramFreeMiB: 23552, utilPct: 42, tempC: 61, powerW: 120.4,
    });
    await cmdView();
    const s = text();
    expect(s).toContain('Live GPU');
    expect(s).toContain('Utilization   42%');
    expect(s).toContain('Temperature   61');
    expect(s).toContain('120 W');
  });

  it('renders em-dashes for missing live GPU readings', async () => {
    h.sampleGpu.mockResolvedValue({
      name: null, vramTotalMiB: 0, vramUsedMiB: 0, vramFreeMiB: 0,
      utilPct: null, tempC: null, powerW: null,
    });
    await cmdView();
    const s = text();
    expect(s).toContain('Utilization   —%');
    expect(s).toContain('Power         —');
  });

  it('prints the live RAM block when a sample is available', async () => {
    h.sampleRam.mockResolvedValue({ totalMiB: 65536, usedMiB: 32768, freeMiB: 32768, usedPct: 50 });
    await cmdView();
    expect(text()).toContain('Live RAM');
    expect(text()).toContain('(50%)');
  });

  it('reports a binary-present-but-server-down Ollama', async () => {
    h.checkOllama.mockResolvedValue({ status: 'no-server', version: 'v' });
    await cmdView();
    expect(text()).toContain('server offline');
  });

  it('reports a missing Ollama binary', async () => {
    h.checkOllama.mockResolvedValue({ status: 'no-binary', error: 'ENOENT' });
    await cmdView();
    expect(text()).toContain('binary not found');
  });

  it('still renders when settings cannot be loaded', async () => {
    h.loadSettings.mockRejectedValue(new Error('unreadable'));
    await cmdView();
    expect(text()).toContain('Hardware');
  });

  it('ignores settings without a language field', async () => {
    h.loadSettings.mockResolvedValue({ installations: [] });
    await cmdView();
    expect(text()).toContain('Hardware');
  });
});

describe('cmdList', () => {
  it('reports none on both sides when nothing is installed', async () => {
    await cmdList();
    const s = text();
    expect(s).toContain('Installed (0)');
    expect(s).toContain('Available to reinstall (0)');
    expect(s.match(/\(none\)/g)).toHaveLength(2);
  });

  it('lists registered models and marks the loaded ones', async () => {
    h.sampleOllamaList.mockResolvedValue([
      { name: 'llama3.1:8b', id: 'a', size: '5 GB', modified: '2 days ago' },
      { name: 'qwen2.5:7b', id: 'b', size: '4 GB', modified: '1 week ago' },
    ]);
    h.sampleOllamaPs.mockResolvedValue([
      { name: 'llama3.1:8b', id: 'a', size: '5 GB', processor: 'GPU', until: 'soon' },
    ]);
    await cmdList();
    const s = text();
    expect(s).toContain('Installed (2)');
    expect(s).toContain('[loaded]');
    expect(s).toContain('[idle]');
  });

  it('lists orphans with their on-disk state', async () => {
    h.loadSettings.mockResolvedValue({
      language: 'en',
      installations: [{ tag: 'gone:q4', dir: '/m/gone', repoId: 'o/r', quant: 'Q4', installedAt: '' }],
    });
    h.inspectInstallDir.mockResolvedValue({ kind: 'ready', gguf: 'm.gguf', modelfile: 'Modelfile' });
    await cmdList();
    const s = text();
    expect(s).toContain('Available to reinstall (1)');
    expect(s).toContain('gone:q4');
    expect(s).toContain('ready (Modelfile present)');
  });

  it.each([
    ['needs-generation', 'will generate Modelfile'],
    ['missing-gguf', 'no gguf in folder'],
    ['missing-dir', 'folder gone'],
  ])('describes the %s orphan state', async (kind, label) => {
    h.loadSettings.mockResolvedValue({
      language: 'en',
      installations: [{ tag: 'o:q4', dir: '/m/o', repoId: 'o/r', quant: '', installedAt: '' }],
    });
    h.inspectInstallDir.mockResolvedValue({ kind });
    await cmdList();
    expect(text()).toContain(label);
  });

  it('does not list a tag that Ollama still has registered', async () => {
    h.sampleOllamaList.mockResolvedValue([{ name: 'here:q4', id: 'a', size: '1', modified: 'x' }]);
    h.loadSettings.mockResolvedValue({
      language: 'en',
      installations: [{ tag: 'here:q4', dir: '/m/h', repoId: 'o/r', quant: 'Q4', installedAt: '' }],
    });
    await cmdList();
    expect(text()).toContain('Available to reinstall (0)');
  });
});

describe('cmdLaunchTargets', () => {
  it('prints every target with its runner and local status', async () => {
    h.detectAvailableTargets.mockResolvedValue(['claude', 'antigravity']);
    await cmdLaunchTargets();
    const s = text();
    expect(s).toContain('Launch targets');
    expect(s).toContain('claude');
    expect(s).toContain('ollama launch');
    expect(s).toContain('antigravity');
    expect(s).toContain('agy');
    expect(s).toContain('available');
  });

  it('says "not installed" for a missing direct target and "unsupported" for an Ollama one', async () => {
    h.detectAvailableTargets.mockResolvedValue([]);
    await cmdLaunchTargets();
    const s = text();
    expect(s).toContain('not installed');
    expect(s).toContain('unsupported by this Ollama');
  });

  it('warns that vendor-hosted agents cannot bind an Ollama tag', async () => {
    h.detectAvailableTargets.mockResolvedValue(['kiro']);
    await cmdLaunchTargets();
    expect(text()).toContain('vendor-hosted models only');
  });

  it('lists user-registered plugin targets alongside the built-ins', async () => {
    const { LAUNCH_TARGETS } = await import('../src/core/launch.js');
    h.allLaunchTargets.mockResolvedValue({
      targets: [...LAUNCH_TARGETS, {
        id: 'myagent',
        name: 'My Agent',
        description: 'In-house',
        runner: { kind: 'direct', bin: 'myagent' },
      }],
      pluginErrors: [],
    });
    h.detectAvailableTargets.mockResolvedValue(['myagent']);
    await cmdLaunchTargets();
    const s = text();
    expect(s).toContain(`Launch targets (${LAUNCH_TARGETS.length + 1})`);
    expect(s).toContain('myagent');
    expect(s).toContain('My Agent');
  });

  it('reports plugin problems and exits non-zero', async () => {
    const { LAUNCH_TARGETS } = await import('../src/core/launch.js');
    h.allLaunchTargets.mockResolvedValue({
      targets: LAUNCH_TARGETS,
      pluginErrors: ['target "claude": already used by a built-in target'],
    });
    await cmdLaunchTargets();
    expect(text()).toContain('Plugin problems');
    expect(err.join(' | ')).toContain('already used by a built-in target');
    expect(text()).toContain('Fix them in');
    expect(process.exitCode).toBe(1);
  });
});

describe('cmdTune', () => {
  it('prints the profile, the per-key result and the restart outcome', async () => {
    h.persistEnv.mockResolvedValue([
      { key: 'OLLAMA_FLASH_ATTENTION', value: '1', applied: true, method: 'setx' },
    ]);
    h.restartOllama.mockResolvedValue({ ok: true, note: 'restarted' });
    await cmdTune();
    const s = text();
    expect(s).toContain('OLLAMA_FLASH_ATTENTION=1');
    expect(s).toContain('[+] OLLAMA_FLASH_ATTENTION via setx');
    expect(s).toContain('[+] restarted');
  });

  it('marks a failed key and shows its note', async () => {
    h.persistEnv.mockResolvedValue([
      { key: 'OLLAMA_MAX_QUEUE', value: '256', applied: false, method: 'setx', note: 'denied' },
    ]);
    h.restartOllama.mockResolvedValue({ ok: false, note: 'manual restart needed' });
    await cmdTune();
    const s = text();
    expect(s).toContain('[x] OLLAMA_MAX_QUEUE via setx (denied)');
    expect(s).toContain('[!] manual restart needed');
  });
});

describe('cmdBackup', () => {
  it('throws a helpful error when the tag has no installation record', async () => {
    h.findInstallation.mockResolvedValue(null);
    await expect(cmdBackup('unknown:q4')).rejects.toThrow('No installation record for "unknown:q4"');
  });

  it('reports the archive, its size and the manifest path', async () => {
    h.findInstallation.mockResolvedValue({
      tag: 'demo:q4', dir: '/m/demo', repoId: 'o/r', quant: 'Q4_K_M', installedAt: '',
    });
    h.resolveBackupRoot.mockReturnValue('/backups');
    h.backupDirectory.mockResolvedValue({
      zipPath: '/backups/demo.zip',
      metadataPath: '/backups/demo.metadata.json',
      originalBytes: 1000,
      compressedBytes: 400,
    });
    await cmdBackup('demo:q4');
    const s = text();
    expect(s).toContain('/backups/demo.zip');
    expect(s).toContain('40.0% of original');
    expect(s).toContain('demo.metadata.json');
  });

  it('avoids dividing by zero when the source was empty', async () => {
    h.findInstallation.mockResolvedValue({
      tag: 'e:q4', dir: '/m/e', repoId: 'o/r', quant: 'Q4', installedAt: '',
    });
    h.resolveBackupRoot.mockReturnValue('/backups');
    h.backupDirectory.mockResolvedValue({
      zipPath: '/b/e.zip', metadataPath: '/b/e.json', originalBytes: 0, compressedBytes: 0,
    });
    await cmdBackup('e:q4');
    expect(text()).toContain('0.0% of original');
  });

  it('forwards progress updates to stdout', async () => {
    h.findInstallation.mockResolvedValue({
      tag: 'p:q4', dir: '/m/p', repoId: 'o/r', quant: 'Q4', installedAt: '',
    });
    h.resolveBackupRoot.mockReturnValue('/backups');
    h.backupDirectory.mockImplementation(async (_s: unknown, _r: unknown, onProgress: (p: unknown) => void) => {
      onProgress({ processedBytes: 50, totalBytes: 100, fileCount: 2, currentFile: 'a.gguf' });
      return { zipPath: '/b/p.zip', metadataPath: '/b/p.json', originalBytes: 100, compressedBytes: 50 };
    });
    await cmdBackup('p:q4');
    expect(process.stdout.write).toHaveBeenCalled();
  });
});

describe('cmdRestore', () => {
  it('prints the manifest details when one is present', async () => {
    h.readBackupManifest.mockResolvedValue({
      tag: 'demo:q4', repoId: 'o/r', quant: 'Q4_K_M',
      createdAtIso: '2026-01-01T00:00:00.000Z', sourceDir: '/m/demo',
    });
    h.restoreBackup.mockResolvedValue({
      tag: 'demo:q4', restoredTo: '/m/demo', modelfileGenerated: false, manifest: null,
    });
    await cmdRestore('/b/demo.zip');
    const s = text();
    expect(s).toContain('Tag:    demo:q4');
    expect(s).toContain('Quant:  Q4_K_M');
    expect(s).toContain('Extracted to /m/demo');
    expect(s).not.toContain('Modelfile synthesized');
  });

  it('renders em-dashes for manifest fields that are null', async () => {
    h.readBackupManifest.mockResolvedValue({
      tag: 't', repoId: null, quant: null, createdAtIso: 'x', sourceDir: '/d',
    });
    h.restoreBackup.mockResolvedValue({ tag: 't', restoredTo: '/d', modelfileGenerated: true, manifest: null });
    await cmdRestore('/b/x.zip');
    const s = text();
    expect(s).toContain('Repo:   —');
    expect(s).toContain('Quant:  —');
    expect(s).toContain('(Modelfile synthesized)');
  });

  it('says so when the zip carries no manifest', async () => {
    h.readBackupManifest.mockResolvedValue(null);
    h.restoreBackup.mockResolvedValue({
      tag: 'unknown', restoredTo: '/d', modelfileGenerated: false, manifest: null,
    });
    await cmdRestore('/b/bare.zip');
    expect(text()).toContain('no manifest found');
  });
});

describe('cmdDelete', () => {
  it('removes the tag from Ollama and forgets the record', async () => {
    h.execa.mockResolvedValue({ stdout: '' });
    await cmdDelete('demo:q4', {});
    expect(h.execa).toHaveBeenCalledWith('ollama', ['rm', 'demo:q4']);
    expect(h.forgetInstallation).toHaveBeenCalledWith('demo:q4');
    expect(process.exitCode).toBeUndefined();
  });

  it('sets a failing exit code and stops when ollama rm fails', async () => {
    h.execa.mockRejectedValue(new Error('no such model'));
    await cmdDelete('ghost:q4', {});
    expect(err.join('\n')).toContain('ollama rm failed: no such model');
    expect(process.exitCode).toBe(1);
    expect(h.forgetInstallation).not.toHaveBeenCalled();
  });

  it('deep delete removes the tracked directory', async () => {
    h.execa.mockResolvedValue({ stdout: '' });
    h.findInstallation.mockResolvedValue({
      tag: 'd:q4', dir: join(sandbox, 'model'), repoId: 'o/r', quant: 'Q4', installedAt: '',
    });
    await cmdDelete('d:q4', { deep: true });
    expect(text()).toContain('removed directory');
  });

  it('deep delete reports when there is no record to act on', async () => {
    h.execa.mockResolvedValue({ stdout: '' });
    h.findInstallation.mockResolvedValue(null);
    await cmdDelete('d:q4', { deep: true });
    expect(text()).toContain('nothing on disk to remove');
  });

  it('deep delete warns but continues when the directory cannot be removed', async () => {
    h.execa.mockResolvedValue({ stdout: '' });
    h.findInstallation.mockResolvedValue({
      tag: 'd:q4', dir: '\0invalid', repoId: 'o/r', quant: 'Q4', installedAt: '',
    });
    await cmdDelete('d:q4', { deep: true });
    expect(err.join('\n')).toContain('could not remove');
    expect(h.forgetInstallation).toHaveBeenCalled();
  });

  it('stringifies a non-Error rm failure', async () => {
    h.execa.mockRejectedValue('plain string');
    await cmdDelete('x:q4', {});
    expect(err.join('\n')).toContain('plain string');
  });
});

describe('cmdVersion', () => {
  it('prints the binary name, version, licence and author', () => {
    cmdVersion();
    const s = text();
    expect(s).toContain('hfo v');
    expect(s).toContain('MIT');
  });
});

describe('cmdBench', () => {
  const report = {
    runs: [
      { id: 'short', outputTokens: 120, ttftMs: 80, totalMs: 1500, tokensPerSec: 80 },
      { id: 'long', outputTokens: 500, ttftMs: 95, totalMs: 6000, tokensPerSec: 83.3 },
    ],
    aggregate: { tokensPerSec: 81.6, ttftMs: 87.5, totalTokens: 620, totalMs: 7500 },
  };

  it('refuses to run when Ollama is unreachable', async () => {
    h.checkOllama.mockResolvedValue({ status: 'no-server', version: 'v' });
    await cmdBench('demo:q4');
    expect(err.join('\n')).toContain('Ollama is not reachable (no-server)');
    expect(process.exitCode).toBe(1);
    expect(h.runBench).not.toHaveBeenCalled();
  });

  it('prints per-prompt and aggregate results', async () => {
    h.runBench.mockResolvedValue(report);
    await cmdBench('demo:q4');
    const s = text();
    expect(s).toContain('Benchmarking demo:q4');
    expect(s).toContain('short');
    expect(s).toContain('Aggregate');
    expect(s).toContain('81.6 tok/s avg');
    expect(s).toContain('620 total output tokens in 7.5 s');
  });

  it('marks unified memory in the bench header on Apple Silicon', async () => {
    h.detectHardware.mockResolvedValue(MAC);
    h.runBench.mockResolvedValue(report);
    await cmdBench('demo:q4');
    expect(text()).toContain('unified memory shared with RAM');
  });

  it('omits the VRAM line when there is no GPU memory', async () => {
    h.detectHardware.mockResolvedValue({ ...HW, gpuName: null, vramMiB: 0 });
    h.runBench.mockResolvedValue(report);
    await cmdBench('demo:q4');
    expect(text()).toContain('(no discrete GPU)');
  });

  it('falls back to "unknown" when Ollama reports no version', async () => {
    h.checkOllama.mockResolvedValue({ status: 'ok' });
    h.runBench.mockResolvedValue(report);
    await cmdBench('demo:q4');
    expect(text()).toContain('Ollama     unknown');
  });

  it('sets a failing exit code when the bench throws', async () => {
    h.runBench.mockRejectedValue(new Error('model not found'));
    await cmdBench('demo:q4');
    expect(err.join('\n')).toContain('Bench failed: model not found');
    expect(process.exitCode).toBe(1);
  });

  it('stringifies a non-Error bench failure', async () => {
    h.runBench.mockRejectedValue('exploded');
    await cmdBench('demo:q4');
    expect(err.join('\n')).toContain('exploded');
  });

  it('writes the submission file when --out is given', async () => {
    h.runBench.mockResolvedValue(report);
    const outPath = join(sandbox, 'bench.json');
    await cmdBench('demo:q4', { out: outPath });
    expect(JSON.parse(await readFile(outPath, 'utf8')).aggregate.totalTokens).toBe(620);
    expect(text()).toContain('Saved');
  });
});
