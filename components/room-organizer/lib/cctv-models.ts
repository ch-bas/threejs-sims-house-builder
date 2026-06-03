/**
 * Curated library of real-world CCTV / security-camera models with their
 * published specifications, so a placed Security Camera reflects an actual
 * product instead of made-up numbers.
 *
 * `fov` is the HORIZONTAL field of view in degrees and `range` is the
 * effective IR / night-vision distance in metres — the two figures that drive
 * the on-floor vision cone. For consumer cameras whose manufacturers only
 * publish a diagonal FOV, the horizontal value is derived for a 16:9 sensor
 * (≈ diagonal × 0.87) and the original diagonal is kept in `note`.
 *
 * Specs sourced from manufacturer datasheets / official spec pages
 * (Hikvision, Axis, Dahua, Hanwha Vision, Reolink, Ubiquiti, Google, Ring,
 * Arlo) — see the PR description for the citations.
 */

export type CctvModelType = 'Dome' | 'Bullet' | 'PTZ' | 'Indoor' | 'Battery';

export interface CctvModel {
  id: string;
  brand: string;
  model: string;
  type: CctvModelType;
  /** Horizontal field of view, degrees. */
  fov: number;
  /** Effective IR / night-vision range, metres. */
  range: number;
  /** Headline resolution as marketed. */
  resolution: string;
  /** Lens / FOV caveats worth surfacing (varifocal ranges, diagonal source). */
  note?: string;
}

export const CCTV_MODELS: readonly CctvModel[] = [
  { id: 'hik-2cd2143g2', brand: 'Hikvision', model: 'DS-2CD2143G2-I', type: 'Dome', fov: 103, range: 30, resolution: '4 MP', note: '2.8 mm fixed lens' },
  { id: 'axis-p3245lve', brand: 'Axis', model: 'P3245-LVE', type: 'Dome', fov: 100, range: 40, resolution: '1080p', note: 'Varifocal 100°–36°' },
  { id: 'dahua-hfw2831t', brand: 'Dahua', model: 'IPC-HFW2831T-AS', type: 'Bullet', fov: 105, range: 80, resolution: '4K · 8 MP', note: '2.8 mm, 80 m IR' },
  { id: 'reolink-rlc810a', brand: 'Reolink', model: 'RLC-810A', type: 'Bullet', fov: 87, range: 30, resolution: '4K · 8 MP', note: '4 mm fixed lens' },
  { id: 'hanwha-qno8080r', brand: 'Hanwha', model: 'Wisenet QNO-8080R', type: 'Bullet', fov: 100, range: 30, resolution: '5 MP', note: 'Varifocal 100°–31°' },
  { id: 'unifi-g5-bullet', brand: 'Ubiquiti', model: 'UniFi G5 Bullet', type: 'Bullet', fov: 84, range: 10, resolution: '2K · 4 MP' },
  { id: 'hik-2de4425iw', brand: 'Hikvision', model: 'DS-2DE4425IW-DE', type: 'PTZ', fov: 55, range: 100, resolution: '4 MP', note: '25× zoom, 55°–2.4°' },
  { id: 'nest-cam-battery', brand: 'Google', model: 'Nest Cam (battery)', type: 'Indoor', fov: 113, range: 6, resolution: '1080p', note: '130° diagonal' },
  { id: 'ring-spotlight-plus', brand: 'Ring', model: 'Spotlight Cam Plus', type: 'Battery', fov: 115, range: 9, resolution: '1080p', note: '143° diagonal' },
  { id: 'arlo-pro5s', brand: 'Arlo', model: 'Pro 5S', type: 'Battery', fov: 130, range: 7, resolution: '2K · 4 MP', note: '160° diagonal' },
  // Additional common models (reuse the five existing shapes via `type`).
  { id: 'hik-colorvu-2047', brand: 'Hikvision', model: 'DS-2CD2047G2-LU ColorVu', type: 'Bullet', fov: 112, range: 40, resolution: '4 MP', note: '2.8 mm, full-colour night' },
  { id: 'dahua-wizsense-3441', brand: 'Dahua', model: 'IPC-HDBW3441E-AS WizSense', type: 'Dome', fov: 103, range: 50, resolution: '4 MP', note: '2.8 mm' },
  { id: 'axis-m2036le', brand: 'Axis', model: 'M2036-LE', type: 'Bullet', fov: 129, range: 20, resolution: '4 MP', note: '2.4 mm wide' },
  { id: 'amcrest-ip8m2496', brand: 'Amcrest', model: 'IP8M-2496E', type: 'Bullet', fov: 112, range: 40, resolution: '4K · 8 MP', note: '2.8 mm' },
  { id: 'lorex-e892ab', brand: 'Lorex', model: 'E892AB', type: 'Bullet', fov: 108, range: 30, resolution: '4K · 8 MP', note: '2.8 mm, deterrence light' },
  { id: 'tapo-c320ws', brand: 'TP-Link', model: 'Tapo C320WS', type: 'Bullet', fov: 97, range: 30, resolution: '2K · 4 MP', note: 'colour night vision' },
  { id: 'eufycam-3', brand: 'eufy', model: 'eufyCam 3 (S330)', type: 'Battery', fov: 130, range: 10, resolution: '4K · 8 MP', note: '135° FOV, solar' },
  { id: 'wyze-cam-v3', brand: 'Wyze', model: 'Cam v3', type: 'Indoor', fov: 105, range: 9, resolution: '1080p', note: '121° diagonal' },
  { id: 'blink-outdoor-4', brand: 'Blink', model: 'Outdoor 4', type: 'Battery', fov: 124, range: 8, resolution: '1080p', note: '143° diagonal' },
];

/** Default model a freshly-placed Security Camera adopts. */
export const DEFAULT_CCTV_MODEL_ID = 'hik-2cd2143g2';

export function getCctvModel(id: string | undefined): CctvModel | undefined {
  if (!id) return undefined;
  return CCTV_MODELS.find((entry) => entry.id === id);
}

/** Order the dedicated camera menu groups the models by. */
export const CCTV_TYPE_ORDER: readonly CctvModelType[] = ['Dome', 'Bullet', 'PTZ', 'Indoor', 'Battery'];

/** One-line description of each form factor for the camera menu tiles. */
export const CCTV_TYPE_BLURB: Record<CctvModelType, string> = {
  Dome: 'Wide-angle dome',
  Bullet: 'Long-range barrel',
  PTZ: 'Pan-tilt-zoom dome',
  Indoor: 'Compact indoor pod',
  Battery: 'Wireless spotlight cam',
};

/** The model placed when a user picks a type tile (they can switch model after). */
export const REPRESENTATIVE_MODEL_BY_TYPE: Record<CctvModelType, string> = {
  Dome: 'hik-2cd2143g2',
  Bullet: 'reolink-rlc810a',
  PTZ: 'hik-2de4425iw',
  Indoor: 'nest-cam-battery',
  Battery: 'ring-spotlight-plus',
};

export function modelsOfType(type: CctvModelType): CctvModel[] {
  return CCTV_MODELS.filter((entry) => entry.type === type);
}
