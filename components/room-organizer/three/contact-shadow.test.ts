// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildContactShadow, CONTACT_PLANE_GAP, CONTACT_SHADOW_TAG, contactCanvasSize, DESKTOP_DENSITY, liftContactPatches, paintContactPlan, PHONE_DENSITY, removeContactShadows } from './contact-shadow';
import type { ContactPlan } from '../lib/contact-shadow';

const plan = (over: Partial<ContactPlan> = {}): ContactPlan => ({
  storey: 0,
  floorY: 3,
  width: 10,
  depth: 8,
  walls: [{ x1: -5, z1: -4, x2: 5, z2: -4 }],
  doors: [{ x: 0, z: -4, width: 1, depth: 0.7, rotation: 0 }],
  blobs: [
    { id: 'sofa', x: 0, z: 0, width: 2, depth: 1, rotation: 0, raised: false },
    { id: 'table', x: 2, z: 2, width: 1, depth: 1, rotation: 0, raised: true },
  ],
  holes: [{ x: -3, z: 2, width: 1, depth: 2, rotation: 0 }],
  ...over,
});

/** A 2D context that records calls with the composite mode each ran in. */
function recorder() {
  const calls: string[] = [];
  const ctx = {
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    shadowBlur: 0,
    shadowColor: '',
    shadowOffsetX: 0,
    clearRect: () => calls.push('clear'),
    beginPath: () => {},
    moveTo: (x: number) => calls.push(`move:${Math.round(x)}`),
    lineTo: () => {},
    closePath: () => {},
    fill: () => calls.push(`fill:${ctx.globalCompositeOperation}:${ctx.shadowBlur}`),
    stroke: () => calls.push(`stroke:${ctx.globalCompositeOperation}`),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('contactCanvasSize (#754)', () => {
  it('uses the density asked for', () => {
    expect(contactCanvasSize(12, 10, DESKTOP_DENSITY)).toMatchObject({ width: 768, height: 640, scale: 64 });
    expect(contactCanvasSize(12, 10, PHONE_DENSITY)).toMatchObject({ width: 384, height: 320, scale: 32 });
  });

  it.each([[60, 40], [32, 32], [40, 6]])('keeps a %i × %i m storey within its budget', (width, depth) => {
    for (const density of [DESKTOP_DENSITY, PHONE_DENSITY]) {
      const size = contactCanvasSize(width, depth, density);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(density.maxSide + 1);
      expect(size.width * size.height).toBeLessThanOrEqual(density.maxPixels * 1.01);
      expect(size.scale).toBeLessThan(density.pixelsPerMetre);
    }
  });

  it('gives a phone at most 2 MB of canvas a storey', () => {
    const size = contactCanvasSize(40, 40, PHONE_DENSITY);
    expect(size.width * size.height * 4).toBeLessThanOrEqual(2 * 1024 * 1024 * 1.01);
  });
});

describe('paintContactPlan (#754)', () => {
  const size = contactCanvasSize(10, 8, DESKTOP_DENSITY);
  const filled = (calls: string[], mode: string) => calls.filter((call) => call.startsWith(`fill:${mode}`));

  it('wipes doors after the walls, before the furniture, and holes last', () => {
    const { ctx, calls } = recorder();
    paintContactPlan(ctx, plan(), size);
    const kinds = calls.filter((call) => !call.startsWith('move'));
    expect(kinds[0]).toBe('stroke:source-over');
    expect(kinds[1]).toMatch(/^fill:destination-out/);
    expect(kinds.at(-1)).toMatch(/^fill:destination-out/);
    expect(filled(calls, 'destination-out')).toHaveLength(2);
  });

  it('gives a solid item a tight core and a raised one only the wide patch', () => {
    const { ctx, calls } = recorder();
    paintContactPlan(ctx, plan({ walls: [], doors: [], holes: [] }), size);
    const blurs = filled(calls, 'source-over').map((call) => Number(call.split(':')[2]));
    expect(blurs).toHaveLength(3);
    expect(Math.min(...blurs)).toBeLessThan(Math.max(...blurs));
    expect(blurs.at(-1)).toBeGreaterThan(blurs[1]!);
  });

  it('stays quick on a 150-item floor', () => {
    const blobs = Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, x: i % 10, z: i % 7, width: 1, depth: 1, rotation: 0.3, raised: i % 2 === 0 }));
    const { ctx } = recorder();
    const start = performance.now();
    paintContactPlan(ctx, plan({ blobs }), size);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('buildContactShadow (#754)', () => {
  const stubCanvas = () => {
    const { ctx } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  };

  it('lies flat just over the storey floor and never catches a pointer ray', () => {
    stubCanvas();
    const mesh = buildContactShadow(THREE, plan())!;
    expect(mesh.position.y).toBeCloseTo(3 + CONTACT_PLANE_GAP, 6);
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    expect(mesh.castShadow).toBe(false);
    const hits: THREE.Intersection[] = [];
    mesh.raycast(new THREE.Raycaster(), hits);
    expect(hits).toEqual([]);
  });

  it('writes no depth, so it cannot hide what stands in it', () => {
    stubCanvas();
    const material = buildContactShadow(THREE, plan())!.material as THREE.MeshBasicMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
  });

  it('repaints without a held item, once, and puts it back', () => {
    const { ctx, calls } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const scene = new THREE.Scene();
    const mesh = buildContactShadow(THREE, plan({ walls: [], doors: [], holes: [] }))!;
    scene.add(mesh);
    const map = (mesh.material as THREE.MeshBasicMaterial).map!;
    const version = map.version;
    calls.length = 0;
    liftContactPatches(scene, 0, new Set(['sofa']));
    expect(calls[0]).toBe('clear');
    // The table's one layer; the sofa's two are gone.
    expect(calls.filter((call) => call.startsWith('fill:source-over'))).toHaveLength(1);
    expect(map.version).toBeGreaterThan(version);
    calls.length = 0;
    liftContactPatches(scene, 0, new Set());
    expect(calls.filter((call) => call.startsWith('fill:source-over'))).toHaveLength(3);
  });

  it('paints a dropped item back where it landed', () => {
    const { ctx, calls } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const scene = new THREE.Scene();
    const mesh = buildContactShadow(THREE, plan({ walls: [], doors: [], holes: [], blobs: [plan().blobs[0]!] }))!;
    scene.add(mesh);
    liftContactPatches(scene, 0, new Set(['sofa']));
    calls.length = 0;
    liftContactPatches(scene, 0, new Set(), new Map([['sofa', { x: 3, z: 0 }]]));
    // The sofa's first corner, 1 m left of its centre, now at x = 2 m: 2 × 64 + 320 px.
    expect(calls.filter((call) => call.startsWith('move'))[0]).toBe(`move:${Math.round(2 * 64 + 320 - 16384)}`);
  });

  it('leaves another storey\'s map alone', () => {
    const { ctx, calls } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const scene = new THREE.Scene();
    scene.add(buildContactShadow(THREE, plan({ storey: 1 }))!);
    calls.length = 0;
    liftContactPatches(scene, 0, new Set(['sofa']));
    expect(calls).toEqual([]);
  });

  it('frees its texture when removed', () => {
    stubCanvas();
    const scene = new THREE.Scene();
    const mesh = buildContactShadow(THREE, plan())!;
    scene.add(mesh);
    const map = (mesh.material as THREE.MeshBasicMaterial).map!;
    const dispose = vi.fn();
    map.addEventListener('dispose', dispose);
    removeContactShadows(scene);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scene.children.some((child) => child.userData.type === CONTACT_SHADOW_TAG)).toBe(false);
  });
});
