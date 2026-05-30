export type Vec2 = Readonly<{ x: number; z: number }>;

export type FurnitureType =
  | 'chair'
  | 'armchair'
  | 'dining-chair'
  | 'bench'
  | 'sofa'
  | 'table'
  | 'dining-table'
  | 'coffee-table'
  | 'side-table'
  | 'bed'
  | 'desk'
  | 'bookshelf'
  | 'wardrobe'
  | 'dresser'
  | 'cabinet'
  | 'lamp'
  | 'floor-lamp'
  | 'plant'
  | 'tree'
  | 'flowerpot'
  | 'tv'
  | 'computer'
  | 'nightstand'
  | 'wifi'
  | 'router'
  | 'cctv'
  | 'fridge'
  | 'stove'
  | 'dishwasher'
  | 'kitchen-sink'
  | 'counter'
  | 'toilet'
  | 'bathtub'
  | 'shower'
  | 'bathroom-sink'
  | 'rug'
  | 'painting'
  | 'vase'
  | 'mirror'
  | 'fence'
  | 'pool'
  | 'person'
  | 'pet'
  | 'stairs'
  | 'door'
  | 'window';

export type SofaShape = 'standard' | 'L-shape' | 'U-shape';

export type StairsDirection = 'north' | 'south' | 'east' | 'west';

export type FloorPlanFitMode = 'stretch' | 'cover' | 'contain';

export type FurnitureCategory =
  | 'seating'
  | 'tables'
  | 'bedroom'
  | 'storage'
  | 'kitchen'
  | 'bathroom'
  | 'electronics'
  | 'decor'
  | 'outdoor'
  | 'people'
  | 'structure';

export interface CategoryMeta {
  key: FurnitureCategory;
  label: string;
  icon: string;
}

export interface FurnitureItem {
  id: string;
  type: FurnitureType | string;
  name: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  icon: string;
  /** Price in §, kept on the item so layouts persist their value even if the catalog changes. */
  price?: number;
  category?: FurnitureCategory;
  position?: Vec2;
  rotation?: number;
  isWiFiAccessPoint?: boolean;
  isCCTV?: boolean;
  signalRange?: number;
  sofaShape?: SofaShape;
  locked?: boolean;
  mirrored?: boolean;
  /** Direction the stairs ascend (for `type === 'stairs'`). */
  stairsDirection?: StairsDirection;
}

export type CameraPreset = 'iso' | 'top' | 'front' | 'corner';

export type CatalogItem = Omit<FurnitureItem, 'id' | 'position' | 'rotation' | 'price' | 'category'> & {
  price: number;
  category: FurnitureCategory;
};

export type WallId = 'north' | 'south' | 'east' | 'west';

export type FloorPattern = 'solid' | 'wood' | 'tile' | 'carpet' | 'concrete';

export type WallPattern = 'solid' | 'brick' | 'wallpaper' | 'panel' | 'plaster' | 'siding';

export type RoofStyle = 'none' | 'flat' | 'gable' | 'hipped';

export interface RoofSpec {
  style: RoofStyle;
  color?: string;
}

/**
 * One level of a building. Shares the building's footprint (width × depth)
 * but has its own items, finishes, and wall colors.
 */
export interface InteriorWall {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color?: string;
}

export interface FloorLayout {
  id: string;
  name: string;
  items: FurnitureItem[];
  floorColor: string;
  floorPattern?: FloorPattern;
  wallPattern?: WallPattern;
  wallColors?: Partial<Record<WallId, string>>;
  interiorWalls?: InteriorWall[];
}

/**
 * A multi-floor building. `floors[0]` is the ground floor; subsequent
 * entries stack upward. Footprint and floor-plan upload live on the
 * building because they're shared across levels.
 */
export interface RoomLayout {
  id?: string;
  name: string;
  width: number;
  height: number;
  floors: FloorLayout[];
  roof?: RoofSpec;
  floorPlanImage?: string;
  floorPlanOpacity?: number;
  floorPlanFitMode?: FloorPlanFitMode;
}

/** Vertical height of a single floor in metres. */
export const FLOOR_HEIGHT_METERS = 3;

export interface ViewSettings {
  view2D: boolean;
  showMeasurements: boolean;
  showWiFiSignals: boolean;
  snapToGrid: boolean;
  snapToWall: boolean;
  floorPlan3DEffect: boolean;
  /** Hour of the day in [0, 24); drives the continuous sun-arc lighting. */
  timeOfDay: number;
  walkthroughMode: boolean;
  showOutdoor: boolean;
  snapToItems: boolean;
  showMinimap: boolean;
  /** When true, all floors are rendered together (lower floors translucent). */
  showAllFloors: boolean;
  /**
   * Build-mode wall rendering mode.
   *  - 'up'      → every wall and the roof fully visible (orbit around the outside)
   *  - 'cutaway' → walls between the camera and the room hide automatically; roof off
   *  - 'down'    → all exterior walls + interior walls + roof hidden (top-down planning)
   */
  wallDisplay: 'up' | 'cutaway' | 'down';
  /** When true, clicking on the floor drops measurement points. */
  measurementMode: boolean;
  /** When true, the UI plays short Web Audio cues on key actions. */
  soundsEnabled: boolean;
  /** When true, clicking pairs of floor points draws an interior wall. */
  drawWallMode: boolean;
  /** When true, the 2D view overlays a price-density heatmap. */
  showHeatmap: boolean;
  /** When true, every placed item has a name label hovering above it in 3D. */
  showItemLabels: boolean;
  /** When true, animated NPCs wander the active floor. */
  showNpcs: boolean;
}

export type ThemeKey = 'modern' | 'rustic' | 'minimalist' | 'cozy' | 'tropical';

export type GameMode = 'live' | 'build' | 'buy';

export interface SavedLayoutEntry {
  id: string;
  name: string;
  savedAt: number;
  itemCount: number;
  floorCount: number;
}
