import { afterEach, describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { buildPasteItems, clearClipboard, clipboardSize, copyToClipboard } from './clipboard';

const W = 10;
const D = 10;

describe('clipboard (#153)', () => {
  afterEach(clearClipboard);

  it('copy normalizes around the centroid; paste preserves the arrangement', () => {
    const a = makeItem({ id: 'a', position: { x: 1, z: 1 } });
    const b = makeItem({ id: 'b', position: { x: 3, z: 1 } });
    expect(copyToClipboard([a, b])).toBe(2);
    const pasted = buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 't' });
    // Centroid was (2,1); default target is (2.5, 1.5).
    expect(pasted[0]!.position).toEqual({ x: 1.5, z: 1.5 });
    expect(pasted[1]!.position).toEqual({ x: 3.5, z: 1.5 });
    // Relative spacing preserved exactly.
    expect(pasted[1]!.position!.x - pasted[0]!.position!.x).toBe(2);
  });

  it('paste at an explicit target lands the arrangement there', () => {
    copyToClipboard([makeItem({ id: 'a', position: { x: -3, z: -3 } })]);
    const pasted = buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 't', target: { x: 2, z: 2 } });
    expect(pasted[0]!.position).toEqual({ x: 2, z: 2 });
  });

  it('fresh unique ids; locked stripped; other fields preserved', () => {
    const src = makeItem({ id: 'orig', color: '#123456', rotation: 1.2, locked: true });
    copyToClipboard([src]);
    const [pasted] = buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 'tag' });
    expect(pasted!.id).not.toBe('orig');
    expect(pasted!.id).toContain('tag');
    expect(pasted!.locked).toBeUndefined();
    expect(pasted!.color).toBe('#123456');
    expect(pasted!.rotation).toBe(1.2);
    // Source untouched (deep copy).
    expect(src.locked).toBe(true);
  });

  it('two pastes with different tags never collide ids', () => {
    copyToClipboard([makeItem({ id: 'a' })]);
    const first = buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 'one' });
    const second = buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 'two' });
    expect(first[0]!.id).not.toBe(second[0]!.id);
  });

  it('indoor copies clamp inside the room; outdoor copies keep the raw offset', () => {
    const sofa = makeItem({ id: 's', width: 2, depth: 1, position: { x: 4.4, z: 4.4 } });
    const tree = makeItem({ id: 't', type: 'tree', category: 'outdoor', position: { x: 7, z: 0 } });
    copyToClipboard([sofa]);
    const [clamped] = buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 't' });
    expect(clamped!.position!.x).toBeLessThanOrEqual(4);
    expect(clamped!.position!.z).toBeLessThanOrEqual(4.5);
    copyToClipboard([tree]);
    const [outdoor] = buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 't' });
    expect(outdoor!.position).toEqual({ x: 7.5, z: 0.5 });
  });

  it('a pasted door settles onto the nearest wall instead of floating', () => {
    copyToClipboard([
      makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.12, position: { x: 0, z: -5 }, rotation: 0 }),
    ]);
    const [door] = buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 't' });
    // Offset lands at (0.5, -4.5); settle snaps it back to the north wall plane.
    expect(door!.position!.z).toBe(-5);
    expect(door!.position!.x).toBeCloseTo(0.5, 10);
  });

  it('empty clipboard pastes nothing; positionless items are not copied', () => {
    expect(buildPasteItems({ roomWidth: W, roomDepth: D, idTag: 't' })).toEqual([]);
    expect(copyToClipboard([makeItem({ id: 'a', position: undefined })])).toBe(0);
    expect(clipboardSize()).toBe(0);
  });
});
