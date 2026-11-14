// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { WalkHud, type WalkHudProps } from './walk-hud';

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query === '(pointer: coarse)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function setup(extra: Partial<WalkHudProps> = {}) {
  const props: WalkHudProps = {
    locked: false,
    lockRefused: false,
    seatName: null,
    seated: false,
    floorName: 'Ground Floor',
    multiFloor: true,
    canFloorUp: true,
    canFloorDown: false,
    onStick: vi.fn(),
    onToggleSit: vi.fn(),
    onExit: vi.fn(),
    onChangeFloor: vi.fn(),
    onAdvanceTime: vi.fn(),
    ...extra,
  };
  render(
    <EditorViewProvider store={createEditorViewStore(makeViewSettings({ timeOfDay: 12 }))}>
      <WalkHud {...props} />
    </EditorViewProvider>
  );
  return props;
}

describe('the touch walk HUD extras (#688)', () => {
  it('changes floor with the buttons beside the stick, each only where there is one', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Floor up' }));
    expect(props.onChangeFloor).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: 'Floor down' })).toHaveProperty('disabled', true);
  });

  it('has no floor buttons in a one-storey house', () => {
    setup({ multiFloor: false, canFloorUp: false });
    expect(screen.queryByRole('group', { name: 'Floor' })).toBeNull();
  });

  it('moves the clock on an hour a tap', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'One hour later, now 12:00' }));
    expect(props.onAdvanceTime).toHaveBeenCalledWith(1);
  });

  it('sprints with the stick pushed to the rim, and stops only once eased back', () => {
    const props = setup();
    const stick = screen.getByRole('group', { name: /^Walk/ });
    stick.getBoundingClientRect = () => ({ left: 0, top: 0, width: 116, height: 116, right: 116, bottom: 116, x: 0, y: 0, toJSON: () => ({}) });
    // Reach is 34 px; the centre is (58, 58).
    fireEvent.pointerDown(stick, { pointerId: 1, clientX: 58, clientY: 58 - 17 });
    expect(props.onStick).toHaveBeenLastCalledWith(0, expect.closeTo(0.5 / 0.8, 5), false);
    fireEvent.pointerMove(stick, { pointerId: 1, clientX: 58, clientY: 0 });
    expect(props.onStick).toHaveBeenLastCalledWith(0, 1, true);
    expect(stick.hasAttribute('data-sprint')).toBe(true);
    // 0.91 of the throw: still sprinting, then under 0.88 it walks.
    fireEvent.pointerMove(stick, { pointerId: 1, clientX: 58, clientY: 58 - 31 });
    expect(props.onStick).toHaveBeenLastCalledWith(0, expect.closeTo(1, 9), true);
    fireEvent.pointerMove(stick, { pointerId: 1, clientX: 58, clientY: 58 - 29 });
    expect(props.onStick).toHaveBeenLastCalledWith(0, expect.closeTo(1, 9), false);
    fireEvent.pointerUp(stick, { pointerId: 1 });
    expect(props.onStick).toHaveBeenLastCalledWith(0, 0, false);
  });
});
