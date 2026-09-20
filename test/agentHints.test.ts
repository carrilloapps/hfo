import { describe, it, expect } from 'vitest';
import { agentHint, renderHint, DEFAULT_OLLAMA_HOST } from '../src/core/agentConfig.js';
import { LAUNCH_TARGETS } from '../src/core/launch.js';

const HOST = 'http://localhost:11434';

describe('agentHint — every registered target', () => {
  it('returns a usable hint for every id in the registry', () => {
    for (const t of LAUNCH_TARGETS) {
      const h = agentHint(t.id, { model: 'demo:q4', ollamaHost: HOST });
      expect(h.summary, t.id).toBeTruthy();
      expect(Array.isArray(h.envVars), t.id).toBe(true);
      expect(h.envVars.length, t.id).toBeGreaterThan(0);
    }
  });

  it('renders every hint without throwing', () => {
    for (const t of LAUNCH_TARGETS) {
      const out = renderHint(t.id, agentHint(t.id, { model: 'demo:q4' }));
      expect(out, t.id).toContain(t.id);
    }
  });
});

describe('agentHint — VS Code and Cline settings keys', () => {
  it('cline points its VS Code keys at the Ollama host and model', () => {
    const h = agentHint('cline', { model: 'demo:q4', ollamaHost: HOST });
    expect(h.summary).toMatch(/VS Code settings/);
    expect(h.envVars.find((v) => v.name === 'cline.apiProvider')?.value).toBe('ollama');
    expect(h.envVars.find((v) => v.name === 'cline.ollamaBaseUrl')?.value).toBe(HOST);
    expect(h.envVars.find((v) => v.name === 'cline.ollamaModelId')?.value).toBe('demo:q4');
    expect(h.configPath).toMatch(/settings\.json/);
  });

  it('vscode explains that the extension, not the editor, does the wiring', () => {
    const h = agentHint('vscode', { model: 'demo:q4', ollamaHost: HOST });
    expect(h.summary).toMatch(/extensions/i);
    expect(h.envVars.find((v) => v.name === 'continue.models[].apiBase')?.value).toBe(HOST);
  });
});

describe('agentHint — copilot, opencode, droid', () => {
  it('copilot surfaces only the model override it actually honours', () => {
    const h = agentHint('copilot', { model: 'demo:q4' });
    expect(h.envVars.find((v) => v.name === 'GH_COPILOT_MODEL')?.value).toBe('demo:q4');
  });

  it('opencode names its provider, model and base URL', () => {
    const h = agentHint('opencode', { model: 'demo:q4', ollamaHost: HOST });
    expect(h.envVars.find((v) => v.name === 'OPENCODE_PROVIDER')?.value).toBe('ollama');
    expect(h.envVars.find((v) => v.name === 'OPENCODE_BASE_URL')?.value).toBe(HOST);
    expect(h.configPath).toMatch(/opencode/);
  });

  it('droid flips the Ollama switch and offers the URL override', () => {
    const h = agentHint('droid', { model: 'demo:q4', ollamaHost: HOST });
    expect(h.envVars.find((v) => v.name === 'FACTORY_USE_OLLAMA')?.value).toBe('1');
    expect(h.envVars.find((v) => v.name === 'FACTORY_OLLAMA_URL')?.value).toBe(HOST);
    expect(h.envVars.find((v) => v.name === 'FACTORY_MODEL')?.value).toBe('demo:q4');
  });
});

describe('agentHint — the self-wiring agents', () => {
  it.each(['hermes', 'kimi', 'openclaw', 'pi'] as const)(
    '%s says Ollama handles its own wiring and still shows the host',
    (id) => {
      const h = agentHint(id, { ollamaHost: HOST });
      expect(h.summary).toMatch(/ollama launch/);
      expect(h.envVars.find((v) => v.name === 'OLLAMA_HOST')?.value).toBe(HOST);
      expect(h.configPath).toBeUndefined();
      expect(h.docsUrl).toBeUndefined();
    },
  );

  it('falls back to the default host when none is supplied', () => {
    expect(agentHint('pi').envVars.find((v) => v.name === 'OLLAMA_HOST')?.value)
      .toBe(DEFAULT_OLLAMA_HOST);
  });
});

describe('renderHint formatting', () => {
  it('aligns the env var names into a column', () => {
    const out = renderHint('codex', agentHint('codex', { model: 'demo:q4' }));
    const lines = out.split('\n').filter((l) => l.includes('='));
    const columns = lines.map((l) => l.indexOf('='));
    expect(new Set(columns).size).toBe(1);
  });

  it('includes the note after each value', () => {
    const out = renderHint('codex', agentHint('codex', { model: 'demo:q4' }));
    expect(out).toMatch(/# .+/);
  });

  it('omits the Config and Docs lines when the hint has neither', () => {
    const out = renderHint('pi', agentHint('pi'));
    expect(out).not.toContain('Config:');
    expect(out).not.toContain('Docs:');
  });

  it('prints a Config line without a Docs line when only a path is known', () => {
    const out = renderHint('cline', agentHint('cline', { model: 'm' }));
    expect(out).toContain('Config:');
    expect(out).not.toContain('Docs:');
  });

  it('renders an env var that carries no note', () => {
    const out = renderHint('custom' as never, {
      summary: 'x',
      envVars: [{ name: 'PLAIN', value: 'v' }],
    });
    expect(out).toContain('PLAIN=v');
    expect(out).not.toContain('#');
  });
});

describe('agentHint — a plugin target spawned directly', () => {
  it('describes the direct spawn rather than claiming ollama launch wires it', () => {
    const h = agentHint('myagent' as never, { directBin: 'myagent', ollamaHost: HOST });
    expect(h.summary).toContain('hfo launches');
    expect(h.summary).toContain('myagent');
    expect(h.summary).not.toContain('ollama launch');
    expect(h.envVars.find((v) => v.name === 'OLLAMA_HOST')?.value).toBe(HOST);
  });

  it('keeps the ollama wording when no direct binary is given', () => {
    const h = agentHint('unknown-target' as never, { ollamaHost: HOST });
    expect(h.summary).toContain('ollama launch');
  });
});
