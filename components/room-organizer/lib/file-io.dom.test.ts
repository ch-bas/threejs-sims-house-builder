// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { downloadInventoryCsv, downloadLayoutAsJson, downloadScheduleCsv } from './file-io';
import { downloadRawLayout } from './persistence';

/** What a download hands the browser: the `<a download>` name and the blob. */
interface Download {
  name: string;
  blob: Blob;
}

describe('file downloads (#455)', () => {
  const downloads: Download[] = [];
  const blobs = new Map<string, Blob>();
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

  beforeEach(() => {
    downloads.length = 0;
    blobs.clear();
    let n = 0;
    // jsdom has no object URLs: record the blob behind each one.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:test/${n++}`;
      blobs.set(url, blob);
      return url;
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      if (blob) downloads.push({ name: this.download, blob });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });

  const withItem = (name: string) => makeLayout({ name, floors: [makeFloor({ items: [makeItem()] })] });

  it('names a house without a usable name "layout", never ".csv" or "-inventory.csv"', () => {
    downloadInventoryCsv(withItem(''));
    downloadScheduleCsv(withItem('   '));
    downloadLayoutAsJson(withItem('***'));
    expect(downloads.map((d) => d.name)).toEqual(['layout-inventory.csv', 'layout-schedule.csv', 'layout.json']);
  });

  it('slugs a hostile house name: no path, quote or fake extension survives', () => {
    downloadInventoryCsv(withItem('../../etc/"passwd".exe'));
    expect(downloads.map((d) => d.name)).toEqual(['etc-passwd-exe-inventory.csv']);
  });

  it('types each blob for what it holds', () => {
    downloadInventoryCsv(withItem('Home'));
    downloadLayoutAsJson(withItem('Home'));
    expect(downloads.map((d) => d.blob.type)).toEqual(['text/csv;charset=utf-8', 'application/json']);
  });

  it('downloads a recovery copy verbatim, under the name it is given', async () => {
    const raw = '{"name":"half-written';
    downloadRawLayout(raw, 'recovered-house.json');
    expect(downloads.map((d) => [d.name, d.blob.type])).toEqual([['recovered-house.json', 'application/json']]);
    await expect(downloads[0]!.blob.text()).resolves.toBe(raw);
  });

  it('revokes the object URL after the click has been dispatched, not before', () => {
    vi.useFakeTimers();
    try {
      downloadLayoutAsJson(withItem('Home'));
      expect(downloads).toHaveLength(1);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/0');
    } finally {
      vi.useRealTimers();
    }
  });
});
