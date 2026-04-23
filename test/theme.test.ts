import { describe, it, expect } from 'vitest';
import { THEMES, THEME_LIST, getTheme } from '../src/theme.js';

describe('theme registry', () => {
  it('lists at least the 7 named themes', () => {
    expect(THEME_LIST.length).toBeGreaterThanOrEqual(7);
  });
  it('each theme exposes required color tokens', () => {
    for (const name of THEME_LIST) {
      const t = THEMES[name];
      for (const k of ['primary', 'accent', 'text', 'muted', 'success', 'warning', 'danger', 'info', 'bgActive', 'bgActiveFg', 'border']) {
        expect((t as any)[k]).toBeTruthy();
      }
    }
  });
  it('bgActiveFg contrasts with bgActive heuristically', () => {
    for (const name of THEME_LIST) {
      const t = THEMES[name];
      // If bgActive is a light color, bgActiveFg shouldn't be white.
      if (/white|yellow|cyan/.test(t.bgActive)) {
        expect(t.bgActiveFg).not.toBe('white');
      }
    }
  });
  it('getTheme falls back to dark on unknown', () => {
    expect(getTheme('nope' as any).name).toBe('dark');
  });
});
