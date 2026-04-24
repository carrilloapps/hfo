import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentHint,
  agentLaunchesDir,
  agentManifestPath,
  DEFAULT_OLLAMA_HOST,
  renderHint,
  writeLaunchManifest,
} from '../src/core/agentConfig.js';

// writeLaunchManifest uses configDir() under the hood, which resolves via
// APPDATA / HOME / XDG_CONFIG_HOME. We override APPDATA + HOME to a temp
// directory so the test never leaks into the real user config.
let sandbox: string;
let prevAppData: string | undefined;
let prevHome: string | undefined;
let prevXdg: string | undefined;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hfo-agent-test-'));
  prevAppData = process.env.APPDATA;
  prevHome = process.env.HOME;
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.APPDATA = sandbox;
  process.env.HOME = sandbox;
  process.env.XDG_CONFIG_HOME = sandbox;
});

afterEach(async () => {
  if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(sandbox, { recursive: true, force: true });
});

describe('agentHint', () => {
  it('returns a claude hint with ANTHROPIC_BASE_URL set to the host', () => {
    const h = agentHint('claude', { model: 'llama3.1:8b', ollamaHost: 'http://localhost:11434' });
    expect(h.summary).toMatch(/ANTHROPIC_BASE_URL/);
    const base = h.envVars.find((v) => v.name === 'ANTHROPIC_BASE_URL');
    expect(base?.value).toBe('http://localhost:11434');
    const model = h.envVars.find((v) => v.name === 'ANTHROPIC_MODEL');
    expect(model?.value).toBe('llama3.1:8b');
  });

  it('returns a codex hint pointing at /v1 (OpenAI-compat path)', () => {
    const h = agentHint('codex', { model: 'qwen2.5:7b', ollamaHost: 'http://localhost:11434' });
    const base = h.envVars.find((v) => v.name === 'OPENAI_BASE_URL');
    expect(base?.value).toBe('http://localhost:11434/v1');
    const model = h.envVars.find((v) => v.name === 'OPENAI_MODEL');
    expect(model?.value).toBe('qwen2.5:7b');
  });

  it('falls back to DEFAULT_OLLAMA_HOST when no host is provided', () => {
    const h = agentHint('claude');
    const base = h.envVars.find((v) => v.name === 'ANTHROPIC_BASE_URL');
    expect(base?.value).toBe(DEFAULT_OLLAMA_HOST);
  });

  it('returns a no-op style hint for agents we do not configure (pi, hermes)', () => {
    for (const id of ['pi', 'hermes', 'kimi', 'openclaw'] as const) {
      const h = agentHint(id);
      expect(h.summary).toMatch(/ollama launch/);
      // Always surfaces OLLAMA_HOST so users see *some* value
      const host = h.envVars.find((v) => v.name === 'OLLAMA_HOST');
      expect(host?.value).toBe(DEFAULT_OLLAMA_HOST);
    }
  });

  it('respects an undefined model by leaving the value unset', () => {
    const h = agentHint('claude', { model: null });
    const modelEntry = h.envVars.find((v) => v.name === 'ANTHROPIC_MODEL');
    expect(modelEntry?.value).toBeUndefined();
  });
});

describe('renderHint', () => {
  it('produces a block that includes summary, env vars, and config path', () => {
    const h = agentHint('claude', { model: 'llama3.1:8b' });
    const out = renderHint('claude', h);
    expect(out).toContain('Claude Code reads ANTHROPIC_BASE_URL');
    expect(out).toContain('ANTHROPIC_BASE_URL');
    expect(out).toContain('ANTHROPIC_MODEL');
    expect(out).toContain('Config: ~/.claude.json');
    expect(out).toContain('Docs:');
  });

  it('renders <set me> placeholder when a value is missing', () => {
    const h = agentHint('claude', { model: null });
    const out = renderHint('claude', h);
    expect(out).toContain('<set me>');
  });
});

describe('writeLaunchManifest', () => {
  it('writes a JSON manifest under the resolved agent-launches dir', async () => {
    const path = await writeLaunchManifest({
      agent: 'claude',
      model: 'llama3.1:8b',
      ollamaHost: 'http://localhost:11434',
    });

    // Path comes back pointing into our sandbox
    expect(path).toContain('agent-launches');
    expect(path).toMatch(/claude\.json$/);
    expect(path.startsWith(sandbox)).toBe(true);

    // File exists with expected shape
    const stats = await stat(path);
    expect(stats.isFile()).toBe(true);
    const body = JSON.parse(await readFile(path, 'utf8'));
    expect(body.agent).toBe('claude');
    expect(body.model).toBe('llama3.1:8b');
    expect(body.ollamaHost).toBe('http://localhost:11434');
    expect(typeof body.launchedAt).toBe('string');
    // Valid ISO timestamp
    expect(new Date(body.launchedAt).toString()).not.toBe('Invalid Date');
  });

  it('overwrites the previous manifest for the same agent', async () => {
    await writeLaunchManifest({ agent: 'codex', model: 'old:1b',   ollamaHost: 'http://a' });
    await writeLaunchManifest({ agent: 'codex', model: 'new:7b',   ollamaHost: 'http://b' });
    const body = JSON.parse(await readFile(agentManifestPath('codex'), 'utf8'));
    expect(body.model).toBe('new:7b');
    expect(body.ollamaHost).toBe('http://b');
  });

  it('accepts null model for cases where the user did not pass --model', async () => {
    const path = await writeLaunchManifest({
      agent: 'pi',
      model: null,
      ollamaHost: DEFAULT_OLLAMA_HOST,
    });
    const body = JSON.parse(await readFile(path, 'utf8'));
    expect(body.model).toBeNull();
  });
});

describe('agentLaunchesDir / agentManifestPath', () => {
  it('derives the manifest path from the launches dir and agent id', () => {
    const dir = agentLaunchesDir();
    const path = agentManifestPath('droid');
    expect(path).toBe(join(dir, 'droid.json'));
  });
});
