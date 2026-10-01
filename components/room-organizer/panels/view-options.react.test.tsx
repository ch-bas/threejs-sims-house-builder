// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { VIEW_OPTION_KEYS } from '../lib/view-options';
import { ViewOptionsMenu } from './view-options';
import type { ViewSettings } from '../lib/types';

function setup(onClose = vi.fn()) {
  const views: ViewSettings[] = [];
  function Harness(): JSX.Element {
    const [view, setView] = useState(makeViewSettings());
    views.push(view);
    const value = { view, setView } as unknown as RoomEditorContextValue;
    return (
      <RoomEditorProvider value={value}>
        <ViewOptionsMenu id="menu" anchorRef={createRef<HTMLElement>()} onClose={onClose} />
      </RoomEditorProvider>
    );
  }
  render(<Harness />);
  return { latest: () => views[views.length - 1]!, onClose };
}

describe('ViewOptionsMenu (#341)', () => {
  afterEach(cleanup);

  it('has a switch for every View-menu key, each of which flips its setting', () => {
    const { latest } = setup();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(VIEW_OPTION_KEYS.length);
    for (const [index, key] of VIEW_OPTION_KEYS.entries()) {
      const before = latest()[key];
      fireEvent.click(switches[index]!);
      expect(latest()[key]).toBe(!before);
      expect(screen.getAllByRole('switch')[index]!.getAttribute('aria-checked')).toBe(String(!before));
    }
  });

  it('closes on Escape and on a press outside, not on a press inside', () => {
    const { onClose } = setup();
    fireEvent.pointerDown(screen.getByRole('switch', { name: /Snap to walls/ }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
