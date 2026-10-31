import { describe, expect, it } from 'vitest';
import { layoutReducer, type LayoutAction } from '../hooks/layout-reducer';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { describeLayoutChange } from './history-label';

const sofa = makeItem({ id: 'sofa', name: 'Sofa', position: { x: 0, z: 0 } });
const lamp = makeItem({ id: 'lamp', name: 'Lamp', position: { x: 1, z: 1 } });
const ground = makeFloor({ id: 'g', name: 'Ground', items: [sofa, lamp] });
const attic = makeFloor({ id: 'a', name: 'Attic', items: [] });
const house = makeLayout({ id: 'h', name: 'Home', floors: [ground] });
const tall = makeLayout({ id: 'h', name: 'Home', floors: [ground, attic] });

function withItems(items: typeof ground.items) {
  return { ...house, floors: [{ ...ground, items }] };
}

describe('describeLayoutChange (#625)', () => {
  it('names a move, even though a drag also locks the item', () => {
    const moved = { ...sofa, position: { x: 2, z: 0 }, locked: true };
    expect(describeLayoutChange(house, withItems([moved, lamp]))).toBe('move Sofa');
  });

  it('counts several items', () => {
    const items = [sofa, lamp].map((item) => ({ ...item, position: { x: 3, z: 3 } }));
    expect(describeLayoutChange(house, withItems(items))).toBe('move 2 items');
  });

  it('names a placement and a removal', () => {
    const chair = makeItem({ id: 'chair', name: 'Chair' });
    expect(describeLayoutChange(house, withItems([sofa, lamp, chair]))).toBe('add Chair');
    expect(describeLayoutChange(house, withItems([lamp]))).toBe('remove Sofa');
  });

  it('names turns, resizes, colours and locks', () => {
    expect(describeLayoutChange(house, withItems([{ ...sofa, rotation: 1 }, lamp]))).toBe('turn Sofa');
    expect(describeLayoutChange(house, withItems([{ ...sofa, width: 9 }, lamp]))).toBe('resize Sofa');
    expect(describeLayoutChange(house, withItems([{ ...sofa, color: '#123456' }, lamp]))).toBe('recolour Sofa');
    expect(describeLayoutChange(house, withItems([{ ...sofa, locked: true }, lamp]))).toBe('lock Sofa');
  });

  it('falls back to edit when a step mixes changes', () => {
    const mixed = [{ ...sofa, rotation: 1 }, { ...lamp, width: 9 }];
    expect(describeLayoutChange(house, withItems(mixed))).toBe('edit 2 items');
  });

  it('names the storey in a house of several', () => {
    const moved = { ...tall, floors: [{ ...ground, items: [{ ...sofa, position: { x: 2, z: 0 } }, lamp] }, attic] };
    expect(describeLayoutChange(tall, moved)).toBe('move Sofa on Ground');
  });

  it('names a floor added or removed', () => {
    expect(describeLayoutChange(house, tall)).toBe('add floor “Attic”');
    expect(describeLayoutChange(tall, house)).toBe('remove floor “Attic”');
  });

  it('names the house a load brought in', () => {
    expect(describeLayoutChange(house, makeLayout({ id: 'other', name: 'Living Room' }))).toBe('load “Living Room”');
  });

  it('names changes to the building', () => {
    expect(describeLayoutChange(house, { ...house, name: 'Cottage' })).toBe('rename the house');
    expect(describeLayoutChange(house, { ...house, width: house.width + 1 })).toBe('resize the house');
  });

  it('sees no item change in a storey the restore path only copied', () => {
    expect(describeLayoutChange(house, { ...house, floors: [{ ...ground }], name: 'Cottage' })).toBe('rename the house');
  });

  it('has nothing to say about the same object', () => {
    expect(describeLayoutChange(house, house)).toBeNull();
  });
});

describe('describeLayoutChange, through the real reducer (#625)', () => {
  const zone = { id: 'z', name: 'Nook', color: '#ffffff', x: 0, z: 0, w: 2, d: 2 };
  const step = (layout: typeof tall, ...actions: LayoutAction[]) => {
    const after = actions.reduce((state, action) => layoutReducer(state, action), { layout, activeFloorIndex: 0 }).layout;
    expect(after).not.toBe(layout);
    return describeLayoutChange(layout, after);
  };

  it('names what a floor change did, not a finish it never touched', () => {
    expect(step(tall, { type: 'renameFloor', index: 0, name: 'Lounge' })).toBe('rename floor “Lounge”');
    expect(step(tall, { type: 'setStoreyHeight', height: 3.2 })).toBe('change the storey height on Ground');
    expect(step(tall, { type: 'toggleExteriorWall', wallId: 'north' })).toBe('show or hide a wall on Ground');
    expect(step(tall, { type: 'addZone', zone })).toBe('change the zones on Ground');
    expect(step(tall, { type: 'setFloorColor', color: '#123456' })).toBe('change the finish on Ground');
    expect(step(tall, { type: 'setWallColor', wall: 'north', color: '#123456' })).toBe('change the finish on Ground');
  });

  it('calls a selection rotate a turn, though every item also moves', () => {
    expect(step(tall, { type: 'rotateSelection', ids: new Set(['sofa', 'lamp']), radians: Math.PI / 2 })).toBe('turn 2 items on Ground');
  });

  it('still calls a group move a move', () => {
    const positions = new Map([['sofa', { x: 1, z: 1 }], ['lamp', { x: 2, z: 1 }]]);
    expect(step(tall, { type: 'bulkSetPositions', positions })).toBe('move 2 items on Ground');
  });

  it('names grouping', () => {
    expect(step(tall, { type: 'setGroup', ids: new Set(['sofa', 'lamp']), groupId: 'set' })).toBe('group 2 items on Ground');
  });

  it('names a resize of the house', () => {
    const edge = makeLayout({ id: 'h', floors: [makeFloor({ id: 'g', items: [makeItem({ id: 'e', position: { x: 3.4, z: 0 } })] })] });
    expect(step(edge, { type: 'setWidth', width: 5 })).toBe('resize the house');
  });
});
