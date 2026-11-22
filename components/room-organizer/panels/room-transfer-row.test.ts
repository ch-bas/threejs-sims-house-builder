import { describe, expect, it, vi } from 'vitest';
import { holdBack } from './room-transfer-row';

describe('the room row holds back key repeats (#925)', () => {
  const press = (key: string, repeat: boolean): boolean => {
    const preventDefault = vi.fn();
    holdBack({ key, repeat, preventDefault });
    return preventDefault.mock.calls.length > 0;
  };

  it('a held Enter or Space clicks once, not on every repeat', () => {
    expect(press('Enter', true)).toBe(true);
    expect(press(' ', true)).toBe(true);
  });

  it('the first press and other keys go through', () => {
    expect(press('Enter', false)).toBe(false);
    expect(press('Tab', true)).toBe(false);
  });
});
