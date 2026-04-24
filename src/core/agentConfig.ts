import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDir } from '../infra/platform.js';
import type { LaunchId } from './launch.js';

/**
 * When hfo hands off to `ollama launch <agent>`, it also (1) writes a small
 * JSON manifest recording which model was bound to which agent, and (2)
 * prints a per-agent hint telling the user how to *confirm* the wiring
 * inside that agent's own configuration.
 *
 * The goal is **never to mutate user-owned config files** (claude.json,
 * codex/config.toml, VS Code settings.json). Doing so would be fragile
 * across tool versions and invite file-corruption bug reports. Instead, we
 * write only our own manifest to our own config dir and educate the user
 * about the env vars / config keys they may need to set themselves.
 */

export interface AgentLaunchManifest {
  agent: LaunchId;
  model: string | null;
  ollamaHost: string;
  launchedAt: string;    // ISO timestamp
  hfoVersion?: string;
}

export interface AgentHint {
  /** One-line summary of the wiring for this agent. */
  summary: string;
  /** Env vars the user typically sets (pre-filled with the current values when possible). */
  envVars: Array<{ name: string; value?: string; note?: string }>;
  /** Path the user can inspect to confirm their agent's own config. */
  configPath?: string;
  /** Canonical docs for routing this agent through Ollama, if known. */
  docsUrl?: string;
}

/** Default Ollama HTTP endpoint. Kept as a constant so tests can stub. */
export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

/** Resolve the folder hfo writes agent-launch manifests into. */
export function agentLaunchesDir(): string {
  return join(configDir(), 'agent-launches');
}

/** Resolve the manifest path for a given agent. */
export function agentManifestPath(id: LaunchId): string {
  return join(agentLaunchesDir(), `${id}.json`);
}

/**
 * Persist a small audit record of the handoff. Safe to call on every
 * --launch: overwrites the previous manifest for the same agent so the
 * file always reflects the last wiring. Returns the path it wrote to.
 */
export async function writeLaunchManifest(
  entry: Omit<AgentLaunchManifest, 'launchedAt'>,
): Promise<string> {
  const dir = agentLaunchesDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${entry.agent}.json`);
  const record: AgentLaunchManifest = {
    ...entry,
    launchedAt: new Date().toISOString(),
  };
  await writeFile(path, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return path;
}

/**
 * Returns the per-agent hint block with any provided values pre-filled. The
 * summary + envVars shape is designed to be rendered as both plain stdout
 * lines (headless) and a styled Ink panel (TUI), without re-deriving the
 * data in each renderer.
 */
export function agentHint(
  id: LaunchId,
  opts: { model?: string | null; ollamaHost?: string } = {},
): AgentHint {
  const host = opts.ollamaHost ?? DEFAULT_OLLAMA_HOST;
  const model = opts.model ?? undefined;

  switch (id) {
    case 'claude':
      return {
        summary:
          'Claude Code reads ANTHROPIC_BASE_URL to decide where to send requests. Point it at your Ollama host to use the local model.',
        envVars: [
          { name: 'ANTHROPIC_BASE_URL', value: host, note: 'Redirects Claude Code to Ollama' },
          { name: 'ANTHROPIC_MODEL', value: model, note: 'Default model for this shell session' },
        ],
        configPath: '~/.claude.json',
        docsUrl: 'https://ollama.com/blog/claude',
      };
    case 'codex':
      return {
        summary:
          'OpenAI Codex CLI reads OPENAI_BASE_URL and OPENAI_MODEL; set them to your Ollama host + model.',
        envVars: [
          { name: 'OPENAI_BASE_URL', value: `${host}/v1`, note: 'Ollama exposes an OpenAI-compatible API at /v1' },
          { name: 'OPENAI_MODEL',    value: model,        note: 'Model tag registered in Ollama' },
          { name: 'OPENAI_API_KEY',  value: 'ollama',     note: 'Any non-empty string — Codex only checks presence' },
        ],
        configPath: '~/.codex/config.toml',
        docsUrl: 'https://ollama.com/blog/codex',
      };
    case 'cline':
      return {
        summary:
          'Cline picks its provider from VS Code settings. Set these keys in User Settings (or .vscode/settings.json) to point at Ollama.',
        envVars: [
          { name: 'cline.apiProvider',      value: 'ollama',  note: 'VS Code settings key' },
          { name: 'cline.ollamaBaseUrl',    value: host,      note: 'VS Code settings key' },
          { name: 'cline.ollamaModelId',    value: model,     note: 'VS Code settings key' },
        ],
        configPath: '~/.vscode/settings.json (or workspace settings)',
      };
    case 'copilot':
      return {
        summary:
          'GitHub Copilot CLI does not natively target Ollama yet; Ollama launch wraps it in an adapter. Keep an eye on GH_COPILOT_MODEL to override the model.',
        envVars: [
          { name: 'GH_COPILOT_MODEL', value: model, note: 'Overrides the default Copilot model for this session' },
        ],
      };
    case 'opencode':
      return {
        summary:
          'OpenCode reads its config from ~/.config/opencode/config.json. Set provider "ollama" with the host + model below.',
        envVars: [
          { name: 'OPENCODE_PROVIDER', value: 'ollama', note: 'Also settable in config.json as "provider"' },
          { name: 'OPENCODE_MODEL',    value: model,    note: 'Also settable in config.json as "model"' },
          { name: 'OPENCODE_BASE_URL', value: host,     note: 'Also settable in config.json as "baseUrl"' },
        ],
        configPath: '~/.config/opencode/config.json',
      };
    case 'droid':
      return {
        summary:
          'Factory.ai Droid auto-detects Ollama when FACTORY_USE_OLLAMA=1. Set the env vars below for this shell.',
        envVars: [
          { name: 'FACTORY_USE_OLLAMA', value: '1',   note: 'Switches Droid to the local Ollama backend' },
          { name: 'FACTORY_OLLAMA_URL', value: host,  note: 'Optional — defaults to http://localhost:11434' },
          { name: 'FACTORY_MODEL',      value: model, note: 'Optional — overrides the default model' },
        ],
      };
    case 'vscode':
      return {
        summary:
          'VS Code itself needs no wiring; the Continue / Cline / Codeium extensions are what actually talk to Ollama. Set the relevant extension keys in settings.json.',
        envVars: [
          { name: 'continue.models[].provider', value: 'ollama', note: 'If using Continue' },
          { name: 'continue.models[].model',    value: model,    note: 'If using Continue' },
          { name: 'continue.models[].apiBase',  value: host,     note: 'If using Continue' },
        ],
        configPath: '~/.vscode/settings.json (or the workspace one)',
      };
    case 'hermes':
    case 'kimi':
    case 'openclaw':
    case 'pi':
    default:
      return {
        summary: `\`ollama launch ${id}\` handles its own wiring; no additional configuration is required on the hfo side.`,
        envVars: [
          { name: 'OLLAMA_HOST', value: host, note: 'Respected by most Ollama-aware CLIs if they ever need an override' },
        ],
      };
  }
}

/**
 * Render the hint as a plain-text block suitable for stdout in headless
 * mode or for piping into an Ink `<Text>`. Produces something like:
 *
 *   ▸ Claude Code — Claude Code reads ANTHROPIC_BASE_URL ...
 *
 *     ANTHROPIC_BASE_URL=http://localhost:11434  # Redirects Claude Code
 *     ANTHROPIC_MODEL=llama3.1:8b                # Default model
 *
 *     Config: ~/.claude.json
 *     Docs:   https://ollama.com/blog/claude
 */
export function renderHint(id: LaunchId, hint: AgentHint): string {
  const lines: string[] = [];
  lines.push(`▸ ${id} — ${hint.summary}`);
  lines.push('');
  const maxName = Math.max(0, ...hint.envVars.map((v) => v.name.length));
  for (const v of hint.envVars) {
    const value = v.value ?? '<set me>';
    const pad = ' '.repeat(maxName - v.name.length);
    const note = v.note ? `  # ${v.note}` : '';
    lines.push(`    ${v.name}${pad}=${value}${note}`);
  }
  if (hint.configPath) lines.push('', `    Config: ${hint.configPath}`);
  if (hint.docsUrl)    lines.push(`    Docs:   ${hint.docsUrl}`);
  return lines.join('\n');
}
