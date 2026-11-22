import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { layoutReducer, type LayoutState } from './layout-reducer';

const IMAGE = 'data:image/png;base64,AAAA';
const stateOf = (layout = makeLayout({ floors: [makeFloor()] })): LayoutState => ({ layout, activeFloorIndex: 0 });
const traced = (): LayoutState => layoutReducer(stateOf(), { type: 'setFloorPlan', image: IMAGE });

describe('layoutReducer — setFloorPlanMode (#920)', () => {
  it('turns a traced plan into an underlay and back, storing the drawing as no key', () => {
    const underlay = layoutReducer(traced(), { type: 'setFloorPlanMode', mode: 'underlay' });
    expect(underlay.layout.floorPlanMode).toBe('underlay');
    const drawing = layoutReducer(underlay, { type: 'setFloorPlanMode', mode: 'drawing' });
    expect('floorPlanMode' in drawing.layout).toBe(false);
    expect(drawing.layout.floorPlanImage).toBe(IMAGE);
  });

  it('a repeat, or no image to switch, returns the same state', () => {
    const state = traced();
    expect(layoutReducer(state, { type: 'setFloorPlanMode', mode: 'drawing' })).toBe(state);
    const underlay = layoutReducer(state, { type: 'setFloorPlanMode', mode: 'underlay' });
    expect(layoutReducer(underlay, { type: 'setFloorPlanMode', mode: 'underlay' })).toBe(underlay);
    const bare = stateOf();
    expect(layoutReducer(bare, { type: 'setFloorPlanMode', mode: 'underlay' })).toBe(bare);
  });

  it('keeps the calibration rules: another image keeps the mode, removing the plan drops all three', () => {
    const transform = { scale: 0.01, offsetX: 0, offsetZ: 0 };
    let state = layoutReducer(traced(), { type: 'setFloorPlanMode', mode: 'underlay' });
    state = layoutReducer(state, { type: 'setFloorPlanTransform', transform });
    expect(state.layout.floorPlanTransform).toEqual(transform);
    const replaced = layoutReducer(state, { type: 'setFloorPlan', image: 'data:image/png;base64,BBBB' }).layout;
    expect(replaced.floorPlanMode).toBe('underlay');
    expect(replaced.floorPlanTransform).toBeUndefined();
    const removed = layoutReducer(state, { type: 'setFloorPlan', image: null }).layout;
    expect(['floorPlanImage', 'floorPlanTransform', 'floorPlanMode'].filter((key) => key in removed)).toEqual([]);
  });

  it('a whole house loads with its mode, and leaves it behind without its image', () => {
    const house = makeLayout({ floorPlanImage: IMAGE, floorPlanMode: 'underlay' });
    expect(layoutReducer(stateOf(), { type: 'applyLayout', layout: house }).layout.floorPlanMode).toBe('underlay');
    const bare = makeLayout({ floorPlanMode: 'underlay' });
    expect('floorPlanMode' in layoutReducer(stateOf(), { type: 'applyLayout', layout: bare }).layout).toBe(false);
  });

  it('an explicit drawing mode is already the drawing: no new state', () => {
    const state = stateOf(makeLayout({ floors: [makeFloor()], floorPlanImage: IMAGE, floorPlanMode: 'drawing' }));
    expect(layoutReducer(state, { type: 'setFloorPlanMode', mode: 'drawing' })).toBe(state);
  });
});
