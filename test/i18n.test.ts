import { describe, it, expect } from 'vitest';
import { LANGS, setLang, getLang, t } from '../src/ui/i18n.js';

describe('i18n', () => {
  it('ships at least 20 languages', () => {
    expect(LANGS.length).toBeGreaterThanOrEqual(20);
  });

  it('every language has a label and native name', () => {
    for (const l of LANGS) {
      expect(l.code).toMatch(/^[a-z]{2}$/);
      expect(l.label).toBeTruthy();
      expect(l.native).toBeTruthy();
    }
  });

  it('setLang + t switch between catalogs', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    const en = t('tab.models');
    setLang('es');
    expect(getLang()).toBe('es');
    const es = t('tab.models');
    expect(en).not.toBe(es);
    setLang('en');
  });

  it('falls back to English for missing keys', () => {
    setLang('en');
    const fallback = t('nonexistent.key');
    expect(typeof fallback).toBe('string');
  });

  it('normalizes unsupported language codes back to English', () => {
    setLang('xx' as any);
    expect(getLang()).toBe('en');
  });
});
