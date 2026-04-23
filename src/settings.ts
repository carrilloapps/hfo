import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { settingsPath } from './platform.js';
import { LANGS, setLang, type Lang } from './i18n.js';
import { THEME_LIST, type ThemeName } from './theme.js';

export interface Installation {
  tag: string;
  dir: string;           // absolute path to the folder containing the Modelfile + .gguf
  repoId: string;        // org/repo slug that seeded this install
  quant: string;
  installedAt: string;   // ISO timestamp
}

export interface Settings {
  theme: ThemeName;
  language: Lang;
  refreshIntervalMs: number;       // Dashboard polling
  defaultSort: 'trending' | 'downloads' | 'likes7d' | 'modified';
  defaultCodeMode: boolean;
  modelDir: string | null;         // null = platform default
  useAltScreen: boolean;
  installations: Installation[];   // index kept by hfo so it can clean up files on Alt+D
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  language: 'en',
  refreshIntervalMs: 2000,
  defaultSort: 'trending',
  defaultCodeMode: false,
  modelDir: null,
  useAltScreen: true,
  installations: [],
};

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Validate enum-like fields
    if (!THEME_LIST.includes(merged.theme)) merged.theme = DEFAULT_SETTINGS.theme;
    if (!LANGS.some((l) => l.code === merged.language)) merged.language = DEFAULT_SETTINGS.language;
    setLang(merged.language);
    return merged;
  } catch {
    setLang(DEFAULT_SETTINGS.language);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(s, null, 2), 'utf8');
  setLang(s.language);
}

export function settingsEqual(a: Settings, b: Settings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Record (or refresh) a tag -> directory mapping so the Models tab can offer
 * a "delete files too" action. Safe to call from anywhere; it debounces onto
 * the existing file on disk.
 */
export async function recordInstallation(entry: Omit<Installation, 'installedAt'>): Promise<void> {
  const current = await loadSettings();
  const without = current.installations.filter((i) => i.tag !== entry.tag);
  const next: Settings = {
    ...current,
    installations: [
      ...without,
      { ...entry, installedAt: new Date().toISOString() },
    ],
  };
  await saveSettings(next);
}

/** Remove the tag -> dir record (called after a deep delete). */
export async function forgetInstallation(tag: string): Promise<void> {
  const current = await loadSettings();
  const next: Settings = {
    ...current,
    installations: current.installations.filter((i) => i.tag !== tag),
  };
  await saveSettings(next);
}

export async function findInstallation(tag: string): Promise<Installation | null> {
  const current = await loadSettings();
  return current.installations.find((i) => i.tag === tag) ?? null;
}
