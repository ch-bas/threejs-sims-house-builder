// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { useWallDraft, type UseWallDraftOptions } from './use-wall-draft';

function setup(overrides: Partial<UseWallDraftOptions> = {}) {
  const floor = makeFloor();
  const options: UseWallDraftOptions = {
    layout: makeLayout({ width: 10, height: 10, floors: [floor] }),
    activeFloor: floor,
    activeFloorIndex: 0,
    drawWallMode: true,
    drawZoneMode: false,
    measurementMode: false,
    actions: { addInteriorWall: vi.fn(), addInteriorWalls: vi.fn() },
    playCue: vi.fn(),
    setSelectedWall: vi.fn(),
    commitStepRef: { current: vi.fn() },
    ...overrides,
  };
  const hook = renderHook((p: UseWallDraftOptions) => useWallDraft(p), { initialProps: options });
  return { ...hook, options };
}

describe('useWallDraft', () => {
  it('two clicks place one wall as its own undo step and chain the draft', () => {
    const { result, options } = setup();
    act(() => {
      result.current.handleWallClick(-2, 0);
    });
    expect(result.current.wallDraft).not.toBeNull();
    act(() => {
      result.current.handleWallClick(2, 0);
    });
    expect(options.commitStepRef.current).toHaveBeenCalledTimes(1);
    expect(options.actions.addInteriorWall).toHaveBeenCalledTimes(1);
    expect(result.current.wallDraft).toEqual(expect.objectContaining({ z: 0 }));
    expect(result.current.wallDrawStatus?.hasAnchor).toBe(true);
  });

  it('leaves clicks alone while the tool is off', () => {
    const { result } = setup({ drawWallMode: false });
    let taken = true;
    act(() => {
      taken = result.current.handleWallClick(1, 1);
    });
    expect(taken).toBe(false);
    expect(result.current.wallDrawStatus).toBeNull();
  });

  it('a floor switch drops the draft, Escape drops it too', () => {
    const { result, rerender, options } = setup();
    act(() => {
      result.current.handleWallClick(-2, 0);
    });
    rerender({ ...options, activeFloor: { ...options.activeFloor, id: 'upper' } });
    expect(result.current.wallDraft).toBeNull();
    act(() => {
      result.current.handleWallClick(-2, 0);
    });
    let escaped = false;
    act(() => {
      escaped = result.current.escapeDraft();
    });
    expect(escaped).toBe(true);
    expect(result.current.wallDraft).toBeNull();
    expect(result.current.escapeDraft()).toBe(false);
  });

  it('the tools that take every press, and the wall tool going off, let the selected wall go', () => {
    const { rerender, options } = setup({ drawWallMode: false });
    const setSelectedWall = vi.mocked(options.setSelectedWall);
    setSelectedWall.mockClear();
    rerender({ ...options, measurementMode: true });
    expect(setSelectedWall).toHaveBeenCalledWith(null);
  });
});
