import { describe, expect, it } from 'vitest';
import { makeItem, makeUnplacedItem } from './__testfixtures__/fixtures';
import { itemLabelsKey, signalOverlaysKey } from './overlay-keys';
import type { FurnitureItem } from './types';

const sofa = makeItem({ id: 'sofa', type: 'sofa', name: 'Sofa', position: { x: 0, z: 0 } });
const wifi = makeItem({ id: 'ap', type: 'wifi', isWiFiAccessPoint: true, signalRange: 6, position: { x: 1, z: 1 } });
const camera = makeItem({
  id: 'cam',
  type: 'security-camera',
  height: 2.4,
  hasVisionCone: true,
  visionRange: 6,
  visionFov: 90,
  position: { x: -2, z: -2 },
  rotation: 0.5,
});

const overlays = (items: FurnitureItem[], index = 0) => signalOverlaysKey([{ index, items }]);

describe('itemLabelsKey (#409)', () => {
  it('ignores edits a label does not show', () => {
    expect(itemLabelsKey([{ ...sofa, color: '#ff0000', rotation: 1 }])).toBe(itemLabelsKey([sofa]));
  });

  it('changes on a rename, a move or a new height', () => {
    const before = itemLabelsKey([sofa]);
    expect(itemLabelsKey([{ ...sofa, name: 'Couch' }])).not.toBe(before);
    expect(itemLabelsKey([{ ...sofa, position: { x: 1, z: 0 } }])).not.toBe(before);
    expect(itemLabelsKey([{ ...sofa, height: 1.2 }])).not.toBe(before);
  });

  it('skips unplaced items', () => {
    expect(itemLabelsKey([sofa, makeUnplacedItem({ id: 'boxed' })])).toBe(itemLabelsKey([sofa]));
  });
});

describe('signalOverlaysKey (#409)', () => {
  it('ignores an ordinary item edit on a floor without a camera', () => {
    const before = overlays([sofa, wifi]);
    expect(overlays([{ ...sofa, color: '#ff0000', position: { x: 2, z: 0 } }, wifi])).toBe(before);
  });

  it('ignores moving or recolouring an alert target: cones read live positions', () => {
    const before = overlays([sofa, camera]);
    expect(overlays([{ ...sofa, color: '#ff0000', position: { x: 2, z: 0 } }, camera])).toBe(before);
  });

  it('changes when a cone could alert on a different set of items', () => {
    const before = overlays([sofa, camera]);
    expect(overlays([sofa, camera, makeItem({ id: 'chair', type: 'chair', position: { x: 0, z: 1 } })])).not.toBe(before);
    expect(overlays([camera])).not.toBe(before);
  });

  it('changes when a source moves, turns or changes its range', () => {
    const before = overlays([wifi, camera]);
    expect(overlays([{ ...wifi, position: { x: 2, z: 1 } }, camera])).not.toBe(before);
    expect(overlays([{ ...wifi, signalRange: 8 }, camera])).not.toBe(before);
    expect(overlays([wifi, { ...camera, rotation: 1 }])).not.toBe(before);
    expect(overlays([wifi, { ...camera, visionFov: 60 }])).not.toBe(before);
    expect(overlays([wifi, { ...camera, height: 2 }])).not.toBe(before);
  });

  it('changes with the storey the overlays stand on', () => {
    expect(overlays([wifi], 1)).not.toBe(overlays([wifi], 0));
  });
});
