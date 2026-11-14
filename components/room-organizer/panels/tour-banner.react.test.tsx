// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderStats } from './header-stats';
import { TourBanner, type TourBannerProps } from './tour-banner';

function setup(overrides: Partial<TourBannerProps> = {}) {
  const props: TourBannerProps = {
    name: 'Lakeside Cottage',
    walking: false,
    plan: false,
    onTogglePlan: vi.fn(),
    onWalk: vi.fn(),
    onKeepCopy: vi.fn(),
    onBuildOwn: vi.fn(),
    ...overrides,
  };
  render(<TourBanner {...props} />);
  return props;
}

describe('TourBanner (#722)', () => {
  afterEach(cleanup);

  it('names the house and offers the three ways on', () => {
    const props = setup();
    expect(screen.getAllByText('Lakeside Cottage').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Walk through' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep a copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build your own' }));
    expect(props.onWalk).toHaveBeenCalledTimes(1);
    expect(props.onKeepCopy).toHaveBeenCalledTimes(1);
    expect(props.onBuildOwn).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing while the link is still opening, but lets the visitor leave', () => {
    setup({ name: null });
    expect(screen.getAllByText('Opening…').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Keep a copy' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Walk through' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Build your own' }).hasAttribute('disabled')).toBe(false);
  });

  it('carries the 2D switch, pressed while the plan shows', () => {
    const props = setup({ plan: true });
    const toggle = screen.getByRole('button', { name: '2D plan' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(props.onTogglePlan).toHaveBeenCalledTimes(1);
  });

  it('leaves the screen to the walk while walking', () => {
    setup({ walking: true });
    expect(screen.queryByRole('group', { name: 'Shared house' })).toBeNull();
  });
});

describe('the header Share button (#722)', () => {
  afterEach(cleanup);

  it('shares the house', () => {
    const onShare = vi.fn();
    render(<HeaderStats onShare={onShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share a link to this house' }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('is absent without a share action', () => {
    render(<HeaderStats />);
    expect(screen.queryByRole('button', { name: 'Share a link to this house' })).toBeNull();
  });
});
