/**
 * Escape text for HTML or XML content and attribute values: `&`, `<`, `>`,
 * `"` and `'`. The one copy shared by the blueprint and print popups and the
 * SVG exporter (#451).
 */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
