import { execa } from 'execa';

/**
 * Every target that `ollama launch <name>` supports, mirrored from
 * `ollama launch --help` as of Ollama 0.21+. Kept static so the picker renders
 * even when Ollama is offline; if Ollama adds more integrations, update this
 * list and the runtime probe below to keep the UI in sync.
 */
export type LaunchId =
  | 'claude'
  | 'cline'
  | 'codex'
  | 'copilot'
  | 'droid'
  | 'hermes'
  | 'kimi'
  | 'opencode'
  | 'openclaw'
  | 'pi'
  | 'vscode';

export interface LaunchTarget {
  id: LaunchId;
  name: string;
  description: string;
  docsUrl?: string;
  aliases?: string[];
}

export const LAUNCH_TARGETS: LaunchTarget[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    description: "Anthropic's agentic coding CLI, wired to point at a local Ollama model.",
    docsUrl: 'https://ollama.com/blog/claude',
  },
  {
    id: 'cline',
    name: 'Cline',
    description: 'Autonomous coding agent for VS Code; launches configured against Ollama.',
  },
  {
    id: 'codex',
    name: 'Codex',
    description: "OpenAI Codex CLI running against a local model instead of the cloud.",
    docsUrl: 'https://ollama.com/blog/codex',
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    description: "GitHub Copilot's terminal assistant, pointed at Ollama.",
    aliases: ['copilot-cli'],
  },
  {
    id: 'droid',
    name: 'Droid',
    description: 'Factory.ai Droid coding agent using your local models.',
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    description: 'General-purpose autonomous agent wrapper.',
  },
  {
    id: 'kimi',
    name: 'Kimi Code CLI',
    description: "Moonshot AI's coding CLI against Ollama.",
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Open-source alternative to Claude Code / Codex; integrates cleanly with Ollama.',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description: 'Turns Ollama into a chat persona across WhatsApp, Telegram, Slack, Discord.',
    aliases: ['clawdbot', 'moltbot'],
  },
  {
    id: 'pi',
    name: 'Pi',
    description: 'Inflection-style conversational agent backed by a local model.',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: "Opens VS Code pre-configured with the selected Ollama model.",
    aliases: ['code'],
  },
];

export function findTarget(id: string): LaunchTarget | undefined {
  const low = id.toLowerCase();
  return LAUNCH_TARGETS.find((t) => t.id === low || t.aliases?.includes(low));
}

/**
 * Probes the live `ollama launch --help` output to confirm which integration
 * IDs the local Ollama version actually supports. Falls back to the static
 * list if the command is unavailable.
 */
export async function detectAvailableTargets(): Promise<LaunchId[]> {
  try {
    const { stdout } = await execa('ollama', ['launch', '--help']);
    const supported = new Set<LaunchId>();
    for (const t of LAUNCH_TARGETS) {
      const re = new RegExp(`^\\s+${t.id}\\b`, 'm');
      if (re.test(stdout)) supported.add(t.id);
    }
    if (supported.size === 0) return LAUNCH_TARGETS.map((t) => t.id);
    return Array.from(supported);
  } catch {
    return LAUNCH_TARGETS.map((t) => t.id);
  }
}

export interface LaunchOptions {
  model?: string;       // --model <model>
  config?: boolean;     // --config (no auto-launch)
  yes?: boolean;        // --yes
  extra?: string[];     // pass-through args after `--`
}

/**
 * Build the argv for `ollama launch`, mirroring the official CLI signature:
 *
 *   ollama launch <integration> [--model M] [--config] [--yes] [-- EXTRA...]
 */
export function buildLaunchArgs(id: LaunchId, opts: LaunchOptions = {}): string[] {
  const args = ['launch', id];
  if (opts.model) args.push('--model', opts.model);
  if (opts.config) args.push('--config');
  if (opts.yes) args.push('--yes');
  if (opts.extra && opts.extra.length > 0) {
    args.push('--', ...opts.extra);
  }
  return args;
}

/**
 * Runs `ollama launch` inheriting stdio so the integration has a real TTY.
 * Intended to be invoked AFTER Ink unmounts (`instance.unmount()` or after
 * `waitUntilExit`) so the user gets a clean handoff to the launched tool.
 */
export async function runLaunch(id: LaunchId, opts: LaunchOptions = {}): Promise<number> {
  const args = buildLaunchArgs(id, opts);
  const result = await execa('ollama', args, { stdio: 'inherit', reject: false });
  return result.exitCode ?? -1;
}
