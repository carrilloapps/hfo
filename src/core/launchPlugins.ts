import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDir } from '../infra/platform.js';
import type { LaunchId, LaunchTarget } from './launch.js';

/**
 * User-defined launch targets.
 *
 * hfo ships integrations for the agents Ollama serves plus the two it spawns
 * itself, but that list can never keep pace with every coding agent. A plugin
 * file lets a user register their own without patching hfo:
 *
 *   <configDir>/hfo/launch-plugins.json
 *   {
 *     "targets": [
 *       {
 *         "id": "myagent",
 *         "name": "My Agent",
 *         "description": "In-house coding agent",
 *         "bin": "myagent",
 *         "args": ["chat"],
 *         "ollamaBackend": true,
 *         "modelFlag": "--model"
 *       }
 *     ]
 *   }
 *
 * Plugins are always `direct` runners: if Ollama served the agent it would
 * already be in the built-in list. A malformed entry is skipped with a reason
 * rather than throwing — a bad plugin file must never stop the picker from
 * rendering the agents that do work.
 */

/** One entry as it appears in the JSON file, before validation. */
export interface LaunchPluginSpec {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  bin?: unknown;
  args?: unknown;
  fallbackPaths?: unknown;
  aliases?: unknown;
  docsUrl?: unknown;
  ollamaBackend?: unknown;
  modelFlag?: unknown;
}

export interface PluginLoadResult {
  targets: LaunchTarget[];
  /** Human-readable reason per rejected entry, in file order. */
  errors: string[];
}

/** Where hfo looks for user-defined targets. */
export function launchPluginsPath(): string {
  return join(configDir(), 'launch-plugins.json');
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function asStringArray(value: unknown, field: string, errors: string[], label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    errors.push(`${label}: "${field}" must be an array of strings`);
    return undefined;
  }
  return value as string[];
}

/**
 * Validate one spec into a LaunchTarget, or return null and push the reason.
 *
 * `reserved` is the set of ids and aliases already taken, so a plugin can never
 * shadow a built-in target — that would silently change what `hfo --launch
 * claude` does.
 */
export function validatePluginTarget(
  spec: LaunchPluginSpec,
  index: number,
  reserved: ReadonlySet<string>,
  errors: string[],
): LaunchTarget | null {
  const label = typeof spec.id === 'string' && spec.id ? `target "${spec.id}"` : `target #${index + 1}`;

  if (typeof spec.id !== 'string' || !ID_PATTERN.test(spec.id)) {
    errors.push(`${label}: "id" must be lowercase letters, digits, dot, dash or underscore`);
    return null;
  }
  if (reserved.has(spec.id)) {
    errors.push(`${label}: "${spec.id}" is already used by a built-in target`);
    return null;
  }
  if (typeof spec.name !== 'string' || spec.name.trim() === '') {
    errors.push(`${label}: "name" is required`);
    return null;
  }
  if (typeof spec.bin !== 'string' || spec.bin.trim() === '') {
    errors.push(`${label}: "bin" is required — plugins always spawn their own CLI`);
    return null;
  }

  const description = typeof spec.description === 'string' ? spec.description : '';
  const docsUrl = typeof spec.docsUrl === 'string' ? spec.docsUrl : undefined;

  const args = asStringArray(spec.args, 'args', errors, label);
  if (spec.args !== undefined && args === undefined) return null;

  const fallbackPaths = asStringArray(spec.fallbackPaths, 'fallbackPaths', errors, label);
  if (spec.fallbackPaths !== undefined && fallbackPaths === undefined) return null;

  const aliases = asStringArray(spec.aliases, 'aliases', errors, label);
  if (spec.aliases !== undefined && aliases === undefined) return null;

  const clashing = aliases?.find((a) => reserved.has(a));
  if (clashing) {
    errors.push(`${label}: alias "${clashing}" is already used by a built-in target`);
    return null;
  }

  if (spec.ollamaBackend !== undefined && typeof spec.ollamaBackend !== 'boolean') {
    errors.push(`${label}: "ollamaBackend" must be a boolean`);
    return null;
  }
  if (spec.modelFlag !== undefined && spec.modelFlag !== null && typeof spec.modelFlag !== 'string') {
    errors.push(`${label}: "modelFlag" must be a string or null`);
    return null;
  }

  return {
    id: spec.id as LaunchId,
    name: spec.name,
    description,
    docsUrl,
    aliases,
    runner: { kind: 'direct', bin: spec.bin, args, fallbackPaths },
    ollamaBackend: spec.ollamaBackend as boolean | undefined,
    modelFlag: spec.modelFlag as string | null | undefined,
  };
}

/** Validate a parsed plugin document. Exported so the file read stays separate. */
export function parseLaunchPlugins(
  doc: unknown,
  reserved: ReadonlySet<string>,
): PluginLoadResult {
  const errors: string[] = [];
  if (doc === null || typeof doc !== 'object') {
    return { targets: [], errors: ['plugin file must contain a JSON object'] };
  }
  const specs = (doc as { targets?: unknown }).targets;
  if (specs === undefined) {
    return { targets: [], errors: ['plugin file has no "targets" array'] };
  }
  if (!Array.isArray(specs)) {
    return { targets: [], errors: ['"targets" must be an array'] };
  }

  const targets: LaunchTarget[] = [];
  const seen = new Set(reserved);
  specs.forEach((spec, i) => {
    const target = validatePluginTarget((spec ?? {}) as LaunchPluginSpec, i, seen, errors);
    if (!target) return;
    targets.push(target);
    seen.add(target.id);
    for (const alias of target.aliases ?? []) seen.add(alias);
  });
  return { targets, errors };
}

/**
 * Read and validate the plugin file. A missing file is the normal case and
 * yields no targets and no errors; an unreadable or malformed one yields the
 * reason so the UI can surface it without failing the launch picker.
 */
export async function loadLaunchPlugins(
  reserved: ReadonlySet<string>,
  path: string = launchPluginsPath(),
): Promise<PluginLoadResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { targets: [], errors: [] };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return {
      targets: [],
      errors: [`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  return parseLaunchPlugins(doc, reserved);
}
