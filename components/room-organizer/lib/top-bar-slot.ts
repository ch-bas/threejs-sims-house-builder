/**
 * The free strip of the top bar between the title badge (top left) and the
 * floor and wall pills (top right). On short screens the touch camera
 * buttons ride in it, so it is measured rather than assumed: the badge
 * shows the house name on some breakpoints, and a tall building's floor
 * pill grows leftwards.
 */

export interface SlotRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TopBarSlot {
  /** Viewport x where the row starts: just after the badge. */
  start: number;
  /** Viewport x where it must end. */
  end: number;
  /**
   * Viewport y for the row when the strip beside the pills is too narrow
   * for it: it drops below the pills instead and spans to the right edge.
   * `null` keeps it in the top bar.
   */
  top: number | null;
}

/** Rows closer than this belong to the same row (sub-pixel and border slack). */
const ROW_SLACK = 4;

/**
 * Where a row `rowWidth` wide goes, given `leading` (the badge's boxes) and
 * `trailing` (the pills). Only the pills' first row bounds the strip: pills
 * that wrap onto a second row sit below it. Empty boxes (hidden by a
 * breakpoint) are ignored. `gap` is kept clear around the row.
 */
export function topBarSlot(
  leading: readonly SlotRect[],
  trailing: readonly SlotRect[],
  rowWidth: number,
  viewportWidth: number,
  gap: number
): TopBarSlot {
  const visible = (r: SlotRect) => r.right > r.left && r.bottom > r.top;
  const lead = leading.filter(visible);
  const trail = trailing.filter(visible);
  const start = Math.round(lead.length > 0 ? Math.max(...lead.map((r) => r.right)) + gap : gap);
  const firstRowTop = trail.length > 0 ? Math.min(...trail.map((r) => r.top)) : 0;
  const firstRow = trail.filter((r) => r.top <= firstRowTop + ROW_SLACK);
  const end = Math.round(firstRow.length > 0 ? Math.min(...firstRow.map((r) => r.left)) - gap : viewportWidth - gap);
  if (rowWidth <= end - start || trail.length === 0) return { start, end: Math.max(start, end), top: null };
  // Beside the pills it would wrap into a column down the screen: below
  // them it has the whole width.
  const pillsBottom = Math.max(...trail.map((r) => r.bottom));
  return { start, end: Math.round(viewportWidth - gap), top: Math.round(pillsBottom + gap) };
}
