// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useEvent } from './use-event';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

it('keeps one identity and always runs the latest handler', () => {
  const { result, rerender } = renderHook(({ offset }) => useEvent((value: number) => value + offset), {
    initialProps: { offset: 1 },
  });
  const first = result.current;
  expect(first(1)).toBe(2);
  rerender({ offset: 10 });
  expect(result.current).toBe(first);
  expect(first(1)).toBe(11);
});
