// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from './select';

describe('Select (#415)', () => {
  afterEach(cleanup);

  it('is a native combobox named by aria-label, reporting the picked value', () => {
    const onValueChange = vi.fn<(value: string) => void>();
    render(
      <Select value="solid" onValueChange={onValueChange} aria-label="Wall pattern">
        <option value="solid">Solid</option>
        <option value="brick">Brick</option>
      </Select>
    );
    const select = screen.getByRole('combobox', { name: 'Wall pattern' }) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('solid');
    fireEvent.change(select, { target: { value: 'brick' } });
    expect(onValueChange).toHaveBeenCalledWith('brick');
  });

  it('shows an unpickable placeholder while the value matches no option', () => {
    render(
      <Select value="" onValueChange={() => undefined} placeholder="Load a template..." aria-label="Template">
        <option value="bedroom">Bedroom</option>
      </Select>
    );
    const select = screen.getByRole('combobox', { name: 'Template' }) as HTMLSelectElement;
    const shown = select.selectedOptions[0];
    expect(shown?.textContent).toBe('Load a template...');
    expect(shown?.disabled).toBe(true);
  });

  it('kept at an empty value, picking the same option twice reports both picks (#122)', () => {
    const onValueChange = vi.fn<(value: string) => void>();
    render(
      <Select value="" onValueChange={onValueChange} placeholder="Load a template..." aria-label="Template">
        <option value="bedroom">Bedroom</option>
      </Select>
    );
    const select = screen.getByRole('combobox', { name: 'Template' }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'bedroom' } });
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'bedroom' } });
    expect(onValueChange).toHaveBeenCalledTimes(2);
  });

  it('associates with a <label> through id', () => {
    render(
      <>
        <label htmlFor="fit">Fit Mode</label>
        <Select id="fit" value="cover" onValueChange={() => undefined}>
          <option value="stretch">Stretch</option>
          <option value="cover">Cover</option>
        </Select>
      </>
    );
    expect((screen.getByLabelText('Fit Mode') as HTMLSelectElement).value).toBe('cover');
  });
});
