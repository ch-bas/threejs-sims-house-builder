// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { layoutStore } from '../hooks/use-layout-store';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { playSound } from '../lib/sounds';
import { CatalogStrip } from './catalog-strip';
import { FloorSwitcher } from './floor-switcher';
import type { ReactNode } from 'react';

vi.mock('../lib/sounds', () => ({ playSound: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let notices: Notice[] = [];
let stopNotices: () => void = () => undefined;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  notices = [];
  stopNotices = subscribeNotices((notice) => notices.push(notice));
  vi.mocked(playSound).mockClear();
});

afterEach(() => {
  cleanup();
  stopNotices();
});

/** A hard-budget house whose one floor holds `spent` worth of beds. */
function seed(spent: number, beds = 18): void {
  const each = spent / beds;
  const items = Array.from({ length: beds }, (_, i) =>
    makeItem({ id: `bed-${i}`, type: 'bed', name: 'Bed', category: 'beds', price: each, position: { x: 0, z: 0 } })
  );
  layoutStore.setState({
    layout: makeLayout({ id: 'house-test', floors: [makeFloor({ items })], budget: { writeOff: 0 } }),
    activeFloorIndex: 0,
  });
}

function withView(children: ReactNode, sounds = true) {
  const store = createEditorViewStore(makeViewSettings({ soundsEnabled: sounds }));
  return <EditorViewProvider store={store}>{children}</EditorViewProvider>;
}

describe('Duplicate floor under the hard budget (#588)', () => {
  it('says why and plays the refused cue instead of doing nothing', () => {
    seed(14_400);
    render(withView(<FloorSwitcher />));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Clone/ }));
    });
    expect(layoutStore.getState().layout.floors).toHaveLength(1);
    expect(vi.mocked(playSound).mock.calls).toEqual([['refused']]);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.tone).toBe('error');
    expect(notices[0]!.message).toContain('Over budget');
    expect(notices[0]!.message).toContain('$14,400');
  });

  it('still clones a floor the budget covers, silently', () => {
    seed(10_000);
    render(withView(<FloorSwitcher />));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Clone/ }));
    });
    expect(layoutStore.getState().layout.floors).toHaveLength(2);
    expect(playSound).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
  });

  it('honours the mute switch', () => {
    seed(14_400);
    render(withView(<FloorSwitcher />, false));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Clone/ }));
    });
    expect(playSound).not.toHaveBeenCalled();
    expect(notices).toHaveLength(1);
  });
});

describe('An over-budget catalogue tile (#642)', () => {
  it('says why on click and on Enter, with the refused cue, and adds nothing', () => {
    seed(24_800);
    const onAdd = vi.fn();
    render(withView(<CatalogStrip category="seating" onAdd={onAdd} />));
    const sofa = screen.getByTitle(/^Sofa — Over budget/);
    act(() => {
      fireEvent.click(sofa);
    });
    act(() => {
      fireEvent.keyDown(sofa, { key: 'Enter' });
    });
    expect(onAdd).not.toHaveBeenCalled();
    expect(vi.mocked(playSound).mock.calls).toEqual([['refused'], ['refused']]);
    expect(notices.map((notice) => [notice.message, notice.tone])).toEqual([
      ['Over budget: $200 left', 'error'],
      ['Over budget: $200 left', 'error'],
    ]);
  });

  it('an affordable tile adds as before', () => {
    seed(24_800);
    const onAdd = vi.fn();
    render(withView(<CatalogStrip category="seating" onAdd={onAdd} />));
    act(() => {
      fireEvent.click(screen.getByTitle(/^Bench — \$150/));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(notices).toHaveLength(0);
  });
});
