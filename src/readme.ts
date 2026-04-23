export interface RecommendedParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  minP?: number;
  ctxSize?: number;
}

export interface CardInfo {
  params: RecommendedParams;
  foundKeys: string[];
  raw: string | null;
}

export async function fetchReadme(repoId: string, token?: string): Promise<string | null> {
  const headers: Record<string, string> = { 'User-Agent': 'runllama/0.2' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`https://huggingface.co/${repoId}/raw/main/README.md`, { headers });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const RANGE = String.raw`${NUM}\s*(?:-|to|–|~)\s*${NUM}`;

function firstMatch(text: string, patterns: RegExp[]): number | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    // Range → average; single → parse
    if (m[2] !== undefined) {
      const a = parseFloat(m[1]);
      const b = parseFloat(m[2]);
      if (!isNaN(a) && !isNaN(b)) return +((a + b) / 2).toFixed(3);
    }
    const n = parseFloat(m[1]);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

export function parseCardParams(readme: string): CardInfo {
  const text = readme.toLowerCase();
  const found: string[] = [];
  const params: RecommendedParams = {};

  const temp = firstMatch(text, [
    new RegExp(`temperature\\s*[:=]\\s*${RANGE}`, 'i'),
    new RegExp(`temperature\\s*[:=]\\s*${NUM}`, 'i'),
    new RegExp(`\\btemp\\s*[:=]\\s*${NUM}`, 'i'),
  ]);
  if (temp !== undefined && temp >= 0 && temp <= 2) {
    params.temperature = temp;
    found.push('temperature');
  }

  const topP = firstMatch(text, [
    new RegExp(`top[\\s_-]?p\\s*[:=]\\s*${RANGE}`, 'i'),
    new RegExp(`top[\\s_-]?p\\s*[:=]\\s*${NUM}`, 'i'),
  ]);
  if (topP !== undefined && topP > 0 && topP <= 1) {
    params.topP = topP;
    found.push('top_p');
  }

  const topK = firstMatch(text, [
    new RegExp(`top[\\s_-]?k\\s*[:=]\\s*${NUM}`, 'i'),
  ]);
  if (topK !== undefined && topK >= 1 && topK <= 500) {
    params.topK = Math.round(topK);
    found.push('top_k');
  }

  const rp = firstMatch(text, [
    new RegExp(`rep(?:eat)?[\\s_-]?penalty\\s*[:=]\\s*${RANGE}`, 'i'),
    new RegExp(`rep(?:eat)?[\\s_-]?penalty\\s*[:=]\\s*${NUM}`, 'i'),
  ]);
  if (rp !== undefined && rp >= 0.5 && rp <= 2) {
    params.repeatPenalty = rp;
    found.push('repeat_penalty');
  }

  const minP = firstMatch(text, [
    new RegExp(`min[\\s_-]?p\\s*[:=]\\s*${NUM}`, 'i'),
  ]);
  if (minP !== undefined && minP >= 0 && minP <= 1) {
    params.minP = minP;
    found.push('min_p');
  }

  const ctx = firstMatch(text, [
    new RegExp(`(?:ctx[\\s_-]?size|context[\\s_-]?(?:length|size|window))\\s*[:=]?\\s*${NUM}`, 'i'),
    new RegExp(`--ctx-size\\s+${NUM}`, 'i'),
  ]);
  if (ctx !== undefined && ctx >= 512 && ctx <= 1_000_000) {
    params.ctxSize = Math.round(ctx);
    found.push('ctx_size');
  }

  return { params, foundKeys: found, raw: readme };
}

export async function loadCardParams(repoId: string, token?: string): Promise<CardInfo> {
  const readme = await fetchReadme(repoId, token);
  if (!readme) return { params: {}, foundKeys: [], raw: null };
  return parseCardParams(readme);
}
