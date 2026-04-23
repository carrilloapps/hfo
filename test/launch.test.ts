import { describe, it, expect } from 'vitest';
import { LAUNCH_TARGETS, findTarget, buildLaunchArgs } from '../src/core/launch.js';

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
