import type { FurnitureItem } from '../lib/types';
import { type BuilderContext, type FurnitureBuilder, type ThreeModule, buildFallback } from './builder-utils';
import { buildChair, buildArmchair, buildBench, buildSofa } from './builders/builders-seating';
import { buildBed, buildNightstand, buildDresser } from './builders/builders-bedroom';
import { buildTableOrDesk } from './builders/builders-tables';
import { buildBookshelf, buildCabinet } from './builders/builders-storage';
import { buildFridge, buildStove, buildSink, buildCounter } from './builders/builders-kitchen';
import { buildToilet, buildBathtub, buildShower } from './builders/builders-bathroom';
import { buildTV, buildComputer, buildWiFi, buildRouter, buildCCTV } from './builders/builders-electronics';
import { buildLamp, buildPendantLight, buildLamppost } from './builders/builders-lighting';
import {
  buildRug, buildPainting, buildVase, buildMirror, buildCurtains,
  buildWallShelf, buildWallClock, buildCandles, buildBooksStack,
} from './builders/builders-decor';
import {
  buildPlant, buildFlowerpot, buildTree, buildPineTree, buildBush,
  buildHedge, buildFlowerBed, buildTulips, buildSunflower, buildRoseBush,
} from './builders/builders-plants';
import {
  buildFence, buildPool, buildBbq, buildMailbox, buildBirdbath,
  buildSteppingStone, buildGardenBench, buildPicnicTable, buildPond,
} from './builders/builders-outdoor';
import { buildPerson, buildPet } from './builders/builders-people';
import { buildDoor, buildWindow, buildStairs } from './builders/builders-structure';

const BUILDERS: Record<string, FurnitureBuilder> = {
  bed: buildBed,
  chair: buildChair,
  'dining-chair': buildChair,
  armchair: buildArmchair,
  bench: buildBench,
  sofa: buildSofa,
  table: buildTableOrDesk,
  'dining-table': buildTableOrDesk,
  'coffee-table': buildTableOrDesk,
  'side-table': buildTableOrDesk,
  desk: buildTableOrDesk,
  bookshelf: buildBookshelf,
  cabinet: buildCabinet,
  wardrobe: buildCabinet,
  dresser: buildDresser,
  lamp: buildLamp,
  'floor-lamp': buildLamp,
  plant: buildPlant,
  flowerpot: buildFlowerpot,
  tree: buildTree,
  tv: buildTV,
  computer: buildComputer,
  nightstand: buildNightstand,
  wifi: buildWiFi,
  router: buildRouter,
  cctv: buildCCTV,
  fridge: buildFridge,
  stove: buildStove,
  dishwasher: buildCabinet,
  'kitchen-sink': buildSink,
  'bathroom-sink': buildSink,
  counter: buildCounter,
  toilet: buildToilet,
  bathtub: buildBathtub,
  shower: buildShower,
  rug: buildRug,
  painting: buildPainting,
  vase: buildVase,
  mirror: buildMirror,
  curtains: buildCurtains,
  'pendant-light': buildPendantLight,
  'wall-shelf': buildWallShelf,
  'wall-clock': buildWallClock,
  candles: buildCandles,
  books: buildBooksStack,
  fence: buildFence,
  pool: buildPool,
  'pine-tree': buildPineTree,
  bush: buildBush,
  hedge: buildHedge,
  flowerbed: buildFlowerBed,
  tulips: buildTulips,
  sunflower: buildSunflower,
  'rose-bush': buildRoseBush,
  bbq: buildBbq,
  mailbox: buildMailbox,
  birdbath: buildBirdbath,
  lamppost: buildLamppost,
  'stepping-stone': buildSteppingStone,
  'garden-bench': buildGardenBench,
  'picnic-table': buildPicnicTable,
  pond: buildPond,
  person: buildPerson,
  pet: buildPet,
  stairs: buildStairs,
  door: buildDoor,
  window: buildWindow,
};

export function createFurnitureModel(
  THREE: ThreeModule,
  item: FurnitureItem,
  hasCollision: boolean
): ReturnType<FurnitureBuilder> {
  const ctx: BuilderContext = {
    THREE,
    item,
    hasCollision,
    baseColor: hasCollision ? 0xff0000 : item.color,
    opacity: hasCollision ? 0.7 : 1.0,
  };
  const builder = BUILDERS[item.type] ?? buildFallback;
  return builder(ctx);
}
