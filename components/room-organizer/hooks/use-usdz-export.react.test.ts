// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { AR_LINK_IMAGE } from '../lib/ar-view';
import { usdzFailureMessage, useUsdzExport } from './use-usdz-export';
import type { RoomLayout } from '../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ar = vi.hoisted(() => ({
  supported: true,
  builds: [] as Array<{ layout: unknown; resolve: (blob: Blob) => void; reject: (error: unknown) => void }>,
}));
const notices = vi.hoisted(() => [] as string[]);
const downloads = vi.hoisted(() => [] as string[]);

vi.mock('../lib/ar-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ar-view')>()),
  quickLookSupported: () => ar.supported,
  buildUsdzBlob: (layout: unknown) =>
    new Promise<Blob>((resolve, reject) => {
      ar.builds.push({ layout, resolve, reject });
    }),
}));
vi.mock('../lib/editor-notices', () => ({ notify: (message: string) => notices.push(message) }));
vi.mock('../lib/plan-export/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/plan-export/download')>()),
  downloadBlob: (name: string) => downloads.push(name),
}));

let made = 0;
const revoked: string[] = [];

beforeEach(() => {
  ar.supported = true;
  ar.builds.length = 0;
  notices.length = 0;
  downloads.length = 0;
  revoked.length = 0;
  made = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:model-${++made}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const villa = makeLayout({ name: 'Villa' });
const blob = () => new Blob([new Uint8Array([1])]);

async function setup(layout: RoomLayout = villa) {
  const hook = renderHook(({ house }) => useUsdzExport(house), { initialProps: { house: layout } });
  // The detection loads with the module, after mount.
  await act(async () => {});
  return hook;
}

/** A tap on the button, and the module load it waits on. */
async function tap(result: { current: { build(): void } }) {
  await act(async () => result.current.build());
}

async function finish(index = 0, outcome: 'ok' | Error = 'ok') {
  await act(async () => {
    const build = ar.builds[index]!;
    if (outcome === 'ok') build.resolve(blob());
    else build.reject(outcome);
  });
}

describe('the USDZ export, on an AR device (#937)', () => {
  it('builds on the first tap, then offers the model for the player to open', async () => {
    const { result } = await setup();
    expect(result.current.arView).toBe(true);
    await tap(result);
    expect(result.current.state).toEqual({ kind: 'building' });
    await finish();
    expect(result.current.state).toEqual({ kind: 'ready', url: 'blob:model-1', fileName: 'villa.usdz', image: AR_LINK_IMAGE });
    // Nothing is clicked or saved for the player: the link is theirs to tap.
    expect(downloads).toEqual([]);
  });

  it('builds once for a double tap', async () => {
    const { result } = await setup();
    await act(async () => {
      result.current.build();
      result.current.build();
    });
    expect(ar.builds).toHaveLength(1);
    await finish();
  });

  it('revokes the model when the house changes, on the next build and on unmount', async () => {
    const { result, rerender, unmount } = await setup();
    await tap(result);
    await finish();
    rerender({ house: { ...villa, name: 'Villa 2' } });
    expect(revoked).toEqual(['blob:model-1']);
    expect(result.current.state).toEqual({ kind: 'idle' });

    await tap(result);
    await finish(1);
    await tap(result);
    expect(revoked).toEqual(['blob:model-1', 'blob:model-2']);
    await finish(2);
    unmount();
    expect(revoked).toEqual(['blob:model-1', 'blob:model-2', 'blob:model-3']);
  });

  it('drops a model of a house edited while it was built', async () => {
    const { result, rerender } = await setup();
    await tap(result);
    rerender({ house: { ...villa, name: 'Edited' } });
    await finish();
    expect(result.current.state).toEqual({ kind: 'idle' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('makes nothing after an unmount mid-build', async () => {
    const { result, unmount } = await setup();
    await tap(result);
    unmount();
    await act(async () => ar.builds[0]!.resolve(blob()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('says what failed, and blames the connection only for a chunk', async () => {
    const { result } = await setup();
    await tap(result);
    await finish(0, Object.assign(new Error('Loading chunk 375 failed.'), { name: 'ChunkLoadError' }));
    await tap(result);
    await finish(1, new Error('exporter refused'));
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatch(/connection/);
    expect(notices[1]).not.toMatch(/connection/);
    expect(result.current.state).toEqual({ kind: 'idle' });
  });
});

describe('the failure message (#937)', () => {
  it('blames the connection only when a chunk failed to load', () => {
    const chunk = Object.assign(new Error('Loading chunk 375 failed.'), { name: 'ChunkLoadError' });
    expect(usdzFailureMessage(chunk)).toMatch(/connection/);
    expect(usdzFailureMessage(new Error('THREE.USDZExporter: No valid image data found.'))).not.toMatch(/connection/);
    expect(usdzFailureMessage('boom')).not.toMatch(/connection/);
  });
});

describe('the USDZ export, elsewhere (#937)', () => {
  it('saves the file in one tap', async () => {
    ar.supported = false;
    const { result } = await setup();
    expect(result.current.arView).toBe(false);
    await tap(result);
    await finish();
    expect(downloads).toEqual(['villa.usdz']);
    expect(result.current.state).toEqual({ kind: 'idle' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
