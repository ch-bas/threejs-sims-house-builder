// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { PlacedItemsPanel } from './placed-items-panel';
import type { FurnitureItem } from '../lib/types';

const editor = vi.hoisted(() => ({ items: [] as FurnitureItem[] }));

vi.mock('../contexts', () => ({
  useRoomEditor: () => ({ activeFloor: { id: 'f1', items: editor.items }, collidingIds: new Set<string>() }),
  useSelection: () => ({ selectedItemId: null, selectOnly: vi.fn() }),
}));

const panel = (ids: string[]) => {
  editor.items = ids.map((id) => makeItem({ id, name: id }));
  return <PlacedItemsPanel onRotate={vi.fn()} onRemove={vi.fn()} />;
};
const row = (name: string) => screen.getByRole('button', { name });

describe('PlacedItemsPanel focus after a removal (#634, #638)', () => {
  beforeEach(() => {
    editor.items = [];
  });
  afterEach(cleanup);

  it('moves to the row that took the removed one\'s place', () => {
    const { rerender } = render(panel(['a', 'b', 'c']));
    row('Remove b').focus();
    // Unmounting the focused row drops focus to <body>.
    rerender(panel(['a', 'c']));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^c$/ }));
  });

  it('moves to the new last row when the last one goes', () => {
    const { rerender } = render(panel(['a', 'b']));
    row('Remove b').focus();
    rerender(panel(['a']));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^a$/ }));
  });

  it('falls back to the heading when the list empties', () => {
    const { rerender } = render(panel(['a']));
    row('Remove a').focus();
    rerender(panel([]));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Placed Items/ }));
  });

  it('skips the filter field when a filtered list empties: no phone keyboard pops up', () => {
    const { rerender } = render(panel(['a', 'b', 'c', 'd', 'zed']));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter placed items' }), { target: { value: 'zed' } });
    row('Remove zed').focus();
    rerender(panel(['a', 'b', 'c', 'd']));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Placed Items/ }));
  });

  it('leaves focus alone when it was never in the list, or has moved on', () => {
    const { rerender } = render(
      <>
        <button type="button">elsewhere</button>
        {panel(['a', 'b'])}
      </>
    );
    rerender(
      <>
        <button type="button">elsewhere</button>
        {panel(['b'])}
      </>
    );
    expect(document.activeElement).toBe(document.body);

    row('Remove b').focus();
    act(() => row('elsewhere').focus());
    rerender(
      <>
        <button type="button">elsewhere</button>
        {panel([])}
      </>
    );
    expect(document.activeElement).toBe(row('elsewhere'));
  });
});
