import { execa } from 'execa';
import { resolveBinary } from '../infra/platform.js';
import {
  agentHint,
  renderHint,
  writeLaunchManifest,
  DEFAULT_OLLAMA_HOST,
} from './agentConfig.js';

/**
 * Every integration hfo can hand off to.
 *
 * Most are served by `ollama launch <name>` (mirrored from `ollama launch
 * --help` as of Ollama 0.21+). A few agents Ollama does not know about are
 * spawned by hfo directly — see `LaunchRunner`. The list is static so the
 * picker renders even when Ollama is offline; the runtime probe below is what
 * decides which entries are actually usable on this machine.
 */
export type LaunchId =
  | 'antigravity'
  | 'claude'
  | 'cline'
  | 'codex'
  | 'copilot'
  | 'droid'
  | 'hermes'
  | 'kimi'
  | 'kiro'
  | 'opencode'
  | 'openclaw'
  | 'pi'
  | 'vscode';

/**
 * How hfo starts a given target.
 *
 * - `ollama` (the default): delegate to `ollama launch <id>`, which owns the
 *   wiring and points the agent at the local daemon.
 * - `direct`: Ollama has no integration for this agent, so hfo spawns the
 *   vendor's own CLI. `fallbackPaths` covers installers that write outside
 *   PATH for non-login shells.
 */
export type LaunchRunner =
  | { kind: 'ollama' }
  | { kind: 'direct'; bin: string; args?: string[]; fallbackPaths?: string[] };

export interface LaunchTarget {
  id: LaunchId;
  name: string;
  description: string;
  docsUrl?: string;
  aliases?: string[];
  /** Defaults to `{ kind: 'ollama' }` when omitted. */
  runner?: LaunchRunner;
  /**
   * Whether this agent can actually use an Ollama model as its inference
   * backend. False for vendors that only talk to their own hosted service —
   * hfo still launches them, but it must not pretend `--model <ollama-tag>`
   * will bind, and the hint explains what the user's options really are.
   */
  ollamaBackend?: boolean;
  /**
   * For `direct` targets: the flag this CLI uses to pick a model, or null when
   * it has none. Only consulted when the user passes an explicit --model.
   */
  modelFlag?: string | null;
}

/** Normalized accessor — every target has a runner, explicit or defaulted. */
export function runnerFor(target: LaunchTarget): LaunchRunner {
  return target.runner ?? { kind: 'ollama' };
}

/** True when this agent can use a local Ollama model as its backend. */
export function bindsOllamaModel(target: LaunchTarget): boolean {
  return target.ollamaBackend ?? true;
}

export const LAUNCH_TARGETS: LaunchTarget[] = [
  {
    id: 'antigravity',
    name: 'Antigravity CLI',
    description:
      "Google's agentic coding CLI (`agy`). Launched directly — Ollama has no integration for it, and Antigravity only talks to Google's hosted models.",
    docsUrl: 'https://antigravity.google/docs/getting-started?tab=cli',
    aliases: ['agy'],
    runner: {
      kind: 'direct',
      bin: 'agy',
      // The installer writes outside PATH for non-login shells.
      fallbackPaths: [
        '~/.local/bin/agy',
        '%LOCALAPPDATA%/agy/bin/agy.exe',
        '%LOCALAPPDATA%/agy/bin/agy',
      ],
    },
    ollamaBackend: false,
    modelFlag: '--model',
  },
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
    id: 'kiro',
    name: 'Kiro CLI',
    description:
      "AWS's agentic coding CLI (`kiro-cli`). Launched directly — Ollama has no integration for it, and Kiro has no custom-endpoint support yet.",
    docsUrl: 'https://kiro.dev/docs/cli/',
    aliases: ['kiro-cli'],
    runner: {
      kind: 'direct',
      bin: 'kiro-cli',
      // `kiro-cli` on its own prints usage; `chat` is the interactive agent.
      args: ['chat'],
      fallbackPaths: [
        '~/.kiro/bin/kiro-cli',
        '~/.local/bin/kiro-cli',
        '%LOCALAPPDATA%/Programs/kiro-cli/kiro-cli.exe',
      ],
    },
    ollamaBackend: false,
    modelFlag: null,
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

/**
 * Built-in ids and aliases. A plugin may not reuse any of these, so
 * `hfo --launch claude` always means the same thing.
 */
export function reservedTargetNames(): Set<string> {
  const names = new Set<string>();
  for (const t of LAUNCH_TARGETS) {
    names.add(t.id);
    for (const alias of t.aliases ?? []) names.add(alias);
  }
  return names;
}

/**
 * Built-in targets plus any the user defined in their plugin file.
 *
 * Resolved on demand rather than cached, so editing the plugin file takes
 * effect on the next command without restarting anything. Plugin problems are
 * returned alongside the targets instead of thrown — a broken plugin must not
 * hide the agents that do work.
 */
export async function allLaunchTargets(): Promise<{
  targets: LaunchTarget[];
  pluginErrors: string[];
}> {
  const { loadLaunchPlugins } = await import('./launchPlugins.js');
  const { targets, errors } = await loadLaunchPlugins(reservedTargetNames());
  return { targets: [...LAUNCH_TARGETS, ...targets], pluginErrors: errors };
}

/** Resolve an id or alias against an explicit list — built-ins plus plugins. */
export function findTargetIn(targets: readonly LaunchTarget[], id: string): LaunchTarget | undefined {
  const low = id.toLowerCase();
  return targets.find((t) => t.id === low || t.aliases?.includes(low));
}

/** Resolve against the built-in registry only. */
export function findTarget(id: string): LaunchTarget | undefined {
  return findTargetIn(LAUNCH_TARGETS, id);
}

/**
 * Works out which targets are usable on this machine.
 *
 * The two runner kinds are probed differently:
 * - `ollama` targets are matched against the live `ollama launch --help`
 *   output, so a stale hfo never offers an integration the installed Ollama
 *   cannot serve. If that probe fails outright we assume all of them work
 *   rather than presenting an empty menu.
 * - `direct` targets are usable exactly when their binary resolves, so the
 *   menu reflects whether the vendor CLI is actually installed.
 */
export async function detectAvailableTargets(
  registry: readonly LaunchTarget[] = LAUNCH_TARGETS,
): Promise<LaunchId[]> {
  const ollamaTargets = registry.filter((t) => runnerFor(t).kind === 'ollama');
  // Pair each direct target with its narrowed runner up front, so the probe
  // below needs no second runtime check to satisfy the type.
  const directTargets = registry.flatMap((t) => {
    const runner = runnerFor(t);
    return runner.kind === 'direct' ? [{ target: t, runner }] : [];
  });

  const supported = new Set<LaunchId>();

  try {
    const { stdout } = await execa('ollama', ['launch', '--help']);
    // Collect the first word of every indented line — that is how the help
    // output lists integrations, and headings are flush left. Matching against
    // a set beats building a regex per id: a target id can come from the user's
    // plugin file, and interpolating that into a pattern would let a `.` match
    // the wrong entry (and is a ReDoS smell besides).
    const listed = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      if (!/^\s/.test(line)) continue;
      const first = line.trim().split(/\s+/)[0];
      if (first) listed.add(first);
    }

    let matched = 0;
    for (const t of ollamaTargets) {
      if (listed.has(t.id)) {
        supported.add(t.id);
        matched += 1;
      }
    }
    // Unparseable help output — don't claim every Ollama integration is gone.
    if (matched === 0) for (const t of ollamaTargets) supported.add(t.id);
  } catch {
    for (const t of ollamaTargets) supported.add(t.id);
  }

  // Direct targets are independent of Ollama entirely, so probe them either way.
  await Promise.all(
    directTargets.map(async ({ target, runner }) => {
      const found = await resolveBinary(runner.bin, runner.fallbackPaths ?? []);
      if (found) supported.add(target.id);
    }),
  );

  return registry.map((t) => t.id).filter((id) => supported.has(id));
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
 * Looks like an Ollama model tag (`llama3.1:8b`, `qwen2.5-coder:7b`)?
 *
 * Vendor CLIs that only serve their own hosted models use bare ids with no
 * colon (`gemini-3.1-pro-high`, `claude-sonnet-4-6`), so the colon is a
 * reliable tell that the user handed us a local tag the agent will reject.
 */
export function looksLikeOllamaTag(model: string): boolean {
  return model.includes(':');
}

/**
 * Build the argv for a `direct` target — the vendor's own CLI rather than
 * `ollama launch`.
 *
 * `--model` is only forwarded when that CLI actually has a model flag, and
 * even then it is the vendor's own model id, never an Ollama tag. Targets
 * whose `modelFlag` is null (Kiro CLI has no such flag) silently drop it;
 * `runLaunch` is what warns the user, so this stays a pure function.
 */
export function buildDirectArgs(target: LaunchTarget, opts: LaunchOptions = {}): string[] {
  const runner = runnerFor(target);
  const args = runner.kind === 'direct' ? [...(runner.args ?? [])] : [];
  const flag = target.modelFlag;
  if (opts.model && flag && !(bindsOllamaModel(target) === false && looksLikeOllamaTag(opts.model))) {
    args.push(flag, opts.model);
  }
  if (opts.extra && opts.extra.length > 0) args.push(...opts.extra);
  return args;
}

/**
 * Starts the chosen integration with inherited stdio so it gets a real TTY.
 * Intended to be invoked AFTER Ink unmounts (`instance.unmount()` or after
 * `waitUntilExit`) so the user gets a clean handoff to the launched tool.
 *
 * Two paths, picked by the target's runner:
 * - `ollama`  — `ollama launch <id> ...`, which owns the wiring.
 * - `direct`  — hfo spawns the vendor CLI itself, because Ollama has no
 *   integration for it. Returns 127 when that binary cannot be found, matching
 *   the shell convention for "command not found".
 *
 * Before the handoff, hfo writes a per-agent manifest to
 *   <configDir>/hfo/agent-launches/<id>.json
 * recording which model was bound to which agent and when. It also prints
 * a one-shot hint telling the user how to confirm the wiring in that
 * agent's own configuration (env vars, config keys, docs link). hfo never
 * mutates user-owned config files — only educates and records.
 */
export async function runLaunch(
  id: LaunchId,
  opts: LaunchOptions = {},
  registry: readonly LaunchTarget[] = LAUNCH_TARGETS,
): Promise<number> {
  const host = process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST;
  const target = registry.find((t) => t.id === id);
  const runner = target ? runnerFor(target) : { kind: 'ollama' as const };

  // A local tag handed to an agent that only speaks to its vendor's service
  // would be rejected downstream with a confusing error. Say so here instead,
  // and record the launch as unbound rather than claiming a binding we know
  // did not happen.
  const modelRejected =
    !!opts.model && !!target && !bindsOllamaModel(target) && looksLikeOllamaTag(opts.model);
  if (modelRejected && target) {
    process.stdout.write(
      `\n${target.name} cannot use "${opts.model}" — it only runs its vendor's hosted models,\n` +
        `so hfo is launching it without a model override.\n`,
    );
  }

  // Best-effort audit trail + hint — neither of these should block the launch.
  try {
    await writeLaunchManifest({
      agent: id,
      model: modelRejected ? null : opts.model ?? null,
      ollamaHost: host,
    });
  } catch {
    /* filesystem unavailable — continue anyway */
  }
  try {
    const hint = agentHint(id, {
      model: opts.model,
      ollamaHost: host,
      directBin: runner.kind === 'direct' ? runner.bin : undefined,
    });
    process.stdout.write('\n' + renderHint(id, hint) + '\n\n');
  } catch {
    /* hint printing is purely informational */
  }

  // A direct runner only ever comes from a target we found, so the two travel
  // together and neither needs re-checking below.
  if (target && runner.kind === 'direct') {
    const bin = await resolveBinary(runner.bin, runner.fallbackPaths ?? []);
    if (!bin) {
      process.stderr.write(
        `\n${runner.bin} is not installed or not on PATH.\n` +
          (target.docsUrl ? `Install it from ${target.docsUrl}\n` : ''),
      );
      return 127;
    }
    const result = await execa(bin, buildDirectArgs(target, opts), {
      stdio: 'inherit',
      reject: false,
    });
    return result.exitCode ?? -1;
  }

  const args = buildLaunchArgs(id, opts);
  const result = await execa('ollama', args, { stdio: 'inherit', reject: false });
  return result.exitCode ?? -1;
}
