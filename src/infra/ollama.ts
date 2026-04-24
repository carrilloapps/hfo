import { execa } from 'execa';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export type InstallStatus = 'ok' | 'no-binary' | 'no-server';

export interface OllamaStatus {
  status: InstallStatus;
  version?: string;
  error?: string;
}

export async function checkOllama(): Promise<OllamaStatus> {
  try {
    const { stdout } = await execa('ollama', ['--version']);
    const version = stdout.split('\n').find((l) => /version/i.test(l))?.trim() ?? stdout.trim();
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags', {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return { status: 'ok', version };
      return { status: 'no-server', version };
    } catch {
      return { status: 'no-server', version };
    }
  } catch (err) {
    return { status: 'no-binary', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function ollamaCreate(tag: string, modelfilePath: string, cwd: string): Promise<string> {
  const { stdout, stderr, exitCode } = await execa('ollama', ['create', tag, '-f', modelfilePath], {
    cwd,
    reject: false,
  });
  if (exitCode !== 0) {
    throw new Error(`ollama create failed (exit ${exitCode}): ${stderr || stdout}`);
  }
  return stdout;
}

export async function ollamaList(): Promise<string[]> {
  try {
    const { stdout } = await execa('ollama', ['list']);
    return stdout.split('\n').slice(1).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  } catch {
    return [];
  }
}

export interface InstallPlan {
  os: NodeJS.Platform;
  method: 'winget' | 'brew' | 'shell-script' | 'manual';
  bin: string;
  args: string[];
  humanCommand: string;
  note: string;
  fallbackUrl: string;
}

export function planInstall(): InstallPlan {
  const os = platform();
  if (os === 'win32') {
    return {
      os,
      method: 'winget',
      bin: 'winget',
      args: ['install', '--id=Ollama.Ollama', '-e', '--accept-source-agreements', '--accept-package-agreements'],
      humanCommand: 'winget install --id=Ollama.Ollama -e',
      note: 'Using winget (Windows Package Manager).',
      fallbackUrl: 'https://ollama.com/download/OllamaSetup.exe',
    };
  }
  if (os === 'darwin') {
    return {
      os,
      method: 'brew',
      bin: 'brew',
      args: ['install', '--cask', 'ollama'],
      humanCommand: 'brew install --cask ollama',
      note: 'Using Homebrew.',
      fallbackUrl: 'https://ollama.com/download/Ollama-darwin.zip',
    };
  }
  return {
    os,
    method: 'shell-script',
    bin: 'sh',
    args: ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'],
    humanCommand: 'curl -fsSL https://ollama.com/install.sh | sh',
    note: 'Official install script. Requires curl and sudo.',
    fallbackUrl: 'https://ollama.com/download',
  };
}

export interface InstallProgress {
  line: string;
  stream: 'stdout' | 'stderr';
}

export async function runInstall(
  plan: InstallPlan,
  onLine: (p: InstallProgress) => void,
): Promise<{ ok: boolean; exitCode: number }> {
  const child = execa(plan.bin, plan.args, { reject: false, stdout: 'pipe', stderr: 'pipe' });
  child.stdout?.on('data', (d: Buffer) =>
    d.toString().split(/\r?\n/).filter(Boolean).forEach((line) => onLine({ line, stream: 'stdout' })),
  );
  child.stderr?.on('data', (d: Buffer) =>
    d.toString().split(/\r?\n/).filter(Boolean).forEach((line) => onLine({ line, stream: 'stderr' })),
  );
  const result = await child;
  return { ok: result.exitCode === 0, exitCode: result.exitCode ?? -1 };
}

export type EnvKey =
  | 'OLLAMA_FLASH_ATTENTION'
  | 'OLLAMA_KV_CACHE_TYPE'
  | 'OLLAMA_KEEP_ALIVE'
  | 'OLLAMA_NUM_PARALLEL'
  | 'OLLAMA_MAX_LOADED_MODELS'
  | 'OLLAMA_MAX_QUEUE';

export type EnvProfile = Record<EnvKey, string>;

export interface CapacityTarget {
  ramMiB: number;
  vramMiB: number;
  cpuCores: number;
}

export interface EnvVarMeta {
  key: EnvKey;
  label: string;
  description: string;
  default: string;            // Ollama's out-of-the-box default
  values?: string[];          // known enum-like values (for quick cycling)
}

export const ENV_VAR_META: Record<EnvKey, EnvVarMeta> = {
  OLLAMA_FLASH_ATTENTION: {
    key: 'OLLAMA_FLASH_ATTENTION',
    label: 'Flash Attention',
    description: 'Enables flash attention kernels — reduces VRAM for attention, ~10-20% faster.',
    default: '0',
    values: ['0', '1'],
  },
  OLLAMA_KV_CACHE_TYPE: {
    key: 'OLLAMA_KV_CACHE_TYPE',
    label: 'KV cache quantization',
    description: 'Precision of the KV cache. q8_0 halves memory vs f16; requires flash attention.',
    default: 'f16',
    values: ['f16', 'q8_0', 'q4_0'],
  },
  OLLAMA_KEEP_ALIVE: {
    key: 'OLLAMA_KEEP_ALIVE',
    label: 'Model keep-alive',
    description: 'How long a model stays warm in memory after last request (Go duration syntax).',
    default: '5m',
    values: ['5m', '30m', '1h', '24h', '-1'],
  },
  OLLAMA_NUM_PARALLEL: {
    key: 'OLLAMA_NUM_PARALLEL',
    label: 'Parallel requests',
    description: 'Concurrent request slots per model. Each slot reserves its own KV cache.',
    default: '1',
    values: ['1', '2', '4', '8'],
  },
  OLLAMA_MAX_LOADED_MODELS: {
    key: 'OLLAMA_MAX_LOADED_MODELS',
    label: 'Loaded models',
    description: 'Maximum models held in memory simultaneously. Lower = less VRAM churn.',
    default: '3',
    values: ['1', '2', '3', '4'],
  },
  OLLAMA_MAX_QUEUE: {
    key: 'OLLAMA_MAX_QUEUE',
    label: 'Request queue',
    description: 'Queue depth before rejecting. 256 is a comfortable cap for single-user rigs.',
    default: '512',
    values: ['128', '256', '512', '1024'],
  },
};

export function buildEnvProfile(hw: CapacityTarget, capacityRatio = 0.9): EnvProfile {
  void capacityRatio; // reserved for future scaling; values below already target ~90%
  const bigVram = hw.vramMiB >= 12 * 1024;
  return {
    OLLAMA_FLASH_ATTENTION: '1',
    OLLAMA_KV_CACHE_TYPE: 'q8_0',
    OLLAMA_KEEP_ALIVE: '30m',
    OLLAMA_NUM_PARALLEL: bigVram ? '2' : '1',
    OLLAMA_MAX_LOADED_MODELS: '1',
    OLLAMA_MAX_QUEUE: '256',
  };
}

export function defaultEnvProfile(): EnvProfile {
  const out = {} as EnvProfile;
  for (const k of Object.keys(ENV_VAR_META) as EnvKey[]) {
    out[k] = ENV_VAR_META[k].default;
  }
  return out;
}

export async function readCurrentEnv(): Promise<Partial<EnvProfile>> {
  const keys = Object.keys(ENV_VAR_META) as EnvKey[];
  const out: Partial<EnvProfile> = {};
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export interface PersistResult {
  key: string;
  value: string;
  applied: boolean;
  method: string;
  note?: string;
}

export async function persistEnv(profile: EnvProfile): Promise<PersistResult[]> {
  const os = platform();
  const entries = Object.entries(profile) as [string, string][];
  if (os === 'win32') {
    const out: PersistResult[] = [];
    for (const [k, v] of entries) {
      try {
        await execa('setx', [k, v]);
        out.push({ key: k, value: v, applied: true, method: 'setx' });
      } catch (err) {
        out.push({
          key: k,
          value: v,
          applied: false,
          method: 'setx',
          note: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }

  if (os === 'darwin') {
    const out: PersistResult[] = [];
    for (const [k, v] of entries) {
      try {
        await execa('launchctl', ['setenv', k, v]);
        out.push({ key: k, value: v, applied: true, method: 'launchctl setenv' });
      } catch (err) {
        out.push({
          key: k,
          value: v,
          applied: false,
          method: 'launchctl setenv',
          note: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await upsertRcFile(entries, ['.zprofile', '.bash_profile', '.profile']);
    return out;
  }

  // linux + others
  const out: PersistResult[] = entries.map(([k, v]) => ({ key: k, value: v, applied: true, method: '~/.profile' }));
  await upsertRcFile(entries, ['.profile', '.bashrc']);
  await writeSystemdOverride(entries).catch(() => undefined);
  return out;
}

async function upsertRcFile(entries: [string, string][], candidates: string[]): Promise<void> {
  const home = homedir();
  let target = join(home, candidates[0]);
  try {
    await readFile(target, 'utf8');
  } catch {
    // create it if first candidate does not exist, try others
    for (const c of candidates.slice(1)) {
      const path = join(home, c);
      try {
        await readFile(path, 'utf8');
        target = path;
        break;
      } catch {}
    }
  }

  let content = '';
  try {
    content = await readFile(target, 'utf8');
  } catch {}
  const marker = '# >>> hfo: ollama env >>>';
  const endMarker = '# <<< hfo: ollama env <<<';
  const block = [marker, ...entries.map(([k, v]) => `export ${k}="${v}"`), endMarker].join('\n');
  // Match either the current `hfo:` block OR any legacy `runllama:` block so
  // users who ran --tune before the rename don't end up with duplicate blocks.
  const anyBlockRe = /# >>> (?:runllama|hfo): ollama env >>>[\s\S]*?# <<< (?:runllama|hfo): ollama env <<</m;
  if (anyBlockRe.test(content)) {
    content = content.replace(anyBlockRe, block);
  } else {
    content = content + (content.endsWith('\n') || content === '' ? '' : '\n') + '\n' + block + '\n';
  }
  await writeFile(target, content, 'utf8');
}

async function writeSystemdOverride(entries: [string, string][]): Promise<void> {
  // Only if user is running Ollama as a systemd service
  const overrideDir = '/etc/systemd/system/ollama.service.d';
  const overrideFile = join(overrideDir, 'override.conf');
  try {
    await mkdir(overrideDir, { recursive: true });
    const body = ['[Service]', ...entries.map(([k, v]) => `Environment="${k}=${v}"`)].join('\n');
    await writeFile(overrideFile, body + '\n', 'utf8');
  } catch {
    // silent — systemd may not be in use, or no privileges
  }
}

export async function restartOllama(): Promise<{ ok: boolean; note: string }> {
  const os = platform();
  try {
    if (os === 'win32') {
      await execa('taskkill', ['/F', '/IM', 'ollama app.exe'], { reject: false });
      await execa('taskkill', ['/F', '/IM', 'ollama.exe'], { reject: false });
      const paths = [
        join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama app.exe'),
      ];
      for (const p of paths) {
        try {
          await execa('cmd', ['/c', 'start', '', p], { detached: true });
          return { ok: true, note: 'Relaunched ollama app.exe' };
        } catch {}
      }
      return { ok: false, note: 'Could not locate Ollama tray binary; please start it manually.' };
    }
    if (os === 'darwin') {
      await execa('killall', ['Ollama'], { reject: false });
      await execa('open', ['-a', 'Ollama'], { reject: false });
      return { ok: true, note: 'Relaunched Ollama.app' };
    }
    // linux
    const { exitCode } = await execa('systemctl', ['--user', 'restart', 'ollama'], { reject: false });
    if (exitCode === 0) return { ok: true, note: 'systemctl --user restart ollama' };
    const { exitCode: sysExit } = await execa('sudo', ['systemctl', 'restart', 'ollama'], { reject: false });
    if (sysExit === 0) return { ok: true, note: 'sudo systemctl restart ollama' };
    return { ok: false, note: 'Ollama may not be running as a systemd service; please restart it manually.' };
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message : String(err) };
  }
}
