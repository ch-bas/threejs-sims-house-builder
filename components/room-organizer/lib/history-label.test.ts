import { describe, expect, it } from 'vitest';
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
