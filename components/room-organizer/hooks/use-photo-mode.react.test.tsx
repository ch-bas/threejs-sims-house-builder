// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms } from '../lib/__testfixtures__/confirm';
import { askConfirm, cancelPendingConfirms, confirmOpen } from '../lib/confirm-dialog';
import { openAlbum, resetAlbumForTests } from '../lib/photo-album';
import { enterPhotoMode, isPhotoMode, leavePhotoMode } from '../lib/photo-mode';
import { ConfirmDialogHost } from '../panels/confirm-dialog';
import { PhotoBar } from '../panels/photo-bar';
import { usePhotoMode, type ShotControls, type UsePhotoModeOptions } from './use-photo-mode';
import type { ShotConditions } from '../lib/photo-presets';
import type * as ThreeNS from 'three';

afterEach(() => {
  cleanup();
  act(() => leavePhotoMode());
  cancelPendingConfirms();
  resetAlbumForTests();
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
    houseId: 'house-1',
    readConditions: () => ({ hour: 9.5, weather: 'rain' }),
    rendererRef: { current: props.renderer },
    sceneRef: { current: {} as ThreeNS.Scene },
    cameraRef: { current: {} as ThreeNS.PerspectiveCamera },
    invalidate: props.invalidate ?? (() => {}),
    walking: props.walking ?? false,
    onEnter: props.onEnter ?? (() => {}),
    ...(props.available !== undefined ? { available: props.available } : {}),
    ...(props.shot ? { shot: props.shot } : {}),
  });
  return (
    <div className="pc-world">
      <span>{photo.active ? 'on' : 'off'}</span>
      {photo.active && (
        <PhotoBar
          onTake={photo.take}
          onKeep={photo.keep}
          houseId="house-1"
          houseName="My Home"
          onDone={photo.leave}
          {...(photo.shoot ? { onShoot: photo.shoot } : {})}
          walking={props.walking ?? false}
        />
      )}
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
    const grid = { type: 'GridHelper', visible: true, layers: { mask: 1 } };
    const scene = { children: [grid] };
    function Shift() {
      usePhotoMode({
        available: true, houseName: 'x', houseId: undefined, readConditions: () => ({ hour: 12, weather: 'clear' }), rendererRef: { current: null },
        sceneRef: { current: scene as unknown as ThreeNS.Scene },
        cameraRef: { current: camera as unknown as ThreeNS.PerspectiveCamera },
        invalidate: () => {}, walking: false, onEnter: () => {},
      });
      return null;
    }
    render(<Shift />);
    act(() => enterPhotoMode());
    expect(camera.view?.enabled).toBe(false);
    expect(grid.layers.mask).toBe(0);
    // The cutaway pass shows the grid on every camera move (an orbit, a
    // preset): hidden through its layers, it stays out of view anyway.
    grid.visible = true;
    expect(grid.layers.mask).toBe(0);
    // A room rebuild meanwhile adds a new grid: hidden as the next frame starts.
    const rebuilt = { type: 'GridHelper', visible: true, layers: { mask: 1 } };
    scene.children.push(rebuilt);
    (scene as unknown as ThreeNS.Object3D).onBeforeRender(
      ...([] as unknown as Parameters<ThreeNS.Object3D['onBeforeRender']>),
    );
    expect(rebuilt.layers.mask).toBe(0);
    act(() => leavePhotoMode());
    expect(camera.view).toEqual(view);
    expect(grid.layers.mask).toBe(1);
    expect(rebuilt.layers.mask).toBe(1);
    expect(grid.visible).toBe(true);
    // The frame hook goes with photo mode.
    expect(Object.hasOwn(scene, 'onBeforeRender')).toBe(false);
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

  it('keeps a photo in the house’s album with the scene’s hour and weather, and deletes it after asking (#912)', async () => {
    const { renderer } = fakeRenderer(new Blob(['png'], { type: 'image/png' }));
    render(<Harness renderer={renderer} />);
    act(() => enterPhotoMode());
    await act(async () => {
      screen.getByRole('button', { name: 'Save to album' }).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Kept until the tab closes'));
    const albumButton = await screen.findByRole('button', { name: 'Album, 1 photo' });
    act(() => albumButton.click());
    expect(albumButton.getAttribute('aria-expanded')).toBe('true');
    const album = await screen.findByRole('region', { name: 'Album' });
    expect(album.textContent).toContain('just now');
    expect(album.textContent).toContain('09:30 · Rain');
    // jsdom can't decode images: the album has no IndexedDB and keeps the PNG for the session.
    expect(album.textContent).toContain('these photos go when the tab closes');
    const answers = autoAnswerConfirms(true);
    await act(async () => {
      screen.getByRole('button', { name: 'Delete photo taken just now' }).click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(answers.asked[0]?.danger).toBe(true);
    answers.stop();
    expect(await screen.findByRole('button', { name: 'Album, 0 photos' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Album' }).textContent).toContain('No photos of this house yet');
    // The row is gone: focus goes to the album, not to <body>.
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Album' }));
  });

  it('shares an album photo through the sheet where it takes an image, and says so (#912)', async () => {
    const store = await openAlbum();
    await store.put({ id: 'p1', houseId: 'house-1', takenAt: Date.now(), hour: 18, weather: 'clear', image: new ArrayBuffer(4), imageType: 'image/jpeg', thumb: null });
    const shared: ShareData[] = [];
    const share = vi.fn((data: ShareData) => {
      shared.push(data);
      return Promise.resolve();
    });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: (data: ShareData) => (data.files ?? []).every((file) => file.type.startsWith('image/')), configurable: true });
    try {
      render(<Harness renderer={fakeRenderer(null).renderer} />);
      act(() => enterPhotoMode());
      act(() => screen.getByRole('button', { name: /^Album/ }).click());
      const button = await screen.findByRole('button', { name: 'Share photo taken just now' });
      act(() => {
        button.click();
        // A second tap while the sheet is open asks nothing more.
        button.click();
      });
      // Opened inside the tap, before anything awaited.
      expect(share).toHaveBeenCalledTimes(1);
      expect(shared[0]?.files?.[0]?.name).toBe('my-home-photo.jpg');
      expect(shared[0]?.files?.[0]?.type).toBe('image/jpeg');
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Photo shared'));
      // Photo mode stays on: sharing edits nothing and leaves nothing.
      expect(isPhotoMode()).toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, 'share');
      Reflect.deleteProperty(navigator, 'canShare');
    }
  });

  it('offers no Share where the sheet won’t take an image: Download covers it (#912)', async () => {
    const store = await openAlbum();
    await store.put({ id: 'p1', houseId: 'house-1', takenAt: Date.now(), hour: 18, weather: 'clear', image: new ArrayBuffer(4), imageType: 'image/jpeg', thumb: null });
    render(<Harness renderer={fakeRenderer(null).renderer} />);
    act(() => enterPhotoMode());
    act(() => screen.getByRole('button', { name: /^Album/ }).click());
    expect(await screen.findByRole('button', { name: /^Download the album copy/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Share photo/ })).toBeNull();
  });

  /** A scene's hour, weather and clock, and the camera presets asked for. */
  function fakeShot(start: ShotConditions = { hour: 10, weather: 'rain', autoCycle: true }) {
    const scene = { ...start };
    const framed: string[] = [];
    const writes: ShotConditions[] = [];
    const shot: ShotControls = {
      read: () => ({ ...scene }),
      write: (next) => {
        writes.push(next);
        Object.assign(scene, next);
      },
      frame: (camera) => framed.push(camera),
    };
    return { shot, scene, framed, writes };
  }

  it('sets a preset’s camera, hour and weather, and puts the scene back as photo mode ends (#912)', () => {
    const { shot, scene, framed } = fakeShot();
    render(<Harness renderer={fakeRenderer(null).renderer} shot={shot} />);
    act(() => enterPhotoMode());
    const presets = screen.getByRole('button', { name: 'Presets' });
    act(() => presets.click());
    expect(presets.getAttribute('aria-expanded')).toBe('true');
    const golden = screen.getByRole('button', { name: 'Golden hour, 17:00 · Clear' });
    act(() => golden.click());
    expect(scene).toEqual({ hour: 17, weather: 'clear', autoCycle: false });
    expect(framed).toEqual(['front']);
    expect(golden.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Golden hour');
    act(() => screen.getByRole('button', { name: 'Snowy day, 11:00 · Snow' }).click());
    expect(scene).toEqual({ hour: 11, weather: 'snow', autoCycle: false });
    expect(framed).toEqual(['front', 'iso']);
    expect(golden.getAttribute('aria-pressed')).toBe('false');
    // Done: back past every preset to the scene as it was, the clock running again.
    act(() => screen.getByRole('button', { name: 'Done' }).click());
    expect(isPhotoMode()).toBe(false);
    expect(scene).toEqual({ hour: 10, weather: 'rain', autoCycle: true });
  });

  it('shows no preset pressed once the camera is moved off it (#912)', () => {
    const { shot } = fakeShot();
    render(<Harness renderer={fakeRenderer(null).renderer} shot={shot} />);
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    act(() => enterPhotoMode());
    act(() => screen.getByRole('button', { name: 'Presets' }).click());
    const golden = screen.getByRole('button', { name: 'Golden hour, 17:00 · Clear' });
    act(() => golden.click());
    expect(golden.getAttribute('aria-pressed')).toBe('true');
    // A tap on the scene that doesn't drag keeps it.
    act(() => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, buttons: 1 }));
      canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 0 }));
    });
    expect(golden.getAttribute('aria-pressed')).toBe('true');
    // An orbit drag on the scene clears it.
    act(() => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, buttons: 1 }));
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1 }));
    });
    expect(golden.getAttribute('aria-pressed')).toBe('false');
    // So does a wheel zoom.
    act(() => golden.click());
    expect(golden.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    });
    expect(golden.getAttribute('aria-pressed')).toBe('false');
    canvas.remove();
  });

  it('leaves the scene alone when no preset was used (#912)', () => {
    const { shot, writes } = fakeShot();
    render(<Harness renderer={fakeRenderer(null).renderer} shot={shot} />);
    act(() => enterPhotoMode());
    press('Escape');
    expect(isPhotoMode()).toBe(false);
    expect(writes).toEqual([]);
  });

  it('keeps the walker’s view while walking: a preset sets the light only (#912)', () => {
    const { shot, scene, framed } = fakeShot();
    render(<Harness renderer={fakeRenderer(null).renderer} shot={shot} walking />);
    act(() => enterPhotoMode());
    act(() => screen.getByRole('button', { name: 'Presets' }).click());
    expect(screen.getByRole('region', { name: 'Presets' }).textContent).toContain('the view stays yours');
    act(() => screen.getByRole('button', { name: 'Night, 21:30 · Clear' }).click());
    expect(scene.hour).toBe(21.5);
    expect(framed).toEqual([]);
  });

  it('shows one panel at a time, and Escape closes it before leaving (#912)', async () => {
    const { shot } = fakeShot();
    render(<Harness renderer={fakeRenderer(null).renderer} shot={shot} />);
    act(() => enterPhotoMode());
    const presets = screen.getByRole('button', { name: 'Presets' });
    act(() => presets.click());
    act(() => screen.getByRole('button', { name: /^Album/ }).click());
    expect(await screen.findByRole('region', { name: 'Album' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Presets' })).toBeNull();
    act(() => presets.click());
    expect(screen.queryByRole('region', { name: 'Album' })).toBeNull();
    // Enter on a preset is the shutter's own key: it passes the guard.
    const enter = press('Enter', screen.getByRole('button', { name: 'Morning, 08:00 · Clear' }));
    expect(enter.defaultPrevented).toBe(false);
    press('Escape');
    expect(screen.queryByRole('region', { name: 'Presets' })).toBeNull();
    expect(document.activeElement).toBe(presets);
    expect(isPhotoMode()).toBe(true);
  });

  it('closes the album on Escape before leaving photo mode (#912)', async () => {
    render(<Harness renderer={fakeRenderer(null).renderer} />);
    act(() => enterPhotoMode());
    const albumButton = screen.getByRole('button', { name: /^Album/ });
    act(() => albumButton.click());
    expect(await screen.findByRole('region', { name: 'Album' })).not.toBeNull();
    press('Escape');
    expect(screen.queryByRole('region', { name: 'Album' })).toBeNull();
    expect(isPhotoMode()).toBe(true);
    expect(document.activeElement).toBe(albumButton);
    press('Escape');
    expect(isPhotoMode()).toBe(false);
  });

  it('leaves Escape to a question asked in photo mode (#912)', () => {
    render(<Harness renderer={fakeRenderer(null).renderer} />);
    act(() => enterPhotoMode());
    let answer: boolean | null = null;
    void askConfirm({ title: 'Delete this photo?', danger: true }).then((value) => {
      answer = value;
    });
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    press('Escape');
    window.removeEventListener('keydown', behind);
    // Nothing in the hook stopped it: it travels on to the question.
    expect(behind).toHaveBeenCalledTimes(1);
    expect(isPhotoMode()).toBe(true);
    expect(answer).toBeNull();
  });

  it('keeps undo and paste from the house when a backdrop click leaves focus on <body> under a question (#912 review)', () => {
    render(
      <>
        <Harness renderer={fakeRenderer(null).renderer} />
        <ConfirmDialogHost />
      </>,
    );
    act(() => enterPhotoMode());
    act(() => {
      void askConfirm({ title: 'The album keeps 30 photos of each house', danger: true });
    });
    const backdrop = document.querySelector<HTMLElement>('[data-confirm-dialog]');
    expect(backdrop).not.toBeNull();
    // A click on the backdrop inside the grace window answers nothing, and
    // in a browser leaves focus on <body>.
    act(() => backdrop?.click());
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).toBe(document.body);
    expect(confirmOpen()).toBe(true);
    const editor = vi.fn();
    window.addEventListener('keydown', editor);
    const undo = press('z', document.body, { ctrlKey: true });
    const paste = press('v', document.body, { ctrlKey: true });
    press(']', document.body);
    press('PageUp', document.body);
    window.removeEventListener('keydown', editor);
    expect(editor).not.toHaveBeenCalled();
    expect(undo.defaultPrevented).toBe(true);
    expect(paste.defaultPrevented).toBe(true);
    expect(confirmOpen()).toBe(true);
    expect(isPhotoMode()).toBe(true);
  });

  it('withdraws the album’s question and saves nothing when photo mode ends during a save (#912 review)', async () => {
    const store = await openAlbum();
    for (let i = 0; i < 30; i++) {
      await store.put({ id: `old-${i}`, houseId: 'house-1', takenAt: i, hour: 12, weather: 'clear', image: new ArrayBuffer(1), imageType: 'image/jpeg', thumb: null });
    }
    render(
      <>
        <Harness renderer={fakeRenderer(new Blob(['png'], { type: 'image/png' })).renderer} />
        <ConfirmDialogHost />
      </>,
    );
    act(() => enterPhotoMode());
    await act(async () => {
      screen.getByRole('button', { name: 'Save to album' }).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await waitFor(() => expect(confirmOpen()).toBe(true));
    act(() => leavePhotoMode());
    await waitFor(() => expect(confirmOpen()).toBe(false));
    const kept = await store.listHouse('house-1');
    expect(kept).toHaveLength(30);
    expect(kept[0]?.id).toBe('old-0');
  });

  it('hands focus back to “Save to album” after the album’s question (#912 review)', async () => {
    const store = await openAlbum();
    for (let i = 0; i < 30; i++) {
      await store.put({ id: `old-${i}`, houseId: 'house-1', takenAt: i, hour: 12, weather: 'clear', image: new ArrayBuffer(1), imageType: 'image/jpeg', thumb: null });
    }
    render(<Harness renderer={fakeRenderer(new Blob(['png'], { type: 'image/png' })).renderer} />);
    act(() => enterPhotoMode());
    const keep = screen.getByRole('button', { name: 'Save to album' });
    const answers = autoAnswerConfirms(false);
    await act(async () => {
      keep.click();
      // The answered question hands focus to the (disabled) button, which drops it.
      (document.activeElement as HTMLElement | null)?.blur();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    answers.stop();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not kept'));
    expect(document.activeElement).toBe(keep);
  });
});
