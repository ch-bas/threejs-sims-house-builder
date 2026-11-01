// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WallDrawChip, lengthKey } from './wall-draw-chip';

afterEach(cleanup);

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

const field = () => screen.getByLabelText<HTMLInputElement>('Wall length in metres');

describe('WallDrawChip typed length (#723)', () => {
  it('opens on a digit in the view, ahead of the view key', () => {
    render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    const event = press('2');
    window.removeEventListener('keydown', shortcut);
    expect(field().value).toBe('2');
    expect(event.defaultPrevented).toBe(true);
    expect(shortcut).not.toHaveBeenCalled();
  });

  it('leaves the keys alone with no draft, on a repeat, and on chords', () => {
    render(<WallDrawChip status={{ hasAnchor: false, aimed: false }} onLength={() => true} />);
    expect(press('2').defaultPrevented).toBe(false);
    expect(screen.queryByLabelText('Wall length in metres')).toBeNull();
    cleanup();
    render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    expect(press('2', { repeat: true }).defaultPrevented).toBe(true);
    expect(screen.queryByLabelText('Wall length in metres')).toBeNull();
    expect(lengthKey({ key: '2', ctrlKey: true, metaKey: false, altKey: false })).toBeNull();
    expect(lengthKey({ key: 'a', ctrlKey: false, metaKey: false, altKey: false })).toBeNull();
  });

  it('places on Enter and closes; a refusal keeps the field', () => {
    const onLength = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={onLength} />);
    press('3');
    fireEvent.change(field(), { target: { value: '3,2' } });
    fireEvent.submit(field());
    expect(onLength).toHaveBeenCalledWith(3.2, null);
    expect(field().value).toBe('3,2');
    fireEvent.submit(field());
    expect(screen.queryByLabelText('Wall length in metres')).toBeNull();
  });

  it('does not place a length that is not one', () => {
    const onLength = vi.fn(() => true);
    render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={onLength} />);
    press('.');
    fireEvent.submit(field());
    expect(onLength).not.toHaveBeenCalled();
  });

  it('Escape closes the field and keeps the draft', () => {
    const outer = vi.fn();
    render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    press('1');
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(field(), { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(screen.queryByLabelText('Wall length in metres')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it('asks a finger with no direction which way to go', () => {
    const onLength = vi.fn(() => true);
    render(<WallDrawChip status={{ hasAnchor: true, aimed: false }} onLength={onLength} />);
    fireEvent.click(screen.getByText(/^Type length/));
    fireEvent.change(field(), { target: { value: '2.5' } });
    fireEvent.click(screen.getByTitle('Place the wall going down'));
    expect(onLength).toHaveBeenCalledWith(2.5, { x: 0, z: 1 });
  });

  it('keeps Place and the arrows once open, whatever the pointer does (#723)', () => {
    const { rerender } = render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    press('1');
    rerender(<WallDrawChip status={{ hasAnchor: true, aimed: false }} onLength={() => true} />);
    expect(screen.getByText('Place')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Place the wall going left' })).toBeTruthy();
    cleanup();
    const again = render(<WallDrawChip status={{ hasAnchor: true, aimed: false }} onLength={() => true} />);
    press('1');
    again.rerender(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    expect(screen.queryByText('Place')).toBeNull();
    expect(screen.getByRole('button', { name: 'Place the wall going up' })).toBeTruthy();
  });

  it('takes pointer events only while open, and says when it opens', () => {
    const onFieldOpen = vi.fn();
    const { container } = render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} onFieldOpen={onFieldOpen} />);
    expect(container.firstElementChild?.className).not.toContain('pointer-events-auto');
    press('1');
    expect(container.firstElementChild?.className).toContain('pointer-events-auto');
    expect(onFieldOpen).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onFieldOpen).toHaveBeenLastCalledWith(false);
  });

  it('keeps the rows mounted with nothing to show, so the buttons hold still', () => {
    const { container, rerender } = render(<WallDrawChip status={{ hasAnchor: true, aimed: true, currentLength: 2, snapKind: 'angle' }} onLength={() => true} />);
    const rows = container.firstElementChild?.children.length;
    rerender(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    expect(container.firstElementChild?.children.length).toBe(rows);
  });

  it('closes on blur with text in it, so the next digit opens it again', () => {
    render(<div><button type="button">elsewhere</button><WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} /></div>);
    press('1');
    act(() => {
      field().focus();
      screen.getByText('elsewhere').focus();
    });
    expect(screen.queryByLabelText('Wall length in metres')).toBeNull();
    expect(press('2').defaultPrevented).toBe(true);
    expect(field().value).toBe('2');
  });

  it('a press on its buttons keeps the focus in the field', () => {
    render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    press('1');
    const pressed = fireEvent.mouseDown(screen.getByText('Place'));
    expect(pressed).toBe(false);
  });

  it('closes with the draft', () => {
    const { rerender } = render(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    press('1');
    rerender(<WallDrawChip status={{ hasAnchor: false, aimed: false }} onLength={() => true} />);
    rerender(<WallDrawChip status={{ hasAnchor: true, aimed: true }} onLength={() => true} />);
    expect(screen.queryByLabelText('Wall length in metres')).toBeNull();
  });

  it('shows the length and the angle', () => {
    render(<WallDrawChip status={{ hasAnchor: true, aimed: true, currentLength: 2.5, angle: 45, snapKind: 'angle' }} />);
    expect(screen.getByText('2.50 m · 45°')).toBeTruthy();
    expect(screen.getByText(/15° step/)).toBeTruthy();
  });
});
