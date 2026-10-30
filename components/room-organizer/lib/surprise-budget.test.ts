import { describe, expect, it } from 'vitest';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { budgetSpent, purchasePrice } from './budget';
import { DEFAULT_BUDGET } from './constants';
import { subscribeNotices, type Notice } from './editor-notices';
import { ENTRANCE_DOOR_ID } from './street';
import { decideSurprise, keptBySurprise, runSurprise, surpriseFloorItems, surpriseLayout } from './surprise';
import type { ConfirmOptions } from './confirm-dialog';
import type { SoundCue } from './sounds';
import type { FurnitureItem, RoomLayout } from './types';

/** Filler on the upper floor that spends the budget down to `left`. */
function filler(left: number): FurnitureItem {
  return makeItem({ id: 'filler', type: 'sofa', category: 'seating', price: DEFAULT_BUDGET - left, position: { x: 0, z: 0 } });
}

const yes = (): Promise<boolean> => Promise.resolve(true);

/** The in-app question's title is what used to be the native confirm's message. */
function recording(asked: string[], answer: (message: string) => boolean) {
  return (question: ConfirmOptions): Promise<boolean> => {
    asked.push(question.title);
    return Promise.resolve(answer(question.title));
  };
}

const chair = makeItem({ id: 'chair', type: 'chair', category: 'seating', price: 0, position: { x: 2, z: 2 } });

function houseWithLeft(left: number, hard: boolean): RoomLayout {
  return makeLayout({
    floors: [makeFloor({ items: [chair] }), makeFloor({ id: 'upper', items: [filler(left)] })],
    ...(hard ? { budget: { writeOff: 0 } } : {}),
  });
}

describe('Surprise respects the budget (#581)', () => {
  it('caps the set as well as the decor at maxCost', () => {
    for (let seed = 0; seed < 50; seed++) {
      const items = surpriseLayout({ roomWidth: 8, roomDepth: 8, maxCost: 100, seed });
      expect(purchasePrice(items), `seed ${seed}`).toBeLessThanOrEqual(100);
    }
  });

  it('under the hard budget, never generates more than is left', () => {
    for (let seed = 0; seed < 30; seed++) {
      const layout = houseWithLeft(500, true);
      const generated = surpriseFloorItems(layout, 0, DEFAULT_BUDGET, seed).filter((item) => !keptBySurprise(item));
      expect(purchasePrice(generated), `seed ${seed}`).toBeLessThanOrEqual(500);
    }
  });

  it('under the hard budget, the reducer accepts what Surprise generates', async () => {
    let accepted = 0;
    for (let seed = 0; seed < 20; seed++) {
      const layout = houseWithLeft(200, true);
      const state: LayoutState = { layout, activeFloorIndex: 0 };
      const outcome = await decideSurprise(layout, 0, DEFAULT_BUDGET, yes, seed);
      if (outcome === null || 'refusal' in outcome) continue;
      const next = layoutReducer(state, { type: 'replaceItems', items: outcome.items });
      expect(budgetSpent(next.layout), `seed ${seed}`).toBeLessThanOrEqual(DEFAULT_BUDGET);
      expect(next, `seed ${seed}: the reducer dropped the surprise`).not.toBe(state);
      accepted += 1;
    }
    expect(accepted).toBeGreaterThan(0);
  });

  it('under the hard budget with nothing affordable, refuses before asking', async () => {
    const layout = houseWithLeft(5, true);
    const asked: string[] = [];
    const outcome = await decideSurprise(layout, 0, DEFAULT_BUDGET, recording(asked, () => true), 3);
    expect(outcome).toEqual({ refusal: expect.stringMatching(/Over budget/) as unknown });
    expect(asked).toEqual([]);
  });

  it('under the soft budget, asks before going over and cancels on no', async () => {
    const layout = houseWithLeft(5, false);
    const asked: string[] = [];
    const outcome = await decideSurprise(layout, 0, DEFAULT_BUDGET, recording(asked, (message) => !message.includes('over the')), 3);
    expect(asked.some((message) => /over the .*budget\. Place it anyway\?/.test(message))).toBe(true);
    expect(outcome).toBeNull();
  });

  it('under the soft budget, places the over-budget surprise when the player agrees', async () => {
    const layout = houseWithLeft(5, false);
    const outcome = await decideSurprise(layout, 0, DEFAULT_BUDGET, yes, 3);
    expect(outcome !== null && 'items' in outcome && outcome.items.some((item) => item.id.startsWith('surprise'))).toBe(true);
  });

  it('within budget, asks only whether to replace the furniture', async () => {
    const layout = houseWithLeft(20_000, true);
    const asked: string[] = [];
    const outcome = await decideSurprise(layout, 0, DEFAULT_BUDGET, recording(asked, () => true), 3);
    expect(asked).toEqual(['Replace the furniture on this floor with a surprise layout?']);
    expect(outcome !== null && 'items' in outcome).toBe(true);
  });

  it('declining the replace confirm cancels', async () => {
    const layout = houseWithLeft(20_000, false);
    expect(await decideSurprise(layout, 0, DEFAULT_BUDGET, () => Promise.resolve(false), 3)).toBeNull();
  });
});

describe('Surprise does not count a legacy porch door (#600)', () => {
  it('spends the same budget with or without a priced porch door', () => {
    const door = makeItem({ id: ENTRANCE_DOOR_ID, type: 'door', category: 'structure', price: 320, width: 0.9, depth: 0.12, position: { x: 0, z: -4 } });
    const freeDoor = { ...door, price: 0 };
    const withLegacy = makeLayout({ floors: [makeFloor({ items: [door] }), makeFloor({ id: 'upper', items: [filler(1500)] })] });
    const withFree = makeLayout({ floors: [makeFloor({ items: [freeDoor] }), makeFloor({ id: 'upper', items: [filler(1500)] })] });
    for (let seed = 0; seed < 20; seed++) {
      const a = surpriseFloorItems(withLegacy, 0, DEFAULT_BUDGET, seed).filter((item) => item.id !== ENTRANCE_DOOR_ID);
      const b = surpriseFloorItems(withFree, 0, DEFAULT_BUDGET, seed).filter((item) => item.id !== ENTRANCE_DOOR_ID);
      expect(a, `seed ${seed}`).toEqual(b);
    }
  });
});

describe('runSurprise: the one place Surprise plays its cue (#581)', () => {
  async function run(layout: RoomLayout) {
    const cues: SoundCue[] = [];
    const replaced: FurnitureItem[][] = [];
    const notices: Notice[] = [];
    const stop = subscribeNotices((notice) => notices.push(notice));
    try {
      const done = await runSurprise(layout, 0, DEFAULT_BUDGET, {
        confirm: yes,
        playCue: (cue) => cues.push(cue),
        replaceItems: (items) => replaced.push(items),
      });
      return { done, cues, replaced, notices };
    } finally {
      stop();
    }
  }

  it('a hard-budget refusal plays `refused` once, shows why and replaces nothing', async () => {
    const { done, cues, replaced, notices } = await run(houseWithLeft(5, true));
    expect(done).toBe(false);
    expect(cues).toEqual(['refused']);
    expect(replaced).toEqual([]);
    expect(notices.map((notice) => [notice.tone, notice.message])).toEqual([['error', expect.stringMatching(/Over budget/) as unknown]]);
  });

  it('an affordable surprise replaces the floor without a refusal', async () => {
    const { done, cues, replaced, notices } = await run(houseWithLeft(20_000, true));
    expect(done).toBe(true);
    expect(cues).toEqual([]);
    expect(replaced).toHaveLength(1);
    expect(notices).toEqual([]);
  });
});

describe('runSurprise reads the house again after asking (#649 review)', () => {
  it('replaces nothing when the house changed while the question was open', async () => {
    const layout = houseWithLeft(20_000, false);
    const replaced: FurnitureItem[][] = [];
    const notices: Notice[] = [];
    const stop = subscribeNotices((notice) => notices.push(notice));
    try {
      const done = await runSurprise(layout, 0, DEFAULT_BUDGET, {
        confirm: yes,
        playCue: () => {},
        replaceItems: (items) => replaced.push(items),
        current: () => ({ ...layout, name: 'Adopted from another tab' }),
      });
      expect(done).toBe(false);
    } finally {
      stop();
    }
    expect(replaced).toEqual([]);
    expect(notices.map((notice) => notice.message)).toEqual([expect.stringMatching(/changed while/) as unknown]);
  });
});
