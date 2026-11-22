// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { WALKER_CARD_INTERVAL, createWalkerCards } from '../lib/walker-card';
import { walkerName } from '../lib/walker-card-text';
import { useNpcs } from './use-npcs';
import type { RoomLayout } from '../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const threeModuleRef = { current: THREE as unknown as typeof import('../three/three-runtime') };

interface Props {
  on: boolean;
  shownTo?: number;
  hideBubbles?: boolean;
}

/** Walkers on an empty 6 × 6 m floor (or `building`), with the card store and a budget the test ticks. */
function mount(enabled = true, building: RoomLayout = makeLayout({ width: 6, height: 6 })) {
  const scene = new THREE.Scene();
  const steps: Array<(delta: number) => boolean> = [];
  const addDecorativeStep = (step: (delta: number) => boolean) => {
    steps.push(step);
    return () => {
      steps.splice(steps.indexOf(step), 1);
    };
  };
  const cards = createWalkerCards();
  const sceneRef = { current: scene };
  const hook = renderHook(
    ({ on, shownTo = 0, hideBubbles = false }: Props) =>
      useNpcs({ enabled: on, threeModuleRef, sceneRef, building, shownFrom: 0, shownTo, addDecorativeStep, cards, hideBubbles }),
    { initialProps: { on: enabled } as Props }
  );
  const walkers = () => scene.children.filter((child) => child.userData.type === 'npc');
  const tick = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.1) for (const step of [...steps]) step(0.1);
  };
  return { scene, cards, walkers, tick, ...hook };
}

describe('the walker card and bubbles (#906)', () => {
  it('every walker carries a hidden bubble and an id a tap finds', () => {
    const { walkers } = mount();
    const ids = walkers().map((walker) => walker.userData.walkerId as number);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const walker of walkers()) {
      const bubble = walker.children.find((child) => child.name === 'need-bubble');
      expect(bubble).toBeInstanceOf(THREE.Sprite);
      expect(bubble!.visible).toBe(false);
    }
  });

  it('a tap fills the card at once, then twice a second; the walkers leaving close it', () => {
    const { cards, walkers, tick, rerender } = mount();
    const id = walkers()[1]!.userData.walkerId as number;
    act(() => cards.select(id, { x: 10, y: 20 }));
    const first = cards.snapshot();
    expect(first?.id).toBe(id);
    expect(first?.seed).toBe(1);
    expect(Object.keys(first!.needs).sort()).toEqual(['energy', 'fun', 'hunger', 'hygiene']);
    const publish = vi.spyOn(cards, 'publish');
    tick(WALKER_CARD_INTERVAL * 4 + 0.05);
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(publish.mock.calls.length).toBeLessThanOrEqual(5);
    // Needs run down meanwhile: the card is a copy, not the walker's own object.
    expect(cards.snapshot()!.needs.hunger).toBeLessThan(first!.needs.hunger);
    rerender({ on: false });
    expect(cards.selected()).toBeNull();
  });

  it('a tap on a walker that is gone closes the card', () => {
    const { cards } = mount();
    act(() => cards.select(9_999_999));
    expect(cards.selected()).toBeNull();
  });

  it('shows a bubble over a walker left hungry, with nothing on the floor to eat; photo mode hides them all at once', () => {
    const { walkers, tick, rerender } = mount();
    const bubblesShown = () => walkers().filter((walker) => walker.children.some((child) => child.name === 'need-bubble' && child.visible)).length;
    // Two and a half minutes: every walker's hunger runs out.
    tick(160);
    expect(bubblesShown()).toBeGreaterThan(0);
    rerender({ on: true, hideBubbles: true });
    expect(bubblesShown()).toBe(0);
    tick(1);
    expect(bubblesShown()).toBe(0);
    rerender({ on: true, hideBubbles: false });
    expect(bubblesShown()).toBeGreaterThan(0);
  }, 30_000);

  it('no two walkers in the house share a name, across storeys', () => {
    const house = makeLayout({ width: 6, height: 6, floors: [makeFloor({ id: 'ground' }), makeFloor({ id: 'upper', name: 'Upper' })] });
    const { cards, walkers, rerender } = mount(true, house);
    rerender({ on: true, shownTo: 1 });
    const seeds = walkers().map((walker) => {
      act(() => cards.select(walker.userData.walkerId as number));
      return cards.snapshot()!.seed;
    });
    expect(seeds).toHaveLength(6);
    expect(new Set(seeds.map(walkerName)).size).toBe(6);
  });

  it('a walker parked closes its card without a step (reduced motion steps nothing)', () => {
    const house = makeLayout({ width: 6, height: 6, floors: [makeFloor({ id: 'ground' }), makeFloor({ id: 'upper', name: 'Upper' })] });
    const { cards, walkers, rerender } = mount(true, house);
    rerender({ on: true, shownTo: 1 });
    const upstairs = walkers().find((walker) => walker.visible && walker.position.y > 1)!;
    act(() => cards.select(upstairs.userData.walkerId as number));
    expect(cards.selected()).not.toBeNull();
    rerender({ on: true, shownTo: 0 });
    expect(cards.selected()).toBeNull();
  });
});
