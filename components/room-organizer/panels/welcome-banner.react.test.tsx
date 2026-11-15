// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFirstStepsForTests } from '../hooks/use-first-steps';
import { ROOM_TEMPLATES } from '../lib/constants';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { snapshotBeforeReplace } from '../lib/restore-point';
import { opensOnStartChooser, WelcomeBanner } from './welcome-banner';

const loadTemplate = vi.fn((_template: unknown) => Promise.resolve(true));
vi.mock('../hooks/use-load-template', () => ({ useLoadTemplate: () => loadTemplate }));
vi.mock('./plan-thumb', () => ({ PlanThumb: () => null }));

const DISMISSED = 'standalone-room-organizer-welcome-dismissed';

describe('WelcomeBanner start chooser (#721)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    loadTemplate.mockClear();
    resetFirstStepsForTests();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers an empty start, a surprise and every template on first run', () => {
    render(<WelcomeBanner />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/Start empty/i);
    expect(dialog.textContent).toMatch(/Surprise me/i);
    for (const template of Object.values(ROOM_TEMPLATES)) {
      expect(screen.getByRole('button', { name: template.name })).toBeTruthy();
    }
  });

  // #934: a house file dropped on the chooser answers it.
  it('takes a dropped file and closes once a house is loaded some other way', () => {
    render(<WelcomeBanner />);
    expect(screen.getByRole('dialog').getAttribute('data-file-drop')).toBe('open');
    act(() => snapshotBeforeReplace(INITIAL_LAYOUT));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(DISMISSED)).toBe('1');
  });

  it('starts empty without loading anything, and stays closed', () => {
    render(<WelcomeBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Start empty/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(loadTemplate).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DISMISSED)).toBe('1');
    // The First steps card follows any start.
    expect(JSON.parse(window.localStorage.getItem('standalone-room-organizer-first-steps')!).card).toBe('offered');
  });

  it('loads the picked template through the load path and closes', () => {
    render(<WelcomeBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    expect(loadTemplate).toHaveBeenCalledWith(ROOM_TEMPLATES.kitchen);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('surprises with one of the templates', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    render(<WelcomeBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Surprise me with a template/i }));
    expect(loadTemplate).toHaveBeenCalledTimes(1);
    expect(Object.values(ROOM_TEMPLATES)).toContain(loadTemplate.mock.calls[0]![0]);
  });

  it('does not open on a share link, or over a house the player built', () => {
    expect(opensOnStartChooser(null, '#layout=2.abc', null)).toBe(false);
    const built = { ...ROOM_TEMPLATES.kitchen, id: 'house-built' };
    expect(opensOnStartChooser(null, '', JSON.stringify(built))).toBe(false);
    expect(opensOnStartChooser(null, '', '{not json')).toBe(false);
    expect(opensOnStartChooser(null, '', null)).toBe(true);
    expect(opensOnStartChooser('1', '', null)).toBe(false);
  });

  it('opens over the untouched starting house', () => {
    window.localStorage.setItem('standalone-room-organizer-layout', JSON.stringify({ ...INITIAL_LAYOUT, id: 'house-fresh' }));
    render(<WelcomeBanner />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('stays closed over a saved house with the flag cleared', () => {
    window.localStorage.setItem('standalone-room-organizer-layout', JSON.stringify(ROOM_TEMPLATES.studio));
    render(<WelcomeBanner />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not show once dismissed', () => {
    window.localStorage.setItem(DISMISSED, '1');
    render(<WelcomeBanner />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
