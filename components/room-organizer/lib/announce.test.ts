import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import {
  ANNOUNCE_DEDUPE_MS,
  describeGroupTurn,
  ANNOUNCE_SETTLE_MS,
  announce,
  announceSettled,
  currentAnnouncement,
  describeHistoryStep,
  describeLock,
  describePlacement,
  resetAnnouncements,
  subscribeAnnouncements,
  withdrawAnnouncement,
} from './announce';
import { setDisplayUnit } from './format';

afterEach(() => {
  resetAnnouncements();
  setDisplayUnit('metric');
});

describe('announce (#929)', () => {
  it('says the text and tells its listeners', () => {
    const listener = vi.fn();
    const stop = subscribeAnnouncements(listener);
    announce('Sofa selected, 1 of 2.', { tag: 'select:sofa', now: 0 });
    expect(currentAnnouncement()).toEqual({ text: 'Sofa selected, 1 of 2.', tag: 'select:sofa' });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    announce('Bed selected, 2 of 2.', { now: 10 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drops the same words inside the de-dupe window', () => {
    announce('Undone: move Sofa.', { now: 0 });
    const listener = vi.fn();
    const stop = subscribeAnnouncements(listener);
    announce('Undone: move Sofa.', { now: ANNOUNCE_DEDUPE_MS - 1 });
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('says the same words again after the window, changing the node so a reader speaks', () => {
    announce('Undone: move Sofa.', { now: 0 });
    announce('Undone: move Sofa.', { now: ANNOUNCE_DEDUPE_MS });
    const again = currentAnnouncement().text;
    expect(again).not.toBe('Undone: move Sofa.');
    expect(again.trim()).toBe('Undone: move Sofa.');
    announce('Undone: move Sofa.', { now: 2 * ANNOUNCE_DEDUPE_MS });
    expect(currentAnnouncement().text).toBe('Undone: move Sofa.');
  });

  it('ignores empty text', () => {
    announce('   ', { now: 0 });
    expect(currentAnnouncement().text).toBe('');
  });

  it('withdraws only what the owner said', () => {
    announce('Sofa selected, 1 of 2.', { tag: 'select:sofa', now: 0 });
    withdrawAnnouncement((tag) => tag === 'nudge');
    expect(currentAnnouncement().text).toBe('Sofa selected, 1 of 2.');
    withdrawAnnouncement((tag) => tag?.startsWith('select:') === true);
    expect(currentAnnouncement()).toEqual({ text: '', tag: null });
    // Withdrawn words can be said again at once.
    announce('Sofa selected, 1 of 2.', { tag: 'select:sofa', now: 1 });
    expect(currentAnnouncement().text).toBe('Sofa selected, 1 of 2.');
  });
});

describe('announceSettled', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says only where a run of steps ended, read when it settles', () => {
    vi.useFakeTimers();
    let x = 0;
    const words = vi.fn(() => `Sofa at ${x}.`);
    for (let step = 1; step <= 5; step += 1) {
      x = step;
      announceSettled(words, { tag: 'placement' });
      vi.advanceTimersByTime(ANNOUNCE_SETTLE_MS - 1);
    }
    expect(words).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(words).toHaveBeenCalledTimes(1);
    expect(currentAnnouncement()).toEqual({ text: 'Sofa at 5.', tag: 'placement' });
  });

  it('a reset drops what was waiting', () => {
    vi.useFakeTimers();
    const words = vi.fn(() => 'Sofa.');
    announceSettled(words);
    resetAnnouncements();
    vi.runAllTimers();
    expect(words).not.toHaveBeenCalled();
  });
});

describe('describePlacement', () => {
  const house = { width: 8, height: 6 };

  it('measures from the footprint to the west and north walls', () => {
    const sofa = makeItem({ name: 'Sofa', width: 2, depth: 1, position: { x: -2, z: -1 } });
    // Left edge at -3 (1 m from -4), back edge at -1.5 (1.5 m from -3).
    expect(describePlacement(sofa, house)).toBe('Sofa, 1 m from the west wall, 1.5 m from the north wall.');
  });

  it('says the turn and uses the turned footprint', () => {
    const sofa = makeItem({ name: 'Sofa', width: 2, depth: 1, rotation: Math.PI / 2, position: { x: -2, z: -1 } });
    expect(describePlacement(sofa, house)).toBe('Sofa, 1.5 m from the west wall, 1 m from the north wall, turned 90°.');
  });

  it('adds why it shows red', () => {
    const sofa = makeItem({ name: 'Sofa', position: { x: 0, z: 0 } });
    expect(describePlacement(sofa, house, 'It overlaps the Coffee table.')).toBe(
      'Sofa, 3.5 m from the west wall, 2.5 m from the north wall. It overlaps the Coffee table.'
    );
  });

  it('places a garden item against the house, and one across a wall', () => {
    const tree = makeItem({ name: 'Tree', position: { x: 6, z: 0 } });
    expect(describePlacement(tree, house)).toBe('Tree, in the garden, 1.5 m from the east wall.');
    const bench = makeItem({ name: 'Bench', position: { x: 0, z: -3 } });
    expect(describePlacement(bench, house)).toBe('Bench, 3.5 m from the west wall, through the north wall.');
    const window = makeItem({ type: 'window', name: 'Window', depth: 0.2, position: { x: 0, z: -3 } });
    expect(describePlacement(window, house)).toBe('Window, 3.5 m from the west wall, in the north wall.');
  });

  describe('on an L house (#929 review)', () => {
    // The north-east corner cut away: the notch runs x 1..4, z -3..-1.
    const lHouse = { width: 8, height: 6, cutout: { corner: 'ne' as const, width: 3, depth: 2 } };

    it('measures to the walls of the cut corner when they are nearer', () => {
      const chair = makeItem({ name: 'Chair', position: { x: 0, z: -2 } });
      expect(describePlacement(chair, lHouse)).toBe('Chair, 0.5 m from the inner east wall, 0.5 m from the north wall.');
    });

    it('measures past the corner to the walls the item really faces', () => {
      const chair = makeItem({ name: 'Chair', position: { x: 2.5, z: 0.5 } });
      expect(describePlacement(chair, lHouse)).toBe('Chair, 1 m from the east wall, 1 m from the inner north wall.');
    });

    it('calls an item in the cut corner outside, in the garden', () => {
      const bench = makeItem({ name: 'Bench', position: { x: 2.5, z: -2 } });
      expect(describePlacement(bench, lHouse)).toBe('Bench, in the garden, 0.5 m from the inner north wall.');
      expect(describePlacement(bench, { ...lHouse, floorIndex: 1 })).toBe('Bench, outside, 0.5 m from the inner north wall.');
    });

    it('gives the porch its own line', () => {
      const porch = { x0: -1, x1: 1, frontZ: -3, backZ: -2 };
      const plant = makeItem({ name: 'Plant', width: 0.4, depth: 0.4, position: { x: 0, z: -2.5 } });
      expect(describePlacement(plant, { ...lHouse, porch })).toBe('Plant, in the porch.');
      // Just behind the porch, it is inside again.
      const chair = makeItem({ name: 'Chair', position: { x: 0, z: -1 } });
      expect(describePlacement(chair, { ...lHouse, porch })).toBe('Chair, 0.5 m from the inner east wall, 1.5 m from the north wall.');
    });
  });

  it('reads in feet and inches when the player picked them', () => {
    setDisplayUnit('imperial');
    const chair = makeItem({ name: 'Chair', position: { x: -3, z: -2 } });
    expect(describePlacement(chair, house)).toContain('from the west wall');
    expect(describePlacement(chair, house)).not.toContain(' m ');
  });

  it('names an unplaced item only', () => {
    const { position: _none, ...item } = makeItem({ name: 'Lamp' });
    expect(describePlacement(item, house)).toBe('Lamp');
  });
});

describe('announce after a held key (#929 review)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a newer line drops the one a held key was waiting to say', () => {
    vi.useFakeTimers();
    const words = vi.fn(() => 'Sofa, 1 m from the west wall.');
    announceSettled(words);
    announce('Undone: move Sofa.');
    vi.runAllTimers();
    expect(words).not.toHaveBeenCalled();
    expect(currentAnnouncement().text).toBe('Undone: move Sofa.');
  });

  it('`always` says the same words twice inside the window, changing the node', () => {
    announce('Undone: move Sofa.', { now: 0, always: true });
    announce('Undone: move Sofa.', { now: 150, always: true });
    expect(currentAnnouncement().text).toBe('Undone: move Sofa.\u00a0');
    announce('Undone: move Sofa.', { now: 300, always: true });
    expect(currentAnnouncement().text).toBe('Undone: move Sofa.');
  });
});

describe('describeLock and describeHistoryStep', () => {
  it('words a turn of several items', () => {
    expect(describeGroupTurn(3, 90, 1)).toBe('3 items turned 90°; 1 locked stayed.');
    expect(describeGroupTurn(2, 15, 0)).toBe('2 items turned 15°.');
  });

  it('words a lock and an undo', () => {
    expect(describeLock('Sofa', 1, true)).toBe('Sofa locked.');
    expect(describeLock('Sofa', 3, false)).toBe('3 items unlocked.');
    expect(describeHistoryStep('undo', 'move Sofa on Ground')).toBe('Undone: move Sofa on Ground.');
    expect(describeHistoryStep('redo', null)).toBe('Redone.');
  });
});
