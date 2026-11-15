import { describe, expect, it, vi } from 'vitest';
import { cachePrefix } from '../../../scripts/build-sw.mjs';
import {
  flagOff,
  runtimeMarker,
  serviceWorkerPlan,
  serviceWorkerUrl,
  shellCachePrefix,
  syncServiceWorker,
  takeOverMessage,
  type WorkerRegistration,
} from './service-worker';

// The offline worker's registration (#933).

const URL_ = 'https://example.org/site/sw.js';

function registration(scriptURL: string): WorkerRegistration & { unregister: ReturnType<typeof vi.fn> } {
  return { active: { scriptURL }, unregister: vi.fn(() => Promise.resolve(true)) };
}

describe('serviceWorkerPlan', () => {
  it('registers in a production build unless the flag turns it off', () => {
    expect(serviceWorkerPlan('production', undefined, true)).toBe('register');
    expect(serviceWorkerPlan('production', 'on', true)).toBe('register');
    expect(serviceWorkerPlan('production', 'off', true)).toBe('unregister');
    expect(serviceWorkerPlan('development', undefined, true)).toBe('unregister');
    expect(serviceWorkerPlan('test', undefined, true)).toBe('unregister');
  });

  it('does nothing where the browser has no service workers', () => {
    expect(serviceWorkerPlan('production', undefined, false)).toBe('none');
  });
});

describe('serviceWorkerUrl', () => {
  it('sits beside the manifest, so a page path without a trailing slash still finds it', () => {
    expect(serviceWorkerUrl('https://example.org/site/manifest.webmanifest', 'https://example.org/site')).toBe(URL_);
    expect(serviceWorkerUrl('https://example.org/manifest.webmanifest', 'https://example.org/?share=x')).toBe('https://example.org/sw.js');
  });

  it('falls back to the page without a manifest link', () => {
    expect(serviceWorkerUrl(null, 'https://example.org/site/?share=x')).toBe(URL_);
  });
});

describe('syncServiceWorker', () => {
  it('registers the worker', async () => {
    const register = vi.fn(() => Promise.resolve({}));
    await syncServiceWorker('register', { register, getRegistrations: () => Promise.resolve([]) }, URL_);
    expect(register).toHaveBeenCalledWith(URL_);
  });

  it('removes only this site\'s worker and caches, not a sibling site\'s on the same origin', async () => {
    const ours = registration(URL_);
    const sibling = registration('https://example.org/other/sw.js');
    const register = vi.fn(() => Promise.resolve({}));
    const names = new Set(['pc-shell:/site/:abc', 'pc-shell:/other/:def', 'unrelated']);
    const cacheNames = { keys: () => Promise.resolve([...names]), delete: (name: string) => Promise.resolve(names.delete(name)) };
    await syncServiceWorker('unregister', { register, getRegistrations: () => Promise.resolve([ours, sibling]) }, URL_, cacheNames);
    expect([...names].sort()).toEqual(['pc-shell:/other/:def', 'unrelated']);
    expect(ours.unregister).toHaveBeenCalledOnce();
    expect(sibling.unregister).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('never throws when the browser refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const register = vi.fn(() => Promise.reject(new DOMException('blocked', 'SecurityError')));
    await expect(syncServiceWorker('register', { register, getRegistrations: () => Promise.resolve([]) }, URL_)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('does nothing without a container or a plan', async () => {
    const register = vi.fn(() => Promise.resolve({}));
    await syncServiceWorker('none', { register, getRegistrations: () => Promise.resolve([]) }, URL_);
    await syncServiceWorker('register', undefined, URL_);
    expect(register).not.toHaveBeenCalled();
  });
});

describe('shellCachePrefix', () => {
  it('names caches as the worker does', () => {
    expect(shellCachePrefix(URL_)).toBe(cachePrefix('https://example.org/site/'));
    expect(shellCachePrefix('https://example.org/sw.js')).toBe(cachePrefix('https://example.org/'));
  });
});

describe('the kill switch flag', () => {
  it('takes off, false or 0 in any case, as the build does', () => {
    for (const value of ['off', 'OFF', 'false', 'False', ' 0 ']) {
      expect(flagOff(value)).toBe(true);
      expect(serviceWorkerPlan('production', value, true)).toBe('unregister');
    }
    for (const value of [undefined, '', 'on', 'true']) expect(flagOff(value)).toBe(false);
  });
});

describe('the update handover', () => {
  it('names this page\'s build by its runtime chunk, as the worker precaches it', () => {
    const marker = runtimeMarker([
      'https://example.org/site/_next/static/chunks/main-1.js',
      'https://example.org/site/_next/static/chunks/webpack-abc.js',
    ]);
    expect(marker).toBe('_next/static/chunks/webpack-abc.js');
    expect(takeOverMessage(marker)).toEqual({ type: 'take-over', marker });
    expect(takeOverMessage(runtimeMarker([]))).toBeNull();
  });
});
