// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { DEFAULT_PIN_OFFSET, MAX_DIMENSIONS_PER_FLOOR } from '../lib/plan-dimensions';
import { INITIAL_LAYOUT } from './layout-reducer';
import { layoutStore } from './use-layout-store';
import { useMeasureTool, type UseMeasureToolParams } from './use-measure-tool';
import type { PinnedDimension, RoomLayout } from '../lib/types';

const pin = (id: string, z: number): PinnedDimension => ({ id, a: { x: 0, z }, b: { x: 1, z } });

function setup(layout: RoomLayout, planShown = true) {
  layoutStore.setState({ layout, activeFloorIndex: 0 });
  const playCue = vi.fn();
  const notices: Notice[] = [];
  const stop = subscribeNotices((notice) => notices.push(notice));
  const initial: UseMeasureToolParams = {
    layout,
    activeFloor: layout.floors[0]!,
    activeFloorIndex: 0,
    measurementMode: true,
    actions: layoutStore.getState().actions,
    undo: vi.fn(),
    planShown,
    playCue,
  };
  const hook = renderHook((props: UseMeasureToolParams) => useMeasureTool(props), { initialProps: initial });
  const measure = () => {
    act(() => hook.result.current.placePoint({ point: { x: -2, z: 1 }, kind: 'corner' }));
    act(() => hook.result.current.placePoint({ point: { x: 1, z: 1 }, kind: 'none' }));
  };
  return { hook, initial, playCue, notices, stop, measure };
}

const storedPins = () => layoutStore.getState().layout.floors[0]!.dimensions ?? [];

describe('useMeasureTool (#921)', () => {
  afterEach(() => {
    cleanup();
    layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  });

  it('pins the measurement with its line stood off the points, and lets the points go', () => {
    const { hook, measure, stop } = setup(makeLayout());
    measure();
    act(() => hook.result.current.pin());
    expect(storedPins()).toEqual([expect.objectContaining({ a: { x: -2, z: 1 }, b: { x: 1, z: 1 }, offset: -DEFAULT_PIN_OFFSET })]);
    expect(hook.result.current.points).toEqual([]);
    stop();
  });

  it('takes back the point the first tap of a double tap placed, leaving the measurement as it was', () => {
    const { hook, measure, stop } = setup(makeLayout());
    // On a fresh tool: the stray first point goes.
    act(() => hook.result.current.placePoint({ point: { x: 3, z: 3 }, kind: 'none' }));
    act(() => hook.result.current.takeBackPoint());
    expect(hook.result.current.points).toEqual([]);
    // After a finished measurement: it comes back whole.
    measure();
    act(() => hook.result.current.placePoint({ point: { x: 3, z: 3 }, kind: 'none' }));
    act(() => hook.result.current.takeBackPoint());
    expect(hook.result.current.points).toEqual([{ x: -2, z: 1 }, { x: 1, z: 1 }]);
    // Only once.
    act(() => hook.result.current.takeBackPoint());
    expect(hook.result.current.points).toEqual([{ x: -2, z: 1 }, { x: 1, z: 1 }]);
    stop();
  });

  it('a refused pin says why, plays the refusal and keeps the points', () => {
    const full = Array.from({ length: MAX_DIMENSIONS_PER_FLOOR }, (_, index) => pin(`p${index}`, index / 100));
    const { hook, measure, playCue, notices, stop } = setup(makeLayout({ floors: [makeFloor({ dimensions: full })] }));
    measure();
    act(() => hook.result.current.pin());
    expect(storedPins()).toHaveLength(MAX_DIMENSIONS_PER_FLOOR);
    expect(playCue).toHaveBeenCalledWith('refused');
    expect(notices.at(-1)).toMatchObject({ tone: 'error' });
    expect(hook.result.current.points).toHaveLength(2);
    stop();
  });

  it('pins nothing while the plan is hidden, and leaving the plan lets go of a picked pin', () => {
    const layout = makeLayout({ floors: [makeFloor({ dimensions: [pin('p', 0)] })] });
    const { hook, initial, measure, stop } = setup(layout, false);
    measure();
    act(() => hook.result.current.pin());
    expect(storedPins()).toHaveLength(1);
    hook.rerender({ ...initial, planShown: true });
    act(() => hook.result.current.selectPin('p'));
    expect(hook.result.current.selectedPinId).toBe('p');
    hook.rerender({ ...initial, planShown: false });
    expect(hook.result.current.selectedPinId).toBeNull();
    stop();
  });

  it('a tip that lands on the same snapped point keeps its identity', () => {
    const { hook, stop } = setup(makeLayout());
    act(() => hook.result.current.setTip({ point: { x: 1, z: 1 }, kind: 'corner' }));
    const first = hook.result.current.tip;
    act(() => hook.result.current.setTip({ point: { x: 1, z: 1 }, kind: 'corner' }));
    expect(hook.result.current.tip).toBe(first);
    act(() => hook.result.current.setTip({ point: { x: 1, z: 1.1 }, kind: 'none' }));
    expect(hook.result.current.tip).not.toBe(first);
    stop();
  });
});
