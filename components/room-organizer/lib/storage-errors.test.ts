import { describe, expect, it } from 'vitest';
import { classifyStorageError } from './storage-errors';

describe('classifyStorageError', () => {
  it('recognises a quota error by name or legacy code', () => {
    expect(classifyStorageError(new DOMException('full', 'QuotaExceededError'))).toBe('quota');
    expect(classifyStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe('quota');
    expect(classifyStorageError({ name: 'Error', code: 22 })).toBe('quota');
    expect(classifyStorageError({ name: 'Error', code: 1014 })).toBe('quota');
  });

  it('recognises blocked storage', () => {
    expect(classifyStorageError(new DOMException('The operation is insecure.', 'SecurityError'))).toBe('blocked');
    expect(classifyStorageError({ code: 18 })).toBe('blocked');
  });

  it('calls anything else unknown', () => {
    expect(classifyStorageError(new Error('QuotaExceededError'))).toBe('unknown');
    expect(classifyStorageError(new TypeError('x'))).toBe('unknown');
    expect(classifyStorageError('quota')).toBe('unknown');
    expect(classifyStorageError(null)).toBe('unknown');
  });
});
