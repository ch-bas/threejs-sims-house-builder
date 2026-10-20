import { describe, expect, it } from 'vitest';
import { WALK_MAX_FRAME_SECONDS, startsWalking, walkFrameSeconds } from './walk-input';

const key = (code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('walkFrameSeconds (#421)', () => {
  it('integrates whole frames down to 10 fps, so 1 s of walking covers the full distance', () => {
    for (const fps of [60, 30, 15, 10]) {
      let seconds = 0;
      for (let frame = 0; frame < fps; frame += 1) seconds += walkFrameSeconds(1000 / fps);
      expect(seconds).toBeCloseTo(1);
    }
  });

  it('caps a long gap (a backgrounded tab) instead of teleporting', () => {
    expect(walkFrameSeconds(5000)).toBe(WALK_MAX_FRAME_SECONDS);
  });

  it('never runs backwards on a clock hiccup', () => {
    expect(walkFrameSeconds(-16)).toBe(0);
  });
});

describe('startsWalking (#421)', () => {
  it('takes WASD, the arrows and Shift', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ShiftLeft', 'ShiftRight']) {
      expect(startsWalking(key(code))).toBe(true);
    }
    expect(startsWalking(key('KeyE'))).toBe(false);
  });

  it('ignores Ctrl, Cmd and Alt chords: Ctrl+D duplicates, it does not side-step', () => {
    expect(startsWalking(key('KeyD', { ctrlKey: true }))).toBe(false);
    expect(startsWalking(key('KeyS', { metaKey: true }))).toBe(false);
    expect(startsWalking(key('KeyW', { altKey: true }))).toBe(false);
    expect(startsWalking(key('ShiftLeft', { ctrlKey: true }))).toBe(false);
  });
});
