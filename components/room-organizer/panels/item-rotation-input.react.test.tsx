// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { ItemResizePanel } from './item-resize-panel';
import type { FurnitureItem } from '../lib/types';

afterEach(cleanup);

let setFromOutside: (rotation: number) => void = () => {};
const written: number[] = [];

/** The panel over a real, changing item, as the store gives it one. */
function Harness({ start }: { start: FurnitureItem }): JSX.Element {
  const [item, setItem] = useState(start);
  setFromOutside = (rotation) => setItem((current) => ({ ...current, rotation }));
  const editor = useMemo(
    () =>
      ({
        actions: {
          setRotation: (_id: string, rotation: number) => {
            written.push(Math.round((rotation * 180) / Math.PI));
            setItem((current) => ({ ...current, rotation }));
          },
        },
        recentColors: [],
        pushColor: vi.fn(),
      }) as unknown as RoomEditorContextValue,
    []
  );
  const selection = { selectedItem: item, allSelectedIds: new Set([item.id]) } as unknown as SelectionContextValue;
  return (
    <RoomEditorProvider value={editor}>
      <SelectionProvider value={selection}>
        <ItemResizePanel collision={null} onDuplicate={vi.fn()} />
      </SelectionProvider>
    </RoomEditorProvider>
  );
}

function field(): HTMLInputElement {
  return screen.getByLabelText('Rotation (°)') as HTMLInputElement;
}

function type(text: string): void {
  fireEvent.change(field(), { target: { value: text } });
}

function setup(degrees: number): void {
  written.length = 0;
  render(<Harness start={makeItem({ id: 'a', rotation: (degrees * Math.PI) / 180 })} />);
}

describe('the rotation field keeps what is typed (#548)', () => {
  it('lets -90 be typed, then shows 270 on blur', () => {
    setup(90);
    fireEvent.focus(field());
    type('-9');
    expect(field().value).toBe('-9');
    type('-90');
    expect(field().value).toBe('-90');
    expect(written.at(-1)).toBe(270);
    fireEvent.blur(field());
    expect(field().value).toBe('270');
  });

  it('shows the normalised value on Enter, as well', () => {
    setup(0);
    fireEvent.focus(field());
    type('400');
    expect(field().value).toBe('400');
    expect(written.at(-1)).toBe(40);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(field().value).toBe('40');
  });

  it('keeps a half-typed entry that writes nothing', () => {
    setup(90);
    fireEvent.focus(field());
    type('');
    expect(field().value).toBe('');
    expect(written).toEqual([]);
    fireEvent.blur(field());
    expect(field().value).toBe('90');
  });

  it('keeps a decimal while it rounds in the store', () => {
    setup(0);
    fireEvent.focus(field());
    type('45.5');
    expect(field().value).toBe('45.5');
  });

  it('keeps every half degree, whichever way it rounds in the store', () => {
    setup(0);
    fireEvent.focus(field());
    for (let degrees = 0.5; degrees < 360; degrees += 1) {
      type(String(degrees));
      expect(field().value).toBe(String(degrees));
    }
  });

  it('gives way to a rotation that came from elsewhere', () => {
    setup(0);
    fireEvent.focus(field());
    type('30');
    act(() => setFromOutside(Math.PI));
    expect(field().value).toBe('180');
  });
});
