import type { KeyboardEvent } from 'react';

/**
 * The arrow keys of a tablist or radio group (#434, #646): one tab stop, and
 * the arrows (plus Home/End) move to the next item and activate it. Tabs run
 * along one row; radios also take Up/Down, as native ones do. The group is
 * the `tablist` or `radiogroup` around the focused item.
 */
export function onRovingKeyDown(event: KeyboardEvent<HTMLElement>, activate: (index: number) => void): void {
  // Alt+Left is the browser's Back; leave modified keys alone. Not Shift:
  // Shift+arrow reaching the window would nudge the selection by a metre.
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const role = event.currentTarget.getAttribute('role');
  const group = event.currentTarget.closest('[role="tablist"], [role="radiogroup"]');
  const items = Array.from(group?.querySelectorAll<HTMLElement>(`[role="${role}"]`) ?? []);
  const next = nextIndex(event.key, items.indexOf(event.currentTarget), items.length, role === 'radio');
  if (next === null) return;
  // Kept from the editor's window shortcuts, where arrows nudge the selection.
  event.preventDefault();
  event.stopPropagation();
  activate(next);
  items[next]?.focus();
}

function nextIndex(key: string, index: number, count: number, vertical: boolean): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'ArrowDown':
      return vertical ? (index + 1) % count : null;
    case 'ArrowUp':
      return vertical ? (index - 1 + count) % count : null;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
