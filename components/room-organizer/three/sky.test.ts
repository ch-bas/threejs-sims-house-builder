import { describe, expect, it } from 'vitest';
import { computeSkyProfile } from './lighting';
import { SKY_RADIUS, setSkyDetail, updateSky } from './sky';
import * as THREE from './three-runtime';
import type * as ThreeNS from 'three';

function skyScene(hour: number, weather: 'clear' | 'rain' = 'clear'): { scene: ThreeNS.Scene; dome: ThreeNS.Mesh } {
  const scene = new THREE.Scene();
  updateSky(THREE, scene, computeSkyProfile(hour, weather), weather);
  const dome = scene.children.find((obj) => obj.userData.type === 'sky:dome') as ThreeNS.Mesh;
  return { scene, dome };
}

/** The dome's colour at the vertex nearest straight up / on the horizon. */
function domeColour(dome: ThreeNS.Mesh, wantY: number): THREE.Color {
  const position = dome.geometry.getAttribute('position');
  const color = dome.geometry.getAttribute('color');
  let best = 0;
  for (let i = 1; i < position.count; i += 1) {
    if (Math.abs(position.getY(i) / SKY_RADIUS - wantY) < Math.abs(position.getY(best) / SKY_RADIUS - wantY)) best = i;
  }
  return new THREE.Color(color.getX(best), color.getY(best), color.getZ(best));
}

describe('the world-space sky (#761)', () => {
  it('hangs the horizon colour on the real horizon and the zenith overhead', () => {
    // Midnight: no sun glow on top of the two colours.
    const { dome } = skyScene(0);
    const profile = computeSkyProfile(0);
    expect(domeColour(dome, 1).getHex()).toBe(new THREE.Color(profile.backgroundTop).getHex());
    const below = domeColour(dome, -0.6);
    expect(below.getHexString()).toBe(new THREE.Color(profile.background).getHexString());
  });

  it('stays out of depth, shadows and clicks, and draws first', () => {
    const { dome } = skyScene(12);
    const material = dome.material as ThreeNS.MeshBasicMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(false);
    expect(dome.castShadow).toBe(false);
    expect(dome.frustumCulled).toBe(false);
    expect(dome.renderOrder).toBeLessThan(-1);
    const hits: unknown[] = [];
    dome.raycast(new THREE.Raycaster(), hits as never);
    expect(hits).toHaveLength(0);
  });

  it('repaints in place on an hour step, with a plain colour behind it', () => {
    const { scene, dome } = skyScene(12);
    const geometry = dome.geometry;
    const noon = domeColour(dome, 1).getHex();
    updateSky(THREE, scene, computeSkyProfile(0), 'clear');
    expect(scene.children.filter((obj) => obj.userData.type === 'sky:dome')).toHaveLength(1);
    expect(dome.geometry).toBe(geometry);
    expect(domeColour(dome, 1).getHex()).not.toBe(noon);
    expect((scene.background as ThreeNS.Color).isColor).toBe(true);
  });

  it('follows the overcast profile', () => {
    expect(domeColour(skyScene(12, 'rain').dome, 1).getHex()).not.toBe(domeColour(skyScene(12).dome, 1).getHex());
  });

  it('puts the disc where the sun is, not where the lifted light is', () => {
    const elevation = (hour: number) => {
      const [x, y, z] = computeSkyProfile(hour).sunDisc;
      return Math.asin(y / Math.hypot(x, y, z));
    };
    expect(elevation(19)).toBeLessThan(0);
    expect(elevation(5.5)).toBeLessThan(0);
    expect(elevation(6.5)).toBeLessThan(0.2);
    // At the top of the arc the disc and the light agree.
    const noon = computeSkyProfile(12);
    expect(noon.sunDisc).toEqual(noon.sun.position);
  });

  it('rebuilds a leaner dome for the low tier, painted the same, and back (#760)', () => {
    const { scene, dome } = skyScene(0);
    const rich = dome.geometry.getAttribute('position').count;
    setSkyDetail(THREE, scene, false);
    const lean = scene.children.filter((obj) => obj.userData.type === 'sky:dome') as ThreeNS.Mesh[];
    expect(lean).toHaveLength(1);
    expect(lean[0]!.geometry.getAttribute('position').count).toBeLessThan(rich / 3);
    expect(domeColour(lean[0]!, 1).getHex()).toBe(domeColour(dome, 1).getHex());
    setSkyDetail(THREE, scene, false);
    expect(scene.children.find((obj) => obj.userData.type === 'sky:dome')).toBe(lean[0]);
    setSkyDetail(THREE, scene, true);
    expect((scene.children.find((obj) => obj.userData.type === 'sky:dome') as ThreeNS.Mesh).geometry.getAttribute('position').count).toBe(rich);
  });
});
