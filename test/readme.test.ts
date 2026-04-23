import { describe, it, expect } from 'vitest';
import { parseCardParams } from '../src/readme.js';

describe('parseCardParams', () => {
  it('extracts temperature / top_p / top_k', () => {
    const md = `
# Recommended settings
temperature: 0.7
top_p: 0.95
top_k: 40
`;
    const out = parseCardParams(md);
    expect(out.params.temperature).toBe(0.7);
    expect(out.params.topP).toBe(0.95);
    expect(out.params.topK).toBe(40);
    expect(out.foundKeys.sort()).toEqual(['temperature', 'top_k', 'top_p']);
  });

  it('handles ranges by averaging', () => {
    const md = `Temperature: 0.6 - 0.8`;
    const out = parseCardParams(md);
    expect(out.params.temperature).toBeCloseTo(0.7, 2);
  });

  it('rejects out-of-band values silently', () => {
    const md = `temperature: 99`;
    const out = parseCardParams(md);
    expect(out.params.temperature).toBeUndefined();
  });

  it('extracts context length variants', () => {
    const md = `ctx_size: 16384`;
    const out = parseCardParams(md);
    expect(out.params.ctxSize).toBe(16384);
  });

  it('returns empty params when nothing matches', () => {
    const out = parseCardParams('nothing to see here');
    expect(out.foundKeys).toEqual([]);
    expect(out.params).toEqual({});
  });
});
