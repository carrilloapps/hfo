import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ollama.ts is pure OS integration: it shells out, branches on platform() and
// writes to the user's shell rc files. Stub execa and os so every branch can be
// driven from any host, and point homedir() at a sandbox so the rc-file writes
// land somewhere disposable.
const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa }));

const state = vi.hoisted(() => ({ platform: 'linux' as NodeJS.Platform, home: '' }));
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, platform: () => state.platform, homedir: () => state.home };
});

import {
  checkOllama,
  writeSystemdOverride,
  SYSTEMD_OVERRIDE_DIR,
  ollamaCreate,
  ollamaList,
  planInstall,
  runInstall,
  buildEnvProfile,
  defaultEnvProfile,
  readCurrentEnv,
  persistEnv,
  restartOllama,
  ENV_VAR_META,
  type EnvKey,
  type EnvProfile,
} from '../src/infra/ollama.js';

let sandbox: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-ollama-test-'));
  state.home = sandbox;
  state.platform = 'linux';
  execa.mockReset();
  execa.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  for (const k of Object.keys(ENV_VAR_META)) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.unstubAllGlobals();
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
  await rm(sandbox, { recursive: true, force: true });
});

describe('checkOllama', () => {
  it('reports ok when the binary runs and the daemon answers', async () => {
    execa.mockResolvedValue({ stdout: 'ollama version is 0.21.3' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect(await checkOllama()).toEqual({ status: 'ok', version: 'ollama version is 0.21.3' });
  });

  it('picks the version line out of multi-line output', async () => {
    execa.mockResolvedValue({ stdout: 'warning: something\nollama version is 0.21.3\n' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect((await checkOllama()).version).toBe('ollama version is 0.21.3');
  });

  it('falls back to the whole stdout when no line mentions a version', async () => {
    execa.mockResolvedValue({ stdout: '  0.21.3  ' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect((await checkOllama()).version).toBe('0.21.3');
  });

  it('reports no-server when the daemon returns a non-ok response', async () => {
    execa.mockResolvedValue({ stdout: 'ollama version is 0.21.3' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await checkOllama()).toEqual({ status: 'no-server', version: 'ollama version is 0.21.3' });
  });

  it('reports no-server when the daemon connection throws', async () => {
    execa.mockResolvedValue({ stdout: 'ollama version is 0.21.3' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect((await checkOllama()).status).toBe('no-server');
  });

  it('reports no-binary with the error message when ollama is not installed', async () => {
    execa.mockRejectedValue(new Error('spawn ollama ENOENT'));
    expect(await checkOllama()).toEqual({ status: 'no-binary', error: 'spawn ollama ENOENT' });
  });

  it('stringifies a non-Error rejection', async () => {
    execa.mockRejectedValue('boom');
    expect(await checkOllama()).toEqual({ status: 'no-binary', error: 'boom' });
  });
});

describe('ollamaCreate', () => {
  it('runs ollama create in the given cwd and returns stdout', async () => {
    execa.mockResolvedValue({ stdout: 'success', stderr: '', exitCode: 0 });
    expect(await ollamaCreate('demo:q4', '/m/Modelfile', '/m')).toBe('success');
    expect(execa).toHaveBeenCalledWith(
      'ollama',
      ['create', 'demo:q4', '-f', '/m/Modelfile'],
      { cwd: '/m', reject: false },
    );
  });

  it('throws with stderr when the exit code is non-zero', async () => {
    execa.mockResolvedValue({ stdout: '', stderr: 'bad Modelfile', exitCode: 1 });
    await expect(ollamaCreate('demo:q4', '/m/Modelfile', '/m'))
      .rejects.toThrow('ollama create failed (exit 1): bad Modelfile');
  });

  it('falls back to stdout in the error when stderr is empty', async () => {
    execa.mockResolvedValue({ stdout: 'something went wrong', stderr: '', exitCode: 2 });
    await expect(ollamaCreate('t', 'f', '.')).rejects.toThrow('something went wrong');
  });
});

describe('ollamaList', () => {
  it('returns the tag column, skipping the header', async () => {
    execa.mockResolvedValue({
      stdout: 'NAME    ID    SIZE\nllama3.1:8b  abc  5GB\nqwen2.5:7b  def  4GB\n',
    });
    expect(await ollamaList()).toEqual(['llama3.1:8b', 'qwen2.5:7b']);
  });

  it('returns an empty list when only a header is present', async () => {
    execa.mockResolvedValue({ stdout: 'NAME  ID  SIZE\n' });
    expect(await ollamaList()).toEqual([]);
  });

  it('returns an empty list when ollama is missing', async () => {
    execa.mockRejectedValue(new Error('ENOENT'));
    expect(await ollamaList()).toEqual([]);
  });
});

describe('planInstall', () => {
  it('uses winget on Windows', () => {
    state.platform = 'win32';
    const p = planInstall();
    expect(p).toMatchObject({ os: 'win32', method: 'winget', bin: 'winget' });
    expect(p.fallbackUrl).toContain('OllamaSetup.exe');
  });

  it('uses Homebrew on macOS', () => {
    state.platform = 'darwin';
    const p = planInstall();
    expect(p).toMatchObject({ os: 'darwin', method: 'brew', bin: 'brew' });
    expect(p.args).toEqual(['install', '--cask', 'ollama']);
  });

  it('uses the official shell script everywhere else', () => {
    state.platform = 'linux';
    const p = planInstall();
    expect(p).toMatchObject({ os: 'linux', method: 'shell-script', bin: 'sh' });
    expect(p.humanCommand).toContain('install.sh');
  });
});

describe('runInstall', () => {
  function fakeChild(exitCode: number, out: string[], err: string[]) {
    const handlers: Record<string, ((d: Buffer) => void)[]> = { stdout: [], stderr: [] };
    const mk = (key: string) => ({ on: (_e: string, cb: (d: Buffer) => void) => handlers[key].push(cb) });
    const promise: Promise<{ exitCode: number }> & {
      stdout?: unknown; stderr?: unknown;
    } = Object.assign(
      // Emit after the listeners are attached, like a real child process.
      new Promise<{ exitCode: number }>((resolve) => setTimeout(() => {
        out.forEach((l) => handlers.stdout.forEach((cb) => cb(Buffer.from(l))));
        err.forEach((l) => handlers.stderr.forEach((cb) => cb(Buffer.from(l))));
        resolve({ exitCode });
      }, 0)),
      { stdout: mk('stdout'), stderr: mk('stderr') },
    );
    return promise;
  }

  it('streams stdout and stderr lines and reports success', async () => {
    execa.mockReturnValue(fakeChild(0, ['downloading\ninstalling\n'], ['a warning\n']));
    const seen: { line: string; stream: string }[] = [];
    const res = await runInstall(planInstall(), (p) => seen.push(p));
    expect(res).toEqual({ ok: true, exitCode: 0 });
    expect(seen).toEqual([
      { line: 'downloading', stream: 'stdout' },
      { line: 'installing', stream: 'stdout' },
      { line: 'a warning', stream: 'stderr' },
    ]);
  });

  it('reports failure with the child exit code', async () => {
    execa.mockReturnValue(fakeChild(1, [], []));
    expect(await runInstall(planInstall(), () => {})).toEqual({ ok: false, exitCode: 1 });
  });

  it('maps a null exit code to -1', async () => {
    execa.mockReturnValue(fakeChild(null as unknown as number, [], []));
    expect(await runInstall(planInstall(), () => {})).toEqual({ ok: false, exitCode: -1 });
  });

  it('survives a child that exposes no pipes', async () => {
    execa.mockReturnValue(Promise.resolve({ exitCode: 0 }));
    expect(await runInstall(planInstall(), () => {})).toEqual({ ok: true, exitCode: 0 });
  });
});

describe('buildEnvProfile', () => {
  it('allows two parallel requests on a big-VRAM GPU', () => {
    expect(buildEnvProfile({ vramMiB: 24576, ramMiB: 65536 }).OLLAMA_NUM_PARALLEL).toBe('2');
  });

  it('drops to one on a small GPU', () => {
    expect(buildEnvProfile({ vramMiB: 4096, ramMiB: 65536 }).OLLAMA_NUM_PARALLEL).toBe('1');
  });

  it('treats exactly 12 GiB as big', () => {
    expect(buildEnvProfile({ vramMiB: 12 * 1024, ramMiB: 1 }).OLLAMA_NUM_PARALLEL).toBe('2');
  });

  it('sets the flash-attention and cache profile regardless of hardware', () => {
    expect(buildEnvProfile({ vramMiB: 0, ramMiB: 0 })).toMatchObject({
      OLLAMA_FLASH_ATTENTION: '1',
      OLLAMA_KV_CACHE_TYPE: 'q8_0',
      OLLAMA_KEEP_ALIVE: '30m',
      OLLAMA_MAX_LOADED_MODELS: '1',
      OLLAMA_MAX_QUEUE: '256',
    });
  });

  it('accepts an explicit capacity ratio without changing the result today', () => {
    expect(buildEnvProfile({ vramMiB: 8192, ramMiB: 16384 }, 0.5))
      .toEqual(buildEnvProfile({ vramMiB: 8192, ramMiB: 16384 }));
  });
});

describe('defaultEnvProfile', () => {
  it('returns the documented default for every known key', () => {
    const d = defaultEnvProfile();
    for (const k of Object.keys(ENV_VAR_META) as EnvKey[]) {
      expect(d[k], k).toBe(ENV_VAR_META[k].default);
    }
  });
});

describe('readCurrentEnv', () => {
  it('returns only the keys actually set in the environment', async () => {
    process.env.OLLAMA_KEEP_ALIVE = '15m';
    expect(await readCurrentEnv()).toEqual({ OLLAMA_KEEP_ALIVE: '15m' });
  });

  it('ignores keys set to an empty string', async () => {
    process.env.OLLAMA_KEEP_ALIVE = '';
    expect(await readCurrentEnv()).toEqual({});
  });

  it('returns an empty object when nothing is set', async () => {
    expect(await readCurrentEnv()).toEqual({});
  });
});

describe('persistEnv', () => {
  const profile: EnvProfile = buildEnvProfile({ vramMiB: 8192, ramMiB: 16384 });
  const keyCount = Object.keys(profile).length;

  it('uses setx for every key on Windows', async () => {
    state.platform = 'win32';
    const res = await persistEnv(profile);
    expect(res).toHaveLength(keyCount);
    expect(res.every((r) => r.applied && r.method === 'setx')).toBe(true);
    expect(execa).toHaveBeenCalledWith('setx', ['OLLAMA_FLASH_ATTENTION', '1']);
  });

  it('records a per-key failure on Windows without aborting the rest', async () => {
    state.platform = 'win32';
    execa.mockRejectedValueOnce(new Error('access denied'));
    const res = await persistEnv(profile);
    expect(res[0]).toMatchObject({ applied: false, method: 'setx', note: 'access denied' });
    expect(res.slice(1).every((r) => r.applied)).toBe(true);
  });

  it('stringifies a non-Error failure on Windows', async () => {
    state.platform = 'win32';
    execa.mockRejectedValueOnce('nope');
    expect((await persistEnv(profile))[0].note).toBe('nope');
  });

  it('uses launchctl and writes an rc file on macOS', async () => {
    state.platform = 'darwin';
    await writeFile(join(sandbox, '.zprofile'), '# existing\n', 'utf8');
    const res = await persistEnv(profile);
    expect(res.every((r) => r.method === 'launchctl setenv')).toBe(true);
    expect(execa).toHaveBeenCalledWith('launchctl', ['setenv', 'OLLAMA_FLASH_ATTENTION', '1']);
    const rc = await readFile(join(sandbox, '.zprofile'), 'utf8');
    expect(rc).toContain('# >>> hfo: ollama env >>>');
    expect(rc).toContain('export OLLAMA_KEEP_ALIVE="30m"');
  });

  it('records a launchctl failure on macOS', async () => {
    state.platform = 'darwin';
    execa.mockRejectedValueOnce(new Error('launchctl refused'));
    const res = await persistEnv(profile);
    expect(res[0]).toMatchObject({ applied: false, note: 'launchctl refused' });
  });

  it('stringifies a non-Error launchctl failure on macOS', async () => {
    state.platform = 'darwin';
    execa.mockRejectedValueOnce('nope');
    expect((await persistEnv(profile))[0].note).toBe('nope');
  });

  it('writes ~/.profile on Linux and reports every key applied', async () => {
    state.platform = 'linux';
    const res = await persistEnv(profile, { systemdDir: join(sandbox, 'systemd') });
    expect(res.every((r) => r.applied && r.method === '~/.profile')).toBe(true);
    expect(await readFile(join(sandbox, '.profile'), 'utf8'))
      .toContain('export OLLAMA_MAX_QUEUE="256"');
  });

  it('replaces an existing hfo block instead of appending a second one', async () => {
    state.platform = 'linux';
    const systemdDir = join(sandbox, 'systemd');
    await persistEnv(profile, { systemdDir });
    await persistEnv({ ...profile, OLLAMA_KEEP_ALIVE: '90m' }, { systemdDir });
    const rc = await readFile(join(sandbox, '.profile'), 'utf8');
    expect(rc.match(/# >>> hfo: ollama env >>>/g)).toHaveLength(1);
    expect(rc).toContain('export OLLAMA_KEEP_ALIVE="90m"');
  });

  it('replaces a legacy runllama block left by an older version', async () => {
    state.platform = 'linux';
    await writeFile(
      join(sandbox, '.profile'),
      'before\n# >>> runllama: ollama env >>>\nexport OLLAMA_KEEP_ALIVE="1m"\n# <<< runllama: ollama env <<<\nafter\n',
      'utf8',
    );
    await persistEnv(profile, { systemdDir: join(sandbox, 'systemd') });
    const rc = await readFile(join(sandbox, '.profile'), 'utf8');
    expect(rc).not.toContain('runllama');
    expect(rc).toContain('before');
    expect(rc).toContain('after');
    expect(rc.match(/ollama env >>>/g)).toHaveLength(1);
  });

  it('falls back to a later rc candidate when the first does not exist', async () => {
    state.platform = 'darwin';
    // no .zprofile, but a .bash_profile is present
    await writeFile(join(sandbox, '.bash_profile'), 'existing\n', 'utf8');
    await persistEnv(profile);
    expect(await readFile(join(sandbox, '.bash_profile'), 'utf8')).toContain('hfo: ollama env');
  });

  it('creates the first candidate when no rc file exists at all', async () => {
    state.platform = 'linux';
    await persistEnv(profile, { systemdDir: join(sandbox, 'systemd') });
    expect(await readFile(join(sandbox, '.profile'), 'utf8')).toContain('hfo: ollama env');
  });

  it('keeps a trailing newline tidy when the rc file lacks one', async () => {
    state.platform = 'linux';
    await writeFile(join(sandbox, '.profile'), 'no-trailing-newline', 'utf8');
    await persistEnv(profile, { systemdDir: join(sandbox, 'systemd') });
    const rc = await readFile(join(sandbox, '.profile'), 'utf8');
    expect(rc).toContain('no-trailing-newline\n\n# >>> hfo: ollama env >>>');
  });
});

describe('restartOllama', () => {
  it('kills and relaunches the tray app on Windows', async () => {
    state.platform = 'win32';
    process.env.LOCALAPPDATA = 'C:/Users/x/AppData/Local';
    expect(await restartOllama()).toEqual({ ok: true, note: 'Relaunched ollama app.exe' });
  });

  it('reports failure on Windows when the tray binary cannot be started', async () => {
    state.platform = 'win32';
    execa.mockImplementation((bin: string) => {
      if (bin === 'cmd') return Promise.reject(new Error('not found'));
      return Promise.resolve({ exitCode: 0 });
    });
    const res = await restartOllama();
    expect(res.ok).toBe(false);
    expect(res.note).toContain('Could not locate');
  });

  it('relaunches Ollama.app on macOS', async () => {
    state.platform = 'darwin';
    expect(await restartOllama()).toEqual({ ok: true, note: 'Relaunched Ollama.app' });
    expect(execa).toHaveBeenCalledWith('killall', ['Ollama'], { reject: false });
  });

  it('uses the user systemd unit on Linux when it succeeds', async () => {
    state.platform = 'linux';
    execa.mockResolvedValue({ exitCode: 0 });
    expect(await restartOllama()).toEqual({ ok: true, note: 'systemctl --user restart ollama' });
  });

  it('falls back to sudo systemctl when the user unit fails', async () => {
    state.platform = 'linux';
    execa.mockImplementation((bin: string) =>
      Promise.resolve({ exitCode: bin === 'sudo' ? 0 : 1 }));
    expect(await restartOllama()).toEqual({ ok: true, note: 'sudo systemctl restart ollama' });
  });

  it('reports failure when neither systemd path works', async () => {
    state.platform = 'linux';
    execa.mockResolvedValue({ exitCode: 1 });
    const res = await restartOllama();
    expect(res.ok).toBe(false);
    expect(res.note).toContain('systemd service');
  });

  it('returns the error message when the restart throws', async () => {
    state.platform = 'linux';
    execa.mockRejectedValue(new Error('no systemctl'));
    expect(await restartOllama()).toEqual({ ok: false, note: 'no systemctl' });
  });

  it('stringifies a non-Error restart failure', async () => {
    state.platform = 'linux';
    execa.mockRejectedValue('kaboom');
    expect(await restartOllama()).toEqual({ ok: false, note: 'kaboom' });
  });
});

describe('writeSystemdOverride', () => {
  it('writes an Environment= line per key into override.conf', async () => {
    const dir = join(sandbox, 'unit.d');
    await writeSystemdOverride([['OLLAMA_KEEP_ALIVE', '30m'], ['OLLAMA_MAX_QUEUE', '256']], dir);
    const body = await readFile(join(dir, 'override.conf'), 'utf8');
    expect(body).toBe(['[Service]', 'Environment="OLLAMA_KEEP_ALIVE=30m"', 'Environment="OLLAMA_MAX_QUEUE=256"', ''].join('\n'));
  });

  it('writes a bare [Service] stanza when there is nothing to set', async () => {
    const dir = join(sandbox, 'empty.d');
    await writeSystemdOverride([], dir);
    expect(await readFile(join(dir, 'override.conf'), 'utf8')).toBe('[Service]\n');
  });

  it('stays silent when the directory cannot be created', async () => {
    // A child of a regular file: mkdir refuses on every platform.
    await writeFile(join(sandbox, 'blocker'), 'x', 'utf8');
    await expect(writeSystemdOverride([['A', 'b']], join(sandbox, 'blocker', 'unit.d')))
      .resolves.toBeUndefined();
  });

  it('defaults to the stock systemd unit directory', () => {
    expect(SYSTEMD_OVERRIDE_DIR).toBe('/etc/systemd/system/ollama.service.d');
  });
});
