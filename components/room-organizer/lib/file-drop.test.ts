import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT } from './backup';
import { CATALOG_DRAG_MIME } from './catalog-drag';
import { askConfirm, cancelPendingConfirms } from './confirm-dialog';
import { dragHasFiles, droppedFileKind, dropRefusal, isJsonFile, MODAL_OPEN_MESSAGE, modalBlocksFiles } from './file-drop';

// Dropping a house file on the page (#934).

describe('dragHasFiles', () => {
  it('sees files from outside, not the catalogue drag or text', () => {
    expect(dragHasFiles(['Files'])).toBe(true);
    expect(dragHasFiles(['application/x-moz-file', 'Files'])).toBe(true);
    expect(dragHasFiles([CATALOG_DRAG_MIME, 'text/plain'])).toBe(false);
    expect(dragHasFiles(['text/plain', 'text/uri-list'])).toBe(false);
  });
});

describe('isJsonFile', () => {
  it('takes JSON by type or by extension', () => {
    expect(isJsonFile({ name: 'house', type: 'application/json' })).toBe(true);
    expect(isJsonFile({ name: 'My House.JSON', type: '' })).toBe(true);
    expect(isJsonFile({ name: 'plan.png', type: 'image/png' })).toBe(false);
  });
});

describe('droppedFileKind', () => {
  it('tells a backup from a house', () => {
    expect(droppedFileKind(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }))).toBe('backup');
    expect(droppedFileKind(JSON.stringify({ name: 'House', floors: [] }))).toBe('house');
  });

  it('leaves anything unreadable to the import, which says why', () => {
    expect(droppedFileKind('not json')).toBe('house');
    expect(droppedFileKind('null')).toBe('house');
    expect(droppedFileKind('[1]')).toBe('house');
  });
});

describe('dropRefusal', () => {
  const json = { name: 'a.json', type: 'application/json' };
  it('opens one JSON file', () => {
    expect(dropRefusal([json], null)).toBeNull();
  });

  it('refuses while the house is locked, more than one file, or another kind', () => {
    expect(dropRefusal([json], 'Not while exploring')).toBe('Not while exploring');
    expect(dropRefusal([json, json], null)).toBe('Drop one file at a time.');
    expect(dropRefusal([{ name: 'plan.png', type: 'image/png' }], null)).toMatch(/plan\.png.*isn’t a house file/);
  });
});

describe('dropRefusal for a launch', () => {
  it('words its reasons for opening, not dropping', () => {
    expect(dropRefusal([{ name: 'a.json', type: '' }, { name: 'b.json', type: '' }], null, 'open')).toBe('Open one file at a time.');
    expect(dropRefusal([{ name: 'x.txt', type: 'text/plain' }], null, 'open')).toBe('“x.txt” isn’t a house file. Open a .json house or backup.');
  });
});

describe('modalBlocksFiles', () => {
  it('blocks while a question waits or a blocking dialog shows, not for the drawer', () => {
    const page = (match: boolean) => ({ querySelector: () => (match ? ({} as Element) : null) });
    expect(modalBlocksFiles(page(false))).toBeNull();
    expect(modalBlocksFiles(page(true))).toBe(MODAL_OPEN_MESSAGE);
    void askConfirm({ title: 'Sure?', body: '', confirmLabel: 'Yes' });
    expect(modalBlocksFiles(page(false))).toBe(MODAL_OPEN_MESSAGE);
    cancelPendingConfirms();
    expect(modalBlocksFiles(null)).toBeNull();
  });
});
