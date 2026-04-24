import type { HardwareProfile } from './hardware.js';

/**
 * Standardised prompt suite used by `hfo --bench`. Kept small (4 prompts,
 * ~800 total output tokens) so the whole run finishes in under a minute on
 * most hardware, but varied enough to exercise the model across code,
 * reasoning, translation, and short-form tasks. The `expectTokens` field
 * is a hint for the tokens-to-generate target (max_tokens).
 */
export interface BenchPrompt {
  id: string;
  prompt: string;
  expectTokens: number;
}

export const BENCH_PROMPTS: BenchPrompt[] = [
  {
    id: 'warmup',
    prompt: 'Say the single word "ready" and nothing else.',
    expectTokens: 16,
  },
  {
    id: 'code',
    prompt: 'Write a concise Python function `reverse_string(s)` that returns the input string reversed. Include only the function, no commentary.',
    expectTokens: 128,
  },
  {
    id: 'reasoning',
    prompt: 'In one paragraph (under 120 words), explain what backpropagation does during the training of a feed-forward neural network.',
    expectTokens: 192,
  },
  {
    id: 'translation',
    prompt: 'Translate the following English sentence to French, then to Spanish. Output each on its own line, prefixed with the language code. Sentence: "The quick brown fox jumps over the lazy dog."',
    expectTokens: 128,
  },
];

/**
 * Per-prompt result recorded by the benchmark runner.
 *   - `ttftMs`: time from request sent to first token received.
 *   - `totalMs`: wall-clock time for the full generation (request → done).
 *   - `outputTokens`: number of tokens Ollama reports generating (eval_count).
 *   - `tokensPerSec`: outputTokens / (eval_duration ns → seconds). Uses the
 *     server-reported eval_duration when available (most accurate); falls
 *     back to wall-clock if the field is missing.
 */
export interface BenchRun {
  id: string;
  prompt: string;
  outputTokens: number;
  ttftMs: number;
  totalMs: number;
  tokensPerSec: number;
}

export interface BenchAggregate {
  /** Tokens per second, averaged across all non-warmup runs. */
  tokensPerSec: number;
  /** Mean time-to-first-token, non-warmup runs. */
  ttftMs: number;
  /** Total tokens generated across all runs. */
  totalTokens: number;
  /** Total wall-clock across all runs. */
  totalMs: number;
}

export interface BenchReport {
  /** Ollama model tag that was benched. */
  tag: string;
  /** Ollama daemon version (`ollama --version`) if available. */
  ollamaVersion: string | null;
  /** hfo version from package.json. */
  hfoVersion: string;
  /** Trimmed hardware snapshot. */
  hardware: {
    gpuName: string | null;
    vramMiB: number;
    ramMiB: number;
    cpuCores: number;
    platform: string;
  };
  /** Each prompt's result, in order. */
  runs: BenchRun[];
  /** Aggregate stats excluding the warmup. */
  aggregate: BenchAggregate;
  /** ISO timestamp of when the bench completed. */
  submittedAt: string;
  /** Schema version so submissions can be re-parsed safely as the format evolves. */
  schema: 'hfo-bench-v1';
}

export interface OllamaGenerateChunk {
  model?: string;
  response?: string;
  done?: boolean;
  eval_count?: number;
  eval_duration?: number;   // nanoseconds
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  total_duration?: number;
}

/**
 * Core run loop: POST to `/api/generate` with streaming and collect tok/s
 * + TTFT. Extracted from runBench so tests can stub the `fetch` impl.
 *
 * The fetch impl is injected for testability; production calls pass the
 * global `fetch` (Node ≥ 18 has it built-in).
 */
export async function runOne(
  host: string,
  tag: string,
  prompt: BenchPrompt,
  fetchImpl: typeof fetch = fetch,
): Promise<BenchRun> {
  const url = `${host.replace(/\/$/, '')}/api/generate`;
  const body = JSON.stringify({
    model: tag,
    prompt: prompt.prompt,
    stream: true,
    options: {
      num_predict: prompt.expectTokens,
      temperature: 0.2,
    },
  });

  const startedAt = performance.now();
  let firstChunkAt: number | null = null;
  let outputTokens = 0;
  let evalDurationNs = 0;

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama returned ${res.status} for ${prompt.id}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // Streaming NDJSON: each line is a complete JSON object.
  // We tally `eval_count` + `eval_duration` from the final chunk.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstChunkAt == null) firstChunkAt = performance.now();
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (!line) continue;
      try {
        const chunk = JSON.parse(line) as OllamaGenerateChunk;
        if (chunk.eval_count != null)    outputTokens  = chunk.eval_count;
        if (chunk.eval_duration != null) evalDurationNs = chunk.eval_duration;
      } catch {
        /* partial or malformed — skip */
      }
    }
  }

  const endedAt = performance.now();
  const totalMs = endedAt - startedAt;
  const ttftMs = (firstChunkAt ?? endedAt) - startedAt;
  const tokensPerSec =
    evalDurationNs > 0
      ? outputTokens / (evalDurationNs / 1_000_000_000)
      : totalMs > 0
        ? (outputTokens / totalMs) * 1000
        : 0;

  return {
    id: prompt.id,
    prompt: prompt.prompt,
    outputTokens,
    ttftMs,
    totalMs,
    tokensPerSec,
  };
}

/** Aggregate non-warmup runs into one report-level summary. */
export function aggregate(runs: BenchRun[]): BenchAggregate {
  const scored = runs.filter((r) => r.id !== 'warmup');
  if (scored.length === 0) {
    return { tokensPerSec: 0, ttftMs: 0, totalTokens: 0, totalMs: 0 };
  }
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  return {
    tokensPerSec: sum(scored, (r) => r.tokensPerSec) / scored.length,
    ttftMs:        sum(scored, (r) => r.ttftMs)       / scored.length,
    totalTokens:   sum(runs,   (r) => r.outputTokens),
    totalMs:       sum(runs,   (r) => r.totalMs),
  };
}

export interface RunBenchOptions {
  host?: string;
  ollamaVersion?: string | null;
  hfoVersion: string;
  hardware: HardwareProfile;
  fetchImpl?: typeof fetch;
}

/**
 * End-to-end benchmark runner. Returns a structured report ready to
 * JSON-encode. Caller is responsible for printing / persisting.
 */
export async function runBench(tag: string, opts: RunBenchOptions): Promise<BenchReport> {
  const host = opts.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const runs: BenchRun[] = [];
  for (const p of BENCH_PROMPTS) {
    runs.push(await runOne(host, tag, p, opts.fetchImpl));
  }
  return {
    tag,
    ollamaVersion: opts.ollamaVersion ?? null,
    hfoVersion: opts.hfoVersion,
    hardware: {
      gpuName:  opts.hardware.gpuName,
      vramMiB:  opts.hardware.vramMiB,
      ramMiB:   opts.hardware.ramMiB,
      cpuCores: opts.hardware.cpuCores,
      platform: opts.hardware.platform,
    },
    runs,
    aggregate: aggregate(runs),
    submittedAt: new Date().toISOString(),
    schema: 'hfo-bench-v1',
  };
}
