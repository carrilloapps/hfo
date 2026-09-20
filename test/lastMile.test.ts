import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { tierFor } from '../src/core/capacity.js';
import { detectModality } from '../src/core/describe.js';
import { inspectInstallDir } from '../src/core/reinstall.js';
import { readBackupManifest } from '../src/core/restore.js';
import { keysFor, missingKeys, enKeys, getLang, setLang, LANGS } from '../src/ui/i18n.js';
import { resolveBinary } from '../src/infra/platform.js';
import type { HardwareProfile } from '../src/core/hardware.js';
import type { HfFile } from '../src/core/hf.js';

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-lastmile-'));
});
afterEach(async () => {
  setLang('en');
  await rm(sandbox, { recursive: true, force: true });
});

function hw(vramMiB: number, ramMiB = 32768): HardwareProfile {
  return {
    gpuName: vramMiB > 0 ? 'GPU' : null,
    vramMiB, ramMiB, cpuCores: 8, platform: 'linux', unifiedMemory: false,
  };
}

describe('tierFor — every band', () => {
  it.each([
    [64, 'workstation'],
    [32, 'high'],
    [24, 'high'],
    [16, 'enthusiast'],
    [12, 'mid'],
    [10, 'solid'],
    [8, 'solid'],
    [6, 'entry'],
    [4, 'budget'],
    [2, 'low-vram'],
    [1, 'cpu-only'],
    [0, 'cpu-only'],
  ])('%i GB VRAM lands in a band with picks and keywords', (vramGB, key) => {
    const tier = tierFor(hw(vramGB * 1024));
    expect(tier.key).toBeTruthy();
    expect(tier.label).toBeTruthy();
    expect(tier.summary).toContain('GB');
    expect(tier.runs.length).toBeGreaterThan(0);
    expect(tier.picks.length).toBeGreaterThan(0);
    expect(tier.searchKeywords.length).toBeGreaterThan(0);
    if (key) expect(tier.key).toBe(key);
  });

  it('assigns distinct keys as VRAM falls', () => {
    const keys = [64, 32, 16, 12, 8, 6, 4, 2, 0].map((g) => tierFor(hw(g * 1024)).key);
    expect(new Set(keys).size).toBeGreaterThan(6);
  });

  it('marks every run entry with a level the renderer understands', () => {
    for (const g of [64, 32, 24, 16, 12, 10, 8, 6, 4, 2, 1, 0]) {
      for (const r of tierFor(hw(g * 1024)).runs) {
        expect(['ok', 'warn', 'bad'], `${g}GB: ${r.level}`).toContain(r.level);
        expect(r.text).toBeTruthy();
      }
    }
  });

  it('reaches every declared tier key across the VRAM range', () => {
    const seen = new Set([64, 32, 24, 16, 12, 10, 8, 6, 4, 2, 1, 0]
      .map((g) => tierFor(hw(g * 1024)).key));
    expect(seen).toEqual(new Set([
      'workstation', 'high', 'enthusiast', 'mid', 'solid',
      'entry', 'budget', 'low-vram', 'cpu-only',
    ]));
  });
});

describe('detectModality', () => {
  const f = (path: string): HfFile => ({ path, size: 1024, oid: '' });

  it('always includes text', () => {
    expect(detectModality('org/plain', [f('m.gguf')], null).kinds).toContain('text');
  });

  it('detects vision from an mmproj companion file and notes it', () => {
    const d = detectModality('org/some-model', [f('model.gguf'), f('mmproj-f16.gguf')], null);
    expect(d.kinds).toContain('vision');
    expect(d.hasMmproj).toBe(true);
    expect(d.note).toMatch(/mmproj projector/);
  });

  it('detects vision from a projector companion file', () => {
    expect(detectModality('org/m', [f('model.gguf'), f('projector.gguf')], null).hasMmproj).toBe(true);
  });

  it.each(['llava', 'moondream', 'vision', 'vlm', 'multimodal', 'visual', 'image'])(
    'detects vision from the %s keyword',
    (kw) => {
      expect(detectModality(`org/${kw} 7b`, [f('m.gguf')], null).kinds).toContain('vision');
    },
  );

  it.each(['whisper', 'bark', 'audio', 'tts', 'stt', 'voice', 'speech'])(
    'detects audio from the %s keyword',
    (kw) => {
      expect(detectModality(`org/${kw} base`, [f('m.gguf')], null).kinds).toContain('audio');
    },
  );

  it.each(['coder', 'codellama', 'deepseek-coder', 'starcoder', 'codestral', 'code-assistant'])(
    'detects code from the %s keyword',
    (kw) => {
      expect(detectModality(`org/${kw} 7b`, [f('m.gguf')], null).kinds).toContain('code');
    },
  );

  it.each(['embedding', 'bge', 'e5', 'gte', 'nomic-embed', 'sentence-transformer'])(
    'detects embedding from the %s keyword',
    (kw) => {
      expect(detectModality(`org/${kw} v1`, [f('m.gguf')], null).kinds).toContain('embedding');
    },
  );

  it('reads keywords out of the model card as well as the repo id', () => {
    expect(detectModality('org/anon', [f('m.gguf')], 'This is a vision model').kinds)
      .toContain('vision');
  });

  it('leaves note undefined when there is no projector', () => {
    expect(detectModality('org/plain', [f('m.gguf')], null).note).toBeUndefined();
  });

  it('handles a repo with no files at all', () => {
    const d = detectModality('org/empty', [], null);
    expect(d.kinds).toEqual(['text']);
    expect(d.hasMmproj).toBe(false);
  });
});

describe('inspectInstallDir — unreadable directory', () => {
  it('reports missing-dir when readdir is refused', async () => {
    // A path containing a NUL can be stat-ed on no platform, exercising the
    // outer guard; the inner readdir guard is reached via a file path.
    const file = join(sandbox, 'a-file');
    await writeFile(file, 'x');
    expect(await inspectInstallDir(file)).toEqual({ kind: 'missing-dir' });
  });

  it('reports missing-gguf for a directory of unrelated files', async () => {
    const dir = join(sandbox, 'other');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'notes.md'), 'x');
    await writeFile(join(dir, 'config.json'), '{}');
    expect(await inspectInstallDir(dir)).toEqual({ kind: 'missing-gguf' });
  });
});

describe('readBackupManifest — unreadable sidecar', () => {
  it('returns null when the sidecar exists but cannot be parsed and there is no zip', async () => {
    const zip = join(sandbox, 'x.zip');
    await writeFile(join(sandbox, 'x.metadata.json'), 'not json at all');
    expect(await readBackupManifest(zip)).toBeNull();
  });
});

describe('i18n catalogue helpers', () => {
  it('enKeys is the authoritative sorted key set', () => {
    const keys = enKeys();
    expect(keys.length).toBeGreaterThan(100);
    expect([...keys].sort()).toEqual(keys);
  });

  it('keysFor returns a catalogue’s own keys', () => {
    expect(keysFor('es').length).toBeGreaterThan(100);
  });

  it('keysFor returns an empty list for an unknown language', () => {
    expect(keysFor('xx' as never)).toEqual([]);
  });

  it('missingKeys is empty for Spanish and lists everything for an unknown language', () => {
    expect(missingKeys('es')).toEqual([]);
    expect(missingKeys('xx' as never).length).toBe(enKeys().length);
  });

  it('getLang reflects the last successful setLang', () => {
    setLang('de');
    expect(getLang()).toBe('de');
    setLang('en');
    expect(getLang()).toBe('en');
  });

  it('every advertised language is selectable', () => {
    for (const { code } of LANGS) {
      setLang(code);
      expect(getLang()).toBe(code);
    }
    setLang('en');
  });
});

describe('resolveBinary — remaining paths', () => {
  it('prefers an explicit path over a PATH lookup of the same name', async () => {
    expect(await resolveBinary(process.execPath, ['/never/used'])).toBe(process.execPath);
  });

  it('returns null when a relative path candidate does not exist', async () => {
    expect(await resolveBinary('./nope-not-here-xyz')).toBeNull();
  });

  it('accepts an empty fallback list', async () => {
    expect(await resolveBinary('hfo-absent-binary-xyz', [])).toBeNull();
  });
});
