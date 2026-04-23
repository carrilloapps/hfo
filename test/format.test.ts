import { describe, it, expect } from 'vitest';
import { formatBytes, progressBar, formatRate, formatEta } from '../src/ui/format.js';

describe('formatBytes', () => {
  it('returns 0 B for zero or negative input', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
  });
  it('formats bytes with the right unit', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

describe('progressBar', () => {
  it('clamps ratio to [0, 1]', () => {
    expect(progressBar(-1, 10)).toBe('░'.repeat(10));
    expect(progressBar(2, 10)).toBe('█'.repeat(10));
  });
  it('renders proportional fill', () => {
    const half = progressBar(0.5, 10);
    expect(half).toMatch(/^█{5}░{5}$/);
  });
});

describe('formatRate', () => {
  it('appends /s to a bytes formatting', () => {
    expect(formatRate(1024)).toBe('1.0 KB/s');
  });
});

describe('formatEta', () => {
  it('returns placeholder when seconds is infinite / negative', () => {
    expect(formatEta(Infinity)).toBe('--:--');
    expect(formatEta(-1)).toBe('--:--');
  });
  it('formats as m:ss', () => {
    expect(formatEta(0)).toBe('0:00');
    expect(formatEta(65)).toBe('1:05');
    expect(formatEta(3600)).toBe('60:00');
  });
});
