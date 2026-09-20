import { describe, it, expect } from 'vitest';
import { icon, type IconKey } from '../src/ui/icons.js';

describe('icon set', () => {
  it('exposes every documented glyph as a non-empty string', () => {
    for (const [key, value] of Object.entries(icon)) {
      expect(typeof value, key).toBe('string');
      expect(value.length, key).toBeGreaterThan(0);
    }
  });

  it('carries the status marks, pointers, circles and checkboxes the UI relies on', () => {
    const required: IconKey[] = [
      'tick', 'cross', 'warning', 'info', 'question',
      'pointer', 'pointerSmall', 'arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight', 'play',
      'bullet', 'dot', 'ellipsis',
      'circle', 'circleFilled', 'circleDotted', 'circleDouble', 'circleHalf',
      'square', 'squareFilled',
      'star', 'heart', 'line', 'lineVertical',
      'checkOn', 'checkOff',
      'nav', 'ok', 'bad', 'pending', 'on', 'off', 'partial',
    ];
    for (const key of required) expect(icon[key], key).toBeTruthy();
  });

  it('points the semantic aliases at their underlying glyphs', () => {
    expect(icon.nav).toBe(icon.pointer);
    expect(icon.ok).toBe(icon.tick);
    expect(icon.bad).toBe(icon.cross);
    expect(icon.pending).toBe(icon.ellipsis);
    expect(icon.on).toBe(icon.circleFilled);
    expect(icon.off).toBe(icon.circle);
    expect(icon.partial).toBe(icon.circleHalf);
  });

  it('contains no raw emoji — figures only, so legacy consoles degrade to ASCII', () => {
    // Anything in the astral planes is an emoji rather than a figures glyph.
    for (const [key, value] of Object.entries(icon)) {
      const astral = [...value].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x1f000);
      expect(astral, `${key}=${value}`).toBe(false);
    }
  });
});
