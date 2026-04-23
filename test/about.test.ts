import { describe, it, expect } from 'vitest';
import { APP, appSignature } from '../src/infra/about.js';

describe('APP metadata', () => {
  it('is populated from package.json', () => {
    expect(APP.packageName).toBeTruthy();
    expect(APP.binary).toBeTruthy();
    expect(APP.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP.license).toBeTruthy();
    expect(APP.author.name).toBeTruthy();
  });
});

describe('appSignature', () => {
  it('joins binary, version, license, author with middle dots', () => {
    const sig = appSignature();
    expect(sig).toContain(APP.version);
    expect(sig).toContain(APP.license);
    expect(sig).toContain(APP.author.name);
  });
});
