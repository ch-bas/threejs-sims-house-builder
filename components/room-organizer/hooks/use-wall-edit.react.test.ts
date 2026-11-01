// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { useWallEdit, type UseWallEditParams } from './use-wall-edit';
import type { InteriorWall } from '../lib/types';

const wall: InteriorWall = { id: 'w', x1: -2, z1: 0, x2: 2, z2: 0 };

function setup(overrides: Partial<UseWallEditParams> = {}) {
  const activeFloor = makeFloor({ interiorWalls: [wall] });
  const params: UseWallEditParams = {
    enabled: true,
    pressDrags: true,
    layout: makeLayout({ width: 10, height: 8, floors: [activeFloor] }),
    activeFloor,
    activeFloorIndex: 0,
    selectedWallId: 'w',
    ghostsRef: { current: vi.fn() },
    onMove: vi.fn(),
    onRefused: vi.fn(),
    ...overrides,
  };
  const hook = renderHook((props: UseWallEditParams) => useWallEdit(props), { initialProps: params });
  return { ...hook, params };
}

const grab = { wallId: 'w', grip: 'body', x: 0, z: 0 } as const;

describe('useWallEdit (#718)', () => {
  it('commits once on release', () => {
    const { result, params } = setup();
    const gesture = result.current.grabWall(grab)!;
    gesture.move(0, 1, false);
    gesture.move(0, 1.5, false);
    expect(params.onMove).not.toHaveBeenCalled();
    gesture.end(true);
    expect(params.onMove).toHaveBeenCalledTimes(1);
  });

  it('Esc drops the hold: the preview goes and the release commits nothing (M1)', () => {
    const { result, params } = setup();
    const gesture = result.current.grabWall(grab)!;
    gesture.move(0, 1, false);
    expect(result.current.isHoldingWall()).toBe(true);
    expect(result.current.cancelWallHold()).toBe(true);
    expect(result.current.wallMovePreview()).toBeNull();
    gesture.move(0, 2, false);
    expect(result.current.wallMovePreview()).toBeNull();
    gesture.end(true);
    expect(params.onMove).not.toHaveBeenCalled();
    expect(result.current.cancelWallHold()).toBe(false);
  });

  it.each([
    ['the wall stopped being selected', { selectedWallId: null }],
    ['the gesture was disabled', { enabled: false }],
  ])('commits nothing when %s (M1)', (_name, change) => {
    const { result, params, rerender } = setup();
    const gesture = result.current.grabWall(grab)!;
    gesture.move(0, 1, false);
    rerender({ ...params, ...change });
    gesture.end(true);
    expect(params.onMove).not.toHaveBeenCalled();
  });

  it('a wall not yet selected comes along only where a press may drag it', () => {
    const fresh = { ...grab, fresh: true };
    expect(setup({ selectedWallId: null }).result.current.grabWall(fresh)).not.toBeNull();
    expect(setup({ selectedWallId: null, pressDrags: false }).result.current.grabWall(fresh)).toBeNull();
    expect(setup({ selectedWallId: null }).result.current.grabWall(grab)).toBeNull();
  });

  it('refuses at the release, with the reason in the preview till then', () => {
    const twin: InteriorWall = { id: 't', x1: -2, z1: 1, x2: 2, z2: 1 };
    const { result, params } = setup({ activeFloor: makeFloor({ interiorWalls: [wall, twin] }) });
    const gesture = result.current.grabWall(grab)!;
    gesture.move(0, 1, true);
    expect(result.current.wallMovePreview()?.refusal).toContain('top');
    gesture.end(true);
    expect(params.onRefused).toHaveBeenCalledTimes(1);
    expect(params.onMove).not.toHaveBeenCalled();
  });
});
