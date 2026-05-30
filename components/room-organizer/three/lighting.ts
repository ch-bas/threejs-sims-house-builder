import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

export const LIGHTING_TAGS = {
  Ambient: 'light:ambient',
  Directional: 'light:directional',
  Lamp: 'light:lamp',
} as const;

/**
 * Hour-of-day presets, named for convenience. Continuous values are also
 * valid — the lighting helpers interpolate between dawn / noon / dusk /
 * midnight smoothly.
 */
export const TIME_PRESETS = {
  dawn: 6,
  noon: 12,
  dusk: 18,
  midnight: 22,
} as const;

export type TimePresetKey = keyof typeof TIME_PRESETS;

export interface LampPosition {
  x: number;
  z: number;
  height: number;
}

/**
 * Apply a continuous time-of-day to the scene's lighting. Sun rises in the
 * east at hour 6, peaks at hour 12, sets in the west at hour 18; nighttime
 * (18..6) dims the sky and triggers warm point lights at every placed lamp.
 */
export function applyTimeOfDay(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  hour: number,
  lampPositions: ReadonlyArray<LampPosition>
): void {
  const time = ((hour % 24) + 24) % 24;
  const profile = computeSkyProfile(time);

  scene.background = new THREE.Color(profile.background);

  for (const obj of scene.children) {
    const tag = obj.userData.type as string | undefined;
    if (tag === LIGHTING_TAGS.Ambient) {
      const light = obj as ThreeNS.AmbientLight;
      light.color = new THREE.Color(profile.ambient.color);
      light.intensity = profile.ambient.intensity;
    } else if (tag === LIGHTING_TAGS.Directional) {
      const light = obj as ThreeNS.DirectionalLight;
      light.color = new THREE.Color(profile.sun.color);
      light.intensity = profile.sun.intensity;
      light.position.set(profile.sun.position[0], profile.sun.position[1], profile.sun.position[2]);
    }
  }

  // Replace any prior lamp point-lights with a fresh set for the current time.
  scene.children
    .filter((obj) => obj.userData.type === LIGHTING_TAGS.Lamp)
    .forEach((obj) => scene.remove(obj));

  const nightFactor = nightIntensity(time);
  if (nightFactor > 0 && lampPositions.length > 0) {
    const color = 0xffd180;
    const baseIntensity = 1.6;
    const distance = 6;
    for (const lamp of lampPositions) {
      const point = new THREE.PointLight(color, baseIntensity * nightFactor, distance, 2);
      point.position.set(lamp.x, lamp.height * 0.9, lamp.z);
      point.userData.type = LIGHTING_TAGS.Lamp;
      scene.add(point);
    }
  }
}

interface SkyProfile {
  ambient: { color: number; intensity: number };
  sun: { color: number; intensity: number; position: readonly [number, number, number] };
  background: number;
}

/**
 * Smoothly interpolate sky colour, sun position, and intensities for a
 * given hour. The math is deliberately readable — it isn't physically
 * accurate, but the result reads as a coherent day/night cycle.
 */
function computeSkyProfile(hour: number): SkyProfile {
  const dayFraction = clamp01((hour - 6) / 12); // 0 at 06:00, 1 at 18:00
  const sunAboveHorizon = hour >= 6 && hour <= 18;

  // Sun arcs across the sky from east (-x) to west (+x), peaking at y.
  const azimuth = (dayFraction - 0.5) * Math.PI; // -π/2..π/2
  const elevation = sunAboveHorizon ? Math.sin(dayFraction * Math.PI) : 0;
  const sunDistance = 10;
  const position: [number, number, number] = [
    Math.sin(azimuth) * sunDistance,
    elevation * sunDistance + 1,
    Math.cos(azimuth) * sunDistance * 0.5,
  ];

  // Warmth: high at sunrise/sunset, low at noon (white) and night (cool blue).
  const warmth = sunAboveHorizon
    ? Math.pow(1 - Math.abs(dayFraction - 0.5) * 2, 2) // peaks at 06 and 18
    : 0;
  const noonness = sunAboveHorizon ? Math.sin(dayFraction * Math.PI) : 0;

  const sunColor = mixHex(0xffffff, 0xff8a50, warmth * 0.7);
  const sunIntensity = sunAboveHorizon ? 0.2 + noonness * 0.7 : 0;

  const nightAmbient = mixHex(0x6a7fb7, 0x12172e, 1 - clamp01(elevation * 3));
  const dayAmbient = mixHex(0xffd29a, 0xffffff, noonness);
  const ambientColor = sunAboveHorizon ? dayAmbient : nightAmbient;
  const ambientIntensity = sunAboveHorizon ? 0.35 + noonness * 0.3 : 0.18;

  const horizonNight = 0x1a1f3a;
  const horizonDay = 0xb3d7ff;
  const horizonDusk = 0xfdd9b0;
  let background = horizonNight;
  if (sunAboveHorizon) {
    background = mixHex(horizonDusk, horizonDay, noonness);
  } else {
    // 18..22 = darkening; 22..6 = full night; 4..6 = lifting
    const timeToDawn = hour < 6 ? hour : 24 - hour + 6;
    const dawnNess = clamp01(1 - timeToDawn / 6);
    background = mixHex(horizonNight, horizonDusk, dawnNess * 0.5);
  }

  return {
    ambient: { color: ambientColor, intensity: ambientIntensity },
    sun: { color: sunColor, intensity: sunIntensity, position },
    background,
  };
}

function nightIntensity(hour: number): number {
  if (hour >= 6 && hour <= 18) return 0;
  if (hour < 6) return clamp01((6 - hour) / 6);
  return clamp01((hour - 18) / 6);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mixHex(a: number, b: number, t: number): number {
  const clamped = clamp01(t);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * clamped);
  const g = Math.round(ag + (bg - ag) * clamped);
  const blue = Math.round(ab + (bb - ab) * clamped);
  return (r << 16) | (g << 8) | blue;
}
