import { describe, it, expect } from 'vitest';
import { parseRepoId, extractQuant, fileDownloadUrl } from '../src/hf.js';

describe('parseRepoId', () => {
  it('parses a bare org/repo slug', () => {
    expect(parseRepoId('bartowski/Llama-3.2-3B')).toBe('bartowski/Llama-3.2-3B');
  });
  it('parses a full HF URL', () => {
    expect(parseRepoId('https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF')).toBe('bartowski/Llama-3.2-3B-Instruct-GGUF');
  });
  it('parses a URL with trailing slash or query', () => {
    expect(parseRepoId('https://huggingface.co/foo/bar/')).toBe('foo/bar');
    expect(parseRepoId('https://huggingface.co/foo/bar?tab=card')).toBe('foo/bar');
  });
  it('throws on garbage input', () => {
    expect(() => parseRepoId('not a repo')).toThrow();
    expect(() => parseRepoId('')).toThrow();
  });
});

describe('extractQuant', () => {
  it('extracts K-variants with suffixes', () => {
    expect(extractQuant('Foo-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(extractQuant('Foo-Q5_K_S.gguf')).toBe('Q5_K_S');
    expect(extractQuant('Foo-Q2_K_P.gguf')).toBe('Q2_K_P');
  });
  it('extracts IQ variants', () => {
    expect(extractQuant('Foo-IQ3_M.gguf')).toBe('IQ3_M');
    expect(extractQuant('Foo-IQ4_XS.gguf')).toBe('IQ4_XS');
  });
  it('extracts float formats', () => {
    expect(extractQuant('Foo-F16.gguf')).toBe('F16');
    expect(extractQuant('Foo-BF16.gguf')).toBe('BF16');
    expect(extractQuant('Foo-F32.gguf')).toBe('F32');
  });
  it('falls back to an "unknown" sentinel when nothing matches', () => {
    expect(extractQuant('Foo.gguf').toLowerCase()).toBe('unknown');
  });
});

describe('fileDownloadUrl', () => {
  it('url-encodes path segments but leaves slashes', () => {
    expect(fileDownloadUrl('org/repo', 'sub/dir/file with space.gguf')).toBe(
      'https://huggingface.co/org/repo/resolve/main/sub/dir/file%20with%20space.gguf',
    );
  });
});
