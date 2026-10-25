// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIDE_TABPANEL_ID, SidebarTabs, sideTabId, type SidebarTab } from './sidebar-tabs';

function Harness({ onChange }: { onChange(tab: SidebarTab): void }): JSX.Element {
  const [active, setActive] = useState<SidebarTab>('build');
  return (
    <SidebarTabs
      active={active}
      onChange={(tab) => {
        setActive(tab);
        onChange(tab);
      }}
    />
  );
}

describe('SidebarTabs (#434)', () => {
  afterEach(cleanup);

  it('is a tablist whose one selected tab is the only tab stop', () => {
    render(<Harness onChange={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Build', 'Buy', 'Style', 'Manage']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    for (const tab of tabs) expect(tab.getAttribute('aria-controls')).toBe(SIDE_TABPANEL_ID);
    expect(tabs[0]!.id).toBe(sideTabId('build'));
  });

  it('moves and opens with the arrow keys, Home and End, wrapping at the ends', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const tab = (name: string) => screen.getByRole('tab', { name });
    tab('Build').focus();
    fireEvent.keyDown(tab('Build'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('buy');
    expect(document.activeElement).toBe(tab('Buy'));
    expect(tab('Buy').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Buy'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Manage'));
    fireEvent.keyDown(tab('Manage'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Build'));
    fireEvent.keyDown(tab('Build'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Manage'));
    fireEvent.keyDown(tab('Manage'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('build');
    expect(document.activeElement).toBe(tab('Build'));
  });

  it('keeps arrow keys from the editor shortcuts, and leaves other keys alone', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      render(<Harness onChange={vi.fn()} />);
      const build = screen.getByRole('tab', { name: 'Build' });
      fireEvent.keyDown(build, { key: 'ArrowRight' });
      expect(onWindowKey).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Buy' }), { key: 'z' });
      expect(onWindowKey).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});
