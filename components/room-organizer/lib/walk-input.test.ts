import { describe, expect, it } from 'vitest';
import { WALK_MAX_FRAME_SECONDS, interacts, releasesHeldKeys, startsWalking, walkFrameSeconds } from './walk-input';

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

describe('releasesHeldKeys (#421)', () => {
  it('drops held keys on either Cmd edge', () => {
    expect(releasesHeldKeys({ key: 'Meta' })).toBe(true);
    expect(releasesHeldKeys({ key: 'Control' })).toBe(false);
    expect(releasesHeldKeys({ key: 'w' })).toBe(false);
  });

  it('hold W, tap Cmd+Z, let W go under Cmd, release Cmd: W is no longer held', () => {
    // The walkthrough hook's keydown / keyup rules, replayed on the events
    // macOS delivers: no keyup for W, which was released while Cmd was down.
    const pressed = new Set<string>();
    const down = (code: string, key: string, metaKey = false) => {
      const event = { code, key, metaKey, ctrlKey: false, altKey: false };
      if (releasesHeldKeys(event)) pressed.clear();
      else if (startsWalking(event)) pressed.add(code);
    };
    const up = (code: string, key: string) => {
      if (releasesHeldKeys({ key })) pressed.clear();
      else pressed.delete(code);
    };
    down('KeyW', 'w');
    down('MetaLeft', 'Meta', true);
    down('KeyZ', 'z', true);
    up('KeyZ', 'z');
    up('MetaLeft', 'Meta');
    expect(pressed.has('KeyW')).toBe(false);
  });
});

describe('interacts (#463b)', () => {
  it('E sits down or stands up', () => {
    expect(interacts({ ...key('KeyE'), repeat: false })).toBe(true);
  });

  it('ignores the auto-repeat of a held E, chords and other keys', () => {
    expect(interacts({ ...key('KeyE'), repeat: true })).toBe(false);
    expect(interacts({ ...key('KeyE', { ctrlKey: true }), repeat: false })).toBe(false);
    expect(interacts({ ...key('KeyE', { metaKey: true }), repeat: false })).toBe(false);
    expect(interacts({ ...key('KeyW'), repeat: false })).toBe(false);
  });
});
