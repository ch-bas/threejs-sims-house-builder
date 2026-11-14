import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { ROOM_TEMPLATES } from './constants';
import {
  FIRST_STEPS,
  FIRST_STEPS_STORAGE_KEY,
  firstStepsEarned,
  firstStepTips,
  loadFirstSteps,
  nextFirstStep,
  saveFirstSteps,
  type FirstStepId,
} from './first-steps';
import { welcomeTips } from './hud-layout';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID } from './street';
import type { FurnitureItem, InteriorWall, RoomLayout } from './types';

const none: ReadonlySet<FirstStepId> = new Set();
const wall = (id: string): InteriorWall => ({ id, x1: 0, z1: 0, x2: 2, z2: 0 });
const house = (items: FurnitureItem[] = [], interiorWalls: InteriorWall[] = []): RoomLayout =>
  makeLayout({ floors: [makeFloor({ items, interiorWalls })] });
const door = (id: string) => makeItem({ id, type: 'door', category: 'structure' });
const sofa = (id: string) => makeItem({ id, type: 'sofa', category: 'seating' });

describe('first steps (#721)', () => {
  it('lists the five steps in the order the modes run', () => {
    expect(FIRST_STEPS.map((step) => step.id)).toEqual(['room', 'door', 'furnish', 'walk', 'share']);
  });

  it('an edit that draws a wall, a zone, a door or furniture does that step', () => {
    const empty = house();
    expect(firstStepsEarned('edit', empty, house([], [wall('w1')]), none)).toEqual(['room']);
    const zoned = makeLayout({ floors: [makeFloor({ zones: [{ id: 'z', name: 'Hall', color: '#fff', x: 0, z: 0, w: 2, d: 2 }] })] });
    expect(firstStepsEarned('edit', empty, zoned, none)).toEqual(['room']);
    expect(firstStepsEarned('edit', empty, house([door('d1')]), none)).toEqual(['door']);
    expect(firstStepsEarned('edit', empty, house([sofa('s1')]), none)).toEqual(['furnish']);
  });

  it('a load does nothing, a template included', () => {
    for (const template of Object.values(ROOM_TEMPLATES)) {
      expect(firstStepsEarned('loaded', house(), template, none)).toEqual([]);
    }
    expect(firstStepsEarned('edit', null, ROOM_TEMPLATES.studio, none)).toEqual([]);
  });

  it('adding one more to a template counts; moving or removing does not', () => {
    const template = ROOM_TEMPLATES.bedroom;
    const floor = template.floors[0]!;
    const withSofa: RoomLayout = { ...template, floors: [{ ...floor, items: [...floor.items, sofa('extra')] }] };
    expect(firstStepsEarned('edit', template, withSofa, none)).toEqual(['furnish']);
    const moved: RoomLayout = {
      ...template,
      floors: [{ ...floor, items: floor.items.map((item) => ({ ...item, position: { x: 0, z: 0 } })) }],
    };
    expect(firstStepsEarned('edit', template, moved, none)).toEqual([]);
    const fewer: RoomLayout = { ...template, floors: [{ ...floor, items: floor.items.slice(1) }] };
    expect(firstStepsEarned('edit', template, fewer, none)).toEqual([]);
  });

  it('the recessed entrance, garden and openings are not the player furnishing', () => {
    const empty = house();
    const entrance = house([makeItem({ id: ENTRANCE_DOOR_ID, type: 'door', category: 'structure' })], [wall(ENTRANCE_WALL_ID)]);
    expect(firstStepsEarned('edit', empty, entrance, none)).toEqual([]);
    const garden = house([makeItem({ id: 't', type: 'tree', category: 'outdoor' }), makeItem({ id: 'w', type: 'window', category: 'structure' })]);
    expect(firstStepsEarned('edit', empty, garden, none)).toEqual([]);
  });

  it('a step already done is not reported again', () => {
    expect(firstStepsEarned('edit', house(), house([door('d1')]), new Set<FirstStepId>(['door']))).toEqual([]);
  });

  it('walking and sharing are never derived from the house', () => {
    const ids = firstStepsEarned('edit', house(), house([door('d'), sofa('s')], [wall('w')]), none);
    expect(ids).not.toContain('walk');
    expect(ids).not.toContain('share');
  });

  it('the next step is the first one not done', () => {
    expect(nextFirstStep(none)?.id).toBe('room');
    expect(nextFirstStep(new Set<FirstStepId>(['room', 'furnish']))?.id).toBe('door');
    expect(nextFirstStep(new Set<FirstStepId>(['room', 'door', 'furnish', 'walk', 'share']))).toBeNull();
  });

  it('each welcome tip is still shown by some step', () => {
    for (const touch of [false, true]) {
      const shown = new Set(FIRST_STEPS.flatMap((step) => firstStepTips(step.id, touch).map((tip) => tip.title)));
      for (const tip of welcomeTips(touch)) expect(shown).toContain(tip.title);
    }
  });

  it('a step shows at most three tips, so the card stays short', () => {
    for (const touch of [false, true]) {
      for (const step of FIRST_STEPS) expect(firstStepTips(step.id, touch).length).toBeLessThanOrEqual(3);
    }
  });

  it('touch tips never mention keys', () => {
    for (const step of FIRST_STEPS) {
      const text = firstStepTips(step.id, true).map((tip) => tip.body).join(' ');
      expect(text).not.toMatch(/\bpress\b|ctrl|⌘|WASD/i);
    }
  });

  it('stores the card and its ticks, and reads back only a valid record', () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    } as unknown as Storage;
    expect(loadFirstSteps(fake)).toBeNull();
    saveFirstSteps({ card: 'offered', done: new Set<FirstStepId>(['room', 'share']) }, fake);
    const read = loadFirstSteps(fake);
    expect(read?.card).toBe('offered');
    expect([...(read?.done ?? [])].sort()).toEqual(['room', 'share']);
    expect(JSON.parse(storage.get(FIRST_STEPS_STORAGE_KEY)!)).toEqual({
      card: 'offered',
      room: true,
      door: false,
      furnish: false,
      walk: false,
      share: true,
    });
    saveFirstSteps({ card: 'dismissed', done: new Set() }, fake);
    expect(loadFirstSteps(fake)?.card).toBe('dismissed');
    for (const junk of ['junk', 'offered', '[]', 'null', '{"card":"open"}', JSON.stringify({ card: 'offered', room: 'yes' }).replace('}', ',"x":"' + 'y'.repeat(2000) + '"}')]) {
      storage.set(FIRST_STEPS_STORAGE_KEY, junk);
      expect(loadFirstSteps(fake)).toBeNull();
    }
    // A step that isn't a boolean true, or isn't a step, ticks nothing.
    storage.set(FIRST_STEPS_STORAGE_KEY, JSON.stringify({ card: 'offered', room: 'yes', door: 1, constructor: true, walk: true }));
    expect([...(loadFirstSteps(fake)?.done ?? [])]).toEqual(['walk']);
  });
});
