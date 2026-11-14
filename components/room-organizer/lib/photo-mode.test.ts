import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PHOTO_MAX_EDGE,
  enterPhotoMode,
  isPhotoMode,
  leavePhotoMode,
  photoFileName,
  photoKeyPasses,
  photoPixelRatio,
  subscribePhotoMode,
  takePhotoFocusReturn,
} from './photo-mode';

afterEach(() => leavePhotoMode());

describe('photo size (#626)', () => {
  it('draws at twice the scene’s own resolution', () => {
    expect(photoPixelRatio(1440, 900, 1, PHOTO_MAX_EDGE)).toBe(2);
    expect(photoPixelRatio(390, 844, 2, PHOTO_MAX_EDGE)).toBe(4);
  });

  it('caps the longer edge', () => {
    // A retina desktop: 1440 × 2 × 2 = 5760 px would pass the cap.
    const ratio = photoPixelRatio(1440, 900, 2, PHOTO_MAX_EDGE);
    expect(1440 * ratio).toBeCloseTo(PHOTO_MAX_EDGE);
    expect(photoPixelRatio(900, 1440, 2, 2048) * 1440).toBeCloseTo(2048);
  });

  it('never fails on a canvas with no size yet', () => {
    expect(photoPixelRatio(0, 0, 1.5, PHOTO_MAX_EDGE)).toBe(3);
  });

  it('names the file after the house', () => {
    expect(photoFileName('My Home')).toBe('my-home-photo.png');
    expect(photoFileName('')).toBe('layout-photo.png');
  });
});

describe('photo mode switch (#626)', () => {
  it('tells its subscribers once per change', () => {
    const listener = vi.fn();
    const stop = subscribePhotoMode(listener);
    enterPhotoMode();
    enterPhotoMode();
    expect(isPhotoMode()).toBe(true);
    leavePhotoMode();
    stop();
    enterPhotoMode();
    expect(listener.mock.calls).toEqual([[true], [false]]);
  });
});

describe('photo mode keys (#626)', () => {
  const key = (k: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({
    key: k, code, ctrlKey: false, metaKey: false, altKey: false, ...mods,
  });
  const onShutter = { inBar: true, onBarButton: true, walking: false };

  it('lets the shutter take Tab, Enter and Space', () => {
    expect(photoKeyPasses(key('Tab', 'Tab'), onShutter)).toBe(true);
    expect(photoKeyPasses(key('Enter', 'Enter'), onShutter)).toBe(true);
    expect(photoKeyPasses(key(' ', 'Space'), onShutter)).toBe(true);
  });

  it('stops the editor’s keys even with focus on the shutter', () => {
    for (const k of [key('z', 'KeyZ', { ctrlKey: true }), key('z', 'KeyZ', { metaKey: true }), key('2', 'Digit2'), key('p', 'KeyP'),
      key('[', 'BracketLeft'), key('PageUp', 'PageUp'), key('v', 'KeyV', { ctrlKey: true }), key('Delete', 'Delete')]) {
      expect(photoKeyPasses(k, onShutter), k.code).toBe(false);
    }
    // Enter away from the shutter's buttons doesn't pass either.
    expect(photoKeyPasses(key('Enter', 'Enter'), { inBar: false, onBarButton: false, walking: false })).toBe(false);
  });

  it('lets the walk’s own keys through while walking, and only those', () => {
    const walking = { inBar: false, onBarButton: false, walking: true };
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ShiftLeft', 'KeyE']) {
      expect(photoKeyPasses(key('x', code), walking), code).toBe(true);
    }
    expect(photoKeyPasses(key('w', 'KeyW'), { ...walking, walking: false })).toBe(false);
    expect(photoKeyPasses(key('z', 'KeyZ', { ctrlKey: true }), walking)).toBe(false);
    expect(photoKeyPasses(key('PageUp', 'PageUp'), walking)).toBe(false);
  });
});

describe('photo mode focus return (#626)', () => {
  it('hands back the opener once', () => {
    const opener = { focus: () => {}, isConnected: true };
    enterPhotoMode(opener);
    expect(takePhotoFocusReturn()).toBe(opener);
    expect(takePhotoFocusReturn()).toBe(null);
  });
});
