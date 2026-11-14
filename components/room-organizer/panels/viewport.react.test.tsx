// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { Viewport, type ViewportProps } from './viewport';
import type { WalkHudProps } from './walk-hud';

afterEach(cleanup);

function setup(overrides: Partial<ViewportProps> = {}) {
  const floor = makeFloor({
    items: [
      makeItem({ id: 'sofa', name: 'Sofa', position: { x: -2, z: -2 } }),
      makeItem({ id: 'bed', name: 'Bed', position: { x: 2, z: 2 } }),
    ],
  });
  const onKeyboardSelect = vi.fn();
  const props: ViewportProps = {
    isReady: false,
    error: null,
    view2D: false,
    layout: makeLayout({ floors: [floor] }),
    activeFloor: floor,
    selectedItem: null,
    showMeasurements: false,
    showMinimap: false,
    canvasRef: createRef<HTMLCanvasElement>(),
    canvas2DRef: createRef<HTMLCanvasElement>(),
    onKeyboardSelect,
    ...overrides,
  };
  const view = render(<Viewport {...props} />);
  const canvas = screen.getByRole('application', { name: /3D view/ });
  return { ...view, props, canvas, onKeyboardSelect };
}

describe('Viewport keyboard selection (#650)', () => {
  it('both views can take focus', () => {
    const { canvas, container } = setup();
    expect(canvas.tabIndex).toBe(0);
    expect(container.querySelector<HTMLCanvasElement>('canvas.pc-plan-canvas')!.tabIndex).toBe(0);
  });

  it('Tab on the scene selects the first item in plan order and says so', () => {
    const { canvas, onKeyboardSelect } = setup();
    const event = fireEvent.keyDown(canvas, { key: 'Tab' });
    expect(event).toBe(false);
    expect(onKeyboardSelect).toHaveBeenCalledWith('sofa');
    expect(screen.getByRole('status').textContent).toBe('Sofa selected, 1 of 2.');
  });

  it('Shift+Tab steps back from the selection', () => {
    const floor = makeFloor({ items: [makeItem({ id: 'sofa', name: 'Sofa', position: { x: -2, z: -2 } }), makeItem({ id: 'bed', name: 'Bed', position: { x: 2, z: 2 } })] });
    const { canvas, onKeyboardSelect } = setup({ activeFloor: floor, selectedItem: floor.items[1]! });
    fireEvent.keyDown(canvas, { key: 'Tab', shiftKey: true });
    expect(onKeyboardSelect).toHaveBeenCalledWith('sofa');
  });

  it('past the last item Tab leaves the scene as usual', () => {
    const floor = makeFloor({ items: [makeItem({ id: 'sofa', name: 'Sofa', position: { x: -2, z: -2 } })] });
    const { canvas, onKeyboardSelect } = setup({ activeFloor: floor, selectedItem: floor.items[0]! });
    expect(fireEvent.keyDown(canvas, { key: 'Tab' })).toBe(true);
    expect(onKeyboardSelect).not.toHaveBeenCalled();
  });

  it('a held Tab steps once', () => {
    const { canvas, onKeyboardSelect } = setup();
    expect(fireEvent.keyDown(canvas, { key: 'Tab', repeat: true })).toBe(false);
    expect(onKeyboardSelect).not.toHaveBeenCalled();
  });

  it('leaves Tab alone during the walk', () => {
    const { canvas, onKeyboardSelect } = setup({
      walkHud: { locked: true, lockRefused: false, seatName: null, seated: false, floorName: 'Ground', multiFloor: false, canFloorUp: false, canFloorDown: false, onStick: vi.fn(), onToggleSit: vi.fn(), onExit: vi.fn(), onChangeFloor: vi.fn(), onAdvanceTime: vi.fn() } as WalkHudProps,
    });
    expect(fireEvent.keyDown(canvas, { key: 'Tab' })).toBe(true);
    expect(onKeyboardSelect).not.toHaveBeenCalled();
  });

  it('Enter takes focus into the open item popover', () => {
    const floor = makeFloor({ items: [makeItem({ id: 'sofa', name: 'Sofa', position: { x: -2, z: -2 } })] });
    const { canvas } = setup({ activeFloor: floor, selectedItem: floor.items[0]! });
    const popover = document.createElement('div');
    popover.className = 'pc-item-popover';
    popover.tabIndex = -1;
    document.body.appendChild(popover);
    canvas.focus();
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(document.activeElement).toBe(popover);
    popover.remove();
  });

  it('leaves Tab and Enter to a placement in progress', () => {
    const floor = makeFloor({ items: [makeItem({ id: 'sofa', name: 'Sofa', position: { x: -2, z: -2 } })] });
    const { canvas, onKeyboardSelect } = setup({ activeFloor: floor, selectedItem: floor.items[0]!, placing: true });
    expect(fireEvent.keyDown(canvas, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: 'Enter' })).toBe(true);
    expect(onKeyboardSelect).not.toHaveBeenCalled();
  });

  it('clears the status line when the selection changes some other way', () => {
    const floor = makeFloor({ items: [makeItem({ id: 'sofa', name: 'Sofa', position: { x: -2, z: -2 } }), makeItem({ id: 'bed', name: 'Bed', position: { x: 2, z: 2 } })] });
    const { canvas, props, rerender } = setup({ activeFloor: floor });
    fireEvent.keyDown(canvas, { key: 'Tab' });
    rerender(<Viewport {...props} selectedItem={floor.items[0]!} />);
    expect(screen.getByRole('status').textContent).toBe('Sofa selected, 1 of 2.');
    rerender(<Viewport {...props} selectedItem={floor.items[1]!} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('a pointer press never leaves focus on the scene; the keyboard does', () => {
    const { canvas } = setup();
    canvas.focus();
    expect(document.activeElement).toBe(canvas);
    fireEvent.pointerDown(canvas);
    expect(document.activeElement).not.toBe(canvas);
    // The focus the press brings with it goes too.
    canvas.focus();
    expect(document.activeElement).not.toBe(canvas);
  });

  it('Tab right after a press on the scene steps from it, as if it had kept focus', () => {
    const { canvas, onKeyboardSelect } = setup();
    fireEvent.pointerDown(canvas);
    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(canvas);
    expect(onKeyboardSelect).toHaveBeenCalledWith('sofa');
  });
});
