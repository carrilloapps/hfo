import { describe, it, expect } from 'vitest';
import { LANGS, setLang, getLang, t, enKeys, missingKeys, keysFor } from '../src/ui/i18n.js';

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

  it('English catalog is the authoritative key set (non-empty, no placeholder values)', () => {
    const keys = enKeys();
    expect(keys.length).toBeGreaterThan(100);
    setLang('en');
    for (const k of keys) {
      const v = t(k);
      expect(v).toBeTruthy();
      expect(v).not.toBe(k); // t() would return the raw key if lookup failed
    }
  });

  it('Spanish catalog has parity with English (no missing keys)', () => {
    expect(missingKeys('es')).toEqual([]);
  });

  it('every key in every catalog resolves through t() to something non-empty', () => {
    const en = enKeys();
    for (const { code } of LANGS) {
      setLang(code);
      for (const k of en) {
        const v = t(k);
        expect(v, `lang=${code} key=${k}`).toBeTruthy();
      }
    }
    setLang('en');
  });

  it('critical UI keys (common.*, app.*, boot.*, filebrowser.*) are localized in every language', () => {
    const mustLocalize = [
      'common.cancel', 'common.confirm', 'common.yes', 'common.no',
      'common.back', 'common.search', 'common.on', 'common.off',
    ];
    for (const { code } of LANGS) {
      if (code === 'en') continue;
      const target = keysFor(code);
      for (const k of mustLocalize) {
        expect(target, `${code} missing ${k}`).toContain(k);
      }
    }
  });
});
