import { execa } from 'execa';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

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
