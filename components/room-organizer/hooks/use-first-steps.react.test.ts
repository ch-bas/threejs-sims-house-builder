// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { FIRST_STEPS_STORAGE_KEY } from '../lib/first-steps';
import { markLayoutLoaded } from './use-achievements';
import {
  dismissFirstSteps,
  markFirstStep,
  offerFirstSteps,
  resetFirstStepsForTests,
  useFirstStepsDone,
  useFirstStepsOffered,
  useFirstStepsProgress,
} from './use-first-steps';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

const empty = makeLayout({ floors: [makeFloor({ items: [] })] });
const withDoor = (layout: RoomLayout): RoomLayout => ({
  ...layout,
  floors: [makeFloor({ items: [makeItem({ id: 'd', type: 'door', category: 'structure' })] })],
});

function useBoth(layout: RoomLayout) {
  useFirstStepsProgress(layout, true);
  return { done: useFirstStepsDone(), offered: useFirstStepsOffered() };
}

describe('Getting started session (#721)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetFirstStepsForTests();
  });

  it('an edit does a step; the opening house does none', () => {
    const { result, rerender } = renderHook(({ layout }) => useBoth(layout), { initialProps: { layout: withDoor(empty) } });
    expect(result.current.done.size).toBe(0);
    rerender({ layout: empty });
    rerender({ layout: withDoor(empty) });
    expect([...result.current.done]).toEqual(['door']);
  });

  it('a whole-house load does no step', () => {
    const { result, rerender } = renderHook(({ layout }) => useBoth(layout), { initialProps: { layout: empty } });
    const template = withDoor(empty);
    layoutStore.setState({ layout: template, activeFloorIndex: 0 });
    markLayoutLoaded();
    rerender({ layout: template });
    expect(result.current.done.size).toBe(0);
  });

  it('walking and sharing are marked by the editor', () => {
    const { result } = renderHook(() => useFirstStepsDone());
    act(() => markFirstStep('share'));
    expect([...result.current]).toEqual(['share']);
  });

  it('the card is offered once and stays dismissed', () => {
    const { result } = renderHook(() => useFirstStepsOffered());
    expect(result.current).toBe(false);
    act(() => offerFirstSteps());
    expect(result.current).toBe(true);
    act(() => dismissFirstSteps());
    expect(result.current).toBe(false);
    act(() => offerFirstSteps());
    expect(result.current).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(FIRST_STEPS_STORAGE_KEY)!).card).toBe('dismissed');
  });

  it('the ticks survive a reload', () => {
    act(() => offerFirstSteps());
    act(() => markFirstStep('share'));
    resetFirstStepsForTests();
    const { result } = renderHook(() => ({ done: useFirstStepsDone(), offered: useFirstStepsOffered() }));
    expect([...result.current.done]).toEqual(['share']);
    expect(result.current.offered).toBe(true);
  });

  it('all five done: the card shows "All done" this once, then is retired', () => {
    act(() => offerFirstSteps());
    const { result } = renderHook(() => useFirstStepsOffered());
    act(() => {
      for (const id of ['room', 'door', 'furnish', 'walk', 'share'] as const) markFirstStep(id);
    });
    expect(result.current).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(FIRST_STEPS_STORAGE_KEY)!).card).toBe('dismissed');
    resetFirstStepsForTests();
    const { result: later } = renderHook(() => useFirstStepsOffered());
    expect(later.current).toBe(false);
  });

  it('a player from before the chooser is never offered the card', () => {
    window.localStorage.setItem('standalone-room-organizer-welcome-dismissed', '1');
    const { result } = renderHook(() => useFirstStepsOffered());
    expect(result.current).toBe(false);
  });
});
