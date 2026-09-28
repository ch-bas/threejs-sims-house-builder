// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
