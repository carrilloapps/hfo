import { describe, it, expect } from 'vitest';
import { describeQuant } from '../src/core/describe.js';

/**
 * describeQuant is a ladder of quality/speed ternaries keyed on the bit width.
 * Each case below pins one rung, so a re-tuned threshold cannot slide silently.
 */
describe('describeQuant — importance-matrix ladder', () => {
  it.each([
    ['IQ4_XS', 4, 'high'],
    ['IQ3_M', 3, 'medium'],
    ['IQ2_XXS', 2, 'low'],
    ['IQ1_S', 1, 'low'],
  ])('%s is a %i-bit imatrix quant rated %s', (quant, bits, quality) => {
    const d = describeQuant(quant);
    expect(d.flavor).toBe('importance-matrix');
    expect(d.quality).toBe(quality);
    expect(d.relativeSpeed).toBe('balanced');
    expect(d.summary).toContain(`${bits}-bit`);
  });

  it('defaults to 3 bits when the IQ label carries no number', () => {
    const d = describeQuant('IQ_XS');
    expect(d.flavor).toBe('importance-matrix');
    expect(d.summary).toContain('3-bit');
    expect(d.quality).toBe('medium');
  });
});

describe('describeQuant — K-variant ladder', () => {
  it.each([
    ['Q8_K', 8, 'near-lossless', 'slower'],
    ['Q6_K', 6, 'near-lossless', 'slower'],
    ['Q5_K_M', 5, 'high', 'balanced'],
    ['Q4_K_M', 4, 'high', 'balanced'],
    ['Q3_K_S', 3, 'medium', 'fast'],
    ['Q2_K', 2, 'low', 'fast'],
  ])('%s is a %i-bit K-quant rated %s / %s', (quant, bits, quality, speed) => {
    const d = describeQuant(quant);
    expect(d.flavor).toBe('k-variant');
    expect(d.quality).toBe(quality);
    expect(d.relativeSpeed).toBe(speed);
    expect(d.summary).toContain(`${bits}-bit`);
  });

  it.each([
    ['Q4_K_S', 'small'],
    ['Q4_K_M', 'medium'],
    ['Q4_K_L', 'large'],
    ['Q4_K_P', 'perplexity-tuned'],
  ])('%s names its block size as %s', (quant, size) => {
    expect(describeQuant(quant).summary).toContain(`(${size} blocks)`);
  });

  it('omits the block-size parenthetical when there is no size suffix', () => {
    const d = describeQuant('Q4_K');
    expect(d.flavor).toBe('k-variant');
    expect(d.summary).not.toContain('blocks)');
  });
});

describe('describeQuant — extreme and legacy', () => {
  it.each(['Q2_0', 'Q1_0'])('%s is an extreme quant', (quant) => {
    const d = describeQuant(quant);
    expect(d.flavor).toBe('extreme-quant');
    expect(d.quality).toBe('low');
    expect(d.relativeSpeed).toBe('fastest');
  });

  it.each([
    ['Q8_0', 8, 'near-lossless', 'slower'],
    ['Q6_0', 6, 'high', 'fast'],
    ['Q5_0', 5, 'high', 'fast'],
    ['Q4_0', 4, 'medium', 'fast'],
    ['Q3_0', 3, 'medium', 'fast'],
  ])('%s is a %i-bit legacy quant rated %s / %s', (quant, bits, quality, speed) => {
    const d = describeQuant(quant);
    expect(d.flavor).toBe('standard');
    expect(d.quality).toBe(quality);
    expect(d.relativeSpeed).toBe(speed);
    expect(d.summary).toContain(`${bits}-bit`);
  });

  it.each([
    ['Q4_0_S', 'small'],
    ['Q4_0_M', 'medium'],
    ['Q4_0_L', 'large'],
    ['Q4_0_P', 'perplexity-tuned'],
  ])('%s names its size as %s', (quant, size) => {
    expect(describeQuant(quant).summary).toContain(`(${size})`);
  });

  it('omits the size parenthetical when there is no suffix', () => {
    expect(describeQuant('Q4_0').summary).not.toContain('(');
  });

  it('treats an unparseable label as 0 bits, landing in extreme-quant', () => {
    const d = describeQuant('totally-unknown');
    expect(d.flavor).toBe('extreme-quant');
  });
});

describe('describeQuant — floats', () => {
  it.each(['F16', 'BF16'])('%s is 16-bit float', (quant) => {
    const d = describeQuant(quant);
    expect(d.flavor).toBe('float');
    expect(d.quality).toBe('near-lossless');
    expect(d.relativeSpeed).toBe('slowest');
    expect(d.summary).toContain('16-bit');
  });

  it('F32 is reference precision', () => {
    const d = describeQuant('F32');
    expect(d.flavor).toBe('float');
    expect(d.summary).toContain('32-bit');
  });

  it('is case-insensitive', () => {
    expect(describeQuant('f16').flavor).toBe('float');
    expect(describeQuant('q4_k_m').flavor).toBe('k-variant');
  });
});
