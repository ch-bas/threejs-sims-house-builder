// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { setDisplayUnit } from '../lib/format';
import { RoomDimensionInput } from './room-settings-panel';

function Harness({ initial, onCommit }: { initial: number; onCommit: (value: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="w">Width</label>
      <RoomDimensionInput
        id="w"
        value={value}
        onCommit={(next) => {
          onCommit(next);
          setValue(next);
        }}
      />
    </>
  );
}

const setup = (initial = 8) => {
  const onCommit = vi.fn<(value: number) => void>();
  render(<Harness initial={initial} onCommit={onCommit} />);
  const input = screen.getByLabelText('Width') as HTMLInputElement;
  const type = (text: string) => fireEvent.change(input, { target: { value: text } });
  return { input, onCommit, type };
};

describe('RoomDimensionInput (#217)', () => {
  afterEach(cleanup);

  it('clearing the field does not resize the room, and blur restores the value', () => {
    const { input, onCommit, type } = setup(8);
    type('');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('8');
  });

  it('skips below-minimum intermediates while typing "12"', () => {
    const { onCommit, type } = setup(8);
    type('');
    type('1');
    expect(onCommit).not.toHaveBeenCalled();
    type('12');
    expect(onCommit.mock.calls).toEqual([[12]]);
  });

  it('applies an in-range value live', () => {
    const { input, onCommit, type } = setup(8);
    type('9.5');
    expect(onCommit).toHaveBeenLastCalledWith(9.5);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('9.5');
  });

  it.each([
    ['1', 2],
    ['0', 2],
    ['-3', 2],
    ['35', 20],
  ])('clamps "%s" to %s on blur', (text, expected) => {
    const { input, onCommit, type } = setup(8);
    type(text);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit.mock.calls).toEqual([[expected]]);
    expect(input.value).toBe(String(expected));
  });

  it('Enter commits the clamped draft', () => {
    const { input, onCommit, type } = setup(8);
    input.focus();
    type('50');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit.mock.calls).toEqual([[20]]);
    expect(input.value).toBe('20');
  });

  it('re-typing the current value is not an edit, on change or on blur (#279)', () => {
    const { input, onCommit, type } = setup(8);
    type('');
    type('8');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('8');
  });

  it('leaves an out-of-range stored value alone until the user edits it', () => {
    const { input, onCommit } = setup(30);
    expect(input.value).toBe('30');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('honours a custom range and step, e.g. storey height (#202)', () => {
    const onCommit = vi.fn<(value: number) => void>();
    render(
      <>
        <label htmlFor="s">Storey</label>
        <RoomDimensionInput id="s" value={3} onCommit={onCommit} min={1} max={6} step={0.1} />
      </>
    );
    const input = screen.getByLabelText('Storey') as HTMLInputElement;
    expect(input.step).toBe('0.1');
    fireEvent.change(input, { target: { value: '1.1' } });
    expect(onCommit).toHaveBeenLastCalledWith(1.1);
    fireEvent.change(input, { target: { value: '0.4' } });
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(1);
  });
});

describe('RoomDimensionInput in feet and inches (#725)', () => {
  afterEach(() => {
    cleanup();
    setDisplayUnit('metric');
  });

  const setupImperial = (initial = 8, props: { min?: number; max?: number; step?: number } = {}) => {
    const onCommit = vi.fn<(value: number) => void>();
    function Imperial() {
      const [value, setValue] = useState(initial);
      return (
        <>
          <label htmlFor="w">Width</label>
          <RoomDimensionInput
            id="w"
            value={value}
            {...props}
            onCommit={(next) => {
              onCommit(next);
              setValue(next);
            }}
          />
        </>
      );
    }
    render(
      <EditorViewProvider store={createEditorViewStore(makeViewSettings(), { lengthUnit: 'imperial' })}>
        <Imperial />
      </EditorViewProvider>
    );
    const input = screen.getByLabelText('Width') as HTMLInputElement;
    const type = (text: string) => fireEvent.change(input, { target: { value: text } });
    return { input, onCommit, type };
  };

  it('shows feet and inches, and reads them back on blur', () => {
    const { input, onCommit, type } = setupImperial(8);
    expect(input.type).toBe('text');
    expect(input.value).toBe(`26' 3"`);
    type(`30'6"`);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(30 * 0.3048 + 6 * 0.0254, 9);
    expect(input.value).toBe(`30' 6"`);
  });

  it('takes metres and decimal feet too, clamped to the range', () => {
    const { input, onCommit, type } = setupImperial(8);
    input.focus();
    type('12.5 ft');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(3.81, 9);
    type('50 m');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(20);
  });

  it('leaves the value alone when the shown text is untouched, and says so when it is unreadable', () => {
    const notices: Notice[] = [];
    const stop = subscribeNotices((notice) => notices.push(notice));
    try {
      const { input, onCommit, type } = setupImperial(8);
      type(`26' 3"`);
      fireEvent.blur(input);
      expect(notices).toHaveLength(0);
      type(`12'13"`);
      fireEvent.blur(input);
      expect(onCommit).not.toHaveBeenCalled();
      expect(input.value).toBe(`26' 3"`);
      expect(notices.map((notice) => notice.message)).toEqual([`"12'13"" isn't a length this field can read: try 12' 6", 12.5 ft or 3.8 m.`]);
    } finally {
      stop();
    }
  });

  it('takes one step per arrow press, not one per key repeat', () => {
    const { input, onCommit } = setupImperial(8);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp', repeat: true });
    fireEvent.keyDown(input, { key: 'ArrowUp', repeat: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('steps six inches with the arrows, or one inch for a fine step', () => {
    const { input, onCommit } = setupImperial(8);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(8 + 6 * 0.0254, 9);
    cleanup();
    const fine = setupImperial(3, { min: 1, max: 6, step: 0.1 });
    fireEvent.keyDown(fine.input, { key: 'ArrowDown' });
    expect(fine.onCommit.mock.calls[0]?.[0]).toBeCloseTo(3 - 0.0254, 9);
  });
});
