import { describe, it, expect } from 'vitest';
import {
  LAUNCH_TARGETS,
  findTarget,
  buildLaunchArgs,
  buildDirectArgs,
  bindsOllamaModel,
  looksLikeOllamaTag,
  runnerFor,
} from '../src/core/launch.js';

const byId = (id: string) => {
  const target = LAUNCH_TARGETS.find((t) => t.id === id);
  if (!target) throw new Error(`no target ${id}`);
  return target;
};

describe('LAUNCH_TARGETS', () => {
  it('includes at least the 11 official integrations', () => {
    const ids = LAUNCH_TARGETS.map((t) => t.id);
    for (const expected of ['claude', 'cline', 'codex', 'copilot', 'droid', 'hermes', 'kimi', 'opencode', 'openclaw', 'pi', 'vscode']) {
      expect(ids).toContain(expected);
    }
  });
});

describe('findTarget', () => {
  it('resolves by primary id', () => {
    expect(findTarget('claude')?.id).toBe('claude');
  });
  it('resolves by alias', () => {
    expect(findTarget('copilot-cli')?.id).toBe('copilot');
    expect(findTarget('clawdbot')?.id).toBe('openclaw');
    expect(findTarget('code')?.id).toBe('vscode');
  });
  it('is case-insensitive', () => {
    expect(findTarget('CLAUDE')?.id).toBe('claude');
  });
  it('returns undefined for unknown', () => {
    expect(findTarget('nope')).toBeUndefined();
  });
});

describe('buildLaunchArgs', () => {
  it('emits just the integration name by default', () => {
    expect(buildLaunchArgs('claude')).toEqual(['launch', 'claude']);
  });
  it('emits --model when provided', () => {
    expect(buildLaunchArgs('codex', { model: 'llama3.1:8b' })).toEqual(['launch', 'codex', '--model', 'llama3.1:8b']);
  });
  it('emits --config flag', () => {
    expect(buildLaunchArgs('droid', { config: true })).toEqual(['launch', 'droid', '--config']);
  });
  it('appends -- EXTRA passthrough', () => {
    expect(buildLaunchArgs('codex', { extra: ['--sandbox', 'workspace-write'] })).toEqual([
      'launch', 'codex', '--', '--sandbox', 'workspace-write',
    ]);
  });
});

describe('direct-runner targets (kiro, antigravity)', () => {
  it('registers both alongside the Ollama-served integrations', () => {
    const ids = LAUNCH_TARGETS.map((t) => t.id);
    expect(ids).toContain('kiro');
    expect(ids).toContain('antigravity');
  });

  it('resolves the vendor binary names as aliases', () => {
    expect(findTarget('agy')?.id).toBe('antigravity');
    expect(findTarget('kiro-cli')?.id).toBe('kiro');
    expect(findTarget('AGY')?.id).toBe('antigravity');
  });

  it('spawns their own CLI instead of delegating to ollama launch', () => {
    expect(runnerFor(byId('antigravity'))).toMatchObject({ kind: 'direct', bin: 'agy' });
    expect(runnerFor(byId('kiro'))).toMatchObject({ kind: 'direct', bin: 'kiro-cli' });
  });

  it('leaves every pre-existing target on the ollama runner', () => {
    for (const id of ['claude', 'cline', 'codex', 'copilot', 'droid', 'hermes', 'kimi', 'opencode', 'openclaw', 'pi', 'vscode']) {
      expect(runnerFor(byId(id)).kind, id).toBe('ollama');
    }
  });

  it('marks both as unable to run on a local Ollama model', () => {
    expect(bindsOllamaModel(byId('kiro'))).toBe(false);
    expect(bindsOllamaModel(byId('antigravity'))).toBe(false);
    expect(bindsOllamaModel(byId('claude'))).toBe(true);
  });
});

describe('looksLikeOllamaTag', () => {
  it('treats a colon as the tell for a local tag', () => {
    expect(looksLikeOllamaTag('llama3.1:8b')).toBe(true);
    expect(looksLikeOllamaTag('qwen2.5-coder:7b-q4_K_M')).toBe(true);
  });
  it('accepts vendor ids, which never carry one', () => {
    expect(looksLikeOllamaTag('gemini-3.1-pro-high')).toBe(false);
    expect(looksLikeOllamaTag('claude-sonnet-4-6')).toBe(false);
  });
});

describe('buildDirectArgs', () => {
  it('starts kiro-cli on its chat subcommand', () => {
    expect(buildDirectArgs(byId('kiro'))).toEqual(['chat']);
  });

  it('never passes a model to kiro-cli, which has no --model flag', () => {
    expect(buildDirectArgs(byId('kiro'), { model: 'gpt-5' })).toEqual(['chat']);
    expect(buildDirectArgs(byId('kiro'), { model: 'llama3.1:8b' })).toEqual(['chat']);
  });

  it('runs agy bare when no model was requested', () => {
    expect(buildDirectArgs(byId('antigravity'))).toEqual([]);
  });

  it("forwards a vendor model id to agy's --model", () => {
    expect(buildDirectArgs(byId('antigravity'), { model: 'gemini-3.1-pro-high' })).toEqual([
      '--model', 'gemini-3.1-pro-high',
    ]);
  });

  it('drops an Ollama tag rather than handing agy something it will reject', () => {
    expect(buildDirectArgs(byId('antigravity'), { model: 'llama3.1:8b' })).toEqual([]);
  });

  it('appends passthrough extras', () => {
    expect(buildDirectArgs(byId('antigravity'), { extra: ['--sandbox'] })).toEqual(['--sandbox']);
    expect(buildDirectArgs(byId('kiro'), { extra: ['--no-interactive'] })).toEqual(['chat', '--no-interactive']);
  });
});
