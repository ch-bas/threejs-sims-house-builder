import { describe, expect, it } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { parseStoredLayout } from '../lib/schema';
import { layoutReducer, type LayoutState } from './layout-reducer';
import type { GroundPatch } from '../lib/types';

const paving: GroundPatch = { id: 'g1', kind: 'paving', x: 4, z: -2, w: 2, d: 3 };

describe('garden surfaces in the reducer (#924)', () => {
  const start: LayoutState = { layout: makeLayout({ width: 8, height: 6 }), activeFloorIndex: 0 };

  it('adds a surface, fitted to the lot', () => {
    const next = layoutReducer(start, { type: 'addGround', ground: { ...paving, x: 2, w: 4 } });
    expect(next.layout.grounds).toEqual([paving]);
  });

  it('refuses one on the house, on another surface, or with a taken id, keeping identity', () => {
    expect(layoutReducer(start, { type: 'addGround', ground: { ...paving, x: -1, z: -1, w: 2, d: 2 } })).toBe(start);
    const one = layoutReducer(start, { type: 'addGround', ground: paving });
    expect(layoutReducer(one, { type: 'addGround', ground: { ...paving, id: 'g2', x: 5 } })).toBe(one);
    expect(layoutReducer(one, { type: 'addGround', ground: { ...paving, x: -7 } })).toBe(one);
    expect(layoutReducer(start, { type: 'addGround', ground: { ...paving, kind: 'lava' as GroundPatch['kind'] } })).toBe(start);
  });

  it('changes the kind, moves a surface and removes it; a no-op keeps identity', () => {
    const one = layoutReducer(start, { type: 'addGround', ground: paving });
    const deck = layoutReducer(one, { type: 'updateGround', id: 'g1', patch: { kind: 'deck' } });
    expect(deck.layout.grounds?.[0]?.kind).toBe('deck');
    expect(layoutReducer(deck, { type: 'updateGround', id: 'g1', patch: { kind: 'deck' } })).toBe(deck);
    expect(layoutReducer(deck, { type: 'updateGround', id: 'nope', patch: { kind: 'lawn' } })).toBe(deck);
    const moved = layoutReducer(deck, { type: 'updateGround', id: 'g1', patch: { x: 5 } });
    expect(moved.layout.grounds?.[0]).toMatchObject({ x: 5, w: 2 });
    expect(layoutReducer(deck, { type: 'updateGround', id: 'g1', patch: { x: -2 } }).layout.grounds?.[0]).toMatchObject({ x: 4 });
    const gone = layoutReducer(moved, { type: 'removeGround', id: 'g1' });
    expect(gone.layout).not.toHaveProperty('grounds');
    expect(layoutReducer(gone, { type: 'removeGround', id: 'g1' })).toBe(gone);
  });

  it('round-trips through the schema, repairs junk, and leaves old saves alone', () => {
    const plain = makeLayout();
    expect(parseStoredLayout(plain)).toEqual(plain);
    expect(parseStoredLayout(plain)).not.toHaveProperty('grounds');
    const saved = { ...plain, grounds: [paving] };
    expect(parseStoredLayout(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    const junk = { ...plain, grounds: [paving, { ...paving }, { ...paving, id: 'g2', kind: 'lava' }, { ...paving, id: 'g3', extra: 1 }, 7] };
    expect(parseStoredLayout(junk)?.grounds).toEqual([paving, { ...paving, id: 'g3' }]);
    expect(parseStoredLayout({ ...plain, grounds: 'nope' })).not.toHaveProperty('grounds');
  });
});
