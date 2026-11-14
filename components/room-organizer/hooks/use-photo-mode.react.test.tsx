// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterPhotoMode, isPhotoMode, leavePhotoMode } from '../lib/photo-mode';
import { PhotoBar } from '../panels/photo-bar';
import { usePhotoMode, type UsePhotoModeOptions } from './use-photo-mode';
import type * as ThreeNS from 'three';

afterEach(() => {
  cleanup();
  act(() => leavePhotoMode());
});

/** A renderer that records what it was asked, with a canvas that encodes a fixed blob. */
function fakeRenderer(blob: Blob | null) {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  const calls: string[] = [];
  let ratio = 1;
  canvas.toBlob = (callback: BlobCallback) => {
    calls.push(`toBlob@${ratio}`);
    setTimeout(() => callback(blob), 0);
  };
  const renderer = {
    domElement: canvas,
    capabilities: { maxTextureSize: 8192 },
    getPixelRatio: () => ratio,
    setPixelRatio: (next: number) => {
      ratio = next;
      calls.push(`ratio ${next}`);
    },
    setSize: () => calls.push('size'),
    render: () => calls.push(`render@${ratio}`),
  } as unknown as ThreeNS.WebGLRenderer;
  return { renderer, calls };
}

function Harness(props: Partial<UsePhotoModeOptions> & { renderer: ThreeNS.WebGLRenderer }) {
  const photo = usePhotoMode({
    available: true,
    houseName: 'My Home',
    rendererRef: { current: props.renderer },
    sceneRef: { current: {} as ThreeNS.Scene },
    cameraRef: { current: {} as ThreeNS.PerspectiveCamera },
    invalidate: props.invalidate ?? (() => {}),
    walking: props.walking ?? false,
    onEnter: props.onEnter ?? (() => {}),
    ...(props.available !== undefined ? { available: props.available } : {}),
  });
  return (
    <div className="pc-world">
      <span>{photo.active ? 'on' : 'off'}</span>
      {photo.active && <PhotoBar onTake={photo.take} onDone={photo.leave} />}
    </div>
  );
}

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('photo mode (#626)', () => {
  it('hides the HUD with html[data-photo] while on, and clears the selection as it starts', () => {
    const onEnter = vi.fn();
    render(<Harness renderer={fakeRenderer(null).renderer} onEnter={onEnter} />);
    expect(document.documentElement.hasAttribute('data-photo')).toBe(false);
    act(() => enterPhotoMode());
    expect(document.documentElement.hasAttribute('data-photo')).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBe(document.activeElement);
    act(() => leavePhotoMode());
    expect(document.documentElement.hasAttribute('data-photo')).toBe(false);
  });

  it('keeps the editor’s keys from acting unseen, and leaves on Escape', () => {
    render(<Harness renderer={fakeRenderer(null).renderer} />);
    act(() => enterPhotoMode());
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    press('Delete');
    expect(shortcut).not.toHaveBeenCalled();
    // The shutter's own buttons still take keys.
    press('Tab', screen.getByRole('button', { name: 'Take photo' }));
    expect(shortcut).toHaveBeenCalledTimes(1);
    press('Escape');
    window.removeEventListener('keydown', shortcut);
    expect(shortcut).toHaveBeenCalledTimes(1);
    expect(isPhotoMode()).toBe(false);
  });

  it('keeps undo, the view keys and Enter on the canvas from the editor with focus on the shutter (review)', () => {
    render(<Harness renderer={fakeRenderer(null).renderer} />);
    act(() => enterPhotoMode());
    const shutter = screen.getByRole('button', { name: 'Take photo' });
    expect(document.activeElement).toBe(shutter);
    const editor = vi.fn();
    window.addEventListener('keydown', editor);
    const undo = press('z', shutter, { ctrlKey: true });
    press('2', shutter);
    press('p', shutter);
    press('Enter', document.body);
    window.removeEventListener('keydown', editor);
    expect(editor).not.toHaveBeenCalled();
    expect(undo.defaultPrevented).toBe(true);
    expect(isPhotoMode()).toBe(true);
  });

  it('gives focus back to the control that opened it', () => {
    render(<Harness renderer={fakeRenderer(null).renderer} />);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    act(() => enterPhotoMode(opener));
    expect(document.activeElement).not.toBe(opener);
    press('Escape');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('drops the HUD’s projection shift and the snap grid while on, and puts them back', () => {
    const view = { enabled: true, fullWidth: 390, fullHeight: 844, offsetX: 0, offsetY: 132, width: 390, height: 844 };
    const camera = {
      view: { ...view } as typeof view | null,
      clearViewOffset() { if (this.view) this.view.enabled = false; },
      setViewOffset(fullWidth: number, fullHeight: number, offsetX: number, offsetY: number, width: number, height: number) {
        this.view = { enabled: true, fullWidth, fullHeight, offsetX, offsetY, width, height };
      },
    };
    const grid = { type: 'GridHelper', visible: true };
    const scene = { children: [grid] };
    function Shift() {
      usePhotoMode({
        available: true, houseName: 'x', rendererRef: { current: null },
        sceneRef: { current: scene as unknown as ThreeNS.Scene },
        cameraRef: { current: camera as unknown as ThreeNS.PerspectiveCamera },
        invalidate: () => {}, walking: false, onEnter: () => {},
      });
      return null;
    }
    render(<Shift />);
    act(() => enterPhotoMode());
    expect(camera.view?.enabled).toBe(false);
    expect(grid.visible).toBe(false);
    act(() => leavePhotoMode());
    expect(camera.view).toEqual(view);
    expect(grid.visible).toBe(true);
  });

  it('lets the walk’s keys through while walking', () => {
    render(<Harness renderer={fakeRenderer(null).renderer} walking />);
    act(() => enterPhotoMode());
    const walk = vi.fn();
    window.addEventListener('keydown', walk);
    press('w', document.body, { code: 'KeyW' });
    window.removeEventListener('keydown', walk);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it('ends when the 3D view goes away', () => {
    const { rerender } = render(<Harness renderer={fakeRenderer(null).renderer} />);
    act(() => enterPhotoMode());
    const { renderer } = fakeRenderer(null);
    rerender(<Harness renderer={renderer} available={false} />);
    expect(isPhotoMode()).toBe(false);
  });

  it('draws one frame at twice the resolution, reads it back at once, and puts the screen back', async () => {
    const { renderer, calls } = fakeRenderer(new Blob(['png'], { type: 'image/png' }));
    const invalidate = vi.fn();
    const clicked: string[] = [];
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => 'blob:photo';
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<Harness renderer={renderer} invalidate={invalidate} />);
    act(() => enterPhotoMode());
    await act(async () => {
      screen.getByRole('button', { name: 'Take photo' }).click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(calls).toEqual(['ratio 2', 'size', 'render@2', 'toBlob@2', 'ratio 1', 'size']);
    expect(invalidate).toHaveBeenCalled();
    expect(clicked).toEqual(['my-home-photo.png']);
    click.mockRestore();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });
});
