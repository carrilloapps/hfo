import type { HfFile } from './hf.js';

export type QuantFlavor =
  | 'standard'
  | 'k-variant'
  | 'importance-matrix'
  | 'float'
  | 'extreme-quant';

export interface QuantDescription {
  flavor: QuantFlavor;
  summary: string;       // e.g. "4-bit K-quant with medium block size"
  quality: 'low' | 'medium' | 'high' | 'near-lossless';
  relativeSpeed: 'fastest' | 'fast' | 'balanced' | 'slower' | 'slowest';
}

export function describeQuant(quant: string): QuantDescription {
  const q = quant.toUpperCase();

  if (q === 'F16' || q === 'BF16') {
    return {
      flavor: 'float',
      summary: '16-bit floating point — largest size, highest fidelity.',
      quality: 'near-lossless',
      relativeSpeed: 'slowest',
    };
  }
  if (q === 'F32') {
    return {
      flavor: 'float',
      summary: 'Full 32-bit floating point — reference precision, huge footprint.',
      quality: 'near-lossless',
      relativeSpeed: 'slowest',
    };
  }

  if (q.startsWith('IQ')) {
    const bits = Number(q.match(/IQ(\d+)/)?.[1] ?? '3');
    return {
      flavor: 'importance-matrix',
      summary: `${bits}-bit importance-matrix quant — smaller than Q${bits} at similar quality.`,
      quality: bits >= 4 ? 'high' : bits === 3 ? 'medium' : 'low',
      relativeSpeed: 'balanced',
    };
  }

  const bitsMatch = q.match(/^Q(\d+)/);
  const bits = bitsMatch ? Number(bitsMatch[1]) : 0;
  const hasK = q.includes('_K');
  const size = q.includes('_S') ? 'small' : q.includes('_M') ? 'medium' : q.includes('_L') ? 'large' : q.includes('_P') ? 'perplexity-tuned' : '';

  if (hasK) {
    return {
      flavor: 'k-variant',
      summary:
        `${bits}-bit K-quant${size ? ` (${size} blocks)` : ''} — strong quality/size balance; the modern recommended family.`,
      quality: bits >= 6 ? 'near-lossless' : bits >= 5 ? 'high' : bits >= 4 ? 'high' : bits === 3 ? 'medium' : 'low',
      relativeSpeed: bits >= 6 ? 'slower' : bits >= 4 ? 'balanced' : 'fast',
    };
  }

  if (bits <= 2) {
    return {
      flavor: 'extreme-quant',
      summary: `${bits}-bit legacy quant — fits large models into tiny footprints but quality drops sharply.`,
      quality: 'low',
      relativeSpeed: 'fastest',
    };
  }

  return {
    flavor: 'standard',
    summary: `${bits}-bit legacy quant${size ? ` (${size})` : ''} — older scheme, prefer K-variants when available.`,
    quality: bits >= 8 ? 'near-lossless' : bits >= 5 ? 'high' : 'medium',
    relativeSpeed: bits >= 8 ? 'slower' : 'fast',
  };
}

export interface ModelModality {
  kinds: ('text' | 'code' | 'vision' | 'audio' | 'embedding')[];
  hasMmproj: boolean;
  note?: string;
}

export function detectModality(repoId: string, files: HfFile[], cardText: string | null): ModelModality {
  const text = `${repoId} ${cardText ?? ''}`.toLowerCase();
  const kinds: Set<ModelModality['kinds'][number]> = new Set(['text']);
  const hasMmproj = files.some((f) => /mmproj|projector/i.test(f.path));

  if (hasMmproj || /\b(llava|moondream|vision|vlm|multimodal|visual|image)\b/.test(text)) {
    kinds.add('vision');
  }
  if (/\b(whisper|bark|audio|tts|stt|voice|speech)\b/.test(text)) {
    kinds.add('audio');
  }
  if (/\b(coder|codellama|deepseek-coder|starcoder|codestral|code-assistant)\b/.test(text)) {
    kinds.add('code');
  }
  if (/\b(embedding|bge|e5|gte|nomic-embed|sentence-transformer)\b/.test(text)) {
    kinds.add('embedding');
  }

  let note: string | undefined;
  if (hasMmproj) {
    note = 'Includes an mmproj projector — Ollama needs it alongside the base GGUF for image inputs.';
  }

  return { kinds: Array.from(kinds), hasMmproj, note };
}
