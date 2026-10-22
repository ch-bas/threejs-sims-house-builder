import { describe, expect, it } from 'vitest';
import { canvasToWorld, get2DBoundsTransform, get2DViewTransform } from './render';

const room = { width: 8, height: 8 };

describe('get2DBoundsTransform (#377)', () => {
  it('is the room fit when the bounds are the room', () => {
    const bounds = { minX: -4, minZ: -4, maxX: 4, maxZ: 4 };
    expect(get2DBoundsTransform(1200, 900, room, bounds, 60)).toEqual(get2DViewTransform(1200, 900, room, 60));
  });

  it('fits and centres content past the walls, keeping the room-corner offsets', () => {
    // A tree whose footprint reaches x = 8.2 east of an 8 m house.
    const bounds = { minX: -4, minZ: -4, maxX: 8.2, maxZ: 4 };
    const t = get2DBoundsTransform(1200, 830, room, bounds, 60);
    expect(t.scale).toBeCloseTo(1080 / 12.2, 9);
    // Content's left and right edges land on the padding.
    expect(canvasToWorld(60, 415, t, room).x).toBeCloseTo(-4, 9);
    expect(canvasToWorld(1140, 415, t, room).x).toBeCloseTo(8.2, 9);
    // Vertically the content is centred in the canvas.
    const bottom = t.offsetY + 8 * t.scale;
    expect(t.offsetY).toBeCloseTo(830 - bottom, 9);
  });
});
