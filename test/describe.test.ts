import { describe, it, expect } from 'vitest';
import { describeQuant, detectModality } from '../src/describe.js';

describe('describeQuant', () => {
  it('flags float types', () => {
    expect(describeQuant('F16').flavor).toBe('float');
    expect(describeQuant('BF16').flavor).toBe('float');
    expect(describeQuant('F32').flavor).toBe('float');
  });
  it('flags IQ-series as importance-matrix', () => {
    expect(describeQuant('IQ3_M').flavor).toBe('importance-matrix');
    expect(describeQuant('IQ4_XS').flavor).toBe('importance-matrix');
  });
  it('flags K-variants', () => {
    expect(describeQuant('Q4_K_M').flavor).toBe('k-variant');
    expect(describeQuant('Q5_K_S').flavor).toBe('k-variant');
  });
  it('flags <= 2-bit as extreme-quant', () => {
    expect(describeQuant('Q2_0').flavor).toBe('extreme-quant');
  });
  it('flags legacy Q-n as standard', () => {
    expect(describeQuant('Q8_0').flavor).toBe('standard');
  });
});

describe('detectModality', () => {
  it('flags llava / vision / mmproj as vision', () => {
    const m = detectModality('foo/llava-7b', [{ path: 'mmproj.gguf', size: 0, oid: '' }], 'multimodal vision-language');
    expect(m.kinds).toContain('vision');
    expect(m.hasMmproj).toBe(true);
    expect(m.note).toMatch(/mmproj/i);
  });
  it('flags coder repos as code', () => {
    const m = detectModality('bartowski/Qwen2.5-Coder-7B', [{ path: 'foo.gguf', size: 0, oid: '' }], 'code LLM');
    expect(m.kinds).toContain('code');
  });
  it('flags embedding repos', () => {
    const m = detectModality('BAAI/bge-large-en', [{ path: 'foo.gguf', size: 0, oid: '' }], 'embedding model');
    expect(m.kinds).toContain('embedding');
  });
  it('always includes text as base modality', () => {
    const m = detectModality('foo/bar', [{ path: 'foo.gguf', size: 0, oid: '' }], '');
    expect(m.kinds).toContain('text');
  });
});
