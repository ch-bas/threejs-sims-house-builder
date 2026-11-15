import { describe, expect, it } from 'vitest';
import { KEYMAP, formatBinding, formatChord, isApplePlatform, keyBinding, withShortcut } from './keymap';
import { interacts, startsWalking } from './walk-input';

describe('formatChord', () => {
  it('writes Ctrl and Shift out, joined with +, off a Mac', () => {
    expect(formatChord(['Mod', 'Shift', 'Z'], false)).toBe('Ctrl+Shift+Z');
    expect(formatChord(['Mod', 'click'], false)).toBe('Ctrl+click');
    expect(formatChord(['Backspace'], false)).toBe('Backspace');
  });

  it('writes the Mac symbols run together, in Apple’s order', () => {
    expect(formatChord(['Mod', 'Shift', 'Z'], true)).toBe('⇧⌘Z');
    expect(formatChord(['Alt', 'click'], true)).toBe('⌥+click');
    expect(formatChord(['Shift', 'R'], true)).toBe('⇧R');
    expect(formatChord(['Mod', 'click'], true)).toBe('⌘+click');
    expect(formatChord(['Shift', 'Tab'], true)).toBe('⇧+Tab');
    expect(formatChord(['Backspace'], true)).toBe('⌫');
  });
});

describe('the table', () => {
  it('has unique ids and a key for every row', () => {
    const ids = KEYMAP.map((binding) => binding.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const binding of KEYMAP) {
      expect(binding.keys.length).toBeGreaterThan(0);
      for (const chord of binding.keys) expect(chord.length).toBeGreaterThan(0);
    }
  });

  it('never says Ctrl to a Mac', () => {
    for (const binding of KEYMAP) expect(formatBinding(binding, true)).not.toMatch(/Ctrl/);
    expect(formatBinding(keyBinding('redo')!, true)).toBe('⇧⌘Z / ⌘Y');
    expect(formatBinding(keyBinding('redo')!, false)).toBe('Ctrl+Shift+Z / Ctrl+Y');
  });

  it('names the key in a tooltip', () => {
    expect(withShortcut('Snap to grid', 'snap', false)).toBe('Snap to grid (G)');
    expect(withShortcut('Copy the selection', 'copy', true)).toBe('Copy the selection (⌘C)');
    expect(withShortcut('No key', 'nothing', false)).toBe('No key');
  });

  it('lists the walker’s keys, which it reads from the table', () => {
    const walk = KEYMAP.filter((binding) => binding.context === 'walk').map((binding) => formatBinding(binding, false));
    expect(walk).toEqual(expect.arrayContaining(['WASD / Arrows', 'Shift', 'E']));
    const chord = { ctrlKey: false, metaKey: false, altKey: false, repeat: false };
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ShiftLeft']) expect(startsWalking({ ...chord, code })).toBe(true);
    expect(startsWalking({ ...chord, code: 'KeyQ' })).toBe(false);
    expect(interacts({ ...chord, code: 'KeyE' })).toBe(true);
  });
});

describe('isApplePlatform', () => {
  it('knows a Mac, an iPhone and an iPad, and nothing else', () => {
    expect(isApplePlatform('MacIntel')).toBe(true);
    expect(isApplePlatform('macOS')).toBe(true);
    expect(isApplePlatform('iPhone')).toBe(true);
    expect(isApplePlatform('Win32')).toBe(false);
    expect(isApplePlatform('Linux x86_64')).toBe(false);
    expect(isApplePlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true);
    expect(isApplePlatform(undefined, 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false);
  });
});
