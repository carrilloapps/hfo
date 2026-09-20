import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { configDir } from '../src/infra/platform.js';

import {
  parseLaunchPlugins,
  loadLaunchPlugins,
  launchPluginsPath,
  validatePluginTarget,
} from '../src/core/launchPlugins.js';
import {
  allLaunchTargets,
  reservedTargetNames,
  findTargetIn,
  runnerFor,
  bindsOllamaModel,
  LAUNCH_TARGETS,
} from '../src/core/launch.js';

const RESERVED = new Set(['claude', 'kiro', 'kiro-cli', 'agy']);

let sandbox: string;
const CONFIG_ENV = ['APPDATA', 'HOME', 'XDG_CONFIG_HOME', 'USERPROFILE'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-plugins-'));
  for (const k of CONFIG_ENV) { saved[k] = process.env[k]; process.env[k] = sandbox; }
});

afterEach(async () => {
  for (const k of CONFIG_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  await rm(sandbox, { recursive: true, force: true });
});

const minimal = { id: 'myagent', name: 'My Agent', bin: 'myagent' };

describe('validatePluginTarget — accepted shapes', () => {
  it('accepts the minimal id/name/bin form as a direct runner', () => {
    const errors: string[] = [];
    const t = validatePluginTarget(minimal, 0, RESERVED, errors);
    expect(errors).toEqual([]);
    expect(t).toMatchObject({ id: 'myagent', name: 'My Agent', description: '' });
    expect(runnerFor(t!)).toEqual({
      kind: 'direct', bin: 'myagent', args: undefined, fallbackPaths: undefined,
    });
  });

  it('carries every optional field through', () => {
    const errors: string[] = [];
    const t = validatePluginTarget({
      ...minimal,
      description: 'In-house agent',
      docsUrl: 'https://example.com',
      args: ['chat'],
      fallbackPaths: ['~/.local/bin/myagent'],
      aliases: ['ma'],
      ollamaBackend: false,
      modelFlag: '--model',
    }, 0, RESERVED, errors);
    expect(errors).toEqual([]);
    expect(t).toMatchObject({
      description: 'In-house agent',
      docsUrl: 'https://example.com',
      aliases: ['ma'],
      modelFlag: '--model',
    });
    expect(runnerFor(t!)).toMatchObject({ args: ['chat'], fallbackPaths: ['~/.local/bin/myagent'] });
    expect(bindsOllamaModel(t!)).toBe(false);
  });

  it('defaults to binding Ollama models when ollamaBackend is omitted', () => {
    const t = validatePluginTarget(minimal, 0, RESERVED, []);
    expect(bindsOllamaModel(t!)).toBe(true);
  });

  it('accepts a null modelFlag for a CLI with no model option', () => {
    const errors: string[] = [];
    const t = validatePluginTarget({ ...minimal, modelFlag: null }, 0, RESERVED, errors);
    expect(errors).toEqual([]);
    expect(t!.modelFlag).toBeNull();
  });

  it.each(['a', 'my-agent', 'my_agent', 'my.agent', 'agent2'])('accepts the id %s', (id) => {
    expect(validatePluginTarget({ ...minimal, id }, 0, RESERVED, [])).not.toBeNull();
  });
});

describe('validatePluginTarget — rejections', () => {
  function reject(spec: Record<string, unknown>, match: RegExp) {
    const errors: string[] = [];
    expect(validatePluginTarget(spec, 0, RESERVED, errors)).toBeNull();
    expect(errors.join(' ')).toMatch(match);
  }

  it.each([
    ['Upper', /lowercase/],
    ['has space', /lowercase/],
    ['-leading-dash', /lowercase/],
    ['', /lowercase/],
  ])('rejects the id %s', (id, match) => reject({ ...minimal, id }, match as RegExp));

  it('rejects a non-string id', () => reject({ ...minimal, id: 42 }, /lowercase/));

  it('refuses to shadow a built-in id', () =>
    reject({ ...minimal, id: 'claude' }, /already used by a built-in/));

  it('refuses to shadow a built-in alias', () =>
    reject({ ...minimal, id: 'agy' }, /already used by a built-in/));

  it('refuses an alias that shadows a built-in', () =>
    reject({ ...minimal, aliases: ['kiro-cli'] }, /alias "kiro-cli" is already used/));

  it('requires a name', () => reject({ id: 'x', bin: 'x' }, /"name" is required/));
  it('rejects a blank name', () => reject({ ...minimal, name: '   ' }, /"name" is required/));
  it('requires a bin', () => reject({ id: 'x', name: 'X' }, /"bin" is required/));
  it('rejects a blank bin', () => reject({ ...minimal, bin: ' ' }, /"bin" is required/));

  it.each(['args', 'fallbackPaths', 'aliases'])('rejects a non-array %s', (field) =>
    reject({ ...minimal, [field]: 'not-an-array' }, new RegExp(`"${field}" must be an array`)));

  it.each(['args', 'fallbackPaths', 'aliases'])('rejects %s holding a non-string', (field) =>
    reject({ ...minimal, [field]: [1] }, new RegExp(`"${field}" must be an array`)));

  it('rejects a non-boolean ollamaBackend', () =>
    reject({ ...minimal, ollamaBackend: 'yes' }, /"ollamaBackend" must be a boolean/));

  it('rejects a non-string modelFlag', () =>
    reject({ ...minimal, modelFlag: 7 }, /"modelFlag" must be a string or null/));

  it('labels an entry with no usable id by its position', () => {
    const errors: string[] = [];
    validatePluginTarget({}, 4, RESERVED, errors);
    expect(errors[0]).toContain('target #5');
  });

  it('labels an entry by its id when it has one', () => {
    const errors: string[] = [];
    validatePluginTarget({ id: 'named', name: '' }, 0, RESERVED, errors);
    expect(errors[0]).toContain('target "named"');
  });

  it('ignores a non-string description and docsUrl rather than failing', () => {
    const t = validatePluginTarget(
      { ...minimal, description: 5, docsUrl: 9 }, 0, RESERVED, [],
    );
    expect(t!.description).toBe('');
    expect(t!.docsUrl).toBeUndefined();
  });
});

describe('parseLaunchPlugins', () => {
  it('returns the valid targets and skips the broken ones', () => {
    const res = parseLaunchPlugins({
      targets: [minimal, { id: 'BAD' }, { ...minimal, id: 'second' }],
    }, RESERVED);
    expect(res.targets.map((t) => t.id)).toEqual(['myagent', 'second']);
    expect(res.errors).toHaveLength(1);
  });

  it('stops a plugin from shadowing an earlier plugin', () => {
    const res = parseLaunchPlugins({ targets: [minimal, minimal] }, RESERVED);
    expect(res.targets).toHaveLength(1);
    expect(res.errors.join(' ')).toMatch(/already used/);
  });

  it('stops a later plugin reusing an earlier plugin alias', () => {
    const res = parseLaunchPlugins({
      targets: [{ ...minimal, aliases: ['ma'] }, { ...minimal, id: 'other', aliases: ['ma'] }],
    }, RESERVED);
    expect(res.targets).toHaveLength(1);
    expect(res.errors.join(' ')).toMatch(/alias "ma" is already used/);
  });

  it('reports a document that is not an object', () => {
    expect(parseLaunchPlugins('nope', RESERVED).errors).toEqual(['plugin file must contain a JSON object']);
    expect(parseLaunchPlugins(null, RESERVED).errors).toEqual(['plugin file must contain a JSON object']);
  });

  it('reports a missing targets array', () => {
    expect(parseLaunchPlugins({}, RESERVED).errors).toEqual(['plugin file has no "targets" array']);
  });

  it('reports a targets field that is not an array', () => {
    expect(parseLaunchPlugins({ targets: 'x' }, RESERVED).errors).toEqual(['"targets" must be an array']);
  });

  it('accepts an empty targets array', () => {
    expect(parseLaunchPlugins({ targets: [] }, RESERVED)).toEqual({ targets: [], errors: [] });
  });

  it('treats a null entry as an empty spec rather than crashing', () => {
    const res = parseLaunchPlugins({ targets: [null] }, RESERVED);
    expect(res.targets).toEqual([]);
    expect(res.errors).toHaveLength(1);
  });
});

describe('loadLaunchPlugins', () => {
  it('returns nothing and no errors when the file does not exist', async () => {
    expect(await loadLaunchPlugins(RESERVED, join(sandbox, 'absent.json')))
      .toEqual({ targets: [], errors: [] });
  });

  it('reports invalid JSON with the parser message', async () => {
    const p = join(sandbox, 'bad.json');
    await writeFile(p, '{ not json');
    const res = await loadLaunchPlugins(RESERVED, p);
    expect(res.targets).toEqual([]);
    expect(res.errors[0]).toContain('is not valid JSON');
  });

  it('loads valid targets from disk', async () => {
    const p = join(sandbox, 'good.json');
    await writeFile(p, JSON.stringify({ targets: [minimal] }));
    const res = await loadLaunchPlugins(RESERVED, p);
    expect(res.errors).toEqual([]);
    expect(res.targets[0].id).toBe('myagent');
  });

  it('defaults to launch-plugins.json inside the config dir', () => {
    // configDir() differs per OS (APPDATA, XDG_CONFIG_HOME, Library/Application
    // Support), so derive the expectation rather than assuming a layout.
    expect(launchPluginsPath()).toBe(join(configDir(), 'launch-plugins.json'));
    expect(launchPluginsPath().startsWith(sandbox)).toBe(true);
  });
});

describe('reservedTargetNames', () => {
  it('covers every built-in id and alias', () => {
    const reserved = reservedTargetNames();
    for (const t of LAUNCH_TARGETS) {
      expect(reserved.has(t.id), t.id).toBe(true);
      for (const a of t.aliases ?? []) expect(reserved.has(a), a).toBe(true);
    }
  });
});

describe('allLaunchTargets', () => {
  async function writePlugins(doc: unknown): Promise<void> {
    // Write where the loader will actually look, whatever this OS's layout is.
    const path = launchPluginsPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(doc));
  }

  it('returns just the built-ins when there is no plugin file', async () => {
    const { targets, pluginErrors } = await allLaunchTargets();
    expect(targets).toHaveLength(LAUNCH_TARGETS.length);
    expect(pluginErrors).toEqual([]);
  });

  it('appends plugin targets after the built-ins', async () => {
    await writePlugins({ targets: [minimal] });
    const { targets, pluginErrors } = await allLaunchTargets();
    expect(pluginErrors).toEqual([]);
    expect(targets).toHaveLength(LAUNCH_TARGETS.length + 1);
    expect(targets.at(-1)!.id).toBe('myagent');
    // Built-ins keep their order and identity.
    expect(targets[0].id).toBe(LAUNCH_TARGETS[0].id);
  });

  it('makes a plugin resolvable by id and alias', async () => {
    await writePlugins({ targets: [{ ...minimal, aliases: ['ma'] }] });
    const { targets } = await allLaunchTargets();
    expect(findTargetIn(targets, 'myagent')?.id).toBe('myagent');
    expect(findTargetIn(targets, 'MA')?.id).toBe('myagent');
  });

  it('surfaces plugin errors while still returning the built-ins', async () => {
    await writePlugins({ targets: [{ id: 'claude', name: 'Hijack', bin: 'x' }] });
    const { targets, pluginErrors } = await allLaunchTargets();
    expect(targets).toHaveLength(LAUNCH_TARGETS.length);
    expect(pluginErrors.join(' ')).toMatch(/already used by a built-in/);
    // The built-in still wins.
    expect(findTargetIn(targets, 'claude')?.name).toBe('Claude Code');
  });
});

describe('loadLaunchPlugins — non-Error parse failure', () => {
  it('stringifies whatever JSON.parse threw', async () => {
    const p = join(sandbox, 'weird.json');
    await writeFile(p, '{}');
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => { throw 'a bare string'; });
    try {
      const res = await loadLaunchPlugins(RESERVED, p);
      expect(res.errors[0]).toContain('is not valid JSON: a bare string');
    } finally {
      spy.mockRestore();
    }
  });
});
