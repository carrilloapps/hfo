import { execa } from 'execa';
import { access, constants as fsConstants } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join, sep } from 'node:path';

/** Cross-OS URL opener. Opens the given URL in the user's default browser. */
export async function openUrl(url: string): Promise<boolean> {
  try {
    const os = platform();
    if (os === 'win32') {
      // `start ""` treats the first quoted arg as the window title and the second as URL.
      await execa('cmd', ['/c', 'start', '', url], { reject: false, detached: true });
      return true;
    }
    if (os === 'darwin') {
      await execa('open', [url], { reject: false, detached: true });
      return true;
    }
    await execa('xdg-open', [url], { reject: false, detached: true });
    return true;
  } catch {
    return false;
  }
}

/** Cross-OS config directory for hfo. Created on demand. */
export function configDir(): string {
  const os = platform();
  if (os === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'hfo');
  }
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'hfo');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'hfo');
}

export function settingsPath(): string {
  return join(configDir(), 'settings.json');
}

/**
 * Cross-OS "is this executable reachable?" probe.
 *
 * Checks PATH first (`where` on Windows, `command -v` elsewhere), then falls
 * back to any explicitly supplied absolute candidates. Vendor installers often
 * drop their binary somewhere that is not on PATH for non-login shells — the
 * Antigravity installer, for example, writes `~/.local/bin/agy` on Unix and
 * `%LOCALAPPDATA%\agy\bin\agy.exe` on Windows — so a PATH-only check would
 * report a freshly installed CLI as missing.
 *
 * Returns the command hfo should spawn (the bare name when PATH resolves it,
 * otherwise the absolute path that matched), or null when nothing matched.
 */
export async function resolveBinary(
  bin: string,
  fallbackPaths: string[] = [],
): Promise<string | null> {
  // A name containing a separator is an explicit path, never a PATH lookup:
  // `./foo` must not resolve to some unrelated `foo` on PATH. Check the file
  // and go straight to the candidates — handing a path to `where` on Windows
  // makes it scan the whole PATH for a name it can never match, which is slow
  // enough to look like a hang.
  if (bin.includes('/') || bin.includes(sep)) {
    const direct = expandHome(bin);
    try {
      await access(direct, fsConstants.X_OK);
      return direct;
    } catch {
      /* not there — fall through to the candidates below */
    }
  } else {
    // `command -v` is a POSIX shell builtin, not an executable, so it has to be
    // run through `sh`. The binary name is passed as an argv parameter rather
    // than interpolated into the script so it can never be treated as shell code.
    const [probe, args] =
      platform() === 'win32'
        ? ['where', [bin]]
        : ['sh', ['-c', 'command -v "$1"', 'sh', bin]];
    try {
      const { exitCode } = await execa(probe, args, { reject: false, stdio: 'ignore' });
      if (exitCode === 0) return bin;
    } catch {
      /* probe unavailable — fall through to the explicit candidates */
    }
  }

  for (const candidate of fallbackPaths) {
    const full = expandHome(candidate);
    try {
      await access(full, fsConstants.X_OK);
      return full;
    } catch {
      /* not here — keep looking */
    }
  }
  return null;
}

/** Expand a leading `~` and any %VAR% / $VAR reference against the environment. */
export function expandHome(p: string): string {
  let out = p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
  out = out.replace(/%([^%]+)%/g, (m, name: string) => process.env[name] ?? m);
  out = out.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (m, name: string) => process.env[name] ?? m);
  return out;
}
